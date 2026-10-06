---
name: Presentación en USD del copiloto (Crossborder/Domestic)
description: Cómo se aplica la regla "estas divisiones se cotizan en dólares" a la explicación del copiloto
---

Divisiones Crossborder/Domestic se cotizan en USD; el copiloto presenta TODA su salida (texto, tablas, evidencia) en USD, pero la recuperación histórica, los filtros y la clasificación de costo siguen operando en MXN (el corpus es 100% MXN — enviar currency USD al query dejaría la evidencia vacía).

**Why:** El usuario exige consistencia con el cotizador (que muestra USD con Math.ceil). Convertir la moneda del query rompería la recuperación; la conversión es solo de presentación.

**How to apply:**
- El servidor guarda `usd_display.rate` en el quoteRequest del store del copiloto y lo pasa al servicio Python; `QuoteRequest.usd_display` existe en el schema.
- Python convierte con `convert_money_to_usd` (recursivo por claves de dinero) DESPUÉS de recuperar/clasificar; el selected_cost del prompt usa ceil como el cotizador.
- El tipo de cambio forma parte del `pricingHash` (identidad de la explicación): si cambia, se regenera en vez de reutilizar montos viejos.
- Cualquier cambio de presentación que altere respuestas persistidas requiere invalidar las filas `completed` afectadas en `copilot_explanations` — y hacerlo en la BD real: las tareas en entornos aislados NO tocan la base compartida.
