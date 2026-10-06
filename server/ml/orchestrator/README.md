# Protected Cost Orchestrator en ONNX

## Propósito de este paquete

Esta carpeta contiene todo lo necesario para ejecutar, desde otro ecosistema,
el cotizador experimental de costo protegido. No contiene una interfaz web y no
pretende reemplazar el software ya construido. Su función es aportar al backend
existente un servicio de inferencia que recibe los datos de una ruta, prepara
las mismas variables usadas durante el entrenamiento, ejecuta varios modelos y
devuelve una recomendación de costo acompañada por señales de riesgo.

El problema de negocio no es únicamente estimar el costo promedio de una ruta.
También se busca evitar que el mercadólogo cotice demasiado bajo cuando la ruta
es nueva, hay poco historial, se usa equipo especial o los modelos no coinciden.
Por eso este deployment contiene varios modelos con responsabilidades distintas.
No todos compiten por ser “el ganador”: algunos estiman el centro, otros aportan
protección, otros sirven como challenger y una política final decide cuándo la
salida necesita revisión.

La versión entregada permanece en modo `shadow_only`. Esto significa que puede
mostrarse a los empleados durante una beta, compararse con cotizaciones y costos
reales y registrar decisiones, pero no debe enviar automáticamente una tarifa a
un cliente ni modificar una cotización sin aprobación humana.

## Cómo entender el sistema completo

El flujo comienza con el request del software anfitrión. `ProtectedCostService`
normaliza origen, destino, división, equipo, cliente, proveedor y fecha. Después
consulta la caché de rutas para obtener distancia, coordenadas y elevaciones. Con
estos datos ejecuta cuatro componentes:

1. El ensamble LightGBM vigente o `champion` produce la referencia central.
2. El bundle de cuantiles produce otro centro, el cuantil P67, historial de ruta
   y un intervalo empírico.
3. El modelo National Geo aporta información geográfica para rutas National con
   poco o ningún historial.
4. El modelo National Hybrid compara el incumbente con un especialista por
   ruta-equipo y aporta confianza e intervalo para National y Port Freight.

El orquestador integra las salidas. El champion es el centro de partida. Si no
está disponible se intenta usar el centro del bundle de riesgo. Para National,
el Geo se usa como estimación central única cuando la ruta es nueva o tiene de
una a tres observaciones; con cuatro o más se mantiene el champion. Después el P67 actúa
como piso: el costo protegido nunca puede quedar por debajo del costo central.
Finalmente se aplican guardrails y el router decide qué valor presentar y por
qué exige revisión.

Esta separación es importante. “Usar el modelo P67” no significa sustituir
siempre al LightGBM central. Significa agregar una protección en los casos donde
el costo de subestimar es mayor. “Usar Geo” tampoco significa que Geo sea el
modelo productivo general; significa permitir que ayude en rutas National con
poco historial y coordenadas completas.

## Qué modelo usar en cada caso

La selección ya está codificada en el orquestador y no debería replicarse con
condicionales diferentes en la interfaz. La siguiente matriz resume la política
vigente porque es una relación operativa que conviene ver de forma compacta:

| Caso | Centro utilizado | Protección | Acción |
|---|---|---|---|
| Crossborder | Champion incumbente | No se fuerza P67 desde el router | Conservar incumbente y revisar |
| National, ruta nueva, con coordenadas | 100 % National Geo | P67 | Revisión de mercado obligatoria |
| National, historial de 1 a 3, con coordenadas | 100 % National Geo | P67 | Revisión obligatoria |
| National, historial de 4 o más | Champion | P67 solo si otro criterio de riesgo lo activa | Comparar contra carrier; sigue en sombra |
| Port Freight | Champion/base | P67 | Revisión obligatoria |
| Equipo especial: pipa, hazmat o contenedor completo de 40 pies | Centro permitido por división | P67 | Revisión; puede bloquearse por bajo historial |
| Decil de predicción D7, D8 o D10 | Centro permitido por división | P67 | Revisión en sombra |
| Ruta sin coordenadas | Champion | Según demás reglas | Marcar ausencia de Geo y revisar |
| División fuera de alcance o datos críticos faltantes | Sin automatización segura | No aplica | Cotización manual |

Los límites de deciles provienen del archivo `config/router_policy.json`. Son una
ayuda de enrutamiento congelada obtenida de la auditoría retrospectiva de 2026;
no constituyen evidencia prospectiva para promover el modelo. D9 no aparece en
la lista protegida vigente porque la política almacenada selecciona D7, D8 y
D10. Si el negocio desea modificar esa regla, debe validarla primero y versionar
la política, no cambiarla silenciosamente en el frontend.

