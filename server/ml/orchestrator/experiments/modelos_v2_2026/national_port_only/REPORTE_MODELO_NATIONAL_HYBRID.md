# Reporte técnico de National Route-Equipment Hybrid

## Qué busca resolver

National Hybrid evalúa si un modelo especializado en división National y en la
combinación ruta-equipo puede complementar al incumbente. La hipótesis es que el
modelo general ofrece estabilidad y cobertura, mientras que el especialista
captura patrones particulares cuando existe evidencia suficiente para la ruta y
el equipo.

El componente se clasifica como `shadow_challenger`. Acepta National y Port
Freight. Fuera de esas divisiones devuelve revisión manual y no produce un precio
válido. No reemplaza al router del orquestador ni autoriza automatización.

## Composición de los seis modelos

El bundle contiene dos ensambles, cada uno con semillas 42, 2026 y 9001. Los
tres modelos `base_bundle` son copias portables del Champion con 16 variables.
Los tres `national_specialist` usan 37 variables enfocadas en equipo e
interacciones. Los archivos son:

- `national_hybrid__root.base_bundle.models.0.model.onnx` a `.2`.
- `national_hybrid__root.national_specialist.0.model.onnx` a `.2`.

El especialista registra 2,030 filas de entrenamiento hasta el 31 de diciembre
de 2025. El estado base no conserva conteo de filas, aunque sí fecha, ventana y
configuración. Ambos ensambles invierten la escala logarítmica y promedian las
tres semillas.

## Variables del modelo base

El base usa calendario, distancia, frecuencias de cliente, proveedor, origen,
destino, ruta, equipo, división, rango y tipo de ruta, logaritmo de distancia y
target encoding de origen y destino. Su lista de 16 variables es idéntica a la
documentada en el reporte del Champion.

Este base garantiza que el componente pueda producir una referencia en National
y Port Freight aunque el especialista no tenga soporte.

## Variables del especialista National

El especialista usa 37 variables, en este orden:

1. `mes_creacion`.
2. `trimestre_creacion`.
3. `dia_semana_creacion`.
4. `google_distance_km`.
5. `distance_log1p`.
6. `CLIENTE_key__freq`.
7. `ORIGEN_key__freq`.
8. `DESTINO_key__freq`.
9. `route_key__freq`.
10. `DIVISION_key__freq`.
11. `RANGO_key__freq`.
12. `route_type__freq`.
13. `Tipo de Equipo_key__freq`.
14. `equipment_family__freq`.
15. `division_equipment__freq`.
16. `route_equipment__freq`.
17. `origin_equipment__freq`.
18. `destination_equipment__freq`.
19. `route_key__te`.
20. `ORIGEN_key__te`.
21. `DESTINO_key__te`.
22. `CLIENTE_key__te`.
23. `Tipo de Equipo_key__te`.
24. `equipment_family__te`.
25. `division_equipment__te`.
26. `route_equipment__te`.
27. `origin_equipment__te`.
28. `destination_equipment__te`.
29. `DIVISION_key__code`.
30. `RANGO_key__code`.
31. `route_type__code`.
32. `Tipo de Equipo_key__code`.
33. `equipment_family__code`.
34. `division_equipment__code`.
35. `route_equipment__code`.
36. `origin_equipment__code`.
37. `destination_equipment__code`.

Las frecuencias representan soporte relativo. Los target encodings aproximan
el costo logarítmico histórico suavizado. Los códigos permiten que LightGBM
separe categorías e interacciones. Todos los mapas están congelados en
`national_hybrid.json` y no deben reconstruirse en línea.

## Regla de selección interna

Primero se normalizan los datos y se determina si la división está permitida.
Para National se consulta cuántas observaciones históricas existen para
`route_key|Tipo de Equipo_key`. Si el conteo es al menos uno y el equipo no es
LTL, se activa el especialista. El resultado final es 50 % del base más 50 % del
especialista.

Si National no tiene ninguna observación ruta-equipo, se usa solo base y se
registra `insufficient_route_equipment_history`. Si el equipo es LTL, también se
usa base y se registra `excluded_equipment_ltl`. En Port Freight la política es
siempre `base_port_freight`. Cualquier otra división devuelve `manual_review`.

