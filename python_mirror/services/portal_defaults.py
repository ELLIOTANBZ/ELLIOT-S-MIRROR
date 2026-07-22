from __future__ import annotations
import json
from db import connect


from services.competency_scoring import (
    COMPETENCY_SOURCE_WEIGHT_DEFAULTS,
    CORE_COMPETENCIES,
    CORRESPONDENCE_COMPETENCIES,
    FUNCTIONAL_COMPETENCIES,
    LEADERSHIP_COMPETENCIES,
)
from services.role_model import (
    ROLE_OPTIONS,
    WEIGHT_ROLE_OPTIONS,
    default_target_role,
    role_family,
)


DEFAULT_WEIGHTS = {
    "core_weight": 0.25,
    "functional_weight": 0.25,
    "correspondence_weight": 0.25,
    "leadership_weight": 0.25,
}

THRESHOLD_TIERS = {
    "c?4": (65, 60, 60, 0, 80, 70, 70, 0, 80, 75, 75, 0),
    "c?5": (82, 78, 78, 0, 86, 82, 82, 0, 88, 84, 84, 0),
    "c?6": (88, 84, 84, 80, 91, 88, 88, 85, 93, 90, 90, 88),
    "c?7": (93, 90, 90, 85, 96, 93, 93, 90, 98, 95, 95, 93),
}


def default_thresholds() -> list[tuple[str, str, str, str, float, str, int]]:
    rows = []
    for tier, values in THRESHOLD_TIERS.items():
        rows.extend(
            [
                (tier, "Meeting Expectations", "core", "Core competency score", values[0], "score", 1),
                (tier, "Meeting Expectations", "functional", "Functional competency score", values[1], "score", 2),
                (tier, "Meeting Expectations", "correspondence", "Correspondence competency score", values[2], "score", 3),
                (tier, "Meeting Expectations", "leadership", "Leadership competency score", values[3], "score", 4),
                (tier, "Stretch Assignment Ready", "core", "Core competency score", values[4], "score", 1),
                (tier, "Stretch Assignment Ready", "functional", "Functional competency score", values[5], "score", 2),
                (tier, "Stretch Assignment Ready", "correspondence", "Correspondence competency score", values[6], "score", 3),
                (tier, "Stretch Assignment Ready", "leadership", "Leadership competency score", values[7], "score", 4),
                (tier, "Career Advancement Ready", "core", "Core competency score", values[8], "score", 1),
                (tier, "Career Advancement Ready", "functional", "Functional competency score", values[9], "score", 2),
                (tier, "Career Advancement Ready", "correspondence", "Correspondence competency score", values[10], "score", 3),
                (tier, "Career Advancement Ready", "leadership", "Leadership competency score", values[11], "score", 4),
            ]
        )
    return rows

