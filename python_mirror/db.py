## db.py = how Python opens and uses the database, not app specific does not care about MIRROR, general database things

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from services.role_model import ALL_USER_ROLES, clean_role_name

load_dotenv()

## where the DB file is (DB path)
ROOT = Path(__file__).resolve().parent              ## ROOT = python_mirror/
DEFAULT_DB = ROOT / "db" / "local_app.db"           ## DEFAULT_DB = python_mirror/db/local_app.db


## If MIRROR_DB_PATH exists in .env, use that, else use python_mirror/db/local_app.db.
def db_path() -> Path:
    return Path(os.getenv("MIRROR_DB_PATH", str(DEFAULT_DB))).resolve()


def master_db_path() -> Path:
    return Path(os.getenv("MIRROR_MASTER_DB_PATH", str(ROOT / "db" / "master.db"))).resolve()


## opens the DB
def connect(path: Path | None = None) -> sqlite3.Connection:
    path = path or db_path()                            ## If caller gives a path, use it. Otherwise use normal app DB path.
    path.parent.mkdir(parents=True, exist_ok=True)      ## create the folder if missing
    conn = sqlite3.connect(path)                        ## opens the DB file, if file does not exist, SQLite can create it
    conn.row_factory = sqlite3.Row                      ## makes rows accessible by column name row["username"] (instead of just index row[0])
    conn.execute("PRAGMA foreign_keys = ON")            ## turns on foreign keys
    conn.execute("PRAGMA journal_mode = WAL")           ## WAL mode helps SQLite handle read/writes more smoothly
    return conn                                         ## return the open connection


## how tables are created (reads schema.sql and execute, and create tables if they do not exist)
def init_db(path: Path | None = None) -> None:
    schema = ROOT / "db" / "schema.sql"
    with connect(path) as conn:
      conn.executescript(schema.read_text(encoding="utf-8"))
      migrate_cso_role_to_cse(conn)
      migrate_supervisor_to_csm_ah_roles(conn)
      migrate_roles_to_new_hierarchy(conn)
      remove_obsolete_readiness_columns(conn)
      ensure_column(conn, "readiness_settings", "leadership_weight", "REAL NOT NULL DEFAULT 0.25")
      migrate_readiness_thresholds_by_tier(conn)
      ensure_column(conn, "training_records", "training_type", "TEXT NOT NULL DEFAULT 'Optional'")
      ensure_column(conn, "training_records", "description", "TEXT NOT NULL DEFAULT ''")
      ensure_column(conn, "training_records", "assigned_by", "TEXT NOT NULL DEFAULT 'CPF Board'")
      ensure_column(conn, "training_records", "competency_gap", "TEXT NOT NULL DEFAULT ''")
      ensure_column(conn, "organisation_relationships", "trained_schemes", "TEXT NOT NULL DEFAULT ''")
      ensure_column(conn, "ess_records", "is_valid", "INTEGER NOT NULL DEFAULT 1")
      ensure_column(conn, "project_records", "project_leads", "TEXT NOT NULL DEFAULT ''")
      ensure_column(conn, "project_records", "project_role", "TEXT NOT NULL DEFAULT ''")
      ensure_column(conn, "competency_source_weights", "scorecard_weight", "REAL NOT NULL DEFAULT 0.30")
      migrate_competency_source_weights_by_role(conn)


def role_check_sql() -> str:
    roles = ", ".join(f"'{role}'" for role in ALL_USER_ROLES)
    return f"role TEXT NOT NULL CHECK (role IN ({roles}))"


