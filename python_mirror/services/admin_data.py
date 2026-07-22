## builds the admin pages data
from __future__ import annotations

from collections import defaultdict
from typing import Any

from werkzeug.security import generate_password_hash

from db import connect, loads, new_id

from services.competency_scoring import (
    CORE_COMPETENCIES,
    CORRESPONDENCE_COMPETENCIES,
    FUNCTIONAL_COMPETENCIES,
    LEADERSHIP_COMPETENCIES,
)

from services.portal_defaults import ensure_portal_defaults
from services.role_model import (
    ADMIN_ROLE,
    CUSTOM_MANAGER_ROLES,
    ROLE_OPTIONS,
    WEIGHT_ROLE_OPTIONS,
    can_manage_role,
    clean_role_name,
    clean_weight_role_name,
    default_target_role,
    has_default_leadership,
    role_sort_key,
)

EDITABLE_ROLES = set(ROLE_OPTIONS)

## builds the Admin page data
def admin_portal_data() -> dict[str, Any]:
    ensure_portal_defaults()
    with connect() as conn:
        settings = [
            dict(row)
            for row in conn.execute(
                """
                SELECT * FROM readiness_settings
                ORDER BY role
                """
            ).fetchall()
        ]
        settings.sort(key=lambda row: role_sort_key(row["role"]))
        users = [
            dict(row)
            for row in conn.execute(
                """
                SELECT users.id, users.username, users.name, users.role,
                       org.manager_id, org.team_name, org.trained_schemes,
                       COALESCE(manager_profiles.handles_member_correspondence, 0) AS handles_member_correspondence,
                       COALESCE(manager_profiles.handles_projects, 1) AS handles_projects,
                       COALESCE(manager_profiles.leads_team, 0) AS leads_team
                FROM users
                LEFT JOIN organisation_relationships org
                  ON org.officer_id = users.id
                LEFT JOIN manager_profiles
                  ON manager_profiles.officer_id = users.id
                ORDER BY users.role, users.name
                """
            ).fetchall()
        ]
        users.sort(key=lambda user: (*role_sort_key(user["role"]), user["name"]))
        thresholds = [
            dict(row)
            for row in conn.execute(
                """
                SELECT * FROM readiness_thresholds
                ORDER BY tier,
                  CASE stage
                  WHEN 'Meeting Expectations' THEN 1
                  WHEN 'Stretch Assignment Ready' THEN 2
                  ELSE 3 END,
                  sequence
                """
            ).fetchall()
        ]
        source_weights = [
            dict(row)
            for row in conn.execute(
                """
                SELECT * FROM competency_source_weights
                ORDER BY role, competency_name
                """
            ).fetchall()
        ]
        source_weights.sort(key=lambda row: (*role_sort_key(row["role"]), row["competency_name"]))
    children_by_manager: dict[str | None, list[dict[str, Any]]] = defaultdict(list)     ## building a new dict of lists
    manager_options_by_user = {
        user["id"]: manager_options_for(user, users)
        for user in users
    }


    ## for every user in users, it looks at the user's manager_id eg. George, so children_by_manager[George] is a list of those under George (appends the whole user instead of just id, unlike access_control.py)
    for user in users:
        children_by_manager[user["manager_id"]].append(user)


    def build_tree(user: dict[str, Any]) -> dict[str, Any]:
        node = dict(user)
        node["children"] = [ build_tree(child) for child in children_by_manager.get(user["id"], []) ]
        return node

    assigned_user_ids = { user["id"] for user in users if user["manager_id"] }          ## all users that have a manager
    manager_ids = { user["manager_id"] for user in users if user["manager_id"] }        ## all user ids that are managers
    root_candidates = [ user for user in users if not user["manager_id"] and user["id"] in manager_ids ]   ## users are roots if they are not managed by someone + is a manager, so that only top managers are roots
    roots = [ build_tree(user) for user in root_candidates ]        ## list of all roots
    root_ids = {user["id"] for user in root_candidates}
    tree_user_ids = assigned_user_ids | root_ids                    ## | means set union: combine both sets without duplicates.
    unassigned_users = [ user for user in users if user["id"] not in tree_user_ids and user["role"] != "Admin" ]
    source_weights_by_role_and_name = {
        (row["role"], row["competency_name"]): row
        for row in source_weights
    }

    def source_group(role: str, names: list[str]) -> list[dict[str, Any]]:
        return [
            source_weights_by_role_and_name[(role, name)]
            for name in names
            if (role, name) in source_weights_by_role_and_name
        ]

    return {
        "settings": settings,
        "thresholds": thresholds,
        "source_weight_roles": [
            {
                "role": role,
                "groups": {
                    "Core": source_group(role, CORE_COMPETENCIES),
                    "Functional": source_group(role, FUNCTIONAL_COMPETENCIES),
                    "Correspondence": source_group(role, CORRESPONDENCE_COMPETENCIES),
                    "Leadership": source_group(role, LEADERSHIP_COMPETENCIES),
                },
                "project_only": role_has_projects_only(role),
                "has_leadership": role_has_leadership(role),
            }
            for role in WEIGHT_ROLE_OPTIONS
        ],
        "role_options": ROLE_OPTIONS,
        "custom_manager_roles": CUSTOM_MANAGER_ROLES,
        "users": users,
        "manager_options_by_user": manager_options_by_user,
        "organisation_tree": roots,
        "unassigned_users": unassigned_users,
    }