## HELPER
## Make sure every database row required by the portal exists before other functions try to use it. (it only updates SQLite)
## 1. apply initial weights once, 2. ensure thresholds exist, 3. ensure every user has a career profile + org relationship row
def ensure_portal_defaults() -> None:
    with connect() as conn:
        roles = tuple(WEIGHT_ROLE_OPTIONS)
        competency_names = [
            *CORE_COMPETENCIES,
            *FUNCTIONAL_COMPETENCIES,
            *CORRESPONDENCE_COMPETENCIES,
            *LEADERSHIP_COMPETENCIES,
        ]

        ## 1. apply initial weights once
        for role in roles:
            conn.execute(
                "INSERT OR IGNORE INTO readiness_settings (role) VALUES (?)",
                (role,),
            )
        for role in roles:
            for competency_name in competency_names:
                if role_family(role) == "ah":
                    values = (role, competency_name, 0.0, 0.0, 0.0, 1.0)
                elif role in {"Executive", "CSE"}:
                    values = (
                        role,
                        competency_name,
                        COMPETENCY_SOURCE_WEIGHT_DEFAULTS["audit_weight"],
                        COMPETENCY_SOURCE_WEIGHT_DEFAULTS["scorecard_weight"],
                        COMPETENCY_SOURCE_WEIGHT_DEFAULTS["interaction_weight"],
                        COMPETENCY_SOURCE_WEIGHT_DEFAULTS["project_weight"],
                    )
                else:
                    values = (
                        role,
                        competency_name,
                        0.25,
                        0.25,
                        0.25,
                        0.25,
                    )
                conn.execute(
                    """
                    INSERT OR IGNORE INTO competency_source_weights
                      (role, competency_name, audit_weight, scorecard_weight, interaction_weight, project_weight)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    values,
                )
        source_weight_rows = conn.execute(
            """
            SELECT role, competency_name, audit_weight, scorecard_weight, interaction_weight, project_weight
            FROM competency_source_weights
            WHERE role NOT IN ('AH (CS6)', 'AH (CS7)')
            """
        ).fetchall()
        for row in source_weight_rows:
            is_bonus_role = row["role"] in {"Executive", "CSE"}
            active_total = (
                row["audit_weight"] + row["scorecard_weight"] + row["interaction_weight"]
                if is_bonus_role
                else row["audit_weight"] + row["scorecard_weight"] + row["interaction_weight"] + row["project_weight"]
            )
            if active_total <= 0:
                conn.execute(
                    """
                    UPDATE competency_source_weights
                    SET audit_weight = ?, scorecard_weight = ?, interaction_weight = ?, project_weight = ?
                    WHERE role = ? AND competency_name = ?
                    """,
                    (
                        COMPETENCY_SOURCE_WEIGHT_DEFAULTS["audit_weight"] if is_bonus_role else 0.25,
                        COMPETENCY_SOURCE_WEIGHT_DEFAULTS["scorecard_weight"] if is_bonus_role else 0.25,
                        COMPETENCY_SOURCE_WEIGHT_DEFAULTS["interaction_weight"] if is_bonus_role else 0.25,
                        COMPETENCY_SOURCE_WEIGHT_DEFAULTS["project_weight"] if is_bonus_role else 0.25,
                        row["role"],
                        row["competency_name"],
                    ),
                )
            elif abs(active_total - 1) > 0.001:
                project_weight = (
                    row["project_weight"]
                    if is_bonus_role
                    else row["project_weight"] / active_total
                )
                conn.execute(
                    """
                    UPDATE competency_source_weights
                    SET audit_weight = ?, scorecard_weight = ?, interaction_weight = ?, project_weight = ?
                    WHERE role = ? AND competency_name = ?
                    """,
                    (
                        row["audit_weight"] / active_total,
                        row["scorecard_weight"] / active_total,
                        row["interaction_weight"] / active_total,
                        project_weight,
                        row["role"],
                        row["competency_name"],
                    ),
                )

        ## searches sync_meta for a marker (migration) saying the defaults were already applied
        migration = conn.execute(
            "SELECT value FROM sync_meta WHERE key = 'readiness_defaults'"
        ).fetchone()

        ## if that marker not found
        if not migration:
            for field, value in DEFAULT_WEIGHTS.items():
                conn.execute(
                    f"UPDATE readiness_settings SET {field} = ?",
                    (value,),
                )
            conn.execute(
                """
                INSERT INTO sync_meta (key, value)
                VALUES ('readiness_defaults', 'applied')
                """
            )

        source_bonus_migration = conn.execute(
            "SELECT value FROM sync_meta WHERE key = 'source_weights_role_model_defaults_v1'"
        ).fetchone()
        if not source_bonus_migration:
            conn.execute(
                """
                UPDATE competency_source_weights
                SET audit_weight = CASE
                        WHEN role IN ('AH (CS6)', 'AH (CS7)') THEN 0.0
                        WHEN role IN ('Executive', 'CSE') THEN 0.34
                        ELSE 0.25 END,
                    scorecard_weight = CASE
                        WHEN role IN ('AH (CS6)', 'AH (CS7)') THEN 0.0
                        WHEN role IN ('Executive', 'CSE') THEN 0.33
                        ELSE 0.25 END,
                    interaction_weight = CASE
                        WHEN role IN ('AH (CS6)', 'AH (CS7)') THEN 0.0
                        WHEN role IN ('Executive', 'CSE') THEN 0.33
                        ELSE 0.25 END,
                    project_weight = CASE
                        WHEN role IN ('AH (CS6)', 'AH (CS7)') THEN 1.0
                        WHEN role IN ('Executive', 'CSE') THEN 0.10
                        ELSE 0.25 END
                """
            )
            conn.execute(
                """
                INSERT INTO sync_meta (key, value)
                VALUES ('source_weights_role_model_defaults_v1', 'applied')
                """
            )

        rows = conn.execute(
            "SELECT role, core_weight, functional_weight, correspondence_weight, leadership_weight FROM readiness_settings"
        ).fetchall()
        for row in rows:
            total = row["core_weight"] + row["functional_weight"] + row["correspondence_weight"] + row["leadership_weight"]
            if total <= 0:
                values = (
                    DEFAULT_WEIGHTS["core_weight"],
                    DEFAULT_WEIGHTS["functional_weight"],
                    DEFAULT_WEIGHTS["correspondence_weight"],
                    DEFAULT_WEIGHTS["leadership_weight"],
                    row["role"],
                )
            elif abs(total - 1) > 0.001:
                values = (
                    row["core_weight"] / total,
                    row["functional_weight"] / total,
                    row["correspondence_weight"] / total,
                    row["leadership_weight"] / total,
                    row["role"],
                )
            else:
                continue
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
                values,
            )

        ## 2. ensure thresholds exist
        conn.execute(
            "DELETE FROM readiness_thresholds WHERE metric IN ('readiness', 'performance', 'projects', 'experience', 'development', 'application')"
        )
        for threshold in default_thresholds():
            conn.execute(
                """
                INSERT OR IGNORE INTO readiness_thresholds
                  (tier, stage, metric, display_name, minimum_value, unit, sequence)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                threshold,
            )
            conn.execute(
                """
                UPDATE readiness_thresholds
                SET display_name = ?, unit = ?, sequence = ?
                WHERE tier = ? AND stage = ? AND metric = ?
                """,
                (threshold[3], threshold[5], threshold[6], threshold[0], threshold[1], threshold[2]),
            )

        ## 3. ensure every user has a career profile + org relationship row
        users = conn.execute(
            "SELECT id, role FROM users WHERE role != 'Admin'"
        ).fetchall()
        for user in users:
            target_role = default_target_role(user["role"])
            conn.execute(
                """
                INSERT OR IGNORE INTO career_profiles
                  (officer_id, current_role, target_role, responsibilities_json,
                   target_responsibilities_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    user["id"],
                    user["role"],
                    target_role,
                    json.dumps(["Deliver quality service", "Meet role expectations"]),
                    json.dumps(["Demonstrate next-role capability", "Sustain strong performance"]),
                ),
            )
            conn.execute(
                """
                UPDATE career_profiles
                SET current_role = ?,
                    target_role = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE officer_id = ?
                """,
                (user["role"], target_role, user["id"]),
            )
            conn.execute(
                """
                INSERT OR IGNORE INTO organisation_relationships
                  (officer_id, manager_id, team_name)
                VALUES (?, NULL, '')
                """,
                (user["id"],),
            )

