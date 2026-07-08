import re


def average(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def percentage(value: float | None, maximum: float = 100) -> float:
    if value is None:
        return 0
    return max(0, min(100, value / maximum * 100))


def normalise_column_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())