def org_chart_export_rows() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT users.id, users.username, users.name, users.role,
                   org.manager_id, org.team_name, org.trained_schemes,
                   profile.current_role, profile.target_role,
                   COALESCE(manager_profiles.handles_member_correspondence, 0) AS handles_member_correspondence,
                   COALESCE(manager_profiles.handles_projects, 1) AS handles_projects,
                   COALESCE(manager_profiles.leads_team, 0) AS leads_team
            FROM users
            LEFT JOIN organisation_relationships org
              ON org.officer_id = users.id
            LEFT JOIN career_profiles profile
              ON profile.officer_id = users.id
            LEFT JOIN manager_profiles
              ON manager_profiles.officer_id = users.id
            WHERE users.role != 'Admin'
            ORDER BY users.role, users.name
            """
        ).fetchall()
    rows = sorted(rows, key=lambda row: (*role_sort_key(row["role"]), row["name"]))

    export_rows = []
    for row in rows:
        export_rows.append(
            {
                "officer_id": row["id"],
                "Username": row["username"],
                "Officer Name": row["name"],
                "Officer Role": row["role"],
                "Manager ID": row["manager_id"] or "",
                "Team Name": row["team_name"] or "",
                "Trained Schemes": row["trained_schemes"] or "",
                "Current Role": row["current_role"] or row["role"],
                "Target Role": row["target_role"] or "",
                "Handles Member Correspondence": "Yes" if row["handles_member_correspondence"] else "",
                "Handles Projects": "Yes" if row["handles_projects"] else "",
                "Leads Team": "Yes" if row["leads_team"] else "",
            }
        )
    return export_rows


def org_chart_export_fieldnames() -> list[str]:
    return [
        "officer_id",
        "Username",
        "Officer Name",
        "Officer Role",
        "Manager ID",
        "Team Name",
        "Trained Schemes",
        "Current Role",
        "Target Role",
        "Handles Member Correspondence",
        "Handles Projects",
        "Leads Team",
    ]


## Weights & Thresholds: Save the Admin-edited readiness weights for one role.
## values: submitted admin form dict (eg. { "role": "CSE", "core_weight": "0.25", "functional_weight": "0.15", ... })
def save_readiness_settings(values: dict[str, Any]) -> None:
    role = clean_weight_role_name(str(values["role"]))
    if role not in WEIGHT_ROLE_OPTIONS:
        raise ValueError("Readiness role is not valid.")
    numeric_fields = [
        "core_weight",
        "functional_weight",
        "correspondence_weight",
        "leadership_weight",
    ]
    numbers = {}
    for field in numeric_fields:
        numbers[field] = float(values[field])           ## converting str to float { "core_weight": 0.25, "functional_weight": 0.15, ... }
    total_weight = sum(numbers.values())

    if abs(total_weight - 1) > 0.001:                   ## total_weight = 0.999999999 is accepted
        raise ValueError("The readiness weights must add up to 1.00.")
    with connect() as conn:
        conn.execute(
            """
            UPDATE readiness_settings
            SET core_weight = ?,
                functional_weight = ?,
                correspondence_weight = ?,
                leadership_weight = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE role = ?
            """,
            (
                numbers["core_weight"],
                numbers["functional_weight"],
                numbers["correspondence_weight"],
                numbers["leadership_weight"],
                role,
            ),
        )


## Weights & Thresholds: Save one threshold row after Admin edits it.
def save_readiness_threshold( tier: str, stage: str, metric: str, minimum_value: float, ) -> None:
    with connect() as conn:
        conn.execute(
            """
            UPDATE readiness_thresholds
            SET minimum_value = ?
            WHERE tier = ? AND stage = ? AND metric = ?
            """,
            (minimum_value, tier, stage, metric),
        )       ## readiness_threshold: PRIMARY KEY(stage, metric)


def save_competency_source_weight(values: Any) -> None:
    role = clean_weight_role_name(str(values["role"]))
    if role not in WEIGHT_ROLE_OPTIONS:
        raise ValueError("Source weight role is not valid.")
    competency_names = values.getlist("competency_name")
    audit_weights = values.getlist("audit_weight")
    scorecard_weights = values.getlist("scorecard_weight")
    interaction_weights = values.getlist("interaction_weight")
    project_weights = values.getlist("project_weight")

    rows = []
    for index, competency_name in enumerate(competency_names):
        audit_weight = float(audit_weights[index])
        scorecard_weight = float(scorecard_weights[index])
        interaction_weight = float(interaction_weights[index])
        project_weight = float(project_weights[index])
        if role_has_projects_only(role):
            audit_weight = 0.0
            scorecard_weight = 0.0
            interaction_weight = 0.0
            project_weight = 1.0
        elif role in {"Executive", "CSE"}:
            total_weight = audit_weight + scorecard_weight + interaction_weight
            if abs(total_weight - 1) > 0.001:
                raise ValueError(f"Audit, scorecard, and interaction weights for {competency_name} must add up to 1.00.")
            if project_weight < 0:
                raise ValueError(f"Project weight for {competency_name} cannot be negative.")
        else:
            total_weight = audit_weight + scorecard_weight + interaction_weight + project_weight
            if abs(total_weight - 1) > 0.001:
                raise ValueError(f"Source weights for {competency_name} must add up to 1.00.")
        rows.append((audit_weight, scorecard_weight, interaction_weight, project_weight, role, competency_name))

    with connect() as conn:
        conn.executemany(
            """
            UPDATE competency_source_weights
            SET audit_weight = ?,
                scorecard_weight = ?,
                interaction_weight = ?,
                project_weight = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE role = ? AND competency_name = ?
            """,
            rows,
        )


def manager_options_for(officer: dict[str, Any], users: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        user
        for user in users
        if user["id"] != officer["id"] and can_manage_role(officer["role"], user["role"])
    ]


def validate_manager_role(
    users_by_id: dict[str, dict[str, Any]],
    officer_id: str,
    manager_id: str | None,
) -> None:
    if not manager_id:
        return
    officer = users_by_id.get(officer_id)
    manager = users_by_id.get(manager_id)
    if not officer or not manager:
        raise ValueError("Officer or manager was not found.")
    if manager not in manager_options_for(officer, list(users_by_id.values())):
        raise ValueError(f"{officer['role']} cannot report to {manager['role']}.")


def clean_editable_role(role: str) -> str:
    role = role.strip()
    cleaned = clean_role_name(role)
    if cleaned not in EDITABLE_ROLES:
        raise ValueError("Officer role is not a valid MIRROR role.")
    return cleaned


## Org Chart: when editing officer on the org chart
def save_organisation_assignment( officer_id: str, manager_id: str | None, team_name: str, trained_schemes: str = "", ) -> None:
    manager_id = manager_id or None
    if officer_id == manager_id:
        raise ValueError("An officer cannot be their own manager.")
    with connect() as conn:
        users_by_id = {
            row["id"]: dict(row)
            for row in conn.execute("SELECT id, role FROM users").fetchall()
        }
        validate_manager_role(users_by_id, officer_id, manager_id)
        conn.execute(
            """
            INSERT INTO organisation_relationships
              (officer_id, manager_id, team_name, trained_schemes, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(officer_id) DO UPDATE SET
              manager_id = excluded.manager_id,
              team_name = excluded.team_name,
              trained_schemes = excluded.trained_schemes,
              updated_at = CURRENT_TIMESTAMP
            """,
            (officer_id, manager_id, team_name.strip(), trained_schemes.strip()),
        )


def save_organisation_assignments(assignments: list[dict[str, str]]) -> None:
    with connect() as conn:
        users_by_id = {
            row["id"]: dict(row)
            for row in conn.execute("SELECT id, role FROM users").fetchall()
        }
        for assignment in assignments:
            officer_id = assignment["officer_id"]
            if officer_id in users_by_id and users_by_id[officer_id]["role"] != "Admin":
                users_by_id[officer_id]["role"] = clean_editable_role(assignment.get("role", users_by_id[officer_id]["role"]))

        for assignment in assignments:
            officer_id = assignment["officer_id"]
            manager_id = assignment.get("manager_id") or None
            if officer_id == manager_id:
                raise ValueError("An officer cannot be their own manager.")
            validate_manager_role(users_by_id, officer_id, manager_id)

        for assignment in assignments:
            officer_id = assignment["officer_id"]
            if officer_id in users_by_id and users_by_id[officer_id]["role"] != "Admin":
                conn.execute(
                    """
                    UPDATE users
                    SET role = ?, record_version = record_version + 1, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (users_by_id[officer_id]["role"], officer_id),
                )
                target_role = default_target_role(users_by_id[officer_id]["role"])
                conn.execute(
                    """
                    INSERT INTO career_profiles
                      (officer_id, current_role, target_role, responsibilities_json, target_responsibilities_json, updated_at)
                    VALUES (?, ?, ?, '[]', '[]', CURRENT_TIMESTAMP)
                    ON CONFLICT(officer_id) DO UPDATE SET
                      current_role = excluded.current_role,
                      target_role = excluded.target_role,
                      updated_at = CURRENT_TIMESTAMP
                    """,
                    (officer_id, users_by_id[officer_id]["role"], target_role),
                )
            conn.execute(
                """
                INSERT INTO organisation_relationships
                  (officer_id, manager_id, team_name, trained_schemes, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(officer_id) DO UPDATE SET
                  manager_id = excluded.manager_id,
                  team_name = excluded.team_name,
                  trained_schemes = excluded.trained_schemes,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    officer_id,
                    assignment.get("manager_id") or None,
                    assignment.get("team_name", "").strip(),
                    assignment.get("trained_schemes", "").strip(),
                ),
            )
        conn.commit()


def save_manager_profiles(rows: list[dict[str, Any]]) -> None:
    with connect() as conn:
        for row in rows:
            officer_id = row["officer_id"]
            role_row = conn.execute(
                "SELECT role FROM users WHERE id = ?",
                (officer_id,),
            ).fetchone()
            if not role_row or role_row["role"] not in CUSTOM_MANAGER_ROLES:
                continue
            conn.execute(
                """
                INSERT INTO manager_profiles
                  (officer_id, handles_member_correspondence, handles_projects, leads_team, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(officer_id) DO UPDATE SET
                  handles_member_correspondence = excluded.handles_member_correspondence,
                  handles_projects = excluded.handles_projects,
                  leads_team = excluded.leads_team,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    officer_id,
                    1 if row.get("handles_member_correspondence") else 0,
                    1 if row.get("handles_projects") else 0,
                    1 if row.get("leads_team") else 0,
                ),
            )


