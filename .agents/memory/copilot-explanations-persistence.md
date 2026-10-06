---
name: Copilot explanations persistence
description: How saved copilot explanations are identified, reused, and claim-locked in shared Postgres.
---

- Saved explanations live in `copilot_explanations` (shared Postgres). Identity = quote_id + ruta_id + model_key + pricing_hash (sha256 of a key-sorted stringify of the effective PricingResult). Same identity ⇒ reuse, zero tokens.
- **Why:** the prompt for the Copilot page mandates reuse without token cost and no duplicate generations under concurrent clicks.
- **How to apply:** generation is claimed atomically (INSERT … ON CONFLICT DO NOTHING, or failed→generating UPDATE). `generating` rows older than 5 min are considered orphaned and can be re-claimed atomically (lease on created_at) — never remove this or a crashed worker blocks the identity forever.
- Startup DDL for `copilot_quotes` and `copilot_explanations` is in `server/migrate.ts` (idempotent CREATE IF NOT EXISTS) because `npm run db:push` is interactive/unsafe here.
- Frontend flow: quote modal button navigates to `/copilot?quote=&ruta=&model=`; the page POSTs /api/copilot/explain keyed by those params (mutation reset on param change). List/detail are GET-only and never generate.
- Python copilot needs `psycopg` (in pyproject); if the venv missed a `uv sync`, health shows `copilot.available:false` with "No module named 'psycopg'".
