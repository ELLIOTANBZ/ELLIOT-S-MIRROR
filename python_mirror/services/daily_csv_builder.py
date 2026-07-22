from __future__ import annotations

from io import StringIO
from typing import Any

import pandas as pd

from db import connect
from services.role_model import role_sort_key


def read_uploaded_table(upload) -> pd.DataFrame:
    filename = upload.filename.lower()
    if filename.endswith(".csv"):
        return pd.read_csv(upload)
    if filename.endswith((".xlsx", ".xlsm", ".xls")):
        return pd.read_excel(upload)
    raise ValueError("Daily CSV builder only accepts .csv, .xlsx, .xlsm, and .xls files.")


def admin_config_rows() -> list[dict[str, Any]]:
    rows = []

    with connect() as conn:
        officers = conn.execute(
            """
            SELECT users.id, users.name, users.role,
                   profile.current_role, profile.target_role,
                   org.manager_id, org.team_name, org.trained_schemes,
                   COALESCE(manager_profiles.handles_member_correspondence, 0) AS handles_member_correspondence,
                   COALESCE(manager_profiles.handles_projects, 1) AS handles_projects,
                   COALESCE(manager_profiles.leads_team, 0) AS leads_team
            FROM users
            LEFT JOIN career_profiles profile ON profile.officer_id = users.id
            LEFT JOIN organisation_relationships org ON org.officer_id = users.id
            LEFT JOIN manager_profiles ON manager_profiles.officer_id = users.id
            ORDER BY users.role, users.name
            """
        ).fetchall()
        settings = conn.execute(
            """
            SELECT * FROM readiness_settings
            ORDER BY role
            """
        ).fetchall()
        settings = sorted(settings, key=lambda row: role_sort_key(row["role"]))
        thresholds = conn.execute(
            """
            SELECT * FROM readiness_thresholds
            ORDER BY CASE stage
              WHEN 'Meeting Expectations' THEN 1
              WHEN 'Stretch Assignment Ready' THEN 2
              ELSE 3 END,
              sequence
            """
        ).fetchall()
        source_weights = conn.execute(
            """
            SELECT * FROM competency_source_weights
            ORDER BY role, competency_name
            """
        ).fetchall()
        source_weights = sorted(source_weights, key=lambda row: (*role_sort_key(row["role"]), row["competency_name"]))

    for officer in officers:
        rows.append(
            {
                "officer_id": officer["id"],
                "Officer Name": officer["name"],
                "Officer Role": officer["role"],
                "Manager ID": officer["manager_id"] or "",
                "Team Name": officer["team_name"] or "",
                "Trained Schemes": officer["trained_schemes"] or "",
                "Current Role": officer["current_role"] or officer["role"],
                "Target Role": officer["target_role"] or "",
                "Handles Member Correspondence": "Yes" if officer["handles_member_correspondence"] else "",
                "Handles Projects": "Yes" if officer["handles_projects"] else "",
                "Leads Team": "Yes" if officer["leads_team"] else "",
            }
        )

    for setting in settings:
        rows.append(
            {
                "Readiness Role": setting["role"],
                "Core Weight": setting["core_weight"],
                "Functional Weight": setting["functional_weight"],
                "Correspondence Weight": setting["correspondence_weight"],
                "Leadership Weight": setting["leadership_weight"],
            }
        )

    for threshold in thresholds:
        rows.append(
            {
                "Threshold Stage": threshold["stage"],
                "Threshold Tier": threshold["tier"],
                "Threshold Metric": threshold["metric"],
                "Threshold Display Name": threshold["display_name"],
                "Threshold Minimum Value": threshold["minimum_value"],
                "Threshold Unit": threshold["unit"],
                "Threshold Sequence": threshold["sequence"],
            }
        )

    for weight in source_weights:
        rows.append(
            {
                "Source Role": weight["role"],
                "Source Competency": weight["competency_name"],
                "Source Audit Weight": weight["audit_weight"],
                "Source Scorecard Weight": weight["scorecard_weight"],
                "Source Interaction Weight": weight["interaction_weight"],
                "Source Project Weight": weight["project_weight"],
            }
        )

    return rows


def build_daily_csv(uploaded_files) -> str:
    frames = []
    config_rows = admin_config_rows()
    if config_rows:
        frames.append(pd.DataFrame(config_rows))

    for upload in uploaded_files:
        if not upload or not upload.filename:
            continue
        frames.append(read_uploaded_table(upload))

    if not frames:
        raise ValueError("Upload at least one source file or add admin configuration first.")

    combined = pd.concat(frames, ignore_index=True, sort=False).fillna("")
    output = StringIO()
    combined.to_csv(output, index=False)
    return output.getvalue()
