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
from sqlalchemy import func
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
        created_at=report.created_at,
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


def _get_owned_session(
    db: Session, session_id: int, user_id
) -> models.ChatSession:
    """Fetch a session that belongs to the given user, or raise 404."""
    session = (
        db.query(models.ChatSession)
        .filter(
            models.ChatSession.id == session_id,
            models.ChatSession.user_id == user_id,
        )
        .first()
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    return session


@router.get("/sessions", response_model=schemas.ChatSessionsResponse)
def list_sessions(
    db: Session = Depends(get_db),
    profile: models.Profile = Depends(get_current_profile),
):
    """
    List the user's resumable research conversations, newest first, enriched
    with Research Library metadata (message count, preview, report status,
    source count).
    """
    sessions = (
        db.query(models.ChatSession)
        .filter(models.ChatSession.user_id == profile.id)
        .order_by(models.ChatSession.updated_at.desc())
        .all()
    )
    session_ids = [s.id for s in sessions]

    message_counts: dict[int, int] = {}
    source_counts: dict[int, int] = {}
    previews: dict[int, str] = {}
    latest_reports: dict[int, tuple[int, str]] = {}

    if session_ids:
        for sid, count in (
            db.query(models.ChatMessage.session_id, func.count(models.ChatMessage.id))
            .filter(models.ChatMessage.session_id.in_(session_ids))
            .group_by(models.ChatMessage.session_id)
            .all()
        ):
            message_counts[sid] = count

        for sid, count in (
            db.query(models.ResearchSource.session_id, func.count(models.ResearchSource.id))
            .filter(models.ResearchSource.session_id.in_(session_ids))
            .group_by(models.ResearchSource.session_id)
            .all()
        ):
            source_counts[sid] = count

        # Latest non-system message per session -> preview text.
        last_message_ids = (
            db.query(func.max(models.ChatMessage.id))
            .filter(
                models.ChatMessage.session_id.in_(session_ids),
                models.ChatMessage.role != "system",
            )
            .group_by(models.ChatMessage.session_id)
            .all()
        )
        ids = [row[0] for row in last_message_ids]
        if ids:
            for message in (
                db.query(models.ChatMessage)
                .filter(models.ChatMessage.id.in_(ids))
                .all()
            ):
                text = " ".join((message.content or "").split())
                previews[message.session_id] = (
                    text[:157] + "…" if len(text) > 160 else text
                )

        # Latest report per session (id + status).
        for report in (
            db.query(models.ResearchReport)
            .filter(models.ResearchReport.session_id.in_(session_ids))
            .order_by(models.ResearchReport.session_id, models.ResearchReport.id)
            .all()
        ):
            latest_reports[report.session_id] = (report.id, report.status)

    return schemas.ChatSessionsResponse(
        sessions=[
            schemas.ChatSessionSummary(
                session_id=session.id,
                title=session.title,
                stage=session.stage,
                status=session.status,
                created_at=session.created_at,
                updated_at=session.updated_at,
                message_count=message_counts.get(session.id, 0),
                preview=previews.get(session.id),
                report_id=latest_reports.get(session.id, (None, None))[0],
                report_status=latest_reports.get(session.id, (None, None))[1],
                source_count=source_counts.get(session.id, 0),
            )
            for session in sessions
        ]
    )


@router.patch("/{session_id}", response_model=schemas.ChatSessionSummary)
def rename_session(
    session_id: int,
    payload: schemas.SessionRenameRequest,
    db: Session = Depends(get_db),
    profile: models.Profile = Depends(get_current_profile),
):
    """Rename one of the user's research sessions."""
    session = _get_owned_session(db, session_id, profile.id)
    session.title = payload.title.strip()
    db.commit()
    db.refresh(session)
    return schemas.ChatSessionSummary(
        session_id=session.id,
        title=session.title,
        stage=session.stage,
        status=session.status,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.delete("/{session_id}", response_model=schemas.SessionDeleteResponse)
def delete_session(
    session_id: int,
    db: Session = Depends(get_db),
    profile: models.Profile = Depends(get_current_profile),
):
    """
    Delete a session together with its messages, sources, and reports.
    Messages and sources cascade via their FKs; reports would otherwise be
    orphaned (FK is SET NULL), so they are deleted explicitly here.
    """
    session = _get_owned_session(db, session_id, profile.id)

    deleted_messages = (
        db.query(models.ChatMessage)
        .filter(models.ChatMessage.session_id == session.id)
        .delete(synchronize_session=False)
    )
    deleted_sources = (
        db.query(models.ResearchSource)
        .filter(models.ResearchSource.session_id == session.id)
        .delete(synchronize_session=False)
    )
    deleted_reports = (
        db.query(models.ResearchReport)
        .filter(models.ResearchReport.session_id == session.id)
        .delete(synchronize_session=False)
    )
    db.query(models.ChatSession).filter(
        models.ChatSession.id == session.id
    ).delete(synchronize_session=False)
    db.commit()

    return schemas.SessionDeleteResponse(
        status="deleted",
        session_id=session_id,
        deleted_messages=deleted_messages,
        deleted_sources=deleted_sources,
        deleted_reports=deleted_reports,
    )


@router.get("/{session_id}/sources", response_model=schemas.SessionSourcesResponse)
def get_session_sources(
    session_id: int,
    db: Session = Depends(get_db),
    profile: models.Profile = Depends(get_current_profile),
):
    """Return the saved research sources captured for one of the user's sessions."""
    session = _get_owned_session(db, session_id, profile.id)
    sources = (
        db.query(models.ResearchSource)
        .filter(models.ResearchSource.session_id == session.id)
        .order_by(models.ResearchSource.id)
        .all()
    )
    return schemas.SessionSourcesResponse(
        session_id=session.id,
        sources=[
            schemas.ResearchSourceItem(
                source_id=source.id,
                source_type=source.source_type,
                url=source.url,
                scrape_status=source.scrape_status,
                extracted_summary=source.extracted_summary,
                error_message=source.error_message,
                fetched_at=source.fetched_at,
                created_at=source.created_at,
            )
            for source in sources
        ],
    )


@router.get("/{session_id}/report", response_model=schemas.SessionReportResponse)
def get_session_report(
    session_id: int,
    db: Session = Depends(get_db),
    profile: models.Profile = Depends(get_current_profile),
):
    """Return the latest generated report for one of the user's sessions."""
    session = _get_owned_session(db, session_id, profile.id)
    report = (
        db.query(models.ResearchReport)
        .filter(
            models.ResearchReport.session_id == session.id,
            models.ResearchReport.status == "complete",
        )
        .order_by(models.ResearchReport.id.desc())
        .first()
    )
    if report is None or not report.report_json:
        raise HTTPException(
            status_code=404, detail="No generated report for this session yet."
        )
    return schemas.SessionReportResponse(
        session_id=session.id,
        report_id=report.id,
        status=report.status,
        created_at=report.created_at,
        report_json=schemas.ResearchReportData(**report.report_json),
    )