def add_officer(username: str, name: str, role: str, password: str, team_name: str = "", trained_schemes: str = "") -> None:
    username = username.strip().lower()
    name = name.strip()
    if not username or not name or not password:
        raise ValueError("Username, name, and temporary password are required.")
    role = clean_editable_role(role)
    with connect() as conn:
        officer_id = new_id()
        conn.execute(
            """
            INSERT INTO users (id, username, password_hash, name, role)
            VALUES (?, ?, ?, ?, ?)
            """,
            (officer_id, username, generate_password_hash(password), name, role),
        )
        conn.execute(
            """
            INSERT INTO organisation_relationships
              (officer_id, manager_id, team_name, trained_schemes)
            VALUES (?, NULL, ?, ?)
            """,
            (officer_id, team_name.strip(), trained_schemes.strip()),
        )
        conn.execute(
            """
            INSERT INTO career_profiles
              (officer_id, current_role, target_role, responsibilities_json, target_responsibilities_json)
            VALUES (?, ?, ?, '[]', '[]')
            """,
            (officer_id, role, default_target_role(role)),
        )
    ensure_portal_defaults()            ## new officer = no manager


def remove_officer(officer_id: str) -> None:
    with connect() as conn:
        ## just to make sure not Admin
        role_row = conn.execute( "SELECT role FROM users WHERE id = ?", (officer_id,), ).fetchone()
        if not role_row:
            raise ValueError("Officer was not found.")
        if role_row["role"] == "Admin":
            raise ValueError("Admin accounts cannot be removed here.")

        ## to make sure no records in related tables
        for table in (
            "competency_evidence_scores",
            "audit_records",
            "scorecard_records",
            "ess_records",
            "interactions",
            "training_records",
            "training_recommendations",
            "project_records",
            "competency_overrides",
        ):
            conn.execute(f"DELETE FROM {table} WHERE officer_id = ?", (officer_id,))
        conn.execute("DELETE FROM organisation_relationships WHERE officer_id = ? OR manager_id = ?", (officer_id, officer_id),)
        conn.execute("DELETE FROM manager_profiles WHERE officer_id = ?", (officer_id,))
        conn.execute("DELETE FROM career_profiles WHERE officer_id = ?", (officer_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (officer_id,))


def role_has_leadership(role: str) -> bool:
    return has_default_leadership(role) or role in {"Manager (Leadership)", "Senior Manager (Leadership)"}


def role_has_projects_only(role: str) -> bool:
    return role in {"AH (CS6)", "AH (CS7)"}
