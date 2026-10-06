# Reporte técnico de National Geo

## Objetivo y alcance

National Geo es un challenger diseñado para mejorar la estimación de costos en
la división National cuando el nombre exacto de la ruta tiene poco historial.
Su hipótesis es que dos rutas distintas pueden compartir estructura económica si
conectan regiones similares, recorren distancias comparables, presentan perfiles
de elevación parecidos y requieren duraciones de viaje semejantes.

El modelo no cubre Crossborder, Domestic ni Port Freight. Tampoco cubre equipo
LTL. Si se intenta predecir LTL, el pipeline se abstiene. Esta restricción no es
un detalle de la interfaz: forma parte del alcance con el que fue entrenado y
validado.

El artefacto declara que el mejor challenger nuevo fue
`geo_duration_elevation`, pero la selección pre-2026 permaneció en `reference`.
Su estado es `guardrails_not_met`, `production_replacement: false` y la
recomendación es usarlo en sombra. Por eso el orquestador le asigna un peso
parcial en rutas nuevas o con poco historial y nunca lo convierte en sustituto
general del Champion.

## Modelos y datos registrados

El ensamble contiene tres LightGBM, con semillas 42, 2026 y 9001:

- `national_geo__root.models.0.model.onnx`.
- `national_geo__root.models.1.model.onnx`.
- `national_geo__root.models.2.model.onnx`.

Cada modelo usa 44 variables y registra 2,559 filas finales de entrenamiento,
fecha máxima 31 de diciembre de 2025 y recorte del target aproximadamente entre
4,477.60 y 100,800 MXN. El experimento documenta 3,045 filas National pre-2026,
1,610 filas de auditoría 2026 y 78 filas LTL excluidas.

La auditoría reporta 99.68 % de cobertura para coordenadas, elevación y duración
en el conjunto estudiado. Ese porcentaje histórico no garantiza la misma
cobertura en el software nuevo; debe medirse nuevamente desde el primer día.

Los pesos temporales tienen vida media de 240 días. Esto da más influencia a
observaciones recientes. También se aplicó un `provider_dropout` determinista de
65 % durante entrenamiento para hacer al modelo menos dependiente de conocer el
carrier en el momento de cotizar.

## Cómo representa la geografía

El pipeline toma latitud y longitud del origen y destino. Durante entrenamiento
combina todos los extremos y construye 14 regiones con KMeans. En inferencia no
se necesita scikit-learn: los centros están en el JSON y `KMeansRuntime` asigna
cada punto al centro más cercano mediante distancia euclidiana en coordenadas.

De esa asignación nacen `origin_region`, `destination_region` y
`regional_corridor`. También se construye `corridor_equipment`, que combina el
corredor regional con la familia del equipo. Estas variables permiten compartir
información entre rutas exactas distintas.

La distancia euclidiana sobre latitud/longitud es una aproximación para formar
clusters, no una distancia carretera. El costo sigue recibiendo
`google_distance_km`. Si las coordenadas están ausentes, el pipeline puede
imputar medianas guardadas, pero el router detecta que el request original no
tenía las cuatro coordenadas y conserva el Champion con revisión. Esto evita
presentar una imputación como geografía observada.

## Elevación y duración estimada

El modelo usa elevación del origen y destino en metros. Calcula diferencia,
ganancia, pérdida y cambio por kilómetro. Estas variables intentan representar
condiciones que pueden afectar consumo, velocidad y tiempo.

La duración se deriva de distancia y equipo mediante las reglas de
`src/vax_pricing/trip_duration.py`. El artefacto registra la versión
`NOM-087-SCT-2-2017_v1`. Se generan velocidad media estimada, horas de manejo,
número y horas de descansos cortos, número y horas de descansos diarios y
duración total estimada.

Estas variables son estimaciones regladas, no telemetría real ni una promesa de
ETA. Si se modifica la norma, la velocidad o el tratamiento de descansos, cambia
el contrato del modelo y se requiere nueva validación o reentrenamiento.

## Las 44 variables del modelo

El orden exacto es el siguiente:

1. `mes_creacion`.
2. `trimestre_creacion`.
3. `dia_semana_creacion`.
4. `google_distance_km`.
5. `distance_log1p`.
6. `origin_lat`.
7. `origin_lng`.
8. `destination_lat`.
9. `destination_lng`.
10. `origin_elevation_m`.
11. `destination_elevation_m`.
12. `elevation_delta_m`.
13. `elevation_gain_m`.
14. `elevation_loss_m`.
15. `elevation_change_per_km`.
16. `estimated_avg_speed_kmh`.
17. `estimated_driving_hours`.
18. `estimated_short_break_count`.
19. `estimated_short_break_hours`.
20. `estimated_daily_rest_count`.
21. `estimated_daily_rest_hours`.
22. `estimated_trip_duration_hours`.
23. `CLIENTE_key__freq`.
24. `PROVEEDOR_key__freq`.
25. `ORIGEN_key__freq`.
26. `DESTINO_key__freq`.
27. `route_key__freq`.
28. `Tipo de Equipo_key__freq`.
29. `DIVISION_key__freq`.
30. `RANGO_key__freq`.
31. `route_type__freq`.
32. `equipment_family__freq`.
33. `route_equipment__freq`.
34. `client_route_equipment__freq`.
35. `DIVISION_key__code`.
36. `RANGO_key__code`.
37. `route_type__code`.
38. `Tipo de Equipo_key__code`.
39. `equipment_family__code`.
40. `origin_region__code`.
41. `destination_region__code`.
42. `regional_corridor__code`.
43. `corridor_equipment__code`.
44. `provider_missing`.

