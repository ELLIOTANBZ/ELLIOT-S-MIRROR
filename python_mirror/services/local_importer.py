#  imports CSV/XLSX into SQLite.
## read file, find columns, filter date range, delete old rows, insert new rows

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd
import re

from db import connect, dumps
from repositories import utc_now
from services.local_config import mapped_columns
from services.ai_client import ai_is_configured
from services.competency_scoring import (
    score_interactions_for_officer,
    score_projects_for_officer,
)

## FALLBACK: If config/column_map.local.json does not exist, try these common names.
DATE_COLUMNS = ("upload_date", "uploadDate", "date", "Date", "Upload Date", "Survey Date")
OFFICER_COLUMNS = ("officer_id", "officerId", "username", "Username", "Officer ID", "OfficerId", "User", "Name")
OFFICER_ROLE_COLUMNS = ("officer_role", "Officer Role", "role", "Role")
MANAGER_COLUMNS = ("manager_id", "Manager ID", "reporting_officer", "Reporting Officer", "Reports To", "Manager")
TEAM_COLUMNS = ("team_name", "Team Name", "team", "Team")
TRAINED_SCHEMES_COLUMNS = ("trained_schemes", "Trained Schemes", "Schemes", "Trained In")
CURRENT_ROLE_COLUMNS = ("current_role", "Current Role")
TARGET_ROLE_COLUMNS = ("target_role", "Target Role")
RESPONSIBILITIES_COLUMNS = ("responsibilities", "Key Responsibilities", "Current Responsibilities")
TARGET_RESPONSIBILITIES_COLUMNS = ("target_responsibilities", "Target Responsibilities", "Next Role Responsibilities")
SCORE_COLUMNS = ("total_score", "Total Score", "score", "Score", "Audit Score", "Percentage")
RATING_COLUMNS = ("rating", "Rating", "ESS Rating", "Survey Rating", "Customer Rating")
FEEDBACK_COLUMNS = ("feedback", "Feedback", "verbatim", "Verbatim", "Comment", "Comments")
ESS_VALID_COLUMNS = ("ess_valid", "ESS Valid", "Valid", "Valid ESS", "Is Valid")
QUERY_COLUMNS = ("member_query", "Member Query", "query", "Query")
RESPONSE_COLUMNS = ("officer_response", "Officer Response", "response", "Response", "Reply", "Officer Reply")
CASE_COLUMNS = ("case_id", "caseId", "Case ID", "CaseId")
TRAINING_TITLE_COLUMNS = ("title", "Title", "training_name", "Training Name", "Course Name", "Course")
TRAINING_PROVIDER_COLUMNS = ("provider", "Provider", "Training Provider", "Course Provider")
TRAINING_TYPE_COLUMNS = ("training_type", "Training Type", "Mandatory/Optional", "Mandatory Optional", "Type")
TRAINING_DESCRIPTION_COLUMNS = ("description", "Description", "Course Description", "Summary")
TRAINING_STATUS_COLUMNS = ("status", "Status", "Training Status")
TRAINING_ASSIGNED_DATE_COLUMNS = ("assigned_date", "Assigned Date", "Start Date", "Date Assigned")
TRAINING_COMPLETED_DATE_COLUMNS = ("completed_date", "Completed Date", "Completion Date", "Date Completed")
TRAINING_COMPETENCY_GAP_COLUMNS = ("competency_gap", "Competency Gap", "Gap Addressed", "Competency Addressed")
PROJECT_NAME_COLUMNS = ("project_name", "Project Name", "Project", "Project Title")
PROJECT_LEAD_COLUMNS = ("project_leads", "Project Leads", "Project Lead", "Lead")
PROJECT_REQUIREMENTS_COLUMNS = ("requirements_text", "Requirements", "Required Work", "Success Criteria")
PROJECT_EVIDENCE_COLUMNS = ("evidence_text", "Evidence", "What Was Done", "Work Done")
PROJECT_COMMENTS_COLUMNS = ("supervisor_comments", "Project Lead Comments", "Comments", "Remarks")
READINESS_ROLE_COLUMNS = ("readiness_role", "Readiness Role", "Settings Role", "Weight Role")
CORE_WEIGHT_COLUMNS = ("core_weight", "Core Weight", "Core Competency Weight")
FUNCTIONAL_WEIGHT_COLUMNS = ("functional_weight", "Functional Weight", "Functional Competency Weight")
CORRESPONDENCE_WEIGHT_COLUMNS = ("correspondence_weight", "Correspondence Weight", "Correspondence Competency Weight")
THRESHOLD_STAGE_COLUMNS = ("threshold_stage", "Threshold Stage", "Readiness Stage", "Stage")
THRESHOLD_METRIC_COLUMNS = ("threshold_metric", "Threshold Metric", "Metric")
THRESHOLD_DISPLAY_COLUMNS = ("threshold_display_name", "Threshold Display Name", "Requirement Name")
THRESHOLD_MINIMUM_COLUMNS = ("threshold_minimum_value", "Threshold Minimum Value", "Minimum Value", "Minimum")
THRESHOLD_UNIT_COLUMNS = ("threshold_unit", "Threshold Unit", "Unit")
THRESHOLD_SEQUENCE_COLUMNS = ("threshold_sequence", "Threshold Sequence", "Sequence", "Order")
SOURCE_COMPETENCY_COLUMNS = ("source_competency", "Source Competency", "Competency Name")
SOURCE_ROLE_COLUMNS = ("source_role", "Source Role", "Competency Source Role")
SOURCE_AUDIT_WEIGHT_COLUMNS = ("source_audit_weight", "Source Audit Weight", "Audit Source Weight")
SOURCE_SCORECARD_WEIGHT_COLUMNS = ("source_scorecard_weight", "Source Scorecard Weight", "Scorecard Source Weight")
SOURCE_INTERACTION_WEIGHT_COLUMNS = ("source_interaction_weight", "Source Interaction Weight", "Interaction Source Weight")
SOURCE_PROJECT_WEIGHT_COLUMNS = ("source_project_weight", "Source Project Weight", "Project Source Weight")

