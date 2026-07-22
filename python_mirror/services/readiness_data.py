from __future__ import annotations

import hashlib
import json
import math

from collections import defaultdict
from datetime import date
from typing import Any


from db import connect, dumps, loads
from services.calculations import average, percentage
from services.competency_analysis import officer_summary
from services.portal_defaults import ensure_portal_defaults
from services.ai_client import ai_is_configured, ai_provider, chat
from services.competency_scoring import (
    COMPETENCY_DESCRIPTIONS,
    CORRESPONDENCE_COMPETENCIES,
    CORE_COMPETENCIES,
    AUDIT_CORE_COMPETENCY_FIELDS,
    FUNCTIONAL_COMPETENCIES,
    LEADERSHIP_COMPETENCIES,
    blended_competency_score,
    officer_has_leadership,
    score_audit_for_all_competencies,
    score_scorecard_for_all_competencies,
)
from services.role_model import configuration_role, responsibilities_for_role, role_family, role_tier


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
    profile["responsibilities"] = responsibilities_for_role(profile["current_role"])
    profile["target_responsibilities"] = responsibilities_for_role(profile["target_role"])
    return profile


def officer_role(officer_id: str) -> str:
    with connect() as conn:
        row = conn.execute("SELECT role FROM users WHERE id = ?", (officer_id,)).fetchone()
    return row["role"] if row else "CSE"


def team_member_ids(officer_id: str) -> list[str]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT users.id, org.manager_id
            FROM users
            LEFT JOIN organisation_relationships org ON org.officer_id = users.id
            WHERE users.role != 'Admin'
            """
        ).fetchall()
    children_by_manager: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        if row["manager_id"]:
            children_by_manager[row["manager_id"]].append(row["id"])

    descendants = []
    to_check = list(children_by_manager.get(officer_id, []))
    seen = {officer_id}
    while to_check:
        current_id = to_check.pop()
        if current_id in seen:
            continue
        seen.add(current_id)
        descendants.append(current_id)
        to_check.extend(children_by_manager.get(current_id, []))
    return descendants


def team_readiness_average(officer_id: str) -> float:
    member_ids = team_member_ids(officer_id)
    scores = []
    for member_id in member_ids:
        if role_family(officer_role(member_id)) == "ah":
            continue
        scores.append(readiness_for(member_id)["readiness_percent"])
    return round(average(scores) or 0, 1)



## HELPER
def final_competency_scores(officer_id: str, summary: dict[str, Any]) -> dict[str, float]:
    audit_records = summary.get("audit", [])
    audit_scores = score_audit_for_all_competencies(audit_records)
    scorecard_records = summary.get("scorecard", [])
    scorecard_scores = score_scorecard_for_all_competencies(scorecard_records)

    final_scores = blended_competency_score(officer_id, audit_scores, scorecard_scores)
    if role_family(officer_role(officer_id)) == "ah":
        final_scores["Team Development"] = team_readiness_average(officer_id)
    return final_scores


## HELPER
def grouped_scores(officer_id: str, summary: dict[str, Any]) -> dict[str, float]:
    blended_scores = final_competency_scores(officer_id, summary)
    core = average([blended_scores.get(name, 0) for name in CORE_COMPETENCIES])
    functional = average([blended_scores.get(name, 0) for name in FUNCTIONAL_COMPETENCIES])
    correspondence = average([blended_scores.get(name, 0) for name in CORRESPONDENCE_COMPETENCIES])
    leadership = average([blended_scores.get(name, 0) for name in LEADERSHIP_COMPETENCIES])
    customer_satisfaction = percentage(summary.get("average_ess_rating"), 5)
    return {
        "core": round(core or 0, 1),
        "functional": round(functional or 0, 1),
        "correspondence": round(correspondence or 0, 1),
        "leadership": round(leadership or 0, 1),
        "customer_satisfaction": round(customer_satisfaction, 1),
    }


def weighted_readiness_score(
    *,
    settings,
    core,
    functional,
    correspondence,
    leadership=0,
    include_leadership=False,
):
    active_weight = (
        settings["core_weight"]
        + settings["functional_weight"]
        + settings["correspondence_weight"]
        + (settings["leadership_weight"] if include_leadership else 0)
    )
    if not active_weight:
        return 0
    return (
        core * settings["core_weight"]
        + functional * settings["functional_weight"]
        + correspondence * settings["correspondence_weight"]
        + (leadership * settings["leadership_weight"] if include_leadership else 0)
    ) / active_weight


def weighted_readiness_completion(
    *,
    settings,
    scores: dict[str, float],
    thresholds: dict[str, float],
) -> float:
    active_weight = (
        settings["core_weight"]
        + settings["functional_weight"]
        + settings["correspondence_weight"]
        + (settings["leadership_weight"] if "leadership" in thresholds else 0)
    )
    if not active_weight:
        return 0

    total = 0.0
    for metric, weight_name in (
        ("core", "core_weight"),
        ("functional", "functional_weight"),
        ("correspondence", "correspondence_weight"),
        ("leadership", "leadership_weight"),
    ):
        if metric == "leadership" and metric not in thresholds:
            continue
        minimum = thresholds.get(metric, 100)
        value = scores.get(metric, 0)
        completion = percentage(value, minimum)
        total += completion * settings[weight_name]

    return total / active_weight


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
    final_scores = final_competency_scores(officer_id, summary)
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
def competency_groups(
    officer_id: str,
    include_development_ai: bool = True,
    include_leadership: bool = True,
) -> dict[str, list[dict[str, Any]]]:
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

    final_scores = final_competency_scores(officer_id, summary)
    development_summaries = (
        cached_competency_development_summaries(officer_id, summary, final_scores)
        if include_development_ai
        else {}
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
                    "development": development_summaries.get(name)
                    or "No AI development summary is available for this competency yet.",
                }
            )
        return rows

    groups = {
        "evidence_summary": evidence_summary,
        "core": make_rows(CORE_COMPETENCIES, final_scores),
        "functional": make_rows(FUNCTIONAL_COMPETENCIES, final_scores),
        "correspondence": make_rows(CORRESPONDENCE_COMPETENCIES, final_scores),
    }
    if include_leadership and officer_has_leadership(officer_id):
        groups["leadership"] = make_rows(LEADERSHIP_COMPETENCIES, final_scores)
    return groups


def generate_competency_development_summaries(
    officer_id: str,
    summary: dict[str, Any],
    final_scores: dict[str, float],
) -> dict[str, str]:
    if not ai_is_configured():
        return {}

    competency_names = [
        *CORE_COMPETENCIES,
        *FUNCTIONAL_COMPETENCIES,
        *CORRESPONDENCE_COMPETENCIES,
    ]
    if officer_has_leadership(officer_id):
        competency_names.extend(LEADERSHIP_COMPETENCIES)

    system = "You write concise, evidence-based competency development advice. Return JSON only."
    user = f"""
