# Sutra

Sutra is an AI marketing workspace for Indian SMEs and startups. This repo
contains:

- a static frontend landing/product experience
- a FastAPI backend for consumer research
- a working research-to-video-brief flow

## Project Structure

```text
.
├── index.html              # Main landing page
├── research.html           # Consumer Research product page
├── research.js             # Frontend API integration and report rendering
├── main.js                 # Shared animations/interactions
├── style.css               # Site styling
└── backend/
    ├── app/                # FastAPI source
    ├── requirements.txt    # Python dependencies
    └── .env.example        # Local config template
```

## Prerequisites

- Python 3.9+
- An OpenRouter, OpenAI, Gemini, or Claude API key

The default local setup uses OpenRouter and SQLite.

## Backend Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env` and replace:

```env
AI_API_KEY=your_api_key_here
```

Then start the backend:

```bash
uvicorn app.main:app --reload
```

Useful backend URLs:

- Health: http://localhost:8000/health
- API docs: http://localhost:8000/docs

## Frontend Setup

Open a second terminal from the repo root:

```bash
python3 -m http.server 3000
```

Then open:

- Frontend: http://localhost:3000
- Research page: http://localhost:3000/research.html

## What Works Now

- The user can enter product/business details.
- The backend can generate an estimated consumer research report.
- The frontend displays the structured report.
- The user can choose a next creative format.
- The Video branch creates a frontend-only draft video direction from the report.
- Instagram ads, YouTube ads, and Posters are visible but intentionally disabled.

## Important Security Notes

Do not commit:

- `backend/.env`
- `backend/sutra_local.db`
- `backend/.venv/`

Each developer should create their own `.env` from `.env.example` and use their
own AI provider key.
