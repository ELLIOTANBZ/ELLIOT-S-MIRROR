from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from werkzeug.security import generate_password_hash

from db import connect, dumps, init_db

USERS = [
    {"username": "admin", "password": "admin123", "name": "System Administrator", "role": "Admin"},
    {"username": "tl001", "password": "tl001pass", "name": "Sarah Tan Wei Lin", "role": "TL", "score": 89, "ess": 4.5},
    {"username": "tl002", "password": "tl002pass", "name": "Michael Lim Boon Kiat", "role": "TL", "score": 75, "ess": 3.7},
    {"username": "tl003", "password": "tl003pass", "name": "Wei Ling Chan", "role": "TL", "score": 63, "ess": 3.1},
    {"username": "tl004", "password": "tl004pass", "name": "Darren Goh Zhi Wei", "role": "TL", "score": 38, "ess": 1.9},
    {"username": "cso001", "password": "cso001pass", "name": "Aisha Binte Rahman", "role": "CSE", "score": 64, "ess": 3.2},
    {"username": "cso002", "password": "cso002pass", "name": "David Chen Jian Wei", "role": "CSE", "score": 31, "ess": 1.8},
    {"username": "cso003", "password": "cso003pass", "name": "Priya Nair", "role": "CSE", "score": 75, "ess": 3.8},
    {"username": "cso004", "password": "cso004pass", "name": "Lim Jun Hao", "role": "CSE", "score": 60, "ess": 3.0},
    {"username": "cso005", "password": "cso005pass", "name": "Siti Norzahra Binte Ali", "role": "CSE", "score": 59, "ess": 3.0},
    {"username": "cso006", "password": "cso006pass", "name": "Kevin Tan Wei Jie", "role": "CSE", "score": 44, "ess": 1.7},
    {"username": "cso007", "password": "cso007pass", "name": "Mei Ling Chua", "role": "CSE", "score": 60, "ess": 3.0},
    {"username": "cso008", "password": "cso008pass", "name": "Ravi Kumar s/o Selvam", "role": "CSE", "score": 60, "ess": 3.1},
    {"username": "cso009", "password": "cso009pass", "name": "Nurul Ain Binte Roslan", "role": "CSE", "score": 59, "ess": 3.0},
    {"username": "cso010", "password": "cso010pass", "name": "Bryan Chia Kah Wai", "role": "CSE", "score": 60, "ess": 3.0},
    {"username": "cso011", "password": "cso011pass", "name": "Jasmine Wong Shu Hui", "role": "CSE", "score": 60, "ess": 3.1},
    {"username": "cso012", "password": "cso012pass", "name": "Faizal Hakim Bin Yusof", "role": "CSE", "score": 39, "ess": 1.8},
    {"username": "cso013", "password": "cso013pass", "name": "Preethi Suresh", "role": "CSE", "score": 39, "ess": 1.9},
    {"username": "mgr001", "password": "mgr001pass", "name": "Raymond Wong Chee Keong", "role": "Supervisor", "score": 95, "ess": 4.8},
    {"username": "mgr002", "password": "mgr002pass", "name": "Nisha Krishnamurthy", "role": "Supervisor", "score": 63, "ess": 3.2},
    {"username": "mgr003", "password": "mgr003pass", "name": "Lena Chong Pei Shan", "role": "Supervisor", "score": 74, "ess": 3.7},
    {"username": "mgr004", "password": "mgr004pass", "name": "Arjun Menon s/o Rajan", "role": "Supervisor", "score": 27, "ess": 1.6},
    {"username": "ad001", "password": "ad001pass", "name": "James Ong Teck Huat", "role": "Supervisor", "score": 94, "ess": 4.6},
]

INDICATOR_FIELDS = [
    "Courtesy",
    "Confidentiality",
    "Comprehend Intent",
    "Email SOG Compliance",
    "Correct Information",
    "Complete Information",
    "Clear and Easy",
    "Meaningful Conversations",
    "Cultivate Digital Awareness",
    "Verified Mistake",
]


def add_days(date_str: str, n: int) -> str:
    from datetime import date, timedelta

    return (date.fromisoformat(date_str) + timedelta(days=n)).isoformat()


def pass_fail(score: float, index: int, day_index: int) -> str:
    adjusted = score + ((day_index % 5) - 2) * 2 - (index % 3)
    return "Pass" if adjusted >= 60 else "Fail"


def main() -> None:
    init_db()
    with connect() as conn:
        for user in USERS:
            user_id = user["username"]
            conn.execute(
                """
                INSERT INTO users (id, username, password_hash, name, role)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(username) DO UPDATE SET
                  password_hash = excluded.password_hash,
                  name = excluded.name,
                  role = excluded.role,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    user_id,
                    user["username"],
                    generate_password_hash(user["password"]),
                    user["name"],
                    user["role"],
                ),
            )
            if user["role"] == "Admin":
                continue
            conn.execute("DELETE FROM audit_records WHERE officer_id = ?", (user_id,))
            conn.execute("DELETE FROM ess_records WHERE officer_id = ?", (user_id,))
            conn.execute("DELETE FROM interactions WHERE officer_id = ?", (user_id,))
            start = "2026-03-01"
            for i in range(0, 60, 3):
                upload_date = add_days(start, i)
                trend = i * 0.12 if user["score"] >= 60 else i * -0.03
                score = max(20, min(98, user["score"] - 5 + trend))
                rating = max(1, min(5, round((user["ess"] + ((i % 9) - 3) * 0.05) * 10) / 10))
                payload = {
                    field: pass_fail(score, idx, i)
                    for idx, field in enumerate(INDICATOR_FIELDS)
                }
                conn.execute(
                    """
                    INSERT INTO audit_records (officer_id, upload_date, total_score, payload_json)
                    VALUES (?, ?, ?, ?)
                    """,
                    (user_id, upload_date, round(score), dumps(payload)),
                )
                conn.execute(
                    """
                    INSERT INTO ess_records (officer_id, upload_date, rating, feedback, payload_json)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        upload_date,
                        rating,
                        "Helpful, clear, and reassuring service." if rating >= 4 else "Service was acceptable but could be clearer.",
                        dumps({}),
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO interactions (officer_id, upload_date, case_id, member_query, officer_response, payload_json)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        upload_date,
                        f"{user['username']}-{upload_date}",
                        "Member asked for CPF account guidance and next steps.",
                        f"{user['name']} addressed the member query with acceptable clarity.",
                        dumps({}),
                    ),
                )
    print("Seed complete.")
    print("Demo login: admin / admin123")


if __name__ == "__main__":
    main()
