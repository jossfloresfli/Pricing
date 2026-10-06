# Integración con el software existente

> Contexto Replit: el proyecto anfitrión ya contiene el orquestador ONNX. Este
> documento describe únicamente cómo conectar el copiloto al resultado y a la
> persistencia existentes. Usar junto con `../replit/PROMPT_REPLIT_AGENT.md`.

## Límite de responsabilidad

El orquestador ONNX sigue siendo la única fuente del costo. El copiloto recibe
un resultado terminado y lo explica; no recalcula el precio, no agrega recargos
y no selecciona una tarifa en nombre de ventas.

La integración recomendada es un endpoint autenticado dentro del backend
existente. El frontend sólo envía `quote_id` y `model_key`. El costo, intervalo,
razones y demás campos deben recuperarse del almacenamiento del servidor.

## Operación requerida

La operación equivalente es:

```text
POST /api/copilot/explain
```

Solicitud mínima:

```json
{
  "quote_id": "Q-12345",
  "model_key": "orchestrator"
}
```

No debe aceptarse desde el navegador una predicción monetaria ni un bloque de
evidencia. Esto evita que una explicación se genere sobre un valor alterado.

## Construcción de los contratos

El software debe mapear sus objetos a las clases de
`vax_pricing.copilot.schemas`.

`QuoteRequest` representa la solicitud original y requiere, como mínimo,
identificador, origen, destino, equipo, división, moneda y fecha. Distancia,
coordenadas, cliente, proveedor, venta y margen son opcionales según el contrato.
Cliente y proveedor no se incluyen en el paquete enviado a OpenAI.

`PricingResult` representa la salida confiable del orquestador. Debe conservar:

- costo central y costo protegido;
- intervalo técnico;
- modelo seleccionado y alternativas disponibles;
- razones del ruteo y guardrails;
- decisión y requisito de revisión;
- distancia y fuente geográfica;
- historial de la ruta informado por el modelo;
- contexto regional cuando haya participado National Geo.

La forma exacta y validaciones están en `src/vax_pricing/copilot/schemas.py`.

## Invocación del servicio

El backend inicializa `PriceCopilotService.from_settings()` una vez por worker.
Para cada explicación recupera la cotización, valida que `model_key` era una
opción disponible y llama:

```python
copilot = copilot_service.explain(
    quote_request,
    pricing_result,
    budget_subject=str(authenticated_user.id),
)
```

La respuesta contiene estado, explicación, soporte histórico, citas,
advertencias, versión del modelo y consumo. El software anfitrión decide cómo
presentarla, pero no debe ocultar advertencias ni convertir el texto en una
tarifa autorizada.

En Replit, `PriceCopilotService` debe crearse durante la inicialización del
backend y reutilizarse. No debe construirse en el navegador ni una vez por
render. `OPENAI_API_KEY` se obtiene de Secrets como variable de entorno.

`budget_subject` debe provenir de la identidad autenticada del backend. No se
agrega al contrato público y no puede enviarlo el frontend. El presupuesto
normaliza y convierte ese identificador a SHA-256 antes de persistirlo. El límite
configurado es de 85,000 tokens por usuario y día UTC.

## Persistencia

La alternativa recomendada es reutilizar la tabla o repositorio de cotizaciones
existente. Deben guardarse tanto la entrada original como los cinco resultados
del orquestador, incluso si sólo uno se muestra como recomendado.

Para auditoría del copiloto deben registrarse:

- usuario y rol;
- `quote_id` y `model_key`;
- versión del resultado de pricing;
- versión del prompt y del índice de evidencia;
- estado de la explicación;
- identificadores de evidencia citados;
- tokens, latencia y fecha UTC;
- error sanitizado cuando la generación falla.

Los prompts completos y el histórico monetario no deben enviarse a logs de uso
general.

El filesystem del Deployment no debe usarse para estado durable. Si el proyecto
ya tiene `DATABASE_URL`, el repositorio de cotizaciones y la auditoría del
copiloto deben utilizar esa conexión o la capa de datos existente. Los archivos
RAG sí pueden viajar dentro de la versión porque se consumen como artefactos de
sólo lectura.

## Autorización

La disponibilidad visual del copiloto puede extenderse a todos los roles que ya
puedan consultar la cotización, pero el endpoint debe conservar la autenticación
y las restricciones del software anfitrión. El paquete no implementa roles por
su cuenta.

## Fallos y degradación

Una falla de OpenAI nunca debe invalidar la precotización existente. El backend
debe devolver el estado no disponible del copiloto y mantener visible el
resultado ONNX. Si no hay histórico exacto, el servicio puede usar rutas
cercanas o declarar evidencia limitada.

Si faltan los artefactos históricos o documentales, el servicio no debe iniciar
como saludable. Si faltan embeddings, puede iniciar con recuperación local.
