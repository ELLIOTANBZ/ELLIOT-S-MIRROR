from __future__ import annotations

ADMIN_ROLE = "Admin"

ROLE_OPTIONS = [
    "Executive",
    "CSE",
    "ACSM (TL)",
    "ACSM (CA)",
    "AM",
    "CSM (CS6)",
    "AH (CS6)",
    "Manager",
    "CSM (CS7)",
    "AH (CS7)",
    "Senior Manager",
]

MANAGER_LEADERSHIP_WEIGHT_ROLES = {
    "Manager": "Manager (Leadership)",
    "Senior Manager": "Senior Manager (Leadership)",
}

WEIGHT_ROLE_OPTIONS = []
for role in ROLE_OPTIONS:
    WEIGHT_ROLE_OPTIONS.append(role)
    if role in MANAGER_LEADERSHIP_WEIGHT_ROLES:
        WEIGHT_ROLE_OPTIONS.append(MANAGER_LEADERSHIP_WEIGHT_ROLES[role])

ALL_USER_ROLES = [*ROLE_OPTIONS, ADMIN_ROLE]

ROLE_TIER = {
    "Executive": 4,
    "CSE": 4,
    "ACSM (TL)": 5,
    "ACSM (CA)": 5,
    "AM": 5,
    "CSM (CS6)": 6,
    "AH (CS6)": 6,
    "Manager": 6,
    "CSM (CS7)": 7,
    "AH (CS7)": 7,
    "Senior Manager": 7,
    ADMIN_ROLE: 99,
}

TIER_RESPONSIBILITIES = {
    4: [
        "TODO: paste CS4 / CX4 responsibility 1 here",
        "TODO: paste CS4 / CX4 responsibility 2 here",
    ],
    5: [
        "TODO: paste CS5 / CX5 responsibility 1 here",
        "TODO: paste CS5 / CX5 responsibility 2 here",
    ],
    6: [
        "TODO: paste CS6 / CX6 responsibility 1 here",
        "TODO: paste CS6 / CX6 responsibility 2 here",
    ],
    7: [
        "TODO: paste CS7 / CX7 responsibility 1 here",
        "TODO: paste CS7 / CX7 responsibility 2 here",
    ],
}

ROLE_FAMILY = {
    "Executive": "cse",
    "CSE": "cse",
    "ACSM (TL)": "tl",
    "ACSM (CA)": "tl",
    "AM": "tl",
    "CSM (CS6)": "csm",
    "AH (CS6)": "ah",
    "Manager": "manager",
    "CSM (CS7)": "csm",
    "AH (CS7)": "ah",
    "Senior Manager": "manager",
    ADMIN_ROLE: "admin",
}

ROLE_ALIASES = {
    "cs4 executive": "Executive",
    "cs4 executives": "Executive",
    "executive": "Executive",
    "cse": "CSE",
    "cso": "CSE",
    "cx4 cse": "CSE",
    "tl": "ACSM (TL)",
    "team lead": "ACSM (TL)",
    "team leader": "ACSM (TL)",
    "acsm": "ACSM (TL)",
    "acsm (tl)": "ACSM (TL)",
    "cs5 acsm (tl)": "ACSM (TL)",
    "acsm (ca)": "ACSM (CA)",
    "cs5 acsm (ca)": "ACSM (CA)",
    "am": "AM",
    "cx5 am": "AM",
    "supervisor": "CSM (CS6)",
    "csm": "CSM (CS6)",
    "csm (cs6)": "CSM (CS6)",
    "cs6 csm": "CSM (CS6)",
    "ah": "AH (CS6)",
    "ah (cs6)": "AH (CS6)",
    "cs6 ah": "AH (CS6)",
    "manager": "Manager",
    "managers": "Manager",
    "cx6 manager": "Manager",
    "cx6 managers": "Manager",
    "csm (cs7)": "CSM (CS7)",
    "cs7 csm": "CSM (CS7)",
    "ah (cs7)": "AH (CS7)",
    "cs7 ah": "AH (CS7)",
    "senior manager": "Senior Manager",
    "senior managers": "Senior Manager",
    "cx7 senior manager": "Senior Manager",
    "cx7 senior managers": "Senior Manager",
    "admin": ADMIN_ROLE,
}

TEAM_ROLES = {
    role
    for role in ROLE_OPTIONS
    if ROLE_FAMILY[role] in {"tl", "csm", "ah", "manager"}
}
SUPERVISOR_ROLES = {
    role
    for role in ROLE_OPTIONS
    if ROLE_FAMILY[role] in {"csm", "ah", "manager"}
}
ALWAYS_LEADERSHIP_ROLES = {"AH (CS6)", "AH (CS7)"}
CUSTOM_MANAGER_ROLES = {"Manager", "Senior Manager"}


def clean_role_name(value: object) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text in ALL_USER_ROLES:
        return text
    return ROLE_ALIASES.get(text.lower())


def clean_weight_role_name(value: object) -> str | None:
    text = str(value or "").strip()
    if text in WEIGHT_ROLE_OPTIONS:
        return text
    return clean_role_name(text)


def role_sort_key(role: str) -> tuple[int, int, str]:
    role = clean_weight_role_name(role) or role
    try:
        index = [*WEIGHT_ROLE_OPTIONS, ADMIN_ROLE].index(role)
    except ValueError:
        index = len(WEIGHT_ROLE_OPTIONS) + 1
    return (0 if role == ADMIN_ROLE else 1, index, role)


def role_tier(role: str) -> int:
    return ROLE_TIER.get(clean_role_name(role) or role, 0)


def responsibilities_for_role(role: str) -> list[str]:
    return TIER_RESPONSIBILITIES.get(role_tier(role), [])


def role_family(role: str) -> str:
    return ROLE_FAMILY.get(clean_role_name(role) or role, "unknown")


def can_manage_role(officer_role: str, manager_role: str) -> bool:
    manager_role = clean_role_name(manager_role) or manager_role
    if manager_role == ADMIN_ROLE:
        return True
    return role_tier(manager_role) > role_tier(officer_role)


def default_target_role(role: str) -> str:
    role = clean_role_name(role) or role
    targets = {
        "Executive": "AM",
        "CSE": "ACSM",
        "ACSM (TL)": "AH (CS6)",
        "ACSM (CA)": "CSM (CS6)",
        "AM": "Manager",
        "CSM (CS6)": "CSM (CS7)",
        "AH (CS6)": "AH (CS7)",
        "Manager": "Senior Manager",
        "CSM (CS7)": "AH (CS7)",
        "AH (CS7)": "Senior Manager",
        "Senior Manager": "Senior Manager",
    }
    return targets.get(role, "Senior Manager")


def readiness_role_options() -> list[str]:
    return WEIGHT_ROLE_OPTIONS


def configuration_role(role: str, *, leads_team: bool = False) -> str:
    role = clean_role_name(role) or role
    if leads_team and role in MANAGER_LEADERSHIP_WEIGHT_ROLES:
        return MANAGER_LEADERSHIP_WEIGHT_ROLES[role]
    return role


def has_default_leadership(role: str) -> bool:
    return (clean_role_name(role) or role) in ALWAYS_LEADERSHIP_ROLES
