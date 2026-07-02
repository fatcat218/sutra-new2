"""
ai_service.py
-------------
The single, clean integration point with the external AI API.

Responsibilities:
  1. Hold the system + user prompt that tells the model to behave like a careful
     consumer-research analyst and return STRICT JSON only.
  2. Call whichever provider AI_PROVIDER selects
     (openai | openrouter | gemini | claude).
  3. Parse the model output into a dict, robustly (strip code fences, find the
     JSON object) so a slightly chatty model never breaks the API.

Switching providers is just an env var (AI_PROVIDER) + the matching AI_API_KEY.
No business logic lives here -- it only turns "business_context" into a report.

Required env vars:
  AI_PROVIDER  = openai | openrouter | gemini | claude
  AI_API_KEY   = the key for that provider
Optional:
  AI_MODEL     = override the default model name for the chosen provider
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict

import requests

from app.services.prompt_templates import FINAL_REPORT_PROMPT

# Default model per provider; override with AI_MODEL if you want.
_DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "openrouter": "openrouter/auto",
    "gemini": "gemini-1.5-flash",
    "claude": "claude-3-5-sonnet-latest",
}

_REQUEST_TIMEOUT = 60


# --------------------------------------------------------------------------- #
# PROMPT
# --------------------------------------------------------------------------- #
# The strict-JSON report prompt now lives in prompt_templates.py.
_SYSTEM_PROMPT = FINAL_REPORT_PROMPT


def _build_user_prompt(business_context: str) -> str:
    return (
        "Here is the business intake gathered from the user's onboarding "
        "conversation and (optionally) their website:\n\n"
        f"{business_context}\n\n"
        "Build the personalised dashboard as strict JSON using the exact keys "
        "described. Make every field specific to THIS business and reference the "
        "details above directly — no generic advice. Prioritise actionable, "
        "India-specific insight. If the context is thin, still give your best "
        "grounded estimate, lower the confidence_score, and list the missing "
        "inputs in missing_information."
    )


# --------------------------------------------------------------------------- #
# PUBLIC ENTRY POINT
# --------------------------------------------------------------------------- #
def generate_research_report(business_context: str) -> Dict[str, Any]:
    """
    Call the configured AI provider and return the parsed report dict.
    Raises RuntimeError with a clear message on misconfiguration or API failure.
    """
    provider = os.getenv("AI_PROVIDER", "openai").strip().lower()
    api_key = os.getenv("AI_API_KEY", "").strip()
    model = os.getenv("AI_MODEL", "").strip() or _DEFAULT_MODELS.get(provider)

    if not api_key:
        raise RuntimeError("AI_API_KEY is not set. Add it to your .env file.")
    if provider not in _DEFAULT_MODELS:
        raise RuntimeError(
            f"Unknown AI_PROVIDER '{provider}'. Use one of: "
            "openai, openrouter, gemini, claude."
        )

    user_prompt = _build_user_prompt(business_context)

    if provider == "openai":
        raw = _call_openai(api_key, model, user_prompt)
    elif provider == "openrouter":
        raw = _call_openrouter(api_key, model, user_prompt)
    elif provider == "gemini":
        raw = _call_gemini(api_key, model, user_prompt)
    else:  # claude
        raw = _call_claude(api_key, model, user_prompt)

    return _parse_json(raw)


# --------------------------------------------------------------------------- #
# PROVIDER CALLS (plain HTTP via requests -- no heavy SDK dependencies)
# --------------------------------------------------------------------------- #
def _call_openai(api_key: str, model: str, user_prompt: str) -> str:
    """OpenAI Chat Completions. response_format json_object forces valid JSON."""
    url = "https://api.openai.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.7,
        "response_format": {"type": "json_object"},
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _call_openrouter(api_key: str, model: str, user_prompt: str) -> str:
    """OpenRouter Chat Completions using its OpenAI-compatible API."""
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-OpenRouter-Title": "Sutra",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.7,
        "response_format": {"type": "json_object"},
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _call_gemini(api_key: str, model: str, user_prompt: str) -> str:
    """Google Gemini generateContent. responseMimeType asks for JSON."""
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        f"?key={api_key}"
    )
    headers = {"Content-Type": "application/json"}
    payload = {
        # Gemini has no separate system role on this endpoint; prepend it.
        "contents": [
            {"role": "user", "parts": [{"text": _SYSTEM_PROMPT + "\n\n" + user_prompt}]}
        ],
        "generationConfig": {
            "temperature": 0.7,
            "responseMimeType": "application/json",
        },
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    return data["candidates"][0]["content"]["parts"][0]["text"]


def _call_claude(api_key: str, model: str, user_prompt: str) -> str:
    """Anthropic Claude Messages API. system is a top-level field."""
    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "max_tokens": 2000,
        "temperature": 0.7,
        "system": _SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_prompt}],
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json()["content"][0]["text"]


# --------------------------------------------------------------------------- #
# MULTI-TURN CHAT (free-form text, not JSON)
# --------------------------------------------------------------------------- #
def chat_completion(messages: list, temperature: float = 0.7) -> str:
    """
    Run a multi-turn conversation against the configured provider and return the
    assistant's plain-text reply.

    `messages` is a list of {"role": "system"|"user"|"assistant", "content": str}.
    The full history is sent each turn so follow-ups have memory.
    """
    provider = os.getenv("AI_PROVIDER", "openai").strip().lower()
    api_key = os.getenv("AI_API_KEY", "").strip()
    model = os.getenv("AI_MODEL", "").strip() or _DEFAULT_MODELS.get(provider)

    if not api_key:
        raise RuntimeError("AI_API_KEY is not set. Add it to your .env file.")
    if provider not in _DEFAULT_MODELS:
        raise RuntimeError(
            f"Unknown AI_PROVIDER '{provider}'. Use one of: "
            "openai, openrouter, gemini, claude."
        )

    if provider in ("openai", "openrouter"):
        return _chat_openai_compatible(provider, api_key, model, messages, temperature)
    if provider == "gemini":
        return _chat_gemini(api_key, model, messages, temperature)
    return _chat_claude(api_key, model, messages, temperature)


def _chat_openai_compatible(provider, api_key, model, messages, temperature) -> str:
    """OpenAI + OpenRouter share the same chat-completions request shape."""
    if provider == "openrouter":
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-OpenRouter-Title": "Sutra",
        }
    else:
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    payload = {"model": model, "messages": messages, "temperature": temperature}
    resp = requests.post(url, headers=headers, json=payload, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _chat_gemini(api_key, model, messages, temperature) -> str:
    """Gemini: fold any system message into the first turn; map roles."""
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        f"?key={api_key}"
    )
    system_text = "\n".join(m["content"] for m in messages if m["role"] == "system")
    contents = []
    for m in messages:
        if m["role"] == "system":
            continue
        role = "model" if m["role"] == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": m["content"]}]})
    if system_text and contents:
        contents[0]["parts"][0]["text"] = system_text + "\n\n" + contents[0]["parts"][0]["text"]

    payload = {"contents": contents, "generationConfig": {"temperature": temperature}}
    resp = requests.post(url, json=payload, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json()["candidates"][0]["content"]["parts"][0]["text"]


def _chat_claude(api_key, model, messages, temperature) -> str:
    """Claude: system is a top-level field; only user/assistant in messages."""
    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    system_text = "\n".join(m["content"] for m in messages if m["role"] == "system")
    convo = [
        {"role": m["role"], "content": m["content"]}
        for m in messages
        if m["role"] in ("user", "assistant")
    ]
    payload = {
        "model": model,
        "max_tokens": 2000,
        "temperature": temperature,
        "messages": convo,
    }
    if system_text:
        payload["system"] = system_text
    resp = requests.post(url, headers=headers, json=payload, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json()["content"][0]["text"]


# --------------------------------------------------------------------------- #
# JSON PARSING (robust)
# --------------------------------------------------------------------------- #
def _parse_json(raw: str) -> Dict[str, Any]:
    """
    Turn the model's text into a dict. Handles the common cases where a model
    wraps JSON in ```json ... ``` fences or adds stray text around it.
    """
    if not raw:
        raise RuntimeError("AI provider returned an empty response.")

    text = raw.strip()

    # Strip ```json ... ``` or ``` ... ``` fences if present.
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Last resort: grab the outermost {...} block.
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    raise RuntimeError("Could not parse the AI response as JSON.")