SCORECARD_CODE_PATTERN = re.compile(r"^[A-Z]+\d+$")
SCORECARD_HEADER_PATTERN = re.compile(r"^(?P<name>.+?)\s*\((?P<weight>-?\d+(?:\.\d+)?)%\)\s*$")


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


## how old duplicate rows are deleted, before inserting new rows (overwritten, not keep creating duplicate versions)
def delete_existing(conn, table: str, officer_ids: set[str]) -> None:
    if not officer_ids:
        return
    placeholders = ",".join("?" for _ in officer_ids)           ## officer_ids = {"cso001", "cso002", "cso003"} --> placeholders = "?,?,?"
    conn.execute(f"DELETE FROM {table} WHERE officer_id IN ({placeholders})", list(officer_ids))
    ## DELETE FROM ess_records WHERE officer_id IN (?,?,?)


## returns officer id from row of frame
## If uploaded file has an officer column, use row value. Otherwise use the officer typed in the form.
def get_officer_id(row, officer_col, lookup: dict[str, str] | None = None):
    raw_officer_id = row[officer_col]
    officer_id = str(raw_officer_id).strip()          ## convert to string and remove spaces
    if lookup:
        return lookup.get(officer_id.lower(), officer_id)
    return officer_id


## uses get_officer_id to return a list of all officers in the frame
def collect_officer_ids(frame, officer_col, lookup: dict[str, str] | None = None):
    officer_ids = set()

    for _, row in frame.iterrows():
        officer_id = get_officer_id(row, officer_col, lookup)
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
## lookup = { "tl001": "tl001", "sarah.tan": "tl001", "sarah tan wei lin": "tl001", } so that can all link back to officer_id

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


def clean_boolean(value: Any, default: bool = True) -> bool:
    text = str(value or "").strip().lower()
    if not text:
        return default
    if text in {"1", "yes", "y", "true", "valid"}:
        return True
    if text in {"0", "no", "n", "false", "invalid"}:
        return False
    return default


def clean_role(value: Any) -> str | None:
    role = str(value or "").strip()
    role_lookup = {
        "cse": "CSE",
        "cso": "CSE",
        "tl": "TL",
        "team lead": "TL",
        "team leader": "TL",
        "supervisor": "CSM",
        "csm": "CSM",
        "ah": "AH",
    }
    return role_lookup.get(role.lower())


def split_list_text(value: Any) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    return [
        item.strip()
        for item in text.replace("|", ";").split(";")
        if item.strip()
    ]


## HELPERS FOR import_scorecard ##

## find scorecard columns (P1, P2, ...)
def scorecard_code_columns(frame: pd.DataFrame) -> list[str]:
    return [ column for column in frame.columns if SCORECARD_CODE_PATTERN.match(str(column).strip()) ]      ## frame.columns = ["Name", "Date", "P1", "P2"]

## split "ROSE" and "(10%)"
def parse_scorecard_criteria_header(value: Any) -> tuple[str, float] | None:
    text = str(value or "").strip()
    match = SCORECARD_HEADER_PATTERN.match(text)

    if not match:
        return None
    return match.group("name").strip(), float(match.group("weight"))




## INSERTING NEW ROWS (import_audit, import_ess, import_interactions) ##
## id is automatic, no need to insert
## find important columns > loop through uploaded rows > insert rows into correct SQLite table

def import_audit(frame: pd.DataFrame, date_col: str) -> int:
    ## find impt columns
    officer_col = configured_column(frame, "audit", "officer_id", OFFICER_COLUMNS)
    score_col = configured_column(frame, "audit", "total_score", SCORE_COLUMNS)
    lookup = user_lookup()

    officer_ids = collect_officer_ids(frame, officer_col, lookup)

    with connect() as conn:
        count = 0
        for _, row in frame.iterrows():
            officer_id = get_officer_id(row, officer_col, lookup)
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