Return JSON in this exact shape:
{{
  "development_summaries": {{
    "Competency name": "1-2 sentence practical development summary"
  }}
}}

Rules:
- Write one summary for each competency listed below.
- Use only the supplied evidence.
- Do not invent events or behaviours.
- If evidence is thin, say what evidence is missing and what the officer should demonstrate next.
- Keep each summary specific and useful, not generic.

Competencies:
{json.dumps(competency_names, ensure_ascii=True)}

Scores:
{json.dumps(final_scores, ensure_ascii=True)}

Evidence:
{json.dumps(summary, ensure_ascii=True)}
"""
    try:
        result = chat(system, user)
    except Exception:
        return {}
    summaries = result.get("development_summaries", {})
    return {
        name: str(summaries.get(name, "")).strip()
        for name in competency_names
        if str(summaries.get(name, "")).strip()
    }


def competency_development_cache_key(
    officer_id: str,
    summary: dict[str, Any],
    final_scores: dict[str, float],
) -> str:
    material = {
        "provider": ai_provider(),
        "version": "competency-development-v2",
        "officer_id": officer_id,
        "scores": final_scores,
        "audit": summary.get("audit", [])[:10],
        "scorecard": summary.get("scorecard", [])[:10],
        "interactions": summary.get("interactions", [])[:5],
        "projects": summary.get("projects", [])[:5],
    }
    encoded = json.dumps(material, ensure_ascii=True, sort_keys=True, default=str)
    return "competency-development:" + hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def cached_competency_development_summaries(
    officer_id: str,
    summary: dict[str, Any] | None = None,
    final_scores: dict[str, float] | None = None,
) -> dict[str, str]:
    summary = summary or officer_summary(officer_id)
    final_scores = final_scores or final_competency_scores(officer_id, summary)
    cache_key = competency_development_cache_key(officer_id, summary, final_scores)
    with connect() as conn:
        row = conn.execute(
            "SELECT payload_json FROM ai_cache WHERE cache_key = ?",
            (cache_key,),
        ).fetchone()
    if not row:
        return {}
    payload = loads(row["payload_json"], {})
    return payload.get("development_summaries", {})


def generate_and_cache_competency_development_summaries(officer_id: str) -> int:
    summary = officer_summary(officer_id)
    final_scores = final_competency_scores(officer_id, summary)
    development_summaries = generate_competency_development_summaries(
        officer_id,
        summary,
        final_scores,
    )
    if not development_summaries:
        return 0
    cache_key = competency_development_cache_key(officer_id, summary, final_scores)
    with connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO ai_cache (cache_key, payload_json, created_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            """,
            (
                cache_key,
                dumps({"development_summaries": development_summaries}),
            ),
        )
    return len(development_summaries)


