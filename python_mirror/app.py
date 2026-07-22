from __future__ import annotations

import logging
import os
import subprocess
import sys
import csv
from functools import wraps
from io import StringIO
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, Response, abort, flash, jsonify, redirect, render_template, request, session, url_for
from werkzeug.exceptions import HTTPException
from werkzeug.utils import secure_filename

from db import init_db
from repositories import (
    authenticate,
    change_password,
    find_user,
    list_users,
    submit_manual_change,
)
from services.access_control import can_view_team, can_view_user, visible_users
from services.access_control import SUPERVISOR_ROLES, TEAM_ROLES
from services.role_model import role_family
from services.ai_client import ai_is_configured
from services.appraisal_data import (
    APPRAISAL_CATEGORIES,
    appraisal_text,
    default_appraisal_dates,
    generate_appraisal,
)
from services.competency_analysis import analyse_officer
from services.competency_scoring import score_evidence_for_officer, score_projects_for_officer
from services.daily_csv_builder import build_daily_csv
from services.dashboard_data import dashboard_portal_data
from services.local_importer import import_local_file, import_org_chart_file
from services.manual_paths import ensure_manual_dirs, incoming_dir, outgoing_changes_dir
from services.admin_data import (
    add_officer,
    admin_portal_data,
    org_chart_export_fieldnames,
    org_chart_export_rows,
    remove_officer,
    save_competency_source_weight,
    save_organisation_assignment,
    save_organisation_assignments,
    save_manager_profiles,
    save_readiness_settings,
    save_readiness_threshold,
)

from services.project_data import (
    all_projects,
    find_project,
    projects_for,
    projects_for_project_lead,
    save_project_record,
    update_project_supervisor_evidence,
)

from services.readiness_data import (
    cached_competency_development_summaries,
    competency_groups,
    ensure_competency_development_summaries,
    readiness_for,
)
from services.team_data import team_portal_data
from services.training_data import generate_training_keywords, training_for

load_dotenv()               ## load .env
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
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
    nav_user = viewed_user if user and user["role"] == "Admin" and viewed_user and viewed_user["id"] != user["id"] else user
    page_data["viewed_user"] = viewed_user
    page_data["nav_user"] = nav_user
    page_data["nav_user_can_view_team"] = can_view_team(nav_user) if nav_user else False
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


@app.route("/change-password", methods=["POST"])
@login_required
def change_own_password():
    user = current_user()
    new_password = request.form.get("new_password", "")
    confirm_password = request.form.get("confirm_password", "")
    if new_password != confirm_password:
        flash("New passwords do not match.", "error")
        return redirect(request.referrer or url_for("dashboard"))
    try:
        change_password(user["id"], request.form.get("current_password", ""), new_password)
        session.clear()
        flash("Password changed. Please log in again with your new password.", "success")
        return redirect(url_for("login"))
    except Exception as exc:
        flash(str(exc), "error")
    return redirect(request.referrer or url_for("dashboard"))


## Saves which team member an Admin is viewing.
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


@app.route("/dashboard/generate-ai-summary", methods=["POST"])
@login_required
def generate_dashboard_ai_summary():
    visible, officer = resolve_visible_officer()
    app.logger.info("Dashboard AI summary requested officer_id=%s", officer["id"])
    if not ai_is_configured():
        flash("AI is not configured, so the dashboard summary was not generated.", "error")
        return redirect(url_for("dashboard"))

    try:
        result = analyse_officer(officer["id"], use_ai=True, force=True)
        app.logger.info("Dashboard AI summary result officer_id=%s mode=%s", officer["id"], result.get("mode"))
        if result.get("mode") == "local_rules_after_ai_error":
            app.logger.error("Dashboard AI summary failed officer_id=%s error=%s", officer["id"], result.get("ai_error"))
            flash(f"Could not generate dashboard AI summary: {result.get('ai_error')}", "error")
        elif result.get("mode") == "ai_cached":
            flash("AI dashboard summary was already up to date.", "success")
        else:
            flash("AI dashboard summary generated.", "success")
    except Exception as error:
        app.logger.exception("Dashboard AI summary crashed officer_id=%s", officer["id"])
        flash(f"Could not generate dashboard AI summary: {error}", "error")
    return redirect(url_for("dashboard", officer_id=officer["id"]))


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
        competency_groups=competency_groups(officer["id"], include_leadership=False),
    )