def import_scorecard(frame: pd.DataFrame, date_col: str) -> dict[str, Any]:
    ## find impt columns
    officer_col = configured_column(frame, "scorecard", "officer_id", OFFICER_COLUMNS)
    code_columns = scorecard_code_columns(frame)        ## ["P1", "P2", "Q1",...]
    lookup = user_lookup()                              ## CSV full name -> user_lookup -> MIRROR officer_id

    if frame.empty:
        return {"imported": 0, "skipped": 0}

    ## find info about each criteria
    header_index = None
    criteria_by_code = {}

    for row_index, row in frame.fillna("").iterrows():
        row_criteria = {}
        for column in code_columns:
            parsed = parse_scorecard_criteria_header(row[column])        ## "ROSE", "15%"
            if parsed:
                criteria_name, weight = parsed
                row_criteria[column] = {            ## criteria_by_code["P1"]: = {"name": "ROSE", "weight": 15}
                    "name": criteria_name,
                    "weight": weight,
                }
        if row_criteria:
            header_index = row_index
            criteria_by_code = row_criteria
            break
    if not criteria_by_code:
        raise ValueError("Scorecard import needs a first row with criteria labels like ROSE (15%).")


    ## find info about each officer's score for each criteria
    data_rows = frame.iloc[header_index + 1:].fillna("")           ## take all rows after the criteria row (actual office data rows)
    officer_ids = collect_officer_ids(data_rows, officer_col, lookup)       ## look at frame, find column that identifies officers ("Name"), lookup converts that to MIRROR's officer_id

    with connect() as conn:
        count = 0
        skipped = 0
        for _, row in data_rows.iterrows():
            officer_id = get_officer_id(row, officer_col, lookup)       ## ## look at row, find column that identifies officers ("Name"), lookup converts that to MIRROR's officer_id
            if not officer_id:
                skipped += 1
                continue
            upload_date = clean_date(row[date_col])

            payload = {}

            for column, criteria in criteria_by_code.items():           ## column = "P1", criteria = {"name": "ROSE", "weight": 15}
                score = clean_number(row[column])                       ## score for that criteria
                if score is None:
                    continue

                payload[criteria["name"]] = {
                    "score": score,
                    "weight": criteria["weight"],
                }
                ## payload["ROSE"]: {"score": 12, "weight": 15}

            if not payload:
                skipped += 1
                continue

            ## audit table has UNIQUE(officer_id, upload_date), if such combo exists, update existing row
            ## excluded is SQL syntax, means "the row we tried to insert"
            ## record_version is default 1, but updating increments it
            conn.execute(
                """
                INSERT INTO scorecard_records (officer_id, upload_date, payload_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(officer_id, upload_date) DO UPDATE SET
                  payload_json = excluded.payload_json,
                  record_version = scorecard_records.record_version + 1,
                  updated_at = excluded.updated_at
                """,
                (officer_id, upload_date, dumps(payload), utc_now()),
            )
            count += 1
    return {"imported": count, "skipped": skipped}



