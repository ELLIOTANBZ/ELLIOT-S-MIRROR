## controls visibility/permissions using the organisation chart

from __future__ import annotations

import sqlite3
from typing import Any

from db import connect
from services.role_model import CUSTOM_MANAGER_ROLES, SUPERVISOR_ROLES, TEAM_ROLES


## Returns one user ID and the IDs of everyone below it in the org chart.
def descendant_user_ids(conn: sqlite3.Connection, user_id: str) -> set[str]:
    rows = conn.execute(
        """
        SELECT users.id, org.manager_id
        FROM users
        LEFT JOIN organisation_relationships org ON org.officer_id = users.id
        WHERE users.role != 'Admin'
        """
    ).fetchall()

    ## Example: {"supervisor1": ["tl1"], "tl1": ["CSE1", "CSE2"]}
    children_by_manager: dict[str, list[str]] = {}
    for row in rows:
        manager_id = row["manager_id"]
        officer_id = row["id"]

        if manager_id:
            children_by_manager.setdefault(manager_id, []).append(officer_id)

    visible_ids = {user_id}
    officers_to_check = list(children_by_manager.get(user_id, []))

    ## Check direct reports, then their reports, until nobody is left to check.
    while officers_to_check:
        officer_id = officers_to_check.pop()

        ## This also prevents an invalid circular hierarchy from looping forever.
        if officer_id in visible_ids:
            continue

        visible_ids.add(officer_id)
        direct_reports = children_by_manager.get(officer_id, [])
        officers_to_check.extend(direct_reports)

    return visible_ids


## None means "all users"; otherwise return the IDs this user may view.
def allowed_user_ids(user: dict[str, Any]) -> set[str] | None:
    if user["role"] == "Admin":
        return None

    with connect() as conn:
        return descendant_user_ids(conn, user["id"])


## Can requester view this specific target user?
def can_view_user(requester: dict[str, Any], target: dict[str, Any]) -> bool:
    allowed_ids = allowed_user_ids(requester)
    if allowed_ids is None:
        return True
    return target["id"] in allowed_ids


## Return full user dictionaries for everybody requester may view.
def visible_users(
    requester: dict[str, Any],
    users: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    allowed_ids = allowed_user_ids(requester)

    if allowed_ids is None:
        return [user for user in users if user["role"] != "Admin"]

    visible = []
    for user in users:
        if user["role"] != "Admin" and user["id"] in allowed_ids:
            visible.append(user)
    return visible


## Can this role open Team Overview?
def can_view_team(user: dict[str, Any]) -> bool:
    if user["role"] == "Admin":
        return True
    if user["role"] in CUSTOM_MANAGER_ROLES:
        with connect() as conn:
            row = conn.execute(
                "SELECT leads_team FROM manager_profiles WHERE officer_id = ?",
                (user["id"],),
            ).fetchone()
        return bool(row and row["leads_team"])
    return user["role"] in TEAM_ROLES