@app.route("/competency-development-summary", methods=["POST"])
@login_required
def competency_development_summary():
    user = current_user()
    officer_id = request.json.get("officer_id", "") if request.is_json else request.form.get("officer_id", "")
    competency_name = request.json.get("competency_name", "") if request.is_json else request.form.get("competency_name", "")
    officer = find_user(officer_id)
    if not officer or not can_view_user(user, officer):
        abort(403)

    ensure_competency_development_summaries(officer_id)
    summaries = cached_competency_development_summaries(officer_id)
    return jsonify(
        {
            "summary": summaries.get(
                competency_name,
                "No AI development summary is available for this competency yet.",
            )
        }
    )


@app.route("/appraisal", methods=["GET", "POST"])
@login_required
def appraisal_page():
    visible, officer = resolve_visible_officer()
    default_start, default_end = default_appraisal_dates()
    start_date = request.form.get("start_date", default_start)
    end_date = request.form.get("end_date", default_end)
    appraisal = None

    if request.method == "POST":
        try:
            appraisal = generate_appraisal(officer["id"], start_date, end_date)
            flash("Appraisal draft generated.", "success")
        except Exception as error:
            flash(f"Could not generate appraisal draft: {error}", "error")

    return render_page(
        "appraisal.html",
        users=visible,
        officer=officer,
        start_date=start_date,
        end_date=end_date,
        appraisal=appraisal,
        categories=APPRAISAL_CATEGORIES,
    )


@app.route("/appraisal/download", methods=["POST"])
@login_required
def download_appraisal():
    visible, officer = resolve_visible_officer()
    achievement_rows = []
    categories = request.form.getlist("achievement_category")
    target_sets = request.form.getlist("achievement_target_sets")
    completion_dates = request.form.getlist("achievement_target_completion_date")
    progress_rows = request.form.getlist("achievement_progress")
    for index, category in enumerate(categories):
        achievement_rows.append(
            {
                "category": category,
                "target_sets": target_sets[index] if index < len(target_sets) else "",
                "target_completion_date": completion_dates[index] if index < len(completion_dates) else "",
                "achievements_progress": progress_rows[index] if index < len(progress_rows) else "",
            }
        )

    values = {
        "achievements": achievement_rows,
        "work_concerns": request.form.get("work_concerns", ""),
        "strengths_development": request.form.get("strengths_development", ""),
        "career_goals": request.form.get("career_goals", ""),
        "improve_develop": request.form.get("improve_develop", ""),
        "supervisor_help": request.form.get("supervisor_help", ""),
        "other_matters": request.form.get("other_matters", ""),
    }
    content = appraisal_text(
        officer["name"],
        request.form.get("start_date", ""),
        request.form.get("end_date", ""),
        values,
    )
    return Response(
        content,
        mimetype="text/plain",
        headers={
            "Content-Disposition": f"attachment; filename=mirror_appraisal_{officer['id']}.txt"
        },
    )


@app.route("/readiness/score-evidence", methods=["POST"])
@login_required
def score_existing_evidence():
    visible, officer = resolve_visible_officer()
    if not ai_is_configured():
        flash("AI is not configured, so interaction/project scoring was skipped.")
        return redirect(url_for("readiness_page"))

    try:
        result = score_evidence_for_officer(officer["id"])
        flash(
            "AI scoring updated "
            f"{result['interaction_scores']} interaction competency rows and "
            f"{result['project_scores']} project competency rows."
        )
    except Exception as error:
        flash(f"Could not score existing evidence: {error}")

    return redirect(url_for("readiness_page"))


