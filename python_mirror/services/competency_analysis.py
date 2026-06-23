## creates the Learning Pathway / Competency Analysis result.

from __future__ import annotations

import hashlib
import json
from typing import Any

from db import connect, dumps, loads
from services.ai_client import ai_provider, chat
from services.metrics import compute_indicators

CORE_COMPETENCIES = [
    "Thinking Clearly & Making Sound Judgements",
    "Working as a Team",
    "Working Effectively with Citizens & Stakeholders",
    "Keep Learning & Putting Skills into Action",
    "Improving & Innovating Continuously",
    "Serving with Heart, Commitment & Purpose",
]

INDICATOR_COMPETENCY_MAP = {
    "Courtesy": "Serving with Heart, Commitment & Purpose",
    "Confidentiality": "Working Effectively with Citizens & Stakeholders",
    "Comprehend Intent": "Thinking Clearly & Making Sound Judgements",
    "Comply - Email Writing SOG": "Keep Learning & Putting Skills into Action",
    "Correct Information": "Thinking Clearly & Making Sound Judgements",
    "Complete Information": "Working Effectively with Citizens & Stakeholders",
    "Clear and Easy": "Working Effectively with Citizens & Stakeholders",
    "Meaningful Conversations": "Serving with Heart, Commitment & Purpose",
    "Cultivate Digital Awareness": "Improving & Innovating Continuously",
    "Verified Mistake": "Keep Learning & Putting Skills into Action",
}


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
            record["payload"] = loads(record.get("payload_json"), {})
            record.pop("payload_json", None)            ## remove raw json
    return records


## use recent_records to get recent rows from each table
def officer_summary(officer_id: str) -> dict[str, Any]:
    audit = recent_records("audit_records", officer_id, 30)
    ess = recent_records("ess_records", officer_id, 20)
    interactions = recent_records("interactions", officer_id, 10)
    indicators = compute_indicators(audit)

    ## just all the scores without the Nones
    scores = [record["total_score"] for record in audit if record.get("total_score") is not None]
    ratings = [record["rating"] for record in ess if record.get("rating") is not None]
    return {
        "officer_id": officer_id,

        "audit_count": len(audit),
        "ess_count": len(ess),
        "interaction_count": len(interactions),

        "average_audit_score": sum(scores) / len(scores) if scores else None,
        "average_ess_rating": sum(ratings) / len(ratings) if ratings else None,

        "indicators": indicators,

        "audit": audit[:10],            ## first 10
        "ess": ess[:10],
        "interactions": interactions[:5],
    }


## Generate competency gaps/pathway without AI (for when no AI key configured)
## summary.get for when missing keys are acceptable, summary[] when not
def local_analysis(summary: dict[str, Any]) -> dict[str, Any]:
    avg_score = summary.get("average_audit_score")
    avg_rating = summary.get("average_ess_rating")
    indicators = summary.get("indicators", [])
    weak = [item for item in indicators if item.get("level") == "Basic"]
    strong = [item for item in indicators if item.get("level") == "Advanced"]
    overall = "Advanced" if (avg_score or 0) >= 80 and (avg_rating or 0) >= 4 else "Intermediate" if (avg_score or 0) >= 60 or (avg_rating or 0) >= 3 else "Basic"
    return {
        "mode": "local_rules",
        "overall_level": overall,
        "summary": {
            "average_audit_score": avg_score,
            "average_ess_rating": avg_rating,
            "audit_count": summary["audit_count"],
            "ess_count": summary["ess_count"],
            "interaction_count": summary["interaction_count"],
        },
        "competency_gaps": [
            {
                "competency": INDICATOR_COMPETENCY_MAP.get(
                    indicator["name"],
                    "Working Effectively with Citizens & Stakeholders",
                ),
                "current_level": "Basic",
                "gap": f"Improve the {indicator['name']} indicator.",
                "evidence": (
                    f"{indicator['name']} is currently Basic "
                    f"from {indicator.get('sampleSize', 0)} audit records."
                ),
            }
            for indicator in weak
        ],
        "strengths": [
            f"{item['name']} is showing Advanced performance."
            for item in strong[:3]
        ],
        "learning_pathway": [
            "Review recent cases with low audit scores and identify repeat issues.",
            "Draft two improved response examples using clearer next steps.",
            "Discuss one member feedback example with TL/supervisor.",
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
- summary: a short factual overview based only on the supplied evidence.
- competency_gaps: competencies requiring improvement.
- strengths: positive behaviours supported by evidence.
- learning_pathway: practical development actions.
- risks: performance concerns requiring attention.

Return exactly this JSON structure:
{{
  "overall_level": "Basic|Intermediate|Advanced",
  "summary": {{
    "average_audit_score": number or null,
    "average_ess_rating": number or null,
    "assessment": "short evidence-based explanation"
  }},
  "competency_gaps": [
    {{
      "competency": "competency name",
      "current_level": "Basic|Intermediate|Advanced",
      "gap": "specific improvement needed",
      "evidence": "specific evidence from the supplied data"
    }}
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
- Return empty lists when no evidence supports a section.
- Do not treat missing data as poor performance.
- Return JSON only.

Data:
{json.dumps(summary, ensure_ascii=True)}
"""                                         ## Data: tells the AI: use this data for your analysis, need be json so dumps
    result = chat(system, user)             ## chat calls azure/claude/openai depending on the .env, the AI returns json as instructed above, then get loads into python
    result["mode"] = "ai"                   ## ai_analysis or local_analysis
    return result


## main function
def analyse_officer(officer_id: str, use_ai: bool) -> dict[str, Any]:
    summary = officer_summary(officer_id)
    if use_ai:
        summary_text = json.dumps(summary, ensure_ascii=True, sort_keys=True)
        cache_material = f"{ai_provider()}:{summary_text}"
        cache_key = "competency-analysis:" + hashlib.sha256(
            cache_material.encode("utf-8")
        ).hexdigest()
        with connect() as conn:
            cached_row = conn.execute(
                "SELECT payload_json FROM ai_cache WHERE cache_key = ?",
                (cache_key,),
            ).fetchone()
        if cached_row:
            cached_result = loads(cached_row["payload_json"], {})
            cached_result["mode"] = "ai_cached"
            return cached_result
        try:
            result = ai_analysis(summary)
            with connect() as conn:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO ai_cache (cache_key, payload_json, created_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                    """,
                    (cache_key, dumps(result)),
                )
            return result
        except Exception as exc:
            fallback = local_analysis(summary)
            fallback["mode"] = "local_rules_after_ai_error"
            fallback["ai_error"] = str(exc)
            return fallback
    return local_analysis(summary)
