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
# The system prompt encodes the careful, non-overclaiming behaviour required.
_SYSTEM_PROMPT = """You are a senior consumer-research analyst for an Indian
marketing intelligence platform. You produce ESTIMATED audience research to
help small businesses and startups target their marketing.

IMPORTANT RULES:
- This is an ESTIMATED marketing research output, NOT guaranteed factual market
  data. Do not invent statistics or cite fake sources.
- Use cautious language: "likely audience", "estimated segment",
  "recommended targeting direction", "this suggests", etc. Never overclaim.
- Base your analysis on the business context provided. If the input is weak or
  sparse, set confidence_score to "low" or "medium" and clearly list what is
  missing in missing_information.
- Tailor insights to the Indian market where relevant (regions, tiers,
  languages, festivals, price sensitivity) but only when the context supports it.
- Return VALID JSON ONLY. No markdown, no code fences, no commentary before or
  after the JSON object.

Return a JSON object with EXACTLY these keys:
{
  "business_summary": string,
  "target_audience_overview": string,
  "primary_segment": string,
  "secondary_segment": string,
  "age_groups": [string],
  "demographic_analysis": string,
  "socioeconomic_analysis": string,
  "behavioral_analysis": string,
  "buying_motivations": [string],
  "pain_points": [string],
  "best_marketing_channels": [string],
  "campaign_angles": [string],
  "confidence_score": "low" | "medium" | "high",
  "missing_information": [string],
  "recommended_follow_up_questions": [string]
}"""


def _build_user_prompt(business_context: str) -> str:
    return (
        "Here is the business context gathered from the user's form and "
        "(optionally) scraped from their website:\n\n"
        f"{business_context}\n\n"
        "Produce the estimated consumer research report as strict JSON using the "
        "exact keys described. Remember to keep claims cautious and to lower the "
        "confidence_score if the context is thin."
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
