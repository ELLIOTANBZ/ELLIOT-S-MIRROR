from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / "config"


def read_json(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return fallback


def column_map() -> dict[str, Any]:
    fallback = read_json(CONFIG_DIR / "column_map.example.json", {})
    return read_json(CONFIG_DIR / "column_map.local.json", fallback)


def mapped_columns(section: str) -> dict[str, Any]:
    return column_map().get(section, {})
