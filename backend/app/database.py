"""
database.py
-----------
Sets up the SQLAlchemy engine, the session factory, and the declarative Base
that all ORM models inherit from.

Flow:
  1. Read DATABASE_URL from the environment (loaded from .env via python-dotenv).
  2. Create a single Engine for the whole app (connection pool).
  3. SessionLocal is a factory that produces short-lived DB sessions.
  4. get_db() is a FastAPI dependency that yields a session per-request and
     always closes it afterwards.
"""

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Load variables from a local .env file (if present) into os.environ.
load_dotenv()

# Example: postgresql://user:password@localhost:5432/sutra
# Falls back to a local SQLite file so the app can boot for quick local testing
# even before Postgres is configured.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./sutra_local.db")

# SQLite needs a special connect arg when used with FastAPI's threaded server.
_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args=_connect_args)

# autoflush/autocommit off -> we control transactions explicitly in the services.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# All models subclass this Base.
Base = declarative_base()


def get_db():
    """FastAPI dependency: provide a DB session and guarantee it is closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create all tables. Called once on app startup (see main.py)."""
    # Import models here so they are registered on Base before create_all runs.
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
