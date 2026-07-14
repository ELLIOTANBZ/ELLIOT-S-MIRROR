from __future__ import annotations
from typing import Any          ## for dict[str, Any]
from db import connect          ## with connect() as conn


## Gets one project row from SQLite. Used before saving evidence so the backend can check who owns/leads the project.
def find_project(project_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT *
            FROM project_records
            WHERE id = ?
            """,
            (project_id,),
        ).fetchone()
    return dict(row) if row else None


## Saves a new project created by the officer. stores: officer_id, project_name, selected project managers, project role, and requirements_text.
def save_project_record(values: dict[str, Any]) -> None:
    officer_id = str(values.get("officer_id")).strip()
    project_name = str(values.get("project_name")).strip()
    project_leads = ";".join(values.getlist("project_leads"))
    project_role = str(values.get("project_role")).strip()
    requirements_text = str(values.get("requirements_text")).strip()
    if not requirements_text:
        guided_requirements = [
            ("Project purpose", values.get("project_purpose", "")),
            ("Targets or deliverables", values.get("project_targets", "")),
            ("People or relationships involved", values.get("project_relationships", "")),
            ("Capability/capacity built", values.get("project_capability", "")),
            ("Timeline or completion status", values.get("project_timeline", "")),
        ]
        requirements_text = "\n".join(
            f"{label}: {str(answer).strip()}"
            for label, answer in guided_requirements
            if str(answer).strip()
        )

    if not officer_id:
        raise ValueError("Project needs an officer")
    if not project_name:
        raise ValueError("Project needs a name")
    if not project_leads:
        raise ValueError("Project needs at least one project manager")
    if not project_role:
        raise ValueError("Project needs your role")
    if not requirements_text:
        raise ValueError("Project needs requirements")

    with connect() as conn:
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
                UPDATE project_records
                SET project_leads = ?,
                    project_role = ?,
                    requirements_text = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (project_leads, project_role, requirements_text, existing["id"]),
            )
        else:
            conn.execute(
                """
                INSERT INTO project_records
                (officer_id, project_name, project_leads, project_role, requirements_text, evidence_text, supervisor_comments, updated_at)
                VALUES (?, ?, ?, ?, ?, '', '', CURRENT_TIMESTAMP)
                """,
                (officer_id, project_name, project_leads, project_role, requirements_text),
            )


## let project manager store: evidence & comments
def update_project_supervisor_evidence(project_id: str, evidence_text: str, supervisor_comments: str) -> None:
    with connect() as conn:
        conn.execute(
            """
            UPDATE project_records
            SET evidence_text = ?, supervisor_comments = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (evidence_text.strip(), supervisor_comments.strip(), project_id),
        )


## to display on projects

## HELPER: return project manager NAMES, which will then be added into the dict by project_rows_with_lead_names
def project_lead_names(project_leads: str) -> str:
    lead_ids = [item.strip() for item in project_leads.split(";") if item.strip()]
    if not lead_ids:
        return ""
    placeholders = ",".join("?" for _ in lead_ids)
    with connect() as conn:
        rows = conn.execute(
            f"SELECT id, name FROM users WHERE id IN ({placeholders})",
            lead_ids,
        ).fetchall()
    names_by_id = {row["id"]: row["name"] for row in rows}
    return ", ".join(names_by_id.get(lead_id, lead_id) for lead_id in lead_ids)

## HELPER: just to add project manager NAMES into each dict
def project_rows_with_lead_names(rows) -> list[dict[str, Any]]:
    projects = [dict(row) for row in rows]
    for project in projects:
        project["project_lead_names"] = project_lead_names(project.get("project_leads", ""))
    return projects


## Shows projects created by a normal officer.
def projects_for(officer_id: str) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT project_records.*, users.name AS officer_name
            FROM project_records
            JOIN users ON users.id = project_records.officer_id
            WHERE project_records.officer_id = ?
            ORDER BY project_records.updated_at DESC, project_records.id DESC
            """,
            (officer_id,),
        ).fetchall()

    return project_rows_with_lead_names(rows)


## Shows projects where the logged-in TL/CSM/AH was selected as a project manager (LIKE means ==). Also includes their own projects.
def projects_for_project_lead(user_id: str) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT project_records.*, users.name AS officer_name
            FROM project_records
            JOIN users ON users.id = project_records.officer_id
            WHERE project_records.officer_id = ? OR ';' || project_records.project_leads || ';' LIKE ?
            ORDER BY project_records.updated_at DESC, project_records.id DESC
            """,
            (user_id, f"%;{user_id};%"),
        ).fetchall()

    return project_rows_with_lead_names(rows)


## Lets Admin see all project records.
def all_projects() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT project_records.*, users.name AS officer_name
            FROM project_records
            JOIN users ON users.id = project_records.officer_id
            ORDER BY project_records.updated_at DESC, project_records.id DESC
            """
        ).fetchall()

    return project_rows_with_lead_names(rows)