El umbral mínimo de una observación es permisivo y no significa alta confianza.
La confianza se calcula por separado y puede ser baja aunque el especialista se
active. Por ello el resultado no debe interpretarse como una promoción del
especialista.

## Cómo se calcula la confianza

Se construye un soporte entre cero y uno con cuatro partes: 35 % depende del
historial de ruta hasta ocho observaciones; 20 % del cliente hasta veinte; 20 %
del equipo hasta veinte; y 25 % de ruta-equipo hasta cinco. La confianza inicial
es 25 más 70 veces ese soporte.

Cuando se activa el híbrido, se resta una penalización por desacuerdo entre base
y especialista, con máximo de veinte puntos. También se penaliza la ausencia de
origen, destino, ruta o equipo. El resultado se limita entre 15 % y 95 % y se
redondea a una decimal.

Esta cifra es una puntuación heurística, no una probabilidad calibrada de que el
costo quede dentro del intervalo ni un porcentaje de exactitud. El guardrail del
orquestador la usa para revisión cuando es menor a 45 %.

## Intervalo de incertidumbre

El bundle conserva un margen q95 por familia de equipo y, si no existe, por
división o global. El intervalo base es predicción más/menos ese margen. Cuando
se usa el especialista, se añade a q95 la mitad del desacuerdo absoluto entre
base y especialista. Así, si los modelos discrepan, el rango se hace más ancho.

El límite inferior se recorta en cero y el superior no se recorta. El orquestador
combina este intervalo con el del bundle de riesgo tomando el rango exterior más
conservador. Un rango amplio no indica que el mercadólogo deba elegir libremente
cualquier punto; indica que el caso necesita mayor contraste con carrier y
mercado.

## Papel dentro del orquestador actual

National Hybrid se ejecuta para obtener predicción, confianza, necesidad de
cotización manual e intervalo. Sin embargo, la fórmula central del orquestador
no mezcla directamente su predicción. El centro usa Champion y, para rutas
National de bajo historial, National Geo. La salida del Hybrid permanece en los
componentes de diagnóstico del router.

Esta decisión evita combinar dos challengers simultáneamente sin evidencia de
que la mezcla mejore valor operativo. Si en el futuro se desea usar Hybrid como
centro, debe compararse prospectivamente contra el flujo actual y definir la
precedencia con Geo.

## Cuándo consultar su resultado

Es útil para analizar rutas National con al menos un antecedente ruta-equipo,
comparar el especialista contra el incumbente y detectar desacuerdos. En Port
Freight aporta la predicción base y un intervalo específico. También sirve para
identificar segmentos con bajo soporte mediante `confidence_pct`.

Debe mostrarse como diagnóstico a usuarios avanzados, no como segundo precio
competidor sin explicación. La interfaz principal debería seguir el
`selected_cost_mxn` del router y permitir desplegar base, especialista, peso,
confianza e intervalo cuando se necesite investigar.

## Cuándo no usarlo como decisión

No debe utilizarse fuera de National y Port Freight. No debe aplicar especialista
a LTL o ruta-equipo no observada. No debe tratar `confidence_pct` como cobertura.
No debe promediarse nuevamente con el centro integrado desde el frontend. No
debe convertirse su límite superior en precio recomendado ni ocultar la razón de
fallback.

## Riesgos y monitoreo

Medir error base, especialista e híbrido por separado. Segmentar por conteo de
ruta-equipo, ruta, cliente, equipo, familia, distancia y magnitud del desacuerdo.
Revisar si una sola observación es suficiente o si un umbral mayor mejora la
pérdida asimétrica sin perder demasiada cobertura.

La confianza debe validarse mediante curvas de error contra bandas de score. Si
casos con 80 % no son más precisos que casos con 40 %, la heurística no está
ordenando riesgo y debe recalibrarse. También debe monitorearse la cobertura del
intervalo y la frecuencia de `manual_review`.

## Archivos requeridos

Se necesitan los seis ONNX `national_hybrid__*.onnx`,
`artifacts/states/national_hybrid.json`, `national_hybrid.py` y
`national_port_pipeline.py`. El JSON contiene mapas de soporte, estados de ambos
ensambles, márgenes q95 y la política 50/50. Sin esos archivos, los modelos ONNX
aislados no pueden construir sus 16 o 37 variables.
