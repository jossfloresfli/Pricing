# Protocolo de prueba E2E — Explicación del copiloto desde la interfaz

Protocolo reproducible para validar el flujo completo de explicación desde la
UI (`client/src/components/RequestDetailModal.tsx`), incluyendo el estado
degradado. Ejecutado y aprobado el 2026-08-03 con evidencia de pantalla.

## Requisitos

- Workflow "Start application" corriendo (Express en 5000 spawnea el servicio
  Python en 8100).
- `COPILOT_ENABLED=true` y `OPENAI_API_KEY` configurados.
- Usuario superadmin (los roles `sales_*` no ven estos controles).

## Fase 1 — Flujo feliz

1. Iniciar sesión como superadmin.
2. Abrir Pricing Board y el detalle de un ticket con una ruta nacional dentro
   de México (p. ej. Zapopan, Jal. → Monterrey, N.L.).
3. Pestaña **Ofertas** → **Agregar Oferta** → pulsar **Calcular referencia de
   costo** (`data-testid="button-predict-tarifa-<rutaId>"`). Puede tardar
   10–60 s (POST `/api/predict-tarifa`).
4. **Asserts:**
   - Aparece la tarjeta "Referencia de costo (MXN)" con monto y "Rango
     estimado de variación" (−5 % / +15 % sobre la referencia).
5. Pulsar **Explicar esta referencia (copiloto)**
   (`data-testid="button-copilot-<rutaId>"`); POST `/api/copilot/explain`
   debe responder 200 en ≤30 s.
6. **Asserts** (`data-testid="copilot-respuesta-<rutaId>"`):
   - Badge de estado "Con evidencia" o "Evidencia limitada".
   - Explicación en español con montos MXN.
   - Advertencias listadas (nunca ocultas) cuando existan.
   - Aviso fijo: "Apoyo comercial generado con IA. No autoriza una tarifa…".

## Fase 2 — Estado degradado (el copiloto nunca bloquea la cotización)

7. Reiniciar "Start application" con `COPILOT_ENABLED=false`.
8. Repetir pasos 1–5 (el almacén de precotizaciones se vacía al reiniciar:
   recalcular la referencia antes de pedir la explicación).
9. **Asserts:**
   - La tarjeta de referencia de costo se calcula y permanece intacta.
   - El bloque del copiloto muestra badge "No disponible" con mensaje amable
     (p. ej. "…el copiloto no está habilitado o no tiene una clave de OpenAI
     configurada."), o el mensaje "No se pudo generar la explicación. La
     referencia de costo no se ve afectada."
   - Ningún error rompe el modal ni la pestaña Ofertas.
10. Restaurar el workflow sin overrides.

## Resultado registrado (2026-08-03)

- Fase 1: referencia $66,546 MXN, rango $63,219 — $76,528; explicación con
  badge "Con evidencia" y aviso de IA. ✔
- Fase 2: con `COPILOT_ENABLED=false`, respuesta degradada "No disponible";
  la referencia de costo siguió visible e intacta. ✔

## Notas operativas

- El servicio Python (8100) sobrevive a reinicios del workflow; tras cambiar
  código Python ejecutar `pkill -f serve.py` para recargar.
- Las bases de uso en `rag/runtime/*.sqlite3` son estado de runtime y están
  excluidas del control de versiones (.gitignore).
