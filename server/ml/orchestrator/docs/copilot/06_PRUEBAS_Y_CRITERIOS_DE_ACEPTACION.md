# Pruebas y criterios de aceptación

## Objetivo

La integración se acepta sólo si preserva el comportamiento del cotizador y
demuestra que el copiloto falla de manera aislada y auditable. Que la aplicación
inicie o que OpenAI devuelva texto no es suficiente.

## Pruebas unitarias incluidas

El paquete incluye pruebas de presupuesto, histórico, recuperación documental,
servicio y contrato de OpenAI. Deben ejecutarse después de adaptar imports y
rutas. No realizan una llamada real a OpenAI.

La ejecución de referencia desde la raíz del paquete está documentada en
`README.md`. En la verificación de esta entrega pasaron 16 pruebas.

## Pruebas de integración obligatorias

Debe comprobarse que el endpoint requiere autenticación, que un usuario no puede
consultar cotizaciones ajenas y que una cotización inexistente no provoca una
llamada a OpenAI.

El navegador debe enviar únicamente `quote_id` y `model_key`. Una prueba debe
intentar inyectar un costo falso y demostrar que el backend lo ignora o rechaza.

Cada una de las opciones disponibles debe mapearse al costo, intervalo y razones
correctos. Las opciones no disponibles deben rechazarse. Una falla simulada de
OpenAI debe dejar intacta la precotización ONNX.

También debe comprobarse que dos usuarios tengan presupuestos independientes,
que agotar 85,000 tokens para uno no bloquee al otro y que el navegador no pueda
suplantar `budget_subject`. La migración de una base SQLite anterior debe agregar
la dimensión de usuario sin perder registros existentes.

## Pruebas de evidencia

Se deben probar rutas con historial reciente, sólo historial antiguo, ruta
inversa, rutas cercanas y ausencia de coordenadas. Las cantidades y mensajes
deben corresponder al nivel de comparación realmente usado.

La prueba de cercanía debe demostrar la conjunción de ambos radios, no sólo
casos positivos. Como mínimo debe cubrir:

- origen a 30 km o menos y destino a 30 km o menos: candidato geográfico;
- origen dentro del radio y destino a más de 30 km: rechazado;
- destino dentro del radio y origen a más de 30 km: rechazado;
- ambos extremos fuera del radio: rechazado;
- ruta inversa con puntos próximos: no tratarla como la misma ruta dirigida;
- ausencia de coordenadas en cualquier extremo: no inventar cercanía.

También debe verificarse que los 30 km se aplican a cada extremo por separado,
que no se usa la suma de ambas distancias y que recuperar una ruta cercana no
cambia el costo producido por el orquestador.

Debe inyectarse una respuesta con un identificador de evidencia inexistente y
confirmar que se descarta. También debe probarse un fragmento documental que
contenga instrucciones maliciosas para confirmar que no modifica el contrato de
generación.

## Prueba real controlada de OpenAI

Después de aprobar pruebas locales, debe realizarse una prueba con Secret real,
una cotización desidentificada y presupuesto reducido. Debe verificarse modelo,
latencia, formato estructurado, citas, límites y consumo reportado.

No se debe usar una ruta sensible ni imprimir la solicitud completa. La prueba
debe quedar registrada con resultado esperado y aprobación responsable.

## Casos funcionales mínimos

- Crossborder con histórico suficiente.
- National nueva con coordenadas y apoyo geográfico.
- National con uno a tres antecedentes.
- National con cuatro o más antecedentes.
- Port Freight con protección.
- National LTL.
- Equipo especial con guardrail.
- Intervalo excesivo o desacuerdo alto.
- Alternativa seleccionada por ventas.
- Cotización expirada o no autorizada.
- Presupuesto diario agotado.
- OpenAI no disponible.

El copiloto no debe contradecir el estado del orquestador. Si el pricing exige
revisión o abstención, la explicación debe conservar esa condición.

## Criterios de aceptación técnica

La integración técnica se considera aceptable cuando no hay regresiones del
cotizador, todas las pruebas relevantes pasan, no existen secretos en archivos,
los artefactos RAG cargan, la cotización se recupera del servidor, los fallos
son aislados y la auditoría es suficiente para reconstruir una solicitud.

Para múltiples réplicas, también se exige persistencia compartida, límite global
atómico y ninguna escritura concurrente sobre CSV local.

## Criterios para avanzar la beta

La beta debe definir antes de comenzar un número objetivo de cotizaciones y una
ventana temporal. Se recomienda evaluar precisión de citas, utilidad, tasa de
respuesta limitada, latencia, tokens y errores por segmento.

La promoción no debe basarse sólo en satisfacción promedio. Se deben revisar
colas monetarias, rutas nuevas, equipos especiales y desacuerdos. Los resultados
de negocio deben reportarse como asociación hasta contar con un diseño que
permita atribución causal.

## Rollback

Debe probarse que `COPILOT_ENABLED=false` desactiva generación sin cambiar ONNX,
la interfaz de cotización ni permisos. También debe existir una ruta para volver
a recuperación local si el índice semántico causa errores.