def migrate_roles_to_new_hierarchy(conn: sqlite3.Connection) -> None:
    users_table = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
    ).fetchone()
    if not users_table or "'ACSM (TL)'" in users_table["sql"]:
        return

    rows = conn.execute("SELECT * FROM users").fetchall()
    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.execute("BEGIN")
        conn.execute(
            f"""
            CREATE TABLE users_new (
              id TEXT PRIMARY KEY,
              username TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,
              name TEXT NOT NULL,
              {role_check_sql()},
              record_version INTEGER NOT NULL DEFAULT 1,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        for row in rows:
            role = clean_role_name(row["role"]) or "CSE"
            conn.execute(
                """
                INSERT INTO users_new
                  (id, username, password_hash, name, role, record_version, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["id"],
                    row["username"],
                    row["password_hash"],
                    row["name"],
                    role,
                    row["record_version"],
                    row["updated_at"],
                ),
            )
        conn.execute("DROP TABLE users")
        conn.execute("ALTER TABLE users_new RENAME TO users")

        role_updates = {
            "TL": "ACSM (TL)",
            "CSM": "CSM (CS6)",
            "AH": "AH (CS6)",
            "Supervisor": "CSM (CS6)",
            "CSO": "CSE",
        }
        for old_role, new_role in role_updates.items():
            conn.execute(
                "UPDATE readiness_settings SET role = ? WHERE role = ?",
                (new_role, old_role),
            )
            conn.execute(
                "UPDATE competency_source_weights SET role = ? WHERE role = ?",
                (new_role, old_role),
            )
            conn.execute(
                "UPDATE career_profiles SET current_role = ? WHERE current_role = ?",
                (new_role, old_role),
            )
            conn.execute(
                "UPDATE career_profiles SET target_role = ? WHERE target_role = ?",
                (new_role, old_role),
            )
        conn.execute(
            "UPDATE career_profiles SET target_role = 'AH (CS7)' WHERE target_role = 'Senior CSM/AH'"
        )
        conn.execute("COMMIT")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


