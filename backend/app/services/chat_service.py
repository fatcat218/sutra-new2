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

Conversation memory = we resend the whole stored history each turn, so the model
can follow up on earlier answers. History lives in SQLite (chat_messages).
"""

from __future__ import annotations

from typing import List

from sqlalchemy.orm import Session

from app import models
from app.services import ai_service, scraper_service

# The persona / behaviour for the chatbot. Looser than the JSON-only research
# prompt, because here we want a natural back-and-forth conversation.
SYSTEM_PROMPT = """You are Sutra, a friendly but sharp consumer-research
assistant for an Indian marketing intelligence platform. You help small
businesses and startups understand WHO their buyers are and how to reach them.

How to behave:
- Have a natural conversation. Ask clarifying questions when the input is thin.
- When you have enough context, produce useful ESTIMATED audience research:
  likely segments, demographics, motivations, pain points, marketing channels,
  and campaign angles. Tailor to the Indian market when the context supports it.
- This is ESTIMATED guidance, not guaranteed market data. Use cautious language
  ("likely", "estimated", "this suggests") and never invent fake statistics or
  sources. If context is weak, say so and ask for what's missing.
- Keep replies focused and skimmable. Use short paragraphs or compact lists.
- Remember everything the user has already told you in this conversation and
  build on it for follow-up requests (e.g. "make it punchier", "focus on Gen Z",
  "now give me ad angles").
"""

# The optional structured intake template offered in the UI. If the user picks
# "free mode" they ignore this entirely.
TEMPLATE_FIELDS = [
    {"key": "product_name", "label": "Product / business name", "placeholder": "e.g. Surat Threads", "required": True},
    {"key": "what_you_sell", "label": "What do you sell?", "placeholder": "e.g. Affordable ethnic wear for women", "required": True},
    {"key": "website", "label": "Website (if any)", "placeholder": "https://yourbusiness.com", "required": False},
    {"key": "industry", "label": "Industry", "placeholder": "e.g. Fashion & Apparel", "required": False},
    {"key": "location", "label": "Location / target market", "placeholder": "e.g. Surat, selling across India", "required": False},
    {"key": "price_range", "label": "Price range", "placeholder": "e.g. ₹800–₹2500", "required": False},
    {"key": "competitors", "label": "Competitors (optional)", "placeholder": "Names or URLs, comma separated", "required": False},
    {"key": "goal", "label": "What do you want from this research?", "placeholder": "e.g. Find my core audience and ad angles", "required": False},
]


def _greeting(website_url: str | None) -> str:
    site = f" I see you're working on {website_url}." if website_url else ""
    return (
        f"Hi! I'm Sutra, your consumer-research assistant.{site}\n\n"
        "You can either fill in the quick template so I have solid context to "
        "start from, or just tell me about your business in your own words and "
        "we'll figure it out together. If you shared a website, I'll use the "
        "public pages I can read as extra context."
    )


def start_session(
    db: Session,
    user_email: str | None,
    user_name: str | None,
    website_url: str | None,
    mode: str | None,
) -> models.ChatSession:
    """Create a new chat session and store the opening assistant greeting."""
    session = models.ChatSession(
        user_email=user_email,
        user_name=user_name,
        website_url=website_url,
        mode=mode,
        title="New research chat",
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    greeting = _greeting(website_url)
    db.add(models.ChatMessage(session_id=session.id, role="assistant", content=greeting))
    db.commit()

    return session, greeting


def _build_messages(session: models.ChatSession) -> List[dict]:
    """System prompt (+ any captured context) followed by the full history."""
    system = SYSTEM_PROMPT
    context_bits = []
    if session.website_url:
        context_bits.append(f"User's website: {session.website_url}")
        scraped_context = scraper_service.scrape_website(session.website_url)
        if scraped_context:
            context_bits.append(
                "Best-effort public website scrape. Use this only as context; "
                "do not claim it is complete or live market data:\n"
                f"{scraped_context}"
            )
        else:
            context_bits.append(
                "Website scrape was unavailable or returned very little text. "
                "Ask the user for product details instead of guessing."
            )
    if session.user_name:
        context_bits.append(f"User's name: {session.user_name}")
    if context_bits:
        system += "\n\nKnown context about this user:\n" + "\n".join(context_bits)

    messages = [{"role": "system", "content": system}]
    for m in session.messages:
        if m.role in ("user", "assistant"):
            messages.append({"role": m.role, "content": m.content})
    return messages


def send_message(db: Session, session_id: int, user_message: str):
    """
    Persist the user's message, call the AI with the full history, then persist
    and return the assistant's reply. Returns (session, reply) or raises.
    """
    session = db.query(models.ChatSession).filter(
        models.ChatSession.id == session_id
    ).first()
    if session is None:
        raise LookupError("Chat session not found.")

    # 1. Save the user's turn first so it's part of the history we send.
    db.add(models.ChatMessage(session_id=session.id, role="user", content=user_message))
    db.commit()
    db.refresh(session)

    # 2. Give the chat a title from the first real user message.
    if session.title in (None, "New research chat"):
        session.title = user_message[:60]
        db.commit()

    # 3. Build the full conversation and call the provider.
    messages = _build_messages(session)
    reply = ai_service.chat_completion(messages)

    # 4. Save the assistant's reply.
    db.add(models.ChatMessage(session_id=session.id, role="assistant", content=reply))
    db.commit()
    db.refresh(session)

    return session, reply
