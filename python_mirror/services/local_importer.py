#  imports CSV/XLSX into SQLite.
## read file, find columns, filter date range, delete old rows, insert new rows

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from db import connect, dumps
from repositories import utc_now
from services.local_config import mapped_columns

## FALLBACK: If config/column_map.local.json does not exist, try these common names.
DATE_COLUMNS = ("upload_date", "uploadDate", "date", "Date", "Upload Date", "Survey Date")
OFFICER_COLUMNS = ("officer_id", "officerId", "username", "Username", "Officer ID", "OfficerId", "User")
SCORE_COLUMNS = ("total_score", "Total Score", "score", "Score", "Audit Score", "Percentage")
RATING_COLUMNS = ("rating", "Rating", "ESS Rating", "Survey Rating", "Customer Rating")
FEEDBACK_COLUMNS = ("feedback", "Feedback", "verbatim", "Verbatim", "Comment", "Comments")
QUERY_COLUMNS = ("member_query", "Member Query", "query", "Query")
RESPONSE_COLUMNS = ("officer_response", "Officer Response", "response", "Response", "Reply", "Officer Reply")
CASE_COLUMNS = ("case_id", "caseId", "Case ID", "CaseId")
TRAINING_TITLE_COLUMNS = ("title", "Title", "training_name", "Training Name", "Course Name", "Course")
TRAINING_PROVIDER_COLUMNS = ("provider", "Provider", "Training Provider", "Course Provider")
TRAINING_TYPE_COLUMNS = ("training_type", "Training Type", "Mandatory/Optional", "Mandatory Optional", "Type")
TRAINING_DESCRIPTION_COLUMNS = ("description", "Description", "Course Description", "Summary")
TRAINING_ASSIGNED_BY_COLUMNS = ("assigned_by", "Assigned By", "Training Done By", "Done By")
TRAINING_STATUS_COLUMNS = ("status", "Status", "Training Status")
TRAINING_ASSIGNED_DATE_COLUMNS = ("assigned_date", "Assigned Date", "Start Date", "Date Assigned")
TRAINING_COMPLETED_DATE_COLUMNS = ("completed_date", "Completed Date", "Completion Date", "Date Completed")
TRAINING_NOTES_COLUMNS = ("notes", "Notes", "Remarks", "Comments")


## fallback helper (no confidential column map exists)
## Given an uploaded table (frame), find which column matches one of the possible column names from a FALLBACK (candidates). returns string column name OR None
def find_column(frame: pd.DataFrame, candidates: tuple[str, ...]) -> str | None:
    lower_to_actual = {}

    for column in frame.columns:
        cleaned_column = str(column).strip().lower()
        lower_to_actual[cleaned_column] = column            ## "officer id": "Officer ID", Left side is cleaned lowercase version. Right side is actual original column name. Why keep actual original name? Because pandas needs the real column name to read data.
    for candidate in candidates:
        found = lower_to_actual.get(candidate.lower())      ## get returns None if column name not found
        if found is not None:
            return found
    return None


## main helper to find the ess rating column in the given frame
## returns the uploaded file column name (frame), not the database column name.
## eg. configured_column(frame, "ess", "rating", RATING_COLUMNS), looks at config/column_map.local.json for the uploaded column name
def configured_column(frame: pd.DataFrame, section: str, key: str, fallback: tuple[str, ...]) -> str | None:
    configured = mapped_columns(section).get(key)           ## looks at config/column_map.local.json for the real column name
    if configured and configured != "FILL_IN_LOCALLY":
        if configured in frame.columns:                     ## SHOULD BE LIKE THIS BY DEFAULT (uploaded column name matches config/column_map.local.json)
            return configured
        lower_to_actual = {str(column).strip().lower(): column for column in frame.columns}  ## If not exact match, it tries lowercase match.
        return lower_to_actual.get(str(configured).strip().lower())
    return find_column(frame, fallback)                 ## If no configured column exists, it falls back to generic names:



## uploaded file becomes a pandas DataFrame
def read_table(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path)
    if suffix in {".xlsx", ".xlsm", ".xls"}:
        return pd.read_excel(path)
    raise ValueError("Supported upload files are .csv, .xlsx, .xlsm, and .xls")


def clean_date(value: Any) -> str:
    date = pd.to_datetime(value, errors="coerce")       ## Ask pandas to interpret this value as a date. If it cannot, don't crash immediately; turn it into invalid date value (coerce, becomes NaT)
    if pd.isna(date):
        raise ValueError(f"Invalid upload date: {value}")
    return date.strftime("%Y-%m-%d")        ## return the date in YYYY-MM-DD format (from pandas datetime object)


