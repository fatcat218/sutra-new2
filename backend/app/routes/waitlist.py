"""Public early-access signup endpoint."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db


router = APIRouter(prefix="/api/waitlist", tags=["waitlist"])


@router.post("", response_model=schemas.WaitlistSignupResponse)
def join_waitlist(
    payload: schemas.WaitlistSignupRequest,
    db: Session = Depends(get_db),
):
    email = payload.email.strip().lower()
    signup = db.query(models.WaitlistSignup).filter(
        models.WaitlistSignup.email == email
    ).first()
    if signup is None:
        signup = models.WaitlistSignup(email=email)
        db.add(signup)

    signup.full_name = payload.full_name.strip() if payload.full_name else None
    signup.company_website = (
        str(payload.company_website) if payload.company_website else None
    )
    signup.marketing_consent = payload.marketing_consent
    if payload.marketing_consent and signup.consented_at is None:
        signup.consented_at = datetime.now(timezone.utc)

    db.flush()
    if payload.marketing_consent:
        existing_consent = (
            db.query(models.ConsentEvent)
            .filter(
                models.ConsentEvent.waitlist_signup_id == signup.id,
                models.ConsentEvent.consent_type == "marketing",
                models.ConsentEvent.action == "granted",
                models.ConsentEvent.policy_version == payload.policy_version,
            )
            .first()
        )
        if existing_consent is None:
            db.add(
                models.ConsentEvent(
                    waitlist_signup_id=signup.id,
                    consent_type="marketing",
                    action="granted",
                    policy_version=payload.policy_version,
                )
            )

    db.commit()
    db.refresh(signup)
    return schemas.WaitlistSignupResponse(
        signup_id=signup.id,
        status=signup.status,
        message="You're on the Sutra early-access list.",
    )
