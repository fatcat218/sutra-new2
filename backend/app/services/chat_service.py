"""
chat_service.py
---------------
Conversational research assistant. Replaces the one-shot research form with a
multi-turn chatbot.

Flow:
  - start_session(): create a ChatSession row, seed the system prompt context,
    return the opening greeting + the optional intake template.
  - send_message(): persist the user's message, rebuild the full conversation
    (system prompt + every prior turn), call the AI, persist + return the reply.

Conversation memory = we resend the stored history each turn, so the model can
follow up on earlier answers. History lives in PostgreSQL (chat_messages).
"""

from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone
from typing import List
from uuid import UUID

from sqlalchemy.orm import Session

from app import models, schemas
from app.services import ai_service, scraper_service
from app.services.prompt_templates import CHAT_INTERVIEWER_PROMPT

# The conversational persona now lives in prompt_templates.py.
SYSTEM_PROMPT = CHAT_INTERVIEWER_PROMPT

# Conversation stages (Feature 1). Kept deliberately simple and linear.
STAGE_INTAKE = "intake"
STAGE_CLARIFYING = "clarifying"
STAGE_READY = "ready_for_report"
STAGE_REPORT_GENERATED = "report_generated"
STAGE_CREATIVE = "creative_options"

# Words that signal the user wants the report now.
_REPORT_TRIGGERS = (
    "dashboard",
    "report",
    "generate",
    "final",
    "summary",
    "breakdown",
    "analysis",
)

# The optional structured intake template offered in the UI. If the user picks
# "free mode" they ignore this entirely.
TEMPLATE_FIELDS = [
    {"key": "product_name", "label": "Product / business name", "placeholder": "e.g. Surat Threads", "required": True},
    {"key": "what_you_sell", "label": "What do you sell?", "placeholder": "e.g. Affordable ethnic wear for women", "required": True},
    {"key": "website", "label": "Website (if any)", "placeholder": "https://yourbusiness.com", "required": False},
    {"key": "industry", "label": "Industry", "placeholder": "e.g. Fashion & Apparel", "required": False},
    {"key": "location", "label": "Location / target market", "placeholder": "e.g. Surat, selling across India", "required": False},
    {"key": "price_range", "label": "Price range", "placeholder": "e.g. ₹800–₹2500", "required": False},
    {"key": "current_customers", "label": "Who buys from you today?", "placeholder": "e.g. College students, young professionals, boutique owners", "required": False},
    {"key": "channels", "label": "Where do customers find you?", "placeholder": "e.g. Instagram, walk-ins, WhatsApp, referrals", "required": False},
    {"key": "customer_signals", "label": "Any customer signals?", "placeholder": "e.g. Repeat purchases, popular products, common questions", "required": False},
    {"key": "competitors", "label": "Competitors (optional)", "placeholder": "Names or URLs, comma separated", "required": False},
    {"key": "goal", "label": "What do you want from this research?", "placeholder": "e.g. Find my core audience and ad angles", "required": False},
]

LANGUAGE_NAMES = {
    "en": "English",
    "hi": "Hindi",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "mr": "Marathi",
    "gu": "Gujarati",
    "kn": "Kannada",
    "ml": "Malayalam",
    "pa": "Punjabi",
}


def _greeting(website_url: str | None) -> str:
    site = f" I see you're working on {website_url}." if website_url else ""
    return (
        f"Hi! I'm Sutra, your business research assistant.{site}\n\n"
        "My job here is to understand your business before I build the dashboard. "
        "If you filled the template, I'll use that as the starting point. If any "
        "details are missing, I'll ask a few focused questions about your product, "
        "customers, market, and goals. Once I have enough, you can generate your "
        "personalised audience and market-intelligence dashboard."
    )


