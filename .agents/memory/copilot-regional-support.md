---
name: Capa regional del copiloto
description: Contrato de artefacto congelado, derivación offline y parámetros pendientes de aprobación de historical_support.regional_support
---

# Comparación regional del copiloto

- La segmentación regional reutiliza el artefacto KMeans congelado de 14 regiones (`artifacts/states/national_geo.json`), verificado por checksum contra `artifacts/manifest.json` y exactamente 14 centros. Si el checksum o el conteo no coinciden → capa `unavailable` sin romper el copiloto. Nunca reentrenar ni asignar regiones por nombre de ciudad/OpenAI.
- Las asignaciones se derivan OFFLINE con `server/ml/orchestrator/scripts/build_regional_assignments.py` → `rag/structured/regional_assignments.jsonl` (+manifest con etiquetas provisionales). Si el corpus histórico cambia hay que regenerarlas; si el artefacto cambia, se ignoran hasta regenerar (matching por checksum en history.py).
- **Parámetros pendientes de aprobación comercial (no inventar):** umbrales de nivel de costo regional (siempre `not_evaluated`, incluso sin evidencia), mínimo de viajes, catálogo de corredores relacionados (nivel deshabilitado), nombres comerciales de regiones (etiquetas provisionales por estados dominantes).
- **Why:** el spec del usuario prohíbe explícitamente inventar umbrales/relaciones/nombres; el code review confirmó que `insufficient_evidence` como nivel también viola la regla — todo permanece `not_evaluated` hasta aprobación.
- `used_by_selected_cost` sale sólo de trazabilidad del cotizador: `pricing.regional_context` o (opción seleccionada ∈ claves geo Y `selected_model` contiene "geo"/"ajustada"). Nunca de la evidencia recuperada.
- Corredores DIRIGIDOS en todos los niveles (la ruta inversa no cuenta). Payload a OpenAI sin transportistas/coordenadas, máx. 3 resúmenes regionales, una sola llamada; prioridad de recorte: documentos → regional → exacta → cercanas → folios.
- Nivel "related_corridor": se activa sólo colocando `rag/structured/related_corridors.json` con `status:"approved"` y `schema_version` correcto (relaciones dirigidas, minúsculas); sin archivo queda deshabilitado. Estado visible en `/health`.
- **Lección de merges:** un merge de task agent corrompió `service.py` (hunks entremezclados, SyntaxError) y el propio commit del agente ya venía roto. Tras cada merge que toque `server/ml/orchestrator/`, correr `python3 -c "import ast; ast.parse(...)"` o la suite unittest antes de confiar en el estado; reconstruir desde el último commit bueno + diff semántico si pasa de nuevo.
- Rollback: `COPILOT_REGIONAL_SUPPORT_ENABLED=false`. Doc completa: `server/ml/orchestrator/vax_pricing/copilot/REGIONAL_SUPPORT.md`. Tests: `python3 -m unittest discover -s tests/copilot` (pytest NO está instalado).
