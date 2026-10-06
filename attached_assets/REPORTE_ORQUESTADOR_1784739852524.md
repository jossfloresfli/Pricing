# Reporte técnico del Protected Cost Orchestrator

## Función de esta capa

El orquestador convierte varias predicciones en una recomendación operativa
trazable. No entrena árboles ni intenta descubrir por sí mismo el costo. Su
responsabilidad es ejecutar componentes de manera segura, validar sus contratos,
combinar solo los modelos autorizados, aplicar protección contra subestimación y
abstenerse cuando los datos o resultados no son confiables.

Separar esta lógica del frontend evita que dos páginas seleccionen modelos de
forma diferente. La interfaz debe consumir la decisión del router y mostrar sus
razones; no debe volver a implementar los pesos o elegir el menor valor para
hacer una cotización “más competitiva”.

## Componentes que carga

`BundlePaths` verifica que existan los cuatro estados JSON. `load_bundle`
reconstruye cada bundle y reemplaza los objetos LightGBM por adaptadores de ONNX
Runtime. Se cargan Champion, Quantile Risk, National Geo y National Hybrid.

El orquestador valida además los tipos de artefacto de los tres challengers. Si
un archivo se intercambia accidentalmente o cambia de estructura, la carga falla
antes de servir predicciones. El manifiesto aporta verificación adicional por
SHA-256.

## Preparación previa

`ProtectedCostService.prepare` recibe el request operativo. Busca origen y
destino, consulta la caché, resuelve distancia y geografía y llama a
`prepare_quote`. Esta función normaliza texto, genera `route_key`, deriva
`route_type`, convierte la fecha en mes, trimestre y día de semana y conserva IDs
y moneda.

Origen, destino y tipo de equipo son obligatorios. Si la ruta no está en caché,
el sistema anfitrión debe proporcionar `distance_km` y, de ser posible, las
coordenadas y elevaciones en `geo`. Una ruta desconocida sin enriquecimiento no
debe llegar a los modelos como distancia cero.

Antes de inferencia se elimina `realized_cost_mxn`. Esto impide que una etiqueta
conocida durante evaluación se convierta accidentalmente en variable predictora.

## Ejecución segura de componentes

Cada predictor se llama mediante `_safe_call`. Una excepción no se propaga como
un precio parcial silencioso: se registra en `component_errors`. Si Champion
falla, el centro del bundle de riesgo puede servir como fallback. Si Geo o Hybrid
fallan, dejan valores no disponibles. Cualquier error de componente activa el
guardrail `component_failure`.

Este diseño favorece abstención sobre disponibilidad engañosa. El backend puede
seguir respondiendo con diagnóstico, pero la política bloquea la decisión cuando
una pieza necesaria no es confiable.

## Construcción del costo central

La primera opción es `champion_prediction_mxn`, siempre que sea finita y positiva.
Si no, se usa `risk_central`. Después se consulta la división y el historial de
ruta aportado por Quantile Risk.

Para National se calcula un peso Geo. Una ruta con cero antecedentes recibe 50 %;
una ruta con una a tres observaciones recibe 25 %; una ruta con cuatro o más
recibe cero. El blend solo ocurre si Geo y centro son finitos y positivos. La
fórmula es `(1 - peso_geo) * centro + peso_geo * geo`.

Para Crossborder, Domestic y Port Freight no se aplica este blend. El router
posterior conserva además una precedencia explícita para Crossborder.

## Construcción del costo protegido

El P67 crudo se reemplaza por el centro si no está disponible. Después se define
`base_protected = max(central, raw_q67)`. Esto garantiza que la protección no
reduzca el centro.

El calibrador jerárquico puede sumar un ajuste residual no negativo aprendido
con predicciones fuera de muestra. El resultado final es
`max(base_protected + ajuste, central)`. En este deployment el calibrador inicia
sin ajustar y devuelve cero. Su estado sin ajustar es intencional y activa un
guardrail para impedir automatización.

La calibración futura debe entrenarse solo con predicciones point-in-time fuera
de muestra y costos realizados. Sus niveles van de celdas específicas por
equipo, banda, decil e historial a niveles más generales, con shrinkage hacia el
padre. Nunca debe usar la banda del costo realizado como clave de inferencia,
porque esa variable no existe al cotizar.

