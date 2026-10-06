---
name: Orchestrator route keys & history
description: Why route history shows 0 and how location canonicalization works in the ML orchestrator
---

The orchestrator's route history count comes from a frozen `history_count_maps.route_key` map inside `artifacts/states/quantile_risk.json`, built at training time — it is NOT a live query to any loadboard database. Training keys use `city, full-state-name` in Spanish/English full names (e.g. `tonala, jalisco`, `saltillo, coahuila de zaragoza`).

**Why:** The app sends Google Maps format (`Tonalá, Jal., México`), which normalized to `tonala, jal., mexico` and never matched training keys → every route looked "new" (0 history) and geo/P67 policies misfired.

The copilot's historical retrieval had the same bug: it queried `history.search` with the raw Google-format origin/destination, so routes with real history showed "sin historial propio" (comparable_routes). Fixed by canonicalizing in the copilot service before building the HistoricalQuery — any new consumer of route/state matching must canonicalize too.

**How to apply:** `canonicalize_location()` in `protected_cost/preprocessing.py` strips country suffixes, expands MX/US state abbreviations, and keeps only the last two segments (city, state). Route cache lookups intentionally still use plain `normalize_key`. If history counts look wrong again, compare the produced route_key against the bundle map first. To reflect newer loadboard history (e.g. excluding cancelled loads), the model bundles must be retrained/regenerated — the serving code cannot update counts.
