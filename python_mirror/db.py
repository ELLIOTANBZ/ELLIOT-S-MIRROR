## db.py = how Python opens and uses the database, not app specific does not care about MIRROR, general database things

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

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
      remove_obsolete_readiness_columns(conn)
      ensure_column(conn, "readiness_settings", "development_weight", "REAL NOT NULL DEFAULT 0.10")
      ensure_column(conn, "readiness_settings", "application_weight", "REAL NOT NULL DEFAULT 0.10")
      ensure_column(conn, "training_records", "training_type", "TEXT NOT NULL DEFAULT 'Optional'")
      ensure_column(conn, "training_records", "description", "TEXT NOT NULL DEFAULT ''")
      ensure_column(conn, "training_records", "assigned_by", "TEXT NOT NULL DEFAULT 'CPF Board'")


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
              role TEXT NOT NULL CHECK (role IN ('CSE', 'TL', 'Supervisor', 'Admin')),
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
              CASE WHEN role = 'CSO' THEN 'CSE' ELSE role END,
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

            UPDATE career_profiles
            SET current_role = 'CSE'
            WHERE current_role = 'CSO';

            UPDATE career_profiles
            SET target_role = 'CSE'
            WHERE target_role = 'CSO';

            COMMIT;
            """
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


## Removes old columns whose values now come from other tables or calculations.
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
    old_settings_columns = {
        "meeting_expectations_threshold",
        "stretch_ready_threshold",
        "advancement_ready_threshold",
    }
    if not (career_columns & old_career_columns or settings_columns & old_settings_columns):
        return

    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.executescript(
            """
            BEGIN;

            CREATE TABLE career_profiles_new (
              officer_id TEXT PRIMARY KEY,
              current_role TEXT NOT NULL,
              target_role TEXT NOT NULL,
              role_start_date TEXT,
              responsibilities_json TEXT NOT NULL DEFAULT '[]',
              target_responsibilities_json TEXT NOT NULL DEFAULT '[]',
              expected_tenure_years REAL NOT NULL DEFAULT 2,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY(officer_id) REFERENCES users(id)
            );

            INSERT INTO career_profiles_new
              (officer_id, current_role, target_role, role_start_date,
               responsibilities_json, target_responsibilities_json,
               expected_tenure_years, updated_at)
            SELECT
              officer_id, current_role, target_role, role_start_date,
              responsibilities_json, target_responsibilities_json,
              expected_tenure_years, updated_at
            FROM career_profiles;

            DROP TABLE career_profiles;
            ALTER TABLE career_profiles_new RENAME TO career_profiles;

            CREATE TABLE readiness_settings_new (
              role TEXT PRIMARY KEY,
              core_weight REAL NOT NULL DEFAULT 0.25,
              functional_weight REAL NOT NULL DEFAULT 0.15,
              correspondence_weight REAL NOT NULL DEFAULT 0.15,
              performance_weight REAL NOT NULL DEFAULT 0.15,
              tenure_weight REAL NOT NULL DEFAULT 0.10,
              development_weight REAL NOT NULL DEFAULT 0.10,
              application_weight REAL NOT NULL DEFAULT 0.10,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            INSERT INTO readiness_settings_new
              (role, core_weight, functional_weight, correspondence_weight,
               performance_weight, tenure_weight, development_weight,
               application_weight, updated_at)
            SELECT
              role, core_weight, functional_weight, correspondence_weight,
              performance_weight, tenure_weight, development_weight,
              application_weight, updated_at
            FROM readiness_settings;

            DROP TABLE readiness_settings;
            ALTER TABLE readiness_settings_new RENAME TO readiness_settings;

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
