# Comparación regional del copiloto (historical_support.regional_support)

## Qué es
Capa de evidencia complementaria que compara la cotización con viajes de la
misma zona: mismo par de estados dirigido, mismo corredor regional dirigido o
distancia y equipo comparables. Nunca sustituye la ruta exacta ni las rutas
cercanas.

## Reglas de aplicabilidad
Aplica sólo cuando TODO se cumple:
- División **National** (otras divisiones → `not_applicable`).
- Equipo distinto de **LTL**.
- Coordenadas completas y válidas de la cotización.
- Historia con `cost_available_at < quote_timestamp` (mismo corte temporal en
  todos los niveles) y misma moneda.
- Sólo `all_in_rate_cost` / `all_in_rate_sale` (nunca campos "total" ni
  accesoriales).
- Segmentación regional congelada verificada por checksum.

## Segmentación (congelada)
- Artefacto: `artifacts/states/national_geo.json` (14 regiones, KMeans lat/lng,
  centros idénticos en las 3 semillas). Checksum verificado contra
  `artifacts/manifest.json` (`bundles.national_geo.state_sha256`).
- Asignación: centro más cercano (euclidiano), idéntica al runtime
  (`KMeansRuntime`). Nunca se reentrena ni se recalculan centros; nunca se usa
  OpenAI ni nombres de ciudades para asignar región.
- Si el artefacto falta o el checksum no coincide → capa `unavailable` sin
  romper el resto del copiloto.

## Capa derivada offline
`python scripts/build_regional_assignments.py` genera:
- `rag/structured/regional_assignments.jsonl`: por viaje elegible — estados
  (sólo de la etiqueta estructurada `ciudad, estado`), regiones, corredores
  dirigidos, coordenadas usadas, versión y checksum, estado de resolución y
  motivo auditado de exclusión.
- `rag/structured/regional_assignments_manifest.json`: conteos
  (fuente/resueltos/excluidos por motivo), etiquetas provisionales por región
  (estados dominantes — **pendientes de aprobación comercial**).
El cálculo es offline (build del corpus), no por solicitud. Si el checksum del
artefacto cambia, las asignaciones viejas se ignoran (capa `unavailable`)
hasta regenerar.

## Prioridad de recuperación (estricta, corredores dirigidos)
ruta exacta > rutas cercanas (30 km) > mismo par de estados > mismo corredor
regional > corredores relacionados (sólo si existe el catálogo aprobado en
`rag/structured/related_corridors.json`; sin catálogo el nivel queda
deshabilitado) > distancia+equipo
comparables (tolerancia reutilizada:
`COPILOT_NEARBY_ROUTE_DISTANCE_TOLERANCE_PCT`, 20%).
La ruta inversa nunca cuenta como el mismo corredor. Ventana de 6 meses con
fallback a historia más antigua marcada (`older_history_fallback`).

## Parámetros aprobados (Pricing/Operaciones/Procurement)

### Umbrales de clasificación de `regional_cost_level`
Comparación entre el `selected_cost` de la cotización y la mediana de
`all_in_rate_cost` del conjunto de viajes regionales comparables:

| Resultado             | Condición                                                         |
|-----------------------|-------------------------------------------------------------------|
| `lower`               | cotización < mediana regional × (1 + `lower_pct`/100)           |
| `similar`             | entre `lower_pct` y `higher_pct`                                 |
| `higher`              | cotización > mediana regional × (1 + `higher_pct`/100)          |
| `insufficient_evidence` | viajes comparables < `min_trips`                              |
| `not_evaluated`       | quoted_cost ausente o mediana no computable                      |

**Defaults aprobados** (configurables vía variables de entorno sin cambiar código):
- `COPILOT_REGIONAL_COST_LEVEL_LOWER_PCT` = `-10.0` (10 % por debajo → `lower`)
- `COPILOT_REGIONAL_COST_LEVEL_HIGHER_PCT` = `10.0` (10 % por encima → `higher`)
- `COPILOT_REGIONAL_MIN_TRIPS_FOR_LEVEL` = `3` (mínimo de viajes para evaluar)

### Nombres comerciales de regiones
**Aprobados por Pricing el 2026-08-04**: se ratificaron los nombres derivados
de los estados dominantes tal como aparecen en `region_labels` de
`rag/structured/regional_assignments_manifest.json`
(`region_labels_status: commercial_approved`). Cualquier cambio futuro de
nombres se hace editando el manifest y reiniciando el servicio (no requiere
cambio de código).

### Catálogo de corredores relacionados
Mecanismo listo; el nivel `related_corridor` se activa automáticamente al
colocar el catálogo aprobado en `rag/structured/related_corridors.json` y
reiniciar el servicio (sin cambio de código). Sin archivo aprobado el nivel
queda deshabilitado y nunca se inventan relaciones. Formato exacto:

```json
{
  "schema_version": "copilot-related-corridors-v1",
  "status": "approved",
  "approved_by": ["Pricing", "Operaciones", "Procurement"],
  "approved_at": "AAAA-MM-DD",
  "corridors": {
    "estado origen -> estado destino": [
      "estado origen relacionado -> estado destino relacionado"
    ]
  }
}
```

Reglas: relaciones DIRIGIDAS (la inversa no cuenta), estados en minúsculas
tal como aparecen en la etiqueta estructurada `ciudad, estado`; se rechaza
cualquier archivo sin `status: "approved"` o con `schema_version` distinto.
El estado del catálogo es visible en `/health`
(`regional_support.related_corridor_catalog`).

## Trazabilidad
`used_by_selected_cost` proviene EXCLUSIVAMENTE de la trazabilidad del modelo
seleccionado (regional_context del pricing o modelo seleccionado ∈ claves geo);
nunca se deduce de la evidencia recuperada.

## OpenAI (una sola llamada)
Máximo 3 resúmenes regionales dentro del bloque
`historical_support.regional_support` de la misma llamada existente. El payload
no incluye transportistas, coordenadas, fórmulas ni términos de agrupamiento.
Prioridad de recorte de tokens: documentos → regional → exacta → cercanas →
folios. Validación determinista posterior (sin segunda llamada): aclaración si
se sugiere influencia sin trazabilidad; nota si se intenta clasificar el nivel
regional sin umbrales.

## Configuración
- `COPILOT_REGIONAL_SUPPORT_ENABLED` (default true)
- `COPILOT_MAX_REGIONAL_ROUTE_SUMMARIES` (default 3)

## Persistencia
El snapshot completo de `CopilotResponse` (incluido `regional_support`, con
`model_version` y `artifact_checksum`) se guarda en `copilot_explanations`;
las explicaciones previas se conservan para auditoría.

## Rollback
Poner `COPILOT_REGIONAL_SUPPORT_ENABLED=false` (la capa devuelve `unavailable`
y el resto del copiloto sigue igual), o borrar
`rag/structured/regional_assignments.jsonl`.
