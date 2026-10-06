# Uso funcional por ventas

## Qué es el copiloto

El copiloto es una explicación adicional de una precotización. Ayuda a entender
qué antecedentes existen, qué factores influyeron y qué debe revisarse. No es un
nuevo modelo de costo ni una autorización para enviar una tarifa.

## Cuándo solicitar una explicación

Puede ser útil cuando la ruta es nueva, hay pocos antecedentes, el rango es
amplio, aparece protección de costo, existen varias opciones disponibles o el
resultado es distinto de la experiencia comercial del vendedor.

También puede utilizarse para preparar una revisión con Operaciones o
Procurement, siempre que la explicación se acompañe de los datos de la
precotización y no se presente como confirmación de mercado.

## Cómo leer el resultado

Una explicación fundamentada indica que el backend encontró evidencia aplicable
y que las referencias devueltas fueron validadas. Esto no significa que el
precio vaya a coincidir con una cotización real del carrier.

Una respuesta con evidencia limitada señala que faltan antecedentes exactos,
que se usaron rutas cercanas, que la información es antigua o que la cobertura
documental es parcial. Debe aumentar el nivel de revisión humana.

Cuando la interfaz o la explicación indique “rutas cercanas”, significa que
cada antecedente mostrado pasó dos validaciones simultáneas: su origen está a
30 km o menos del origen solicitado y su destino está a 30 km o menos del
destino solicitado. No significa que las dos distancias sumen menos de 30 km ni
que baste la cercanía de un solo extremo. Estas referencias ayudan a entender
el contexto, pero tienen menor fuerza que el historial exacto y no modifican la
precotización.

Una respuesta no disponible puede deberse a límite de consumo, configuración,
falla de OpenAI o falta de un registro confiable. El vendedor debe continuar con
el resultado del cotizador y el procedimiento manual establecido.

## Qué puede seleccionar ventas

Ventas puede pedir explicación de una opción disponible. Solicitar una
explicación no cambia la recomendación del orquestador ni registra por sí mismo
una selección final. Si el sistema permite elegir una alternativa, debe
conservarse el motivo y la trazabilidad definidos por las reglas operativas.

No deben habilitarse opciones marcadas como no aplicables o sin recomendación.
Una alternativa inferior al costo protegido debe mantener la advertencia de
riesgo de subestimación.

## Qué no debe hacerse

No se debe copiar el texto del copiloto como si fuera una cotización válida, ni
afirmar que existe capacidad de transportista. Tampoco debe usarse para omitir
una abstención del orquestador, ignorar un equipo fuera de alcance o justificar
un precio que no fue generado por el sistema.

La explicación no debe compartirse con el cliente si contiene lenguaje interno,
referencias históricas o advertencias no diseñadas para comunicación externa.

## Procedimiento recomendado

1. Revisar que origen, destino, equipo, división, moneda y distancia sean
   correctos.
2. Identificar la opción recomendada y las alternativas disponibles.
3. Solicitar explicación de la opción relevante.
4. Leer primero el estado y las advertencias.
5. Revisar el histórico y si corresponde a ruta exacta, antigua o cercana.
6. Confirmar con carrier, Operaciones o Procurement.
7. Registrar costo confirmado, tarifa propuesta y margen por separado.
8. Si se elige una alternativa, documentar el motivo.

## Retroalimentación durante la beta

El sistema debería permitir reportar si la explicación fue útil, incompleta,
confusa o incorrecta. Cuando sea posible, debe registrarse qué afirmación causó
el problema, no sólo una calificación general.

La evaluación debe comparar la explicación con el costo posteriormente
confirmado y con la decisión del vendedor. No debe premiarse al copiloto por
producir textos convincentes si las citas o límites son incorrectos.