## One-time migration for databases created before the CSO role was renamed CSE.
def migrate_cso_role_to_cse(conn: sqlite3.Connection) -> None:
    users_table = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
    ).fetchone()
    if not users_table or "'CSO'" not in users_table["sql"]:
        return

    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.executescript(
            """
            BEGIN;

            CREATE TABLE users_new (
              id TEXT PRIMARY KEY,
              username TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,
              name TEXT NOT NULL,
              role TEXT NOT NULL CHECK (role IN ('CSE', 'TL', 'CSM', 'AH', 'Admin')),
              record_version INTEGER NOT NULL DEFAULT 1,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            INSERT INTO users_new
              (id, username, password_hash, name, role, record_version, updated_at)
            SELECT
              id,
              username,
              password_hash,
              name,
              CASE
                WHEN role = 'CSO' THEN 'CSE'
                WHEN role = 'Supervisor' THEN 'CSM'
                ELSE role
              END,
              record_version,
              updated_at
            FROM users;

            DROP TABLE users;
            ALTER TABLE users_new RENAME TO users;

            DELETE FROM readiness_settings
            WHERE role = 'CSE'
              AND EXISTS (
                SELECT 1 FROM readiness_settings old_settings
                WHERE old_settings.role = 'CSO'
              );

            UPDATE readiness_settings
            SET role = 'CSE'
            WHERE role = 'CSO';

            UPDATE readiness_settings
            SET role = 'CSM'
            WHERE role = 'Supervisor'
              AND NOT EXISTS (
                SELECT 1 FROM readiness_settings existing_settings
                WHERE existing_settings.role = 'CSM'
              );

            DELETE FROM readiness_settings
            WHERE role = 'Supervisor';

            INSERT OR IGNORE INTO readiness_settings
              (role, core_weight, functional_weight, correspondence_weight, updated_at)
            SELECT
              'AH', core_weight, functional_weight, correspondence_weight, updated_at
            FROM readiness_settings
            WHERE role = 'CSM';

            UPDATE career_profiles
            SET current_role = 'CSE'
            WHERE current_role = 'CSO';

            UPDATE career_profiles
            SET current_role = 'CSM'
            WHERE current_role = 'Supervisor';

            UPDATE career_profiles
            SET target_role = 'CSE'
            WHERE target_role = 'CSO';

            UPDATE career_profiles
            SET target_role = 'CSM'
            WHERE target_role = 'Supervisor';

            UPDATE career_profiles
            SET target_role = 'Senior CSM/AH'
            WHERE target_role = 'Senior Supervisor';

            COMMIT;
            """
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


## One-time migration so existing local databases stop using the old Supervisor role.
def migrate_supervisor_to_csm_ah_roles(conn: sqlite3.Connection) -> None:
    users_table = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
    ).fetchone()
    if not users_table or "'Supervisor'" not in users_table["sql"]:
        return

    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.executescript(
            """
            BEGIN;

            CREATE TABLE users_new (
              id TEXT PRIMARY KEY,
              username TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,
              name TEXT NOT NULL,
              role TEXT NOT NULL CHECK (role IN ('CSE', 'TL', 'CSM', 'AH', 'Admin')),
              record_version INTEGER NOT NULL DEFAULT 1,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            INSERT INTO users_new
              (id, username, password_hash, name, role, record_version, updated_at)
            SELECT id, username, password_hash, name,
                   CASE WHEN role = 'Supervisor' THEN 'CSM' ELSE role END,
                   record_version, updated_at
            FROM users;

            DROP TABLE users;
            ALTER TABLE users_new RENAME TO users;

            UPDATE readiness_settings
            SET role = 'CSM'
            WHERE role = 'Supervisor'
              AND NOT EXISTS (
                SELECT 1 FROM readiness_settings existing_settings
                WHERE existing_settings.role = 'CSM'
              );

            DELETE FROM readiness_settings
            WHERE role = 'Supervisor';

            INSERT OR IGNORE INTO readiness_settings
              (role, core_weight, functional_weight, correspondence_weight, updated_at)
            SELECT
              'AH', core_weight, functional_weight, correspondence_weight, updated_at
            FROM readiness_settings
            WHERE role = 'CSM';

            UPDATE career_profiles
            SET current_role = 'CSM'
            WHERE current_role = 'Supervisor';

            UPDATE career_profiles
            SET target_role = 'CSM'
            WHERE target_role = 'Supervisor';

            UPDATE career_profiles
            SET target_role = 'Senior CSM/AH'
            WHERE target_role = 'Senior Supervisor';

            COMMIT;
            """
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


## Removes old columns/tables whose values are no longer part of readiness.
def remove_obsolete_readiness_columns(conn: sqlite3.Connection) -> None:
    career_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(career_profiles)").fetchall()
    }
    settings_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(readiness_settings)").fetchall()
    }
    old_career_columns = {"team_name", "readiness_stage"}
    removed_career_columns = {"expected_tenure_years", "role_start_date"}
    old_settings_columns = {
        "meeting_expectations_threshold",
        "stretch_ready_threshold",
        "advancement_ready_threshold",
    }
    removed_settings_columns = {
        "performance_weight",
        "tenure_weight",
        "development_weight",
        "application_weight",
    }
    has_performance_table = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'performance_records'"
    ).fetchone()
    needs_migration = (
        career_columns & old_career_columns
        or career_columns & removed_career_columns
        or settings_columns & old_settings_columns
        or settings_columns & removed_settings_columns
        or has_performance_table
    )
    if not needs_migration:
        return

    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        career_selects = {
            "officer_id": "officer_id",
            "current_role": "current_role",
            "target_role": "target_role",
            "responsibilities_json": "responsibilities_json",
            "target_responsibilities_json": "target_responsibilities_json",
            "updated_at": "updated_at",
        }
        settings_selects = {
            "role": "role",
            "core_weight": "core_weight",
            "functional_weight": "functional_weight",
            "correspondence_weight": "correspondence_weight",
            "leadership_weight": "leadership_weight" if "leadership_weight" in settings_columns else "0.25",
            "updated_at": "updated_at",
        }
        conn.executescript(
            f"""
            BEGIN;

            CREATE TABLE career_profiles_new (
              officer_id TEXT PRIMARY KEY,
              current_role TEXT NOT NULL,
              target_role TEXT NOT NULL,
              responsibilities_json TEXT NOT NULL DEFAULT '[]',
              target_responsibilities_json TEXT NOT NULL DEFAULT '[]',
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY(officer_id) REFERENCES users(id)
            );

            INSERT INTO career_profiles_new
              ({", ".join(career_selects)})
            SELECT
              {", ".join(career_selects.values())}
            FROM career_profiles;

            DROP TABLE career_profiles;
            ALTER TABLE career_profiles_new RENAME TO career_profiles;

            CREATE TABLE readiness_settings_new (
              role TEXT PRIMARY KEY,
              core_weight REAL NOT NULL DEFAULT 0.25,
              functional_weight REAL NOT NULL DEFAULT 0.25,
              correspondence_weight REAL NOT NULL DEFAULT 0.25,
              leadership_weight REAL NOT NULL DEFAULT 0.25,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            INSERT INTO readiness_settings_new
              ({", ".join(settings_selects)})
            SELECT
              {", ".join(settings_selects.values())}
            FROM readiness_settings;

            DROP TABLE readiness_settings;
            ALTER TABLE readiness_settings_new RENAME TO readiness_settings;

            DROP TABLE IF EXISTS performance_records;

            COMMIT;
            """
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def migrate_competency_source_weights_by_role(conn: sqlite3.Connection) -> None:
    columns = conn.execute("PRAGMA table_info(competency_source_weights)").fetchall()
    column_names = {column["name"] for column in columns}
    primary_key_columns = [column["name"] for column in columns if column["pk"]]
    if "role" in column_names and primary_key_columns == ["role", "competency_name"]:
        return

    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.executescript(
            """
            BEGIN;

            CREATE TABLE competency_source_weights_new (
              role TEXT NOT NULL DEFAULT 'CSE',
              competency_name TEXT NOT NULL,
              audit_weight REAL NOT NULL DEFAULT 0.30,
              scorecard_weight REAL NOT NULL DEFAULT 0.30,
              interaction_weight REAL NOT NULL DEFAULT 0.30,
              project_weight REAL NOT NULL DEFAULT 0.10,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY(role, competency_name)
            );

            INSERT OR IGNORE INTO competency_source_weights_new
              (role, competency_name, audit_weight, scorecard_weight, interaction_weight, project_weight, updated_at)
            SELECT role, competency_name, audit_weight, scorecard_weight, interaction_weight, project_weight, updated_at
            FROM (
              SELECT 'CSE' AS role, competency_name, audit_weight, scorecard_weight, interaction_weight, project_weight, updated_at
              FROM competency_source_weights
              UNION ALL
              SELECT 'TL' AS role, competency_name, audit_weight, scorecard_weight, interaction_weight, project_weight, updated_at
              FROM competency_source_weights
              UNION ALL
              SELECT 'CSM' AS role, competency_name, audit_weight, scorecard_weight, interaction_weight, project_weight, updated_at
              FROM competency_source_weights
              UNION ALL
              SELECT 'AH' AS role, competency_name, 0.0 AS audit_weight, 0.0 AS scorecard_weight, 0.0 AS interaction_weight, 1.0 AS project_weight, updated_at
              FROM competency_source_weights
            );

            DROP TABLE competency_source_weights;
            ALTER TABLE competency_source_weights_new RENAME TO competency_source_weights;

            COMMIT;
            """
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def migrate_readiness_thresholds_by_tier(conn: sqlite3.Connection) -> None:
    columns = conn.execute("PRAGMA table_info(readiness_thresholds)").fetchall()
    if not columns:
        return
    column_names = {column["name"] for column in columns}
    primary_key_columns = [column["name"] for column in columns if column["pk"]]
    if "tier" in column_names and primary_key_columns == ["tier", "stage", "metric"]:
        return

    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.executescript(
            """
            BEGIN;

            CREATE TABLE readiness_thresholds_new (
              tier TEXT NOT NULL DEFAULT 'c?4',
              stage TEXT NOT NULL,
              metric TEXT NOT NULL,
              display_name TEXT NOT NULL,
              minimum_value REAL NOT NULL,
              unit TEXT NOT NULL DEFAULT 'score',
              sequence INTEGER NOT NULL DEFAULT 1,
              PRIMARY KEY(tier, stage, metric)
            );

            INSERT OR IGNORE INTO readiness_thresholds_new
              (tier, stage, metric, display_name, minimum_value, unit, sequence)
            SELECT 'c?4', stage, metric, display_name, minimum_value, unit, sequence
            FROM readiness_thresholds;

            DROP TABLE readiness_thresholds;
            ALTER TABLE readiness_thresholds_new RENAME TO readiness_thresholds;

            COMMIT;
            """
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def ensure_column(
    conn: sqlite3.Connection,
    table_name: str,
    column_name: str,
    definition: str,
) -> None:
    columns = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    if column_name not in {column["name"] for column in columns}:
        conn.execute(
            f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"
        )


## HELPER FUNCTIONS (used by repositories.py)

## convert 1 SQLite row --> python dict
def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row else None

def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]

## turn python object --> json string
def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))

## turn json string --> python object
def loads(value: str | None, fallback: Any = None) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


## creates random unique ID
def new_id() -> str:
    return uuid.uuid4().hex