## Shows pending, in-progress, and completed training records.
@app.route("/training")
@login_required
def training_page():
    visible, officer = resolve_visible_officer()
    data = training_for(
        officer["id"],
        search=request.args.get("search", ""),                  ## reads ?search=... from the URL (searchbar)
        status=request.args.get("status", "All"),               ## status reads the dropdown value ("All", "Pending", "In Progress", "Completed")
        show_archived=request.args.get("show_archived") == "1"        ## checks whether archived checkbox was ticked
    )
    data["keyword_recommendations"] = session.get(f"training_keywords_{officer['id']}", [])
    return render_page(
        "training.html",
        users=visible,
        officer=officer,
        data=data,
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
# @app.route("/training/generate-recommendations", methods=["POST"])
# @login_required
# def generate_recommendations():
#     visible, officer = resolve_visible_officer()
#     try:
#         count = generate_training_recommendations(officer["id"])
#         flash(f"Generated {count} course recommendations.")
#     except Exception as error:
#         flash(f"Could not generate recommendations: {error}")
#     return redirect(url_for("training_page"))


@app.route("/training/generate-keywords", methods=["POST"])
@login_required
def generate_training_search_keywords():
    visible, officer = resolve_visible_officer()
    try:
        keywords = generate_training_keywords(officer["id"])
        session[f"training_keywords_{officer['id']}"] = keywords
        flash(f"Generated {len(keywords)} course search keywords.")
    except Exception as error:
        flash(f"Could not generate search keywords: {error}", "error")
    return redirect(url_for("training_page"))


@app.route("/projects", methods=["GET", "POST"])
@login_required
def projects_page():
    visible, officer = resolve_visible_officer()
    user = current_user()

    ## POST add_project
    if request.method == "POST":
        action = request.form.get("action")

        try:
            ## ONLY officer himself creates project
            if action == "add_project":
                if officer["id"] != user["id"]:
                    abort(403)
                values = request.form.copy()            ## values in the form (project_name, team_lead, requirements)
                values["officer_id"] = officer["id"]    ## value not in the form
                save_project_record(values)

            ## project manager gives feedback
            elif action == "save_supervisor_evidence":

                ## check who owns/leads the project
                project = find_project(request.form["project_id"])
                if not project:
                    abort(404)
                lead_ids = { item.strip() for item in project["project_leads"].split(";") if item.strip() }
                if user["id"] not in lead_ids and user["role"] != "Admin":
                    abort(403)

                update_project_supervisor_evidence(
                    request.form["project_id"],
                    request.form.get("evidence_text", ""),
                    request.form.get("supervisor_comments", ""),
                )
                score_projects_for_officer(project["officer_id"])

            flash("Project saved")
        except HTTPException:
            raise
        except Exception as error:
            flash(f"Could not save project: {error}", "error")

        return redirect(url_for("projects_page"))

    ## GET /projects -> show projects
    if user["role"] == "Admin":
        projects = all_projects()
    elif user["role"] in TEAM_ROLES:
        projects = projects_for_project_lead(user["id"])
    else:
        projects = projects_for(officer["id"])


    ## render_page( "which HTML file", variables to give that HTML file to use (eg. {% for project in projects %}) )
    return render_page(
        "projects.html",
        users=visible,
        officer=officer,
        projects=projects,
        project_lead_options=[ item for item in list_users() if item["role"] in {*TEAM_ROLES, "Admin"} ],
    )


@app.route("/projects/export-csv")
@login_required
def export_projects_csv():
    user = current_user()
    if user["role"] == "Admin":
        projects = all_projects()
    elif user["role"] in TEAM_ROLES:
        projects = projects_for_project_lead(user["id"])
    else:
        visible, officer = resolve_visible_officer()
        projects = projects_for(officer["id"])

    output = StringIO()
    fieldnames = [
        "officer_id",
        "Project Name",
        "Project Managers",
        "What was your role?",
        "Requirements",
        "What Was Done",
        "Project Manager Comments",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for project in projects:
        writer.writerow(
            {
                "officer_id": project["officer_id"],
                "Project Name": project["project_name"],
                "Project Managers": project["project_leads"],
                "What was your role?": project["project_role"],
                "Requirements": project["requirements_text"],
                "What Was Done": project["evidence_text"],
                "Project Manager Comments": project["supervisor_comments"],
            }
        )

    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=mirror_project_updates.csv"
        },
    )


