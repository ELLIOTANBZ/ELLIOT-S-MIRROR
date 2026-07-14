from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

from db import connect, loads
from services.ai_client import ai_is_configured, chat


APPRAISAL_CATEGORIES = [
    "Build capabilities",
    "Create capacity",
    "Strengthen relationship and capacity",
]


def default_appraisal_dates() -> tuple[str, str]:
    end = date.today()
    start = end - timedelta(days=365)
    return start.isoformat(), end.isoformat()


def rows_between(table: str, officer_id: str, date_column: str, start_date: str, end_date: str) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            f"""
            SELECT *
            FROM {table}
            WHERE officer_id = ? AND {date_column} BETWEEN ? AND ?
            ORDER BY {date_column} DESC, id DESC
            """,
            (officer_id, start_date, end_date),
        ).fetchall()
    records = [dict(row) for row in rows]
    for record in records:
        if "payload_json" in record:
            record.update(loads(record.pop("payload_json"), {}))
    return records


def appraisal_context(officer_id: str, start_date: str, end_date: str) -> dict[str, Any]:
    with connect() as conn:
        officer = conn.execute(
            """
            SELECT users.id, users.name, users.role,
                   profile.current_role, profile.target_role,
                   profile.responsibilities_json, profile.target_responsibilities_json,
                   org.team_name, org.trained_schemes
            FROM users
            LEFT JOIN career_profiles profile ON profile.officer_id = users.id
            LEFT JOIN organisation_relationships org ON org.officer_id = users.id
            WHERE users.id = ?
            """,
            (officer_id,),
        ).fetchone()
    profile = dict(officer) if officer else {"id": officer_id}
    profile["responsibilities"] = loads(profile.pop("responsibilities_json", "[]"), [])
    profile["target_responsibilities"] = loads(profile.pop("target_responsibilities_json", "[]"), [])

    return {
        "officer": profile,
        "period": {"start_date": start_date, "end_date": end_date},
        "audit": rows_between("audit_records", officer_id, "upload_date", start_date, end_date)[:20],
        "scorecard": rows_between("scorecard_records", officer_id, "upload_date", start_date, end_date)[:20],
        "ess": rows_between("ess_records", officer_id, "upload_date", start_date, end_date)[:20],
        "interactions": rows_between("interactions", officer_id, "upload_date", start_date, end_date)[:20],
        "training": rows_between("training_records", officer_id, "COALESCE(completed_date, assigned_date)", start_date, end_date)[:20],
        "projects": rows_between("project_records", officer_id, "date(updated_at)", start_date, end_date)[:20],
    }


def empty_appraisal() -> dict[str, Any]:
    return {
        "achievements": [],
        "work_concerns": "",
        "strengths_development": "",
        "career_goals": "",
        "improve_develop": "",
        "supervisor_help": "",
        "other_matters": "",
    }


def local_appraisal(context: dict[str, Any]) -> dict[str, Any]:
    appraisal = empty_appraisal()
    projects = context.get("projects", [])
    for index, project in enumerate(projects[:4]):
        appraisal["achievements"].append(
            {
                "category": APPRAISAL_CATEGORIES[index % len(APPRAISAL_CATEGORIES)],
                "target_sets": project.get("requirements_text", ""),
                "target_completion_date": "Ongoing" if not project.get("evidence_text") else "Completed",
                "achievements_progress": " ".join(
                    item
                    for item in [
                        project.get("project_role", ""),
                        project.get("evidence_text", ""),
                        project.get("supervisor_comments", ""),
                    ]
                    if item
                ),
            }
        )
    if not appraisal["achievements"]:
        appraisal["achievements"].append(
            {
                "category": APPRAISAL_CATEGORIES[0],
                "target_sets": "No project target evidence is available for this period.",
                "target_completion_date": "Ongoing",
                "achievements_progress": "Add project evidence so MIRROR can draft this section more strongly.",
            }
        )
    appraisal["work_concerns"] = (
        "Review recurring issues from ESS, interactions, and project evidence for this period. "
        "Explain what made the work difficult, what support or information was needed, and what could reduce blockers next cycle."
    )
    appraisal["strengths_development"] = (
        "Use project outcomes, competency evidence, and feedback to describe 2-3 strengths. "
        "Then identify development areas with concrete examples of what should improve next."
    )
    appraisal["career_goals"] = f"Progress towards {context.get('officer', {}).get('target_role') or 'the next suitable role'}."
    appraisal["improve_develop"] = (
        "Continue documenting project outcomes, seek feedback from project managers, practise weak competency areas in live cases, "
        "and identify training or stretch assignments that match the officer's competency gaps."
    )
    appraisal["supervisor_help"] = "Provide timely feedback on project evidence and opportunities to demonstrate target-role competencies."
    appraisal["other_matters"] = "Generated draft. Officer should verify before submission."
    return appraisal


