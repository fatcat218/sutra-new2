# Sutra

Sutra is an AI marketing workspace for Indian SMEs and startups. This repo
contains:

- a static frontend landing/product experience
- a FastAPI backend for consumer research
- a Supabase-authenticated research chatbot and dashboard flow

## Project Structure

```text
.
├── index.html              # Main landing page
├── chatbot.html            # Combined Login/Signup gate + research workspace
├── chatbot.js              # Auth, chat, history, and report integration
├── research-library.html   # Research Library (manage saved research)
├── research-library.js     # Library search/sort/rename/delete/report logic
├── supabase-client.js      # Shared persistent browser auth client
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

The production data path uses Supabase PostgreSQL/Auth.

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
- Chatbot: http://localhost:3000/chatbot.html

## What Works Now

- The landing chat entry carries a prompt through authentication.
- Supabase sessions persist until logout.
- Unauthenticated chatbot visits show login/sign-up on the chatbot page.
- Login includes email-based password recovery and a dedicated reset page.
- Conversations and message history can be resumed.
- The backend generates and saves an estimated consumer research dashboard.

## Research Library

`research-library.html` (linked from the chatbot sidebar) lets each signed-in
user manage all of their saved research:

- Cards show the title, created/updated dates, a preview of the latest
  message, the message count, and the report status.
- Search by title or preview text; sort by newest or oldest.
- Open a conversation (resumes it in the chatbot), rename it, view its saved
  sources, open its generated dashboard, or delete it (with confirmation).
- Deleting a session also removes its messages, sources, and reports.
- Unauthenticated visitors are redirected to `chatbot.html` to log in.

Library API endpoints (all require a Supabase bearer token and only ever
return the authenticated user's own data):

| Method | Path                          | Purpose                                   |
| ------ | ----------------------------- | ----------------------------------------- |
| GET    | `/api/chat/sessions`          | List sessions + library metadata          |
| PATCH  | `/api/chat/{session_id}`      | Rename a session                          |
| DELETE | `/api/chat/{session_id}`      | Delete a session, its messages/sources/reports |
| GET    | `/api/chat/{session_id}/sources` | Saved research sources for a session   |
| GET    | `/api/chat/{session_id}/report`  | Latest generated report for a session  |

No extra setup is required beyond the existing backend `.env`; the library
uses the existing `research_sessions`, `chat_messages`, `research_sources`,
and `research_reports` tables.

## Important Security Notes

Do not commit:

- `backend/.env`
- `backend/sutra_local.db`
- `backend/.venv/`

Each developer should create their own `.env` from `.env.example` and use their
own AI provider key.
