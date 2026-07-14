## creates the Learning Pathway / Competency Analysis result.

from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta
from typing import Any

from db import connect, dumps, loads
from services.ai_client import ai_provider, chat
from services.metrics import compute_indicators

from services.competency_scoring import (
    blended_competency_score,
    score_audit_for_all_competencies,
    score_scorecard_for_all_competencies,
)


## Get recent (limit) rows from one database table for one officer.
def recent_records(table: str, officer_id: str, limit: int = 20) -> list[dict[str, Any]]:
    with connect() as conn:
        ## ? because officer_id and limit can be special characters that break the code
        rows = conn.execute(
            f"""
            SELECT * FROM {table}
            WHERE officer_id = ?
            ORDER BY upload_date DESC, id DESC
            LIMIT ?
            """,
            (officer_id, limit),
        ).fetchall()
    records = [dict(row) for row in rows]
    for record in records:
        if "payload_json" in record:
            payload = loads(record.get("payload_json"), {})
            record["payload"] = payload
            record.update(payload)
            record.pop("payload_json", None)            ## remove raw json
    return records


def recent_projects(officer_id: str, limit: int = 10) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM project_records
            WHERE officer_id = ?
            ORDER BY updated_at DESC, id DESC
            LIMIT ?
            """,
            (officer_id, limit),
        ).fetchall()
    return [dict(row) for row in rows]


## use recent_records to get recent rows from each table
def officer_summary(officer_id: str) -> dict[str, Any]:
    audit = recent_records("audit_records", officer_id, 30)
    scorecard = recent_records("scorecard_records", officer_id, 30)
    ess = recent_records("ess_records", officer_id, 20)
    interactions = recent_records("interactions", officer_id, 10)
    projects = recent_projects(officer_id, 10)
    indicators = compute_indicators(audit)
    ess_cutoff = date.today() - timedelta(days=365)
    recent_ess = []
    for record in ess:
        try:
            if date.fromisoformat(record["upload_date"]) >= ess_cutoff:
                recent_ess.append(record)
        except (TypeError, ValueError):
            pass

    ## just all the scores without the Nones
    scores = [record["total_score"] for record in audit if record.get("total_score") is not None]
    ratings = [ record["rating"] for record in recent_ess if record.get("rating") is not None and record.get("is_valid", 1) ]
    return {
        "officer_id": officer_id,

        "audit_count": len(audit),
        "scorecard_count": len(scorecard),
        "ess_count": len(ess),
        "interaction_count": len(interactions),
        "project_count": len(projects),

        "average_audit_score": sum(scores) / len(scores) if scores else None,
        "average_ess_rating": sum(ratings) / len(ratings) if ratings else None,

        "indicators": indicators,

        "audit": audit[:10],            ## first 10
        "scorecard": scorecard[:10],
        "ess": recent_ess[:10],
        "interactions": interactions[:5],
        "projects": projects[:5],
    }


## Generate competency gaps/pathway without AI (for when no AI key configured)
## summary.get for when missing keys are acceptable, summary[] when not
def local_analysis(summary: dict[str, Any]) -> dict[str, Any]:
    avg_rating = summary.get("average_ess_rating")
    audit_scores = score_audit_for_all_competencies(summary.get("audit", []))
    scorecard_scores = score_scorecard_for_all_competencies(summary.get("scorecard", []))
    final_scores = blended_competency_score(
        summary["officer_id"],
        audit_scores,
        scorecard_scores,
    )
    scored_items = [
        {"name": name, "score": score}
        for name, score in final_scores.items()
    ]
    weak = [item for item in scored_items if item["score"] < 60]
    strong = [item for item in scored_items if item["score"] >= 80]
    avg_score = (
        sum(item["score"] for item in scored_items) / len(scored_items)
        if scored_items
        else None
    )
    overall = (
        "Advanced" if (avg_score or 0) >= 80
        else "Intermediate" if (avg_score or 0) >= 60
        else "Basic"
    )
    return {
        "mode": "local_rules",
        "overall_level": overall,
        "summary": {
            "average_audit_score": summary.get("average_audit_score"),
            "competency_evidence_average": avg_score,
            "average_ess_rating": avg_rating,
            "audit_count": summary["audit_count"],
            "scorecard_count": summary["scorecard_count"],
            "ess_count": summary["ess_count"],
            "interaction_count": summary["interaction_count"],
            "project_count": summary["project_count"],
            "assessment": (
                "The local summary is based on blended audit, scorecard, interaction, and project evidence. "
                "Enable AI to receive a fuller written trend analysis."
            ),
        },
        "competency_gaps": [
            {
                "competency": item["name"],
                "current_level": "Basic",
                "gap": f"Improve {item['name']}.",
                "evidence": (
                    f"{item['name']} is currently {item['score']:.1f} "
                    f"from blended competency evidence."
                ),
            }
            for item in weak
        ],
        "customer_feedback_trends": [],
        "evidence_trends": [
            "The local fallback can score available evidence, but AI is needed for a written trend summary across audit, scorecard, interactions, and projects."
        ],
        "interaction_observations": [],
        "project_observations": [],
        "improvement_advice": [
            "Review recent ESS comments and interaction replies with a TL, CSM, or AH."
        ],
        "strengths": [
            f"{item['name']} is showing Advanced performance at {item['score']:.1f}."
            for item in strong[:3]
        ],
        "learning_pathway": [
            "Review recent cases, scorecard items, interactions, and project evidence to identify repeat issues.",
            "Draft two improved response examples using clearer next steps.",
            "Discuss one member feedback example with a TL, CSM, or AH.",
            "Re-check the next upload against the weak indicators.",
        ],
        "risks": [
            f"{item['name']} may need coaching."
            for item in weak[:3]
        ],
    }


## Send summary data to approved AI provider and ask for JSON result.
## user = """ ... """
def ai_analysis(summary: dict[str, Any]) -> dict[str, Any]:
    ## system prompt, This tells the AI: what role to perform, what output format to use (do not reply conversationally, json only). The system prompt has higher priority than the normal user prompt.

    system = (
        "You are a competency coach for a public service correspondence quality app. "
        "Return only valid JSON. Do not include markdown."
    )
    user = f"""
