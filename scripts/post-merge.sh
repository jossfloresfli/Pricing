#!/bin/bash
set -e
npm install

# --- Sincronización de esquema (db:push) ---
# drizzle-kit push pide confirmación interactiva cuando detecta cambios con
# posible pérdida de datos. Este script corre sin stdin: la pregunta recibe
# EOF y el push puede quedar omitido SIN error, dejando el esquema
# desincronizado en silencio. Por eso: capturamos la salida, y si aparece la
# confirmación interactiva (o el comando falla), abortamos con un mensaje
# claro para que un humano decida. Nunca usamos --force automáticamente.
echo "[post-merge] Aplicando cambios de esquema (drizzle-kit push)..."
set +e
DB_PUSH_OUTPUT="$(npm run db:push 2>&1 </dev/null)"
DB_PUSH_STATUS=$?
set -e
echo "$DB_PUSH_OUTPUT"

if [ $DB_PUSH_STATUS -ne 0 ]; then
  echo "[post-merge] ERROR: db:push falló (exit $DB_PUSH_STATUS). El esquema puede estar desincronizado." >&2
  exit 1
fi

if echo "$DB_PUSH_OUTPUT" | grep -Eqi "do you still want|are you sure|data(-| )loss|delete .* (table|column)|truncate|drop .* (table|column)"; then
  echo "[post-merge] ERROR: drizzle-kit detectó cambios potencialmente destructivos y pidió confirmación interactiva; el push NO se aplicó." >&2
  echo "[post-merge] Acción requerida: un humano debe revisar el cambio y correr 'npm run db:push' manualmente (y sólo si la pérdida de datos es intencional, 'npx drizzle-kit push --force')." >&2
  exit 1
fi
echo "[post-merge] Esquema sincronizado."

# --- Verificación del copiloto (evita que un merge deje el servicio Python roto) ---
echo "[post-merge] Compilando archivos Python del copiloto..."
if ! python3 -m compileall -q server/ml/orchestrator/vax_pricing/copilot; then
  echo "[post-merge] ERROR: errores de sintaxis en server/ml/orchestrator/vax_pricing/copilot — el servicio del copiloto no arrancará." >&2
  exit 1
fi

echo "[post-merge] Corriendo suite unittest del copiloto..."
if ! (cd server/ml/orchestrator && python3 -m unittest discover -s tests/copilot); then
  echo "[post-merge] ERROR: la suite de tests del copiloto falló — revisar server/ml/orchestrator/tests/copilot." >&2
  exit 1
fi
echo "[post-merge] Copiloto OK: sintaxis y tests en verde."
