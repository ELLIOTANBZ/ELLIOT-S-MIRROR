from __future__ import annotations

import os
import shutil
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from repositories import find_user, find_user_by_username
from services.local_importer import import_local_file
from services.manual_paths import (
    ensure_manual_dirs,
    failed_imports_dir,
    incoming_dir,
    processed_imports_dir,
)

load_dotenv()

SUPPORTED_TYPES = {"audit", "ess", "interactions"}
SUPPORTED_EXTENSIONS = {".csv", ".xlsx", ".xlsm", ".xls"}
STABLE_SECONDS = int(os.getenv("WATCH_STABLE_SECONDS", "10"))


def wait_until_stable(path: Path) -> None:
    last_size = -1
    stable_since = time.time()
    while True:
        size = path.stat().st_size
        if size != last_size:
            last_size = size
            stable_since = time.time()
        if time.time() - stable_since >= STABLE_SECONDS:
            return
        time.sleep(1)


def file_details(path: Path) -> tuple[str, str]:
    import_type = path.parent.name.lower()
    if import_type not in SUPPORTED_TYPES:
        raise ValueError(
            "Place the file inside the audit, ess, or interactions incoming folder."
        )
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {path.suffix}")

    default_officer_id = os.getenv("WATCH_DEFAULT_OFFICER_ID", "").strip()
    if "__" in path.stem:
        default_officer_id = path.stem.split("__", 1)[0].strip()
    if not default_officer_id:
        raise ValueError(
            "Filename must begin with the officer ID, followed by two underscores."
        )
    officer = find_user(default_officer_id) or find_user_by_username(default_officer_id)
    if not officer:
        raise ValueError(f"Officer '{default_officer_id}' was not found in local SQLite.")
    return import_type, officer["id"]


def move_file(path: Path, destination_root: Path) -> Path:
    destination = destination_root / path.parent.name
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / path.name
    if target.exists():
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        target = destination / f"{path.stem}_{timestamp}{path.suffix}"
    shutil.move(str(path), target)
    return target


def process_file(path: Path) -> None:
    if not path.exists():
        return
    wait_until_stable(path)
    import_type, officer_id = file_details(path)
    result = import_local_file(
        path,
        import_type=import_type,
        default_officer_id=officer_id,
        from_date=None,
        to_date=None,
    )
    processed_path = move_file(path, processed_imports_dir())
    print(f"{result['message']} Moved to {processed_path}")


class Handler(FileSystemEventHandler):
    def on_created(self, event) -> None:
        if event.is_directory:
            return
        path = Path(event.src_path)
        try:
            process_file(path)
        except Exception as exc:
            failed_path = failed_imports_dir() / path.parent.name
            failed_path.mkdir(parents=True, exist_ok=True)
            error_file = failed_path / f"{path.name}.error.txt"
            error_file.write_text(str(exc), encoding="utf-8")
            if path.exists():
                move_file(path, failed_imports_dir())
            print(f"Import failed for {path.name}: {exc}")


def main() -> None:
    ensure_manual_dirs()
    for import_type in SUPPORTED_TYPES:
        (incoming_dir() / import_type).mkdir(parents=True, exist_ok=True)

    for import_type in SUPPORTED_TYPES:
        for path in (incoming_dir() / import_type).iterdir():
            if path.is_file():
                try:
                    process_file(path)
                except Exception as exc:
                    print(f"Import failed for {path.name}: {exc}")

    observer = Observer()
    observer.schedule(Handler(), str(incoming_dir()), recursive=True)
    observer.start()
    print(f"Watching local folder: {incoming_dir()}")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


if __name__ == "__main__":
    main()
