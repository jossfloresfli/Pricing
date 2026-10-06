---
name: Caché de rutas compartido
description: El caché de rutas de Google Maps vive en Postgres; el CSV es solo semilla/lectura.
---

La fuente de verdad del caché geográfico es la tabla Postgres `google_maps_route_cache`, común a todas las réplicas. El CSV empaquetado (`server/ml/artifacts` y `server/ml/orchestrator/data`) es solo semilla inicial y respaldo de lectura cuando no hay `DATABASE_URL` — nunca debe recibir escrituras.

**Why:** en Replit los archivos del deployment se reemplazan al publicar; escrituras concurrentes a un CSV desde varias réplicas pierden datos y provocan llamadas repetidas (con costo) a Google Maps.

**How to apply:** lecturas/escrituras TS pasan por `server/ml/routeCacheDb.ts` (lookups y `appendRouteCacheEntry` son async); el lado Python (`protected_cost/route_cache.py`) carga desde Postgres vía psycopg y hace consulta puntual en misses. La siembra es idempotente y crea la tabla ella misma porque `runMigrations` tiene un timeout de 5s que puede dejar el DDL corriendo en segundo plano.

**Drizzle push:** `google_maps_route_cache` debe estar declarada en `shared/schema.ts`; si solo existe vía el DDL de migrate.ts, `drizzle-kit push` (incl. el post-merge setup) intenta ELIMINAR la tabla con todos sus datos y falla pidiendo confirmación.