## Construcción del intervalo

Quantile Risk y National Hybrid producen intervalos. El orquestador toma el
menor límite inferior disponible y el mayor límite superior. Recorta el inferior
en cero y obliga al superior a no quedar por debajo del costo protegido.

Esta unión deliberadamente conservadora puede generar bandas amplias. Su función
es mostrar el rango de error observado y desacuerdo, no determinar el precio
comercial. La política marca `prediction_interval_too_wide` si la anchura supera
125 % del centro. Si ningún componente aporta intervalo, registra
`prediction_interval_unavailable`.

## Guardrails estrictos

La política evalúa cada fila y genera una lista de razones. Revisa:

- Presencia de origen, destino, ruta, equipo y división.
- Moneda confirmada como MXN.
- Champion, centro y costo protegido positivos y finitos.
- Que el protegido no quede por debajo del centro.
- Disponibilidad, orden y anchura del intervalo.
- Confianza del Hybrid de al menos 45 % cuando está disponible.
- Desacuerdo de alternativas contra Champion no mayor a 40 %.
- Uplift protegido no mayor a 50 % del centro.
- Costo protegido por kilómetro entre 1 y 500 MXN/km.
- Historial mínimo de cuatro para equipo especial.
- Disponibilidad de segmentos para equipo especial.
- Ausencia de revisión manual solicitada por Hybrid.
- Ausencia de fallos de componentes.
- Calibrador ajustado para una futura elegibilidad automática.
- `quote_row_id` presente, no vacío y único dentro del lote.

Los equipos especiales reconocidos son pipa/tanker/cisterna, hazmat/material
peligroso y full container de 40 pies. La detección acepta varios alias y también
columnas booleanas de hazmat.

`auto_quote` dentro de `GuardrailPolicy` representa elegibilidad contrafactual
para un piloto futuro. No prevalece sobre el router externo: la versión actual
siempre termina en `mode: shadow_only`, `auto_quote: false` y
`review_required: true`.

## Router segmentado y precedencia

El router vuelve a interpretar la salida desde la perspectiva comercial. Para
National con historial menor o igual a tres, predicción Geo válida y las cuatro
coordenadas presentes, toma el centro integrado y lo etiqueta
`lightgbm_geo_hierarchical`. En otro caso usa Champion y lo etiqueta
`lightgbm_incumbent`.

Crossborder mantiene el incumbente y no activa P67 desde el router. Fuera de
Crossborder, P67 se activa si el equipo es especial, la división es Port Freight,
la ruta es nueva, tiene bajo historial o Champion cae en D7, D8 o D10. Si P67 se
activa, se elige el máximo entre el centro y el costo protegido integrado.

La ausencia de P67 cuando se requiere no produce una cifra inventada; añade
`p67_unavailable` y exige revisión. La ausencia de coordenadas también requiere
revisión de mercado. Las razones estrictas del guardrail pueden bloquear
completamente la emisión de tarifa.

## Deciles de enrutamiento

Los nueve límites en MXN son 13,623.08; 19,601.40; 22,776.13; 27,671.56;
33,443.52; 40,702.41; 45,369.14; 56,542.87; y 77,893.24. Dividen la predicción
en D1 a D10.

Fueron derivados retrospectivamente de cuantiles de predicción del incumbente en
la auditoría del 2 de enero al 26 de junio de 2026. El archivo los etiqueta como
`provisional_posthoc_2026_not_for_promotion`. Sirven para congelar el
comportamiento de la interfaz beta, pero deben someterse a prueba prospectiva
antes de usarse como política productiva.

## Qué valor debe mostrar la interfaz

El valor recomendado para la beta está en `routing.selected_cost_mxn`. Debe
acompañarse con `selected_model`, `reasons`, `strict_guardrail_reasons` y
`action`. Si `decision_blocked` es verdadero, no debe habilitarse el botón de
emitir tarifa desde esa salida.

`central_cost_mxn` permite explicar la referencia sin protección.
`full_combination_mxn` muestra el costo protegido integrado. En `components` se
conservan Champion, Geo, P67, Hybrid y blends para auditoría. Estos componentes
no son opciones para que el usuario escoja manualmente el menor.

El intervalo puede mostrarse como diagnóstico con una leyenda clara: es un rango
de incertidumbre histórica y no un rango de precios comerciales aceptables.

