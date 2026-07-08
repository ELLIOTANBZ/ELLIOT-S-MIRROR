from __future__ import annotations
from datetime import date, datetime, timedelta
from db import connect
import json
import re
import csv
from pathlib import Path
from services.ai_client import ai_is_configured, chat
from services.competency_analysis import analyse_officer
from typing import Any


## sync_learn_courses.py -> MIRROR reads course_catalogue.local.csv (recommended courses csv) for the AI to use (load_course_catalogue) -> generate_training_recommendations (AI)
ROOT = Path(__file__).resolve().parents[1]      ##python_mirror
COURSE_CATALOGUE = ROOT / "config" / "course_catalogue.local.csv"
COURSE_SYNC_LOG = ROOT / "logs" / "course_sync.log"


def course_catalogue_status() -> dict[str, Any]:
    status = {
        "exists": COURSE_CATALOGUE.exists(),
        "last_refreshed": "",
        "course_count": 0,
        "log_tail": "",
    }

    if COURSE_CATALOGUE.exists():
        modified = datetime.fromtimestamp(COURSE_CATALOGUE.stat().st_mtime)
        status["last_refreshed"] = modified.strftime("%Y-%m-%d %H:%M")
        status["course_count"] = len(load_course_catalogue())

    if COURSE_SYNC_LOG.exists():
        lines = COURSE_SYNC_LOG.read_text(encoding="utf-8", errors="ignore").splitlines()
        status["log_tail"] = "\n".join(lines[-6:])

    return status

## returns a list of rows in python
def load_course_catalogue() -> list[dict[str, str]]:
    if not COURSE_CATALOGUE.exists():
        return []

    courses = []

    with COURSE_CATALOGUE.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)

        for row in reader:
            title = (row.get("title") or "").strip()

            if not title: continue

            courses.append({
                "title": title,
                "start_date": (row.get("start_date") or "").strip(),
                "price": (row.get("price") or "").strip(),
                "product_type": (row.get("product_type") or "").strip(),
                "duration": (row.get("duration") or "").strip(),
                "course_url": (row.get("course_url") or "").strip(),
                "provider": (row.get("provider") or "").strip(),
                "description": (row.get("description") or "").strip(),
                "learning_outcomes": (row.get("learning_outcomes") or "").strip(),
                "who_should_attend": (row.get("who_should_attend") or "").strip(),
            })

    return courses


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


    return {
        "counts": counts,
        "records": filtered_records,
        "recommendations": recommendations,
        "course_catalogue": course_catalogue_status(),
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


def generate_training_keywords(officer_id: str) -> list[dict[str, str]]:
    if not ai_is_configured():
        raise RuntimeError(
            "AI is not configured yet. Fill AI_PROVIDER and the matching API settings in python_mirror/.env."
        )

    analysis = analyse_officer(officer_id, use_ai=True)
    system = (
        "You suggest course search keywords for a public service officer. "
        "Do not recommend specific courses. Return only valid JSON."
    )
    user = f"""
Suggest concise course search keywords based on this officer's competency gaps.

Officer analysis:
{json.dumps(analysis, ensure_ascii=True)}

Rules:
- Return keywords the officer can type into a learning catalogue search bar.
- Each keyword should be short, practical, and tied to a competency gap.
- Do not invent course titles.
- Prefer 6 to 10 keywords.

Return JSON in this exact shape:
{{
  "keywords": [
    {{
      "keyword": "stakeholder communication",
      "competency_gap": "Working Effectively with Citizens & Stakeholders",
      "reason": "short reason why this keyword helps"
    }}
  ]
}}
"""
    result = chat(system, user)
    keywords = []
    for item in result.get("keywords", []):
        keyword = str(item.get("keyword", "")).strip()
        if not keyword:
            continue
        keywords.append(
            {
                "keyword": keyword,
                "competency_gap": str(item.get("competency_gap", "")).strip(),
                "reason": str(item.get("reason", "")).strip(),
            }
        )
    return keywords


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
- For competency_gap, list all officer competency gaps this course helps to address.
- If there are multiple gaps, separate them with semicolons, for example: "Working as a Team; Data Management".
- Use the officer analysis and the course's description, learning_outcomes, and who_should_attend to decide the gaps.- Prefer courses where the description, learning_outcomes, or who_should_attend match the officer's gaps.
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
            "competency_gap": "one or more gaps this course addresses, separated by semicolons",
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

