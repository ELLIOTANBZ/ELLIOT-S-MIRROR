from __future__ import annotations

import math

from collections import defaultdict
from datetime import date
from typing import Any


from db import connect, loads
from services.calculations import average, percentage
from services.competency_analysis import officer_summary
from services.portal_defaults import ensure_portal_defaults
from services.project_data import project_score_for
from services.access_control import SUPERVISOR_ROLES
from services.competency_scoring import (
    COMPETENCY_DESCRIPTIONS,
    CORRESPONDENCE_COMPETENCIES,
    CORE_COMPETENCIES,
    AUDIT_CORE_COMPETENCY_FIELDS,
    FUNCTIONAL_COMPETENCIES,
    blended_competency_score,
    score_audit_for_all_competencies,
    score_scorecard_for_all_competencies,
)


READINESS_STAGES = [
    "Not Ready",
    "Meeting Expectations",
    "Stretch Assignment Ready",
    "Career Advancement Ready",
]


def readiness_settings_role(role: str) -> str:
    return role


## get career profile for officer
def profile_for(officer_id: str) -> dict[str, Any]:
    ensure_portal_defaults()
    with connect() as conn:
        row = conn.execute(
            """
            SELECT cp.*, COALESCE(NULLIF(org.team_name, ''), 'Unassigned') AS team_name
            FROM career_profiles cp
            LEFT JOIN organisation_relationships org ON org.officer_id = cp.officer_id
            WHERE cp.officer_id = ?
            """,
            (officer_id,),
        ).fetchone()
    profile = dict(row)
    profile["responsibilities"] = loads(profile.pop("responsibilities_json"), [])
    profile["target_responsibilities"] = loads(profile.pop("target_responsibilities_json"), [])
    if profile.get("role_start_date"):
        started = date.fromisoformat(profile["role_start_date"])
        profile["years_in_role"] = round((date.today() - started).days / 365.25, 1)
    else:
        profile["years_in_role"] = 0
    return profile


