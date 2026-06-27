"""
scraper_service.py
------------------
Best-effort website scraper using requests + BeautifulSoup.

This is intentionally dependency-light: it does NOT run JavaScript like a real
browser. It works well on public server-rendered pages and partially on many
marketing sites, but JS-only websites may still return thin content.

What we extract:
  - homepage + a few high-signal internal pages
  - title, meta/OG/Twitter descriptions, headings
  - visible text from paragraphs, lists, buttons, and useful links
  - JSON-LD/schema.org snippets
  - social links, emails, phone-looking strings

Any failure returns "" so research/chat never crashes because of scraping.
"""

from __future__ import annotations

import json
import ipaddress
import re
import socket
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Iterable
from urllib.parse import urljoin, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup


# Pretend to be a normal browser; some sites block the default requests UA.
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

_TIMEOUT_SECONDS = 10
_MAX_PAGES = 7
_MAX_CHARS = 14000
_MAX_TEXT_PER_PAGE = 4500
_MAX_LINKS_TO_SCORE = 120

_KEY_PAGE_RE = re.compile(
    r"(about|product|products|shop|store|service|services|pricing|plans|"
    r"features|solutions|contact|collections|catalog|menu|work|case|customer|"
    r"clients|testimonials|faq|mission|story)",
    re.IGNORECASE,
)
_BAD_PATH_RE = re.compile(
    r"(login|signin|sign-in|signup|cart|checkout|account|privacy|terms|"
    r"refund|shipping|wishlist|search|tag|author|wp-json)",
    re.IGNORECASE,
)
_ASSET_EXTENSIONS = (
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".svg",
    ".webp",
    ".pdf",
    ".zip",
    ".mp4",
    ".mov",
    ".mp3",
    ".css",
    ".js",
)
_SOCIAL_DOMAINS = (
    "instagram.com",
    "facebook.com",
    "linkedin.com",
    "youtube.com",
    "youtu.be",
    "twitter.com",
    "x.com",
    "tiktok.com",
    "pinterest.com",
)
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"(?:\+?\d[\d\s().-]{7,}\d)")


@dataclass
class _Link:
    url: str
    text: str = ""


@dataclass
class _Page:
    url: str
    title: str = ""
    meta: list[str] = field(default_factory=list)
    headings: list[str] = field(default_factory=list)
    text: list[str] = field(default_factory=list)
    schema: list[str] = field(default_factory=list)
    internal_links: list[_Link] = field(default_factory=list)
    external_links: list[_Link] = field(default_factory=list)
    emails: list[str] = field(default_factory=list)
    phones: list[str] = field(default_factory=list)


def scrape_website(url: str) -> str:
    """
    Return structured, clean website context scraped from `url`.
    On ANY error (timeout, bad status, parse error) return "".
    """
    normalised = _normalise_url(url)
    if not normalised:
        return ""
    return _scrape_website_cached(normalised)


@lru_cache(maxsize=128)
def _scrape_website_cached(url: str) -> str:
    try:
        return _scrape_website_uncached(url)
    except Exception:
        return ""


def _scrape_website_uncached(url: str) -> str:
    html, final_url = _fetch_html(url)
    if not html:
        return ""

    base_netloc = urlparse(final_url).netloc.lower()
    home = _parse_page(html, final_url, base_netloc)
    pages = [home]

    for link in _pick_internal_pages(home.internal_links, base_netloc, final_url):
        if len(pages) >= _MAX_PAGES:
            break
        try:
            page_html, page_url = _fetch_html(link.url)
            if page_html:
                pages.append(_parse_page(page_html, page_url, base_netloc))
        except Exception:
            continue

    return _format_pages(pages)


def _fetch_html(url: str) -> tuple[str, str]:
    try:
        current_url = url
        response = None
        for _ in range(6):
            safe_url = _normalise_url(current_url)
            if not safe_url:
                return "", current_url
            response = requests.get(
                safe_url,
                headers=_HEADERS,
                timeout=_TIMEOUT_SECONDS,
                allow_redirects=False,
            )
            if response.status_code not in (301, 302, 303, 307, 308):
                break
            location = response.headers.get("location")
            if not location:
                return "", safe_url
            current_url = urljoin(safe_url, location)
        if response is None:
            return "", url
        response.raise_for_status()
    except Exception:
        return "", url

    content_type = response.headers.get("content-type", "").lower()
    if content_type and "html" not in content_type and "text" not in content_type:
        return "", response.url
    return response.text or "", response.url


