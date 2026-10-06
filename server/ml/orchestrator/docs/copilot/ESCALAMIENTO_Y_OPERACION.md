# Escalamiento y operación del copiloto

> Para la implementación en Replit, complementar con
> `08_SOLUCION_DE_PROBLEMAS_EN_REPLIT.md` y
> `../replit/PROMPT_REPLIT_AGENT.md`.

## Estado del paquete

El paquete es suficiente para integrar una beta controlada con recuperación
local. No contiene el orquestador ONNX y supone que el software anfitrión ya
puede producir y persistir un resultado de pricing confiable.

## Antes de la beta

- Implementar el adaptador de `QuoteRequest` y `PricingResult`.
- Proteger el endpoint con la autenticación existente.
- Inyectar `OPENAI_API_KEY` desde un gestor de secretos.
- Mantener `COPILOT_MODEL_PHASE=test` durante la evaluación.
- Validar una muestra desidentificada con una llamada real a OpenAI.
- Confirmar que una falla del copiloto no afecta el cotizador.
- Registrar aceptación, rechazo y utilidad percibida por ventas.

## Antes de utilizar varios workers

El almacenamiento en memoria de `quote_store.py` no debe usarse entre procesos.
La cotización debe recuperarse desde la base del sistema o desde un almacén
compartido.

Los límites de consumo actuales se guardan en SQLite bajo `rag/runtime/`. Con
varias réplicas cada una tendría su propio presupuesto. Debe implementarse una
reserva atómica en Redis o base transaccional para mantener un límite global.

Ese límite global se evalúa por usuario: 85,000 tokens y 25 solicitudes de
generación por día UTC. La llave de partición debe ser el hash de un
identificador estable de la sesión. No debe crearse una cuota por navegador,
dispositivo o `quote_id`.

El caché geográfico ya tiene fuente compartida: la tabla Postgres
`google_maps_route_cache` (sembrada una única vez desde el CSV empaquetado).
Todas las réplicas leen y escriben esa tabla; el CSV incluido queda como
respaldo de solo lectura y NUNCA debe recibir escrituras.

Todas las réplicas deben preservar exactamente la misma interpretación de
cercanía: `origen <= 30 km` **y** `destino <= 30 km`, evaluados por separado.
No debe implementarse como suma de distancias, condición `OR`, coincidencia de
un solo extremo o proximidad general al corredor. Si la búsqueda se migra a una
base geoespacial, estos criterios y los filtros de sentido, equipo, división y
moneda deben conservarse y probarse antes del cambio.

En Replit, los archivos locales del Deployment pueden reiniciarse o reemplazarse
al publicar una nueva versión. Por ello SQLite local y archivos modificables no
deben ser la fuente de verdad. Los artefactos del corpus pueden permanecer
empaquetados en lectura, mientras presupuesto, auditoría y cotizaciones deben
usar la base compartida del proyecto.

## Monitoreo mínimo

Por versión del prompt, corpus y modelo deben vigilarse:

- disponibilidad y tasa de errores;
- latencia p50, p95 y p99;
- tokens de entrada y salida;
- consumo diario y costo;
- proporción de respuestas fundamentadas, limitadas y no disponibles;
- citas descartadas por el backend;
- rutas sin histórico y uso de rutas cercanas;
- cambios de modelo realizados por ventas después de leer la explicación;
- diferencia posterior contra el costo confirmado por carrier.

Las métricas comerciales deben analizarse por división, equipo, rango monetario,
ruta nueva y nivel de historial. Una tasa global puede esconder fallos en colas
de precio o equipos especiales.

## Actualización de la evidencia

El corpus debe reconstruirse fuera del runtime. Cada liberación debe conservar:

- fecha de corte del histórico;
- hash de la entrada histórica;
- documentos y fechas de verificación;
- conteos incluidos y excluidos;
- cobertura temática y territorial;
- hash de cada artefacto;
- versión de embeddings, cuando se utilicen.

Después de cambiar `document_chunks.jsonl`, los embeddings deben reconstruirse.
El backend verifica el checksum y desactiva automáticamente un índice anterior.

## Rollback

El copiloto debe tener un interruptor independiente mediante
`COPILOT_ENABLED=false`. Un rollback del copiloto no debe modificar la versión
del orquestador ni los resultados de precio ya guardados.

Se debe regresar a recuperación local si falla el servicio de embeddings, y
desactivar generación si se supera el presupuesto, aparecen errores sostenidos
o no puede garantizarse la trazabilidad de la cotización.

## Criterio para avanzar de beta

Antes de ampliar el uso deben revisarse al menos precisión de citas, ausencia de
afirmaciones monetarias inventadas, utilidad para ventas, tasa de abstención,
latencia, consumo y comportamiento por segmentos. La evaluación debe conservar
ejemplos aprobados y fallidos para regresión futura.
