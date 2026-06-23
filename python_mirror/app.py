from __future__ import annotations

import os
import subprocess
import sys
from functools import wraps
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, abort, flash, jsonify, redirect, render_template, request, session, url_for
from werkzeug.utils import secure_filename

from db import init_db
from repositories import (
    authenticate,
    find_user,
    find_user_by_username,
    list_users,
    submit_manual_change,
)
from services.access_control import can_view_team, can_view_user, visible_users
from services.local_importer import import_local_file
from services.manual_paths import ensure_manual_dirs, incoming_dir, outgoing_changes_dir
from services.portal_data import (
    add_officer,
    admin_portal_data,
    competency_groups,
    dashboard_portal_data,
    generate_training_recommendations,
    remove_officer,
    readiness_for,
    save_organisation_assignment,
    save_readiness_settings,
    save_readiness_threshold,
    team_portal_data,
    training_for,
)

load_dotenv()               ## load .env
init_db()                   ## create SQLite tables if missing
ensure_manual_dirs()        ## create local folders if missing

## create flask app
app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "local-dev-secret")

## gets the logged in user from the session
def current_user():
    user_id = session.get("user_id")
    return find_user(user_id) if user_id else None


## wraps a page function (fn) so it redirects to login if nobody is logged in
def login_required(fn):
    @wraps(fn)
    ## the actual wrapped function that checks login before running the original fn
    def wrapper(*args, **kwargs):
        if not current_user():
            return redirect(url_for("login"))
        return fn(*args, **kwargs)

    return wrapper

## renders an HTML template and automatically adds the logged-in user
def render_page(template_name, **page_data):
    user = current_user()
    page_data["logged_in_user"] = user
    visible = visible_users(user, list_users()) if user else []
    viewed_user_id = session.get("view_as_id")
    viewed_user = find_user(viewed_user_id) if viewed_user_id else user
    page_data["viewed_user"] = viewed_user
    page_data["viewing_options"] = visible
    return render_template(template_name, **page_data)


## home route, if logged in go dashboard, if not go login
@app.route("/")
def home():
    user = current_user()
    if not user:
        return redirect(url_for("login"))
    if user["role"] == "Admin":
        return redirect(url_for("admin_page"))
    return redirect(url_for("dashboard"))


## Clears the session and sends the user back to Login.
@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        user = authenticate(request.form.get("username", ""), request.form.get("password", ""))
        if not user:
            flash("Invalid username or password.", "error")
            return render_page("login.html")
        session["user_id"] = user["id"]
        destination = "admin_page" if user["role"] == "Admin" else "dashboard"
        return redirect(url_for(destination))
    return render_page("login.html")


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("login"))


## Saves which team member an Admin, TL, or Supervisor is viewing.
@app.route("/view-as", methods=["POST"])
@login_required
def view_as():
    user = current_user()
    if user["role"] != "Admin":
        abort(403)

    selected_id = request.form.get("officer_id")
    selected_user = find_user(selected_id)
    if not selected_user:
        abort(403)

    ## selecting yourself returns to Admin pages
    if selected_id == user["id"]:
        session.pop("view_as_id", None)
        return redirect(url_for("admin_page"))

    session["view_as_id"] = selected_id
    return redirect(url_for("dashboard"))


## Stops Viewing As and returns to the logged-in user's own pages.
@app.route("/stop-viewing", methods=["POST"])
@login_required
def stop_viewing():
    user = current_user()
    if user["role"] != "Admin":
        abort(403)

    session.pop("view_as_id", None)             ## session = { "user_id": "admin", "view_as_id": "cso001" }, pop(key to remove, remove None if key dont exist this is when Admin not viewing anyone)
    return redirect(url_for("admin_page"))


## Shows the dashboard for the selected/allowed officer.
@app.route("/dashboard")
@login_required
def dashboard():
    if (
        current_user()["role"] == "Admin"
        and not request.args.get("officer_id")
        and not session.get("view_as_id")
    ):
        return redirect(url_for("admin_page"))
    visible, officer = resolve_visible_officer()
    requested_months = request.args.get("months")
    if requested_months in {"3", "6", "12"}:
        session["dashboard_months"] = requested_months
    months = session.get("dashboard_months", "3")
    data = dashboard_portal_data(
        officer["id"],
        months=int(months) if months.isdigit() else 3,
    )
    return render_page("dashboard.html", data=data, users=visible, officer=officer)


## Shows the officer's readiness journey, thresholds, radar, and competency groups.
@app.route("/readiness")
@login_required
def readiness_page():
    visible, officer = resolve_visible_officer()
    return render_page(
        "readiness.html",
        users=visible,
        officer=officer,
        readiness=readiness_for(officer["id"]),
        competency_groups=competency_groups(officer["id"]),
    )


## Shows pending, in-progress, and completed training records.
@app.route("/training")
@login_required
def training_page():
    visible, officer = resolve_visible_officer()
    return render_page(
        "training.html",
        users=visible,
        officer=officer,
        data=training_for(
            officer["id"],
            search=request.args.get("search", ""),                  ## reads ?search=... from the URL (searchbar)
            status=request.args.get("status", "All"),               ## status reads the dropdown value ("All", "Pending", "In Progress", "Completed")
            show_archived=request.args.get("show_archived") == "1"        ## checks whether archived checkbox was ticked
            ),
    )
## clicking Apply changes the URL to something like: /training?search=writing&status=Completed&show_archived=1


