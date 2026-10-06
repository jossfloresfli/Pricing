---
name: Diagnóstico de Places publicado
description: Diferenciar configuración actual y credenciales de navegador incorporadas al publicar.
---
No atribuir un fallo del autocompletado publicado a la ausencia de una clave en los Secrets actuales sin verificar el artefacto publicado.

**Why:** El 2026-09-10, la configuración consultada no mostraba clave de Maps, pero el JavaScript servido en producción sí contenía una clave de navegador incorporada al compilar. Pedir una clave nueva como solución del fallo activo fue prematuro.

**How to apply:** Verificar sólo presencia, sin extraer ni imprimir credenciales. Separar los requisitos para la próxima compilación de los errores del proveedor o de interfaz en la versión activa. Obtener evidencia de consola en la pantalla autenticada antes de afirmar la causa del fallo.