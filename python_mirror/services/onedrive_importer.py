import glob
import os
from pathlib import Path

import pandas as pd

from services.local_importer import (
    import_audit,
    import_ess,
    import_interactions,
    import_org_chart_file,
    import_projects,
    import_scorecard,
    import_settings_file,
    import_training,
)


# ── CONFIG ──────────────────────────────────────────────────────────────────
username = os.getlogin()
base_path = Path(rf"C:\Users\{username}\SG Govt M365\CPFB-CCC-MST-Correspondence Unit - Documents\CCU SUP\MIRROR")


class OneDriveImportError(RuntimeError):
    pass

def required_file(filename: str) -> Path:
    path = base_path / filename
    if not path.exists():
        raise FileNotFoundError(f"{path} does not exist")
    return path


def required_pattern(pattern: str) -> Path:
    matches = glob.glob(str(base_path / pattern))
    if not matches:
        raise FileNotFoundError(f"{base_path} is missing a file matching: {pattern}")
    return Path(matches[0])


def read_source_table(path: Path, **kwargs) -> pd.DataFrame:
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path, **kwargs)
    return pd.read_excel(path, **kwargs)

# ── FILE PATHS ───────────────────────────────────────────────────────────────

# ── MASTER OUTPUT ─────────────────────────────────────────────────────────────

AUDIT_SCORE_COLUMNS = {
    "Courtesy": "Indicator 1 Score",
    "Confidentiality": "Indicator 2 Score",
    "Comprehend Intent": "Indicator 3 Score",
    "Comply - Email Writing SOG": "Indicator 4a Score",
    "Correct Information": "Indicator 5 Score",
    "Complete Information": "Indicator 6 Score",
    "Clear and Easy": "Indicator 7a Score",
    "Meaningful Conversations": "Indicator 8 Score",
    "Cultivate Digital Awareness": "Indicator 9 Score",
    "Verified Mistake": "Indicator 10 Score",
}


## returns CLEANED pandas table from the onedrive file
def audit_frame_from_onedrive() -> pd.DataFrame:
    audit_path = required_file("master_output.csv")
    frame = read_source_table(audit_path)

    rows = pd.DataFrame()           ## makes an empty table
    rows["officer_id"] = frame["officer_id"]
    rows["upload_date"] = pd.Timestamp.today().strftime("%Y-%m-%d")
    rows["total_score"] = frame["Total Score"]

    for app_column, source_column, in AUDIT_SCORE_COLUMNS.items():
        rows[app_column] = frame[source_column]


    ## Current audit table supports one row per officer/date -> average all case-level audit scores into one officer row
    score_columns = ["total_score", *AUDIT_SCORE_COLUMNS.keys()]            ## ["total_score", "Courtesy", "Confidentiality"...]
    rows = rows.groupby(["officer_id", "upload_date"], as_index=False)[score_columns].mean()        ## take the avg of those scores in score_columns

    return rows



# ── INTERACTIONS ────────────────────────────────────────────────────────
def interactions_frame_from_onedrive() -> pd.DataFrame:
    interactions_path = required_pattern("CCU Final replies*.csv")
    frame = read_source_table(
        interactions_path,
        usecols=['officer_id', "Case Number", "Date/Time Opened",
                'Enquiry', 'Case Details', 'Text Body']
    )

    ## rename the excel column headers to upload_date...
    frame = frame.rename(columns={
        "Date/Time Opened": "upload_date",
        'Case Number': "case_id",
        'Text Body': "officer_response"
    })

    ## new column member_query
    frame["member_query"] = (
        frame["Enquiry"].fillna("").astype(str)
        + "\n\n"
        + frame["Case Details"].fillna("").astype(str)
    )

    return frame

# ── Scorecard ───────────────────────────────────────────────────────────────────
# returns a data frame for import_scorecard to use (these are what import_scorecard expects)
## columns = officer_id, upload_date, P1, P2, Q1, ...
## first row = blank, upload_date, ROSE (15%), SIP (20%), ...
## the rest of the rows = officer scores

