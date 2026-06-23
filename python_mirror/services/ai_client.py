from __future__ import annotations

import json
import os
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()


def ai_provider() -> str:
    return os.getenv("AI_PROVIDER", "local").strip().lower()


def ai_is_configured() -> bool:
    provider = ai_provider()
    if provider == "azure_openai":
        return all(
            os.getenv(name, "").strip()
            for name in (
                "AZURE_OPENAI_ENDPOINT",
                "AZURE_OPENAI_API_KEY",
                "AZURE_OPENAI_DEPLOYMENT",
            )
        )
    if provider == "openai":
        return bool(
            os.getenv("OPENAI_API_KEY", "").strip()
            and os.getenv("OPENAI_MODEL", "").strip()
        )
    if provider == "claude":
        return bool(
            os.getenv("ANTHROPIC_API_KEY", "").strip()
            and os.getenv("ANTHROPIC_MODEL", "").strip()
        )
    return False


def chat(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    provider = ai_provider()
    if provider == "azure_openai":
        return azure_openai_chat(system_prompt, user_prompt)
    if provider == "openai":
        return openai_chat(system_prompt, user_prompt)
    if provider == "claude":
        return claude_chat(system_prompt, user_prompt)
    raise RuntimeError(f"Unsupported AI_PROVIDER: {provider}")


def parse_json_response(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    return json.loads(cleaned)


def azure_openai_chat(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").rstrip("/")
    key = os.getenv("AZURE_OPENAI_API_KEY", "")
    deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT", "")
    version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21")
    if not endpoint or not key or not deployment:
        raise RuntimeError("Azure OpenAI is selected but endpoint/key/deployment is missing in .env.")
    url = f"{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={version}"
    response = requests.post(
        url,
        headers={"api-key": key, "Content-Type": "application/json"},
        json={
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        },
        timeout=120,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Azure OpenAI error {response.status_code}: {response.text}")
    content = response.json()["choices"][0]["message"]["content"]
    return parse_json_response(content)


def openai_chat(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    key = os.getenv("OPENAI_API_KEY", "")
    model = os.getenv("OPENAI_MODEL", "")
    if not key or not model:
        raise RuntimeError("OpenAI is selected but key/model is missing in .env.")
    response = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        },
        timeout=120,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"OpenAI error {response.status_code}: {response.text}")
    content = response.json()["choices"][0]["message"]["content"]
    return parse_json_response(content)


def claude_chat(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    key = os.getenv("ANTHROPIC_API_KEY", "")
    model = os.getenv("ANTHROPIC_MODEL", "")
    if not key or not model:
        raise RuntimeError("Claude is selected but key/model is missing in .env.")
    response = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": 2000,
            "temperature": 0.2,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_prompt}],
        },
        timeout=120,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Claude error {response.status_code}: {response.text}")
    blocks = response.json().get("content", [])
    text = "\n".join(block.get("text", "") for block in blocks if block.get("type") == "text")
    return parse_json_response(text)
