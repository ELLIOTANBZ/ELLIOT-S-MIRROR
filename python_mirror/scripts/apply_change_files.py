from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from db import init_db, master_db_path
from services.manual_paths import failed_changes_dir, processed_changes_dir

EDITABLE_FIELDS = {
    "audit_records": {"total_score", "payload_json"},
    "ess_records": {"rating", "feedback", "payload_json"},
    "interactions": {"case_id", "member_query", "officer_response", "payload_json"},
    "competency_overrides": {"level", "justification"},
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Apply manually uploaded MIRROR change JSON files to master SQLite.")
    parser.add_argument("--changes-dir", required=True, help="Folder containing user change_*.json files.")
    parser.add_argument("--master-db", help="Master SQLite path. Defaults to MIRROR_MASTER_DB_PATH.")
    return parser.parse_args()


def timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def move_file(path: Path, target_dir: Path, suffix: str = "") -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{path.stem}{suffix}{path.suffix}"
    if target.exists():
        target = target_dir / f"{path.stem}_{timestamp()}{suffix}{path.suffix}"
    shutil.move(str(path), target)
    return target


def fail_file(path: Path, reason: str) -> None:
    target = move_file(path, failed_changes_dir())
    target.with_suffix(target.suffix + ".error.txt").write_text(reason, encoding="utf-8")


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone() is not None


def apply_change(conn: sqlite3.Connection, change: dict) -> tuple[bool, str]:
    table = change.get("table_name")
    record_id = str(change.get("record_id") or "")
    operation = change.get("operation")
    payload = change.get("payload") or {}
    base_version = int(change.get("base_record_version") or 0)

    if operation != "UPDATE":
        return False, f"Unsupported operation for manual apply: {operation}"
    if table not in EDITABLE_FIELDS:
        return False, f"Table is not editable: {table}"
    if not table_exists(conn, table):
        return False, f"Table does not exist: {table}"

    row = conn.execute(f"SELECT id, record_version FROM {table} WHERE id = ?", (record_id,)).fetchone()
    if not row:
        return False, f"Record not found: {table}/{record_id}"
    if base_version and int(row["record_version"]) != base_version:
        return False, f"Version conflict. Current={row['record_version']} Base={base_version}"

    field_name = payload.get("field_name")
    new_value = payload.get("new_value")
    if field_name not in EDITABLE_FIELDS[table]:
        return False, f"Field is not editable: {field_name}"

    conn.execute(
        f"""
        UPDATE {table}
        SET {field_name} = ?,
            record_version = record_version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (new_value, record_id),
    )
    return True, "Applied"


def main() -> None:
    args = parse_args()
    changes_dir = Path(args.changes_dir).resolve()
    db_path = Path(args.master_db).resolve() if args.master_db else master_db_path()
    init_db(db_path)

    files = sorted(changes_dir.glob("change_*.json"))
    if not files:
        print(f"No change files found in {changes_dir}")
        return

    applied = 0
    failed = 0
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        for path in files:
            try:
                change = json.loads(path.read_text(encoding="utf-8"))
                ok, message = apply_change(conn, change)
                if not ok:
                    conn.rollback()
                    fail_file(path, message)
                    failed += 1
                    print(f"FAILED {path.name}: {message}")
                    continue
                conn.commit()
                move_file(path, processed_changes_dir())
                applied += 1
                print(f"APPLIED {path.name}")
            except Exception as exc:
                conn.rollback()
                fail_file(path, str(exc))
                failed += 1
                print(f"FAILED {path.name}: {exc}")

    print(f"Done. Applied={applied} Failed={failed}")


if __name__ == "__main__":
    main()

