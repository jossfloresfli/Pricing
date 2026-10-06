# Reporte técnico de Quantile Residual Risk

## Finalidad del componente

Este bundle amplía la estimación central con información sobre riesgo de
subestimación. En logística, cotizar por debajo del costo real puede afectar
margen, requerir renegociación o impedir conseguir carrier. Por ello el
experimento evaluó una pérdida asimétrica donde cada peso subestimado cuesta dos
veces lo que cuesta un peso sobreestimado.

El componente no sustituye automáticamente al Champion. Su artefacto declara
`selected_candidate: enhanced_global_baseline` y
`promote_new_architecture: false`. Esto significa que, al comparar candidatos
con folds temporales pre-2026, no se autorizó promover una nueva arquitectura
central. El orquestador conserva el centro vigente y utiliza principalmente el
P67 como piso protector y el error histórico para construir intervalos.

## Por qué hay 16 modelos ONNX

El bundle contiene cinco ensambles de tres semillas y un modelo residual. Las
semillas de los ensambles son 42, 2026 y 9001.

`enhanced_global_baseline` contiene tres modelos de regresión central y es el
candidato seleccionado. `history_central` contiene tres modelos centrales con
variables adicionales de historial. `enhanced_quantile_060`,
`enhanced_quantile_067` y `enhanced_quantile_075` contienen tres modelos cada
uno, entrenados con objetivos cuantílicos para P60, P67 y P75. Finalmente,
`residual_model` es un solo LightGBM que estima un ajuste residual de Crossborder.

Los modelos no son duplicados innecesarios. Cada familia responde una pregunta
distinta y cada semilla reduce variabilidad. Sin embargo, que un archivo exista
en el bundle no implica que la política vigente lo seleccione para fijar el
precio.

## Centro mejorado

El `enhanced_global_baseline` usa 22 variables y tres semillas. Fue entrenado con
4,514 observaciones después del recorte, con fecha máxima 31 de diciembre de
2025. Es la referencia central interna del bundle. El orquestador solo lo usa
como fallback si Champion no está disponible y como base para calcular P67,
historial e intervalos.

Sus 22 variables son las 16 del Champion más códigos de `DIVISION_key`,
`Tipo de Equipo_key` y `route_type`, y códigos de las interacciones
`division_equipment`, `division_distance_band` y `route_type_equipment`.
Con ello intenta representar diferencias sistemáticas entre divisiones,
distancias y equipos sin depender solamente de frecuencias.

## Centro con historial

`history_central` usa 32 variables y fue entrenado con 4,514 observaciones. A
las 22 variables anteriores agrega target encoding histórico y logaritmo del
conteo para cinco niveles:

- Ruta.
- Cliente.
- Proveedor.
- Combinación ruta-equipo.
- Combinación división-equipo.

Estas variables buscan aprovechar soporte repetido. Los mapas están congelados
en el bundle y se construyeron sin usar el costo futuro de la fila inferida. Una
ruta nueva recibe conteo cero y se suaviza hacia el prior. Aunque este modelo es
útil como candidato y fallback conceptual, no fue el centro seleccionado en la
decisión guardada.

## Cuantiles P60, P67 y P75

Cada familia cuantílica se entrenó con 4,560 observaciones hasta el 31 de
diciembre de 2025 y usa las mismas 22 variables del baseline mejorado. Cambia la
función objetivo: en lugar de estimar el centro de la distribución, aproxima un
cuantil condicional.

P60 es una protección moderada. P67 corresponde a `alpha = 2/3` y fue elegido
para representar la pérdida donde subestimar cuesta dos veces más. P75 es más
conservador y puede ser útil en análisis de escenarios, pero la política vigente
no lo aplica como precio operativo.

El orquestador calcula `protected_q67_mxn = max(P67, centro)`. Este máximo evita
que cruces cuantílicos o ruido hagan que el supuesto valor protector quede por
debajo del centro. Después, el router decide si debe seleccionar ese costo
protegido.

Un cuantil no es una probabilidad de que una cotización individual sea correcta.
P67 tampoco es el límite superior del intervalo. Su calibración debe evaluarse
en conjuntos futuros: aproximadamente 67 % de los costos de segmentos comparables
deberían quedar por debajo si el modelo está bien calibrado, pero esa propiedad
es poblacional y puede fallar por drift o por segmentos con poco soporte.

## Modelo residual Crossborder

El residual usa 1,683 observaciones y diez variables:

1. Predicción central.
2. Logaritmo de la predicción central.
3. Predicción P67.
4. Diferencia entre P67 y el centro.
5. Distancia en kilómetros.
6. Logaritmo de distancia.
7. Logaritmo del historial de ruta.
8. Indicador de ruta nueva.
9. Frecuencia del equipo.
10. Mes de creación.

