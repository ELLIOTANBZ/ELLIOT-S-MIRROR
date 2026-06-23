from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from db import db_path
from services.access_control import descendant_user_ids

USER_COLUMNS = ("officer_id", "officerId", "username", "Username", "user", "User")
DATE_COLUMNS = ("upload_date", "uploadDate", "date", "Date", "Upload Date")


def allowed_user_identifiers(username: str) -> set[str] | None:
    conn = sqlite3.connect(db_path())
    conn.row_factory = sqlite3.Row
    try:
        user = conn.execute(
            "SELECT id, role FROM users WHERE lower(username) = ?",
            (username.strip().lower(),),
        ).fetchone()
        if user is None:
            raise SystemExit(f"User not found in the local MIRROR database: {username}")
        if user["role"] == "Admin":
            return None
        allowed_ids = descendant_user_ids(conn, user["id"])
        placeholders = ",".join("?" for _ in allowed_ids)
        rows = conn.execute(
            f"SELECT id, username FROM users WHERE id IN ({placeholders})",
            tuple(allowed_ids),
        ).fetchall()
        return {
            str(identifier).strip().lower()
            for row in rows
            for identifier in (row["id"], row["username"])
        }
    finally:
        conn.close()


def find_column(frame: pd.DataFrame, candidates: tuple[str, ...]) -> str | None:
    lower_to_actual = {str(column).lower(): column for column in frame.columns}
    for candidate in candidates:
        if candidate.lower() in lower_to_actual:
            return lower_to_actual[candidate.lower()]
    return None


def filter_frame(
    frame: pd.DataFrame,
    allowed: set[str] | None,
    from_date: str | None,
    to_date: str | None,
) -> pd.DataFrame:
    output = frame.copy()

    user_col = find_column(output, USER_COLUMNS)
    if allowed is not None:
        if not user_col:
            raise SystemExit(f"Could not find a user/officer column. Expected one of: {', '.join(USER_COLUMNS)}")
        output = output[output[user_col].astype(str).str.lower().isin(allowed)]

    date_col = find_column(output, DATE_COLUMNS)
    if date_col and (from_date or to_date):
        dates = pd.to_datetime(output[date_col], errors="coerce")
        if from_date:
            output = output[dates >= pd.to_datetime(from_date)]
            dates = pd.to_datetime(output[date_col], errors="coerce")
        if to_date:
            output = output[dates <= pd.to_datetime(to_date)]

    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrub a downloaded Excel/CSV export for one MIRROR user.")
    parser.add_argument("--source", required=True)
    parser.add_argument("--username", required=True)
    parser.add_argument("--from-date")
    parser.add_argument("--to-date")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    source = Path(args.source)
    output = Path(args.output)
    suffix = source.suffix.lower()
    allowed = allowed_user_identifiers(args.username)

    if suffix == ".csv":
        frame = pd.read_csv(source)
        filtered = filter_frame(frame, allowed, args.from_date, args.to_date)
        filtered.to_csv(output, index=False)
    elif suffix in {".xlsx", ".xlsm", ".xls"}:
        sheets = pd.read_excel(source, sheet_name=None)
        filtered_sheets = {
            name: filter_frame(frame, allowed, args.from_date, args.to_date)
            for name, frame in sheets.items()
        }
        with pd.ExcelWriter(output, engine="openpyxl") as writer:
            for name, frame in filtered_sheets.items():
                frame.to_excel(writer, sheet_name=name[:31], index=False)
    else:
        raise SystemExit("Supported files: .csv, .xlsx, .xlsm, .xls")

    print(f"Scrubbed file written to {output}")


if __name__ == "__main__":
    main()