## Responsabilidad de cada componente

### Champion: LightGBM vigente

Es el punto de referencia general. Consiste en tres LightGBM entrenados con las
semillas 42, 2026 y 9001. Cada uno predice el logaritmo del costo; después se
aplica `expm1`, se impiden valores negativos y se promedian las tres respuestas.
Usa variables de calendario, distancia, frecuencia de categorías y target
encoding de origen y destino.

Debe usarse como centro general y como fallback cuando un challenger no tiene
cobertura. No representa por sí solo incertidumbre ni garantiza que el costo
real quede por debajo. El reporte completo está en
`experiments/modelos_v2_2026/segmentation_hybrid/REPORTE_MODELO_CHAMPION.md`.

### Quantile Residual Risk

Este bundle contiene 16 modelos ONNX. Incluye ensambles centrales, ensambles de
cuantiles P60, P67 y P75, un centro con variables históricas y un modelo residual
para Crossborder. El candidato seleccionado dentro del bundle continúa siendo
`enhanced_global_baseline`; la arquitectura nueva no fue promovida. Sin embargo,
el P67 sí se utiliza como piso de protección porque refleja una pérdida
asimétrica donde subestimar cuesta dos veces más que sobreestimar.

P67 no es un intervalo de confianza ni promete cobertura individual de 67 %.
Es una estimación condicional de un cuantil del costo. Los intervalos mostrados
se construyen por separado con el percentil 95 del error absoluto fuera de
muestra por división. El reporte está en
`experiments/modelos_v2_2026/quantile_residual_risk/REPORTE_MODELO_CUANTILES.md`.

### National Geo History

Es un challenger exclusivo para división National y excluye LTL. Usa distancia,
coordenadas, regiones geográficas, elevación y duración de viaje estimada,
además de las categorías tradicionales. Los extremos geográficos se agrupan en
14 regiones mediante centros KMeans conservados en JSON. Tres LightGBM generan
la predicción final por promedio.

Su propia decisión experimental indica `guardrails_not_met` y
`production_replacement: false`. Por eso el orquestador solo permite que aporte
parcialmente en rutas National nuevas o de bajo historial. No debe invocarse
como reemplazo general. El reporte está en
`experiments/modelos_v2_2026/national_geo_history/REPORTE_MODELO_NATIONAL_GEO.md`.

### National Route-Equipment Hybrid

Combina tres modelos base equivalentes al incumbente y tres modelos especialistas
National. En National, si existe al menos una observación para la combinación
ruta-equipo y el equipo no es LTL, usa 50 % base y 50 % especialista. Si no hay
soporte, vuelve al base. En Port Freight usa únicamente el base. Otras divisiones
quedan en revisión manual.

Este componente calcula una confianza heurística basada en soporte de ruta,
cliente, equipo y ruta-equipo, penalizada por desacuerdo y datos faltantes. Esa
confianza no es una probabilidad calibrada de acierto. En el orquestador actual
su predicción se conserva como diagnóstico y sus intervalos alimentan el rango
conservador. El reporte está en
`experiments/modelos_v2_2026/national_port_only/REPORTE_MODELO_NATIONAL_HYBRID.md`.

### Orquestador, calibración y política

El orquestador no es otro regresor. Es la capa que combina componentes, se
abstiene ante fallos y aplica reglas operativas. La calibración jerárquica está
diseñada para aprender ajustes residuales por equipo, banda, decil e historial,
pero en este paquete inicia sin ajustar. En ese estado agrega cero pesos y el
guardrail `calibrator_not_fitted` evita interpretar la salida como elegible para
automatización.

La explicación completa del orden de precedencia, los guardrails y los campos
de salida se encuentra en
`experiments/modelos_v2_2026/protected_cost_orchestrator_20260717/REPORTE_ORQUESTADOR.md`.

## Entradas requeridas

El software anfitrión puede enviar nombres operativos como `ORIGEN`, `DESTINO`,
`Tipo de Equipo`, `DIVISION`, `CLIENTE`, `PROVEEDOR` y `RANGO`. La fachada los
normaliza a minúsculas, elimina acentos, compacta espacios y crea `route_key`.
Origen, destino y tipo de equipo son obligatorios.

Para tener trazabilidad deben enviarse también `quote_id`, un `quote_row_id`
único y estable, `currency` igual a MXN y la fecha de creación. Si no existe la
fecha se usa el momento actual, lo cual puede cambiar las variables de mes,
trimestre y día de semana y por tanto debe evitarse en procesos reproducibles.

