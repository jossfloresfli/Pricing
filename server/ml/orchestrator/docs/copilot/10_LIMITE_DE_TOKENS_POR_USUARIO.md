# Límite de tokens por usuario

## Política vigente

Cada usuario autenticado dispone de un máximo de 85,000 tokens de generación
por día UTC. La suma incluye tokens de entrada y salida reportados por OpenAI.
Antes de la llamada se reserva de forma conservadora la entrada estimada más el
máximo de salida; después se sustituye por el consumo real. Si la llamada falla,
se conserva la reserva porque pudo existir consumo externo.

## Identificación

El endpoint público no acepta un identificador de presupuesto. El backend toma
el identificador estable de la sesión autenticada y lo pasa a
`PriceCopilotService.explain(..., budget_subject=...)`. El componente lo convierte
a SHA-256 antes de guardarlo.

El health check general sólo publica la política y no el consumo de una persona.
Para mostrar el saldo al usuario autenticado, el backend puede consultar
`copilot_service.budget_snapshot(budget_subject=...)` después de aplicar sus
permisos.

No deben utilizarse correo, nombre visible, rol, dispositivo, dirección IP,
`quote_id` ni un UUID generado en cada solicitud. El identificador debe ser
estable para la persona y controlado por el servidor.

## Reinicio del límite

La cuota se reinicia al cambiar el día UTC. Debe mostrarse cuidadosamente en la
interfaz si el negocio opera en horario de México, porque el cambio puede no
coincidir con medianoche local.

## Límite de solicitudes existente

El límite independiente es de 25 solicitudes por usuario y día. Con los máximos
actuales de 3,000 tokens de entrada y 300 de salida, 25 solicitudes podrían
reservar hasta 82,500 tokens. Por ello, el límite de solicitudes continúa siendo
ligeramente más restrictivo que el techo de 85,000 tokens.

La diferencia de 2,500 tokens es intencional conforme a la política solicitada.
Si en el futuro se desea permitir el consumo teórico completo de 85,000 tokens
con el mismo tamaño máximo por llamada, serían necesarias al menos 26
solicitudes; ese cambio requeriría una nueva aprobación.

## Replit y múltiples réplicas

SQLite permite probar la separación en una sola instancia. En varios workers o
réplicas, la reserva debe implementarse mediante transacción o script atómico en
la base compartida. La clave lógica es día UTC más hash de usuario. Dos
solicitudes simultáneas del mismo usuario no deben superar la cuota.

## Monitoreo

La observabilidad debe reportar agregados de uso sin revelar la identidad. Se
recomienda alertar por usuarios cerca del límite, consumo anómalo, diferencias
entre reserva y consumo real y repetición de fallos que retienen reservas.