Su ajuste se limita al rango observado de aproximadamente -13,390.73 a
7,536.69 MXN y solo se aplica a filas Crossborder dentro de los candidatos de
auditoría. El router final conserva explícitamente el incumbente para
Crossborder, por lo que este residual no debe conectarse directamente al precio
mostrado sin una nueva decisión de validación y promoción.

## Variables crudas y transformadas

Las variables crudas requeridas son cliente, proveedor, origen, destino, ruta,
tipo de equipo, división, rango, tipo de ruta, mes, trimestre, día de semana y
distancia. El pipeline construye frecuencias, target encodings, logaritmo de
distancia, códigos de categoría e interacciones.

Las 22 variables de baseline y cuantiles, en orden, son:

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
17. `DIVISION_key__code`.
18. `Tipo de Equipo_key__code`.
19. `route_type__code`.
20. `division_equipment__code`.
21. `division_distance_band__code`.
22. `route_type_equipment__code`.

El modelo histórico añade `__history_te` y `__history_count_log1p` para ruta,
cliente, proveedor, ruta-equipo y división-equipo, llegando a 32 variables.

## Historial de ruta y segmentación de riesgo

El conteo de ruta se obtiene del estado de entrenamiento del baseline mejorado.
Una ruta con cero observaciones se etiqueta `new`; de una a tres se etiqueta
`low_history`; con cuatro o más se etiqueta `supported`. Esta clasificación
activa P67 en el router para rutas nuevas o de bajo historial, excepto que
Crossborder conserva su regla de incumbente.

El conteo es soporte histórico del dataset de entrenamiento, no el número en
tiempo real de viajes que exista hoy en Loadboard. Al reentrenar deben versionarse
juntos el modelo y los mapas; actualizar únicamente el conteo sin revalidar
cambia el comportamiento del modelo.

## Cómo se construye el intervalo

El intervalo del bundle de riesgo es simétrico alrededor del candidato central
seleccionado y usa el percentil 95 del error absoluto fuera de muestra. Los
márgenes almacenados son 15,820.45 MXN globales; 15,249.02 para Crossborder;
11,962.33 para Domestic; 14,871.65 para National; y 22,013.35 para Port Freight.

El límite inferior es `max(centro - q95, 0)` y el superior es `centro + q95`.
Esto explica por qué Port Freight puede mostrar una banda amplia. Es evidencia
de mayor error histórico absoluto, no una instrucción para cotizar en cualquier
punto del rango. El orquestador combina conservadoramente este intervalo con el
del Hybrid: toma el menor límite inferior y el mayor superior.

La etiqueta “q95” describe un cuantil empírico de error, no un intervalo de
confianza paramétrico. La cobertura debe medirse prospectivamente y por segmento.

## Cuándo se utiliza P67

El router activa P67 fuera de Crossborder cuando ocurre al menos una de estas
condiciones: equipo especial; división Port Freight; ruta nueva; ruta con una a
tres observaciones; o Champion ubicado en los deciles protegidos D7, D8 o D10.
Cuando se activa, el valor elegido es el máximo entre el centro permitido y el
costo protegido integrado.

La activación no elimina la revisión humana. En esta beta todas las decisiones
siguen en sombra. Para equipos especiales o rutas nuevas también se exige
validación de mercado y pueden existir abstenciones estrictas.

## Cuándo no usar cada candidato

P60 y P75 no deben conectarse como precio sin definir un costo de error y
validarlo. El histórico central no debe sustituir al seleccionado por parecer
más detallado. El residual Crossborder no debe aplicarse fuera de Crossborder ni
promoverse indirectamente. P67 no debe sumarse al centro: se usa como piso, no
como recargo. El q95 del intervalo tampoco debe sumarse como margen comercial.

## Riesgos y monitoreo

Se debe medir calibración de P60/P67/P75, cobertura del intervalo, anchura media,
subestimación por división, equipo, decil e historial, y estabilidad de los
mapas. También deben separarse rutas sin proveedor y categorías nuevas. Si P67
queda por debajo del costo real con mayor frecuencia de la esperada, la causa
puede ser drift, datos de entrada inconsistentes, falta de variables o mala
calibración por segmento; no debe corregirse simplemente aumentando un porcentaje
sin backtest y prueba prospectiva.

## Archivos necesarios

Los 16 ONNX `quantile_risk__*.onnx` deben viajar con
`artifacts/states/quantile_risk.json` y `risk_pipeline.py`. La preparación base
depende también de `hybrid_pipeline.py`. El JSON contiene el candidato
seleccionado, mapas, orden de variables, márgenes q95 y reglas de fallback.