def generate_appraisal(officer_id: str, start_date: str, end_date: str) -> dict[str, Any]:
    context = appraisal_context(officer_id, start_date, end_date)
    if not ai_is_configured():
        return local_appraisal(context)

    system = (
        "You draft appraisal form answers for a public service officer. "
        "Sell the officer fairly and positively using only supplied evidence. "
        "Return only valid JSON."
    )
    user = f"""
Use the MIRROR evidence to draft an appraisal form for the officer.

Return JSON in this exact shape:
{{
  "achievements": [
    {{
      "category": "Build capabilities|Create capacity|Strengthen relationship and capacity",
      "target_sets": "brief target for the period under review",
      "target_completion_date": "Ongoing|Completed|specific date if clear",
      "achievements_progress": "major achievements, new initiatives, and extent targets were met"
    }}
  ],
  "work_concerns": "my work concerns/needs. Elaborate on blockers, resource/process constraints, support needed, and what would help the officer perform better.",
  "strengths_development": "my strengths and areas for further development. Include evidence-backed strengths, examples from projects/interactions, and specific development areas.",
  "career_goals": "my career goals/aspirations",
  "improve_develop": "what I can do to further improve/develop myself. Give practical next steps, training/stretch exposure suggestions, and habits to build.",
  "supervisor_help": "how my supervisor can help me do my job better",
  "other_matters": "any other matters"
}}

Rules:
- Use a positive but truthful appraisal tone.
- Use projects strongly, especially project_role, requirements_text, evidence_text, and supervisor_comments.
- Use audit, scorecard, ESS, interactions, and training as supporting evidence where relevant.
- Do not invent projects, targets, dates, or outcomes.
- If evidence is missing, phrase it as an area to verify, not as a fake achievement.
- Keep each answer concise enough to paste into an appraisal form.

Evidence:
{json.dumps(context, ensure_ascii=True, default=str)}
"""
    result = chat(system, user)
    appraisal = empty_appraisal()
    appraisal.update({key: result.get(key, appraisal[key]) for key in appraisal})
    if not appraisal.get("achievements"):
        appraisal["achievements"] = empty_appraisal()["achievements"] or [
            {
                "category": APPRAISAL_CATEGORIES[0],
                "target_sets": "",
                "target_completion_date": "Ongoing",
                "achievements_progress": "",
            }
        ]
    return appraisal


def appraisal_text(officer_name: str, start_date: str, end_date: str, values: dict[str, Any]) -> str:
    lines = [
        f"Appraisal draft for {officer_name}",
        f"Period: {start_date} to {end_date}",
        "",
        "1. My achievements based on achieved targets",
    ]
    achievements = values.get("achievements", [])
    for index, item in enumerate(achievements, start=1):
        lines.extend(
            [
                f"{index}. Category: {item.get('category', '')}",
                f"   Target sets: {item.get('target_sets', '')}",
                f"   Target completion date: {item.get('target_completion_date', '')}",
                f"   Achievements & progress: {item.get('achievements_progress', '')}",
            ]
        )
    sections = [
        ("2. My work concerns/needs", "work_concerns"),
        ("3. My strengths & areas for further development", "strengths_development"),
        ("4. My career goals/aspirations", "career_goals"),
        ("5. What can I do to further improve/develop myself", "improve_develop"),
        ("6. How my supervisor can help me do my job better", "supervisor_help"),
        ("7. Any other matters", "other_matters"),
    ]
    for title, key in sections:
        lines.extend(["", title, str(values.get(key, ""))])
    return "\n".join(lines)