def clean_optional_date(value: Any) -> str | None:
    if value is None or str(value).strip() == "":
        return None
    return clean_date(value)


## turns 88, 88% into 88.0 or None if blank
def clean_number(value: Any) -> float | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        return float(str(value).replace("%", "").strip())
    except ValueError:
        return None


## stores extra columns into payload_json
def row_payload(row: pd.Series, skip: set[str]) -> dict[str, Any]:
    payload = {}
    for key, value in row.items():
        if key in skip:
            continue
        if pd.isna(value):
            continue
        payload[str(key)] = value.item() if hasattr(value, "item") else value
    return payload


## find the upload_date column, filters rows to selected date range, returns filtered table AND date column name
def filter_frame(frame: pd.DataFrame, section: str, from_date: str | None, to_date: str | None) -> tuple[pd.DataFrame, str]:
    date_col = configured_column(frame, section, "upload_date", DATE_COLUMNS)      ## date column name in frame
    if not date_col:
        raise ValueError(f"Could not find a date column. Expected one of: {', '.join(DATE_COLUMNS)}")
    dates = pd.to_datetime(frame[date_col], errors="coerce")            ## frame[date_col] gets the whole date column from uploaded, returns all panda datetime objects that represents this date but is not text
    output = frame.copy()                                               ## filter the copy instead of modifying original directly.
    if from_date:
        output = output[dates >= pd.to_datetime(from_date)]             ## Keep only rows where uploaded date >= from_date.
        dates = pd.to_datetime(output[date_col], errors="coerce")       ## dates filtered
    if to_date:
        output = output[dates <= pd.to_datetime(to_date)]
    return output.fillna(""), date_col                                  ## fillna: replace blank pandas values with empty string


## how old duplicate rows are deleted, before inserting new rows (overwritten, not keep creating duplicate versions)
def delete_existing(conn, table: str, officer_ids: set[str], from_date: str | None, to_date: str | None) -> None:
    if not officer_ids:
        return
    placeholders = ",".join("?" for _ in officer_ids)           ## officer_ids = {"cso001", "cso002", "cso003"} --> placeholders = "?,?,?"
    params: list[Any] = list(officer_ids)                       ## ["cso001", "cso002", "cso003"]
    where = [f"officer_id IN ({placeholders})"]                 ## officer_id IN (?,?,?)
    if from_date:
        where.append("upload_date >= ?")                        ## officer_id IN (?,?,?), upload_date >= ?
        params.append(from_date)                                ## ["cso001", "cso002", "cso003", "1 Jan 2026"]
    if to_date:
        where.append("upload_date <= ?")                        ## officer_id IN (?,?,?), upload_date >= ?, upload_date <= ?
        params.append(to_date)                                  ## ["cso001", "cso002", "cso003", "1 Jan 2026", "30 Jan 2026"]
    conn.execute(f"DELETE FROM {table} WHERE {' AND '.join(where)}", params)
    ## DELETE FROM ess_records WHERE officer_id IN (?,?,?) AND upload_date >= ? AND upload_date <= ?


## returns officer id from row of frame
## If uploaded file has an officer column, use row value. Otherwise use the officer typed in the form.
def get_officer_id(row, officer_col, default_officer_id):
    if officer_col:
        raw_officer_id = row[officer_col]
    else:
        raw_officer_id = default_officer_id

    return str(raw_officer_id).strip()          ## convert to string and remove spaces


## uses get_officer_id to return a list of all officers in the frame
def collect_officer_ids(frame, officer_col, default_officer_id):
    officer_ids = set()

    for _, row in frame.iterrows():
        officer_id = get_officer_id(row, officer_col, default_officer_id)
        if officer_id:
            officer_ids.add(officer_id)

    return officer_ids


def user_lookup() -> dict[str, str]:
    lookup = {}
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, username, name FROM users WHERE role != 'Admin'"
        ).fetchall()
    for row in rows:
        lookup[str(row["id"]).strip().lower()] = row["id"]
        lookup[str(row["username"]).strip().lower()] = row["id"]
        lookup[str(row["name"]).strip().lower()] = row["id"]
    return lookup


def resolve_uploaded_officer_id(raw_value: Any, lookup: dict[str, str]) -> str | None:
    key = str(raw_value).strip().lower()
    if not key:
        return None
    return lookup.get(key)


def clean_training_status(value: Any, completed_date: str | None) -> str:
    status = str(value or "").strip().lower()
    if status in {"pending", "not started", "not started yet"}:
        return "Pending"
    if status in {"in progress", "ongoing", "started"}:
        return "In Progress"
    if status in {"completed", "complete", "done"}:
        return "Completed"
    return "Completed" if completed_date else "Pending"


