# Sutra — Consumer Research API (Backend V1)

The backend for **Sutra**, the AI marketing platform for Indian SMEs and
startups. This service powers **Step 1 of the workflow: Consumer Research.**

It collects a business profile (and optional URLs), builds a clean business
context, optionally scrapes the business website, calls an **external AI API**
(OpenAI / OpenRouter / Gemini / Claude — switchable), and returns a **structured, estimated
consumer research report**.

> ⚠️ The report is an **estimated marketing research output**, not guaranteed
> factual market data. The AI is prompted to use cautious language ("likely
> audience", "estimated segment", "recommended targeting direction") and to
> lower its `confidence_score` when the input is thin.

---

## What this backend does (the flow)

1. **Receive** the research form: business details + optional URLs.
2. **Validate**: either a `business_description` **or** at least one URL must be
   provided (enforced by Pydantic).
3. **Save** the business profile → `businesses` table.
4. **Scrape** `website_url` if given (best-effort, via requests + BeautifulSoup).
5. **Build** a single clean `business_context` string from the form + scrape.
6. **Call the AI** (`AI_PROVIDER`) to generate the structured report (JSON only).
7. **Save** the report → `research_reports` table.
8. **Return** `business_id`, `report_id`, and `report_json`.

---

## Tech stack

FastAPI · Supabase PostgreSQL/Auth · SQLAlchemy · Alembic · Pydantic · python-dotenv ·
requests + BeautifulSoup · external AI API (OpenAI / OpenRouter / Gemini / Claude).

---

## Folder structure

```
backend/
  alembic/                       # versioned PostgreSQL schema migrations
  alembic.ini
  app/
    auth.py                      # verifies Supabase access tokens
    main.py                       # FastAPI app, CORS, /health, startup
    database.py                   # engine, session, Base, get_db
    models.py                     # businesses + research_reports tables
    schemas.py                    # Pydantic request/response + report shape
    routes/
      auth.py                     # GET /api/auth/me
      chat.py                     # owned research conversations
      research.py                 # POST /start, GET /{report_id}
      waitlist.py                 # public early-access signup
    services/
      scraper_service.py          # requests + BeautifulSoup scraping
      ai_service.py               # OpenAI / Gemini / Claude integration
      research_service.py         # orchestrates the full pipeline
  requirements.txt
  .env.example
  README.md
```

---

## Setup

```bash
cd backend

# 1. Create a virtual environment
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
#   then edit .env and set DATABASE_URL, Supabase, AI, and frontend values

# 4. Apply versioned database migrations
alembic upgrade head
```

### Environment variables

| Variable       | Required | Description                                              |
|----------------|----------|----------------------------------------------------------|
| `DATABASE_URL` | yes\*    | Supabase Session-pooler/PostgreSQL connection string.    |
| `SUPABASE_URL` | production | Supabase project URL used to verify users.              |
| `SUPABASE_PUBLISHABLE_KEY` | production | Public client key used by Supabase Auth.      |
| `AI_PROVIDER`  | yes      | `openai` \| `openrouter` \| `gemini` \| `claude`         |
| `AI_API_KEY`   | yes      | API key for the chosen provider (never hardcode it).     |
| `AI_MODEL`     | no       | Override the default model for the provider.             |
| `FRONTEND_URL` | no       | Allowed CORS origin (defaults to `*` in dev).            |

\*If `DATABASE_URL` is unset, the app uses a local `sutra_local.db` SQLite file
so you can run it immediately without Postgres.

---

## Run locally

```bash
uvicorn app.main:app --reload
```

- API root: `http://localhost:8000`
- Interactive docs (Swagger): `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`

Tables are created automatically on startup.

---

## API

### `GET /health`
Returns backend, database, and configured AI provider status.

```json
{ "status": "ok", "ai_provider": "openai", "database": "ok" }
```

### `POST /api/research/start`

**Example request body:**

```json
{
  "business_name": "Surat Threads",
  "industry": "Fashion & Apparel",
  "location": "Surat, Gujarat (selling pan-India)",
  "business_description": "Affordable handcrafted ethnic kurtas for women, made by local artisans in Surat. Sold online and through Instagram.",
  "website_url": "https://example.com",
  "instagram_url": "https://instagram.com/suratthreads",
  "linkedin_url": null,
  "competitor_urls": ["https://competitor1.com", "https://competitor2.com"]
}
```

> Validation: if you provide **no** URLs at all, `business_description` is
> required (and vice-versa). At least one source must be present.

**Example response body:**

```json
{
  "business_id": 1,
  "report_id": 1,
  "report_json": {
    "business_summary": "Surat Threads is an affordable D2C ethnic-wear brand...",
    "target_audience_overview": "The likely audience is value-conscious women...",
    "primary_segment": "Estimated segment: tier-2 women aged 24–34 seeking affordable ethnic wear",
    "secondary_segment": "Estimated segment: metro women buying festive/occasion wear",
    "age_groups": ["24-34", "35-44"],
    "demographic_analysis": "Likely skews female, tier-2 and tier-3 cities...",
    "socioeconomic_analysis": "Likely middle-income households, price-sensitive...",
    "behavioral_analysis": "Likely discovers products via Instagram reels...",
    "buying_motivations": ["Affordability", "Trust in craftsmanship", "Festive occasions"],
    "pain_points": ["Sizing uncertainty online", "Delivery reliability"],
    "best_marketing_channels": ["Instagram Reels", "Meta Ads", "Regional creators"],
    "campaign_angles": ["\"Stitched in Surat, worn everywhere\"", "Festive drop urgency"],
    "confidence_score": "medium",
    "missing_information": ["Average price point", "Current customer locations", "Repeat purchase rate"],
    "recommended_follow_up_questions": [
      "What is your typical product price range?",
      "Which cities do most of your current orders come from?"
    ]
  }
}
```

### `GET /api/research/{report_id}`
Returns a previously saved report.

```json
{
  "report_id": 1,
  "business_id": 1,
  "created_at": "2026-06-14T10:30:00",
  "report_json": { "...": "same shape as above" }
}
```

---

## Database tables

The initial production migration creates:

- **profiles** — application profile tied to `auth.users`.
- **businesses** — one business per user in V1.
- **research_sessions** and **chat_messages** — resumable owned conversations.
- **research_sources** — submitted URLs, scrape state, extracted text and hashes.
- **research_reports** — versioned JSON reports linked to businesses and sessions.
- **waitlist_signups** and **consent_events** — early access and consent history.

All application tables have Row Level Security enabled. Browser code uses
Supabase for authentication; application data goes through FastAPI, which
verifies the bearer token and applies ownership checks.

Create future schema changes with Alembic rather than `create_all`:

```bash
alembic revision --autogenerate -m "describe the change"
alembic upgrade head
alembic check
```

---

## Switching AI providers

Change two env vars — no code changes:

```env
AI_PROVIDER=claude
AI_API_KEY=sk-ant-...
```

`ai_service.py` routes to the right provider (OpenAI Chat Completions, Gemini
`generateContent`, or Anthropic Messages) and parses the JSON response robustly.

---

## Notes

- API keys live only in `.env` (git-ignored). `.env.example` ships placeholders.
- Website scraping is best-effort: any failure returns empty text and the flow
  continues using the typed description.
- This is **Backend V1** — synchronous request/response, no auth, no job queue.
```