def start_session(
    db: Session,
    user_id: UUID,
    user_email: str,
    user_name: str | None,
    website_url: str | None,
    mode: str | None,
) -> models.ChatSession:
    """Create a new chat session and store the opening assistant greeting."""
    business = db.query(models.Business).filter(
        models.Business.user_id == user_id
    ).first()
    if business is None:
        business = models.Business(
            user_id=user_id,
            business_name=user_name or "Untitled business",
            website_url=website_url,
        )
        db.add(business)
        db.flush()
    elif website_url and not business.website_url:
        business.website_url = website_url

    session = models.ChatSession(
        user_id=user_id,
        business_id=business.id,
        website_url=website_url,
        mode=mode if mode in ("template", "free") else "free",
        title="New research chat",
        stage=STAGE_INTAKE,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    greeting = _greeting(website_url)
    db.add(models.ChatMessage(session_id=session.id, role="assistant", content=greeting))
    db.commit()

    if website_url:
        _capture_website_source(db, session, website_url)

    return session, greeting


def _capture_website_source(
    db: Session,
    session: models.ChatSession,
    website_url: str,
) -> models.ResearchSource:
    """Scrape once and persist the extracted context for later chat turns."""
    source = models.ResearchSource(
        business_id=session.business_id,
        session_id=session.id,
        source_type="website",
        url=website_url,
        scrape_status="processing",
    )
    db.add(source)
    db.commit()
    db.refresh(source)

    scraped = scraper_service.scrape_website(website_url)
    if scraped:
        source.extracted_text = scraped
        source.content_hash = hashlib.sha256(scraped.encode("utf-8")).hexdigest()
        source.scrape_status = "complete"
        source.fetched_at = datetime.now(timezone.utc)
    else:
        source.scrape_status = "failed"
        source.error_message = "No usable public website text could be extracted."
    db.commit()
    return source


def _build_messages(session: models.ChatSession) -> List[dict]:
    """System prompt (+ any captured context) followed by the full history."""
    system = SYSTEM_PROMPT
    context_bits = []
    if session.website_url:
        context_bits.append(f"User's website: {session.website_url}")
        stored_source = next(
            (
                source
                for source in session.sources
                if source.url == session.website_url
                and source.scrape_status == "complete"
                and source.extracted_text
            ),
            None,
        )
        if stored_source:
            context_bits.append(
                "Best-effort public website scrape. Use this only as context; "
                "do not claim it is complete or live market data:\n"
                f"{stored_source.extracted_text}"
            )
        else:
            context_bits.append(
                "Website scrape was unavailable or returned very little text. "
                "Ask the user for product details instead of guessing."
            )
    if session.user and session.user.full_name:
        context_bits.append(f"User's name: {session.user.full_name}")
    if session.user and session.user.language_preference != "en":
        language = LANGUAGE_NAMES.get(
            session.user.language_preference,
            session.user.language_preference,
        )
        context_bits.append(
            f"User's preferred language is {language}. Reply primarily in "
            f"{language} unless the user clearly asks for another language."
        )
    if context_bits:
        system += "\n\nKnown context about this user:\n" + "\n".join(context_bits)

    messages = [{"role": "system", "content": system}]
    for m in session.messages:
        if m.role in ("user", "assistant"):
            messages.append({"role": m.role, "content": m.content})
    return messages


def send_message(db: Session, session_id: int, user_id: UUID, user_message: str):
    """
    Persist the user's message, call the AI with the full history, then persist
    and return the assistant's reply. Returns (session, reply) or raises.
    """
    session = db.query(models.ChatSession).filter(
        models.ChatSession.id == session_id,
        models.ChatSession.user_id == user_id,
    ).first()
    if session is None:
        raise LookupError("Chat session not found.")

    # 1. Save the user's turn first so it's part of the history we send.
    db.add(models.ChatMessage(session_id=session.id, role="user", content=user_message))
    session.updated_at = datetime.now(timezone.utc)
    _update_business_from_message(session.business, user_message)
    db.commit()
    db.refresh(session)

    # 2. Give the chat a title from the first real user message.
    if session.title in (None, "New research chat"):
        session.title = user_message[:60]
        db.commit()

    # 3. Advance the conversation stage (Feature 1).
    _advance_stage(db, session, user_message)

    # 4. Build the full conversation and call the provider.
    messages = _build_messages(session)
    reply = ai_service.chat_completion(messages)

    # 5. Save the assistant's reply.
    db.add(models.ChatMessage(session_id=session.id, role="assistant", content=reply))
    db.commit()
    db.refresh(session)

    return session, reply


def _update_business_from_message(
    business: models.Business,
    user_message: str,
) -> None:
    """Copy labelled guided-intake fields into the user's business profile."""
    for line in user_message.splitlines():
        if ":" not in line:
            continue
        raw_label, raw_value = line.split(":", 1)
        label = raw_label.strip().lower()
        value = raw_value.strip()
        if not value:
            continue
        if label in ("product / business name", "product name", "business name"):
            business.business_name = value[:255]
        elif label == "industry":
            business.industry = value[:255]
        elif label in ("location / target market", "location", "target market"):
            business.location = value[:255]
        elif label in ("what do you sell?", "what do you sell", "business description"):
            business.description = value


def _advance_stage(db: Session, session: models.ChatSession, user_message: str) -> None:
    """
    Move the session forward through the stages. Simple and forward-only:
    intake -> clarifying (first user message) -> ready_for_report (enough
    context, or the user asks for the report). We never move backwards, and we
    leave report_generated / creative_options alone once reached.
    """
    # Don't touch sessions that are already past the interview.
    if session.stage in (STAGE_READY, STAGE_REPORT_GENERATED, STAGE_CREATIVE):
        return

    # First real user message moves us out of intake.
    if session.stage == STAGE_INTAKE:
        session.stage = STAGE_CLARIFYING

    user_turns = sum(1 for m in session.messages if m.role == "user")
    asked_for_report = any(word in user_message.lower() for word in _REPORT_TRIGGERS)

    # Ready once the user asks, after a rich template-style message, or after a
    # few useful answers.
    if asked_for_report or _has_rich_context(user_message) or user_turns >= 3:
        session.stage = STAGE_READY

    db.commit()


def _has_rich_context(user_message: str) -> bool:
    """
    The frontend sends filled templates as labelled lines. If we see several of
    those lines in one turn, the user has likely already given enough intake
    data to offer dashboard generation immediately.
    """
    labels = (
        "product",
        "business",
        "sell",
        "industry",
        "location",
        "target",
        "price",
        "customers",
        "channels",
        "signals",
        "competitors",
        "goal",
        "website",
    )
    labelled_lines = 0
    for line in user_message.lower().splitlines():
        if ":" not in line:
            continue
        if any(label in line.split(":", 1)[0] for label in labels):
            labelled_lines += 1
    return labelled_lines >= 4


# --------------------------------------------------------------------------- #
# FINAL REPORT (Feature 2)
# --------------------------------------------------------------------------- #
def _conversation_context(session: models.ChatSession) -> str:
    """Flatten the session into a single context string for the report model."""
    lines: List[str] = []
    if session.website_url:
        lines.append(f"Business website: {session.website_url}")
    for source in session.sources:
        if source.scrape_status == "complete" and source.extracted_text:
            lines.append(
                f"Public {source.source_type} context from {source.url} "
                f"(best-effort scrape):\n{source.extracted_text}"
            )
    lines.append("\n--- Conversation transcript ---")
    for m in session.messages:
        if m.role == "user":
            lines.append(f"User: {m.content}")
        elif m.role == "assistant":
            lines.append(f"Sutra: {m.content}")
    return "\n".join(lines)


def generate_report(db: Session, session_id: int, user_id: UUID):
    """
    Build a structured research report from the whole conversation, persist it
    in the existing research_reports table, and mark the session as
    report_generated. Returns (session, business, report, report_data).
    """
    session = db.query(models.ChatSession).filter(
        models.ChatSession.id == session_id,
        models.ChatSession.user_id == user_id,
    ).first()
    if session is None:
        raise LookupError("Chat session not found.")

    # 1. Call the AI with the full conversation as context (strict JSON).
    context = _conversation_context(session)
    raw_report = ai_service.generate_research_report(context)

    # 2. Validate/normalise into the existing report schema.
    report_data = schemas.ResearchReportData(**raw_report)

    # 3. Persist against the user's existing V1 business.
    business = session.business
    report = models.ResearchReport(
        business_id=business.id,
        session_id=session.id,
        status="complete",
        report_json=report_data.model_dump(),
        source_snapshot=[
            {
                "source_id": source.id,
                "type": source.source_type,
                "url": source.url,
                "content_hash": source.content_hash,
                "fetched_at": source.fetched_at.isoformat() if source.fetched_at else None,
            }
            for source in session.sources
        ],
        ai_provider=os.getenv("AI_PROVIDER"),
        ai_model=os.getenv("AI_MODEL") or None,
        completed_at=datetime.now(timezone.utc),
    )
    db.add(report)

    # 4. Move the session into the report_generated stage.
    session.stage = STAGE_REPORT_GENERATED
    session.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(report)
    db.refresh(session)

    return session, business, report, report_data
