## sync_learn_courses.py -> MIRROR reads course_catalogue.local.csv (recommended courses csv) for the AI to use -> portal_data.py

from __future__ import annotations

import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]      ##python_mirror
COURSE_CATALOGUE = ROOT / "config" / "course_catalogue.local.csv"


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