## Shows the change request form and creates an outgoing JSON change file when submitted.
@app.route("/changes", methods=["GET", "POST"])
@login_required
def changes():
    user = current_user()
    if user["role"] not in TEAM_ROLES:
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
    import_destination = (
        url_for("admin_page", tab="import")
        if user["role"] == "Admin"
        else url_for("local_import_page")
    )
    uploaded = request.files.get("file")
    if not uploaded or not uploaded.filename:
        flash("Choose a CSV or Excel file first.", "error")
        return redirect(import_destination)
    filename = secure_filename(uploaded.filename)
    target = incoming_dir() / filename
    target.parent.mkdir(parents=True, exist_ok=True)
    uploaded.save(target)
    try:
        result = import_local_file(target)
        flash(result["message"], "success")
    except Exception as exc:
        flash(f"Import failed: {exc}", "error")
    return redirect(import_destination)


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
    if role_family(user["role"]) == "cse":
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
                request.form["tier"],
                request.form["stage"],
                request.form["metric"],
                float(request.form["minimum_value"]),
            )
            flash("Readiness threshold saved.", "success")
        elif action == "save_competency_source_weight":
            save_competency_source_weight(request.form)
            flash("Competency source weight saved.", "success")
        elif action == "save_organisation":
            save_organisation_assignment(
                request.form["officer_id"],
                request.form.get("manager_id"),
                request.form.get("team_name", ""),
                request.form.get("trained_schemes", ""),
            )
            flash("Organisation assignment saved.", "success")
        elif action == "save_organisation_all":
            assignments = []
            for officer_id in request.form.getlist("officer_id"):
                assignments.append(
                    {
                        "officer_id": officer_id,
                        "role": request.form.get(f"role_{officer_id}", ""),
                        "manager_id": request.form.get(f"manager_id_{officer_id}", ""),
                        "team_name": request.form.get(f"team_name_{officer_id}", ""),
                        "trained_schemes": request.form.get(f"trained_schemes_{officer_id}", ""),
                    }
                )
            save_organisation_assignments(assignments)
            flash("Organisation chart saved.", "success")
        elif action == "save_manager_profiles":
            rows = []
            for officer_id in request.form.getlist("manager_profile_officer_id"):
                rows.append(
                    {
                        "officer_id": officer_id,
                        "handles_member_correspondence": request.form.get(f"handles_member_correspondence_{officer_id}") == "1",
                        "handles_projects": request.form.get(f"handles_projects_{officer_id}") == "1",
                        "leads_team": request.form.get(f"leads_team_{officer_id}") == "1",
                    }
                )
            save_manager_profiles(rows)
            flash("Manager settings saved.", "success")
        elif action == "add_officer":
            add_officer(
                request.form["username"],
                request.form["name"],
                request.form["role"],
                request.form["password"],
                request.form.get("team", ""),
            )
            flash("Officer added.", "success")
        elif action == "remove_officer":
            remove_officer(request.form["officer_id"])
            flash("Officer removed.", "success")
        elif action == "import_org_chart":
            uploaded = request.files.get("org_chart_file")
            if not uploaded or not uploaded.filename:
                raise ValueError("Choose an org chart CSV or Excel file first.")
            filename = secure_filename(uploaded.filename)
            target = incoming_dir() / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            uploaded.save(target)
            result = import_org_chart_file(target)
            flash(result["message"], "success")
    except Exception as exc:
        flash(str(exc), "error")
    ## Redirect makes the browser send a fresh GET request for the selected admin tab.
    return redirect(url_for("admin_page", tab=request.form.get("tab", "settings")))


@app.route("/admin/export-org-chart")
@login_required
def export_org_chart_csv():
    user = current_user()
    if user["role"] != "Admin":
        abort(403)

    output = StringIO()
    writer = csv.DictWriter(output, fieldnames=org_chart_export_fieldnames())
    writer.writeheader()
    writer.writerows(org_chart_export_rows())

    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=mirror_org_chart.csv"
        },
    )


@app.route("/admin/build-daily-csv", methods=["POST"])
@login_required
def build_daily_csv_page():
    user = current_user()
    if user["role"] != "Admin":
        abort(403)
    try:
        csv_text = build_daily_csv(request.files.getlist("source_files"))
    except Exception as exc:
        flash(str(exc), "error")
        return redirect(url_for("admin_page", tab="build_csv"))

    return Response(
        csv_text,
        mimetype="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=mirror_daily_import.csv"
        },
    )



## Shows team-level officer performance, but only for TL/CSM/AH/Admin.
@app.route("/team")
@login_required
def team():
    user = current_user()
    viewed_user_id = session.get("view_as_id") if user["role"] == "Admin" else None
    leader = find_user(viewed_user_id) if viewed_user_id else user
    if not leader or not can_view_team(leader):                     ## If user is CSE, block.
        abort(403)
    users = list_users()                            ## Get full list of users from database.
    visible = visible_users(leader, users)            ## visible_users() returns only users this person can see.
    return render_page("team.html", data=team_portal_data(visible, leader))


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "db": "sqlite", "mode": "local_only"})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