def scorecard_frame_from_onedrive():
    # Read row 1 to extract month
    ccu_pq_path = required_pattern("CCU PQ*.csv")
    raw_pq = read_source_table(ccu_pq_path, header=None)
    month_year = str(raw_pq.iloc[0, 1]).replace("Month:", "").strip()   # e.g. "Apr 2026"
    upload_date = pd.to_datetime(month_year).strftime("%Y-%m-%d")

    row1_index = 0              # Excel row 1: P1, P2, Q1...
    row3_index = 2              # Excel row 3: officer_id, Name, ROSE (15%), SIP (20%)...
    row4_index = 3              # Excel row 4 onwards: officer data

    wanted_codes = ['P1', 'P2', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'B1', 'B2', 'B3']

    row3_values = [ str(value).strip() for value in raw_pq.iloc[row3_index].tolist() ]
    officer_id_column_index = row3_values.index("officer_id")

    code_positions = {}

    for column_index, value in raw_pq.iloc[row1_index].items():
        code = str(value).strip()

        if code in wanted_codes:
            code_positions[code] = column_index            ## which column each code (P1 P2) is in

    ## will add on "Q4": "ROSE(15%)" in the next for loop
    frame_rows = {
        "officer_id": "",
        "upload_date": upload_date
    }

    for code, column_index in code_positions.items():           ## P1, column 17
        frame_rows[code] = raw_pq.iloc[row3_index, column_index]        ## row 3 column 17 = ROSE(15%)

    rows = [frame_rows]

    for row_index in range(row4_index, len(raw_pq)):
        raw_row = raw_pq.iloc[row_index]

        officer_id = str(raw_row[officer_id_column_index]).strip()

        if not officer_id or officer_id.lower() == "nan":
            continue

        item = {
            "officer_id": officer_id,
            "upload_date": upload_date
        }

        for code, column_index in code_positions.items():
            item[code] = raw_row[column_index]          ## "P1": 15

        rows.append(item)

    return pd.DataFrame(rows)


# ── ESS & TSS ──────────────────────────────────────────────────────────────────────
ESS_RATING_COLUMN = (
    "How satisfied are you with the service provided? "
    "1 - Very Dissatisfied, 2 - Dissatisfied, 3 - Somewhat"
)

ESS_FEEDBACK_COLUMN = "Any other comments about the service you received? (optional)"
ESS_VALID_COLUMN = "Is survey rating valid?"


def ess_frame_from_file(path: Path) -> pd.DataFrame:
    frame = read_source_table(path)

    frame = frame.rename(columns={
        "officer_id": "officer_id",
        "Response Completion Date/Time": "upload_date",
        ESS_RATING_COLUMN: "rating",
        ESS_FEEDBACK_COLUMN: "feedback",
        ESS_VALID_COLUMN: "ESS Valid"
    })

    return frame


# ── TRAINING DATA ─────────────────────────────────────────────────────────────
def training_frame_from_onedrive() -> pd.DataFrame:
    training_path = required_file("training_data.csv")
    frame = read_source_table(training_path).fillna("")

    year_columns = [
        column
        for column in frame.columns
        if str(column).strip().lower().startswith("training records ")
    ]

    rows = []
    for _, row in frame.iterrows():
        officer_id = str(row.get("officer_id", "")).strip()
        if not officer_id:
            continue

        for column in year_columns:
            year = str(column).replace("Training Records", "").strip()
            cell_text = str(row.get(column, "")).strip()
            if not cell_text:
                continue

            titles = [
                item.strip()
                for item in cell_text.replace("|", "\n").replace(";", "\n").splitlines()
                if item.strip()
            ]
            for title in titles:
                rows.append(
                    {
                        "officer_id": officer_id,
                        "Title": title,
                        "Provider": "CPF Board",
                        "Training Type": "Optional",
                        "Status": "Completed",
                        "Assigned Date": f"{year}-01-01" if year.isdigit() else "",
                        "Completed Date": f"{year}-12-31" if year.isdigit() else "",
                        "Competency Gap": "",
                    }
                )

    return pd.DataFrame(rows)


def projects_frame_from_onedrive() -> pd.DataFrame:
    projects_path = required_file("mirror_projects.csv")
    return read_source_table(projects_path)


def import_onedrive_section(results: dict, name: str, importer):
    try:
        results[name] = importer()
    except Exception as error:
        raise OneDriveImportError(
            f"OneDrive import failed at {name}: {error}"
        ) from error


def import_onedrive_files():
    results = {}

    import_onedrive_section(
        results,
        "org chart",
        lambda: import_org_chart_file(
            required_file("mirror_org_chart.csv")
        ),
    )

    import_onedrive_section(
        results,
        "settings",
        lambda: import_settings_file(
            required_file("mirror_settings.csv")
        ),
    )

    import_onedrive_section(
        results,
        "audit",
        lambda: import_audit(audit_frame_from_onedrive(), "upload_date"),
    )

    import_onedrive_section(
        results,
        "scorecard",
        lambda: import_scorecard(scorecard_frame_from_onedrive(), "upload_date"),
    )

    import_onedrive_section(
        results,
        "ESS",
        lambda: import_ess(
            ess_frame_from_file(
                required_file("ESS Verification Report_CCC.csv")
            ),
            "upload_date",
        ),
    )

    import_onedrive_section(
        results,
        "TSS",
        lambda: import_ess(
            ess_frame_from_file(
                required_file("TSS Verification Report_CCC.csv")
            ),
            "upload_date",
        ),
    )

    import_onedrive_section(
        results,
        "interactions",
        lambda: import_interactions(interactions_frame_from_onedrive(), "upload_date"),
    )

    import_onedrive_section(
        results,
        "training",
        lambda: import_training(training_frame_from_onedrive()),
    )

    import_onedrive_section(
        results,
        "projects",
        lambda: import_projects(projects_frame_from_onedrive()),
    )

    return results
