"""Authenticated profile and account-management endpoints."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import get_current_profile
from app.database import get_db


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/me", response_model=schemas.AuthMeResponse)
def get_me(profile: models.Profile = Depends(get_current_profile)):
    return schemas.AuthMeResponse(
        id=profile.id,
        email=profile.email,
        full_name=profile.full_name,
        language_preference=profile.language_preference,
        status=profile.status,
        deletion_requested_at=profile.deletion_requested_at,
        created_at=profile.created_at,
    )


@router.patch("/preferences", response_model=schemas.AuthMeResponse)
def update_preferences(
    payload: schemas.AccountPreferenceUpdateRequest,
    db: Session = Depends(get_db),
    profile: models.Profile = Depends(get_current_profile),
):
    profile.language_preference = payload.language_preference
    db.commit()
    db.refresh(profile)
    return schemas.AuthMeResponse(
        id=profile.id,
        email=profile.email,
        full_name=profile.full_name,
        language_preference=profile.language_preference,
        status=profile.status,
        deletion_requested_at=profile.deletion_requested_at,
        created_at=profile.created_at,
    )


@router.delete("/history", response_model=schemas.HistoryClearResponse)
def clear_history(
    db: Session = Depends(get_db),
    profile: models.Profile = Depends(get_current_profile),
):
    """Delete the user's conversations, source captures, and reports."""
    session_ids = [
        row[0]
        for row in db.query(models.ChatSession.id)
        .filter(models.ChatSession.user_id == profile.id)
        .all()
    ]
    business_ids = [
        row[0]
        for row in db.query(models.Business.id)
        .filter(models.Business.user_id == profile.id)
        .all()
    ]

    deleted_messages = 0
    if session_ids:
        deleted_messages = (
            db.query(models.ChatMessage)
            .filter(models.ChatMessage.session_id.in_(session_ids))
            .count()
        )

    deleted_reports = 0
    deleted_sources = 0
    if business_ids:
        deleted_reports = (
            db.query(models.ResearchReport)
            .filter(models.ResearchReport.business_id.in_(business_ids))
            .delete(synchronize_session=False)
        )
        deleted_sources = (
            db.query(models.ResearchSource)
            .filter(models.ResearchSource.business_id.in_(business_ids))
            .delete(synchronize_session=False)
        )

    deleted_sessions = (
        db.query(models.ChatSession)
        .filter(models.ChatSession.user_id == profile.id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return schemas.HistoryClearResponse(
        status="complete",
        message="Your research history has been cleared.",
        deleted_sessions=deleted_sessions,
        deleted_messages=deleted_messages,
        deleted_sources=deleted_sources,
        deleted_reports=deleted_reports,
    )


@router.post("/deletion-request", response_model=schemas.AccountActionResponse)
def request_account_deletion(
    db: Session = Depends(get_db),
    profile: models.Profile = Depends(get_current_profile),
):
    """Record an account deletion request without immediately destroying data."""
    if profile.deletion_requested_at is None:
        profile.deletion_requested_at = datetime.now(timezone.utc)
    profile.status = "deletion_requested"
    db.commit()
    return schemas.AccountActionResponse(
        status="deletion_requested",
        message="Your account deletion request has been recorded.",
    )
