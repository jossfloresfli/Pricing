# Inventario y destino de archivos

## Cómo usar este reporte

Este documento indica qué debe agregar Replit al proyecto existente. Las rutas
de destino son conceptuales: Replit Agent debe adaptarlas a la estructura real
sin duplicar módulos equivalentes y sin alterar el orquestador ONNX.

## Código de runtime obligatorio

Debe integrarse el contenido de `src/vax_pricing/copilot/`. Cada archivo tiene
una responsabilidad distinta:

- `service.py` coordina histórico, documentación, límites y generación.
- `schemas.py` define contratos de entrada y salida y sus validaciones.
- `history.py` busca antecedentes exactos, antiguos y rutas cercanas.
- `retrieval.py` selecciona documentación con búsqueda textual e híbrida.
- `openai_client.py` contiene el prompt, Structured Outputs y llamada a OpenAI.
- `budget.py` reserva y contabiliza solicitudes y tokens.
- `token_limits.py` estima y recorta el contexto antes de llamar a OpenAI.
- `embeddings.py` agrega ranking semántico cuando existe un índice compatible.
- `settings.py` lee Secrets y configuración del ambiente.
- `__init__.py` expone las clases públicas.

También se requiere `src/vax_pricing/config.py`, porque las rutas de evidencia
se resuelven respecto a la raíz del paquete. `quote_store.py` se incluye sólo
como referencia de una beta local; no debe usarse si el sistema ya persiste
cotizaciones o ejecuta más de un proceso.

Si el proyecto Replit ya tiene un paquete llamado `vax_pricing`, deben fusionarse
los archivos sin reemplazar módulos existentes. Si usa otra convención, el
agente puede moverlos, pero deberá actualizar imports y ejecutar todas las
pruebas.

## Evidencia obligatoria en runtime

Los siguientes archivos deben conservarse en almacenamiento accesible y de sólo
lectura para la aplicación:

- `rag/structured/document_chunks.jsonl` contiene los fragmentos documentales.
- `rag/structured/historical_loads.jsonl` contiene antecedentes desidentificados
  y estructurados para consulta.
- `rag/structured/manifest.json` identifica la versión de la evidencia.
- `data/processed/google_maps_route_cache.csv` aporta coordenadas para buscar
  rutas cercanas. El backend lo utiliza para exigir simultáneamente que el
  origen histórico esté a 30 km o menos del origen solicitado y que el destino
  histórico esté a 30 km o menos del destino solicitado. No es un radio único
  compartido ni una condición que pueda cumplir sólo uno de los extremos.

El software no debe publicar estos archivos como assets estáticos ni permitir
su descarga desde el navegador. El backend los carga directamente.

## Evidencia de auditoría recomendada

También deben conservarse:

- `document_coverage.json` para revisar cobertura temática y vigencia.
- `historical_audit.json` para conocer filas incluidas y excluidas.
- `schema.json` para documentar los campos de los artefactos.
- `rag/structured/README.md` para procedencia y restricciones.

No son necesarios para responder cada solicitud, pero permiten explicar qué se
construyó y validar una actualización.

## Índice semántico opcional

`rag/vectors/` no contiene vectores en esta entrega. El copiloto inicia con
recuperación local. Cuando se reconstruyan embeddings compatibles, deben
agregarse juntos `document_embeddings.npz` y `document_embeddings.json`.

No debe copiarse sólo uno de los dos. El JSON registra modelo, identificadores y
checksum; el NPZ contiene la matriz. Si el checksum no coincide, el backend
desactiva el componente semántico.

## Configuración y dependencias

- `.env.example` enumera las claves que deben cargarse en Replit Secrets.
- `requirements-copilot.txt` contiene las dependencias directas fijadas.
- `requirements-api-optional.txt` aplica si el backend existente usa FastAPI.
- `.gitignore` excluye secretos, entornos y archivos locales de consumo.

Replit Agent debe fusionar las dependencias con el archivo ya usado por el
proyecto, no crear dos entornos incompatibles. Debe detectar conflictos de
versiones y preservar las versiones necesarias para ONNX.

## Pruebas y documentación

La carpeta `tests/` contiene pruebas que pueden copiarse al conjunto existente.
La carpeta `docs/` es documentación operativa y debe conservarse en el
repositorio. La carpeta `replit/` contiene instrucciones para el agente; sus
archivos deben copiarse o fusionarse en la raíz según `replit/README.md`.

## Elementos que no deben copiarse desde otras carpetas

Esta integración no necesita:

- `deployment/protected_cost_orchestrator_onnx/` porque ya está integrado;
- ningún `.onnx`, `.joblib` o estado de modelo adicional;
- scripts de entrenamiento;
- notebooks y reportes de experimentación;
- la interfaz web experimental;
- la base Loadboard original;
- credenciales locales;
- los embeddings anteriores incompatibles.

## Mapeo sugerido

Si el proyecto Replit tiene una raíz Python convencional, el resultado puede
verse así:

```text
proyecto-replit/
├── src/vax_pricing/copilot/
├── rag/structured/
├── rag/vectors/
├── data/processed/google_maps_route_cache.csv
├── tests/copilot/
├── docs/copilot/
├── replit.md
└── custom_instruction/instructions.md
```

Este es un ejemplo, no una orden de reemplazar la arquitectura existente. La
integración correcta conserva la fuente de verdad de pricing y usa el mecanismo
de autenticación, persistencia y logging ya presente.
