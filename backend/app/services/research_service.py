"""
research_service.py
-------------------
Orchestrates the whole "start research" flow. The route stays thin; all the
real work lives here.

Steps (this is the main backend flow):
  1. Persist the submitted business profile -> businesses table.
  2. If a website_url was given, scrape a bit of text from it (best-effort).
  3. Build a single clean "business_context" string from the form + scrape.
  4. Call the AI provider via ai_service to get the structured report.
  5. Validate/normalise the report against the Pydantic schema.
  6. Persist the report -> research_reports table.
  7. Return (business, report, report_data) to the route.
"""

from __future__ import annotations

from typing import List

from sqlalchemy.orm import Session

from app import models, schemas
from app.services import ai_service, scraper_service


def _urls_to_str_list(urls) -> List[str]:
    """Pydantic HttpUrl objects -> plain strings for storage/prompting."""
    return [str(u) for u in urls] if urls else []


def _build_business_context(
    payload: schemas.ResearchStartRequest, scraped_text: str
) -> str:
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
        lines.append("\n--- Text scraped from the business website ---")
        lines.append(scraped_text)
    else:
        lines.append("\n(No website text was scraped / available.)")

    return "\n".join(lines)


def run_research(db: Session, payload: schemas.ResearchStartRequest):
    """
    Execute the full research pipeline and return:
        (business_model, report_model, report_data_schema)
    """
    # 1. Save the business profile.
    business = models.Business(
        business_name=payload.business_name,
        industry=payload.industry,
        location=payload.location,
        description=payload.business_description,
        website_url=str(payload.website_url) if payload.website_url else None,
        instagram_url=str(payload.instagram_url) if payload.instagram_url else None,
        linkedin_url=str(payload.linkedin_url) if payload.linkedin_url else None,
        competitor_urls=_urls_to_str_list(payload.competitor_urls),
    )
    db.add(business)
    db.commit()
    db.refresh(business)

    # 2. Best-effort scrape of the website (only if a URL was provided).
    scraped_text = ""
    if payload.website_url:
        scraped_text = scraper_service.scrape_website(str(payload.website_url))

    # 3. Build the unified context string for the AI.
    business_context = _build_business_context(payload, scraped_text)

    # 4. Call the AI provider.
    try:
        raw_report = ai_service.generate_research_report(business_context)
    except Exception:
        # Do not leave an orphaned business row when upstream generation fails.
        db.delete(business)
        db.commit()
        raise

    # 5. Validate/normalise into our schema (fills defaults, drops junk).
    report_data = schemas.ResearchReportData(**raw_report)

    # 6. Persist the report (store the validated, normalised JSON).
    report = models.ResearchReport(
        business_id=business.id,
        report_json=report_data.model_dump(),
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    # 7. Hand everything back to the route.
    return business, report, report_data
