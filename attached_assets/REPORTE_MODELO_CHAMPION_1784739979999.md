# Reporte técnico del modelo Champion LightGBM

## Qué es y qué problema resuelve

El Champion es el modelo base vigente de estimación de costo de transporte en
MXN. Su objetivo es producir una referencia central para una cotización: dado el
contexto de una ruta y de la operación, estima el costo histórico esperado que
se usaría como punto de partida antes de aplicar protecciones o guardrails.

No es un modelo de precio de venta, disposición a pagar o margen comercial. Su
target está documentado como `cost_mxn`. Por tanto, cualquier margen, impuesto,
comisión o regla comercial debe aplicarse fuera del modelo y quedar claramente
separada del costo estimado.

Dentro del orquestador, Champion tiene precedencia como centro general. Si
Champion falla, se intenta utilizar el centro del bundle de riesgo. Los modelos
Geo y P67 modifican o protegen esta referencia solamente en los segmentos que la
política autoriza.

## Composición del ensamble

El componente contiene tres regresores LightGBM equivalentes entrenados con
semillas diferentes: 42, 2026 y 9001. En ONNX corresponden a:

- `champion__root.models.0.model.onnx`, semilla 42.
- `champion__root.models.1.model.onnx`, semilla 2026.
- `champion__root.models.2.model.onnx`, semilla 9001.

Cada modelo recibe 16 variables transformadas. El target se entrenó en escala
`log1p`. Durante inferencia se aplica `expm1`, se limita el resultado inferior a
cero y se promedian las tres predicciones. El promedio reduce sensibilidad a la
aleatoriedad de una sola semilla, pero no elimina sesgo, drift ni errores comunes
a los tres modelos.

Los tres modelos registran fecha máxima de entrenamiento 31 de diciembre de
2025. La configuración almacenada indica una ventana de nueve meses, recorte de
0.5 % en cada extremo del target, pesos temporales con vida media de 180 días y
target encoding de origen y destino. El artefacto no conserva el conteo final de
filas, por lo que este reporte no atribuye un tamaño de muestra no verificable.

## Datos que debe recibir el pipeline

El modelo no recibe directamente las 16 variables desde la página. Primero
requiere estas 13 variables crudas normalizadas:

- `CLIENTE_key`: cliente normalizado.
- `PROVEEDOR_key`: carrier o proveedor normalizado.
- `ORIGEN_key`: origen normalizado.
- `DESTINO_key`: destino normalizado.
- `route_key`: concatenación `origen -> destino`.
- `Tipo de Equipo_key`: tipo de equipo normalizado.
- `DIVISION_key`: división normalizada.
- `RANGO_key`: rango o modalidad comercial normalizada.
- `route_type`: tipo de ruta derivado de la división.
- `mes_creacion`: mes numérico de la solicitud.
- `trimestre_creacion`: trimestre de la solicitud.
- `dia_semana_creacion`: día de semana con lunes igual a cero.
- `google_distance_km`: distancia en kilómetros.

El servicio de deployment construye esas claves a partir de los nombres
operativos. Los valores categóricos ausentes se transforman al token
`__MISSING__`. La distancia ausente se imputa con la mediana almacenada durante
entrenamiento; aun así, desde el punto de vista operativo una distancia ausente
debe provocar revisión porque puede ocultar un error de integración.

## Variables realmente entregadas a LightGBM

Las 16 variables finales, en orden, son:

1. `mes_creacion`.
2. `trimestre_creacion`.
3. `dia_semana_creacion`.
4. `google_distance_km`.
5. `CLIENTE_key__freq`.
6. `PROVEEDOR_key__freq`.
7. `ORIGEN_key__freq`.
8. `DESTINO_key__freq`.
9. `route_key__freq`.
10. `Tipo de Equipo_key__freq`.
11. `DIVISION_key__freq`.
12. `RANGO_key__freq`.
13. `route_type__freq`.
14. `distance_log1p`.
15. `ORIGEN_key__te`.
16. `DESTINO_key__te`.

Las variables `__freq` representan la frecuencia relativa observada durante el
entrenamiento. Una categoría nueva recibe cero, lo cual comunica que no tuvo
soporte histórico. `distance_log1p` reduce la asimetría de distancias grandes.
Las variables `__te` son target encodings en escala logarítmica suavizados hacia
un prior de entrenamiento. No deben recalcularse con datos actuales ni con el
costo de la cotización que se está prediciendo: hacerlo introduciría fuga de
target y rompería la paridad.

