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
from services.access_control import SUPERVISOR_ROLES


DEFAULT_WEIGHTS = {
    "core_weight": 0.34,
    "functional_weight": 0.33,
    "correspondence_weight": 0.33,
}

DEFAULT_THRESHOLDS = [
    ("Meeting Expectations", "core", "Core competency score", 65, "score", 1),
    ("Meeting Expectations", "functional", "Functional competency score", 60, "score", 2),
    ("Meeting Expectations", "correspondence", "Correspondence competency score", 60, "score", 3),
    ("Stretch Assignment Ready", "core", "Core competency score", 80, "score", 1),
    ("Stretch Assignment Ready", "functional", "Functional competency score", 70, "score", 2),
    ("Stretch Assignment Ready", "correspondence", "Correspondence competency score", 70, "score", 3),
    ("Career Advancement Ready", "core", "Core competency score", 80, "score", 1),
    ("Career Advancement Ready", "functional", "Functional competency score", 75, "score", 2),
    ("Career Advancement Ready", "correspondence", "Correspondence competency score", 75, "score", 3),
]

## HELPER
## Make sure every database row required by the portal exists before other functions try to use it. (it only updates SQLite)
## 1. apply initial weights once, 2. ensure thresholds exist, 3. ensure every user has a career profile + org relationship row
def ensure_portal_defaults() -> None:
    with connect() as conn:
        roles = ("CSE", "TL", "CSM", "AH")
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
                if role == "AH":
                    values = (role, competency_name, 0.0, 0.0, 0.0, 1.0)
                else:
                    values = (
                        role,
                        competency_name,
                        COMPETENCY_SOURCE_WEIGHT_DEFAULTS["audit_weight"],
                        COMPETENCY_SOURCE_WEIGHT_DEFAULTS["scorecard_weight"],
                        COMPETENCY_SOURCE_WEIGHT_DEFAULTS["interaction_weight"],
                        COMPETENCY_SOURCE_WEIGHT_DEFAULTS["project_weight"],
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
            SELECT role, competency_name, audit_weight, scorecard_weight, interaction_weight
            FROM competency_source_weights
            WHERE role != 'AH'
            """
        ).fetchall()
        for row in source_weight_rows:
            active_total = row["audit_weight"] + row["scorecard_weight"] + row["interaction_weight"]
            if active_total <= 0:
                conn.execute(
                    """
                    UPDATE competency_source_weights
                    SET audit_weight = ?, scorecard_weight = ?, interaction_weight = ?
                    WHERE role = ? AND competency_name = ?
                    """,
                    (
                        COMPETENCY_SOURCE_WEIGHT_DEFAULTS["audit_weight"],
                        COMPETENCY_SOURCE_WEIGHT_DEFAULTS["scorecard_weight"],
                        COMPETENCY_SOURCE_WEIGHT_DEFAULTS["interaction_weight"],
                        row["role"],
                        row["competency_name"],
                    ),
                )
            elif abs(active_total - 1) > 0.001:
                conn.execute(
                    """
                    UPDATE competency_source_weights
                    SET audit_weight = ?, scorecard_weight = ?, interaction_weight = ?
                    WHERE role = ? AND competency_name = ?
                    """,
                    (
                        row["audit_weight"] / active_total,
                        row["scorecard_weight"] / active_total,
                        row["interaction_weight"] / active_total,
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
            "SELECT value FROM sync_meta WHERE key = 'source_weights_project_bonus_defaults'"
        ).fetchone()
        if not source_bonus_migration:
            conn.execute(
                """
                UPDATE competency_source_weights
                SET audit_weight = CASE WHEN role = 'AH' THEN 0.0 ELSE ? END,
                    scorecard_weight = CASE WHEN role = 'AH' THEN 0.0 ELSE ? END,
                    interaction_weight = CASE WHEN role = 'AH' THEN 0.0 ELSE ? END,
                    project_weight = CASE WHEN role = 'AH' THEN 1.0 ELSE ? END
                """,
                (
                    COMPETENCY_SOURCE_WEIGHT_DEFAULTS["audit_weight"],
                    COMPETENCY_SOURCE_WEIGHT_DEFAULTS["scorecard_weight"],
                    COMPETENCY_SOURCE_WEIGHT_DEFAULTS["interaction_weight"],
                    COMPETENCY_SOURCE_WEIGHT_DEFAULTS["project_weight"],
                ),
            )
            conn.execute(
                """
                INSERT INTO sync_meta (key, value)
                VALUES ('source_weights_project_bonus_defaults', 'applied')
                """
            )

        rows = conn.execute(
            "SELECT role, core_weight, functional_weight, correspondence_weight FROM readiness_settings"
        ).fetchall()
        for row in rows:
            total = row["core_weight"] + row["functional_weight"] + row["correspondence_weight"]
            if total <= 0:
                values = (
                    DEFAULT_WEIGHTS["core_weight"],
                    DEFAULT_WEIGHTS["functional_weight"],
                    DEFAULT_WEIGHTS["correspondence_weight"],
                    row["role"],
                )
            elif abs(total - 1) > 0.001:
                values = (
                    row["core_weight"] / total,
                    row["functional_weight"] / total,
                    row["correspondence_weight"] / total,
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
                    updated_at = CURRENT_TIMESTAMP
                WHERE role = ?
                """,
                values,
            )

        ## 2. ensure thresholds exist
        conn.execute(
            "DELETE FROM readiness_thresholds WHERE metric IN ('readiness', 'performance', 'projects', 'experience', 'development', 'application')"
        )
        for threshold in DEFAULT_THRESHOLDS:
            conn.execute(
                """
                INSERT OR IGNORE INTO readiness_thresholds
                  (stage, metric, display_name, minimum_value, unit, sequence)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                threshold,
            )
            if threshold[1] == "experience":
                conn.execute(
                    """
                    UPDATE readiness_thresholds
                    SET minimum_value = ?, unit = ?
                    WHERE stage = ? AND metric = ? AND unit = 'percent'
                    """,
                    (threshold[3], threshold[4], threshold[0], threshold[1]),
                )
            conn.execute(
                """
                UPDATE readiness_thresholds
                SET display_name = ?, unit = ?, sequence = ?
                WHERE stage = ? AND metric = ?
                """,
                (threshold[2], threshold[4], threshold[5], threshold[0], threshold[1]),
            )

        ## 3. ensure every user has a career profile + org relationship row
        users = conn.execute(
            "SELECT id, role FROM users WHERE role != 'Admin'"
        ).fetchall()
        for user in users:
            if user["role"] == "CSE":
                target_role = "TL"
            elif user["role"] == "TL":
                target_role = "CSM"
            elif user["role"] in SUPERVISOR_ROLES:
                target_role = "Senior CSM/AH"
            else:
                target_role = "Senior CSM/AH"
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
                INSERT OR IGNORE INTO organisation_relationships
                  (officer_id, manager_id, team_name)
                VALUES (?, NULL, '')
                """,
                (user["id"],),
            )

