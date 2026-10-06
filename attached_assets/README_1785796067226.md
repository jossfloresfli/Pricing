# Paquete de integración del copiloto de precotización

> Entrega preparada para incorporarse a un proyecto existente en Replit. El
> proyecto anfitrión ya tiene el orquestador ONNX; este paquete agrega solamente
> la explicación comercial basada en evidencia.

## Propósito

Este paquete contiene la capa necesaria para agregar el copiloto explicador al
software que ya ejecuta el orquestador ONNX. No contiene ni vuelve a ejecutar
los modelos de costo. Su responsabilidad comienza después de que el software
anfitrión calculó y guardó una precotización.

El copiloto recupera antecedentes históricos y documentación aprobada, prepara
evidencia limitada, solicita una explicación estructurada a OpenAI y valida en
el backend las referencias devueltas. La explicación es apoyo comercial y no
autoriza una tarifa ni sustituye la confirmación con carrier, Operaciones o
Procurement.

### Qué significa una ruta cercana

Una ruta histórica se considera cercana únicamente cuando cumple **las dos
condiciones geográficas al mismo tiempo**:

- su origen se encuentra a 30 km o menos del origen de la ruta solicitada; y
- su destino se encuentra a 30 km o menos del destino de la ruta solicitada.

Los radios se evalúan de forma independiente. No son 30 km acumulados entre
ambos extremos, no basta con que sólo uno de ellos esté cerca y tampoco se
refieren a una franja de 30 km alrededor de todo el recorrido. Por ejemplo, una
ruta con origen a 18 km y destino a 27 km puede ser candidata; una con origen a
8 km y destino a 34 km queda descartada.

Además de la cercanía geográfica, deben respetarse el sentido origen→destino y
los filtros de compatibilidad definidos para equipo, división y moneda. Estas
rutas son evidencia secundaria para explicar la precotización: no recalculan ni
modifican el resultado producido por el orquestador ONNX.

## Inicio rápido para Replit

Antes de copiar código, leer en este orden:

1. `docs/00_INDICE_DOCUMENTACION.md` para ubicar cada reporte.
2. `docs/01_RESUMEN_EJECUTIVO.md` para entender alcance y riesgos.
3. `replit/PROMPT_REPLIT_AGENT.md` para entregar la implementación a Replit
   Agent en modo Plan.
4. `replit/replit.md` para incorporar la memoria viva del proyecto.
5. `replit/custom_instruction/instructions.md` para conservar como reglas
   estables de integración.

La clave real de OpenAI no está en esta carpeta. Debe existir en Replit Secrets
con el nombre exacto `OPENAI_API_KEY`. También debe agregarse
`COPILOT_ENABLED=true`. La plantilla completa está en `.env.example`.

El paquete necesita un backend persistente. No debe publicarse como Static
Deployment porque llama a OpenAI desde servidor, consulta histórico y requiere
autenticación. Los archivos RAG incluidos pueden desplegarse en modo lectura;
las cotizaciones y contadores de consumo deben guardarse en la base compartida
del sistema.

## Contenido

```text
copilot_integration/
├── src/vax_pricing/copilot/       Lógica completa del copiloto
├── src/vax_pricing/config.py      Rutas internas del paquete
├── src/vax_pricing/quote_store.py Referencia para una beta de un proceso
├── rag/structured/                Evidencia documental e histórica
├── rag/vectors/                   Ubicación del índice semántico opcional
├── data/processed/                Caché para localizar rutas cercanas
├── scripts/                       Reconstrucción opcional de embeddings
├── tests/                         Pruebas independientes del orquestador
├── replit/                        Prompt, memoria y reglas para Replit Agent
└── docs/                          Contratos, arquitectura y operación
```

## Archivos obligatorios en runtime

El runtime necesita todo `src/vax_pricing/copilot/`, `src/vax_pricing/config.py`,
`rag/structured/document_chunks.jsonl`,
`rag/structured/historical_loads.jsonl` y
`data/processed/google_maps_route_cache.csv`.