## performance banding
def latest_performance_banding_score(officer_id: str) -> float:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT score FROM performance_records
            WHERE officer_id = ?
            ORDER BY period DESC, updated_at DESC, id DESC
            LIMIT 1
            """,
            (officer_id,),
        ).fetchone()
    return round(float(row["score"]), 1) if row else 0



## HELPER
def grouped_scores(officer_id: str, summary: dict[str, Any]) -> dict[str, float]:
    audit_records = summary.get("audit", [])
    audit_scores = score_audit_for_all_competencies(audit_records)
    scorecard_records = summary.get("scorecard", [])
    scorecard_scores = score_scorecard_for_all_competencies(scorecard_records)

    blended_scores = blended_competency_score(officer_id, audit_scores, scorecard_scores)

    core = average([blended_scores.get(name, 0) for name in CORE_COMPETENCIES])
    functional = average([blended_scores.get(name, 0) for name in FUNCTIONAL_COMPETENCIES])
    correspondence = average([blended_scores.get(name, 0) for name in CORRESPONDENCE_COMPETENCIES])
    performance = latest_performance_banding_score(officer_id)
    customer_satisfaction = percentage(summary.get("average_ess_rating"), 5)
    return {
        "core": round(core or 0, 1),
        "functional": round(functional or 0, 1),
        "correspondence": round(correspondence or 0, 1),
        "performance": performance,
        "customer_satisfaction": round(customer_satisfaction, 1),
    }


def weighted_readiness_score(
    *,
    settings,
    core,
    functional,
    correspondence,
    performance,
    experience,
    projects,
):
    return (
        core * settings["core_weight"]
        + functional * settings["functional_weight"]
        + correspondence * settings["correspondence_weight"]
        + performance * settings["performance_weight"]
        + experience * settings["tenure_weight"]
        + projects * settings["development_weight"]
    )


def readiness_pause_reasons(officer_id: str, summary: dict[str, Any], scores: dict[str, float]) -> list[dict[str, str]]:
    reasons = []
    if scores["customer_satisfaction"] and scores["customer_satisfaction"] < 60:
        reasons.append(
            {
                "title": "Readiness progression paused",
                "detail": "Customer rating is below 60% based on ESS reviews from the last 365 days.",
            }
        )

    today = date.today()
    dated_audit = []
    for record in summary.get("audit", []):
        try:
            record_age = (today - date.fromisoformat(record["upload_date"])).days
        except (TypeError, ValueError):
            continue
        if record_age <= 95:
            dated_audit.append((record_age, record))

    old_audit = [record for record_age, record in dated_audit if record_age >= 60]
    new_audit = [record for record_age, record in dated_audit if record_age <= 30]
    dated_scorecard = []
    for record in summary.get("scorecard", []):
        try:
            record_age = (today - date.fromisoformat(record["upload_date"])).days
        except (TypeError, ValueError):
            continue
        if record_age <= 95:
            dated_scorecard.append((record_age, record))

    old_scorecard = [record for record_age, record in dated_scorecard if record_age >= 60]
    new_scorecard = [record for record_age, record in dated_scorecard if record_age <= 30]
    if (old_audit or old_scorecard) and (new_audit or new_scorecard):
        old_scores = blended_competency_score(
            officer_id,
            score_audit_for_all_competencies(old_audit),
            score_scorecard_for_all_competencies(old_scorecard),
        )
        new_scores = blended_competency_score(
            officer_id,
            score_audit_for_all_competencies(new_audit),
            score_scorecard_for_all_competencies(new_scorecard),
        )
        for name, new_score in new_scores.items():
            old_score = old_scores.get(name)
            if old_score is not None and new_score < 60 and new_score - old_score < 5:
                reasons.append(
                    {
                        "title": "Readiness progression paused",
                        "detail": f"{name} has stayed below 60 for more than 2 months.",
                    }
                )
                break

    return reasons



## HELPER
## Load one officer’s career profile + calculate how many years they have been in their current role.
def radar_items_for(officer_id: str, summary: dict[str, Any], scores: dict[str, float]) -> tuple[list[dict[str, Any]], str]:
    audit_records = summary.get("audit", [])
    audit_scores = score_audit_for_all_competencies(audit_records)
    scorecard_records = summary.get("scorecard", [])
    scorecard_scores = score_scorecard_for_all_competencies(scorecard_records)

    final_scores = blended_competency_score(officer_id, audit_scores, scorecard_scores)
    axes = [
        *[
            {"name": name, "score": round(final_scores.get(name, 0), 1)}
            for name in AUDIT_CORE_COMPETENCY_FIELDS
        ],
        {"name": "Functional", "score": scores["functional"]},
        {"name": "Correspondence", "score": scores["correspondence"]},
    ]

    polygon_points = []
    for index, item in enumerate(axes):
        angle = -math.pi / 2 + (2 * math.pi * index / len(axes))
        value = max(0, min(100, item["score"])) / 100
        x = 50 + math.cos(angle) * value * 42
        y = 50 + math.sin(angle) * value * 42
        label_x = 50 + math.cos(angle) * 55
        label_y = 50 + math.sin(angle) * 55
        polygon_points.append(f"{round(x, 1)}% {round(y, 1)}%")
        item["label_x"] = round(label_x, 1)
        item["label_y"] = round(label_y, 1)

    return axes, ", ".join(polygon_points)


## Build the competency breakdown boxes shown in My Readiness.
def competency_groups(officer_id: str) -> dict[str, list[dict[str, Any]]]:
    summary = officer_summary(officer_id)
    audit_records = summary.get("audit", [])
    scorecard_records = summary.get("scorecard", [])

    def latest_date(records: list[dict[str, Any]], date_key: str) -> str:
        dates = [record.get(date_key, "") for record in records if record.get(date_key)]
        return max(dates) if dates else "no latest date"

    evidence_summary = (
        "Scores are derived from the officer's recent "
        f"audit ({summary.get('audit_count', 0)} records, latest {latest_date(audit_records, 'upload_date')}), "
        f"scorecard ({summary.get('scorecard_count', 0)} records, latest {latest_date(scorecard_records, 'upload_date')}), "
        f"interaction ({summary.get('interaction_count', 0)} records, latest {latest_date(summary.get('interactions', []), 'upload_date')}), "
        f"and projects ({summary.get('project_count', 0)} records, latest {latest_date(summary.get('projects', []), 'updated_at')})."
    )

    ## helper, turns list of competency names --> display-ready dictionaries
    def make_rows(names: list[str], score_map: dict[str, float]) -> list[dict[str, Any]]:
        rows = []
        for name in names:
            score = max(0, min(100, score_map.get(name, 0)))
            level = "Advanced" if score >= 80 else "Intermediate" if score >= 60 else "Basic"
            rows.append(
                {
                    "name": name,
                    "score": round(score, 1),
                    "level": level,
                    "description": COMPETENCY_DESCRIPTIONS.get(name, ""),
                    "rationale": (
                        f"The current score is derived from the officer's recent "
                        f"audit, scorecard, interaction, project, and completed training evidence."
                    ),
                    "development": (
                        f"To progress, practise {name.lower()} in current cases and "
                        f"review the next results with a TL, CSM, or AH."
                    ),
                }
            )
        return rows

    audit_scores = score_audit_for_all_competencies(audit_records)
    scorecard_scores = score_scorecard_for_all_competencies(scorecard_records)
    final_scores = blended_competency_score(officer_id, audit_scores, scorecard_scores)

    return {
        "evidence_summary": evidence_summary,
        "core": make_rows(CORE_COMPETENCIES, final_scores),
        "functional": make_rows(FUNCTIONAL_COMPETENCIES, final_scores),
        "correspondence": make_rows(CORRESPONDENCE_COMPETENCIES, final_scores),
    }


## main function
def readiness_for(officer_id: str) -> dict[str, Any]:
    summary = officer_summary(officer_id)
    profile = profile_for(officer_id)
    scores = grouped_scores(officer_id, summary)

    ## load the readiness weights for this officer's current role
    with connect() as conn:
        settings = dict(
            conn.execute(
                "SELECT * FROM readiness_settings WHERE role = ?",
                (readiness_settings_role(profile["current_role"]),),
            ).fetchone()
        )
        ## loads all requirements from readiness_thresholds. sorted by meeting expectations, stretch assgn ready, career advancement ready; within sorted by sequence
        threshold_rows = conn.execute(
            """
            SELECT * FROM readiness_thresholds
            ORDER BY CASE stage
              WHEN 'Meeting Expectations' THEN 1
              WHEN 'Stretch Assignment Ready' THEN 2
              ELSE 3 END,
              sequence
            """
        ).fetchall()

    ## years in role / expected years till promotion
    tenure_target = profile["expected_tenure_years"] or 1
    tenure_score = percentage(profile["years_in_role"], tenure_target)

    project_score = project_score_for(officer_id)

    ## each score * its configured weight
    total = weighted_readiness_score(
        settings=settings,
        core=scores["core"],
        functional=scores["functional"],
        correspondence=scores["correspondence"],
        performance=scores["performance"],
        experience=tenure_score,
        projects=project_score,
    )

    all_scores = {
        **scores,
        "experience": profile["years_in_role"],
        "projects": project_score,
        "readiness": total,
    }

    ## { "Meeting Expectations": [...], "Stretch Assignment Ready": [...], "Career Advancement": [career advancement, core, core, 0.7, score, 1, 0.8, true]}
    thresholds_by_stage: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in threshold_rows:
        threshold = dict(row)
        threshold["value"] = round(all_scores[threshold["metric"]], 1)
        threshold["met"] = threshold["value"] >= threshold["minimum_value"]
        thresholds_by_stage[threshold["stage"]].append(threshold)

    ## choose current stage
    if all(item["met"] for item in thresholds_by_stage["Career Advancement Ready"]):
        stage = READINESS_STAGES[3]
    elif all(item["met"] for item in thresholds_by_stage["Stretch Assignment Ready"]):
        stage = READINESS_STAGES[2]
    elif all(item["met"] for item in thresholds_by_stage["Meeting Expectations"]):
        stage = READINESS_STAGES[1]
    else:
        stage = READINESS_STAGES[0]

    ## choose next stage
    next_stage_index = min(READINESS_STAGES.index(stage) + 1, len(READINESS_STAGES) - 1)        ## current stage + 1
    next_stage = READINESS_STAGES[next_stage_index]
    readiness_threshold = next(
        (
            item["minimum_value"]
            for item in thresholds_by_stage[next_stage]
            if item["metric"] == "readiness"
        ),
        100,
    )
    readiness_percent = percentage(total, readiness_threshold)

    radar_items, radar_polygon = radar_items_for(officer_id, summary, scores)
    pause_reasons = readiness_pause_reasons(officer_id, summary, scores)

    ## measures = The requirements for the officer’s next stage.
    return {
        "stage": stage,
        "next_stage": next_stage,
        "stages": READINESS_STAGES,
        "readiness_score": round(total, 1),
        "readiness_percent": round(readiness_percent, 1),
        "readiness_paused": bool(pause_reasons),
        "pause_reasons": pause_reasons,
        "measures": thresholds_by_stage[next_stage],
        "scores": scores,
        "profile": profile,
        "settings": settings,
        "radar_items": radar_items,
        "radar_polygon": radar_polygon,
        "component_scores": {
            "Core Competency": scores["core"],
            "Functional Competency": scores["functional"],
            "Correspondence Competency": scores["correspondence"],
            "Performance Banding": scores["performance"],
            "Experience": round(tenure_score, 1),
            "Projects": round(project_score, 1),
            "Customer Satisfaction": scores["customer_satisfaction"],
        },
    }


