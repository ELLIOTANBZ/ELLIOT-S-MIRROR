from db import connect
import json
from services.ai_client import chat
from services.calculations import average, normalise_column_name
from services.metrics import parse_pass_fail
from typing import Any


CORE_COMPETENCIES = [
    "Thinking Clearly & Making Sound Judgements",
    "Working as a Team",
    "Working Effectively with Citizens & Stakeholders",
    "Keep Learning & Putting Skills into Action",
    "Improving & Innovating Continuously",
    "Serving with Heart, Commitment & Purpose",
]

FUNCTIONAL_COMPETENCIES = [
    "Case Management",
    "Tech Application",
    "Data Management",
    "Digital Design and Management",
    "Service Operations Planning",
]

CORRESPONDENCE_COMPETENCIES = [
    "Empathetic Writing",
    "Direct Reply",
    "Active Listening",
    "Customer Obsessed",
    "Problem Solving",
]

LEADERSHIP_COMPETENCIES = [
    "Personal Development",
    "Team Development",
    "Stakeholder Development",
]

AUDIT_INDICATOR_COMPETENCY_MAP = {
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

AUDIT_CORE_COMPETENCY_FIELDS = {
    "Thinking Clearly & Making Sound Judgements": ["Comprehend Intent", "Correct Information", "Verified Mistake"],
    "Working as a Team": [],
    "Working Effectively with Citizens & Stakeholders": ["Courtesy", "Comprehend Intent", "Meaningful Conversations"],
    "Keep Learning & Putting Skills into Action": ["Comply - Email Writing SOG"],
    "Improving & Innovating Continuously": [],
    "Serving with Heart, Commitment & Purpose": ["Courtesy", "Meaningful Conversations"],
}

AUDIT_FUNCTIONAL_COMPETENCY_FIELDS = {
    "Case Management": ["Comprehend Intent", "Correct Information", "Complete Information", "Meaningful Conversations", "Verified Mistake"],
    "Tech Application": ["Cultivate Digital Awareness"],
    "Data Management": ["Confidentiality"],
    "Digital Design and Management": ["Cultivate Digital Awareness"],
    "Service Operations Planning": [],
}

AUDIT_CORRESPONDENCE_COMPETENCY_FIELDS = {
    "Empathetic Writing": ["Meaningful Conversations", "Courtesy"],
    "Direct Reply": ["Complete Information", "Clear and Easy"],
    "Active Listening": ["Comprehend Intent"],
    "Customer Obsessed": ["Meaningful Conversations", "Cultivate Digital Awareness"],
    "Problem Solving": ["Complete Information", "Correct Information", "Comprehend Intent"],
}

AUDIT_LEADERSHIP_COMPETENCY_FIELDS = {
    "Personal Development": ["Personal Development"],
    "Team Development": ["Team Development"],
    "Stakeholder Development": ["Stakeholder Development"],
}


## the actual column names
SCORECARD_CRITERIAS = [
    "Corr Handled/ wd",
    "Attendance",
    "SIP",
    "ROSE",
    "SCQ",
    "Data Breach",
    "RAMP/GRIT: 5% Online Feedback: 2%",
    "No WTU OSS"
]

SCORECARD_CORE_COMPETENCY_FIELDS = {
    "Thinking Clearly & Making Sound Judgements": ["SIP", "ROSE", "Data Breach"],
    "Working as a Team": ["Attendance", "No WTU OSS"],
    "Working Effectively with Citizens & Stakeholders": ["SIP"],
    "Keep Learning & Putting Skills into Action": ["SCQ", "RAMP/GRIT: 5% Online Feedback: 2%"],
    "Improving & Innovating Continuously": ["RAMP/GRIT: 5% Online Feedback: 2%"],
    "Serving with Heart, Commitment & Purpose": ["SIP", "ROSE"],
}

SCORECARD_FUNCTIONAL_COMPETENCY_FIELDS = {
    "Case Management": ["Corr Handled/ wd", "Attendance", "SIP", "ROSE"],
    "Tech Application": ["SCQ", "RAMP/GRIT: 5% Online Feedback: 2%"],
    "Data Management": ["Data Breach"],
    "Digital Design and Management": ["RAMP/GRIT: 5% Online Feedback: 2%"],
    "Service Operations Planning": ["Corr Handled/ wd", "Attendance", "RAMP/GRIT: 5% Online Feedback: 2%"],
}

SCORECARD_CORRESPONDENCE_COMPETENCY_FIELDS = {
    "Empathetic Writing": [],
    "Direct Reply": [],
    "Active Listening": [],
    "Customer Obsessed": ["RAMP/GRIT: 5% Online Feedback: 2%"],
    "Problem Solving": ["ROSE"],
}

SCORECARD_LEADERSHIP_COMPETENCY_FIELDS = {
    "Personal Development": ["Personal Development"],
    "Team Development": ["Team Development"],
    "Stakeholder Development": ["Stakeholder Development"],
}


COMPETENCY_SOURCE_WEIGHT_DEFAULTS = {
    "audit_weight": 0.34,
    "scorecard_weight": 0.33,
    "interaction_weight": 0.33,
    "project_weight": 0.10,
}

COMPETENCY_DESCRIPTIONS = {
    "Thinking Clearly & Making Sound Judgements": "Analyse situations logically and make well-reasoned decisions.",
    "Working as a Team": "Collaborate effectively with colleagues to achieve shared goals.",
    "Working Effectively with Citizens & Stakeholders": "Build positive relationships and deliver value to citizens and partners.",
    "Keep Learning & Putting Skills into Action": "Develop skills proactively and apply learning on the job.",
    "Improving & Innovating Continuously": "Identify and implement improvements to processes and services.",
    "Serving with Heart, Commitment & Purpose": "Demonstrate dedication, integrity, and purpose-driven service.",
    "Case Management": "Manage citizen cases end-to-end with accuracy and empathy.",
    "Tech Application": "Apply digital tools and systems to improve service delivery.",
    "Data Management": "Handle, validate, and maintain accurate service data.",
    "Digital Design and Management": "Design and manage effective digital service experiences.",
    "Service Operations Planning": "Plan and coordinate service operations for efficiency.",
    "Empathetic Writing": "Demonstrate empathy and sensitivity in written communications.",
    "Direct Reply": "Provide clear, concise, and direct responses to citizen queries.",
    "Active Listening": "Demonstrate attentiveness and understanding in communications.",
    "Customer Obsessed": "Prioritise citizen needs and satisfaction in correspondence.",
    "Problem Solving": "Identify and resolve citizen issues effectively through correspondence.",
    "Personal Development": "Develop leadership capability and self-awareness continuously.",
    "Team Development": "Coach, mentor, and develop team members' capabilities.",
    "Stakeholder Development": "Build and sustain strategic stakeholder relationships.",
}


ALL_SCORABLE_COMPETENCIES = [
    *CORE_COMPETENCIES,
    *FUNCTIONAL_COMPETENCIES,
    *CORRESPONDENCE_COMPETENCIES,
]

AH_SCORABLE_COMPETENCIES = [
    *CORE_COMPETENCIES,
    *FUNCTIONAL_COMPETENCIES,
    *CORRESPONDENCE_COMPETENCIES,
    *LEADERSHIP_COMPETENCIES,
]


## Fill these in later when the role-specific competency requirements are confirmed.
## These are used by AI scoring for interactions and projects.
ROLE_COMPETENCY_REQUIREMENTS = {
    "CSE": {
        competency_name: ""
        for competency_name in ALL_SCORABLE_COMPETENCIES
    },
    "TL": {
        competency_name: ""
        for competency_name in ALL_SCORABLE_COMPETENCIES
    },
    "CSM": {
        competency_name: ""
        for competency_name in ALL_SCORABLE_COMPETENCIES
    },
    "AH": {
        competency_name: ""
        for competency_name in AH_SCORABLE_COMPETENCIES
    },
}


INTERACTIONS_AI_RUBRICS = {
    "Thinking Clearly & Making Sound Judgements": ["quality of reasoning in replies", "how staff handle complex or ambiguous cases", "whether staff identify and correct errors before sending"],
    "Working as a Team": [],
    "Working Effectively with Citizens & Stakeholders": ["adapting tone and approach to different customer types", "handling of emotionally charged interactions", "explaining complex policies in accesible language"],
    "Keep Learning & Putting Skills into Action": ["improvement in reply quality over time", "correct application of updated policies or procedures", "use of new tools or approaches in replies"],
    "Improving & Innovating Continuously": ["creative or non-standard approaches to resolving recurring issues", "replies that go beyond templated responses to find better solutions"],
    "Serving with Heart, Commitment & Purpose": ["genuine care in tone", "going beyond standard response", "follow-through language on complex cases", "personalisation of replies rather than templated responses"],
    "Case Management": ["handling of complex multi-departmental cases", "appropriate escalation language", " rapport building across different customer types", "evidence of thorough case resolution"],
    "Tech Application": ["references to digital tools in replies", "guiding customers to self-service options", "troubleshooting language for common digital issues"],
    "Data Management": ["accurate referencing of customer data in replies", "appropriate handling of sensitive information", "absence of data disclosure errors"],
    "Digital Design and Management": ["suggestions for digital improvements reference in replies or feedback", "language that reflects awareness of customer digital journey"],
    "Service Operations Planning": ["efficiency and structure of replies", "language that reflects awareness of service standards and channel management"],
    "Empathetic Writing": ["Tone and warmth of opening and closing", "acknowledgement of customer's emotions", "use of empathetic phrases", "absence of cold or transactional language"],
    "Direct Reply": ["clear structure of reply", "absence of ambiguity", "direct addressing of customer's question without unnecessary filter"],
    "Active Listening": ["whether reply addresses the underlying concern and not just the surface question", "picking up on emotional cues in customer's message", "addressing all parts of a multi-part query"],
    "Customer Obsessed": ["going beyong standard response, anticipating follow-up needs, proactive sharing of relevant information not explicitly asked for"],
    "Problem Solving": ["connecting multiple policies in a single reply", "anticipating follow-up issues", "providing comprehensive solutions that address edge cases"],
    "Personal Development": [],
    "Team Development": [],
    "Stakeholder Development": [],
}


def officer_role_for_ai(officer_id: str) -> str:
    with connect() as conn:
        row = conn.execute(
            "SELECT role FROM users WHERE id = ?",
            (officer_id,),
        ).fetchone()
    return row["role"] if row else "CSE"


def scorable_competencies_for_role(role: str) -> list[str]:
    if role == "AH":
        return AH_SCORABLE_COMPETENCIES
    return ALL_SCORABLE_COMPETENCIES


def role_competency_requirements(role: str) -> dict[str, dict[str, str]]:
    requirements = ROLE_COMPETENCY_REQUIREMENTS.get(role, {})
    return {
        competency_name: {
            "general_description": COMPETENCY_DESCRIPTIONS.get(competency_name, ""),
            "role_requirement": requirements.get(competency_name, ""),
        }
        for competency_name in scorable_competencies_for_role(role)
    }


def score_audit_for_one_competency(records: list[dict[str, Any]], indicator_names: list[str]) -> float | None:
    wanted_names = {normalise_column_name(indicator) for indicator in indicator_names}
    values = []
    for record in records:
        for key, value in record.items():
            if normalise_column_name(str(key)) not in wanted_names:
                continue
            parsed = parse_pass_fail(value)
            if parsed is not None:
                values.append(parsed * 100)
                break
    if not values:
        return None
    return round(average(values) or 0, 1)


## calculates scores for one group of competencies from audit records.
## competency: "Thinking Clearly & Making Sound Judgements", indicators: ["Comprehend Intent", "Correct Information"]
## returns { "Thinking Clearly & Making Sound Judgements": 80, "Working as a Team": 90, ... } (all 6 core)
def score_audit_for_one_group_of_competencies( records: list[dict[str, Any]], field_map: dict[str, list[str]], ) -> dict[str, float]:
    scores = {}
    for competency, indicators in field_map.items():
        score = score_audit_for_one_competency(records, indicators)
        if score is not None:
            scores[competency] = score
    return scores

## all <16 competencies with their audit scores in 1 dict
def score_audit_for_all_competencies(records: list[dict[str, Any]]) -> dict[str, float]:
    scores = {}
    scores.update(score_audit_for_one_group_of_competencies(records, AUDIT_CORE_COMPETENCY_FIELDS))
    scores.update(score_audit_for_one_group_of_competencies(records, AUDIT_FUNCTIONAL_COMPETENCY_FIELDS))
    scores.update(score_audit_for_one_group_of_competencies(records, AUDIT_CORRESPONDENCE_COMPETENCY_FIELDS))
    return scores


def scorecard_contribution_to_points(score: float, weight: float) -> tuple[float, float]:

    ## for Q6
    if weight < 0:
        max_score = abs(weight)
        achieved = max_score + score
    ## the rest
    else:
        max_score = weight
        achieved = score

    achieved = max(0, min(max_score, achieved))
    return achieved, max_score


def score_scorecard_for_one_competency(records: list[dict[str, Any]], criteria_names: list[str]) -> float | None:
    wanted_names = {normalise_column_name(criteria) for criteria in criteria_names}
    values = []
    for record in records:
        achieved_total = 0
        max_score_total = 0
        for key, value in record.items():
            if normalise_column_name(str(key)) not in wanted_names:
                continue

            if not isinstance(value, dict):
                continue

            try:
                score = float(value.get("score", 0))
                weight = float(value.get("weight", 0))
            except (TypeError, ValueError):
                continue

            achieved, max_score = scorecard_contribution_to_points(score, weight)
            achieved_total += achieved
            max_score_total += max_score

        if max_score_total:
            values.append(achieved_total / max_score_total * 100)

    if not values:
        return None
    return round(average(values) or 0, 1)           ## average across the diff months


def score_scorecard_for_one_group_of_competencies( records: list[dict[str, Any]], field_map: dict[str, list[str]], ) -> dict[str, float]:
    scores = {}
    for competency, criterias in field_map.items():
        score = score_scorecard_for_one_competency(records, criterias)
        if score is not None:
            scores[competency] = score
    return scores

## all <16 competencies with their scorecard scores in 1 dict
def score_scorecard_for_all_competencies(records: list[dict[str, Any]]) -> dict[str, float]:
    scores = {}
    scores.update(score_scorecard_for_one_group_of_competencies(records, SCORECARD_CORE_COMPETENCY_FIELDS))
    scores.update(score_scorecard_for_one_group_of_competencies(records, SCORECARD_FUNCTIONAL_COMPETENCY_FIELDS))
    scores.update(score_scorecard_for_one_group_of_competencies(records, SCORECARD_CORRESPONDENCE_COMPETENCY_FIELDS))
    return scores


## looks at an interaction, returns AI feedback in a json (list has 16 dicts)
def score_interaction_with_ai(interaction: dict[str, Any], role: str) -> list[dict[str, Any]]:
    system = (
        "You are accessing a public service officer's written response"
        "Return only valid JSON. Do not include markdown."
    )

    competencies = {
        name: {
            **role_competency_requirements(role)[name],
            "interaction_rubric": INTERACTIONS_AI_RUBRICS.get(name, []),
        }
        for name in ALL_SCORABLE_COMPETENCIES
    }

    user = f"""
The officer's role is: {role}

Score the officer response against these role-specific competency requirements:
{json.dumps(competencies, ensure_ascii=True)}

Member query:
{interaction["member_query"]}

Officer response:
{interaction["officer_response"]}

Rules:
- Score from 0 to 100,
- Only score based on the officer response.
- If there is not enough evidence for a competency, use score 0 and explain "No evidence".
- Return one row for every competency.


Return JSON in this exact shape:
{{
    "scores": [
        {{
            "competency_name": "competency name",
            "score": 0,
            "rationale": "short reason"
        }}
    ]
}}
"""

    result = chat(system, user)
    return result.get("scores", [])

## store AI results of score_interactions_with_ai into SQLite, returns how many score rows were saved
def score_interactions_for_officer(officer_id: str) -> int:
    role = officer_role_for_ai(officer_id)
    if role == "AH":
        return 0
    with connect() as conn:
        interactions = [
            dict(row)
            for row in conn.execute(
                """
                SELECT *
                FROM interactions
                WHERE officer_id = ?
                ORDER BY upload_date DESC, id DESC
                """,
                (officer_id,),
            ).fetchall()
        ]

    saved_count = 0

    with connect() as conn:
        ## x times, where x = #interactions of officer
        for interaction in interactions:
            scores = score_interaction_with_ai(interaction, role)

            ## 16 times, store into SQLite
            for item in scores:
                competency_name = str(item.get("competency_name", "")).strip()
                score = item.get("score")
                rationale = str(item.get("rationale", "")).strip()

                if not competency_name or score is None:
                    continue

                conn.execute(
                    """
                    INSERT INTO competency_evidence_scores
                    (officer_id, source_type, source_record_id, competency_name, score, rationale, updated_at)
                     VALUES ( ?, 'interaction', ?, ?, ?, ?, CURRENT_TIMESTAMP )
                    ON CONFLICT (source_type, source_record_id, competency_name)
                    DO UPDATE SET
                        score = excluded.score,
                        rationale = excluded.rationale,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (officer_id, interaction["id"], competency_name, score, rationale,)
                )

                saved_count += 1
    return saved_count

## HELPER: looks at a project, returns AI feedback in a json (list has 16 dicts)
def score_project_with_ai(project: dict[str, Any], role: str) -> list[dict[str, Any]]:
    system = (
        "You are assessing project evidence for public service officer competencies. "
        "Return only valid JSON. Do not include markdown."
    )

    competencies = role_competency_requirements(role)

    user = f"""
The officer's role is: {role}

Score the project evidence against these role-specific competency requirements:
{json.dumps(competencies, ensure_ascii=True)}

Project Name:
{project["project_name"]}

Project requirements:
{project["requirements_text"]}

What was done:
{project["evidence_text"]}

Project lead comments:
{project["supervisor_comments"]}

Rules:
- Score from 0 to 100,
- Score based on how well the evidence meets the requirements and project lead comments.
- Use project lead comments as supporting evidence.
- If there is not enough evidence for a competency, use score 0 and explain "No evidence".
- Return one row for every competency.


Return JSON in this exact shape:
{{
    "scores": [
        {{
            "competency_name": "competency name",
            "score": 0,
            "rationale": "short reason"
        }}
    ]
}}
"""

    result = chat(system, user)
    return result.get("scores", [])

## store AI results of score_projects_with_ai into SQLite, returns how many score rows were saved
def score_projects_for_officer(officer_id: str) -> int:
    role = officer_role_for_ai(officer_id)
    with connect() as conn:
        projects = [
            dict(row)
            for row in conn.execute(
                """
                SELECT *
                FROM project_records
                WHERE officer_id = ?
                ORDER BY updated_at DESC, id DESC
                """,
                (officer_id,),
            ).fetchall()
        ]

    saved_count = 0

    with connect() as conn:
        ## x times, where x = #projects of officer
        for project in projects:
            scores = score_project_with_ai(project, role)

            ## 16 times, store into SQLite
            for item in scores:
                competency_name = str(item.get("competency_name", "")).strip()
                score = item.get("score")
                rationale = str(item.get("rationale", "")).strip()

                if not competency_name or score is None:
                    continue

                conn.execute(
                    """
                    INSERT INTO competency_evidence_scores
                    (officer_id, source_type, source_record_id, competency_name, score, rationale, updated_at)
                     VALUES ( ?, 'project', ?, ?, ?, ?, CURRENT_TIMESTAMP )
                    ON CONFLICT (source_type, source_record_id, competency_name)
                    DO UPDATE SET
                        score = excluded.score,
                        rationale = excluded.rationale,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (officer_id, project["id"], competency_name, score, rationale,)
                )

                saved_count += 1
    return saved_count


def score_evidence_for_officer(officer_id: str) -> dict[str, int]:
    return {
        "interaction_scores": score_interactions_for_officer(officer_id),
        "project_scores": score_projects_for_officer(officer_id),
    }


## get average AI score for each competency from interactions OR projects for an officer
def evidence_score_map(officer_id: str, source_type: str) -> dict[str, float]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT competency_name, AVG(score) as score
            FROM competency_evidence_scores
            WHERE officer_id = ? AND source_type = ?
            GROUP BY competency_name
            """,
            (officer_id, source_type),
        ).fetchall()

    return { row["competency_name"]: round(row["score"], 1) for row in rows }


def evidence_score_map_between(
    officer_id: str,
    source_type: str,
    start_date: str,
    end_date: str,
) -> dict[str, float]:
    source_table = {
        "interaction": ("interactions", "upload_date"),
        "project": ("project_records", "date(source.updated_at)"),
    }[source_type]
    table_name, date_column = source_table
    with connect() as conn:
        rows = conn.execute(
            f"""
            SELECT scores.competency_name, AVG(scores.score) as score
            FROM competency_evidence_scores scores
            JOIN {table_name} source
              ON source.id = scores.source_record_id
            WHERE scores.officer_id = ?
              AND scores.source_type = ?
              AND {date_column} BETWEEN ? AND ?
            GROUP BY scores.competency_name
            """,
            (officer_id, source_type, start_date, end_date),
        ).fetchall()

    return {row["competency_name"]: round(row["score"], 1) for row in rows}


## read the admin source weights (audit, interactions, projects)
def source_weight_map(role: str) -> dict[str, dict[str, float]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT competency_name, audit_weight, scorecard_weight, interaction_weight, project_weight
            FROM competency_source_weights
            WHERE role = ?
            """
            ,
            (role,),
        ).fetchall()

    return {
        row["competency_name"]: {
            "audit": row["audit_weight"],
            "scorecard": row["scorecard_weight"],
            "interaction": row["interaction_weight"],
            "project": row["project_weight"],
        }
        for row in rows
    }