Analyse the officer evidence below.

Definitions:
- overall_level: the officer's overall competency level. Must be Basic, Intermediate, or Advanced.
- summary: a short written overview based only on the supplied evidence.
- evidence_trends: written trends from audit, scorecard, interaction, and project evidence.
- customer_feedback_trends: written trends from ESS/customer feedback.
- interaction_observations: written observations from member_query and officer_response evidence.
- project_observations: written observations from project requirements, evidence, and project manager comments.
- competency_gaps: competencies requiring improvement.
- strengths: positive behaviours supported by evidence.
- learning_pathway: practical development actions.
- risks: performance concerns requiring attention.

Return exactly this JSON structure:
{{
    "overall_level": "Basic|Intermediate|Advanced",
    "summary": {{
        "assessment": "short evidence-based explanation"
    }},
    "evidence_trends": [
        "trend from audit, scorecard, interaction, or project evidence"
    ],
    "competency_gaps": [
        {{
        "competency": "competency name",
        "current_level": "Basic|Intermediate|Advanced",
        "gap": "specific improvement needed",
        "evidence": "specific evidence from the supplied data"
        }}
    ],
    "customer_feedback_trends": [
        "trend from ESS/customer feedback"
    ],
    "interaction_observations": [
    "trend from member query/officer response evidence"
    ],
    "project_observations": [
    "trend from project requirement/evidence/project manager comment evidence"
    ],
    "improvement_advice": [
    "specific practical improvement advice"
    ],
    "strengths": [
        "specific evidence-supported strength"
    ],
    "learning_pathway": [
        "specific practical development action"
    ],
    "risks": [
        "specific evidence-supported risk"
    ]
}}

Rules:
- Use only the supplied evidence.
- Do not invent scores, events, feedback, or behaviours.
- average_ess_rating has already been calculated by the app using valid ESS only. Do not recalculate average_ess_rating.
- ESS/customer feedback must be used only for customer feedback trends and improvement advice.
- Invalid ESS must not lower the officer's level or rating, but the feedback text may still be mentioned as a recurring theme if supported by the supplied records.
- Audit and scorecard should be used to describe quality/performance patterns, not just quote numbers.
- Interactions should be used to identify response quality patterns from member_query and officer_response.
- Projects should be used to describe how well project evidence appears to meet requirements and project manager comments.
- The dashboard summary should be written in natural language for the officer. Avoid simply listing scores.
- Return empty lists when no evidence supports a section.
- Do not treat missing data as poor performance.
- Return JSON only.

Data:
{json.dumps(summary, ensure_ascii=True)}
"""                                         ## Data: tells the AI: use this data for your analysis, need be json so dumps
    result = chat(system, user)             ## chat calls azure/claude/openai depending on the .env, the AI returns json as instructed above, then get loads into python
    result["mode"] = "ai"                   ## ai_analysis or local_analysis
    return result


def ai_cache_key(summary: dict[str, Any]) -> str:
    summary_text = json.dumps(summary, ensure_ascii=True, sort_keys=True)
    cache_material = f"{ai_provider()}:dashboard-summary-v2:{summary_text}"
    return "competency-analysis:" + hashlib.sha256(
        cache_material.encode("utf-8")
    ).hexdigest()


def cached_ai_analysis(summary: dict[str, Any]) -> dict[str, Any] | None:
    cache_key = ai_cache_key(summary)
    with connect() as conn:
        cached_row = conn.execute(
            "SELECT payload_json FROM ai_cache WHERE cache_key = ?",
            (cache_key,),
        ).fetchone()
    if not cached_row:
        return None
    cached_result = loads(cached_row["payload_json"], {})
    cached_result["mode"] = "ai_cached"
    return cached_result


## main function
def analyse_officer(officer_id: str, use_ai: bool) -> dict[str, Any]:
    summary = officer_summary(officer_id)
    if use_ai:
        cached_result = cached_ai_analysis(summary)
        if cached_result:
            return cached_result
        try:
            result = ai_analysis(summary)
            with connect() as conn:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO ai_cache (cache_key, payload_json, created_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    """,
                    (ai_cache_key(summary), dumps(result)),
                )
            return result
        except Exception as exc:
            fallback = local_analysis(summary)
            fallback["mode"] = "local_rules_after_ai_error"
            fallback["ai_error"] = str(exc)
            return fallback
    return local_analysis(summary)


def analyse_officer_cached_or_local(officer_id: str) -> dict[str, Any]:
    summary = officer_summary(officer_id)
    cached_result = cached_ai_analysis(summary)
    if cached_result:
        return cached_result
    return local_analysis(summary)
