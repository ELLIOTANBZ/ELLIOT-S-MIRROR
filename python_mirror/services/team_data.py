from __future__ import annotations

from typing import Any

from services.calculations import average
from services.competency_analysis import officer_summary
from services.readiness_data import readiness_for, competency_groups
from services.access_control import SUPERVISOR_ROLES


from services.competency_scoring import (
    COMPETENCY_DESCRIPTIONS,
    LEADERSHIP_COMPETENCIES,
    AUDIT_LEADERSHIP_COMPETENCY_FIELDS,
    score_audit_for_one_group_of_competencies,
)


## Build the Team Overview page for a TL, CSM, AH, or Admin.
## officers: the visible officers to show in the team page, leader: the logged-in team leader / CSM / AH / admin
def team_portal_data( officers: list[dict[str, Any]], leader: dict[str, Any], ) -> dict[str, Any]:
    show_leadership = leader["role"] in SUPERVISOR_ROLES
    rows = []
    for officer in officers:
        readiness = readiness_for(officer["id"])
        groups = competency_groups(officer["id"])

        if leader["role"] == "TL":
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
                "competency_groups": visible_groups,
            }
        )
    leader_summary = officer_summary(leader["id"]) if show_leadership else {}
    leadership_scores = score_audit_for_one_group_of_competencies(
        leader_summary.get("audit", []),
        AUDIT_LEADERSHIP_COMPETENCY_FIELDS,
    ) if show_leadership else {}
    leadership_score = round(average(leadership_scores.values()) or 0, 1)
    leadership_rows = []
    for name in LEADERSHIP_COMPETENCIES:
        score = round(max(0, min(100, leadership_scores.get(name, 0))), 1)
        leadership_rows.append(
            {
                "name": name,
                "score": score,
                "level": "Advanced" if score >= 80 else "Intermediate" if score >= 65 else "Basic",
                "description": COMPETENCY_DESCRIPTIONS[name],
                "development": f"Continue building {name.lower()} through coaching, observation, and guided practice.",
            }
        )
    return {
        "leadership_score": leadership_score,
        "leadership_competencies": leadership_rows,
        "show_leadership": show_leadership,
        "rows": rows,
    }

