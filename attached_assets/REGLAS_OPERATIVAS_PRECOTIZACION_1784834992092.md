# Reglas operativas para seleccionar modelos de precotización

## Propósito

Este documento define las reglas operativas para seleccionar y presentar los
resultados de los modelos de precotización.

Toda precotización deberá confirmarse con el carrier, Operaciones o Procurement
antes de utilizarse comercialmente.

## Estados de los resultados

Cada resultado deberá clasificarse en uno de los siguientes cuatro estados:

- **Recomendado:** es la referencia principal seleccionada por las reglas del
  sistema para las características de la operación.
- **Disponible con revisión:** el resultado puede consultarse o seleccionarse
  como referencia alternativa, pero requiere validación humana.
- **No aplicable:** el modelo no fue diseñado o no cuenta con la información
  necesaria para evaluar esa operación.
- **Sin recomendación: cotización manual:** ninguno de los modelos debe
  utilizarse para seleccionar un costo. La operación deberá cotizarse
  manualmente.

## Reglas por modelo

### Estimación histórica

La Estimación histórica será el modelo predeterminado para Crossborder y para
rutas con historial suficiente.

También funcionará como fallback cuando la Estimación ajustada por ruta o la
Comparación con rutas similares no tengan cobertura suficiente.

Para operaciones LTL será la única referencia visible y siempre deberá
presentarse con revisión manual.

La Estimación histórica no deberá utilizarse cuando:

- Falten datos críticos de la operación.
- La predicción no sea positiva o válida.
- Exista una condición que obligue a realizar una cotización completamente
  manual.

### Estimación ajustada por ruta

La Estimación ajustada por ruta se utilizará únicamente cuando se cumplan todas
las condiciones siguientes:

- La división sea National.
- El equipo sea distinto de LTL.
- Existan coordenadas completas para origen y destino.
- La predicción geográfica sea válida y positiva.

La participación de este modelo dependerá del historial:

- **Ruta nueva, sin antecedentes:** integrar 50 % de la Estimación histórica y
  50 % de la Estimación ajustada por ruta.
- **De uno a tres antecedentes:** integrar 75 % de la Estimación histórica y
  25 % de la Estimación ajustada por ruta.
- **Cuatro o más antecedentes:** mostrar la Estimación ajustada por ruta
  únicamente como información y no marcarla como recomendada.

Este modelo no deberá utilizarse en:

- Crossborder.
- Domestic.
- Port Freight.
- Operaciones LTL.
- Operaciones con información geográfica incompleta.

### Estimación con protección

La Estimación con protección representa un piso de seguridad P67. No debe
interpretarse como un modelo central, un margen comercial ni un recargo que se
sume automáticamente a la estimación.

Deberá aplicarse fuera de Crossborder cuando se presente al menos una de las
condiciones siguientes:

- La ruta sea nueva.
- La ruta tenga de uno a tres antecedentes.
- La división sea Port Freight.
- La operación utilice equipo especial.
- La estimación se encuentre en los deciles D7, D8 o D10.

Cuando la protección sea aplicable, deberá seleccionarse el valor máximo entre
la estimación central y la estimación protegida.

La protección no deberá aplicarse automáticamente en Crossborder.

Si P67 es requerido por las reglas anteriores, pero no se encuentra disponible,
el sistema no deberá emitir una recomendación. La operación deberá enviarse a
cotización manual.

### Comparación con rutas similares

La Comparación con rutas similares podrá utilizarse como alternativa cuando se
cumplan todas las condiciones siguientes:

- La división sea National.
- Exista al menos un antecedente para la combinación ruta-equipo.
- El equipo sea distinto de LTL.
- La confianza del modelo sea igual o superior a 45 %.

Cuando sea aplicable, el resultado deberá combinar:

- 50 % del modelo base.
- 50 % del modelo especialista.

En operaciones National sin soporte suficiente de ruta-equipo deberá mostrarse
únicamente el fallback histórico.

En Port Freight podrá mostrarse como referencia base, indicando claramente que
el modelo especialista no intervino en el cálculo.

Este modelo no deberá utilizarse:

- Fuera de National y Port Freight.
- Cuando la confianza sea menor de 45 %.
- Para LTL.
- Cuando no exista soporte suficiente de ruta-equipo.

## Casos donde no debe usarse ningún modelo

Los resultados podrán conservarse únicamente como diagnóstico, pero deberán
deshabilitarse para selección y la operación deberá enviarse a cotización manual
cuando ocurra cualquiera de los siguientes casos:

- Falta origen, destino, división, equipo, identificador estable.
- La distancia es inexistente, no es positiva o sus unidades no pueden
  verificarse.
