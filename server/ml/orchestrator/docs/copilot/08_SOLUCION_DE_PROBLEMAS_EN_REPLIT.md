# Solución de problemas en Replit

## El copiloto aparece deshabilitado

Confirmar que Replit Secrets contiene `COPILOT_ENABLED` con valor `true` y
`OPENAI_API_KEY` con ese nombre exacto. `.env.example` es sólo una plantilla y
no se carga automáticamente.

No imprimir la clave. Basta con comprobar desde el backend que la variable
existe y no está vacía. Revisar también que el Secret esté disponible para el
Deployment publicado.

## Funciona en Preview pero no en Deployment

Verificar Secrets del ambiente publicado, comando de ejecución, tipo de
deployment y acceso a los artefactos RAG. El backend debe escuchar en la
configuración requerida por Replit y mantenerse como proceso de larga duración.

No utilizar Static Deployment: esta funcionalidad requiere backend, acceso a
Secrets y llamadas de servidor.

## Error de importación de `vax_pricing`

Confirmar que la carpeta `src` esté en el mecanismo de paquetes del proyecto.
Replit Agent debe integrar el paquete según el stack existente, no depender de
un cambio manual de directorio que sólo funcione en Preview.

Si ya existe `vax_pricing`, fusionar el subpaquete `copilot` y conservar un solo
`__init__.py`. Después ejecutar las pruebas desde la raíz real del proyecto.

## No encuentra el histórico o los documentos

Revisar que la estructura conserve `rag/structured/document_chunks.jsonl` y
`rag/structured/historical_loads.jsonl` respecto a la raíz que calcula
`config.py`. Un cambio de ubicación requiere actualizar configuración, no crear
copias duplicadas en varias rutas.

Los archivos deben incluirse en el deployment y tener permisos de lectura. No
deben servirse públicamente.

## Muestra `local_hybrid_fallback`

Es el comportamiento esperado de esta entrega. Significa que no existe un
índice semántico compatible y que la recuperación continúa por texto y
metadatos.

Para activar embeddings, seguir `rag/vectors/README.md`, verificar checksum y
cambiar `COPILOT_SEMANTIC_SEARCH=true` en Secrets.

## La explicación regresa 404 después de cotizar

Si se utilizó `quote_store.py`, es posible que la solicitud llegara a otro
worker o que el proceso se reiniciara. Recuperar la cotización desde la base
compartida del software existente. No resolver aumentando únicamente el TTL del
almacén en memoria.

## El límite diario no coincide entre réplicas

SQLite cuenta por filesystem local. Migrar las reservas a Redis o base
transaccional compartida. El límite debe aplicarse de forma atómica antes de
llamar a OpenAI y reconciliarse con el consumo real después de la respuesta.

La consulta debe filtrar por día UTC y hash de usuario. Si todos los usuarios
comparten consumo, revisar que el endpoint esté pasando
`budget_subject=str(authenticated_user.id)` y no el valor por defecto del sistema.

## La aplicación pierde datos al volver a publicar

No guardar cotizaciones, auditoría o consumo en archivos locales del deployment.
Usar la base existente o `DATABASE_URL`. Los archivos RAG sí pueden empaquetarse
porque son artefactos de sólo lectura que vuelven a publicarse con la versión.

## OpenAI responde con timeout o límite

Mantener cero reintentos automáticos para evitar duplicar consumo. Mostrar el
copiloto como no disponible y preservar la cotización. Revisar latencia, cuota,
modelo configurado y presupuesto antes de aumentar límites.

## La respuesta no contiene citas

Revisar si hubo evidencia documental aplicable y si los identificadores
devueltos existían. El backend descarta citas inventadas. No debe relajarse esa
validación para que la interfaz parezca más completa.

## Hay texto técnico o una afirmación inapropiada

Conservar el caso, prompt version, evidencia y salida sanitizada para regresión.
No editar silenciosamente sólo la interfaz. Revisar si la información provino
del pricing, histórico, documento o generación, y corregir la capa responsable.

## El cotizador dejó de funcionar después de integrar

Desactivar inmediatamente el copiloto con `COPILOT_ENABLED=false`. Si ONNX o el
endpoint de cotización siguen afectados, la integración violó el límite de
responsabilidad y debe revertirse al checkpoint anterior. El copiloto no debe
ser una dependencia necesaria para calcular precio.
