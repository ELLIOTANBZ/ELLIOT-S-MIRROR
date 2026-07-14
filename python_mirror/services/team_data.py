from __future__ import annotations

from typing import Any

from services.calculations import average
from services.readiness_data import readiness_for, competency_groups
LEADERSHIP_ROLES = {"AH"}
CORRESPONDENCE_ONLY_ROLES = {"TL", "CSM"}


## Build the Team Overview page for a TL, CSM, AH, or Admin.
## officers: the visible officers to show in the team page, leader: the logged-in team leader / CSM / AH / admin
def team_portal_data( officers: list[dict[str, Any]], leader: dict[str, Any], ) -> dict[str, Any]:
    show_leadership = leader["role"] in LEADERSHIP_ROLES
    rows = []
    for officer in officers:
        readiness = readiness_for(officer["id"])
        groups = competency_groups(officer["id"], include_development_ai=False)

        if leader["role"] in CORRESPONDENCE_ONLY_ROLES:
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
    leader_groups = competency_groups(leader["id"], include_development_ai=False) if show_leadership else {}
    leadership_rows = leader_groups.get("leadership", [])
    leadership_score = round(average([row["score"] for row in leadership_rows]) or 0, 1)
    return {
        "leadership_score": leadership_score,
        "leadership_competencies": leadership_rows,
        "show_leadership": show_leadership,
        "rows": rows,
    }