## combine audit, scorecard, interaction, and project scores
def blended_competency_score(
    officer_id: str,
    audit_scores: dict[str, float],
    scorecard_scores: dict[str, float],
    interaction_scores: dict[str, float] | None = None,
    project_scores: dict[str, float] | None = None,
) -> dict[str, float]:
    role = officer_role_for_ai(officer_id)
    if interaction_scores is None:
        interaction_scores = evidence_score_map(officer_id, "interaction")
    if project_scores is None:
        project_scores = evidence_score_map(officer_id, "project")

    if role == "AH":
        return {
            competency_name: round(project_scores.get(competency_name, 0), 1)
            for competency_name in AH_SCORABLE_COMPETENCIES
        }

    weights = source_weight_map(role)

    final_scores = {}

    all_competencies = set(audit_scores) | set(scorecard_scores) | set(interaction_scores) | set(project_scores)

    for competency_name in all_competencies:           ## audit_scores: {"Working as a Team": 80, ...}
        source_weights = weights.get(competency_name, {})
        base_sources = []

        audit_score = audit_scores.get(competency_name)
        if audit_score is not None:
            base_sources.append(("audit", audit_score))

        scorecard_score = scorecard_scores.get(competency_name)
        if scorecard_score is not None:
            base_sources.append(("scorecard", scorecard_score))

        if competency_name in interaction_scores:                       ## does interaction_scores have a key called (competency_name)?
            base_sources.append(("interaction", interaction_scores[competency_name]))

        if role == "CSE":
            available_weight = sum(source_weights.get(source_name, 0) for source_name, _ in base_sources)
            if not base_sources or available_weight == 0:
                base_total = 0
            else:
                base_total = sum(
                    score * (source_weights.get(source_name, 0) / available_weight)
                    for source_name, score in base_sources
                )

            project_bonus = 0
            if competency_name in project_scores:
                project_bonus = project_scores[competency_name] * source_weights.get("project", 0)

            final_scores[competency_name] = round(min(100, base_total + project_bonus), 1)
            continue

        ## so sources = [ ("audit", 80), ("scorecard", 60), ("interaction", 70), ("project", 90), ] for this 1 competency
        sources = list(base_sources)
        if competency_name in project_scores:
            sources.append(("project", project_scores[competency_name]))

        ## if no projects done, then dont lower the score because projects = 0, make projects weight = 0, else available_weight = 100
        available_weight = sum(source_weights.get(source_name, 0) for source_name, _ in sources)

        if not sources or available_weight == 0:
            final_scores[competency_name] = 0
            continue

        total = 0

        for source_name, score in sources:
            weight = source_weights.get(source_name, 0)
            total += score * (weight / available_weight)

        final_scores[competency_name] = round(total, 1)

    return final_scores

