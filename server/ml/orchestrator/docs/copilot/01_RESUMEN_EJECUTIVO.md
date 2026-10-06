# Resumen ejecutivo del copiloto de precotización

## Decisión

La recomendación es integrar el copiloto como una capacidad posterior y
desacoplada del cálculo ONNX existente. El orquestador sigue siendo la única
fuente de los costos y reglas de precotización. El copiloto sólo recupera
evidencia aprobada y traduce el resultado seleccionado a una explicación breve
para ventas.

Esta separación reduce el riesgo operativo: si OpenAI falla, alcanza un límite
o no tiene evidencia suficiente, la precotización permanece disponible. El
copiloto puede desactivarse sin cambiar modelos, precios, permisos o flujo de
autorización.

## Problema que resuelve

El cotizador presenta varias referencias de costo y razones técnicas que pueden
ser difíciles de interpretar para una persona de ventas. El copiloto busca
responder, en lenguaje comercial, cuatro preguntas:

1. ¿Qué opción estoy revisando y por qué aparece para esta ruta?
2. ¿Qué antecedentes de la ruta o de rutas cercanas existen?
3. ¿Qué condiciones podrían hacer que el valor sea menos confiable?
4. ¿Qué validación humana debe realizarse antes de proponer una tarifa?

No responde cuánto cobrará finalmente un carrier ni garantiza disponibilidad.

## Hechos observados en la entrega

El paquete incluye 10,435 movimientos históricos elegibles y 423 fragmentos de
documentación estructurada. El histórico utiliza rutas dirigidas: origen a
destino no se trata automáticamente como equivalente al viaje inverso. La
recuperación prioriza seis meses anteriores a la cotización y puede declarar un
fallback de información más antigua.

En este reporte, “ruta cercana” tiene una definición estricta: el origen del
antecedente debe estar a 30 km o menos del origen solicitado **y**, al mismo
tiempo, su destino debe estar a 30 km o menos del destino solicitado. Cada radio
se calcula por separado. No se suman las dos distancias y una coincidencia en un
solo extremo no es suficiente. Una ruta con 12 km de separación en origen y
29 km en destino puede ser candidata; si el destino queda a 31 km, se descarta
aunque el origen coincida exactamente. También deben cumplirse los filtros de
sentido, equipo, división y moneda. La cercanía aporta contexto histórico, pero
no cambia el precio calculado por ONNX.

La implementación valida identificadores de evidencia en el backend, elimina
cliente y proveedor del contenido enviado a OpenAI, limita tokens y no habilita
herramientas web en la llamada de generación. Las pruebas copiadas verifican
estas propiedades sin ejecutar ONNX y sin consumir la API real.

En esta entrega no se incluyeron embeddings porque los disponibles correspondían
a un corpus anterior. La recuperación local continúa funcionando; la búsqueda
semántica se habilitará solamente cuando el índice tenga el mismo checksum que
el corpus vigente.

## Supuestos de integración

Se asume que el proyecto Replit ya tiene backend, autenticación, roles,
orquestador ONNX y almacenamiento de cotizaciones. Se asume también que el
backend puede recuperar por `quote_id` tanto la solicitud original como los
resultados completos de los modelos.

Si el backend no es Python, Replit Agent debe evaluar una frontera de servicio
o un adaptador equivalente; no debe reescribir el orquestador ni ejecutar ONNX
por segunda vez.

## Uso esperado durante la beta

La beta debe operar en sombra. Ventas puede solicitar explicaciones y registrar
si resultaron útiles, pero ninguna explicación autoriza enviar una tarifa. La
confirmación con carrier, Operaciones o Procurement continúa siendo obligatoria.

Se debe medir adopción, utilidad, precisión de citas, latencia, consumo, errores,
abstenciones y comportamiento por división, equipo, historial y rango de costo.
El objetivo no es maximizar el número de explicaciones, sino reducir dudas sin
incrementar el riesgo de subestimación ni crear una falsa sensación de certeza.

## Riesgos principales

El mayor riesgo técnico es confiar en datos enviados por el navegador. Por eso
el endpoint sólo debe aceptar `quote_id` y `model_key`; el precio se recupera del
servidor. Otros riesgos son el uso de almacenamiento local no persistente,
presupuestos independientes por réplica, documentos vencidos, filtración de
datos sensibles, explicaciones no fundamentadas y cambios accidentales al flujo
de permisos.

La mitigación es mantener persistencia compartida, validación de evidencia,
límites globales, auditoría, despliegue gradual y un interruptor independiente
`COPILOT_ENABLED=false`.

## Impacto esperado y límites de la afirmación

El beneficio esperado es cualitativo: mayor claridad para ventas, mejor
trazabilidad y una conversación más consistente sobre riesgo e histórico. No se
afirma todavía un aumento de ingresos, margen o velocidad de cierre. Cualquier
impacto financiero debe medirse prospectivamente y separar adopción, cobertura,
calidad de la explicación y decisiones posteriores.

La cadena a observar es:

```text
explicación → comprensión de ventas → validación/selección → tarifa propuesta
→ aceptación del cliente → costo confirmado → margen realizado
```

Un cambio en margen o conversión no debe atribuirse causalmente al copiloto sin
un diseño de evaluación apropiado.
