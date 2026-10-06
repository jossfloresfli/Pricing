---
name: KPI de tiempo de cotización
description: Alcance acordado y limitaciones históricas de la medición de tiempos.
---

El usuario confirmó cuatro indicadores: general de todas las divisiones, Crossborder, Nacional (National) y Puertos (Port Freight). No fusionar Domestic con National ni Maritime con Port Freight.

**Why:** Son rubros comerciales distintos; el objetivo es medir el trabajo de Pricing hasta su entrega a Ventas, no el envío de Ventas al cliente.

**How to apply:** Mientras no exista una bitácora confiable de entradas a Por revisar, presentar creación→fecha de envío como estimación histórica, no como duración exacta de esa etapa. Mostrar el tamaño de muestra y excluir fechas faltantes/inválidas y duraciones negativas. No inferir precisión a partir del historial de texto.

El 2026-10-02 el usuario pidió excluir sábados y domingos y distinguir RFQ de no RFQ, conservando las horas completas de lunes a viernes (incluidas noches y festivos) en horario de CDMX. RFQ tiene más plazo comercial; no mezclar ambos tipos al compararlos.

**Why:** Son ciclos de cotización distintos y los fines de semana no deben penalizar a Pricing.

**How to apply:** Aplicar el filtro de tipo al KPI general y las divisiones y sus denominadores. Los históricos con marca RFQ nula se interpretan como no seleccionada (No RFQ) y debe explicitarse en la interfaz.

El usuario aclaró que RFQ necesita su propio KPI visible: un filtro por sí solo no satisface la distinción.

**Why:** Necesita comparar los tiempos RFQ y No RFQ directamente, sin alternar filtros.

**How to apply:** Mantener una comparación de ambos tipos visible en la vista de tiempos, respetando fechas pero independiente del filtro de tipo, con alcance explícito.

Los históricos sin marca RFQ no permiten atribuir la omisión al usuario ni confirmar que fueran No RFQ.

**Why:** La revisión del historial el 2026-10-02 mostró que el formulario tenía el interruptor antes de que el envío al servidor incluyera la marca. Esa omisión se corrigió en el código el 2026-09-10; la fecha del cambio no demuestra cuándo se publicó.

**How to apply:** Distinguir la agrupación estadística de nulos como No RFQ de su clasificación comercial real. No reclasificar históricos automáticamente ni culpar a los capturistas sin evidencia adicional.