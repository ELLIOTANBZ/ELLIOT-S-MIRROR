from __future__ import annotations

import hashlib
import json
from typing import Any

from db import connect, dumps, loads
from services.ai_client import ai_is_configured, ai_provider, chat
from services.calculations import average
from services.readiness_data import readiness_for, competency_groups
from services.role_model import role_family
from services.competency_scoring import officer_has_leadership


def local_team_summary(rows: list[dict[str, Any]], leadership_score: float) -> dict[str, Any]:
    if not rows:
        return {
            "summary": "No team members are currently configured under this user.",
            "standouts": [],
            "watchouts": [],
        }
    readiness_values = [row["readiness_score"] for row in rows]
    strongest = max(rows, key=lambda row: row["readiness_score"])
    weakest = min(rows, key=lambda row: row["readiness_score"])
    return {
        "summary": (
            f"The team average readiness is {round(average(readiness_values) or 0, 1)}%. "
            f"Leadership progress is {leadership_score}%."
        ),
        "standouts": [f"{strongest['officer']['name']} currently has the highest readiness at {strongest['readiness_score']}%."],
        "watchouts": [f"{weakest['officer']['name']} currently has the lowest readiness at {weakest['readiness_score']}%."],
    }


def team_summary_cache_key(leader: dict[str, Any], rows: list[dict[str, Any]], leadership_score: float) -> str:
    team_snapshot = team_summary_snapshot(rows)
    material = {
        "provider": ai_provider(),
        "version": "team-overview-summary-v1",
        "leader_id": leader["id"],
        "leadership_score": leadership_score,
        "rows": team_snapshot,
    }
    encoded = json.dumps(material, ensure_ascii=True, sort_keys=True, default=str)
    return "team-overview-summary:" + hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def team_summary_snapshot(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "name": row["officer"]["name"],
            "role": row["officer"]["role"],
            "team": row["team"],
            "readiness_score": row["readiness_score"],
            "stage": row["stage"],
        }
        for row in rows
    ]


def team_ai_summary(leader: dict[str, Any], rows: list[dict[str, Any]], leadership_score: float) -> dict[str, Any]:
    cache_key = team_summary_cache_key(leader, rows, leadership_score)
    with connect() as conn:
        cached = conn.execute(
            "SELECT payload_json FROM ai_cache WHERE cache_key = ?",
            (cache_key,),
        ).fetchone()
    if cached:
        return loads(cached["payload_json"], {})

    if not ai_is_configured():
        return local_team_summary(rows, leadership_score)

    system = "You write concise team performance summaries for public service managers. Return JSON only."
    user = f"""
Return JSON in this exact shape:
{{
  "summary": "2-3 sentence overall team summary",
  "standouts": ["specific standout to notice"],
  "watchouts": ["specific watchout to manage"]
}}

Rules:
- Use only the supplied data.
- Be practical and concise.
- Mention team readiness patterns and any standout officers or risks.
- Do not invent facts.

Leader:
{json.dumps({"name": leader["name"], "role": leader["role"]}, ensure_ascii=True)}

Leadership score:
{leadership_score}

Team members:
{json.dumps(team_summary_snapshot(rows), ensure_ascii=True, default=str)}
"""
    try:
        result = chat(system, user)
    except Exception:
        return local_team_summary(rows, leadership_score)

    payload = {
        "summary": str(result.get("summary", "")).strip(),
        "standouts": [str(item).strip() for item in result.get("standouts", []) if str(item).strip()],
        "watchouts": [str(item).strip() for item in result.get("watchouts", []) if str(item).strip()],
    }
    with connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO ai_cache (cache_key, payload_json, created_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            """,
            (cache_key, dumps(payload)),
        )
    return payload


## Build the Team Overview page for a TL, CSM, AH, or Admin.
## officers: the visible officers to show in the team page, leader: the logged-in team leader / CSM / AH / admin
def team_portal_data( officers: list[dict[str, Any]], leader: dict[str, Any], ) -> dict[str, Any]:
    show_leadership = officer_has_leadership(leader["id"], leader["role"])
    rows = []
    for officer in officers:
        if officer["id"] == leader["id"]:
            continue
        readiness = readiness_for(officer["id"])
        groups = competency_groups(officer["id"], include_development_ai=False)

        if role_family(leader["role"]) in {"tl", "csm"}:
            visible_groups = {
                "correspondence": groups["correspondence"],
            }
        else:
            visible_groups = {
                "core": groups["core"],
                "functional": groups["functional"],
                "correspondence": groups["correspondence"],
            }

        rows.append(
            {
                "officer": officer,
                "readiness_score": readiness["readiness_score"],
                "stage": readiness["stage"],
                "team": readiness["profile"]["team_name"],
                "evidence_summary": groups.get("evidence_summary", ""),
                "competency_groups": visible_groups,
            }
        )
    leader_groups = (
        competency_groups(leader["id"], include_development_ai=False, include_leadership=True)
        if show_leadership
        else {}
    )
    leadership_rows = leader_groups.get("leadership", [])
    leadership_score = round(average([row["score"] for row in leadership_rows]) or 0, 1)
    return {
        "leader": leader,
        "leadership_score": leadership_score,
        "leadership_competencies": leadership_rows,
        "show_leadership": show_leadership,
        "team_summary": team_ai_summary(leader, rows, leadership_score),
        "rows": rows,
    }