El último archivo aporta las coordenadas utilizadas para comprobar por separado
el radio máximo de 30 km en el origen y el radio máximo de 30 km en el destino.

`rag/structured/manifest.json` no participa directamente en el cálculo, pero
debe conservarse para identificar la versión de la evidencia y auditar su
procedencia. Los demás JSON de `rag/structured/` documentan cobertura, esquema
y calidad del corpus.

## Flujo esperado

1. El software existente ejecuta el orquestador ONNX.
2. Guarda en el backend la solicitud y el resultado íntegro de la cotización.
3. Ventas elige una opción disponible y solicita una explicación.
4. El backend recupera la cotización mediante `quote_id`; no acepta un costo
   enviado por el navegador.
5. El adaptador del software construye `QuoteRequest` y `PricingResult`.
6. `PriceCopilotService.explain()` recibe además el identificador estable del
   usuario autenticado para aplicar su cuota individual y genera la explicación.
7. El software registra usuario, cotización, opción explicada, resultado,
   latencia y consumo.

El contrato y el ejemplo de integración se encuentran en
`docs/INTEGRACION_SOFTWARE_EXISTENTE.md`.

## Instalación

Desde esta carpeta:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-copilot.txt
```

El software anfitrión debe agregar `src` a su ruta de módulos o incorporar
`vax_pricing` a su mecanismo normal de empaquetado. No se incluye una API nueva
porque el endpoint debe quedar protegido por la autenticación y los roles del
software existente.

## Configuración

Copiar `.env.example` únicamente como referencia. En ambientes compartidos las
claves deben inyectarse desde el gestor de secretos. Nunca debe distribuirse un
archivo `.env` con credenciales.

Para una beta sin OpenAI puede usarse `COPILOT_ENABLED=false`. El servicio
seguirá recuperando el histórico, pero devolverá el copiloto como no disponible.

## Búsqueda semántica

Los embeddings que existen en el proyecto de origen no se copiaron porque
corresponden a un corpus anterior. El runtime funciona con recuperación textual
y por metadatos. Para activar la búsqueda semántica deben generarse nuevamente
los dos archivos descritos en `rag/vectors/README.md`.

## Persistencia y escalamiento

`src/vax_pricing/quote_store.py` es una referencia limitada para una beta de un
solo proceso. Si el software ya guarda cotizaciones, debe recuperar desde su
base de datos la solicitud y el resultado originales. No debe crearse una
segunda fuente de verdad.

Los contadores incluidos usan SQLite local. Antes de ejecutar varios workers o
réplicas deben sustituirse por un mecanismo compartido y atómico, por ejemplo
Redis o una tabla transaccional. El mismo criterio aplica al control de cuota de
embeddings.

La cuota de generación está configurada en 85,000 tokens y 25 solicitudes por
usuario y día UTC.
El backend debe pasar `budget_subject` desde la sesión autenticada; nunca debe
aceptarlo del navegador. El paquete almacena únicamente un hash de ese valor.

El caché CSV se utiliza en lectura para enriquecer comparaciones de rutas
cercanas. Si el software actualiza rutas durante la operación, esa información
debe centralizarse y sincronizarse con este paquete.

## Pruebas

Las pruebas copiadas no llaman a OpenAI ni ejecutan ONNX:

```powershell
.\.venv\Scripts\python.exe -c "import sys,unittest; sys.path.insert(0,'src'); result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.discover('tests')); raise SystemExit(not result.wasSuccessful())"
```

Antes de liberar la integración también debe hacerse una prueba controlada con
una credencial real de OpenAI y una cotización desidentificada.

## Elementos que deliberadamente no se incluyen

- Modelos, estados o pipelines ONNX.
- Bundles Joblib o dependencias LightGBM.
- Interfaz experimental.
- Endpoint de cotización.
- Base original de Loadboard.
- Documentos fuente PDF o Markdown usados para construir el corpus.
- Embeddings incompatibles con el corpus vigente.

El inventario de pendientes de producción se encuentra en
`docs/ESCALAMIENTO_Y_OPERACION.md`.
