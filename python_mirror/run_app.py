import os

from app import app


def should_run_startup_import(debug_enabled: bool) -> bool:
    if os.getenv("MIRROR_IMPORT_ONEDRIVE", "false").lower() != "true":
        return False
    if not debug_enabled:
        return True
    return os.environ.get("WERKZEUG_RUN_MAIN") == "true"

if __name__ == "__main__":
    port = int(os.getenv("MIRROR_PORT", "5000"))
    debug_enabled = os.getenv("MIRROR_DEBUG", "true").lower() == "true"

    if should_run_startup_import(debug_enabled):
        from services.onedrive_importer import import_onedrive_files

        try:
            result = import_onedrive_files()
            app.logger.info("OneDrive import completed: %s", result)
        except FileNotFoundError as exc:
            raise RuntimeError(
                f"Required OneDrive file is missing: {exc}. "
                "Please make sure the MIRROR OneDrive folder is synced."
            ) from exc

    app.config["TEMPLATES_AUTO_RELOAD"] = debug_enabled
    app.run(
        host="127.0.0.1",
        port=port,
        debug=debug_enabled,
        use_reloader=debug_enabled,
    )
