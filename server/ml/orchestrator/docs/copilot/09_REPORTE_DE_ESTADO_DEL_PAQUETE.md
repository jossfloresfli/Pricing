# Reporte de estado del paquete

## Alcance de la revisión

Este reporte describe la copia preparada para integrarse a Replit. No evalúa el
proyecto Replit real porque no se encuentra en este workspace. La integración
final debe confirmar stack, rutas, base, autenticación y contrato del orquestador
ya instalado.

## Hechos verificados

El paquete se construyó sin copiar artefactos `.onnx` o `.joblib`. El código del
copiloto, los artefactos históricos y documentales, el caché geográfico, pruebas,
configuración y documentación fueron separados en una carpeta independiente.

La copia original se verificó mediante hashes para confirmar que los archivos de
runtime coincidían con el proyecto fuente. Las pruebas independientes ejecutadas
desde la copia aprobaron 16 casos sin llamar a OpenAI y sin ejecutar el
orquestador.

El repositorio histórico cargó 10,435 registros. El corpus documental cargó 423
fragmentos y reportó la versión `copilot-evidence-v3` construida el
28 de julio de 2026 a las 23:00 UTC.

La recuperación geográfica incluida define una ruta cercana mediante dos
condiciones simultáneas: origen histórico a 30 km o menos del origen solicitado
**y** destino histórico a 30 km o menos del destino solicitado. El radio se
aplica independientemente a cada extremo; no se suman las distancias y no basta
con que un único extremo cumpla. Después se conservan los filtros de sentido,
equipo, división y moneda. El resultado se utiliza sólo como evidencia
secundaria del copiloto y no interviene en el cálculo ONNX.

## Estado de embeddings

Los vectores disponibles en el proyecto fuente correspondían a 399 fragmentos y
su checksum no coincidía con el corpus actual. No fueron copiados. La entrega
queda en modo de recuperación local, que es funcional y está cubierto por las
pruebas.

La búsqueda semántica es un incremento opcional, no un requisito para la primera
beta. Debe activarse sólo después de reconstruir y validar el índice.

## Dependencias externas

La única credencial externa necesaria para generación es `OPENAI_API_KEY`. El
valor no está incluido. Replit Secrets debe inyectarlo al backend. La generación
permanece desactivable mediante `COPILOT_ENABLED`.

El paquete presupone acceso a la base o repositorio de cotizaciones del software
existente. `quote_store.py` no constituye persistencia de producción.

## Limitaciones conocidas

Los contadores de consumo actuales usan SQLite local. No son globales entre
réplicas y el filesystem de un deployment no debe tratarse como persistente. La
integración debe reemplazar esa capa si escala horizontalmente.

La versión actual del paquete separa generación por usuario y limita cada
identidad autenticada a 85,000 tokens y 25 solicitudes por día UTC. El
identificador se guarda como hash. La separación se probó localmente; una
implementación distribuida debe reproducirla en la base compartida.

No se incluyó un endpoint listo para insertar porque hacerlo sin conocer el
framework, autenticación y repositorio de Replit podría duplicar o debilitar el
sistema existente. `PROMPT_REPLIT_AGENT.md` instruye al agente para descubrir
esas piezas antes de implementar.

No se realizó una llamada real a OpenAI. Esa prueba requiere autorización,
Secret activo y consumo controlado en el proyecto anfitrión.

## Estado recomendado

El paquete está listo para integración técnica y pruebas en Replit. No debe
considerarse listo para producción hasta completar persistencia compartida,
autorización del endpoint, prueba real controlada, observabilidad, evaluación de
privacidad y criterios de beta descritos en la documentación.
