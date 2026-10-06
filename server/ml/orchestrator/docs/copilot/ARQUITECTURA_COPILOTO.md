# Copiloto explicador de precios

> Nota para esta entrega: este documento conserva el contexto técnico del
> prototipo original. En el proyecto Replit el orquestador ONNX ya existe y no
> debe copiarse, sustituirse ni ejecutarse de nuevo desde el copiloto. Las
> secciones de pricing describen el origen del resultado que el copiloto recibe,
> no componentes adicionales que Replit deba instalar.

## Arquitectura

```text
POST /api/quote
    └── ProtectedCostPricingEngine
          └── alternativas de costo, venta y margen; no usa OpenAI

POST /api/copilot/explain
    ├── recupera la cotización confiable guardada por quote_id
    ├── valida la alternativa elegida por ventas
    └── PriceCopilotService
          ├── HistoricalRepository
          ├── DocumentRepository
          ├── OpenAICopilotGenerator
          └── validación de evidence_id y construcción de citas
```

El copiloto recibe un precio terminado. No ejecuta modelos de pricing, no
recalcula el precio y una falla suya no interrumpe la cotización. Cotizar no
consume tokens del copiloto ni ejecuta recuperación semántica. La llamada a
OpenAI sólo ocurre cuando la persona pulsa **Explicar el costo seleccionado**.

## Configuración

| Variable | Función | Valor inicial |
|---|---|---|
| `COPILOT_ENABLED` | Activa la llamada de generación | `false` |
| `COPILOT_MODEL_PHASE` | Selecciona `test` o `target` | `test` |
| `OPENAI_MODEL_TEST` | Modelo del piloto | `gpt-5.4-mini` |
| `OPENAI_MODEL_TARGET` | Modelo posterior a la evaluación | `gpt-5.6-luna` |
| `OPENAI_EMBEDDING_MODEL` | Embeddings documentales | `text-embedding-3-small` |
| `COPILOT_TIMEOUT_SECONDS` | Timeout de generación | `20` |
| `COPILOT_MAX_INPUT_TOKENS` | Máximo local estimado antes de llamar | `3000` |
| `COPILOT_MAX_OUTPUT_TOKENS` | Límite de respuesta | `300` |
| `COPILOT_DAILY_TOKEN_LIMIT` | Entrada y salida por usuario y día UTC | `85000` |
| `COPILOT_DAILY_REQUEST_LIMIT` | Explicaciones por usuario y día UTC | `25` |
| `COPILOT_EMBEDDING_DAILY_TOKEN_LIMIT` | Tokens diarios para consultas semánticas | `5000` |
| `COPILOT_EMBEDDING_DAILY_REQUEST_LIMIT` | Consultas semánticas por día UTC | `30` |
| `COPILOT_NEARBY_ROUTE_RADIUS_KM` | Radio máximo para cada extremo de una ruta cercana | `30` |
| `COPILOT_NEARBY_ROUTE_DISTANCE_TOLERANCE_PCT` | Diferencia máxima del recorrido total | `20` |
| `COPILOT_MAX_NEARBY_ROUTE_SUMMARIES` | Rutas cercanas mostradas y enviadas como evidencia | `5` |
| `PROTECTED_COST_RUNTIME` | Runtime del cotizador: `auto`, `onnx` o `joblib` | `auto` |
| `QUOTE_EXPLANATION_TTL_SECONDS` | Tiempo local para poder explicar una cotización | `3600` |
| `QUOTE_EXPLANATION_MAX_ENTRIES` | Cotizaciones conservadas en memoria | `200` |
| `GOOGLE_MAPS_ENABLED` | Permite resolver rutas nuevas con Google Maps | `true` |
| `GOOGLE_MAPS_DISTANCE_PROVIDER` | Servicio de distancia: `distance_matrix` o `routes` | `distance_matrix` |
| `GOOGLE_MAPS_TIMEOUT_SECONDS` | Timeout de la consulta de ruta | `20` |
| `GOOGLE_MAPS_DAILY_ROUTE_LIMIT` | Máximo local de rutas nuevas por día | `20` |

Ambos modelos usan `reasoning.effort="none"`. Luna se evalúa con el mismo
prompt, evidencia, esquema y límites antes de cambiar `COPILOT_MODEL_PHASE`.
Estos valores son techos definidos en código: el ambiente puede bajarlos, pero
no elevarlos.

Las rutas cercanas se calculan con las coordenadas guardadas en
`data/processed/google_maps_route_cache.csv`. Tanto el origen como el destino
deben quedar dentro del radio configurado, con el mismo sentido, equipo,
división y moneda. Esta búsqueda no llama a Google Maps durante la explicación
y nunca modifica el costo calculado.

