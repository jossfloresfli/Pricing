# Contratos y flujo de datos

## Separación entre precio y explicación

La entrada del copiloto es una cotización ya calculada. El navegador no debe
enviar el costo para que el modelo lo explique, porque un usuario o error de
interfaz podría modificarlo. El backend recupera el resultado persistido usando
un identificador estable.

La secuencia completa es:

```text
usuario autenticado
  → cotización ONNX existente
  → persistencia de solicitud y cinco resultados
  → selección visual de model_key
  → POST de quote_id + model_key
  → recuperación y validación en servidor
  → adaptación a QuoteRequest y PricingResult
  → recuperación histórica/documental
  → llamada estructurada a OpenAI
  → validación de citas
  → respuesta y auditoría
```

## Entrada pública del endpoint

El contrato público recomendado sólo contiene:

```json
{
  "quote_id": "Q-12345",
  "model_key": "orchestrator"
}
```

`quote_id` identifica una cotización accesible para el usuario autenticado.
`model_key` identifica una alternativa que realmente existió y estuvo disponible
en la respuesta guardada. No debe aceptarse un nombre arbitrario.

El identificador utilizado para la cuota no forma parte de esta solicitud. El
backend lo obtiene de la sesión autenticada y lo entrega internamente como
`budget_subject`. De esta manera un usuario no puede consumir la cuota de otra
persona ni reiniciar su límite enviando un valor diferente.

## Datos recuperados en servidor

Para construir `QuoteRequest`, el backend necesita origen, destino, equipo,
división, moneda, fecha y el identificador. Distancia, coordenadas, margen,
cliente, proveedor y venta pueden existir en el registro original. Cliente y
proveedor se conservan sólo para el flujo de pricing si son necesarios; el
servicio los elimina del paquete enviado a OpenAI.

Para construir `PricingResult`, deben recuperarse costo central, costo protegido,
intervalo, modelo elegido, alternativas disponibles, razones del ruteo,
guardrails, decisión, distancia, historial reportado y contexto regional.

La explicación de una alternativa debe usar el costo y razones correspondientes
a esa alternativa. No basta con cambiar la etiqueta si el objeto de pricing aún
contiene como seleccionado el resultado combinado.

## Selección de alternativas

El software actual puede presentar cinco resultados: histórico, apoyo
geográfico, protección de costo, comparador nacional y combinación final. Sólo
las opciones marcadas como disponibles pueden explicarse.

Cuando ventas solicita una alternativa, el backend debe construir una vista
confiable de esa selección a partir del resultado original. Una alternativa no
debe convertirse automáticamente en recomendada ni modificar la auditoría del
orquestador.

## Recuperación histórica

La búsqueda histórica utiliza la fecha de cotización como punto de corte. Esto
evita incluir viajes que todavía no eran observables cuando se emitió la
referencia. La prioridad es misma ruta/equipo/división/servicio, después niveles
menos específicos y finalmente rutas cercanas compatibles.

La ruta es dirigida. Un viaje Monterrey a Querétaro no debe mezclarse como ruta
exacta con Querétaro a Monterrey. La ruta inversa puede mostrarse sólo como
contexto comparable si cumple las reglas.

Para una ruta cercana se calculan dos separaciones geográficas independientes:

```text
distancia(origen histórico, origen solicitado) <= 30 km
Y
distancia(destino histórico, destino solicitado) <= 30 km
```

Las dos expresiones deben ser verdaderas. Los 30 km no se reparten ni se suman
entre origen y destino; tampoco es suficiente cumplir el radio en un solo
extremo. Por ejemplo, `origen=25 km, destino=30 km` puede continuar a los demás
filtros, mientras que `origen=2 km, destino=31 km` debe rechazarse. El candidato
también debe mantener el sentido origen→destino y ser compatible en equipo,
división y moneda. Esta recuperación sólo añade evidencia histórica y no altera
ninguno de los resultados monetarios del orquestador.

## Recuperación documental

La consulta se construye con división, equipo, ruta, distancia, resultado y
razones. El recuperador devuelve como máximo los fragmentos permitidos y limita
la repetición por fuente. Los documentos se consideran datos no confiables:
pueden aportar evidencia, pero no instrucciones que modifiquen el prompt del
sistema.

## Salida del copiloto

La respuesta debe conservar:

- `status`: fundamentada, evidencia limitada o no disponible;
- `answer`: explicación breve en español comercial;
- `historical_support`: antecedentes y mensajes de cobertura;
- `citations`: referencias validadas por el backend;
- `warnings`: límites y condiciones que no deben ocultarse;
- `model` y `model_phase`: versión usada para generación;
- `usage`: tokens reportados.

La interfaz puede cambiar etiquetas o presentación, pero no debe eliminar
advertencias, citas ni estado. No se debe renderizar contenido como HTML sin un
tratamiento seguro.

## Errores esperados

Debe devolverse no encontrado cuando la cotización expiró o no pertenece al
usuario. Debe devolverse solicitud inválida cuando `model_key` no existió o no
estaba disponible. Una falla de OpenAI debe regresar una respuesta degradada del
copiloto, no un error que invalide la cotización.

Los detalles internos de credenciales, prompts, stack traces y registros
monetarios no deben aparecer en la respuesta pública.