def clean_training_type(value: Any) -> str:
    training_type = str(value or "").strip()
    if training_type.lower() in {"mandatory", "compulsory", "required"}:
        return "Mandatory"
    if training_type.lower() in {"optional", "elective"}:
        return "Optional"
    return training_type or "Optional"


## INSERTING NEW ROWS (import_audit, import_ess, import_interactions) ##
## id is automatic, no need to insert
## find important columns > delete existing rows for officer/date range > loop through uploaded rows > insert rows into correct SQLite table

def import_audit(frame: pd.DataFrame, date_col: str, default_officer_id: str | None, from_date: str | None, to_date: str | None) -> int:
    ## find impt columns
    officer_col = configured_column(frame, "audit", "officer_id", OFFICER_COLUMNS)
    score_col = configured_column(frame, "audit", "total_score", SCORE_COLUMNS)

    officer_ids = collect_officer_ids(frame, officer_col, default_officer_id)

    with connect() as conn:
        delete_existing(conn, "audit_records", officer_ids, from_date, to_date)
        count = 0
        for _, row in frame.iterrows():
            officer_id = get_officer_id(row, officer_col, default_officer_id)
            if not officer_id:
                continue
            upload_date = clean_date(row[date_col])
            total_score = clean_number(row[score_col]) if score_col else None
            payload = row_payload(row, {date_col, officer_col or "", score_col or ""})

            ## audit table has UNIQUE(officer_id, upload_date), if such combo exists, update existing row
            ## excluded is SQL syntax, means "the row we tried to insert"
            ## record_version is default 1, but updating increments it
            conn.execute(
                """
                INSERT INTO audit_records (officer_id, upload_date, total_score, payload_json, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(officer_id, upload_date) DO UPDATE SET
                  total_score = excluded.total_score,
                  payload_json = excluded.payload_json,
                  record_version = audit_records.record_version + 1,
                  updated_at = excluded.updated_at
                """,
                (officer_id, upload_date, total_score, dumps(payload), utc_now()),
            )
            count += 1
    return count


def import_ess(frame: pd.DataFrame, date_col: str, default_officer_id: str | None, from_date: str | None, to_date: str | None) -> int:
    ## find impt columns
    officer_col = configured_column(frame, "ess", "officer_id", OFFICER_COLUMNS)
    rating_col = configured_column(frame, "ess", "rating", RATING_COLUMNS)
    feedback_col = configured_column(frame, "ess", "feedback", FEEDBACK_COLUMNS)

    ## which officers are in the file? using officer_col
    officer_ids = collect_officer_ids(frame, officer_col, default_officer_id)

    with connect() as conn:
        delete_existing(conn, "ess_records", officer_ids, from_date, to_date)
        count = 0
        for _, row in frame.iterrows():
            officer_id = get_officer_id(row, officer_col, default_officer_id)
            if not officer_id:
                continue
            upload_date = clean_date(row[date_col])
            total_score = clean_number(row[rating_col]) if rating_col else None
            payload = row_payload(row, {date_col, officer_col or "", rating_col or "", feedback_col or ""})
            conn.execute(
                """
                INSERT INTO ess_records (officer_id, upload_date, rating, feedback, payload_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    officer_id,
                    upload_date,
                    total_score,      ## use the value in the uploaded to insert into SQL column (know which column from uploaded using configured_column)
                    str(row[feedback_col]) if feedback_col else "",
                    dumps(payload),
                    utc_now(),
                ),
            )
            count += 1
    return count


def import_interactions(frame: pd.DataFrame, date_col: str, default_officer_id: str | None, from_date: str | None, to_date: str | None) -> int:
    officer_col = configured_column(frame, "interactions", "officer_id", OFFICER_COLUMNS)
    case_col = configured_column(frame, "interactions", "case_id", CASE_COLUMNS)
    query_col = configured_column(frame, "interactions", "member_query", QUERY_COLUMNS)
    response_col = configured_column(frame, "interactions", "officer_response", RESPONSE_COLUMNS)
    officer_ids = collect_officer_ids(frame, officer_col, default_officer_id)

    with connect() as conn:
        delete_existing(conn, "interactions", officer_ids, from_date, to_date)
        count = 0
        for _, row in frame.iterrows():
            officer_id = get_officer_id(row, officer_col, default_officer_id)
            if not officer_id:
                continue
            upload_date = clean_date(row[date_col])
            payload = row_payload(row, {date_col, officer_col or "", case_col or "", query_col or "", response_col or ""})
            conn.execute(
                """
                INSERT INTO interactions
                  (officer_id, upload_date, case_id, member_query, officer_response, payload_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    officer_id,
                    upload_date,
                    str(row[case_col]) if case_col else "",
                    str(row[query_col]) if query_col else "",
                    str(row[response_col]) if response_col else "",
                    dumps(payload),
                    utc_now(),
                ),
            )
            count += 1
    return count