## Cómo funciona la inferencia

`hybrid_pipeline.prepare_inference` garantiza las columnas necesarias y aplica
la misma normalización. Para cada semilla se recuperan las medianas, frecuencias,
mapas de target encoding y orden de variables del estado `champion.json`. La
matriz se convierte a `float32`, se entrega a ONNX Runtime y se obtiene una
predicción en escala logarítmica. La salida final se calcula conceptualmente como:

`mean(max(expm1(predicción_semilla), 0))`.

La conversión a `float32` es la causa de pequeñas diferencias frente a la
ejecución Joblib/LightGBM. En la prueba integral esa diferencia fue menor a un
peso y no alteró la decisión. Cualquier nueva conversión debe volver a demostrar
paridad y no asumir que este resultado se conserva automáticamente.

## Cuándo debe usarse

Champion es el centro recomendado para Crossborder, Port Freight y rutas
National con historial suficiente. También es el fallback cuando no existen
coordenadas, el modelo Geo no aplica, la combinación ruta-equipo no tiene
soporte o un challenger se abstiene.

En la beta debe mostrarse como referencia del modelo vigente. La interfaz puede
comparar Champion con el centro integrado y el costo protegido para explicar qué
parte del ajuste proviene de Geo o P67.

## Cuándo no debe usarse solo

No debe interpretarse como una garantía de costo máximo. En rutas nuevas,
equipos especiales, Port Freight o segmentos activados por la política de riesgo,
el router añade P67. En National con bajo historial y geografía válida, el centro
integra National Geo.

Tampoco debe usarse si faltan origen, destino, equipo, división o moneda; si la
distancia tiene unidades incorrectas; si el costo por kilómetro es inverosímil;
o si el software no puede conservar el orden exacto de variables. En esos casos
la acción correcta es abstenerse y solicitar revisión.

## Fortalezas y límites

LightGBM es adecuado para datos tabulares con relaciones no lineales y cruces
entre ruta, distancia, tiempo y categorías. La ventana reciente y los pesos
temporales buscan dar mayor relevancia a condiciones más actuales. El ensamble
de semillas aporta estabilidad.

Sus limitaciones son igual de importantes. Las frecuencias y target encodings
están congelados a 2025; rutas, clientes o equipos nuevos pueden caer fuera de
distribución. El proveedor puede no estar disponible al cotizar. El modelo no
usa directamente combustible actual, disponibilidad spot, clima, peajes nuevos
o eventos extraordinarios si no están reflejados indirectamente en el historial.
Además, optimizar error central no protege de forma específica la cola de
subestimaciones, razón por la cual existe el bundle cuantílico.

## Relación con intervalos y costo protegido

Champion no produce un intervalo propio. El intervalo mostrado por el sistema
proviene del bundle de riesgo y del National Hybrid. El costo protegido tampoco
es la salida directa de Champion: es el máximo entre el centro integrado y P67,
más cualquier ajuste calibrado autorizado. Confundir estos campos haría que la
interfaz atribuyera al modelo base una función que no tiene.

## Operación y monitoreo

Debe medirse el error del Champion por división, equipo, corredor, rango de
precio, distancia, cliente conocido/desconocido y disponibilidad del proveedor.
Son especialmente útiles el sesgo medio, MAE, mediana del error, proporción de
subestimaciones, P90/P95 de subestimación y pérdida asimétrica. Un promedio global
puede ocultar fallos severos en equipos o corredores poco frecuentes.

El monitoreo también debe registrar el porcentaje de categorías que reciben
frecuencia cero, las rutas fuera de caché y el desacuerdo frente a Geo e Hybrid.
Un aumento persistente es señal de drift o de que los mapas congelados necesitan
reentrenamiento.

## Archivos necesarios

Los tres ONNX deben desplegarse junto con `artifacts/states/champion.json`.
También se requieren `hybrid_pipeline.py`, la normalización compartida, el
manifiesto y el contrato. Copiar solamente los `.onnx` no es suficiente porque
los grafos esperan las 16 variables ya transformadas y en orden exacto.