La distancia debe estar en kilómetros. El caché incluido guarda metros y el
servicio los convierte a kilómetros. Coordenadas usan grados decimales y la
elevación usa metros. No deben intercambiarse unidades ni calcularse distancia
en millas.

El contrato formal está en `config/inference_contract.json`. El costo real
`realized_cost_mxn` nunca es una variable de inferencia: si aparece como etiqueta
de evaluación, el orquestador lo elimina antes de llamar a los modelos.

## Caché de rutas y conexión a la base original

El archivo utilizado es `data/google_maps_route_cache.csv`. El servicio busca la
clave normalizada `origen -> destino`, exige distancia válida y recupera
coordenadas y elevaciones cuando existen. Si una ruta no está en caché, el
backend puede consultar la base original y pasar `distance_km` y `geo` al
servicio. La consulta y limpieza deben producir el mismo esquema y unidades.

No es seguro inventar una distancia, usar cero o reutilizar una ruta parecida.
Cuando no se puede enriquecer una ruta nueva, debe regresarse una condición de
revisión manual. El software anfitrión es responsable de actualizar su fuente de
datos; este paquete solo lee la caché incluida.

## Uso desde Python

Crear un ambiente, instalar dependencias y ejecutar la prueba:

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python tests\smoke_test.py
```

En el backend debe construirse una sola instancia y reutilizarse. Cada instancia
abre las sesiones ONNX de manera diferida y las conserva para peticiones futuras.

```python
from protected_cost import ProtectedCostService

service = ProtectedCostService()

