from __future__ import annotations

import os
import shutil
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from services.local_importer import import_local_file
from services.manual_paths import (
    ensure_manual_dirs,
    failed_imports_dir,
    incoming_dir,
    processed_imports_dir,
)

load_dotenv()

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


def validate_file(path: Path) -> None:
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {path.suffix}")


def move_file(path: Path, destination_root: Path) -> Path:
    destination = destination_root
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
    validate_file(path)
    result = import_local_file(path)
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
            failed_path = failed_imports_dir()
            failed_path.mkdir(parents=True, exist_ok=True)
            error_file = failed_path / f"{path.name}.error.txt"
            error_file.write_text(str(exc), encoding="utf-8")
            if path.exists():
                move_file(path, failed_imports_dir())
            print(f"Import failed for {path.name}: {exc}")


def main() -> None:
    ensure_manual_dirs()
    for path in incoming_dir().iterdir():
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
