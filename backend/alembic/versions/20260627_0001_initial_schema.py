"""Create Sutra's initial production schema.

Revision ID: 20260627_0001
Revises:
Create Date: 2026-06-27
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260627_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


NOW = sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("status", sa.String(32), server_default="active", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'disabled', 'deletion_requested')",
            name="ck_profiles_status",
        ),
        sa.ForeignKeyConstraint(["id"], ["auth.users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_profiles_email", "profiles", ["email"])

    op.create_table(
        "businesses",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "business_name",
            sa.String(255),
            server_default="Untitled business",
            nullable=False,
        ),
        sa.Column("industry", sa.String(255), nullable=True),
        sa.Column("location", sa.String(255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("website_url", sa.String(2048), nullable=True),
        sa.Column("instagram_url", sa.String(2048), nullable=True),
        sa.Column("linkedin_url", sa.String(2048), nullable=True),
        sa.Column(
            "competitor_urls",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_businesses_user_id", "businesses", ["user_id"])

    op.create_table(
        "research_sessions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("business_id", sa.BigInteger(), nullable=False),
        sa.Column("website_url", sa.String(2048), nullable=True),
        sa.Column("mode", sa.String(32), server_default="free", nullable=False),
        sa.Column(
            "title",
            sa.String(255),
            server_default="New research chat",
            nullable=False,
        ),
        sa.Column("stage", sa.String(32), server_default="intake", nullable=False),
        sa.Column("status", sa.String(32), server_default="active", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint("mode IN ('template', 'free')", name="ck_research_sessions_mode"),
        sa.CheckConstraint(
            "stage IN ('intake', 'clarifying', 'ready_for_report', "
            "'report_generated', 'creative_options')",
            name="ck_research_sessions_stage",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'archived')",
            name="ck_research_sessions_status",
        ),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_research_sessions_business_id", "research_sessions", ["business_id"])
    op.create_index("ix_research_sessions_user_id", "research_sessions", ["user_id"])
    op.create_index(
        "ix_research_sessions_user_updated",
        "research_sessions",
        ["user_id", "updated_at"],
    )

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint(
            "role IN ('user', 'assistant', 'system')",
            name="ck_chat_messages_role",
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["research_sessions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_messages_session_id", "chat_messages", ["session_id"])

    op.create_table(
        "research_sources",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("business_id", sa.BigInteger(), nullable=False),
        sa.Column("session_id", sa.BigInteger(), nullable=True),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("scrape_status", sa.String(32), server_default="pending", nullable=False),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("extracted_summary", sa.Text(), nullable=True),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "source_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint(
            "source_type IN ('website', 'instagram', 'linkedin', 'competitor', 'manual')",
            name="ck_research_sources_type",
        ),
        sa.CheckConstraint(
            "scrape_status IN ('pending', 'processing', 'complete', 'failed', 'blocked')",
            name="ck_research_sources_status",
        ),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["research_sessions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "url", name="uq_research_sources_session_url"),
    )
    op.create_index("ix_research_sources_business_id", "research_sources", ["business_id"])
    op.create_index("ix_research_sources_content_hash", "research_sources", ["content_hash"])
    op.create_index("ix_research_sources_session_id", "research_sources", ["session_id"])

    op.create_table(
        "research_reports",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("business_id", sa.BigInteger(), nullable=False),
        sa.Column("session_id", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(32), server_default="complete", nullable=False),
        sa.Column("report_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "source_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("ai_provider", sa.String(64), nullable=True),
        sa.Column("ai_model", sa.String(255), nullable=True),
        sa.Column(
            "prompt_version",
            sa.String(64),
            server_default="research-v1",
            nullable=False,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('queued', 'generating', 'complete', 'failed')",
            name="ck_research_reports_status",
        ),
        sa.ForeignKeyConstraint(["business_id"], ["businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["research_sessions.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_research_reports_business_id", "research_reports", ["business_id"])
    op.create_index(
        "ix_research_reports_business_created",
        "research_reports",
        ["business_id", "created_at"],
    )
    op.create_index("ix_research_reports_session_id", "research_reports", ["session_id"])

    op.create_table(
        "waitlist_signups",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("company_website", sa.String(2048), nullable=True),
        sa.Column("status", sa.String(32), server_default="pending", nullable=False),
        sa.Column("marketing_consent", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("consented_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'invited', 'joined', 'unsubscribed')",
            name="ck_waitlist_signups_status",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_waitlist_signups_email", "waitlist_signups", ["email"])

    op.create_table(
        "consent_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("waitlist_signup_id", sa.BigInteger(), nullable=True),
        sa.Column("consent_type", sa.String(64), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("policy_version", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint(
            "(user_id IS NOT NULL) <> (waitlist_signup_id IS NOT NULL)",
            name="ck_consent_events_one_subject",
        ),
        sa.CheckConstraint(
            "action IN ('granted', 'withdrawn')",
            name="ck_consent_events_action",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["waitlist_signup_id"],
            ["waitlist_signups.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_consent_events_user_id", "consent_events", ["user_id"])
    op.create_index(
        "ix_consent_events_waitlist_signup_id",
        "consent_events",
        ["waitlist_signup_id"],
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.set_updated_at()
        RETURNS trigger
        LANGUAGE plpgsql
        SET search_path = ''
        AS $$
        BEGIN
          NEW.updated_at = now();
          RETURN NEW;
        END;
        $$;
        """
    )
    for table in ("profiles", "businesses", "research_sessions", "research_sources", "waitlist_signups"):
        op.execute(
            f"""
            CREATE TRIGGER set_{table}_updated_at
            BEFORE UPDATE ON public.{table}
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
            """
        )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
        RETURNS trigger
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = ''
        AS $$
        BEGIN
          INSERT INTO public.profiles (id, email, full_name)
          VALUES (
            NEW.id,
            NEW.email,
            COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name')
          )
          ON CONFLICT (id) DO NOTHING;
          RETURN NEW;
        END;
        $$;

        CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
        """
    )

    # Browser code uses Supabase only for Auth in V1. App data goes through
    # FastAPI, so RLS is enabled with no browser-facing policies yet.
    for table in (
        "profiles",
        "businesses",
        "research_sessions",
        "chat_messages",
        "research_sources",
        "research_reports",
        "waitlist_signups",
        "consent_events",
    ):
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"REVOKE ALL ON TABLE public.{table} FROM anon, authenticated")


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users")
    op.execute("DROP FUNCTION IF EXISTS public.handle_new_auth_user()")
    op.execute("DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE")

    op.drop_table("consent_events")
    op.drop_table("waitlist_signups")
    op.drop_table("research_reports")
    op.drop_table("research_sources")
    op.drop_table("chat_messages")
    op.drop_table("research_sessions")
    op.drop_table("businesses")
    op.drop_table("profiles")
