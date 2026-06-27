"""
chat.py
-------
Chatbot API routes.

  POST /api/chat/start                   -> open a session, get greeting + template
  POST /api/chat/message                 -> send a message, get the assistant reply
  POST /api/chat/{id}/generate-report    -> build the final structured report
  GET  /api/chat/{id}/history            -> fetch the full conversation
  GET  /api/chat/template                -> just the intake template fields

Routes stay thin: persistence + AI orchestration live in chat_service.
"""

from fastapi import APIRouter, Depends, HTTPException
import requests
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import get_current_profile
from app.database import get_db
from app.services import chat_service

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.get("/template", response_model=list[schemas.ChatTemplateField])
def get_template():
    """Return the optional structured intake template."""
    return [schemas.ChatTemplateField(**f) for f in chat_service.TEMPLATE_FIELDS]


@router.post("/start", response_model=schemas.ChatStartResponse)
def start_chat(
    payload: schemas.ChatStartRequest,
    db: Session = Depends(get_db),
    profile: models.Profile = Depends(get_current_profile),
):
    """Open a new research session for the authenticated user."""
    session, greeting = chat_service.start_session(
        db,
        user_id=profile.id,
        user_email=profile.email,
        user_name=profile.full_name,
        website_url=payload.website_url,
        mode=payload.mode,
    )
    return schemas.ChatStartResponse(
        session_id=session.id,
        greeting=greeting,
        template_fields=[schemas.ChatTemplateField(**f) for f in chat_service.TEMPLATE_FIELDS],
        stage=session.stage,
    )


@router.post("/message", response_model=schemas.ChatSendResponse)
def send_message(
    payload: schemas.ChatSendRequest,
    db: Session = Depends(get_db),
    profile: models.Profile = Depends(get_current_profile),
):
    """Send a user message and get the assistant's reply (multi-turn)."""
    try:
        session, reply = chat_service.send_message(
            db,
            payload.session_id,
            profile.id,
            payload.message,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except requests.RequestException as exc:
        detail = "The configured AI provider request failed."
        if exc.response is not None:
            detail += f" Provider status: {exc.response.status_code}."
        raise HTTPException(status_code=502, detail=detail)

    return schemas.ChatSendResponse(session_id=session.id, reply=reply, stage=session.stage)


@router.post("/{session_id}/generate-report", response_model=schemas.ChatReportResponse)
def generate_report(
    session_id: int,
    db: Session = Depends(get_db),
    profile: models.Profile = Depends(get_current_profile),
):
    """
    Generate the final structured research report from the whole conversation,
    persist it, and advance the session to the report_generated stage.
    """
    try:
        session, business, report, report_data = chat_service.generate_report(
            db,
            session_id,
            profile.id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        # Misconfiguration or AI/parse failure -> 502 (upstream/our config issue).
        raise HTTPException(status_code=502, detail=str(exc))
    except requests.RequestException as exc:
        detail = "The configured AI provider request failed."
        if exc.response is not None:
            detail += f" Provider status: {exc.response.status_code}."
        raise HTTPException(status_code=502, detail=detail)

    return schemas.ChatReportResponse(
        session_id=session.id,
        report_id=report.id,
        business_id=business.id,
        stage=session.stage,
        report_json=report_data,
    )


@router.get("/{session_id}/history", response_model=schemas.ChatHistoryResponse)
def get_history(
    session_id: int,
    db: Session = Depends(get_db),
    profile: models.Profile = Depends(get_current_profile),
):
    """Return the full conversation for a session."""
    session = db.query(models.ChatSession).filter(
        models.ChatSession.id == session_id,
        models.ChatSession.user_id == profile.id,
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


@router.get("/sessions", response_model=schemas.ChatSessionsResponse)
def list_sessions(
    db: Session = Depends(get_db),
    profile: models.Profile = Depends(get_current_profile),
):
    """List the user's resumable research conversations, newest first."""
    sessions = (
        db.query(models.ChatSession)
        .filter(models.ChatSession.user_id == profile.id)
        .order_by(models.ChatSession.updated_at.desc())
        .all()
    )
    return schemas.ChatSessionsResponse(
        sessions=[
            schemas.ChatSessionSummary(
                session_id=session.id,
                title=session.title,
                stage=session.stage,
                status=session.status,
                created_at=session.created_at,
                updated_at=session.updated_at,
            )
            for session in sessions
        ]
    )
