# Inventario y función de los modelos ONNX

Esta carpeta contiene 28 grafos ONNX. Los nombres codifican el bundle, la ruta
dentro del estado JSON y la posición de la semilla. Los archivos no incluyen la
normalización, los mapas de categorías ni la política; deben consumirse mediante
los estados de `artifacts/states` y los pipelines documentados.

Todos usan opset 15 y reciben una entrada `features` de tipo `float32` con forma
`[N, número_de_variables]`. La salida es la predicción nativa del LightGBM
convertido. Para la mayoría de los modelos de costo está en escala `log1p` y el
pipeline aplica `expm1`. El modelo residual es una excepción y su pipeline aplica
directamente el ajuste con límites.

## Champion: tres archivos

`champion__root.models.0.model.onnx`, `.1` y `.2` corresponden a las semillas 42,
2026 y 9001. Cada uno usa 16 variables. Se promedian para producir el estimado
central vigente. No debe ejecutarse un solo seed como si fuera el ensamble.

Estado requerido: `artifacts/states/champion.json`.

Reporte: `experiments/modelos_v2_2026/segmentation_hybrid/REPORTE_MODELO_CHAMPION.md`.

## National Geo: tres archivos

`national_geo__root.models.0.model.onnx`, `.1` y `.2` corresponden a las mismas
tres semillas. Cada uno usa 44 variables de calendario, distancia, geografía,
elevación, duración, frecuencia y categorías. El promedio es el challenger Geo.

Los centros KMeans no son archivos ONNX separados porque su operación de
inferencia se conserva como centros numéricos en JSON y se reproduce con distancia
al centro más cercano.

Estado requerido: `artifacts/states/national_geo.json`.

Reporte: `experiments/modelos_v2_2026/national_geo_history/REPORTE_MODELO_NATIONAL_GEO.md`.

## National Hybrid: seis archivos

Los tres archivos `national_hybrid__root.base_bundle.models.*.model.onnx` forman
el ensamble base de 16 variables. Los tres archivos
`national_hybrid__root.national_specialist.*.model.onnx` forman el especialista
National de 37 variables.

Para National con soporte ruta-equipo, el pipeline promedia los seeds de cada
familia y después mezcla 50 % base y 50 % especialista. Para National sin soporte,
LTL y Port Freight, aplica las reglas de fallback documentadas. No deben
promediarse los seis archivos directamente.

Estado requerido: `artifacts/states/national_hybrid.json`.

Reporte: `experiments/modelos_v2_2026/national_port_only/REPORTE_MODELO_NATIONAL_HYBRID.md`.

## Quantile Risk: dieciséis archivos

Los tres `enhanced_global_baseline.*` son el centro mejorado seleccionado del
bundle y usan 22 variables. Los tres `history_central.*` usan 32 variables y
añaden historial. Los tres `enhanced_quantile_060.*`, los tres
`enhanced_quantile_067.*` y los tres `enhanced_quantile_075.*` estiman P60, P67 y
P75 con 22 variables.

`quantile_risk__root.models.residual_model.model.onnx` es el único modelo sin
réplicas. Usa diez variables derivadas y estima un residual para Crossborder.
No es un precio completo.

Cada familia de tres se promedia dentro de sí misma. No deben mezclarse P60, P67
y P75 entre sí ni promediarse con el residual. El orquestador utiliza el baseline
como centro interno, P67 como protección y los errores q95 del estado JSON para
el intervalo.

Estado requerido: `artifacts/states/quantile_risk.json`.

Reporte: `experiments/modelos_v2_2026/quantile_residual_risk/REPORTE_MODELO_CUANTILES.md`.

## Cómo seleccionar el número de variables

El manifiesto registra `n_features` para cada archivo y el estado JSON registra
la lista ordenada. El consumidor debe construir exactamente esa lista y luego
convertirla a `float32`. No se debe ordenar alfabéticamente, eliminar columnas
constantes ni inferir el esquema desde el nombre del archivo.

Un error de orden puede producir números aparentemente válidos pero totalmente
incorrectos, porque ONNX solo recibe posiciones numéricas. Por ello la prueba de
integración debe usar casos de referencia y comparar resultados finales, no solo
verificar que la sesión ejecuta.

## Integridad y versionado

`artifacts/manifest.json` contiene el SHA-256 de cada ONNX, su ruta, número de
variables y bundle. Al iniciar un contenedor deben verificarse hashes o hacerlo
durante la construcción de la imagen. Modelos, estados JSON, código de variables,
caché y política forman una sola versión indivisible.

No se debe reemplazar manualmente un `.onnx` conservando el JSON anterior. Aunque
la forma de entrada coincida, los mapas y la semántica pueden ser diferentes.

## Uso multilenguaje

En cualquier lenguaje el patrón es: crear una sesión ONNX Runtime una vez,
obtener el nombre de entrada, construir una matriz `float32` con el orden del
estado, ejecutar y aplicar el posprocesamiento del pipeline. Las sesiones deben
reutilizarse para reducir latencia.

La portabilidad de ONNX abarca la inferencia de árboles. La selección de modelo,
los mapas de frecuencia/target encoding, `expm1`, los promedios, los pesos Geo,
P67, los intervalos y los guardrails siguen siendo responsabilidad de la
implementación anfitriona.
