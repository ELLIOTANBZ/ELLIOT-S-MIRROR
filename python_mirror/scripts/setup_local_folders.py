from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.manual_paths import (  # noqa: E402
    database_dir,
    failed_changes_dir,
    incoming_dir,
    outgoing_changes_dir,
    processed_changes_dir,
)


def main() -> None:
    paths = [
        incoming_dir(),
        database_dir(),
        outgoing_changes_dir(),
        processed_changes_dir(),
        failed_changes_dir(),
    ]
    for path in paths:
        path.mkdir(parents=True, exist_ok=True)
        print(f"OK {path}")


if __name__ == "__main__":
    main()
