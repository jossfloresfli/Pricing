# Actualización de evidencia histórica y documental

## Separar construcción y runtime

El servidor de Replit no debe reconstruir el corpus al iniciar. La construcción
es un proceso controlado que lee la fuente histórica, documentos aprobados y
metadatos, genera artefactos, ejecuta validaciones y publica una versión
inmutable. El runtime sólo lee esa versión.

## Histórico

`historical_loads.jsonl` se generó desde una tabla limpia y enriquecida. La
fuente original no se incluye en este paquete porque contiene datos de trabajo y
no es necesaria para responder solicitudes.

Una actualización debe aplicar nuevamente las reglas de elegibilidad y punto en
el tiempo. Deben excluirse registros sin costo válido, estados no elegibles,
filas cuya información todavía no estaba disponible en la fecha de referencia y
campos monetarios que no pertenecen al contrato del copiloto.

El proceso debe conservar rutas dirigidas y fechas. No se debe reemplazar una
ruta faltante con el viaje inverso sin marcarlo como comparación distinta.

## Documentación

Los documentos fuente deben conservar título, organismo, URL, fecha de
verificación, territorio, tema, autoridad y vigencia. Un documento vencido puede
mantenerse para trazabilidad, pero debe marcarse y no presentarse como regla
actual sin revisión.

El equipo responsable debe revisar cambios regulatorios, peajes, combustibles,
aduanas, materiales peligrosos, seguridad, puertos y documentación operativa con
la cadencia apropiada para cada fuente.

## Embeddings

Después de cambiar `document_chunks.jsonl`, cualquier índice anterior queda
incompatible. Deben regenerarse el JSON de metadatos y el NPZ en la misma
ejecución. Antes de consumir OpenAI se recomienda validar el máximo de registros
y tokens.

El checksum del corpus debe coincidir exactamente con `source_sha256` del índice.
Si no coincide, `COPILOT_SEMANTIC_SEARCH` debe permanecer en `false` o el backend
caerá a recuperación local.

## Validaciones de liberación

Cada versión debe registrar conteos de fuentes, fragmentos, registros históricos,
exclusiones, rutas, temas sin cobertura, fuentes vencidas y hashes. También debe
ejecutar pruebas de recuperación con consultas representativas por división y
equipo.

La liberación debe compararse con la versión anterior para detectar pérdidas
inesperadas de cobertura, cambios bruscos en distribuciones monetarias y nuevos
campos sensibles.

## Publicación en Replit

Los artefactos aprobados se copian como archivos de sólo lectura en el
deployment o se descargan desde almacenamiento versionado durante el build. No
deben editarse manualmente en producción.

La versión activa debe exponerse en un health check interno. Un rollback debe
poder seleccionar el corpus anterior sin cambiar el orquestador ONNX.

## Responsabilidades

Debe existir un propietario de datos históricos, uno de fuentes documentales y
uno de la liberación técnica. Ninguna actualización debe promoverse únicamente
porque el script terminó: requiere revisión de cobertura, privacidad y pruebas
de regresión.
