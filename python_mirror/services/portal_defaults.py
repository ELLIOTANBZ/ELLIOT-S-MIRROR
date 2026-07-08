from __future__ import annotations
import json
from db import connect


from services.competency_scoring import (
    COMPETENCY_SOURCE_WEIGHT_DEFAULTS,
    CORE_COMPETENCIES,
    CORRESPONDENCE_COMPETENCIES,
    FUNCTIONAL_COMPETENCIES,
)
from services.access_control import SUPERVISOR_ROLES


DEFAULT_WEIGHTS = {
    "core_weight": 0.25,
    "functional_weight": 0.15,
    "correspondence_weight": 0.15,
    "performance_weight": 0.15,
    "tenure_weight": 0.10,
    "development_weight": 0.20,
    "application_weight": 0.00,
}

DEFAULT_THRESHOLDS = [
    ("Meeting Expectations", "core", "Core competency score", 65, "score", 1),
    ("Meeting Expectations", "functional", "Functional competency score", 60, "score", 2),
    ("Meeting Expectations", "correspondence", "Correspondence competency score", 60, "score", 3),
    ("Meeting Expectations", "performance", "Performance banding", 60, "score", 4),
    ("Meeting Expectations", "projects", "Projects", 60, "score", 5),
    ("Meeting Expectations", "experience", "Expected tenure completed", 1, "years", 6),
    ("Stretch Assignment Ready", "core", "Core competency score", 80, "score", 1),
    ("Stretch Assignment Ready", "functional", "Functional competency score", 70, "score", 2),
    ("Stretch Assignment Ready", "correspondence", "Correspondence competency score", 70, "score", 3),
    ("Stretch Assignment Ready", "performance", "Performance banding", 70, "score", 4),
    ("Stretch Assignment Ready", "projects", "Projects", 65, "score", 5),
    ("Stretch Assignment Ready", "experience", "Expected tenure completed", 1.5, "years", 6),
    ("Career Advancement Ready", "readiness", "Overall readiness score", 85, "score", 1),
    ("Career Advancement Ready", "core", "Core competency score", 80, "score", 2),
    ("Career Advancement Ready", "functional", "Functional competency score", 75, "score", 3),
    ("Career Advancement Ready", "correspondence", "Correspondence competency score", 75, "score", 4),
    ("Career Advancement Ready", "performance", "Performance banding", 80, "score", 5),
    ("Career Advancement Ready", "projects", "Projects", 70, "score", 6),
    ("Career Advancement Ready", "experience", "Expected tenure completed", 2, "years", 7),
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
        ]

        ## 1. apply initial weights once
        for role in roles:
            conn.execute(
                "INSERT OR IGNORE INTO readiness_settings (role) VALUES (?)",
                (role,),
            )
        for competency_name in competency_names:
            conn.execute(
                """
                INSERT OR IGNORE INTO competency_source_weights
                  (competency_name, audit_weight, scorecard_weight, interaction_weight, project_weight)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    competency_name,
                    COMPETENCY_SOURCE_WEIGHT_DEFAULTS["audit_weight"],
                    COMPETENCY_SOURCE_WEIGHT_DEFAULTS["scorecard_weight"],
                    COMPETENCY_SOURCE_WEIGHT_DEFAULTS["interaction_weight"],
                    COMPETENCY_SOURCE_WEIGHT_DEFAULTS["project_weight"],
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

        conn.execute(
            """
            UPDATE readiness_settings
            SET development_weight = development_weight + application_weight,
                application_weight = 0
            WHERE application_weight != 0
            """
        )

        ## 2. ensure thresholds exist
        conn.execute(
            "DELETE FROM readiness_thresholds WHERE metric IN ('development', 'application')"
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

