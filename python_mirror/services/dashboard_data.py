## builds the pages data
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from db import connect, loads
from services.calculations import average, percentage
from services.competency_analysis import analyse_officer_cached_or_local, officer_summary
from services.competency_scoring import (
    CORRESPONDENCE_COMPETENCIES,
    CORE_COMPETENCIES,
    FUNCTIONAL_COMPETENCIES,
    blended_competency_score,
    evidence_score_map_between,
    score_audit_for_all_competencies,
    score_scorecard_for_all_competencies,
)
from services.readiness_data import (
    grouped_scores,
    readiness_for,
    readiness_pause_reasons,
    weighted_readiness_score,
)


def records_between(table_name: str, officer_id: str, start: str, end: str) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            f"""
            SELECT * FROM {table_name}
            WHERE officer_id = ? AND upload_date BETWEEN ? AND ?
            ORDER BY upload_date ASC
            """,
            (officer_id, start, end),
        ).fetchall()
    records = [dict(row) for row in rows]
    for record in records:
        record.update(loads(record.get("payload_json"), {}))
    return records


def source_dates_between(table_name: str, officer_id: str, start: str, end: str, date_column: str) -> list[str]:
    with connect() as conn:
        rows = conn.execute(
            f"""
            SELECT {date_column} AS source_date
            FROM {table_name}
            WHERE officer_id = ? AND {date_column} BETWEEN ? AND ?
            ORDER BY {date_column} ASC
            """,
            (officer_id, start, end),
        ).fetchall()
    return [row["source_date"] for row in rows if row["source_date"]]


