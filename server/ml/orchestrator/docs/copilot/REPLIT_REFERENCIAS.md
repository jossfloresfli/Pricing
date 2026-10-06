# Referencias oficiales de Replit

## Secrets

Replit Secrets cifra valores y los expone a la aplicación como variables de
entorno. El nombre del Secret debe coincidir con el nombre leído por el código.
La documentación también aclara que Secrets no aplica a Static Deployments.

https://docs.replit.com/core-concepts/project-editor/app-setup/secrets

## Trabajo con Replit Agent

La guía oficial recomienda proporcionar contexto específico, pedir un plan,
revisar, probar y usar checkpoints. Es la razón por la que esta entrega incluye
un prompt con fases y criterios de aceptación, en vez de pedir una modificación
abierta.

https://docs.replit.com/learn/build-with-agent

## Instrucciones del proyecto

Replit documenta `replit.md` como memoria viva que Agent actualiza y
`custom_instruction/instructions.md` como reglas organizacionales estables en
plantillas. Los archivos incluidos en `replit/` siguen esa separación y deben
fusionarse con cualquier archivo existente, no sobrescribirse a ciegas.

https://docs.replit.com/teams/custom-templates

## Importación de proyectos

Una importación conserva archivos y estructura, pero no valores de variables de
entorno ni configuración externa. Después de cargar este paquete deben revisarse
Secrets y el comando del proyecto.

https://docs.replit.com/build/import-from-providers

## Diagnóstico y Deployments

La guía de diagnóstico explica diferencias entre Preview y Deployment, Secrets,
procesos de servidor, host/puerto, persistencia y limitaciones de deployments
estáticos. Debe consultarse antes de cambiar código por un problema de entorno.

https://docs.replit.com/build/troubleshooting
