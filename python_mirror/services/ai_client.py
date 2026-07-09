from __future__ import annotations

import json
import logging
import os
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


def ai_provider() -> str:
    return os.getenv("AI_PROVIDER", "local").strip().lower()


def ai_is_configured() -> bool:
    provider = ai_provider()
    if provider == "azure_openai":
        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip() or os.getenv("AZURE_ENDPOINT", "").strip()
        key = os.getenv("AZURE_OPENAI_API_KEY", "").strip() or os.getenv("OPENAI_API_KEY", "").strip()
        deployment = (
            os.getenv("AZURE_OPENAI_DEPLOYMENT", "").strip()
            or os.getenv("OPENAI_DEFAULT_MODEL", "").strip()
            or os.getenv("OPENAI_MODEL", "").strip()
        )
        configured = bool(endpoint and key and deployment)
        logger.info(
            "AI config check provider=azure_openai configured=%s endpoint_set=%s key_set=%s deployment=%s",
            configured,
            bool(endpoint),
            bool(key),
            deployment or "missing",
        )
        return configured
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
    logger.info("AI chat requested provider=%s", provider)
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
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        logger.exception("AI response was not valid JSON. First 500 chars: %s", cleaned[:500])
        raise


def azure_openai_chat(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    no_proxy = os.getenv("NO_PROXY", "")
    if no_proxy:
        os.environ["NO_PROXY"] = no_proxy

    endpoint = (os.getenv("AZURE_OPENAI_ENDPOINT", "") or os.getenv("AZURE_ENDPOINT", "")).rstrip("/")
    key = os.getenv("AZURE_OPENAI_API_KEY", "") or os.getenv("OPENAI_API_KEY", "")
    deployment = (
        os.getenv("AZURE_OPENAI_DEPLOYMENT", "")
        or os.getenv("OPENAI_DEFAULT_MODEL", "")
        or os.getenv("OPENAI_MODEL", "")
    )
    version = os.getenv("AZURE_OPENAI_API_VERSION", "") or os.getenv("API_VERSION", "2025-03-01-preview")
    if not endpoint or not key or not deployment:
        raise RuntimeError("Azure OpenAI is selected but endpoint/key/deployment is missing in .env.")

    logger.info(
        "Starting Azure OpenAI chat endpoint=%s deployment=%s api_version=%s no_proxy_set=%s",
        endpoint,
        deployment,
        version,
        bool(no_proxy),
    )

    from openai import AzureOpenAI

    client = AzureOpenAI(
        api_key=key,
        api_version=version,
        azure_endpoint=endpoint,
    )

    try:
        response = client.chat.completions.create(
            model=deployment,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
        )
    except Exception:
        logger.exception("Azure OpenAI chat failed")
        raise

    content = response.choices[0].message.content
    logger.info("Azure OpenAI chat returned %s characters", len(content or ""))
    return parse_json_response(content)


def openai_chat(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    key = os.getenv("OPENAI_API_KEY", "")
    model = os.getenv("OPENAI_MODEL", "")

    if not key or not model:
        raise RuntimeError("OpenAI is selected but key/model is missing in .env.")

    logger.info("Starting OpenAI chat model=%s key_set=%s", model, bool(key))

    from openai import OpenAI

    client = OpenAI(api_key=key)

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
    except Exception:
        logger.exception("OpenAI chat failed")
        raise

    content = response.choices[0].message.content
    logger.info("OpenAI chat returned %s characters", len(content or ""))
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
