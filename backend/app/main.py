"""
main.py
-------
FastAPI application entry point.

  - Loads env vars (via database.py -> dotenv).
  - Creates DB tables on startup.
  - Enables CORS so the Sutra frontend (FRONTEND_URL) can call the API.
  - Mounts the research routes and a /health check.

Run locally:
    uvicorn app.main:app --reload
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.database import engine, init_db
from app.routes import chat, research
from app.schemas import HealthResponse

app = FastAPI(
    title="Sutra — Consumer Research API",
    description="Backend V1: generates estimated consumer/audience research for Indian SMEs and startups.",
    version="1.0.0",
)

# CORS: allow configured origins plus both common local development hosts.
_frontend = os.getenv("FRONTEND_URL", "*")
if _frontend == "*":
    _origins = ["*"]
    _allow_credentials = False
else:
    _origins = [origin.strip() for origin in _frontend.split(",") if origin.strip()]
    _origins.extend(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])
    # Local IDE previews may use a different localhost port.
    _origins.append("null")  # file:// during quick local previews
    _origins = list(dict.fromkeys(_origins))
    _allow_credentials = True

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$",
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _on_startup():
    """Create tables if they don't exist yet."""
    init_db()


# Mount the research routes (POST /api/research/start, GET /api/research/{id}).
app.include_router(research.router)
# Mount the chatbot routes (POST /api/chat/start, /api/chat/message, ...).
app.include_router(chat.router)


@app.get("/health", response_model=HealthResponse, tags=["health"])
def health():
    """Report backend + database status and the configured AI provider."""
    db_status = "ok"
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        db_status = "unavailable"

    return HealthResponse(
        status="ok",
        ai_provider=os.getenv("AI_PROVIDER", "openai"),
        database=db_status,
    )
