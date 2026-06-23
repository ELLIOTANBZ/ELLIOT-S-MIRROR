## builds the pages data
from __future__ import annotations

import json
import re

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from werkzeug.security import generate_password_hash

from db import connect, loads, new_id
from repositories import audit_records_between, latest_audit_record
from services.ai_client import ai_is_configured
from services.competency_analysis import (
    CORE_COMPETENCIES,
    analyse_officer,
    officer_summary,
)
from services.metrics import compute_indicators, extract_score

from services.ai_client import ai_is_configured, chat
from services.competency_analysis import analyse_officer

from services.course_catalogue import load_course_catalogue

READINESS_STAGES = [
    "Not Ready",
    "Meeting Expectations",
    "Stretch Assignment Ready",
    "Career Advancement Ready",
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

PART_TWO_WEIGHTS = {
    "core_weight": 0.25,
    "functional_weight": 0.15,
    "correspondence_weight": 0.15,
    "performance_weight": 0.15,
    "tenure_weight": 0.10,
    "development_weight": 0.10,
    "application_weight": 0.10,
}

PART_TWO_THRESHOLDS = [
    ("Meeting Expectations", "core", "Core competency score", 65, "score", 1),
    ("Meeting Expectations", "correspondence", "Correspondence competency score", 60, "score", 2),
    ("Meeting Expectations", "development", "Development score", 70, "score", 3),
    ("Meeting Expectations", "performance", "Performance score", 60, "score", 4),
    ("Stretch Assignment Ready", "core", "Core competency score", 80, "score", 1),
    ("Stretch Assignment Ready", "functional", "Functional competency score", 70, "score", 2),
    ("Stretch Assignment Ready", "correspondence", "Correspondence competency score", 70, "score", 3),
    ("Stretch Assignment Ready", "performance", "Performance score", 70, "score", 4),
    ("Stretch Assignment Ready", "experience", "Expected tenure completed", 60, "percent", 5),
    ("Career Advancement Ready", "readiness", "Overall readiness score", 85, "score", 1),
    ("Career Advancement Ready", "core", "Core competency score", 80, "score", 2),
    ("Career Advancement Ready", "functional", "Functional competency score", 75, "score", 3),
    ("Career Advancement Ready", "correspondence", "Correspondence competency score", 75, "score", 4),
    ("Career Advancement Ready", "performance", "Performance score", 80, "score", 5),
    ("Career Advancement Ready", "application", "Application score", 70, "score", 6),
    ("Career Advancement Ready", "experience", "Expected tenure completed", 100, "percent", 7),
]

## HELPER
## Make sure every database row required by the portal exists before other functions try to use it. (it only updates SQLite)
## 1. apply initial weights once, 2. ensure thresholds exist, 3. ensure every user has a career profile + org relationship row
def ensure_portal_defaults() -> None:
    with connect() as conn:
        roles = ("CSE", "TL", "Supervisor")

        ## 1. apply initial weights once
        for role in roles:
            conn.execute(
                "INSERT OR IGNORE INTO readiness_settings (role) VALUES (?)",
                (role,),
            )

        ## searches sync_meta for a marker (migration) saying the defaults were already applied
        migration = conn.execute(
            "SELECT value FROM sync_meta WHERE key = 'part_two_readiness_defaults'"
        ).fetchone()

        ## if that marker not found
        if not migration:
            for field, value in PART_TWO_WEIGHTS.items():
                conn.execute(
                    f"UPDATE readiness_settings SET {field} = ?",
                    (value,),
                )
            conn.execute(
                """
                INSERT INTO sync_meta (key, value)
                VALUES ('part_two_readiness_defaults', 'applied')
                """
            )

        ## 2. ensure thresholds exist
        for threshold in PART_TWO_THRESHOLDS:
            conn.execute(
                """
                INSERT OR IGNORE INTO readiness_thresholds
                  (stage, metric, display_name, minimum_value, unit, sequence)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                threshold,
            )

        ## 3. ensure every user has a career profile + org relationship row
        users = conn.execute(
            "SELECT id, role FROM users WHERE role != 'Admin'"
        ).fetchall()
        for user in users:
            if user["role"] == "CSE":
                target_role = "TL"
            elif user["role"] == "TL":
                target_role = "Supervisor"
            else:
                target_role = "Senior Supervisor"
            conn.execute(
                """
                INSERT OR IGNORE INTO career_profiles
                  (officer_id, current_role, target_role, responsibilities_json,
                   target_responsibilities_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    user["id"],
                    user["role"],
                    target_role,
                    json.dumps(["Deliver quality service", "Meet role expectations"]),
                    json.dumps(["Demonstrate next-role capability", "Sustain strong performance"]),
                ),
            )
            conn.execute(
                """
                INSERT OR IGNORE INTO organisation_relationships
                  (officer_id, manager_id, team_name)
                VALUES (?, NULL, '')
                """,
                (user["id"],),
            )


def average(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def percentage(value: float | None, maximum: float = 100) -> float:
    if value is None:
        return 0
    return max(0, min(100, value / maximum * 100))


## HELPER
def grouped_scores(summary: dict[str, Any]) -> dict[str, float]:
    indicators = summary.get("indicators", [])
    indicator_scores = [ (item.get("passRate") or 0) * 100 for item in indicators if item.get("passRate") is not None ]
    correspondence = average(indicator_scores) or 0
    audit = summary.get("average_audit_score") or 0
    ess = percentage(summary.get("average_ess_rating"), 5)
    return {
        "core": round((audit + correspondence) / 2, 1),
        "functional": round(audit, 1),
        "correspondence": round(correspondence, 1),
        "performance": round(ess, 1),
    }


## HELPER
## Load one officer’s career profile + calculate how many years they have been in their current role.
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


## helper for each score * its configured weight
def weighted_readiness_score(
    *,
    settings,
    core,
    functional,
    correspondence,
    performance,
    experience,
    development,
    application,
):
    return (
        core * settings["core_weight"]
        + functional * settings["functional_weight"]
        + correspondence * settings["correspondence_weight"]
        + performance * settings["performance_weight"]
        + experience * settings["tenure_weight"]
        + development * settings["development_weight"]
        + application * settings["application_weight"]
    )



def readiness_for(officer_id: str) -> dict[str, Any]:
    summary = officer_summary(officer_id)
    profile = profile_for(officer_id)
    scores = grouped_scores(summary)

    ## load the readiness weights for this officer's current role
    with connect() as conn:
        settings = dict(
            conn.execute(
                "SELECT * FROM readiness_settings WHERE role = ?",
                (profile["current_role"],),
            ).fetchone()
        )
        completed_training = conn.execute(
            """
            SELECT count(1) FROM training_records
            WHERE officer_id = ? AND status = 'Completed'
            """,
            (officer_id,),
        ).fetchone()[0]

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

    ## how many training courses to complete for each role
    if profile["current_role"] == "CSE":
        required_training = 2
    if profile["current_role"] == "TL":
        required_training = 3
    if profile["current_role"] == "Supervisor":
        required_training = 4

    development_score = percentage(completed_training, required_training)
    application_score = 0           ## (unfinished)

    ## each score * its configured weight
    total = weighted_readiness_score(
        settings=settings,
        core=scores["core"],
        functional=scores["functional"],
        correspondence=scores["correspondence"],
        performance=scores["performance"],
        experience=tenure_score,
        development=development_score,
        application=application_score,
    )

    all_scores = {
        **scores,
        "experience": tenure_score,
        "development": development_score,
        "application": application_score,
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

    ## FOR RADAR, These convert the three scores into X/Y positions.
    core_point = (50, 50 - scores["core"] * 0.45)
    functional_point = (
        50 + scores["functional"] * 0.39,
        50 + scores["functional"] * 0.225,
    )
    correspondence_point = (
        50 - scores["correspondence"] * 0.39,
        50 + scores["correspondence"] * 0.225,
    )
    radar_polygon = ", ".join(
        f"{round(x, 1)}% {round(y, 1)}%"
        for x, y in (core_point, functional_point, correspondence_point)
    )

    ## measures = The requirements for the officer’s next stage.
    return {
        "stage": stage,
        "next_stage": next_stage,
        "stages": READINESS_STAGES,
        "readiness_score": round(total, 1),
        "measures": thresholds_by_stage[next_stage],
        "scores": scores,
        "profile": profile,
        "settings": settings,
        "radar_polygon": radar_polygon,
        "component_scores": {
            "Core Competency": scores["core"],
            "Functional Competency": scores["functional"],
            "Correspondence Competency": scores["correspondence"],
            "Performance": scores["performance"],
            "Experience": round(tenure_score, 1),
            "Development": round(development_score, 1),
            "Application": round(application_score, 1),
        },
    }


## Build the competency breakdown boxes shown in My Readiness.
def competency_groups(officer_id: str) -> dict[str, list[dict[str, Any]]]:
    readiness = readiness_for(officer_id)
    scores = readiness["scores"]
    summary = officer_summary(officer_id)

    ## helper, turns list of competency names --> display-ready dictionaries
    def make_rows(names: list[str], base_score: float) -> list[dict[str, Any]]:
        rows = []
        for name in names:
            score = max(0, min(100, base_score))
            level = "Advanced" if score >= 80 else "Intermediate" if score >= 60 else "Basic"
            rows.append(
                {
                    "name": name,
                    "score": round(score, 1),
                    "level": level,
                    "description": COMPETENCY_DESCRIPTIONS.get(name, ""),
                    "rationale": (
                        f"The current score is derived from the officer's recent "
                        f"audit, customer satisfaction, and correspondence evidence."
                    ),
                    "evidence": (
                        f"Audit average: "
                        f"{summary['average_audit_score'] if summary['average_audit_score'] is not None else 'No data'}. "

                        f"Customer satisfaction rating: "
                        f"{summary['average_ess_rating'] if summary['average_ess_rating'] is not None else 'No data'}. "

                        f"Recent interactions analysed: {len(summary['interactions'])}."
                    ),
                    "development": (
                        f"To progress, practise {name.lower()} in current cases and "
                        f"review the next results with a TL or Supervisor."
                    ),
                }
            )
        return rows

    return {
        "core": make_rows(CORE_COMPETENCIES, scores["core"]),
        "functional": make_rows(FUNCTIONAL_COMPETENCIES, scores["functional"]),
        "correspondence": make_rows(CORRESPONDENCE_COMPETENCIES, scores["correspondence"]),
    }

## HELPER
def flags_alerts(officer_id: str) -> dict[str, Any]:
    summary = officer_summary(officer_id)
    flags = []
    avg_score = summary.get("average_audit_score")
    avg_rating = summary.get("average_ess_rating")

    ## audit score flag
    if avg_score is None:
        flags.append({"severity": "medium",
                      "title": "No audit data",
                      "detail": "Upload Auditmate data for this officer."})
    elif avg_score < 60:
        flags.append({"severity": "high",
                      "title": "Low audit score",
                      "detail": f"Average audit score is {avg_score:.1f}."})

    ## ess (customer satisfaction) score flag
    if avg_rating is None:
        flags.append({"severity": "medium",
                      "title": "No ESS data",
                      "detail": "Upload customer survey data for this officer."})
    elif avg_rating < 3:
        flags.append({"severity": "high",
                      "title": "Low customer satisfaction",
                      "detail": f"Average ESS rating is {avg_rating:.1f}."})

    ## indicator flags
    for indicator in summary.get("indicators", []):
        if indicator.get("level") == "Basic":
            flags.append(
                {
                    "severity": "medium",
                    "title": f"Indicator needs attention: {indicator['name']}",
                    "detail": f"Sample size {indicator.get('sampleSize', 0)}.",
                }
            )
    return {"flags": flags}


## Build everything needed for the Dashboard page.
def dashboard_portal_data(officer_id: str, months: int = 3,) -> dict[str, Any]:     ## months = how many months to show
    summary = officer_summary(officer_id)
    readiness = readiness_for(officer_id)
    feedback = analyse_officer(officer_id, use_ai=ai_is_configured())               ## AI or local fallback analysis, see .env for ai settings
    months = months if months in {3, 6, 12} else 3

    latest = latest_audit_record(officer_id)                    ## finds the officer’s newest audit row, else None
    audit_records = []
    period_start = None

    ## calculate start date
    if latest:
        latest_date = date.fromisoformat(latest["upload_date"])
        latest_month_number = latest_date.year * 12 + latest_date.month - 1         ## 2026 March → 2026 * 12 + 3 - 1
        start_month_number = latest_month_number - (months - 1)
        period_start = date( start_month_number // 12, start_month_number % 12 + 1, 1, )        ##  change back to 2026 Jan 1
        audit_records = audit_records_between(
            officer_id,
            period_start.isoformat(),
            latest_date.isoformat(),
        )

    ## { (2026, 3, 0): [], (2026, 3, 1): [], (2026, 3, 2): [], }
    monthly_buckets: dict[tuple[int, int, int], list[dict[str, Any]]] = defaultdict(list)
    for record in audit_records:
        point_date = date.fromisoformat(record["upload_date"])
        third = min(2, (point_date.day - 1) // 10)
        monthly_buckets[(point_date.year, point_date.month, third)].append(record)

    sampled_timeline = []
    for index, ((year, month, third), records) in enumerate(sorted(monthly_buckets.items())):           ## index is from enumerate, so 9 buckets --> 9 loops, finding data for each third
        audit_scores = [ score for score in (extract_score(record) for record in records) if score is not None ]
        functional_score = average(audit_scores) or 0

        indicator_scores = [ item["passRate"] * 100 for item in compute_indicators(records) if item["passRate"] is not None ]
        correspondence_score = average(indicator_scores) or 0

        core_score = average([functional_score, correspondence_score]) or 0

        ## the last 4 do not change for every timeline plot
        overall_score = weighted_readiness_score(
            settings=readiness["settings"],
            core=core_score,
            functional=functional_score,
            correspondence=correspondence_score,
            performance=readiness["scores"]["performance"],
            experience=readiness["component_scores"]["Experience"],
            development=readiness["component_scores"]["Development"],
            application=readiness["component_scores"]["Application"],
        )

        label_day = (5, 15, 25)[third]              ## third = 0 --> 5, third = 1 --> 15...

        ## how many months after the start period this bucket is
        month_offset = 0
        if period_start:
            month_offset = (year - period_start.year) * 12 + month - period_start.month
        slot_index = max(0, month_offset * 3 + third)           ## which third total from the start date?

        x = 34 + slot_index * (620 / max(1, months * 3 - 1))       ## 34 = left padding inside chart, 620 = chart drawing width, months * 3 - 1 = #gaps between timeline slots

        ## add 1 plotted timeline point, eg. { "date": "2026-03-15", "overall": 68.5, "core": 72.0, "functional": 70.0, "correspondence": 74.0, }
        sampled_timeline.append(
            {
                "index": index,
                "x": round(x, 1),
                "date": f"{year:04d}-{month:02d}-{label_day:02d}",
                "overall": round(overall_score, 1),
                "core": round(core_score, 1),
                "functional": round(functional_score, 1),
                "correspondence": round(correspondence_score, 1),
            }
        )

    series_names = ("overall", "core", "functional", "correspondence")          ## matches 1 kind of score in sampled_timeline
    chart_series = []                   ## holds the final line data for the HTML/SVG
    chart_width = 780
    chart_height = 250
    forecasts = {}                      ## holds 1 forecase value for each series
    for name in series_names:
        values = [point[name] for point in sampled_timeline]           ## gets that competency score for that point, list of 9 scores

        ## forecast, predicts next point
        if len(values) >= 2:
            recent_values = values[-3:]
            slope = (recent_values[-1] - recent_values[0]) / max(1, len(recent_values) - 1)
            forecasts[name] = round(percentage(values[-1] + slope * 3), 1)          ## forecast formula, %
        elif values:
            forecasts[name] = values[-1]
        else:
            forecasts[name] = None

        ## add the forecast point to plotted values, for each series_name
        plotted_values = values + ([forecasts[name]] if forecasts[name] is not None else [])        ## this just means append

        ## building SVG points
        points = []             ## holds text for the SVG <polyline>
        dots = []               ## circle positions for individual visible dots

        ## loop through every plotted score (including forecast), index bc of enumerate
        for index, value in enumerate(plotted_values):

            ## x position
            if index < len(sampled_timeline):
                x = sampled_timeline[index]["x"]
            else:           ## forecast point
                x = 746

            ## y position, SVG coordinates grow downward, bigger scores must move upward
            y = 220 - value * 1.8

            ## add polyline point (eg. "158.0,76.0"), later on all these points are joined into 1 string which SVG uses to draw the line
            points.append(f"{round(x, 1)},{round(y, 1)}")

            ## add dot data, so each dot knows where it is, what score it represents, whether it is the forecast dot
            dots.append(
                {
                    "x": round(x, 1),
                    "y": round(y, 1),
                    "value": value,
                    "forecast": index == len(plotted_values) - 1,       ## boolean
                }
            )
        ## save this series (after finishing 1 line) (eg. { "name": "overall", "points": "34,130 102,120 170,110 238,100", "forecast": 74.0, "dots": [...], })
        chart_series.append(
            {
                "name": name,
                "points": " ".join(points),
                "forecast": forecasts[name],
                "dots": dots,
            }
        )

    ## delta & encouragement
    overall_points = [point["overall"] for point in sampled_timeline]       ## overall score of each pt
    delta = round(overall_points[-1] - overall_points[0], 1) if len(overall_points) >= 2 else None      ## compares 1st overall pt & last overall pt
    if delta is None:
        encouragement = "Add more data to see how your progress changes over time."
    elif delta > 1:
        encouragement = f"Great progress! Your overall readiness score has improved by {delta} points since {sampled_timeline[0]['date']}."
    elif delta < -1:
        encouragement = f"Your score is {abs(delta)} points lower than {sampled_timeline[0]['date']}; the recommended actions can help you recover."
    else:
        encouragement = f"Your progress has remained steady since {sampled_timeline[0]['date']}."

    return {
        "career": readiness,
        "feedback": feedback,
        "timeline": sampled_timeline,
        "chart_series": chart_series,
        "chart_width": chart_width,
        "chart_height": chart_height,
        "timeline_options": {
            "months": months,
            "delta": delta,
            "encouragement": encouragement,
            "forecasts": forecasts,
        },
        "customer_satisfaction": readiness["scores"]["performance"],
        "flags": flags_alerts(officer_id)["flags"],
    }


## Load one officer’s training records and prepare them for the Training & Recommendations page.
def training_for( officer_id: str, *, search: str = "", status: str = "All", show_archived: bool = False, ) -> dict[str, Any]:
    with connect() as conn:
        ## loads all training rows for that officer, ordered by Pending, In Progress, Completedd, newest assigned date first, newest row first
        rows = conn.execute(
            """
            SELECT * FROM training_records
            WHERE officer_id = ?
            ORDER BY
              CASE status WHEN 'Pending' THEN 1 WHEN 'In Progress' THEN 2 ELSE 3 END,
              assigned_date DESC,
              id DESC
            """,
            (officer_id,),
        ).fetchall()
    records = []

    cutoff = date.today() - timedelta(days=365)
    search_text = search.strip().lower()
    status_filter = status if status in {"All", "Pending", "In Progress", "Completed"} else "All"

    ## if any field missing, fill in, then add cleaned record to the list
    for row in rows:
        record = dict(row)
        if not record.get("description"):
            record["description"] = record.get("notes") or "Development course assigned through MIRROR."
        if not record.get("assigned_by"):
            record["assigned_by"] = record.get("provider") or "CPF Board"
        ## if training type is missing, guess from title
        if not record.get("training_type"):
            mandatory_words = ("foundation", "compliance", "ethics")
            record["training_type"] = (
                "Mandatory" if any(word in record["title"].lower() for word in mandatory_words)
                else "Optional"
            )

        ## is this record archived?
        date_value = record.get("completed_date") or record.get("assigned_date")
        is_archived = False

        if date_value:
            try:
                is_archived = date.fromisoformat(date_value) < cutoff
            except ValueError:
                is_archived = False

        record["is_archived"] = is_archived
        records.append(record)
    counts = {
        "Pending": sum(1 for row in records if row["status"] == "Pending"),
        "In Progress": sum(1 for row in records if row["status"] == "In Progress"),
        "Completed": sum(1 for row in records if row["status"] == "Completed"),
    }

    filtered_records = []

    for record in records:
        if not show_archived and record["is_archived"]:
            continue

        if status_filter != "All" and record["status"] != status_filter:
            continue

        if search_text:
            searchable_text = " ".join(
                str(record.get(field) or "") for field in ("title", "description", "provider", "assigned_by", "notes")
            ).lower()

            if search_text not in searchable_text:
                continue

        filtered_records.append(record)


    ## Show recommendations
    recommendation_rows = conn.execute(
        """
        SELECT * FROM training_recommendations
        WHERE officer_id = ?
        ORDER BY
            start_date ASC,
            id DESC
        """,
        (officer_id,),
    ).fetchall()

    recommendations = [dict(row) for row in recommendation_rows]

    return {
        "counts": counts,
        "records": filtered_records,
        "recommendations": recommendations,
        "filters": {
            "search": search,
            "status": status_filter,
            "show_archived": show_archived,
        },}

## So the template gets: data.counts for the 3 top summary boxes + data.records for the list of training cards
## That is why training.html can do: {{ data.counts[status] }} and {% for record in data.records %}


COURSE_MATCH_SKIP_WORDS = {
    "about",
    "address",
    "course",
    "gaps",
    "officer",
    "review",
    "skill",
    "skills",
    "training",
    "weak",
}


## HELPER: extract useful matching words from competency gaps.
def matching_words(value: str) -> set[str]:
    words = set()

    for word in re.findall(r"[a-zA-Z]{5,}", value.lower()):
        if word not in COURSE_MATCH_SKIP_WORDS:
            words.add(word)

    return words


## HELPER: smart filtering based on officer's shortcomings, so the AI dont have to go through ALL the courses (to improve on)
def course_matches_analysis(course: dict[str, str], analysis: dict) -> int:
    title = course.get("title", "").lower()
    description = course.get("description", "").lower()
    learning_outcomes = course.get("learning_outcomes", "").lower()
    who_should_attend = course.get("who_should_attend", "").lower()
    full_text = " ".join([title, description, learning_outcomes, who_should_attend])

    score = 0

    for gap in analysis.get("competency_gaps", []):
        gap_words = matching_words(
            " ".join([
                str(gap.get("competency", "")),
                str(gap.get("gap", "")),
                str(gap.get("recommendation", "")),
            ])
        )

        for word in gap_words:
            if word in title:
                score += 4
            elif word in learning_outcomes:
                score += 3
            elif word in description:
                score += 2
            elif word in who_should_attend:
                score += 1

    if score == 0 and any(word in full_text for word in ("communication", "leadership", "engagement", "service")):
        score += 1

    return score


## 1. Get officer summary / competency gaps
## 2. get recommended courses from course_catalogue.local.csv
## 3. Ask AI for course recommendations
## 4. Delete old AI recommendations for that officer
## 5. Insert new recommendations into training_recommendations
## 6. Return number inserted
def generate_training_recommendations(officer_id: str) -> int:
    if not ai_is_configured():
        raise RuntimeError(
            "AI is not configured yet. Fill AI_PROVIDER and the matching API settings in python_mirror/.env."
        )

    analysis = analyse_officer(officer_id, use_ai=ai_is_configured())

    courses = load_course_catalogue()

    ranked_courses = sorted(
        courses,
        key=lambda course: course_matches_analysis(course, analysis),           ## key expects a function, course -> course_matches_analysis(course, analysis)
        reverse=True,
    )

    best_courses = ranked_courses[:80]

    course_options = [
        {
            "title": course["title"],
            "start_date": course["start_date"],
            "price": course["price"],
            "product_type": course["product_type"],
            "duration": course["duration"],
            "course_url": course["course_url"],
            "provider": course["provider"],
            "description": course["description"],
            "learning_outcomes": course["learning_outcomes"],
            "who_should_attend": course["who_should_attend"],
        }
        for course in best_courses
    ]

    system = (
        "You recommend training courses for a public service officer. "
        "You must recommend only courses from the Available courses list."
        "Do not invent course names, links, providers, dates, prices, product types, or durations."
        "Return only valid JSON."
    )

    user = f"""
Recommend some training courses for this officer.

Officer analysis:
{json.dumps(analysis, ensure_ascii=True)}

Available courses:
{json.dumps(course_options, ensure_ascii=True)}

Use these fields:
- title
- start_date
- price
- product_type
- duration
- course_url
- provider
- description
- learning_outcomes
- who_should_attend
- training_type
- competency_gap

Rules:
- Do not invent course URLs.
- If an exact official course page URL is not known, use an empty string for course_url.
- Recommend only courses from Available courses.
- Use the exact title, provider, course_url, start_date, price, product_type, and duration from Available courses.
- For competency_gap, explain which officer gap this course helps to address. Use the officer analysis and course's description, learning_outcomes, and who_should_attend to figure this out.
- Prefer courses where the description, learning_outcomes, or who_should_attend match the officer's gaps.
- Choose training_type as "Mandatory" only if the course is important to close a serious competency gap. Use the officer analysis and the course's description, learning_outcomes, and who_should_attend to figure this out. Otherwise choose training_type as "Optional".


Return JSON in this exact shape:
{{
    "recommendations": [
        {{
            "title": "exact course title",
            "start_date": "exact start_date",
            "price": "exact price",
            "product_type": "exact product_type",
            "duration": "exact duration",
            "course_url": "exact course_url from Available courses",
            "provider": "exact provider",
            "training_type": "Mandatory or Optional only",
            "description": "short explanation of why this course is suitable",
            "learning_outcomes": "exact learning_outcomes from Available courses",
            "who_should_attend": "exact who_should_attend from Available courses",
            "competency_gap": "gap this course addresses",
        }}
    ]
}}
"""


    result = chat(system, user)
    recommendations = result.get("recommendations", [])
    inserted = 0

    with connect() as conn:
        conn.execute(
            "DELETE FROM training_recommendations WHERE officer_id = ?",
            (officer_id,),
        )

        for item in recommendations:
            title = item.get("title", "").strip()
            if not title:
                continue

            training_type = item.get("training_type", "").strip()
            if training_type not in {"Mandatory", "Optional"}:
                training_type = "Optional"

            conn.execute(
                """
                INSERT INTO training_recommendations
                (officer_id, title, start_date, price, product_type, duration, course_url, provider, training_type, description, learning_outcomes, who_should_attend, competency_gap, updated_at)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (
                    officer_id,
                    title,
                    item.get("start_date", ""),
                    item.get("price", ""),
                    item.get("product_type", ""),
                    item.get("duration", ""),
                    item.get("course_url", ""),
                    item.get("provider", ""),
                    training_type,
                    item.get("description", ""),
                    item.get("learning_outcomes", ""),
                    item.get("who_should_attend", ""),
                    item.get("competency_gap", ""),
                )
            )
            inserted += 1

    return inserted


## Build the Team Overview page for a TL, Supervisor, or Admin.
## officers: the visible officers to show in the team page, leader: the logged-in team leader / supervisor / admin
def team_portal_data( officers: list[dict[str, Any]], leader: dict[str, Any], ) -> dict[str, Any]:
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
    leadership_score = readiness_for(leader["id"])["readiness_score"]
    leadership_rows = []
    for name in LEADERSHIP_COMPETENCIES:
        score = round(max(0, min(100, leadership_score)), 1)        ## undone, right now just using leader's own readiness score
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
        "rows": rows,
    }


## builds the Admin page data
def admin_portal_data() -> dict[str, Any]:
    ensure_portal_defaults()
    with connect() as conn:
        settings = [
            dict(row)
            for row in conn.execute(
                "SELECT * FROM readiness_settings ORDER BY role"
            ).fetchall()
        ]
        users = [
            dict(row)
            for row in conn.execute(
                """
                SELECT users.id, users.username, users.name, users.role,
                       org.manager_id, org.team_name
                FROM users
                LEFT JOIN organisation_relationships org
                  ON org.officer_id = users.id
                ORDER BY users.role, users.name
                """
            ).fetchall()
        ]
        thresholds = [
            dict(row)
            for row in conn.execute(
                """
                SELECT * FROM readiness_thresholds
                ORDER BY CASE stage
                  WHEN 'Meeting Expectations' THEN 1
                  WHEN 'Stretch Assignment Ready' THEN 2
                  ELSE 3 END,
                  sequence
                """
            ).fetchall()
        ]
    children_by_manager: dict[str | None, list[dict[str, Any]]] = defaultdict(list)     ## building a new dict of lists

    ## for every user in users, it looks at the user's manager_id eg. George, so children_by_manager[George] is a list of those under George (appends the whole user instead of just id, unlike access_control.py)
    for user in users:
        children_by_manager[user["manager_id"]].append(user)


    def build_tree(user: dict[str, Any]) -> dict[str, Any]:
        node = dict(user)
        node["children"] = [ build_tree(child) for child in children_by_manager.get(user["id"], []) ]
        return node

    assigned_user_ids = { user["id"] for user in users if user["manager_id"] }          ## all users that have a manager
    manager_ids = { user["manager_id"] for user in users if user["manager_id"] }        ## all user ids that are managers
    root_candidates = [ user for user in users if not user["manager_id"] and user["id"] in manager_ids ]   ## users are roots if they are not managed by someone + is a manager, so that only top managers are roots
    roots = [ build_tree(user) for user in root_candidates ]        ## list of all roots
    root_ids = {user["id"] for user in root_candidates}
    tree_user_ids = assigned_user_ids | root_ids                    ## | means set union: combine both sets without duplicates.
    unassigned_users = [ user for user in users if user["id"] not in tree_user_ids and user["role"] != "Admin" ]
    return {
        "settings": settings,
        "thresholds": thresholds,
        "users": users,
        "organisation_tree": roots,
        "unassigned_users": unassigned_users,
    }


## Weights & Thresholds: Save the Admin-edited readiness weights for one role.
## values: submitted admin form dict (eg. { "role": "CSE", "core_weight": "0.25", "functional_weight": "0.15", ... })
def save_readiness_settings(values: dict[str, Any]) -> None:
    role = str(values["role"])
    numeric_fields = [
        "core_weight",
        "functional_weight",
        "correspondence_weight",
        "performance_weight",
        "tenure_weight",
        "development_weight",
        "application_weight",
    ]
    numbers = {}
    for field in numeric_fields:
        numbers[field] = float(values[field])           ## converting str to float { "core_weight": 0.25, "functional_weight": 0.15, ... }
    total_weight = sum(numbers.values())

    if abs(total_weight - 1) > 0.001:                   ## total_weight = 0.999999999 is accepted
        raise ValueError("All seven readiness weights must add up to 1.00.")
    with connect() as conn:
        conn.execute(
            """
            UPDATE readiness_settings
            SET core_weight = ?,
                functional_weight = ?,
                correspondence_weight = ?,
                performance_weight = ?,
                tenure_weight = ?,
                development_weight = ?,
                application_weight = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE role = ?
            """,
            (
                numbers["core_weight"],
                numbers["functional_weight"],
                numbers["correspondence_weight"],
                numbers["performance_weight"],
                numbers["tenure_weight"],
                numbers["development_weight"],
                numbers["application_weight"],
                role,
            ),
        )


## Weights & Thresholds: Save one threshold row after Admin edits it.
def save_readiness_threshold( stage: str, metric: str, minimum_value: float, ) -> None:
    with connect() as conn:
        conn.execute(
            """
            UPDATE readiness_thresholds
            SET minimum_value = ?
            WHERE stage = ? AND metric = ?
            """,
            (minimum_value, stage, metric),
        )       ## readiness_threshold: PRIMARY KEY(stage, metric)


## Org Chart: when editing officer on the org chart
def save_organisation_assignment( officer_id: str, manager_id: str | None, team_name: str, ) -> None:
    manager_id = manager_id or None
    if officer_id == manager_id:
        raise ValueError("An officer cannot be their own manager.")
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO organisation_relationships
              (officer_id, manager_id, team_name, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(officer_id) DO UPDATE SET
              manager_id = excluded.manager_id,
              team_name = excluded.team_name,
              updated_at = CURRENT_TIMESTAMP
            """,
            (officer_id, manager_id, team_name.strip()),
        )


def add_officer(username: str, name: str, role: str, password: str) -> None:
    username = username.strip().lower()
    name = name.strip()
    if not username or not name or not password:
        raise ValueError("Username, name, and temporary password are required.")
    if role not in {"CSE", "TL", "Supervisor"}:
        raise ValueError("Officer role must be CSE, TL, or Supervisor.")
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO users (id, username, password_hash, name, role)
            VALUES (?, ?, ?, ?, ?)
            """,
            (new_id(), username, generate_password_hash(password), name, role),
        )
    ensure_portal_defaults()            ## new officer = no manager


def remove_officer(officer_id: str) -> None:
    with connect() as conn:
        ## just to make sure not Admin
        role_row = conn.execute( "SELECT role FROM users WHERE id = ?", (officer_id,), ).fetchone()
        if not role_row:
            raise ValueError("Officer was not found.")
        if role_row["role"] == "Admin":
            raise ValueError("Admin accounts cannot be removed here.")

        ## to make sure no records in related tables
        related_tables = [
            "audit_records",
            "ess_records",
            "interactions",
            "training_records",
        ]
        has_data = any(
            conn.execute( f"SELECT 1 FROM {table} WHERE officer_id = ? LIMIT 1", (officer_id,),).fetchone() for table in related_tables
        )
        if has_data:
            raise ValueError( "This officer has saved records and cannot be removed. Move them instead.")

        conn.execute("DELETE FROM organisation_relationships WHERE officer_id = ? OR manager_id = ?", (officer_id, officer_id),)
        conn.execute("DELETE FROM career_profiles WHERE officer_id = ?", (officer_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (officer_id,))