def _parse_page(html: str, url: str, base_netloc: str) -> _Page:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "canvas", "iframe"]):
        # Keep JSON-LD before deleting scripts.
        if tag.name == "script" and tag.get("type", "").lower() == "application/ld+json":
            continue
        tag.decompose()

    page = _Page(url=url)
    page.title = _clean(soup.title.string if soup.title else "")
    page.meta = _extract_meta(soup)
    page.schema = _extract_json_ld(soup)
    page.headings = _unique(
        _clean(tag.get_text(" ", strip=True))
        for tag in soup.find_all(["h1", "h2", "h3"])
    )[:35]

    body_texts: list[str] = []
    for tag in soup.find_all(["h1", "h2", "h3", "h4", "p", "li", "button"]):
        text = _clean(tag.get_text(" ", strip=True))
        if _useful_text(text):
            body_texts.append(text)

    for tag in soup.find_all("a", href=True):
        href = _normalise_url(urljoin(url, tag["href"]))
        text = _clean(tag.get_text(" ", strip=True))
        if not href or _is_asset_url(href):
            continue
        if _is_same_site(href, base_netloc):
            page.internal_links.append(_Link(url=href, text=text))
            if _useful_link_text(text):
                body_texts.append(text)
        else:
            page.external_links.append(_Link(url=href, text=text))

    page.text = _unique(body_texts)[:90]
    joined = "\n".join(page.text + page.meta + page.headings)
    page.emails = _unique(_EMAIL_RE.findall(joined))[:10]
    page.phones = _unique(match.strip() for match in _PHONE_RE.findall(joined))[:10]
    return page


def _extract_meta(soup: BeautifulSoup) -> list[str]:
    fields = [
        ("name", "description"),
        ("name", "keywords"),
        ("property", "og:title"),
        ("property", "og:description"),
        ("property", "og:site_name"),
        ("name", "twitter:title"),
        ("name", "twitter:description"),
    ]
    values: list[str] = []
    for attr, key in fields:
        tag = soup.find("meta", attrs={attr: key})
        content = _clean(tag.get("content", "")) if tag else ""
        if content:
            label = key.replace("og:", "").replace("twitter:", "")
            values.append(f"{label}: {content}")
    return _unique(values)


def _extract_json_ld(soup: BeautifulSoup) -> list[str]:
    snippets: list[str] = []
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = script.string or script.get_text() or ""
        raw = raw.strip()
        if not raw:
            continue
        try:
            parsed = json.loads(raw)
            snippets.extend(_summarise_schema(parsed))
        except Exception:
            compact = _clean(raw)
            if compact:
                snippets.append(compact[:700])
    return _unique(snippets)[:12]


def _summarise_schema(data) -> list[str]:
    if isinstance(data, list):
        result: list[str] = []
        for item in data[:8]:
            result.extend(_summarise_schema(item))
        return result
    if not isinstance(data, dict):
        return []

    if "@graph" in data:
        return _summarise_schema(data["@graph"])

    interesting_keys = [
        "@type",
        "name",
        "description",
        "brand",
        "category",
        "slogan",
        "priceRange",
        "areaServed",
        "address",
        "telephone",
        "email",
    ]
    parts = []
    for key in interesting_keys:
        if key not in data:
            continue
        value = data[key]
        if isinstance(value, dict):
            value = value.get("name") or value.get("streetAddress") or value.get("@type")
        elif isinstance(value, list):
            value = ", ".join(
                str(v.get("name") if isinstance(v, dict) else v)
                for v in value[:4]
            )
        value = _clean(str(value))
        if value:
            parts.append(f"{key}: {value}")
    return ["Schema: " + "; ".join(parts)] if parts else []


def _pick_internal_pages(links: Iterable[_Link], base_netloc: str, current_url: str) -> list[_Link]:
    seen: set[str] = {_canonical_url(current_url)}
    scored: list[tuple[int, _Link]] = []
    for link in list(links)[:_MAX_LINKS_TO_SCORE]:
        canonical = _canonical_url(link.url)
        if canonical in seen:
            continue
        seen.add(canonical)
        parsed = urlparse(canonical)
        path = parsed.path.lower()
        if not _is_same_site(canonical, base_netloc):
            continue
        if _BAD_PATH_RE.search(path) or _is_asset_url(canonical):
            continue

        score = 0
        label = f"{path} {link.text}".lower()
        if _KEY_PAGE_RE.search(label):
            score += 20
        if path.count("/") <= 2:
            score += 5
        if link.text:
            score += min(len(link.text), 80) // 20
        scored.append((score, _Link(url=canonical, text=link.text)))

    scored.sort(key=lambda item: item[0], reverse=True)
    return [link for score, link in scored if score > 0][:_MAX_PAGES - 1]


