"""
schemas.py
----------
Pydantic models = the request/response contracts for the API.

Three groups:
  1. ResearchStartRequest  -> validates the onboarding/research form input,
     including the rule: "description OR at least one URL is required".
  2. ResearchReportData     -> the structured shape of the AI report. The AI is
     asked to return exactly these fields. We keep them permissive (Optional /
     defaults) so a slightly imperfect AI response never crashes the API.
  3. ResearchStartResponse / ReportResponse -> what the endpoints return.
"""

from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl, model_validator


# --------------------------------------------------------------------------- #
# 1. INPUT
# --------------------------------------------------------------------------- #
class ResearchStartRequest(BaseModel):
    business_name: str = Field(..., min_length=1, max_length=255)
    industry: Optional[str] = Field(None, max_length=255)
    location: Optional[str] = Field(None, max_length=255)
    business_description: Optional[str] = Field(None, description="Free-text description of the business")

    website_url: Optional[HttpUrl] = None
    instagram_url: Optional[HttpUrl] = None
    linkedin_url: Optional[HttpUrl] = None
    competitor_urls: List[HttpUrl] = Field(default_factory=list)

    @model_validator(mode="after")
    def _require_description_or_url(self):
        """
        Business rule: if no URL/source of any kind is provided, the user MUST
        provide a business description.
        """
        has_any_url = any(
            [
                self.website_url,
                self.instagram_url,
                self.linkedin_url,
                len(self.competitor_urls) > 0,
            ]
        )
        has_description = bool(self.business_description and self.business_description.strip())

        if not has_any_url and not has_description:
            raise ValueError(
                "Provide at least a business_description or one URL "
                "(website_url, instagram_url, linkedin_url, or competitor_urls)."
            )
        return self


# --------------------------------------------------------------------------- #
# 2. THE STRUCTURED AI REPORT
# --------------------------------------------------------------------------- #
class ResearchReportData(BaseModel):
    """
    The exact shape we ask the AI to return, and validate against.
    Everything is Optional with sane defaults so a partial AI response is
    coerced rather than rejected.
    """

    dashboard_headline: Optional[str] = None
    targeting_effectiveness_summary: Optional[str] = None
    targeting_score: Optional[float] = Field(None, ge=0, le=100)
    key_audience_segments: List[str] = Field(default_factory=list)
    market_opportunity_summary: Optional[str] = None
    actionable_recommendations: List[str] = Field(default_factory=list)
    engagement_patterns: List[str] = Field(default_factory=list)
    behavioral_trends: List[str] = Field(default_factory=list)
    market_opportunities: List[str] = Field(default_factory=list)

    business_summary: Optional[str] = None
    target_audience_overview: Optional[str] = None
    primary_segment: Optional[str] = None
    secondary_segment: Optional[str] = None
    age_groups: List[str] = Field(default_factory=list)
    demographic_analysis: Optional[str] = None
    socioeconomic_analysis: Optional[str] = None
    behavioral_analysis: Optional[str] = None
    buying_motivations: List[str] = Field(default_factory=list)
    pain_points: List[str] = Field(default_factory=list)
    best_marketing_channels: List[str] = Field(default_factory=list)
    campaign_angles: List[str] = Field(default_factory=list)
    # low | medium | high
    confidence_score: Optional[str] = None
    missing_information: List[str] = Field(default_factory=list)
    recommended_follow_up_questions: List[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# 3. OUTPUT
# --------------------------------------------------------------------------- #
class ResearchStartResponse(BaseModel):
    business_id: int
    report_id: int
    report_json: ResearchReportData


class ReportResponse(BaseModel):
    report_id: int
    business_id: int
    created_at: datetime
    report_json: ResearchReportData

    class Config:
        from_attributes = True


class HealthResponse(BaseModel):
    status: str
    ai_provider: str
    database: str


class AuthMeResponse(BaseModel):
    id: UUID
    email: str
    full_name: Optional[str] = None
    language_preference: str
    status: str
    deletion_requested_at: Optional[datetime] = None
    created_at: datetime


SupportedLanguage = Literal["en", "hi", "bn", "ta", "te", "mr", "gu", "kn", "ml", "pa"]


class AccountPreferenceUpdateRequest(BaseModel):
    language_preference: SupportedLanguage


class AccountActionResponse(BaseModel):
    status: str
    message: str


class HistoryClearResponse(AccountActionResponse):
    deleted_sessions: int
    deleted_messages: int
    deleted_sources: int
    deleted_reports: int


class WaitlistSignupRequest(BaseModel):
    full_name: Optional[str] = Field(None, max_length=255)
    email: str = Field(..., min_length=3, max_length=320)
    company_website: Optional[HttpUrl] = None
    marketing_consent: bool = False
    policy_version: str = Field("privacy-v1", min_length=1, max_length=64)

    @model_validator(mode="after")
    def _validate_email_shape(self):
        value = self.email.strip()
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("Enter a valid email address.")
        return self


class WaitlistSignupResponse(BaseModel):
    signup_id: int
    status: str
    message: str


# --------------------------------------------------------------------------- #
# 4. CHATBOT
# --------------------------------------------------------------------------- #
class ChatTemplateField(BaseModel):
    key: str
    label: str
    placeholder: str
    required: bool = False


class ChatStartRequest(BaseModel):
    """Open a research session for the authenticated user."""

    # Kept temporarily for backwards-compatible clients. The backend ignores
    # these identity fields and always trusts the verified Supabase token.
    user_email: Optional[str] = Field(None, max_length=255)
    user_name: Optional[str] = Field(None, max_length=255)
    website_url: Optional[str] = Field(None, max_length=2048)
    mode: Optional[str] = Field(None, max_length=32)  # "template" | "free"


class ChatMessageItem(BaseModel):
    role: str
    content: str

    class Config:
        from_attributes = True


class ChatStartResponse(BaseModel):
    session_id: int
    greeting: str
    template_fields: List[ChatTemplateField]
    stage: str = "intake"  # current conversation stage (Feature 1)


class ChatSendRequest(BaseModel):
    session_id: int
    message: str = Field(..., min_length=1)


class ChatSendResponse(BaseModel):
    session_id: int
    reply: str
    stage: str = "clarifying"  # updated conversation stage (Feature 1)


class ChatHistoryResponse(BaseModel):
    session_id: int
    messages: List[ChatMessageItem]


class ChatSessionSummary(BaseModel):
    session_id: int
    title: str
    stage: str
    status: str
    created_at: datetime
    updated_at: datetime


class ChatSessionsResponse(BaseModel):
    sessions: List[ChatSessionSummary]


class ChatReportResponse(BaseModel):
    """Response for POST /api/chat/{id}/generate-report (Feature 2)."""

    session_id: int
    report_id: int
    business_id: int
    stage: str
    # Reuses the existing structured report shape.
    report_json: ResearchReportData
