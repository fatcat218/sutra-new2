"""SQLAlchemy models for Sutra's production data model."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")
UUID_TYPE = PGUUID(as_uuid=True)


class Profile(Base):
    """Application profile linked one-to-one to a Supabase Auth user."""

    __tablename__ = "profiles"

    # The database migration enforces this FK against auth.users(id). It is not
    # declared here because auth.users is managed outside this SQLAlchemy metadata.
    id = Column(UUID_TYPE, primary_key=True)
    email = Column(String(320), nullable=False)
    full_name = Column(String(255), nullable=True)
    language_preference = Column(String(16), nullable=False, default="en")
    status = Column(String(32), nullable=False, default="active")
    deletion_requested_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    businesses = relationship("Business", back_populates="owner", cascade="all, delete-orphan")
    sessions = relationship("ChatSession", back_populates="user", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("status IN ('active', 'disabled', 'deletion_requested')", name="ck_profiles_status"),
        UniqueConstraint("email"),
        Index("ix_profiles_email", "email"),
    )


class Business(Base):
    """A user's business profile. V1 allows one business per user."""

    __tablename__ = "businesses"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(
        UUID_TYPE,
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    business_name = Column(String(255), nullable=False, default="Untitled business")
    industry = Column(String(255), nullable=True)
    location = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    website_url = Column(String(2048), nullable=True)
    instagram_url = Column(String(2048), nullable=True)
    linkedin_url = Column(String(2048), nullable=True)
    competitor_urls = Column(JSON_TYPE, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    owner = relationship("Profile", back_populates="businesses")
    sessions = relationship("ChatSession", back_populates="business", cascade="all, delete-orphan")
    reports = relationship("ResearchReport", back_populates="business", cascade="all, delete-orphan")
    sources = relationship("ResearchSource", back_populates="business", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("user_id"),
        Index("ix_businesses_user_id", "user_id"),
    )


class ChatSession(Base):
    """One resumable consumer-research conversation."""

    __tablename__ = "research_sessions"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(
        UUID_TYPE,
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    business_id = Column(
        BigInteger,
        ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    website_url = Column(String(2048), nullable=True)
    mode = Column(String(32), nullable=False, default="free")
    title = Column(String(255), nullable=False, default="New research chat")
    stage = Column(String(32), nullable=False, default="intake")
    status = Column(String(32), nullable=False, default="active")
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    user = relationship("Profile", back_populates="sessions")
    business = relationship("Business", back_populates="sessions")
    messages = relationship(
        "ChatMessage",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ChatMessage.id",
    )
    reports = relationship("ResearchReport", back_populates="session")
    sources = relationship("ResearchSource", back_populates="session", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("mode IN ('template', 'free')", name="ck_research_sessions_mode"),
        CheckConstraint(
            "stage IN ('intake', 'clarifying', 'ready_for_report', "
            "'report_generated', 'creative_options')",
            name="ck_research_sessions_stage",
        ),
        CheckConstraint("status IN ('active', 'archived')", name="ck_research_sessions_status"),
        Index("ix_research_sessions_user_updated", "user_id", "updated_at"),
    )


class ChatMessage(Base):
    """A persisted user or assistant turn."""

    __tablename__ = "chat_messages"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    session_id = Column(
        BigInteger,
        ForeignKey("research_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role = Column(String(32), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    session = relationship("ChatSession", back_populates="messages")

    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant', 'system')", name="ck_chat_messages_role"),
    )


class ResearchSource(Base):
    """Submitted and scraped context used during research."""

    __tablename__ = "research_sources"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    business_id = Column(
        BigInteger,
        ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id = Column(
        BigInteger,
        ForeignKey("research_sessions.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    source_type = Column(String(32), nullable=False)
    url = Column(String(2048), nullable=False)
    scrape_status = Column(String(32), nullable=False, default="pending")
    extracted_text = Column(Text, nullable=True)
    extracted_summary = Column(Text, nullable=True)
    content_hash = Column(String(64), nullable=True, index=True)
    http_status = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    source_metadata = Column(JSON_TYPE, nullable=False, default=dict)
    fetched_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    business = relationship("Business", back_populates="sources")
    session = relationship("ChatSession", back_populates="sources")

    __table_args__ = (
        CheckConstraint(
            "source_type IN ('website', 'instagram', 'linkedin', 'competitor', 'manual')",
            name="ck_research_sources_type",
        ),
        CheckConstraint(
            "scrape_status IN ('pending', 'processing', 'complete', 'failed', 'blocked')",
            name="ck_research_sources_status",
        ),
        UniqueConstraint("session_id", "url", name="uq_research_sources_session_url"),
    )


class ResearchReport(Base):
    """An immutable versioned research dashboard output."""

    __tablename__ = "research_reports"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    business_id = Column(
        BigInteger,
        ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id = Column(
        BigInteger,
        ForeignKey("research_sessions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status = Column(String(32), nullable=False, default="complete")
    report_json = Column(JSON_TYPE, nullable=True)
    source_snapshot = Column(JSON_TYPE, nullable=False, default=list)
    ai_provider = Column(String(64), nullable=True)
    ai_model = Column(String(255), nullable=True)
    prompt_version = Column(String(64), nullable=False, default="research-v1")
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    business = relationship("Business", back_populates="reports")
    session = relationship("ChatSession", back_populates="reports")

    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'generating', 'complete', 'failed')",
            name="ck_research_reports_status",
        ),
        Index("ix_research_reports_business_created", "business_id", "created_at"),
    )


class WaitlistSignup(Base):
    __tablename__ = "waitlist_signups"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    full_name = Column(String(255), nullable=True)
    email = Column(String(320), nullable=False)
    company_website = Column(String(2048), nullable=True)
    status = Column(String(32), nullable=False, default="pending")
    marketing_consent = Column(Boolean, nullable=False, default=False)
    consented_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'invited', 'joined', 'unsubscribed')",
            name="ck_waitlist_signups_status",
        ),
        UniqueConstraint("email"),
        Index("ix_waitlist_signups_email", "email"),
    )


class ConsentEvent(Base):
    """Append-only evidence of accepted or withdrawn consent."""

    __tablename__ = "consent_events"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(
        UUID_TYPE,
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    waitlist_signup_id = Column(
        BigInteger,
        ForeignKey("waitlist_signups.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    consent_type = Column(String(64), nullable=False)
    action = Column(String(32), nullable=False)
    policy_version = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "(user_id IS NOT NULL) <> (waitlist_signup_id IS NOT NULL)",
            name="ck_consent_events_one_subject",
        ),
        CheckConstraint("action IN ('granted', 'withdrawn')", name="ck_consent_events_action"),
    )
