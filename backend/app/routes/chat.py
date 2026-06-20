"""
chat.py
-------
Chatbot API routes.

  POST /api/chat/start           -> open a session, get greeting + template
  POST /api/chat/message         -> send a message, get the assistant reply
  GET  /api/chat/{id}/history    -> fetch the full conversation
  GET  /api/chat/template        -> just the intake template fields

Routes stay thin: persistence + AI orchestration live in chat_service.
"""

from fastapi import APIRouter, Depends, HTTPException
import requests
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.services import chat_service

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.get("/template", response_model=list[schemas.ChatTemplateField])
def get_template():
    """Return the optional structured intake template."""
    return [schemas.ChatTemplateField(**f) for f in chat_service.TEMPLATE_FIELDS]


@router.post("/start", response_model=schemas.ChatStartResponse)
def start_chat(payload: schemas.ChatStartRequest, db: Session = Depends(get_db)):
    """Open a new chat session (mock auth — any email/name is accepted)."""
    session, greeting = chat_service.start_session(
        db,
        user_email=payload.user_email,
        user_name=payload.user_name,
        website_url=payload.website_url,
        mode=payload.mode,
    )
    return schemas.ChatStartResponse(
        session_id=session.id,
        greeting=greeting,
        template_fields=[schemas.ChatTemplateField(**f) for f in chat_service.TEMPLATE_FIELDS],
    )


@router.post("/message", response_model=schemas.ChatSendResponse)
def send_message(payload: schemas.ChatSendRequest, db: Session = Depends(get_db)):
    """Send a user message and get the assistant's reply (multi-turn)."""
    try:
        session, reply = chat_service.send_message(db, payload.session_id, payload.message)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except requests.RequestException as exc:
        detail = "The configured AI provider request failed."
        if exc.response is not None:
            detail += f" Provider status: {exc.response.status_code}."
        raise HTTPException(status_code=502, detail=detail)

    return schemas.ChatSendResponse(session_id=session.id, reply=reply)


@router.get("/{session_id}/history", response_model=schemas.ChatHistoryResponse)
def get_history(session_id: int, db: Session = Depends(get_db)):
    """Return the full conversation for a session."""
    session = db.query(models.ChatSession).filter(
        models.ChatSession.id == session_id
    ).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found.")

    return schemas.ChatHistoryResponse(
        session_id=session.id,
        messages=[
            schemas.ChatMessageItem(role=m.role, content=m.content)
            for m in session.messages
        ],
    )
