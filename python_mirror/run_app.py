import os

from app import app

if __name__ == "__main__":
    port = int(os.getenv("MIRROR_PORT", "5000"))
    debug_enabled = os.getenv("MIRROR_DEBUG", "true").lower() == "true"
    app.config["TEMPLATES_AUTO_RELOAD"] = debug_enabled
    app.run(
        host="127.0.0.1",
        port=port,
        debug=debug_enabled,
        use_reloader=debug_enabled,
    )
