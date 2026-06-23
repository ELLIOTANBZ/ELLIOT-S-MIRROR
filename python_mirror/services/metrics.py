## Shared calculations for uploaded audit records.

from __future__ import annotations

from typing import Any


## name = display name
## keys = keywords to find matching uploaded fields, eg. if imported audit payload has a column like Courtesy or courtesy_result, the app can match it
INDICATORS = [
    {"name": "Courtesy", "keys": ["courtesy"]},
    {"name": "Confidentiality", "keys": ["confidential"]},
    {"name": "Comprehend Intent", "keys": ["comprehend"]},
    {"name": "Comply - Email Writing SOG", "keys": ["comply", "sog", "email writing"]},
    {"name": "Correct Information", "keys": ["correct"]},
    {"name": "Complete Information", "keys": ["complete"]},
    {"name": "Clear and Easy", "keys": ["clear"]},
    {"name": "Meaningful Conversations", "keys": ["meaningful", "conversation"]},
    {"name": "Cultivate Digital Awareness", "keys": ["cultivate", "digital"]},
    {"name": "Verified Mistake", "keys": ["verified", "mistake"]},
]


## When scanning records for indicator fields, ignore these database system fields.
SKIP = {"id", "officer_id", "upload_date", "record_version", "updated_at", "payload_json"}


## Convert uploaded values into pass/fail numbers.
def parse_pass_fail(value: Any) -> float | None:
    text = str(value or "").strip().lower()
    if text in {"pass", "yes", "p", "1", "true", "passed", "y"}:
        return 1
    if text in {"fail", "no", "f", "0", "false", "failed", "n"}:
        return 0
    try:
        number = float(text.replace("%", ""))
    except ValueError:
        return None
    return number / 100 if number > 1 else number


## Tries to find a score from an audit record.
def extract_score(record: dict[str, Any]) -> float | None:
    if record.get("total_score") is not None:
        return float(record["total_score"])

    for key, value in record.items():
        if key in SKIP:
            continue
        lower_key = key.lower()
        is_score_field = (
            "score" in lower_key
            or "total" in lower_key
            or "percentage" in lower_key
        )
        if is_score_field and "indicator" not in lower_key:
            try:
                number = float(str(value).replace("%", ""))
                if 0 <= number <= 100:
                    return number
            except ValueError:
                pass
    return None


## Finds one indicator's value from a record, eg. find_indicator_value(record, ["courtesy"]).
def find_indicator_value(
    record: dict[str, Any],
    keywords: list[str],
) -> float | None:
    for key, value in record.items():
        if key in SKIP:
            continue
        lower_key = key.lower()
        if any(keyword in lower_key for keyword in keywords):
            parsed = parse_pass_fail(value)
            if parsed is not None:
                return parsed
    return None


## Calculates the pass rate and level for every indicator.
def compute_indicators(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output = []
    for indicator in INDICATORS:
        values = [
            find_indicator_value(record, indicator["keys"])
            for record in records
        ]
        values = [value for value in values if value is not None]
        pass_rate = sum(values) / len(values) if values else None

        level = None
        if pass_rate is not None:
            if pass_rate >= 0.8:
                level = "Advanced"
            elif pass_rate >= 0.6:
                level = "Intermediate"
            else:
                level = "Basic"

        output.append(
            {
                "name": indicator["name"],
                "passRate": pass_rate,
                "level": level,
                "sampleSize": len(values),
            }
        )
    return output


## It scans every record for an indicator such as Courtesy, converts each result
## to pass (1) or fail (0), then averages those values for that indicator.
