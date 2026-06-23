## the first place where the app actually talks to SQLite.
## repositories.py = database helper functions for app.py to use
## uses db.py to do MIRROR-specific things

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from werkzeug.security import check_password_hash

from db import connect, dumps, loads, new_id, row_to_dict, rows_to_dicts
## connect()        opens SQLite connection
## dumps()          converts Python dict/list --> JSON string
## loads()          converts JSON string back --> Python object
## new_id()         creates random ID
## row_to_dict()    SQLite row -> Python dict
## rows_to_dicts()  list of SQLite rows -> list of Python dicts

from services.manual_paths import outgoing_changes_dir
## Gets the folder where change JSON files should be saved.


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def find_user_by_username(username: str) -> dict[str, Any] | None:
    with connect() as conn:                 ## open SQLite connection
        row = conn.execute(
            "SELECT * FROM users WHERE username = ?",
            (username.strip().lower(),),
        ).fetchone()
        return row_to_dict(row)


def find_user(user_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        return row_to_dict(row)


def authenticate(username: str, password: str) -> dict[str, Any] | None:
    user = find_user_by_username(username)
    if not user or not check_password_hash(user["password_hash"], password):
        return None
    return {k: user[k] for k in ("id", "username", "name", "role")}


def list_users() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, username, name, role FROM users ORDER BY role, name"
        ).fetchall()
        return rows_to_dicts(rows)


def latest_audit_record(officer_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM audit_records
            WHERE officer_id = ?
            ORDER BY upload_date DESC
            LIMIT 1
            """,
            (officer_id,),
        ).fetchone()
        return row_to_dict(row)


def audit_records_between(officer_id: str, start: str, end: str) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM audit_records
            WHERE officer_id = ? AND upload_date BETWEEN ? AND ?
            ORDER BY upload_date ASC
            """,
            (officer_id, start, end),
        ).fetchall()
        records = rows_to_dicts(rows)
    for record in records:
        record.update(loads(record.get("payload_json"), {}))        ## some fields in payload_json (eg. courtesy, correct information), loads(...) turns that JSON string into a Python dict, update appends those fields into the python dict
    return records


def submit_change(
    *,
    table_name: str,                            ## which table to update
    record_id: str,                             ## which row to update
    operation: str,                             ## UPDATE / CREATE / DELETE
    change_details: dict[str, Any],             ## what field/value changed
    submitted_by: str,                          ## username who submitted
    base_record_version: int | None = None,     ## record version user saw
) -> dict[str, Any]:
    change_id = new_id()        ## creates random id
    submitted_at = utc_now()    ## creates timestamp
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO local_pending_changes
              (id, table_name, record_id, operation, payload_json, base_record_version, submitted_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                change_id,
                table_name,
                record_id,
                operation,
                dumps(change_details),      ## converts the Python dict into JSON string.
                base_record_version,
                submitted_by,
            ),
        )
    return {
        "id": change_id,
        "table_name": table_name,
        "record_id": record_id,
        "operation": operation,
        "payload": change_details,
        "base_record_version": base_record_version,
        "submitted_by": submitted_by,
        "submitted_at": submitted_at,
        "status": "Pending",
    }       ## returned Python dict used to create the JSON file


## writes the change dict to a .json file.
def export_change_file(change: dict[str, Any]) -> str:
    outgoing = outgoing_changes_dir()                                                   ## get folder path
    outgoing.mkdir(parents=True, exist_ok=True)                                         ## create folder if missing
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")                                ## create timestamp like 20260602-103000
    filename = f"change_{change['submitted_by']}_{timestamp}_{change['id']}.json"       ## create filename like change_cso001_20260602-103000_abcd123.json
    path = outgoing / filename                                                          ## combines folder + filename
    path.write_text(json.dumps(change, indent=2, ensure_ascii=True), encoding="utf-8")  ## write json text to file (from python)
    return str(path)                                                                    ## Returns the file path.


## 1. Save the change into local SQLite table local_pending_changes
## 2. Write a JSON file into outgoing_changes folder
def submit_manual_change(
    *,
    table_name: str,
    record_id: str,
    operation: str,
    change_details: dict[str, Any],
    submitted_by: str,
    base_record_version: int | None = None,
) -> dict[str, Any]:
    saved_change = submit_change(               ## returns Python dict used to create the JSON file
        table_name=table_name,
        record_id=record_id,
        operation=operation,
        change_details=change_details,
        submitted_by=submitted_by,
        base_record_version=base_record_version,
    )

    change_file_path = export_change_file(saved_change)    ## Write JSON file and get file path.

    saved_change_with_file_path = saved_change.copy()                   ## copy the dict
    saved_change_with_file_path["file_path"] = change_file_path         ## append "file_path" field into copied dict
    return saved_change_with_file_path                                  ## return file with file path to app.py


## So one change is stored in two places:

## local_pending_changes table
## outgoing_changes/change_....json