result = service.predict(
    {
        "quote_id": "Q-1001",
        "quote_row_id": "Q-1001-1",
        "currency": "MXN",
        "ORIGEN": "Guadalajara, Jalisco",
        "DESTINO": "Monterrey, Nuevo Leon",
        "Tipo de Equipo": "Dryvan 53",
        "DIVISION": "National",
        "CLIENTE": None,
        "PROVEEDOR": None,
        "RANGO": None,
    },
    created_at="21/07/2026",
)
```

La interfaz debería mostrar `routing.selected_cost_mxn`, el modelo seleccionado,
las razones y la acción recomendada. También puede mostrar el centro, el costo
protegido y el intervalo como contexto. No debería presentar el límite superior
como “precio correcto” ni el intervalo como garantía.

## Integración con otros lenguajes

ONNX Runtime tiene APIs para C#, Java, C/C++, Node.js y otros entornos. Cada
archivo ONNX recibe una matriz `float32` llamada `features`. El orden exacto de
las columnas está en el JSON del bundle correspondiente. El inventario de los
28 archivos se explica en `artifacts/models/README.md`.

Los grafos ONNX contienen los árboles, pero no incorporan toda la preparación ni
la política comercial. Una implementación nativa debe reproducir exactamente:

1. La normalización de `protected_cost/preprocessing.py`.
2. El enriquecimiento de `protected_cost/route_cache.py`.
3. Las transformaciones y orden de variables de cada pipeline.
4. El promedio de semillas y la inversión de `log1p` cuando corresponda.
5. El uso de Geo al 100 % en rutas National nuevas o de bajo historial y el piso P67.
6. La construcción de intervalos y diagnósticos.
7. Los guardrails, abstenciones y precedencia del router.

La opción inicial de menor riesgo es desplegar este paquete como microservicio
Python interno y consumir JSON desde el backend principal. Una implementación
completamente nativa es viable, pero debe aprobar pruebas de paridad extremo a
extremo; comparar únicamente la salida de un archivo ONNX no valida el sistema.

## Interpretación de las salidas

`champion_prediction_mxn` es el estimado del incumbente. `central_prediction_mxn`
es el centro después de aplicar fallback y, cuando corresponde, el aporte Geo.
`raw_q67_mxn` es el piso cuantil. `protected_cost_mxn` es el máximo entre centro
y P67 más un ajuste calibrado, que actualmente es cero porque el calibrador está
sin ajustar.

`interval_low_mxn` e `interval_high_mxn` forman un rango diagnóstico construido
con errores históricos. Un intervalo ancho indica incertidumbre, desacuerdo o
un segmento históricamente difícil. No significa que todo precio dentro del
rango sea comercialmente recomendable.

`decision_status`, `review_required`, `guardrail_reasons` y `routing.action`
explican si faltan datos o se excede un límite. En esta beta el router siempre
devuelve `auto_quote: false` y `review_required: true`, incluso cuando una fila
aparece como contrafactualmente elegible en la política interna.

## Guardrails principales

La salida se marca para revisión cuando faltan origen, destino, ruta, equipo o
división; la moneda no está confirmada como MXN; no existe una predicción válida;
el intervalo es inválido o mide más de 125 % del centro; la confianza híbrida es
menor a 45 %; un challenger difiere más de 40 % respecto al champion; la
protección excede 50 % del centro; el costo por kilómetro queda fuera de 1 a 500
MXN/km; el equipo especial tiene menos de cuatro antecedentes; falta un ID
estable; falla algún componente; o el calibrador no está ajustado.

Estos umbrales son controles operativos, no leyes estadísticas. Deben revisarse
con evidencia prospectiva, capacidad de revisión humana y costo de errores antes
de promoverlos.

## Evidencia observada y límites conocidos

Los bundles se entrenaron hasta el 31 de diciembre de 2025. La información de
2026 se conservó como auditoría en los experimentos relevantes y no se usó para
seleccionar el challenger Geo. El bundle de riesgo también declara selección
basada en folds temporales pre-2026. Estas son propiedades registradas en los
artefactos, no una afirmación de que el modelo mantendrá el mismo rendimiento en
el futuro.

El Geo reporta 3,045 filas pre-2026, 1,610 de auditoría 2026 y 2,559 filas tras
ventana y recorte para cada modelo final. El especialista National registra
2,030 filas. El bundle de riesgo registra 4,514 filas para los centros recortados
y 4,560 para cuantiles; el residual Crossborder registra 1,683. El champion no
guarda en su estado el conteo final de entrenamiento, por lo que no se inventa
una cifra en esta documentación.

Ninguno de estos modelos demuestra causalidad ni estima disposición a pagar.
Predicen costo a partir del historial observado. Si las cotizaciones modifican
qué cargas se aceptan, qué carriers participan o qué costos llegan a registrarse,
se produce un ciclo de retroalimentación que debe vigilarse.

## Monitoreo recomendado para la beta

Registrar por cada petición la versión del manifiesto, variables normalizadas,
presencia en caché, modelos ejecutados, latencia, centro, P67, precio seleccionado,
intervalo, guardrails, usuario que revisó y decisión final. Cuando se conozca el
costo realizado, asociarlo mediante `quote_row_id` sin introducirlo a inferencia.

Medir MAE, sesgo, proporción de subestimaciones, pérdida asimétrica, cobertura y
anchura del intervalo. Separar resultados por división, familia de equipo,
corredor, decil de precio, ruta nueva/bajo historial/soportada, presencia del
proveedor y disponibilidad geográfica. También medir métricas de negocio como
margen, tiempo de cotización, tasa de aceptación y carga de revisión, sin asumir
que una correlación representa impacto causal.

Definir alertas por cambios de frecuencia, distancia, equipos desconocidos,
porcentaje de rutas fuera de caché, desacuerdo entre modelos y subestimaciones
severas. Un aumento persistente, un fallo de integridad o una violación de
invariantes debe activar rollback al flujo manual o al champion anterior.

## Estructura que debe desplegarse

- `artifacts/models/*.onnx`: los 28 modelos.
- `artifacts/states/*.json`: variables, mapas, parámetros y referencias.
- `artifacts/manifest.json`: inventario, opset 15 y SHA-256.
- `config/inference_contract.json`: contrato e invariantes.
- `config/router_policy.json`: política segmentada.
- `data/google_maps_route_cache.csv`: caché geográfica.
- `protected_cost/`: fachada, limpieza, caché y cargador ONNX.
- `experiments/modelos_v2_2026/`: pipelines, integración y reportes técnicos.
- `src/vax_pricing/trip_duration.py`: reglas de duración de viaje.
- `requirements.txt`: dependencias mínimas.
- `tests/smoke_test.py`: prueba integral.

Debe copiarse la carpeta completa conservando rutas relativas. No se requiere
ningún `.joblib`, LightGBM ni scikit-learn para inferencia.

## Integridad y validación de la conversión

Los 28 modelos pasan `onnx.checker` y sus SHA-256 coinciden con el manifiesto.
La prueba integral carga caché, construye variables, ejecuta todos los componentes
y produce una decisión. En el caso de humo, la diferencia contra Joblib fue de
aproximadamente 0.19 MXN para el centro y 0.04 MXN para el costo protegido. La
diferencia proviene de la entrada `float32` de ONNX y no cambió el modelo elegido
ni la decisión.

El exportador reproducible está en la versión Joblib:
`deployment/protected_cost_orchestrator/tools/export_onnx_bundles.py`. Al generar
una nueva versión deben volver a validarse hashes, paridad, segmentos, intervalos
y política completa.
