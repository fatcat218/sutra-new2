"""
scraper_service.py
------------------
Very small, defensive website scraper using requests + BeautifulSoup.

Goal: pull a *little* clean text from a website so the AI has more context than
the user's typed description. This is best-effort only -- scraping must NEVER
crash the request. Any failure returns an empty string and the flow continues.

What we extract:
  - <title>
  - meta description
  - the first chunk of visible <h1>/<h2>/<p> text

We cap the output length so we don't blow up the AI prompt.
"""

from __future__ import annotations

import requests
from bs4 import BeautifulSoup

# Pretend to be a normal browser; some sites block the default requests UA.
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    )
}

_TIMEOUT_SECONDS = 8
_MAX_CHARS = 4000  # keep the scraped text small for the prompt


def scrape_website(url: str) -> str:
    """
    Return a short block of clean text scraped from `url`.
    On ANY error (timeout, bad status, parse error) return "".
    """
    if not url:
        return ""

    try:
        resp = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT_SECONDS)
        resp.raise_for_status()
    except Exception:
        # Network error, non-200, timeout -> silently give up.
        return ""

    try:
        soup = BeautifulSoup(resp.text, "html.parser")
    except Exception:
        return ""

    parts: list[str] = []

    # Title
    if soup.title and soup.title.string:
        parts.append(f"Title: {soup.title.string.strip()}")

    # Meta description
    meta = soup.find("meta", attrs={"name": "description"})
    if meta and meta.get("content"):
        parts.append(f"Description: {meta['content'].strip()}")

    # Headings + paragraphs (visible-ish content)
    for tag in soup.find_all(["h1", "h2", "h3", "p"]):
        text = tag.get_text(separator=" ", strip=True)
        if text and len(text) > 2:
            parts.append(text)

    combined = "\n".join(parts).strip()

    # Collapse runaway whitespace and cap length.
    combined = " ".join(combined.split("\n"))
    return combined[:_MAX_CHARS]