def import_ess(frame: pd.DataFrame, date_col: str) -> int:
    ## find impt columns
    officer_col = configured_column(frame, "ess", "officer_id", OFFICER_COLUMNS)
    rating_col = configured_column(frame, "ess", "rating", RATING_COLUMNS)
    feedback_col = configured_column(frame, "ess", "feedback", FEEDBACK_COLUMNS)
    valid_col = configured_column(frame, "ess", "is_valid", ESS_VALID_COLUMNS)
    lookup = user_lookup()

    ## which officers are in the file? using officer_col
    officer_ids = collect_officer_ids(frame, officer_col, lookup)

    with connect() as conn:
        count = 0
        for _, row in frame.iterrows():
            officer_id = get_officer_id(row, officer_col, lookup)
            if not officer_id:
                continue
            upload_date = clean_date(row[date_col])
            total_score = clean_number(row[rating_col]) if rating_col else None
            is_valid = clean_boolean(row[valid_col]) if valid_col else True
            payload = row_payload(row, {date_col, officer_col or "", rating_col or "", feedback_col or "", valid_col or ""})
            conn.execute(
                """
                INSERT INTO ess_records (officer_id, upload_date, rating, feedback, is_valid, payload_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    officer_id,
                    upload_date,
                    total_score,      ## use the value in the uploaded to insert into SQL column (know which column from uploaded using configured_column)
                    str(row[feedback_col]) if feedback_col else "",
                    1 if is_valid else 0,
                    dumps(payload),
                    utc_now(),
                ),
            )
            count += 1
    return count


def import_interactions(frame: pd.DataFrame, date_col: str) -> dict[str, Any]:
    officer_col = configured_column(frame, "interactions", "officer_id", OFFICER_COLUMNS)
    case_col = configured_column(frame, "interactions", "case_id", CASE_COLUMNS)
    query_col = configured_column(frame, "interactions", "member_query", QUERY_COLUMNS)
    response_col = configured_column(frame, "interactions", "officer_response", RESPONSE_COLUMNS)
    lookup = user_lookup()
    officer_ids = collect_officer_ids(frame, officer_col, lookup)
    imported_officer_ids = set()

    with connect() as conn:
        if officer_ids:
            placeholders = ",".join("?" for _ in officer_ids)
            conn.execute(
                f"""
                DELETE FROM competency_evidence_scores
                WHERE officer_id IN ({placeholders})
                  AND source_type = 'interaction'
                """,
                list(officer_ids),
            )
        count = 0
        for _, row in frame.iterrows():
            officer_id = get_officer_id(row, officer_col, lookup)
            if not officer_id:
                continue
            imported_officer_ids.add(officer_id)
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

    ai_scored_officers = 0
    ai_failed_officers = 0
    if ai_is_configured():
        for officer_id in imported_officer_ids:
            try:
                score_interactions_for_officer(officer_id)
                ai_scored_officers += 1
            except Exception:
                ai_failed_officers += 1

    return {
        "imported": count,
        "ai_scored_officers": ai_scored_officers,
        "ai_failed_officers": ai_failed_officers,
        "ai_skipped": bool(imported_officer_ids) and not ai_is_configured(),
    }


def import_training(frame: pd.DataFrame) -> dict[str, Any]:
    officer_col = configured_column(frame, "training", "officer_id", OFFICER_COLUMNS)
    title_col = configured_column(frame, "training", "title", TRAINING_TITLE_COLUMNS)
    provider_col = configured_column(frame, "training", "provider", TRAINING_PROVIDER_COLUMNS)
    type_col = configured_column(frame, "training", "training_type", TRAINING_TYPE_COLUMNS)
    description_col = configured_column(frame, "training", "description", TRAINING_DESCRIPTION_COLUMNS)
    status_col = configured_column(frame, "training", "status", TRAINING_STATUS_COLUMNS)
    assigned_date_col = configured_column(frame, "training", "assigned_date", TRAINING_ASSIGNED_DATE_COLUMNS)
    completed_date_col = configured_column(frame, "training", "completed_date", TRAINING_COMPLETED_DATE_COLUMNS)
    competency_gap_col = configured_column(frame, "training", "competency_gap", TRAINING_COMPETENCY_GAP_COLUMNS)

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
        description = str(row[description_col]).strip() if description_col else ""
        competency_gap = str(row[competency_gap_col]).strip() if competency_gap_col else ""
        training_type = clean_training_type(row[type_col] if type_col else "")

        rows_to_insert.append(
            (
                officer_id,
                title,
                provider or "CPF Board",
                training_type,
                description,
                "",
                status,
                assigned_date,
                completed_date,
                competency_gap,
                "",
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
               status, assigned_date, completed_date, competency_gap, notes, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows_to_insert,
        )

    return {
        "imported": len(rows_to_insert),
        "skipped": skipped,
        "officers": len(officer_ids),
    }


def has_profile_columns(frame: pd.DataFrame) -> bool:
    profile_fields = (
        TEAM_COLUMNS
        + TRAINED_SCHEMES_COLUMNS
        + CURRENT_ROLE_COLUMNS
        + TARGET_ROLE_COLUMNS
        + RESPONSIBILITIES_COLUMNS
        + TARGET_RESPONSIBILITIES_COLUMNS
        + MANAGER_COLUMNS
    )
    return (
        configured_column(frame, "profile", "officer_id", OFFICER_COLUMNS) is not None
        and any(find_column(frame, (column,)) is not None for column in profile_fields)
    )


def import_profiles(frame: pd.DataFrame) -> dict[str, Any]:
    officer_col = configured_column(frame, "profile", "officer_id", OFFICER_COLUMNS)
    role_col = configured_column(frame, "profile", "officer_role", OFFICER_ROLE_COLUMNS)
    manager_col = configured_column(frame, "profile", "manager_id", MANAGER_COLUMNS)
    team_col = configured_column(frame, "profile", "team_name", TEAM_COLUMNS)
    schemes_col = configured_column(frame, "profile", "trained_schemes", TRAINED_SCHEMES_COLUMNS)
    current_role_col = configured_column(frame, "profile", "current_role", CURRENT_ROLE_COLUMNS)
    target_role_col = configured_column(frame, "profile", "target_role", TARGET_ROLE_COLUMNS)
    responsibilities_col = configured_column(frame, "profile", "responsibilities", RESPONSIBILITIES_COLUMNS)
    target_responsibilities_col = configured_column(frame, "profile", "target_responsibilities", TARGET_RESPONSIBILITIES_COLUMNS)

    if not officer_col:
        raise ValueError("Profile import needs an officer column.")

    lookup = user_lookup()
    profile_rows = []
    org_rows = []
    user_role_rows = []
    skipped = 0

    for _, row in frame.fillna("").iterrows():
        officer_id = resolve_uploaded_officer_id(row[officer_col], lookup)
        if not officer_id:
            skipped += 1
            continue

        current_role = str(row[current_role_col]).strip() if current_role_col else ""
        if not current_role and role_col:
            current_role = clean_role(row[role_col]) or ""
        user_role = clean_role(row[role_col]) if role_col else ""
        if user_role:
            user_role_rows.append((user_role, officer_id))
        target_role = str(row[target_role_col]).strip() if target_role_col else ""
        responsibilities = split_list_text(row[responsibilities_col]) if responsibilities_col else []
        target_responsibilities = split_list_text(row[target_responsibilities_col]) if target_responsibilities_col else []

        if any([current_role, target_role, responsibilities, target_responsibilities]):
            profile_rows.append(
                (
                    officer_id,
                    current_role,
                    target_role,
                    dumps(responsibilities),
                    dumps(target_responsibilities),
                )
            )

        manager_id = resolve_uploaded_officer_id(row[manager_col], lookup) if manager_col and str(row[manager_col]).strip() else None
        team_name = str(row[team_col]).strip() if team_col else ""
        trained_schemes = str(row[schemes_col]).strip() if schemes_col else ""
        if manager_id or team_name or trained_schemes:
            org_rows.append((officer_id, manager_id, team_name, trained_schemes))

    with connect() as conn:
        conn.executemany(
            """
            UPDATE users
            SET role = ?, record_version = record_version + 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND role != 'Admin'
            """,
            user_role_rows,
        )
        for row in profile_rows:
            conn.execute(
                """
                INSERT INTO career_profiles
                  (officer_id, current_role, target_role, responsibilities_json, target_responsibilities_json, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(officer_id) DO UPDATE SET
                  current_role = COALESCE(NULLIF(excluded.current_role, ''), career_profiles.current_role),
                  target_role = COALESCE(NULLIF(excluded.target_role, ''), career_profiles.target_role),
                  responsibilities_json = CASE
                    WHEN excluded.responsibilities_json != '[]' THEN excluded.responsibilities_json
                    ELSE career_profiles.responsibilities_json
                  END,
                  target_responsibilities_json = CASE
                    WHEN excluded.target_responsibilities_json != '[]' THEN excluded.target_responsibilities_json
                    ELSE career_profiles.target_responsibilities_json
                  END,
                  updated_at = CURRENT_TIMESTAMP
                """,
                row,
            )

        for row in org_rows:
            conn.execute(
                """
                INSERT INTO organisation_relationships
                  (officer_id, manager_id, team_name, trained_schemes, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(officer_id) DO UPDATE SET
                  manager_id = COALESCE(excluded.manager_id, organisation_relationships.manager_id),
                  team_name = COALESCE(NULLIF(excluded.team_name, ''), organisation_relationships.team_name),
                  trained_schemes = COALESCE(NULLIF(excluded.trained_schemes, ''), organisation_relationships.trained_schemes),
                  updated_at = CURRENT_TIMESTAMP
                """,
                row,
            )

    return {
        "imported": len(profile_rows) + len(org_rows) + len(user_role_rows),
        "skipped": skipped,
    }


def has_training_columns(frame: pd.DataFrame) -> bool:
    return (
        configured_column(frame, "training", "officer_id", OFFICER_COLUMNS) is not None
        and configured_column(frame, "training", "title", TRAINING_TITLE_COLUMNS) is not None
    )


def has_audit_columns(frame: pd.DataFrame) -> bool:
    return (
        configured_column(frame, "audit", "officer_id", OFFICER_COLUMNS) is not None
        and configured_column(frame, "audit", "upload_date", DATE_COLUMNS) is not None
        and configured_column(frame, "audit", "total_score", SCORE_COLUMNS) is not None
    )

def has_scorecard_columns(frame: pd.DataFrame) -> bool:
    return (
        configured_column(frame, "scorecard", "officer_id", OFFICER_COLUMNS) is not None
        and configured_column(frame, "scorecard", "upload_date", DATE_COLUMNS) is not None
        and bool(scorecard_code_columns(frame))
    )

def has_ess_columns(frame: pd.DataFrame) -> bool:
    return (
        configured_column(frame, "ess", "officer_id", OFFICER_COLUMNS) is not None
        and configured_column(frame, "ess", "upload_date", DATE_COLUMNS) is not None
        and configured_column(frame, "ess", "rating", RATING_COLUMNS) is not None
    )


def has_interaction_columns(frame: pd.DataFrame) -> bool:
    return (
        configured_column(frame, "interactions", "officer_id", OFFICER_COLUMNS) is not None
        and configured_column(frame, "interactions", "upload_date", DATE_COLUMNS) is not None
        and configured_column(frame, "interactions", "case_id", CASE_COLUMNS) is not None
    )


def has_project_columns(frame: pd.DataFrame) -> bool:
    return (
        configured_column(frame, "projects", "officer_id", OFFICER_COLUMNS) is not None
        and configured_column(frame, "projects", "project_name", PROJECT_NAME_COLUMNS) is not None
        and configured_column(frame, "projects", "requirements_text", PROJECT_REQUIREMENTS_COLUMNS) is not None
    )


def import_projects(frame: pd.DataFrame) -> dict[str, Any]:
    officer_col = configured_column(frame, "projects", "officer_id", OFFICER_COLUMNS)
    name_col = configured_column(frame, "projects", "project_name", PROJECT_NAME_COLUMNS)
    lead_col = configured_column(frame, "projects", "project_leads", PROJECT_LEAD_COLUMNS)
    requirements_col = configured_column(frame, "projects", "requirements_text", PROJECT_REQUIREMENTS_COLUMNS)
    evidence_col = configured_column(frame, "projects", "evidence_text", PROJECT_EVIDENCE_COLUMNS)
    comments_col = configured_column(frame, "projects", "supervisor_comments", PROJECT_COMMENTS_COLUMNS)

    if not officer_col:
        raise ValueError("Project import needs an officer column.")
    if not name_col:
        raise ValueError("Project import needs a project name column.")
    if not requirements_col:
        raise ValueError("Project import needs a requirements/success criteria column.")

    lookup = user_lookup()
    rows_to_insert = []
    officer_ids = set()
    skipped = 0

    for _, row in frame.fillna("").iterrows():
        officer_id = resolve_uploaded_officer_id(row[officer_col], lookup)
        project_name = str(row[name_col]).strip()
        requirements = str(row[requirements_col]).strip()
        if not officer_id or not project_name or not requirements:
            skipped += 1
            continue
        officer_ids.add(officer_id)
        project_leads = []
        if lead_col:
            for item in split_list_text(row[lead_col]):
                project_leads.append(resolve_uploaded_officer_id(item, lookup))

        rows_to_insert.append(
            (
                officer_id,
                project_name,
                ";".join(item for item in project_leads if item),
                requirements,
                str(row[evidence_col]).strip() if evidence_col else "",
                str(row[comments_col]).strip() if comments_col else "",
            )
        )

    with connect() as conn:
        for (
            officer_id,
            project_name,
            project_leads,
            requirements,
            evidence_text,
            supervisor_comments,
        ) in rows_to_insert:
            existing = conn.execute(
                """
                SELECT id
                FROM project_records
                WHERE officer_id = ? AND project_name = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (officer_id, project_name),
            ).fetchone()

            if existing:
                conn.execute(
                    """
                    DELETE FROM competency_evidence_scores
                    WHERE source_type = 'project'
                      AND source_record_id = ?
                    """,
                    (existing["id"],),
                )
                conn.execute(
                    """
                    UPDATE project_records
                    SET project_leads = ?,
                        requirements_text = ?,
                        evidence_text = ?,
                        supervisor_comments = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (
                        project_leads,
                        requirements,
                        evidence_text,
                        supervisor_comments,
                        existing["id"],
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO project_records
                      (officer_id, project_name, project_leads, requirements_text,
                       evidence_text, supervisor_comments, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    """,
                    (
                        officer_id,
                        project_name,
                        project_leads,
                        requirements,
                        evidence_text,
                        supervisor_comments,
                    ),
                )

    ai_scored_officers = 0
    ai_failed_officers = 0
    if ai_is_configured():
        for officer_id in officer_ids:
            try:
                score_projects_for_officer(officer_id)
                ai_scored_officers += 1
            except Exception:
                ai_failed_officers += 1

    return {
        "imported": len(rows_to_insert),
        "skipped": skipped,
        "officers": len(officer_ids),
        "ai_scored_officers": ai_scored_officers,
        "ai_failed_officers": ai_failed_officers,
        "ai_skipped": bool(officer_ids) and not ai_is_configured(),
    }


def has_readiness_settings_columns(frame: pd.DataFrame) -> bool:
    weight_columns = (
        CORE_WEIGHT_COLUMNS
        + FUNCTIONAL_WEIGHT_COLUMNS
        + CORRESPONDENCE_WEIGHT_COLUMNS
    )
    return (
        configured_column(frame, "readiness_settings", "role", READINESS_ROLE_COLUMNS) is not None
        and any(find_column(frame, (column,)) is not None for column in weight_columns)
    )


def has_readiness_threshold_columns(frame: pd.DataFrame) -> bool:
    return (
        configured_column(frame, "readiness_thresholds", "stage", THRESHOLD_STAGE_COLUMNS) is not None
        and configured_column(frame, "readiness_thresholds", "metric", THRESHOLD_METRIC_COLUMNS) is not None
        and configured_column(frame, "readiness_thresholds", "minimum_value", THRESHOLD_MINIMUM_COLUMNS) is not None
    )


def has_competency_source_weight_columns(frame: pd.DataFrame) -> bool:
    return (
        configured_column(frame, "competency_source_weights", "role", SOURCE_ROLE_COLUMNS) is not None
        and configured_column(frame, "competency_source_weights", "competency_name", SOURCE_COMPETENCY_COLUMNS) is not None
        and configured_column(frame, "competency_source_weights", "audit_weight", SOURCE_AUDIT_WEIGHT_COLUMNS) is not None
        and configured_column(frame, "competency_source_weights", "scorecard_weight", SOURCE_SCORECARD_WEIGHT_COLUMNS) is not None
        and configured_column(frame, "competency_source_weights", "interaction_weight", SOURCE_INTERACTION_WEIGHT_COLUMNS) is not None
        and configured_column(frame, "competency_source_weights", "project_weight", SOURCE_PROJECT_WEIGHT_COLUMNS) is not None
    )


def import_readiness_settings(frame: pd.DataFrame) -> dict[str, Any]:
    role_col = configured_column(frame, "readiness_settings", "role", READINESS_ROLE_COLUMNS)
    core_col = configured_column(frame, "readiness_settings", "core_weight", CORE_WEIGHT_COLUMNS)
    functional_col = configured_column(frame, "readiness_settings", "functional_weight", FUNCTIONAL_WEIGHT_COLUMNS)
    correspondence_col = configured_column(frame, "readiness_settings", "correspondence_weight", CORRESPONDENCE_WEIGHT_COLUMNS)

    required_columns = [
        role_col,
        core_col,
        functional_col,
        correspondence_col,
    ]
    if any(column is None for column in required_columns):
        raise ValueError("Readiness settings import needs role, core, functional, and correspondence weight columns.")

    settings_by_role = {}
    skipped = 0
    for _, row in frame.fillna("").iterrows():
        role = clean_role(row[role_col])
        if not role:
            continue
        weights = {
            "core_weight": clean_number(row[core_col]),
            "functional_weight": clean_number(row[functional_col]),
            "correspondence_weight": clean_number(row[correspondence_col]),
        }
        if any(value is None for value in weights.values()):
            skipped += 1
            continue
        total_weight = sum(weights.values())
        if abs(total_weight - 1) > 0.001:
            raise ValueError(f"Readiness weights for {role} must add up to 1.00.")
        settings_by_role[role] = weights

    with connect() as conn:
        for role, weights in settings_by_role.items():
            conn.execute(
                """
                INSERT INTO readiness_settings
                  (role, core_weight, functional_weight, correspondence_weight, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(role) DO UPDATE SET
                  core_weight = excluded.core_weight,
                  functional_weight = excluded.functional_weight,
                  correspondence_weight = excluded.correspondence_weight,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    role,
                    weights["core_weight"],
                    weights["functional_weight"],
                    weights["correspondence_weight"],
                ),
            )

    return {"imported": len(settings_by_role), "skipped": skipped}


def import_readiness_thresholds(frame: pd.DataFrame) -> dict[str, Any]:
    stage_col = configured_column(frame, "readiness_thresholds", "stage", THRESHOLD_STAGE_COLUMNS)
    metric_col = configured_column(frame, "readiness_thresholds", "metric", THRESHOLD_METRIC_COLUMNS)
    display_col = configured_column(frame, "readiness_thresholds", "display_name", THRESHOLD_DISPLAY_COLUMNS)
    minimum_col = configured_column(frame, "readiness_thresholds", "minimum_value", THRESHOLD_MINIMUM_COLUMNS)
    unit_col = configured_column(frame, "readiness_thresholds", "unit", THRESHOLD_UNIT_COLUMNS)
    sequence_col = configured_column(frame, "readiness_thresholds", "sequence", THRESHOLD_SEQUENCE_COLUMNS)

    thresholds = {}
    skipped = 0
    for _, row in frame.fillna("").iterrows():
        stage = str(row[stage_col]).strip()
        metric = str(row[metric_col]).strip()
        minimum_value = clean_number(row[minimum_col])
        if not stage or not metric or minimum_value is None:
            skipped += 1
            continue
        display_name = str(row[display_col]).strip() if display_col else metric.replace("_", " ").title()
        unit = str(row[unit_col]).strip() if unit_col and str(row[unit_col]).strip() else "score"
        sequence_value = clean_number(row[sequence_col]) if sequence_col else None
        sequence = int(sequence_value) if sequence_value is not None else 1
        thresholds[(stage, metric)] = (stage, metric, display_name, minimum_value, unit, sequence)

    with connect() as conn:
        for threshold in thresholds.values():
            conn.execute(
                """
                INSERT INTO readiness_thresholds
                  (stage, metric, display_name, minimum_value, unit, sequence)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(stage, metric) DO UPDATE SET
                  display_name = excluded.display_name,
                  minimum_value = excluded.minimum_value,
                  unit = excluded.unit,
                  sequence = excluded.sequence
                """,
                threshold,
            )

    return {"imported": len(thresholds), "skipped": skipped}


def import_competency_source_weights(frame: pd.DataFrame) -> dict[str, Any]:
    role_col = configured_column(frame, "competency_source_weights", "role", SOURCE_ROLE_COLUMNS)
    competency_col = configured_column(frame, "competency_source_weights", "competency_name", SOURCE_COMPETENCY_COLUMNS)
    audit_col = configured_column(frame, "competency_source_weights", "audit_weight", SOURCE_AUDIT_WEIGHT_COLUMNS)
    scorecard_col = configured_column(frame, "competency_source_weights", "scorecard_weight", SOURCE_SCORECARD_WEIGHT_COLUMNS)
    interaction_col = configured_column(frame, "competency_source_weights", "interaction_weight", SOURCE_INTERACTION_WEIGHT_COLUMNS)
    project_col = configured_column(frame, "competency_source_weights", "project_weight", SOURCE_PROJECT_WEIGHT_COLUMNS)

    weights_by_role_and_competency = {}
    skipped = 0
    for _, row in frame.fillna("").iterrows():
        role = clean_role(row[role_col])
        competency_name = str(row[competency_col]).strip()
        if not role or not competency_name:
            continue
        weights = {
            "audit_weight": clean_number(row[audit_col]),
            "scorecard_weight": clean_number(row[scorecard_col]),
            "interaction_weight": clean_number(row[interaction_col]),
            "project_weight": clean_number(row[project_col]),
        }
        if any(value is None for value in weights.values()):
            skipped += 1
            continue
        if role == "AH":
            weights = {
                "audit_weight": 0.0,
                "scorecard_weight": 0.0,
                "interaction_weight": 0.0,
                "project_weight": 1.0,
            }
        else:
            total_weight = weights["audit_weight"] + weights["scorecard_weight"] + weights["interaction_weight"]
            if abs(total_weight - 1) > 0.001:
                raise ValueError(f"Audit, scorecard, and interaction source weights for {role} {competency_name} must add up to 1.00.")
            if weights["project_weight"] < 0:
                raise ValueError(f"Project weight for {role} {competency_name} cannot be negative.")
        weights_by_role_and_competency[(role, competency_name)] = weights

    with connect() as conn:
        for (role, competency_name), weights in weights_by_role_and_competency.items():
            conn.execute(
                """
                INSERT INTO competency_source_weights
                  (role, competency_name, audit_weight, scorecard_weight, interaction_weight, project_weight, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(role, competency_name) DO UPDATE SET
                  audit_weight = excluded.audit_weight,
                  scorecard_weight = excluded.scorecard_weight,
                  interaction_weight = excluded.interaction_weight,
                  project_weight = excluded.project_weight,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    role,
                    competency_name,
                    weights["audit_weight"],
                    weights["scorecard_weight"],
                    weights["interaction_weight"],
                    weights["project_weight"],
                ),
            )

    return {"imported": len(weights_by_role_and_competency), "skipped": skipped}


def import_daily_admin_file(frame: pd.DataFrame) -> dict[str, Any]:
    parts = []
    total_imported = 0
    total_skipped = 0
    filled_frame = frame.fillna("")
    lookup = user_lookup()
    officer_col = configured_column(filled_frame, "profile", "officer_id", OFFICER_COLUMNS)
    affected_officer_ids = collect_officer_ids(filled_frame, officer_col, lookup) if officer_col else set()

    if has_profile_columns(frame):
        result = import_profiles(frame)
        parts.append(f"{result['imported']} profile/org")
        total_imported += result["imported"]
        total_skipped += result["skipped"]

    if has_audit_columns(frame):
        date_col = configured_column(frame, "audit", "upload_date", DATE_COLUMNS)
        result_count = import_audit(filled_frame, date_col)
        parts.append(f"{result_count} audit")
        total_imported += result_count

    if has_scorecard_columns(frame):
        date_col = configured_column(frame, "scorecard", "upload_date", DATE_COLUMNS)
        result = import_scorecard(filled_frame, date_col)
        parts.append(f"{result['imported']} scorecard")
        total_imported += result["imported"]
        total_skipped += result["skipped"]

    if has_ess_columns(frame):
        date_col = configured_column(frame, "ess", "upload_date", DATE_COLUMNS)
        result_count = import_ess(filled_frame, date_col)
        parts.append(f"{result_count} ESS")
        total_imported += result_count

    if has_interaction_columns(frame):
        date_col = configured_column(frame, "interactions", "upload_date", DATE_COLUMNS)
        result = import_interactions(filled_frame, date_col)
        parts.append(f"{result['imported']} interaction")
        if result["ai_scored_officers"]:
            parts.append(f"AI-scored interactions for {result['ai_scored_officers']} officer(s)")
        if result["ai_skipped"]:
            parts.append("interaction AI scoring skipped because AI is not configured")
        if result["ai_failed_officers"]:
            parts.append(f"interaction AI scoring failed for {result['ai_failed_officers']} officer(s)")
        total_imported += result["imported"]

    if has_training_columns(frame):
        result = import_training(frame)
        parts.append(f"{result['imported']} training")
        total_imported += result["imported"]
        total_skipped += result["skipped"]

    if has_project_columns(frame):
        result = import_projects(frame)
        parts.append(f"{result['imported']} project")
        if result["ai_scored_officers"]:
            parts.append(f"AI-scored projects for {result['ai_scored_officers']} officer(s)")
        if result["ai_skipped"]:
            parts.append("project AI scoring skipped because AI is not configured")
        if result["ai_failed_officers"]:
            parts.append(f"project AI scoring failed for {result['ai_failed_officers']} officer(s)")
        total_imported += result["imported"]
        total_skipped += result["skipped"]

    if has_readiness_settings_columns(frame):
        result = import_readiness_settings(frame)
        parts.append(f"{result['imported']} readiness setting")
        total_imported += result["imported"]
        total_skipped += result["skipped"]

    if has_readiness_threshold_columns(frame):
        result = import_readiness_thresholds(frame)
        parts.append(f"{result['imported']} readiness threshold")
        total_imported += result["imported"]
        total_skipped += result["skipped"]

    if has_competency_source_weight_columns(frame):
        result = import_competency_source_weights(frame)
        parts.append(f"{result['imported']} competency source weight")
        total_imported += result["imported"]
        total_skipped += result["skipped"]

    if affected_officer_ids and ai_is_configured():
        from services.readiness_data import generate_and_cache_competency_development_summaries

        cached_officers = 0
        failed_officers = 0
        for officer_id in affected_officer_ids:
            try:
                if generate_and_cache_competency_development_summaries(officer_id):
                    cached_officers += 1
            except Exception:
                failed_officers += 1
        if cached_officers:
            parts.append(f"AI-cached readiness summaries for {cached_officers} officer(s)")
        if failed_officers:
            parts.append(f"readiness AI summaries failed for {failed_officers} officer(s)")
    elif affected_officer_ids:
        parts.append("readiness AI summaries skipped because AI is not configured")

    if not parts:
        raise ValueError(
            "The daily admin file needs profile, audit, scorecard, ESS, interactions, training, project evidence, readiness settings, readiness threshold, or competency source weight columns."
        )

    message = "Imported " + ", ".join(parts) + "."
    if total_skipped:
        message += f" Ignored {total_skipped} incomplete or non-applicable rows."
    return {"imported": total_imported, "message": message}


## main entry point
def import_local_file(
    path: Path,
) -> dict[str, Any]:
    frame = read_table(path)
    return import_daily_admin_file(frame)


def import_org_chart_file(path: Path) -> dict[str, Any]:
    frame = read_table(path)
    if not has_profile_columns(frame):
        raise ValueError("Org chart import needs officer_id plus org/profile columns such as Officer Role, Manager ID, or Team Name.")
    result = import_profiles(frame)
    message = f"Imported {result['imported']} org chart/profile rows."
    if result["skipped"]:
        message += f" Skipped {result['skipped']} rows that did not match an existing officer."
    return {"imported": result["imported"], "message": message}
