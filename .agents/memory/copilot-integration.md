---
name: Copiloto explicador de precotizaciones
description: Cómo está integrado el copiloto OpenAI en el servicio Python del orquestador y trampas de sys.path/procesos huérfanos.
---

# Copiloto explicador

- Vive en `server/ml/orchestrator/vax_pricing/` con evidencia RAG en `rag/structured/` y `data/processed/google_maps_route_cache.csv`. Endpoint Python `POST /copilot/explain` en serve.py; Express lo proxea vía `/api/copilot/explain`.
- El navegador SOLO envía quoteId/rutaId/modelKey; el costo/evidencia sale de un store en memoria de Express (TTL 1h) llenado en `/api/predict-tarifa`. `budget_subject` = userId de sesión, nunca del cliente.
- Requiere `COPILOT_ENABLED=true` (env compartida) y `OPENAI_API_KEY` (secreto).

**Trampa 1 — paquete sombra:** `ProtectedCostService()` antepone `src/` a sys.path, y `src/vax_pricing` (solo trip_duration) opaca al paquete completo. Por eso serve.py importa el copiloto ANTES de crear el servicio, y `trip_duration.py` está copiado dentro del paquete canónico. No reordenar esos imports.

**Trampa 2 — proceso huérfano:** el child Python (puerto 8100) sobrevive al reinicio del workflow; Express lo reutiliza si `/health` responde. Tras cambiar código Python hay que `pkill -f serve.py` para que cargue el código nuevo.

**Why:** ambos causaron "No module named 'vax_pricing.copilot'" pese a que el import manual funcionaba.