La condición exacta es `distancia_origen <= 30 km AND distancia_destino <= 30
km`, usando el valor predeterminado. Son dos radios independientes: no se suman
las distancias, no se acepta una coincidencia en un solo extremo y no se mide un
corredor de 30 km alrededor del trayecto. Por ejemplo, 20 km en origen y 28 km
en destino cumple el criterio geográfico; 5 km en origen y 32 km en destino no
lo cumple. El valor puede reducirse mediante
`COPILOT_NEARBY_ROUTE_RADIUS_KM`, pero la misma configuración se aplica por
separado a ambos extremos.

## Control de consumo

Antes de cada generación, el backend cuenta de forma conservadora el prompt,
la evidencia, el esquema de salida y una reserva por formato. Si el paquete
supera 3,000 tokens, retira primero los documentos y resúmenes menos relevantes.
Si ni el paquete mínimo cabe, conserva el precio y no llama a OpenAI.

La llamada reserva sus tokens máximos en
`rag/runtime/copilot_usage.sqlite3`. El presupuesto se libera al consumo real
cuando llega una respuesta válida. Si hay timeout o error, la reserva se
conserva porque la solicitud pudo haber generado consumo. El SDK usa cero
reintentos automáticos.

`/api/health` muestra los topes, el consumo o reserva del día y lo que queda,
sin exponer la clave ni los prompts.

La búsqueda semántica en runtime usa una cuota separada de 5,000 tokens y 30
consultas al día. Cuando se agota, se omite esa llamada y la recuperación
textual y por metadatos sigue funcionando.

## Contratos

`POST /api/quote` recibe ruta, equipo, división, moneda, fecha y datos
opcionales de distancia, cliente, proveedor y margen objetivo. Cliente y
proveedor sólo alimentan el cotizador; se eliminan del paquete del copiloto.

La respuesta contiene únicamente `pricing`, con:

- Resultado combinado recomendado por el orquestador.
- Todas las alternativas aplicables, cada una con costo, venta all-in y margen.
- Runtime, ruta utilizada y decisión del cotizador.

La interfaz preselecciona el resultado combinado, pero ventas puede elegir
cualquier alternativa disponible. Elegir el valor más bajo no implica
aprobación ni viabilidad operativa.

`POST /api/copilot/explain` recibe `quote_id` y `model_key`. El backend recupera
el precio original almacenado, por lo que no acepta un costo enviado por el
navegador. Su respuesta contiene `copilot`: explicación, histórico, citas,
advertencias, modelo y consumo. El almacenamiento es local, dura inicialmente
una hora y está pensado para la interfaz con un solo proceso; una instalación
con varios workers deberá usar un almacén compartido.

El histórico incluye hasta ocho registros recientes para la interfaz y hasta
tres resúmenes por ruta. Los cálculos se realizan sobre todos los comparables
del nivel seleccionado.

Cada registro mostrado usa como referencia su folio real, por ejemplo
`VXS-05863`. La respuesta también incluye hasta doce resúmenes
ruta–transportista, ordenados por cantidad de viajes, con:

- Viajes observados.
- Folios recientes que respaldan el resumen.
- Costo habitual.
- Venta all-in habitual.
- Margen habitual en importe y porcentaje.
- Cantidad de viajes con margen negativo.

El margen es el resultado comercial registrado por VAX, no la utilidad del
transportista. Los nombres de transportistas sólo se resuelven y muestran en el
backend y la interfaz local; no se envían a OpenAI. El modelo recibe hasta
cuatro folios desidentificados para poder citar referencias reales.

El modelo sólo produce:

- Estado de evidencia.
- Explicación comercial.
- IDs de evidencia.
- Limitaciones.

El backend descarta cualquier ID que no haya sido enviado y construye las citas
desde el registro local.

## Recuperación

La jerarquía histórica es:

1. Misma ruta, equipo, división y tipo de servicio.
2. Misma ruta, equipo y división.
3. Misma ruta y equipo.
4. Rutas comparables por división, equipo, servicio y distancia.

Esta jerarquía se aplica primero a los seis meses anteriores a la cotización.
Si no existe una coincidencia de la misma ruta en ese periodo, se permite usar
histórico anterior antes de recurrir a otra ruta. La interfaz lo identifica
como información anterior a seis meses y muestra en lenguaje comercial el
cambio observado entre el primer y el último periodo disponible.