- No existe una predicción central positiva y finita.
- El intervalo es inválido o no se encuentra disponible.
- La anchura del intervalo supera 125 % de la estimación central.
- Los modelos aplicables difieren más de 40 % respecto a la Estimación
  histórica.
- La protección incrementa más de 50 % la estimación central.
- Una pipa, operación hazmat o contenedor completo de 40 pies tiene menos de
  cuatro antecedentes.
- Ocurre un fallo en un componente necesario para generar la recomendación.
- La división o el equipo se encuentran fuera del alcance documentado de los
  modelos.
- Una ruta nueva no puede enriquecerse con distancia y datos geográficos
  válidos.
- P67 es requerido, pero no se encuentra disponible.
- Se usa una división como Maritime, Multimodal, Aéreo o Central América.

## Sistema en etapa de validación

La condición técnica de calibrador no ajustado deberá mostrarse al vendedor
como:

> **Sistema en etapa de validación**

Durante la beta, esta condición no ocultará las precotizaciones, pero impedirá
que los resultados sean considerados tarifas autorizadas.

## Selección por ventas

El sistema deberá marcar una sola opción como:

> **Recomendada para esta ruta**

Las alternativas aplicables podrán seleccionarse como referencias de trabajo,
pero nunca deberán presentarse como tarifas confirmadas.

Cuando el vendedor cambie la opción recomendada, será obligatorio registrar uno
de los siguientes motivos:

- Cotización de carrier.
- Experiencia comercial.
- Condición particular del cliente.
- Ajuste de mercado.
- Requerimiento de equipo especial.
- Corrección de datos.


No deberá permitirse seleccionar opciones con estado **No aplicable** ni
resultados clasificados como **Sin recomendación: cotización manual**.

## Trazabilidad

Para cada precotización deberán registrarse, como mínimo:

- Usuario que realizó la selección.
- Fecha y hora.
- Resultados de los cuatro modelos.
- Opción recomendada por el sistema.
- Opción elegida por el vendedor.
- Motivo del cambio, cuando exista.

Los siguientes conceptos deberán mantenerse separados:

- Costo estimado por el modelo.
- Tarifa propuesta al cliente.
- Margen estimado.

## Casos de prueba

### Crossborder con datos completos

- La Estimación histórica será la recomendada.
- P67 no se aplicará automáticamente.
- La Estimación ajustada por ruta no será aplicable.
- La Comparación con rutas similares no será aplicable.

### Ruta National nueva con coordenadas

- Se integrará 50 % de la Estimación histórica y 50 % de la Estimación ajustada
  por ruta.
- Se aplicará la protección P67.
- La operación requerirá revisión.

### Ruta National con uno a tres antecedentes

- Se integrará 75 % de la Estimación histórica y 25 % de la Estimación ajustada
  por ruta.
- Se aplicará la protección P67.
- La Comparación con rutas similares estará disponible si existe soporte
  ruta-equipo.

### Ruta National con cuatro o más antecedentes

- La Estimación histórica será la referencia principal.
- La Estimación ajustada por ruta será únicamente informativa.
- La Comparación con rutas similares podrá mostrarse como alternativa si cuenta
  con soporte suficiente.

### Port Freight

- Se utilizará la Estimación histórica con protección.
- La Comparación con rutas similares se identificará como referencia base.
- Se aclarará que el especialista National no intervino.

### National LTL

- La Estimación histórica será la única referencia visible.
- La Estimación ajustada por ruta no será aplicable.
- El especialista de rutas similares no será aplicable.
- La operación requerirá revisión manual.

### Hazmat con menos de cuatro antecedentes

- Ninguna opción podrá seleccionarse.
- La operación deberá enviarse a cotización manual.

### Datos críticos o distancia ausentes

- No se deberá emitir una recomendación.
- La operación deberá enviarse a cotización manual.

### Desacuerdo elevado o intervalo excesivo

- Si el desacuerdo supera 40 % o la anchura del intervalo supera 125 % del
  centro, ninguna opción podrá seleccionarse.
- Los resultados podrán conservarse únicamente como diagnóstico.

### Selección de una alternativa

- El motivo del cambio será obligatorio.
- La selección quedará registrada para auditoría.
- Si el resultado elegido es menor que el costo protegido, deberá mostrarse la
  advertencia de riesgo de subestimación.

## Supuestos adoptados

- Toda precotización requerirá confirmación con el carrier, Operaciones o
  Procurement.
- La selección realizada por ventas no modificará los modelos ni las reglas de
  decisión.
- La selección no autorizará el envío automático de una tarifa.
- Los límites actuales se conservarán desde la política vigente.
- Los límites y reglas deberán validarse prospectivamente antes de cualquier uso
  productivo.
- Al cambiarse entre Pestañas/Tickets, se debe desaparecer la cotización realizadad por el modelo para que no aparezca la cotización de alguna otra ruta.

