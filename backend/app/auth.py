"""Supabase access-token verification for FastAPI."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional
from uuid import UUID

import jwt
import requests
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models
from app.database import get_db


bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthUser:
    id: UUID
    email: str
    full_name: Optional[str] = None
    session_id: Optional[UUID] = None


def _settings() -> tuple[str, str]:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    publishable_key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
    if not url or not publishable_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase Auth is not configured.",
        )
    return url, publishable_key


@lru_cache(maxsize=1)
def _jwks_client() -> PyJWKClient:
    url, _ = _settings()
    return PyJWKClient(
        f"{url}/auth/v1/.well-known/jwks.json",
        cache_keys=True,
        lifespan=300,
    )


def _claims_from_auth_server(token: str) -> dict:
    """Fallback for projects still using a shared-secret JWT signing key."""
    url, publishable_key = _settings()
    response = requests.get(
        f"{url}/auth/v1/user",
        headers={
            "apikey": publishable_key,
            "Authorization": f"Bearer {token}",
        },
        timeout=10,
    )
    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = response.json()
    unverified = jwt.decode(token, options={"verify_signature": False})
    return {
        "sub": user.get("id"),
        "email": user.get("email"),
        "user_metadata": user.get("user_metadata") or {},
        "session_id": unverified.get("session_id"),
    }


def _verify_token(token: str) -> dict:
    url, _ = _settings()
    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256", "EdDSA"],
            audience="authenticated",
            issuer=f"{url}/auth/v1",
            options={"require": ["exp", "iss", "sub"]},
        )
    except jwt.PyJWKClientError:
        return _claims_from_auth_server(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
) -> AuthUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    claims = _verify_token(credentials.credentials)
    metadata = claims.get("user_metadata") or {}
    user_id = claims.get("sub")
    email = claims.get("email")
    if not user_id or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="The authenticated account is missing an ID or email.",
        )

    try:
        parsed_id = UUID(str(user_id))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="The authenticated account ID is invalid.",
        ) from exc

    session_id = None
    if claims.get("session_id"):
        try:
            session_id = UUID(str(claims["session_id"]))
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="The authenticated session ID is invalid.",
            ) from exc

    return AuthUser(
        id=parsed_id,
        email=str(email).strip().lower(),
        full_name=metadata.get("full_name") or metadata.get("name"),
        session_id=session_id,
    )


def get_current_profile(
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> models.Profile:
    """Return the app profile, repairing it if an older Auth user lacks one."""
    if user.session_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="The authenticated session is missing its session ID.",
        )
    active_session = db.execute(
        text(
            "SELECT EXISTS ("
            "SELECT 1 FROM auth.sessions WHERE id = :session_id AND user_id = :user_id"
            ")"
        ),
        {"session_id": user.session_id, "user_id": user.id},
    ).scalar_one()
    if not active_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This session has ended. Sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    profile = db.query(models.Profile).filter(models.Profile.id == user.id).first()
    if profile is not None:
        return profile

    profile = models.Profile(id=user.id, email=user.email, full_name=user.full_name)
    db.add(profile)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        profile = db.query(models.Profile).filter(models.Profile.id == user.id).first()
        if profile is None:
            raise
    else:
        db.refresh(profile)
    return profile