def import_training(frame: pd.DataFrame) -> dict[str, Any]:
    officer_col = configured_column(frame, "training", "officer_id", OFFICER_COLUMNS)
    title_col = configured_column(frame, "training", "title", TRAINING_TITLE_COLUMNS)
    provider_col = configured_column(frame, "training", "provider", TRAINING_PROVIDER_COLUMNS)
    type_col = configured_column(frame, "training", "training_type", TRAINING_TYPE_COLUMNS)
    description_col = configured_column(frame, "training", "description", TRAINING_DESCRIPTION_COLUMNS)
    assigned_by_col = configured_column(frame, "training", "assigned_by", TRAINING_ASSIGNED_BY_COLUMNS)
    status_col = configured_column(frame, "training", "status", TRAINING_STATUS_COLUMNS)
    assigned_date_col = configured_column(frame, "training", "assigned_date", TRAINING_ASSIGNED_DATE_COLUMNS)
    completed_date_col = configured_column(frame, "training", "completed_date", TRAINING_COMPLETED_DATE_COLUMNS)
    notes_col = configured_column(frame, "training", "notes", TRAINING_NOTES_COLUMNS)

    if not officer_col:
        raise ValueError("Training import needs an officer column, such as username, officer_id, or officer name.")
    if not title_col:
        raise ValueError("Training import needs a course/training title column.")

    lookup = user_lookup()
    rows_to_insert = []
    officer_ids = set()
    skipped = 0

    for _, row in frame.fillna("").iterrows():
        officer_id = resolve_uploaded_officer_id(row[officer_col], lookup)
        title = str(row[title_col]).strip()
        if not officer_id or not title:
            skipped += 1
            continue

        assigned_date = clean_optional_date(row[assigned_date_col]) if assigned_date_col else None
        completed_date = clean_optional_date(row[completed_date_col]) if completed_date_col else None
        status = clean_training_status(row[status_col] if status_col else "", completed_date)
        provider = str(row[provider_col]).strip() if provider_col else "CPF Board"
        assigned_by = str(row[assigned_by_col]).strip() if assigned_by_col else "CPF Board"
        description = str(row[description_col]).strip() if description_col else ""
        notes = str(row[notes_col]).strip() if notes_col else ""
        training_type = clean_training_type(row[type_col] if type_col else "")

        rows_to_insert.append(
            (
                officer_id,
                title,
                provider or "CPF Board",
                training_type,
                description,
                assigned_by or "CPF Board",
                status,
                assigned_date,
                completed_date,
                notes,
                utc_now(),
            )
        )
        officer_ids.add(officer_id)

    with connect() as conn:
        if officer_ids:
            placeholders = ",".join("?" for _ in officer_ids)
            conn.execute(
                f"DELETE FROM training_records WHERE officer_id IN ({placeholders})",
                list(officer_ids),
            )
        conn.executemany(
            """
            INSERT INTO training_records
              (officer_id, title, provider, training_type, description, assigned_by,
               status, assigned_date, completed_date, notes, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows_to_insert,
        )

    return {
        "imported": len(rows_to_insert),
        "skipped": skipped,
        "officers": len(officer_ids),
    }


## main entry point
def import_local_file(
    path: Path,
    *,
    import_type: str,
    default_officer_id: str | None,
    from_date: str | None,
    to_date: str | None,
) -> dict[str, Any]:
    frame = read_table(path)
    if import_type == "training":
        result = import_training(frame)
        message = (
            f"Imported {result['imported']} training rows for "
            f"{result['officers']} officers."
        )
        if result["skipped"]:
            message += f" Skipped {result['skipped']} rows with missing or unmatched officer/title."
        return {"imported": result["imported"], "message": message}

    frame, date_col = filter_frame(frame, import_type, from_date, to_date)          ## new filtered frame (by date)
    if frame.empty:
        return {"imported": 0, "message": "No rows matched the selected date range."}

    if import_type == "audit":
        count = import_audit(frame, date_col, default_officer_id, from_date, to_date)
    elif import_type == "ess":
        count = import_ess(frame, date_col, default_officer_id, from_date, to_date)
    elif import_type == "interactions":
        count = import_interactions(frame, date_col, default_officer_id, from_date, to_date)
    else:
        raise ValueError("Choose audit, ess, interactions, or training.")

    return {"imported": count, "message": f"Imported {count} {import_type} rows into the same local database."}

## Yes, the CSV already has dates inside. But from_date and to_date let the user import only part of the file.
