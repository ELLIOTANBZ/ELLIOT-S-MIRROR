from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from db import db_path, init_db
from services.access_control import descendant_user_ids

DEPENDENT_TABLES = (
    "audit_records",
    "ess_records",
    "interactions",
    "parsed_uploads",
    "competency_overrides",
    "career_profiles",
    "training_records",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import a manually downloaded full database/export, then scrub the local copy for one MIRROR user."
    )
    parser.add_argument("--source", required=True, help="Downloaded full .db/.sqlite file from SharePoint.")
    parser.add_argument("--username", required=True, help="MIRROR username, e.g. cso001 or tl001.")
    parser.add_argument("--from-date", help="Optional inclusive start date, YYYY-MM-DD.")
    parser.add_argument("--to-date", help="Optional inclusive end date, YYYY-MM-DD.")
    parser.add_argument("--output", help="Optional output SQLite path. Defaults to MIRROR_DB_PATH/local_app.db.")
    return parser.parse_args()


def allowed_user_ids(conn: sqlite3.Connection, username: str) -> set[str] | None:
    user = conn.execute(
        "SELECT id, role FROM users WHERE lower(username) = ?",
        (username.strip().lower(),),
    ).fetchone()
    if user is None:
        raise SystemExit(f"User not found in the downloaded database: {username}")
    if user["role"] == "Admin":
        return None
    return descendant_user_ids(conn, user["id"])


def validate_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise SystemExit(f"Invalid date {value}. Use YYYY-MM-DD.") from exc
    return value


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(row[1] == column for row in rows)


def scrub_users(conn: sqlite3.Connection, allowed_ids: set[str] | None) -> None:
    if allowed_ids is None:
        return
    placeholders = ",".join("?" for _ in allowed_ids)
    conn.execute(
        f"DELETE FROM users WHERE id NOT IN ({placeholders})",
        tuple(allowed_ids),
    )


def scrub_dependent_tables(conn: sqlite3.Connection, allowed_ids: set[str] | None) -> None:
    if allowed_ids is None:
        return
    placeholders = ",".join("?" for _ in allowed_ids)
    for table in DEPENDENT_TABLES:
        if not table_exists(conn, table):
            continue
        if column_exists(conn, table, "officer_id"):
            conn.execute(
                f"DELETE FROM {table} WHERE officer_id NOT IN ({placeholders})",
                tuple(allowed_ids),
            )
    if table_exists(conn, "local_pending_changes"):
        conn.execute("DELETE FROM local_pending_changes")
    if table_exists(conn, "ai_cache"):
        conn.execute("DELETE FROM ai_cache")


def scrub_organisation(conn: sqlite3.Connection, allowed_ids: set[str] | None) -> None:
    if allowed_ids is None or not table_exists(conn, "organisation_relationships"):
        return
    placeholders = ",".join("?" for _ in allowed_ids)
    conn.execute(
        f"DELETE FROM organisation_relationships WHERE officer_id NOT IN ({placeholders})",
        tuple(allowed_ids),
    )
    conn.execute(
        f"""
        UPDATE organisation_relationships
        SET manager_id = NULL
        WHERE manager_id IS NOT NULL
          AND manager_id NOT IN ({placeholders})
        """,
        tuple(allowed_ids),
    )


def scrub_date_range(conn: sqlite3.Connection, from_date: str | None, to_date: str | None) -> None:
    if not from_date and not to_date:
        return
    for table in DEPENDENT_TABLES:
        if not table_exists(conn, table) or not column_exists(conn, table, "upload_date"):
            continue
        if from_date:
            conn.execute(f"DELETE FROM {table} WHERE upload_date < ?", (from_date,))
        if to_date:
            conn.execute(f"DELETE FROM {table} WHERE upload_date > ?", (to_date,))


def scrub_database(path: Path, username: str, from_date: str | None, to_date: str | None) -> None:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        allowed_ids = allowed_user_ids(conn, username)
        scrub_date_range(conn, from_date, to_date)
        scrub_dependent_tables(conn, allowed_ids)
        scrub_organisation(conn, allowed_ids)
        scrub_users(conn, allowed_ids)
        conn.commit()
        conn.execute("VACUUM")
    finally:
        conn.close()


def main() -> None:
    args = parse_args()
    source = Path(args.source).resolve()
    if source.suffix.lower() not in {".db", ".sqlite", ".sqlite3"}:
        raise SystemExit("manual_import.py currently expects a SQLite .db/.sqlite file.")
    if not source.exists():
        raise SystemExit(f"Source file does not exist: {source}")

    from_date = validate_date(args.from_date)
    to_date = validate_date(args.to_date)
    output = Path(args.output).resolve() if args.output else db_path()
    output.parent.mkdir(parents=True, exist_ok=True)

    if output.exists():
        backup = output.with_suffix(f".backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db")
        shutil.copy2(output, backup)
        print(f"Backed up existing local DB to {backup}")

    shutil.copy2(source, output)
    init_db(output)
    scrub_database(output, args.username, from_date, to_date)
    print(f"Imported and scrubbed local database for {args.username}: {output}")


if __name__ == "__main__":
    main()
