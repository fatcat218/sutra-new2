"""
research.py
-----------
The research API routes.

  POST /api/research/start   -> run the full pipeline, return ids + report
  GET  /api/research/{id}    -> fetch a saved report

Routes stay thin: validation is handled by Pydantic schemas, and the heavy
lifting is delegated to research_service.
"""

from fastapi import APIRouter, Depends, HTTPException
import requests
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.services import research_service

router = APIRouter(prefix="/api/research", tags=["research"])


@router.post("/start", response_model=schemas.ResearchStartResponse)
def start_research(
    payload: schemas.ResearchStartRequest,
    db: Session = Depends(get_db),
):
    """
    Accept business details + optional URLs, validate, scrape, call the AI,
    save everything, and return business_id, report_id, and the report JSON.

    Pydantic already enforced "description OR >=1 URL" before we get here.
    """
    try:
        business, report, report_data = research_service.run_research(db, payload)
    except RuntimeError as exc:
        # Misconfiguration or AI/parse failure -> 502 (upstream/our config issue).
        raise HTTPException(status_code=502, detail=str(exc))
    except requests.RequestException as exc:
        detail = "The configured AI provider request failed."
        if exc.response is not None:
            detail += f" Provider status: {exc.response.status_code}."
        raise HTTPException(status_code=502, detail=detail)

    return schemas.ResearchStartResponse(
        business_id=business.id,
        report_id=report.id,
        report_json=report_data,
    )


@router.get("/{report_id}", response_model=schemas.ReportResponse)
def get_report(report_id: int, db: Session = Depends(get_db)):
    """Return a previously generated research report by its id."""
    report = db.query(models.ResearchReport).filter(
        models.ResearchReport.id == report_id
    ).first()

    if report is None:
        raise HTTPException(status_code=404, detail="Report not found.")

    return schemas.ReportResponse(
        report_id=report.id,
        business_id=report.business_id,
        created_at=report.created_at,
        report_json=schemas.ResearchReportData(**report.report_json),
    )