## Campos de salida del predictor

`quote_id` y `row_id` permiten trazabilidad. `currency` debe ser MXN. `equipment`
es el equipo normalizado. `champion_prediction_mxn` es el incumbente.
`central_prediction_mxn` incorpora el blend Geo cuando aplica.
`protected_cost_mxn` aplica P67 y calibración. `raw_q67_mxn` conserva el cuantil.
`geo_prediction_mxn` deja visible al challenger.

`route_history_count`, `history_level`, `cost_band` y `prediction_decile`
describen soporte y segmentación. Con calibrador sin ajustar, banda y decil del
calibrador aparecen como `unavailable`; el router calcula aparte su decil
congelado.

`equipment_guardrail`, `auto_quote`, `review_required`, `decision_status` y
`guardrail_reasons` explican abstención. `interval_low_mxn` e
`interval_high_mxn` describen incertidumbre. `model_path` registra la fórmula
interna, incluyendo peso Geo, protección, calibración y modo sombra.

## Casos operativos explicados

Una ruta National nueva con coordenadas usa 50 % Champion y 50 % Geo. Como el
historial es cero, P67 se activa. La interfaz muestra el máximo entre el blend y
el protegido, exige validación con Operaciones/Procurement y registra ambos
modelos.

Una ruta National soportada con Dryvan usa Champion como centro. P67 solo se
activa si la predicción cae en un decil protegido u otra regla. Aunque no haya
una abstención estricta, la beta sigue requiriendo comparación contra carrier.

Una ruta Port Freight usa Champion/base y P67. Hybrid puede aportar un intervalo
Port Freight, pero no activa especialista. Debido al margen q95 históricamente
alto de la división, es normal que el intervalo sea más ancho y debe revisarse.

Una ruta Crossborder conserva Champion. Los candidatos residuales permanecen
como diagnóstico. Si faltan datos críticos o hay fallos, la decisión se bloquea.

Un equipo hazmat con menos de cuatro antecedentes activa P67 y a la vez el
guardrail `hazmat:insufficient_route_history`. El costo protegido puede mostrarse
para análisis, pero no debe emitirse como tarifa automática.

## Integración correcta en una página

El frontend no debe cargar 28 modelos ni construir variables. Debe llamar a un
endpoint del backend. El backend conserva una instancia de
`ProtectedCostService`, valida autenticación y payload, ejecuta `predict` y
retorna JSON serializable. También registra versión, latencia y decisión.

Conviene separar errores de request, ruta fuera de caché, fallo interno y
abstención del modelo. Una abstención es una respuesta válida de negocio, no un
HTTP 500. En cambio, un artefacto ausente o hash incorrecto debe impedir que la
instancia se declare saludable.

## Validación antes de promoción

La beta debe recopilar resultados point-in-time sin alterar todavía la decisión
del mercadólogo. Se deben comparar Champion, centro integrado, P67 y precio
seleccionado contra costo realizado. La evaluación principal debe ponderar
subestimación y considerar margen, pero también medir sobreestimación porque
puede reducir aceptación.

La promoción requiere umbrales previamente definidos, intervalos de incertidumbre
de las métricas, evaluación por segmentos y capacidad de revisión. También debe
definirse rollback, responsable operativo, ventana de observación y tratamiento
de estacionalidad. Una mejora retrospectiva aislada no basta.

## Riesgos de negocio

Una protección demasiado alta puede reducir competitividad o aceptación. Una
protección insuficiente puede erosionar margen. La beta debe medir ambas caras y
no optimizar únicamente MAE. El precio mostrado puede cambiar el comportamiento
de usuarios y carriers, alterando los datos futuros; ese feedback debe quedar
registrado.

Este sistema ofrece apoyo a la decisión, no sustituye controles financieros,
comerciales, legales o de cumplimiento para materiales peligrosos y operaciones
especiales.

## Archivos de esta capa

`integration.py` ejecuta y combina componentes. `calibration.py` define la
calibración jerárquica. `policy.py` contiene guardrails estrictos.
`segmented_router.py` selecciona el valor mostrado y genera la acción. La política
de deciles está en `config/router_policy.json`; el contrato se encuentra en
`config/inference_contract.json`.
