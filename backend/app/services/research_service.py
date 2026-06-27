"""
research_service.py
-------------------
Orchestrates the whole "start research" flow. The route stays thin; all the
real work lives here.

Steps (this is the main backend flow):
  1. Persist the submitted business profile -> businesses table.
  2. If URLs were given, scrape useful public page context (best-effort).
  3. Build a single clean "business_context" string from the form + scrape.
  4. Call the AI provider via ai_service to get the structured report.
  5. Validate/normalise the report against the Pydantic schema.
  6. Persist the report -> research_reports table.
  7. Return (business, report, report_data) to the route.
"""

from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone
from typing import List, Tuple
from uuid import UUID

from sqlalchemy.orm import Session

from app import models, schemas
from app.services import ai_service, scraper_service


def _urls_to_str_list(urls) -> List[str]:
    """Pydantic HttpUrl objects -> plain strings for storage/prompting."""
    return [str(u) for u in urls] if urls else []


def _build_business_context(payload: schemas.ResearchStartRequest, scraped_text: str) -> str:
    """
    Assemble everything we know about the business into one readable block.
    Only include fields that were actually provided so the AI can judge how
    thin or rich the input is (which drives confidence_score).
    """
    lines: List[str] = []
    lines.append(f"Business name: {payload.business_name}")
    if payload.industry:
        lines.append(f"Industry: {payload.industry}")
    if payload.location:
        lines.append(f"Location / target market: {payload.location}")
    if payload.business_description:
        lines.append(f"Business description: {payload.business_description}")

    if payload.website_url:
        lines.append(f"Website: {payload.website_url}")
    if payload.instagram_url:
        lines.append(f"Instagram: {payload.instagram_url}")
    if payload.linkedin_url:
        lines.append(f"LinkedIn: {payload.linkedin_url}")
    if payload.competitor_urls:
        lines.append("Competitor URLs: " + ", ".join(_urls_to_str_list(payload.competitor_urls)))

    if scraped_text:
        lines.append("\n--- Public website context scraped from submitted URLs ---")
        lines.append(scraped_text)
    else:
        lines.append("\n(No website text was scraped / available.)")

    return "\n".join(lines)


def _scrape_sources(
    db: Session,
    business: models.Business,
    payload: schemas.ResearchStartRequest,
) -> tuple[str, list[models.ResearchSource]]:
    """
    Scrape the user's own website and a small number of competitor URLs.
    We keep this capped so the LLM prompt stays useful instead of becoming a
    giant raw page dump.
    """
    sources: List[Tuple[str, str]] = []
    if payload.website_url:
        sources.append(("Business website", str(payload.website_url)))
    for index, url in enumerate(_urls_to_str_list(payload.competitor_urls)[:3], start=1):
        sources.append((f"Competitor website {index}", url))

    blocks: List[str] = []
    saved_sources: list[models.ResearchSource] = []
    remaining_chars = 18000
    for label, url in sources:
        source_type = "website" if label == "Business website" else "competitor"
        source = models.ResearchSource(
            business_id=business.id,
            source_type=source_type,
            url=url,
            scrape_status="processing",
        )
        db.add(source)
        db.flush()
        scraped = scraper_service.scrape_website(url)
        if not scraped:
            source.scrape_status = "failed"
            source.error_message = "No usable public website text could be extracted."
            saved_sources.append(source)
            continue
        source.scrape_status = "complete"
        source.extracted_text = scraped
        source.content_hash = hashlib.sha256(scraped.encode("utf-8")).hexdigest()
        source.fetched_at = datetime.now(timezone.utc)
        saved_sources.append(source)
        block = f"\n### {label}: {url}\n{scraped}"
        if len(block) > remaining_chars:
            block = block[:remaining_chars]
        blocks.append(block)
        remaining_chars -= len(block)
        if remaining_chars <= 0:
            break
    db.commit()
    return "\n".join(blocks).strip(), saved_sources


def run_research(
    db: Session,
    payload: schemas.ResearchStartRequest,
    user_id: UUID,
):
    """
    Execute the full research pipeline and return:
        (business_model, report_model, report_data_schema)
    """
    # 1. Create or update the user's single V1 business profile.
    business = db.query(models.Business).filter(models.Business.user_id == user_id).first()
    if business is None:
        business = models.Business(user_id=user_id)
        db.add(business)
    business.business_name = payload.business_name
    business.industry = payload.industry
    business.location = payload.location
    business.description = payload.business_description
    business.website_url = str(payload.website_url) if payload.website_url else None
    business.instagram_url = str(payload.instagram_url) if payload.instagram_url else None
    business.linkedin_url = str(payload.linkedin_url) if payload.linkedin_url else None
    business.competitor_urls = _urls_to_str_list(payload.competitor_urls)
    db.commit()
    db.refresh(business)

    # 2. Best-effort scrape of submitted public websites.
    scraped_text, saved_sources = _scrape_sources(db, business, payload)

    # 3. Build the unified context string for the AI.
    business_context = _build_business_context(payload, scraped_text)

    source_snapshot = [
        {
            "source_id": source.id,
            "type": source.source_type,
            "url": source.url,
            "content_hash": source.content_hash,
            "fetched_at": source.fetched_at.isoformat() if source.fetched_at else None,
        }
        for source in saved_sources
    ]
    report = models.ResearchReport(
        business_id=business.id,
        status="generating",
        source_snapshot=source_snapshot,
        ai_provider=os.getenv("AI_PROVIDER"),
        ai_model=os.getenv("AI_MODEL") or None,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    # 4. Call the AI provider and preserve failed runs for diagnostics.
    try:
        raw_report = ai_service.generate_research_report(business_context)
    except Exception as exc:
        report.status = "failed"
        report.error_message = str(exc)[:2000]
        db.commit()
        raise

    # 5. Validate/normalise into our schema (fills defaults, drops junk).
    report_data = schemas.ResearchReportData(**raw_report)

    # 6. Complete the immutable report version.
    report.status = "complete"
    report.report_json = report_data.model_dump()
    report.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(report)

    # 7. Hand everything back to the route.
    return business, report, report_data
