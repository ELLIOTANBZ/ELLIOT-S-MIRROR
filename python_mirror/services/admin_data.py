## builds the admin pages data
from __future__ import annotations

from collections import defaultdict
from typing import Any

from werkzeug.security import generate_password_hash

from db import connect, new_id

from services.competency_scoring import (
    CORE_COMPETENCIES,
    CORRESPONDENCE_COMPETENCIES,
    FUNCTIONAL_COMPETENCIES,
)

from services.portal_defaults import ensure_portal_defaults
from services.access_control import SUPERVISOR_ROLES

EDITABLE_ROLES = {"CSE", "TL", *SUPERVISOR_ROLES}
SUPERVISOR_OR_ADMIN = {*SUPERVISOR_ROLES, "Admin"}

## builds the Admin page data
def admin_portal_data() -> dict[str, Any]:
    ensure_portal_defaults()
    with connect() as conn:
        settings = [
            dict(row)
            for row in conn.execute(
                """
                SELECT * FROM readiness_settings
                ORDER BY CASE role
                  WHEN 'CSE' THEN 1
                  WHEN 'TL' THEN 2
                  WHEN 'CSM' THEN 3
                  WHEN 'AH' THEN 3
                  ELSE 4 END
                """
            ).fetchall()
        ]
        users = [
            dict(row)
            for row in conn.execute(
                """
                SELECT users.id, users.username, users.name, users.role,
                       org.manager_id, org.team_name, org.trained_schemes
                FROM users
                LEFT JOIN organisation_relationships org
                  ON org.officer_id = users.id
                ORDER BY CASE users.role
                  WHEN 'Admin' THEN 1
                  WHEN 'CSM' THEN 2
                  WHEN 'AH' THEN 2
                  WHEN 'TL' THEN 3
                  WHEN 'CSE' THEN 4
                  ELSE 5 END,
                  users.name
                """
            ).fetchall()
        ]
        thresholds = [
            dict(row)
            for row in conn.execute(
                """
                SELECT * FROM readiness_thresholds
                ORDER BY CASE stage
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
                ORDER BY competency_name
                """
            ).fetchall()
        ]
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
    source_weights_by_name = {
        row["competency_name"]: row
        for row in source_weights
    }

    return {
        "settings": settings,
        "thresholds": thresholds,
        "source_weight_groups": {
            "Core": [
                source_weights_by_name[name]
                for name in CORE_COMPETENCIES
                if name in source_weights_by_name
            ],
            "Functional": [
                source_weights_by_name[name]
                for name in FUNCTIONAL_COMPETENCIES
                if name in source_weights_by_name
            ],
            "Correspondence": [
                source_weights_by_name[name]
                for name in CORRESPONDENCE_COMPETENCIES
                if name in source_weights_by_name
            ],
        },
        "users": users,
        "manager_options_by_user": manager_options_by_user,
        "organisation_tree": roots,
        "unassigned_users": unassigned_users,
    }


## Weights & Thresholds: Save the Admin-edited readiness weights for one role.
## values: submitted admin form dict (eg. { "role": "CSE", "core_weight": "0.25", "functional_weight": "0.15", ... })
def save_readiness_settings(values: dict[str, Any]) -> None:
    role = str(values["role"])
    numeric_fields = [
        "core_weight",
        "functional_weight",
        "correspondence_weight",
        "performance_weight",
        "tenure_weight",
        "development_weight",
    ]
    numbers = {}
    for field in numeric_fields:
        numbers[field] = float(values[field])           ## converting str to float { "core_weight": 0.25, "functional_weight": 0.15, ... }
    total_weight = sum(numbers.values())

    if abs(total_weight - 1) > 0.001:                   ## total_weight = 0.999999999 is accepted
        raise ValueError("All six readiness weights must add up to 1.00.")
    with connect() as conn:
        conn.execute(
            """
            UPDATE readiness_settings
            SET core_weight = ?,
                functional_weight = ?,
                correspondence_weight = ?,
                performance_weight = ?,
                tenure_weight = ?,
                development_weight = ?,
                application_weight = 0,
                updated_at = CURRENT_TIMESTAMP
            WHERE role = ?
            """,
            (
                numbers["core_weight"],
                numbers["functional_weight"],
                numbers["correspondence_weight"],
                numbers["performance_weight"],
                numbers["tenure_weight"],
                numbers["development_weight"],
                role,
            ),
        )


