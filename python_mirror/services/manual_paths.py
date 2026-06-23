from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOCAL_ROOT = Path(os.getenv("MIRROR_LOCAL_ROOT", ROOT / "manual_workflow"))


def manual_path(env_name: str, default_name: str) -> Path:
    return Path(os.getenv(env_name, DEFAULT_LOCAL_ROOT / default_name)).resolve()


def incoming_dir() -> Path:
    return manual_path("MIRROR_INCOMING_DIR", "incoming")


def database_dir() -> Path:
    return manual_path("MIRROR_DATABASE_DIR", "database")


def outgoing_changes_dir() -> Path:
    return manual_path("MIRROR_OUTGOING_CHANGES_DIR", "outgoing_changes")


def processed_changes_dir() -> Path:
    return manual_path("MIRROR_PROCESSED_CHANGES_DIR", "processed_changes")


def failed_changes_dir() -> Path:
    return manual_path("MIRROR_FAILED_CHANGES_DIR", "failed_changes")


def processed_imports_dir() -> Path:
    return manual_path("MIRROR_PROCESSED_IMPORTS_DIR", "processed_imports")


def failed_imports_dir() -> Path:
    return manual_path("MIRROR_FAILED_IMPORTS_DIR", "failed_imports")


def ensure_manual_dirs() -> None:
    for path in (
        incoming_dir(),
        database_dir(),
        outgoing_changes_dir(),
        processed_changes_dir(),
        failed_changes_dir(),
        processed_imports_dir(),
        failed_imports_dir(),
    ):
        path.mkdir(parents=True, exist_ok=True)