La evidencia comercial se construye exclusivamente desde `All in rate costo`
y `All in rate venta`. Se excluyen de forma expresa `COSTO EN MXN`,
`VENTA EN MXN`, `All in rate costo total` y `All in rate venta total`. Esta
capa no cambia el objetivo con el que ya fueron entrenados los modelos de
pricing.

El cotizador intenta cargar primero el paquete ONNX. `/api/health` publica el
runtime activo, el formato del artefacto y los 28 modelos distribuidos en los
cuatro componentes. La interfaz presenta los resultados del modelo histórico,
el apoyo geográfico, la protección de costo, el comparador nacional y la
combinación final. En modo `auto`, el paquete anterior queda disponible como
respaldo si ONNX no puede inicializarse.

La distancia se resuelve en este orden: valor ingresado, caché local y Google
Maps. Una ruta nueva resuelta correctamente se agrega a
`data/processed/google_maps_route_cache.csv`; las consultas posteriores usan
el caché y no vuelven a consumir Google. La clave permanece en `.env` y nunca
se incluye en respuestas o archivos de caché.

La recuperación documental combina coincidencia por palabras, similitud por
fragmentos de texto, metadatos y embeddings opcionales con Reciprocal Rank
Fusion. Devuelve como máximo cuatro fragmentos y dos por fuente.

La RAG incluye la segmentación congelada de 14 regiones del modelo National
Geo. Para una ruta National con coordenadas completas, el backend identifica
la región comercial del origen, la del destino y el corredor regional. El
copiloto recibe además un indicador confiable que señala si esa segmentación
participó realmente en el costo elegido.

Cuando participó, la explicación indica en lenguaje comercial que había poca
experiencia en la ruta exacta y que se utilizaron rutas entre zonas parecidas
como apoyo. Cuando no participó, la región sólo puede aparecer como contexto.
Los nombres regionales son aproximaciones internas: no representan fronteras
estatales, corredores oficiales ni distancia carretera.

La segmentación sólo es elegible para National, equipos distintos de LTL y
rutas con coordenadas completas. En el resultado combinado participa para
rutas nuevas o con hasta tres viajes; con cuatro o más viajes el historial
exacto tiene prioridad. Si ventas selecciona directamente la alternativa
geográfica, el corredor regional se considera parte de esa alternativa.

Los embeddings de documentos se generan offline. En runtime sólo se representa
la consulta cuando el índice existe. Si no existe o la consulta semántica falla,
la recuperación local continúa disponible.

El runtime compara el checksum del corpus contra el registrado por los
embeddings. Después de modificar documentos, un índice semántico anterior se
desactiva automáticamente hasta reconstruirlo; la recuperación textual y por
metadatos permanece activa y no genera consumo de OpenAI.

El constructor offline acepta `--max-records` y `--max-total-tokens`; los
valores iniciales son 500 fragmentos y 150,000 tokens. Valida ambos antes de la
primera llamada y no tiene reintentos automáticos.

## Lenguaje y límites

La interfaz usa costo habitual, venta habitual, margen habitual, rango
observado, misma ruta y ruta comparable. Los nombres técnicos de los cálculos
no se muestran a ventas.

Los documentos son contexto, no causa del precio, salvo que el cotizador
indique expresamente que una variable participó en el cálculo. Una fuente
vencida se etiqueta como referencia histórica.

No se envían herramientas, web search, MCP, File Search ni documentos
completos. Los accesoriales están excluidos de recuperación y prompt.

## Validación

Las pruebas automatizadas cubren:

- Corte point-in-time estricto.
- Dirección de ruta.
- Venta all-in y fórmula de margen.
- Ventana primaria de seis meses y fallback antiguo con fluctuación.
- Exclusión de campos MXN y campos all-in total en la evidencia comercial.
- Carga ONNX y equivalencia de salida contra el paquete anterior.
- Folios históricos reales y agregación separada por ruta y transportista.
- Exclusión de nombres de transportistas del prompt.
- Ventas ausentes y márgenes negativos.
- Exclusión de accesoriales.
- Máximo de dos fragmentos por fuente.
- Request de Responses API sin herramientas y con esquema estricto.
- Topes de entrada, salida, cuota diaria y ausencia de reintentos.
- Conservación del precio cuando el copiloto está desactivado.
- Ausencia total de llamadas al copiloto durante `POST /api/quote`.
- Selección explícita de una alternativa antes de `POST /api/copilot/explain`.
- Uso del costo original guardado en el servidor.

Antes de cambiar a Luna se deben ejecutar los mismos casos offline y el piloto
de 100 cotizaciones, comparando calidad, citas, abstención, latencia, tokens y
costo por explicación aprobada.