## Starts the Learn.gov.sg course catalogue scraper in the background.
@app.route("/training/refresh-courses", methods=["POST"])
@login_required
def refresh_course_catalogue():
    base_dir = Path(__file__).resolve().parent
    script_path = base_dir / "scripts" / "sync_learn_courses.py"
    log_path = base_dir / "logs" / "course_sync.log"

    log_path.parent.mkdir(exist_ok=True)

    with log_path.open("a", encoding="utf-8") as log_file:
        subprocess.Popen(
            [sys.executable, str(script_path)],
            cwd=str(base_dir),
            stdout=log_file,
            stderr=log_file,
        )

    flash("Course catalogue refresh started. You can stay on this page while it runs.")
    return redirect(url_for("training_page"))


## Generates course recommendations for the currently viewed officer.
@app.route("/training/generate-recommendations", methods=["POST"])
@login_required
def generate_recommendations():
    visible, officer = resolve_visible_officer()
    try:
        count = generate_training_recommendations(officer["id"])
        flash(f"Generated {count} course recommendations.")
    except Exception as error:
        flash(f"Could not generate recommendations: {error}")
    return redirect(url_for("training_page"))


## Shows the change request form and creates an outgoing JSON change file when submitted.
@app.route("/changes", methods=["GET", "POST"])
@login_required
def changes():
    user = current_user()
    if user["role"] not in {"TL", "Supervisor"}:
        abort(403)
    if request.method == "POST":
        change_details = {
            "field_name": request.form["field_name"],
            "new_value": request.form["new_value"],
            "note": request.form.get("note", ""),
        }
        change = submit_manual_change(
            table_name=request.form["table_name"],
            record_id=request.form["record_id"],
            operation="UPDATE",
            change_details=change_details,
            submitted_by=user["username"],
            base_record_version=int(request.form.get("base_record_version") or 0),
        )
        flash(f"Change file created: {change['file_path']}", "success")
        return redirect(url_for("changes"))
    return render_page("changes.html", outgoing_dir=outgoing_changes_dir())


## Shows the Local Import page and imports uploaded CSV/XLSX data into SQLite
@app.route("/import")
@login_required
def local_import_page():
    return render_page("import.html", incoming_dir=incoming_dir())


@app.route("/upload", methods=["POST"])
@login_required
def upload():
    user = current_user()
    uploaded = request.files.get("file")
    if not uploaded or not uploaded.filename:
        flash("Choose a CSV or Excel file first.", "error")
        return redirect(url_for("local_import_page"))
    filename = secure_filename(uploaded.filename)
    target = incoming_dir() / filename
    target.parent.mkdir(parents=True, exist_ok=True)
    uploaded.save(target)
    try:
        officer = None
        if request.form["import_type"] != "training":
            entered_officer = request.form.get("officer_id") or user["id"]
            officer = find_user(entered_officer) or find_user_by_username(entered_officer)
            if not officer:
                raise ValueError("The selected officer was not found.")
        result = import_local_file(
            target,
            import_type=request.form["import_type"],
            default_officer_id=officer["id"] if officer else None,
            from_date=request.form.get("from_date") or None,
            to_date=request.form.get("to_date") or None,
        )
        flash(result["message"], "success")
    except Exception as exc:
        flash(f"Import failed: {exc}", "error")
    return redirect(url_for("local_import_page"))


## Figures out which officer the logged-in user is allowed to view.
## resolve permissions and selected officer
## get forecast data
## render page
def resolve_visible_officer():
    user = current_user()
    users = list_users()
    visible = visible_users(user, users)
    officer_id = (
        request.values.get("officer_id")
        or session.get("view_as_id")
        or user["id"]
    )
    if user["role"] == "CSE":
        officer_id = user["id"]

    officer = find_user(officer_id)
    if officer is None:
        officer = user

    if not can_view_user(user, officer):
        abort(403)
    return visible, officer


## Shows the admin page, but only for Admin users.
@app.route("/admin", methods=["GET", "POST"])
@login_required
def admin_page():
    user = current_user()
    if user["role"] != "Admin":
        abort(403)

    if request.method == "GET":
        return render_page(
            "admin.html",
            data=admin_portal_data(),
            selected_tab=request.args.get("tab", "settings"),
            incoming_dir=incoming_dir(),
        )

    action = request.form.get("action")
    try:
        if action == "save_settings":
            save_readiness_settings(dict(request.form))
            flash("Readiness settings saved.", "success")
        elif action == "save_threshold":
            save_readiness_threshold(
                request.form["stage"],
                request.form["metric"],
                float(request.form["minimum_value"]),
            )
            flash("Readiness threshold saved.", "success")
        elif action == "save_organisation":
            save_organisation_assignment(
                request.form["officer_id"],
                request.form.get("manager_id"),
                request.form.get("team_name", ""),
            )
            flash("Organisation assignment saved.", "success")
        elif action == "add_officer":
            add_officer(
                request.form["username"],
                request.form["name"],
                request.form["role"],
                request.form["password"],
            )
            flash("Officer added.", "success")
        elif action == "remove_officer":
            remove_officer(request.form["officer_id"])
            flash("Officer removed.", "success")
    except Exception as exc:
        flash(str(exc), "error")
    ## Redirect makes the browser send a fresh GET request for the selected admin tab.
    return redirect(url_for("admin_page", tab=request.form.get("tab", "settings")))



## Shows team-level officer performance, but only for TL/Supervisor/Admin.
@app.route("/team")
@login_required
def team():
    user = current_user()
    if not can_view_team(user):                     ## If user is CSE, block.
        abort(403)
    users = list_users()                            ## Get full list of users from database.
    visible = visible_users(user, users)            ## visible_users() returns only users this person can see.
    return render_page("team.html", data=team_portal_data(visible, user))


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "db": "sqlite", "mode": "local_only"})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