def _format_pages(pages: list[_Page]) -> str:
    if not pages:
        return ""

    social_links = _unique(
        link.url
        for page in pages
        for link in page.external_links
        if any(domain in urlparse(link.url).netloc.lower() for domain in _SOCIAL_DOMAINS)
    )[:16]
    emails = _unique(email for page in pages for email in page.emails)[:10]
    phones = _unique(phone for page in pages for phone in page.phones)[:10]

    blocks = [
        "Website scrape summary (best-effort, public static HTML only).",
        "Pages inspected:",
    ]
    blocks.extend(f"- {page.url}" for page in pages)

    if social_links:
        blocks.append("\nSocial/profile links found:")
        blocks.extend(f"- {url}" for url in social_links)
    if emails or phones:
        blocks.append("\nContact signals found:")
        blocks.extend(f"- Email: {email}" for email in emails)
        blocks.extend(f"- Phone: {phone}" for phone in phones)

    for index, page in enumerate(pages, start=1):
        blocks.append(f"\n--- Page {index}: {page.title or page.url} ---")
        blocks.append(f"URL: {page.url}")
        if page.meta:
            blocks.append("Meta signals: " + " | ".join(page.meta[:6]))
        if page.schema:
            blocks.append("Structured data: " + " | ".join(page.schema[:5]))
        if page.headings:
            blocks.append("Headings: " + " | ".join(page.headings[:16]))
        if page.text:
            text = "\n".join(f"- {item}" for item in page.text)
            blocks.append("Visible content:\n" + text[:_MAX_TEXT_PER_PAGE])

    combined = "\n".join(blocks).strip()
    return combined[:_MAX_CHARS]


def _normalise_url(url: str | None) -> str:
    if not url:
        return ""
    value = str(url).strip()
    if not value:
        return ""
    if not value.startswith(("http://", "https://")):
        value = "https://" + value

    parsed = urlparse(value)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.netloc
        or not parsed.hostname
        or parsed.username
        or parsed.password
    ):
        return ""
    try:
        if parsed.port and parsed.port not in (80, 443):
            return ""
    except ValueError:
        return ""
    if not _is_public_hostname(parsed.hostname):
        return ""
    return _canonical_url(value)


@lru_cache(maxsize=512)
def _is_public_hostname(hostname: str) -> bool:
    """Reject local/private/reserved destinations before making HTTP requests."""
    lowered = hostname.rstrip(".").lower()
    if lowered in ("localhost", "localhost.localdomain") or lowered.endswith(".local"):
        return False
    try:
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(lowered, None, type=socket.SOCK_STREAM)
        }
    except (socket.gaierror, UnicodeError):
        return False
    if not addresses:
        return False
    try:
        return all(ipaddress.ip_address(address).is_global for address in addresses)
    except ValueError:
        return False


def _canonical_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    return urlunparse((parsed.scheme, parsed.netloc.lower(), path, "", "", ""))


def _is_same_site(url: str, base_netloc: str) -> bool:
    netloc = urlparse(url).netloc.lower()
    return netloc == base_netloc or netloc.endswith("." + base_netloc)


def _is_asset_url(url: str) -> bool:
    path = urlparse(url).path.lower()
    return path.endswith(_ASSET_EXTENSIONS)


def _clean(text: str | None) -> str:
    if not text:
        return ""
    text = re.sub(r"\s+", " ", str(text))
    return text.strip(" \t\r\n-–—|")


def _useful_text(text: str) -> bool:
    if not text or len(text) < 3:
        return False
    lowered = text.lower()
    boring = (
        "cookie",
        "privacy policy",
        "terms and conditions",
        "all rights reserved",
        "skip to content",
    )
    if any(item in lowered for item in boring) and len(text) < 140:
        return False
    return True


def _useful_link_text(text: str) -> bool:
    if not _useful_text(text):
        return False
    return len(text) > 18 or bool(_KEY_PAGE_RE.search(text))


def _unique(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        cleaned = _clean(value)
        key = cleaned.lower()
        if not cleaned or key in seen:
            continue
        seen.add(key)
        result.append(cleaned)
    return result