## Weights & Thresholds: Save one threshold row after Admin edits it.
def save_readiness_threshold( stage: str, metric: str, minimum_value: float, ) -> None:
    with connect() as conn:
        conn.execute(
            """
            UPDATE readiness_thresholds
            SET minimum_value = ?
            WHERE stage = ? AND metric = ?
            """,
            (minimum_value, stage, metric),
        )       ## readiness_threshold: PRIMARY KEY(stage, metric)


def save_competency_source_weight(values: dict[str, Any]) -> None:
    competency_name = str(values["competency_name"])
    audit_weight = float(values["audit_weight"])
    scorecard_weight = float(values["scorecard_weight"])
    interaction_weight = float(values["interaction_weight"])
    project_weight = float(values["project_weight"])
    total_weight = audit_weight + scorecard_weight + interaction_weight + project_weight

    if abs(total_weight - 1) > 0.001:
        raise ValueError("Audit, scorecard, interaction, and project weights must add up to 1.00.")

    with connect() as conn:
        conn.execute(
            """
            UPDATE competency_source_weights
            SET audit_weight = ?,
                scorecard_weight = ?,
                interaction_weight = ?,
                project_weight = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE competency_name = ?
            """,
            (audit_weight, scorecard_weight, interaction_weight, project_weight, competency_name),
        )


def manager_options_for(officer: dict[str, Any], users: list[dict[str, Any]]) -> list[dict[str, Any]]:
    allowed_roles = {
        "CSE": {"TL", *SUPERVISOR_OR_ADMIN},
        "TL": SUPERVISOR_OR_ADMIN,
        "CSM": {"Admin"},
        "AH": {"Admin"},
    }.get(officer["role"], set())
    return [
        user
        for user in users
        if user["id"] != officer["id"] and user["role"] in allowed_roles
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
    if role not in EDITABLE_ROLES:
        raise ValueError("Officer role must be CSE, TL, CSM, or AH.")
    return role


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
                conn.execute(
                    """
                    UPDATE career_profiles
                    SET current_role = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE officer_id = ?
                    """,
                    (users_by_id[officer_id]["role"], officer_id),
                )
            conn.execute(
                """
                INSERT INTO organisation_relationships
                  (officer_id, manager_id, team_name, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(officer_id) DO UPDATE SET
                  manager_id = excluded.manager_id,
                  team_name = excluded.team_name,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    officer_id,
                    assignment.get("manager_id") or None,
                    assignment.get("team_name", "").strip(),
                ),
            )
        conn.commit()


def add_officer(username: str, name: str, role: str, password: str, team_name: str = "", trained_schemes: str = "") -> None:
    username = username.strip().lower()
    name = name.strip()
    if not username or not name or not password:
        raise ValueError("Username, name, and temporary password are required.")
    if role not in EDITABLE_ROLES:
        raise ValueError("Officer role must be CSE, TL, CSM, or AH.")
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
        related_tables = [
            "audit_records",
            "scorecard_records",
            "ess_records",
            "interactions",
            "training_records",
        ]
        has_data = any(
            conn.execute( f"SELECT 1 FROM {table} WHERE officer_id = ? LIMIT 1", (officer_id,),).fetchone() for table in related_tables
        )
        if has_data:
            raise ValueError( "This officer has saved records and cannot be removed. Move them instead.")

        conn.execute("DELETE FROM organisation_relationships WHERE officer_id = ? OR manager_id = ?", (officer_id, officer_id),)
        conn.execute("DELETE FROM career_profiles WHERE officer_id = ?", (officer_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (officer_id,))