Aunque la carpeta se llama `national_geo_history`, el candidato exportado tiene
`use_history: false`. No usa target-history de ruta, cliente o corredor. Sí usa
frecuencias congeladas y las variables de geografía, elevación y duración. Esta
distinción evita afirmar que el modelo operativo contiene una característica que
solo fue evaluada en otros candidatos del experimento.

## Preparación e inferencia

Los datos se normalizan igual que en el Champion. Se calculan regiones, familia
de equipo, interacciones geográficas, elevación y duración. Los numéricos faltantes
se imputan con medianas del entrenamiento; categorías nuevas reciben código -1
y frecuencia cero. Cada LightGBM predice `log1p(costo)`, se aplica `expm1`, se
limita a cero y se promedian las tres semillas.

El modelo fue entrenado con pérdida de regresión en escala logarítmica y el
experimento lo evaluó también con pérdida asimétrica en MXN donde subestimar
cuesta dos veces. La decisión experimental exigía una mejora material de 5 % en
MAE o pérdida asimétrica para promoción y no autorizó el reemplazo.

## Cuándo participa en la cotización

Solo participa cuando la división normalizada es National, el equipo no es LTL,
la predicción Geo es positiva y finita, y existe un centro Champion válido. El
orquestador usa los siguientes pesos:

- Ruta nueva, conteo cero: 50 % Champion y 50 % Geo.
- Bajo historial, conteo entre uno y tres: 75 % Champion y 25 % Geo.
- Ruta soportada, cuatro o más: 100 % Champion y 0 % Geo.

El router además exige que origen y destino tengan latitud y longitud para
etiquetar el centro como `lightgbm_geo_hierarchical`. Si no están, usa el
incumbente y añade `geo_coordinates_unavailable`.

Los pesos son una política conservadora fija, no coeficientes aprendidos ni una
demostración de optimalidad. Su función es limitar exposición al challenger
mientras se recopila evidencia prospectiva.

## Cuándo no debe utilizarse

No debe ejecutarse para LTL ni otras divisiones. No debe forzarse con coordenadas
inventadas, geocentros aproximados no documentados o distancia en millas. No debe
reemplazar al Champion en rutas soportadas. Tampoco debe promoverse porque ganó
en la auditoría 2026: el artefacto indica explícitamente que 2026 no fue usado
para selección y que el guardrail de promoción no se cumplió en pre-2026.

Si origen o destino cambian de forma semántica por una normalización distinta,
el modelo puede asignar una región válida pero una ruta equivocada. La calidad
geográfica debe verificarse antes de inferencia, no solo comprobar que hay cuatro
números.

## Variables prohibidas y fuga de información

El experimento registró como tokens prohibidos peso, volumen y accesoriales. Esto
no significa que nunca sean útiles; significa que no formaron parte del contrato
validado y no pueden agregarse sin reconstruir el experimento. El costo realizado
tampoco se usa como variable.

Los mapas y medianas deben permanecer congelados. Recalcular regiones o
frecuencias con datos de auditoría y conservar los mismos modelos generaría
train-serving skew. Al actualizar esos estados debe reentrenarse y versionarse el
bundle completo.

## Riesgos y monitoreo

Medir error por región de origen, región de destino, corredor, familia de equipo,
disponibilidad de proveedor, distancia y elevación. Comparar por separado rutas
nuevas y de bajo historial. Registrar la proporción de coordenadas imputadas,
fuera de caché o con elevación ausente.

También debe monitorearse el desacuerdo relativo contra Champion. El guardrail
actual marca revisión si cualquier alternativa difiere más de 40 %. Un aumento
puede indicar drift geográfico, caché desactualizado, cambio de costos regionales
o errores de unidades.

## Archivos requeridos

Se requieren los tres ONNX `national_geo__*.onnx`, el estado
`artifacts/states/national_geo.json`, `geo_history_pipeline.py`, el archivo de
duración, el caché geográfico y la preparación compartida. Los centros KMeans
están dentro del JSON; no se requiere un archivo `.joblib` ni scikit-learn para
inferencia.
