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
from typing import List, Optional

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
