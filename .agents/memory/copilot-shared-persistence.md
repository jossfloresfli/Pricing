---
name: Copilot shared persistence
description: Copilot quote store and daily quotas live in shared Postgres, not memory/SQLite
---

- Copilot pre-quotes persist in Postgres table `copilot_quotes` (key `quoteId::rutaId`, TTL 1h via `expires_at`, lazy cleanup); the old in-memory Map is gone. Never accept costs from the browser — always re-read from this table.
- Daily copilot quotas (generation + embeddings) use `copilot_usage` in Postgres with a `scope` column, via `PostgresUsageBudget` in the orchestrator's copilot `budget.py`; concurrency handled with `pg_advisory_xact_lock` per user/day/scope.
- **Why:** Replit deployments restart/replace local files; SQLite and in-memory stores are per-replica and lost on restart (see orchestrator docs/copilot/ESCALAMIENTO_Y_OPERACION.md).
- **How to apply:** the Python side falls back to SQLite only when `DATABASE_URL` is unset (single-process dev). Python uses `psycopg[binary]`. The `copilot_usage` table is defined both in `shared/schema.ts` (drizzle) and via `CREATE TABLE IF NOT EXISTS` in Python — keep them in sync.
