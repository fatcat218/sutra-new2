"""
models.py
---------
SQLAlchemy ORM models = the database tables.

Two tables:
  - businesses        : the profile the user submits on the research page.
  - research_reports  : the AI-generated report, stored as JSON, linked to a
                        business by business_id.

competitor_urls is stored as JSON (a list of strings) so we don't need a
separate join table for V1.
"""

from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class Business(Base):
    __tablename__ = "businesses"

    id = Column(Integer, primary_key=True, index=True)
    business_name = Column(String(255), nullable=False)
    industry = Column(String(255), nullable=True)
    location = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)

    website_url = Column(String(512), nullable=True)
    instagram_url = Column(String(512), nullable=True)
    linkedin_url = Column(String(512), nullable=True)
    # List of competitor URLs, stored as a JSON array.
    competitor_urls = Column(JSON, nullable=True, default=list)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # One business can have many reports (re-runs over time).
    reports = relationship(
        "ResearchReport",
        back_populates="business",
        cascade="all, delete-orphan",
    )


class ResearchReport(Base):
    __tablename__ = "research_reports"

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(
        Integer, ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The full structured report returned by the AI, kept as JSON.
    report_json = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    business = relationship("Business", back_populates="reports")