def ensure_competency_development_summaries(officer_id: str) -> int:
    summary = officer_summary(officer_id)
    final_scores = final_competency_scores(officer_id, summary)
    cached = cached_competency_development_summaries(officer_id, summary, final_scores)
    if cached or not ai_is_configured():
        return len(cached)
    return generate_and_cache_competency_development_summaries(officer_id)


## main function
def readiness_for(officer_id: str) -> dict[str, Any]:
    summary = officer_summary(officer_id)
    profile = profile_for(officer_id)
    scores = grouped_scores(officer_id, summary)
    has_leadership = officer_has_leadership(officer_id)

    ## load the readiness weights for this officer's current role
    with connect() as conn:
        settings_row = conn.execute(
            "SELECT * FROM readiness_settings WHERE role = ?",
            (configuration_role(officer_role(officer_id), leads_team=has_leadership),),
        ).fetchone()
        if settings_row is None:
            settings_row = conn.execute(
                "SELECT * FROM readiness_settings WHERE role = 'CSE'"
            ).fetchone()
        settings = dict(settings_row)
        ## loads all requirements from readiness_thresholds. sorted by meeting expectations, stretch assgn ready, career advancement ready; within sorted by sequence
        threshold_rows = conn.execute(
            """
            SELECT * FROM readiness_thresholds
            WHERE tier = ?
            ORDER BY CASE stage
              WHEN 'Meeting Expectations' THEN 1
              WHEN 'Stretch Assignment Ready' THEN 2
              ELSE 3 END,
              sequence
            """,
            (f"c?{role_tier(officer_role(officer_id))}",),
        ).fetchall()

    ## each score * its configured weight
    total = weighted_readiness_score(
        settings=settings,
        core=scores["core"],
        functional=scores["functional"],
        correspondence=scores["correspondence"],
        leadership=scores["leadership"],
        include_leadership=has_leadership,
    )

    all_scores = {
        **scores,
        "readiness": total,
    }

    ## { "Meeting Expectations": [...], "Stretch Assignment Ready": [...], "Career Advancement": [career advancement, core, core, 0.7, score, 1, 0.8, true]}
    thresholds_by_stage: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in threshold_rows:
        threshold = dict(row)
        if threshold["metric"] == "leadership" and not has_leadership:
            continue
        threshold["value"] = round(all_scores.get(threshold["metric"], 0), 1)
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
    threshold_scores = {
        item["metric"]: item["minimum_value"]
        for item in thresholds_by_stage[next_stage]
    }
    readiness_percent = weighted_readiness_completion(
        settings=settings,
        scores=scores,
        thresholds=threshold_scores,
    )

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
        "has_leadership": has_leadership,
        "radar_items": radar_items,
        "radar_polygon": radar_polygon,
        "component_scores": {
            "Core Competency": scores["core"],
            "Functional Competency": scores["functional"],
            "Correspondence Competency": scores["correspondence"],
            "Leadership Competency": scores["leadership"],
            "Customer Satisfaction": scores["customer_satisfaction"],
        },
    }