def latest_evidence_date(officer_id: str) -> date | None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT MAX(source_date) AS latest_date
            FROM (
              SELECT MAX(upload_date) AS source_date FROM audit_records WHERE officer_id = ?
              UNION ALL
              SELECT MAX(upload_date) AS source_date FROM scorecard_records WHERE officer_id = ?
              UNION ALL
              SELECT MAX(upload_date) AS source_date FROM interactions WHERE officer_id = ?
              UNION ALL
              SELECT MAX(date(updated_at)) AS source_date FROM project_records WHERE officer_id = ?
            )
            """,
            (officer_id, officer_id, officer_id, officer_id),
        ).fetchone()
    if not row or not row["latest_date"]:
        return None
    return date.fromisoformat(row["latest_date"])


def bucket_key(source_date: str) -> tuple[int, int, int]:
    point_date = date.fromisoformat(source_date)
    third = min(2, (point_date.day - 1) // 10)
    return (point_date.year, point_date.month, third)


def bucket_range(year: int, month: int, third: int) -> tuple[str, str]:
    start_day = (1, 11, 21)[third]
    start = date(year, month, start_day)
    if month == 12:
        next_month = date(year + 1, 1, 1)
    else:
        next_month = date(year, month + 1, 1)
    last_day = (next_month - timedelta(days=1)).day
    end_day = min((10, 20, 31)[third], last_day)
    end = date(year, month, end_day)
    return start.isoformat(), end.isoformat()


## HELPER
def flags_alerts(officer_id: str) -> dict[str, Any]:
    summary = officer_summary(officer_id)
    scores = grouped_scores(officer_id, summary)
    flags = []
    avg_rating = summary.get("average_ess_rating")

    with connect() as conn:
        project_count = conn.execute(
            "SELECT COUNT(*) AS count FROM project_records WHERE officer_id = ?",
            (officer_id,),
        ).fetchone()["count"]

    evidence_count = (
        summary.get("audit_count", 0)
        + summary.get("scorecard_count", 0)
        + summary.get("interaction_count", 0)
        + project_count
    )
    weak_scores = [
        (label, value)
        for label, value in (
            ("Core competency", scores["core"]),
            ("Functional competency", scores["functional"]),
            ("Correspondence competency", scores["correspondence"]),
        )
        if value < 60
    ]

    ## blended competency evidence flag
    if evidence_count == 0:
        flags.append(
            {
                "severity": "medium",
                "title": "No competency evidence",
                "detail": "Upload audit, scorecard, interaction, or project evidence for this officer.",
            }
        )
    elif weak_scores:
        label, value = weak_scores[0]
        flags.append(
            {
                "severity": "high",
                "title": f"Low {label.lower()} score",
                "detail": f"{label} is currently {value:.1f}.",
            }
        )

    ## ess (customer satisfaction) score flag
    if avg_rating is None:
        flags.append(
            {
                "severity": "medium",
                "title": "No ESS data",
                "detail": "Upload customer survey data for this officer.",
            }
        )
    elif avg_rating < 3:
        flags.append(
            {
                "severity": "high",
                "title": "Low customer satisfaction",
                "detail": f"Average ESS rating is {avg_rating:.1f}.",
            }
        )

    for reason in readiness_pause_reasons(officer_id, summary, scores):
        flags.append(
            {
                "severity": "high",
                "title": reason["title"],
                "detail": reason["detail"],
            }
        )
    return {"flags": flags}


## Build everything needed for the Dashboard page.
def dashboard_portal_data(officer_id: str, months: int = 3) -> dict[str, Any]:
    summary = officer_summary(officer_id)
    readiness = readiness_for(officer_id)
    feedback = analyse_officer_cached_or_local(officer_id)
    months = months if months in {3, 6, 12} else 3

    latest_date = latest_evidence_date(officer_id)
    audit_records = []
    scorecard_records = []
    interaction_dates = []
    project_dates = []
    period_start = None

    ## calculate start date
    if latest_date:
        latest_month_number = latest_date.year * 12 + latest_date.month - 1
        start_month_number = latest_month_number - (months - 1)
        period_start = date(start_month_number // 12, start_month_number % 12 + 1, 1)
        start_text = period_start.isoformat()
        end_text = latest_date.isoformat()
        audit_records = records_between("audit_records", officer_id, start_text, end_text)
        scorecard_records = records_between("scorecard_records", officer_id, start_text, end_text)
        interaction_dates = source_dates_between("interactions", officer_id, start_text, end_text, "upload_date")
        project_dates = source_dates_between("project_records", officer_id, start_text, end_text, "date(updated_at)")

    ## { (2026, 3, 0): {"audit": [], "scorecard": []}, ... }
    monthly_buckets: dict[tuple[int, int, int], dict[str, list[dict[str, Any]]]] = defaultdict(
        lambda: {"audit": [], "scorecard": []}
    )
    for record in audit_records:
        monthly_buckets[bucket_key(record["upload_date"])]["audit"].append(record)
    for record in scorecard_records:
        monthly_buckets[bucket_key(record["upload_date"])]["scorecard"].append(record)
    for source_date in interaction_dates:
        monthly_buckets[bucket_key(source_date)]
    for source_date in project_dates:
        monthly_buckets[bucket_key(source_date)]

    sampled_timeline = []
    for index, ((year, month, third), records) in enumerate(sorted(monthly_buckets.items())):
        bucket_start, bucket_end = bucket_range(year, month, third)
        audit_scores = score_audit_for_all_competencies(records["audit"])
        scorecard_scores = score_scorecard_for_all_competencies(records["scorecard"])
        interaction_scores = evidence_score_map_between(officer_id, "interaction", bucket_start, bucket_end)
        project_scores = evidence_score_map_between(officer_id, "project", bucket_start, bucket_end)
        blended_scores = blended_competency_score(
            officer_id,
            audit_scores,
            scorecard_scores,
            interaction_scores,
            project_scores,
        )

        core_score = average([blended_scores.get(name, 0) for name in CORE_COMPETENCIES]) or 0
        functional_score = average([blended_scores.get(name, 0) for name in FUNCTIONAL_COMPETENCIES]) or 0
        correspondence_score = average([blended_scores.get(name, 0) for name in CORRESPONDENCE_COMPETENCIES]) or 0

        overall_score = weighted_readiness_score(
            settings=readiness["settings"],
            core=core_score,
            functional=functional_score,
            correspondence=correspondence_score,
            performance=readiness["scores"]["performance"],
            experience=readiness["component_scores"]["Experience"],
            projects=readiness["component_scores"]["Projects"],
        )

        label_day = (5, 15, 25)[third]

        ## how many months after the start period this bucket is
        month_offset = 0
        if period_start:
            month_offset = (year - period_start.year) * 12 + month - period_start.month
        slot_index = max(0, month_offset * 3 + third)

        x = 34 + slot_index * (620 / max(1, months * 3 - 1))

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

    series_names = ("overall", "core", "functional", "correspondence")
    chart_series = []
    chart_width = 780
    chart_height = 250
    forecasts = {}
    for name in series_names:
        values = [point[name] for point in sampled_timeline]

        ## forecast, predicts next point
        if len(values) >= 2:
            recent_values = values[-3:]
            slope = (recent_values[-1] - recent_values[0]) / max(1, len(recent_values) - 1)
            forecasts[name] = round(percentage(values[-1] + slope * 3), 1)
        elif values:
            forecasts[name] = values[-1]
        else:
            forecasts[name] = None

        plotted_values = values + ([forecasts[name]] if forecasts[name] is not None else [])

        points = []
        dots = []

        for index, value in enumerate(plotted_values):
            if index < len(sampled_timeline):
                x = sampled_timeline[index]["x"]
            else:
                x = 746

            y = 220 - value * 1.8
            points.append(f"{round(x, 1)},{round(y, 1)}")
            dots.append(
                {
                    "x": round(x, 1),
                    "y": round(y, 1),
                    "value": value,
                    "forecast": index == len(plotted_values) - 1,
                }
            )

        chart_series.append(
            {
                "name": name,
                "points": " ".join(points),
                "forecast": forecasts[name],
                "dots": dots,
            }
        )

    ## delta & encouragement
    overall_points = [point["overall"] for point in sampled_timeline]
    delta = round(overall_points[-1] - overall_points[0], 1) if len(overall_points) >= 2 else None
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
        "customer_satisfaction": readiness["scores"]["customer_satisfaction"],
        "flags": flags_alerts(officer_id)["flags"],
    }
