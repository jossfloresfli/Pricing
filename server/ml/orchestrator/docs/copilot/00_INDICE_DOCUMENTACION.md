# Índice de documentación

## Objetivo del índice

Esta carpeta explica cómo incorporar el copiloto a un software existente en
Replit sin modificar el orquestador ONNX ya integrado. La documentación separa
el contexto comercial, el contrato técnico, la operación y las instrucciones
para Replit Agent, de modo que una persona nueva pueda entender tanto el porqué
como el cómo de la integración.

En todos los documentos, “ruta cercana” conserva una única definición: origen
histórico a 30 km o menos del origen solicitado **y** destino histórico a 30 km
o menos del destino solicitado, evaluados por separado. El detalle funcional y
los ejemplos están en `01_RESUMEN_EJECUTIVO.md`; el contrato exacto está en
`03_CONTRATOS_Y_FLUJO_DE_DATOS.md`.

## Ruta de lectura recomendada

Para dirección, Producto o responsables de Ventas, comenzar con
`01_RESUMEN_EJECUTIVO.md` y `04_USO_FUNCIONAL_POR_VENTAS.md`. Ahí se define qué
problema resuelve el copiloto, qué no puede hacer y cómo debe interpretarse.

Para Replit Agent o el equipo de desarrollo, continuar con
`02_INVENTARIO_Y_DESTINO_DE_ARCHIVOS.md`,
`INTEGRACION_SOFTWARE_EXISTENTE.md` y `03_CONTRATOS_Y_FLUJO_DE_DATOS.md`.

Para responsables de plataforma, seguridad o datos, revisar
`05_SEGURIDAD_PRIVACIDAD_Y_AUDITORIA.md`,
`ESCALAMIENTO_Y_OPERACION.md` y `07_ACTUALIZACION_DE_EVIDENCIA.md`.

Antes de liberar una versión, ejecutar lo indicado en
`06_PRUEBAS_Y_CRITERIOS_DE_ACEPTACION.md` y consultar
`08_SOLUCION_DE_PROBLEMAS_EN_REPLIT.md` si la aplicación no inicia o el
copiloto aparece como no disponible.

## Documentos incluidos

### Contexto y alcance

- `01_RESUMEN_EJECUTIVO.md`: decisión, alcance, beneficios, límites y riesgos.
- `ARQUITECTURA_COPILOTO.md`: arquitectura técnica heredada del prototipo.
- `04_USO_FUNCIONAL_POR_VENTAS.md`: experiencia esperada para usuarios.

### Integración técnica

- `02_INVENTARIO_Y_DESTINO_DE_ARCHIVOS.md`: qué copiar y dónde colocarlo.
- `INTEGRACION_SOFTWARE_EXISTENTE.md`: integración con autenticación, base y API.
- `03_CONTRATOS_Y_FLUJO_DE_DATOS.md`: entradas, salidas y secuencia de datos.
- `REPLIT_REFERENCIAS.md`: enlaces oficiales sobre Secrets, Agent y Deployments.

### Operación y gobierno

- `05_SEGURIDAD_PRIVACIDAD_Y_AUDITORIA.md`: secretos, acceso, datos y logging.
- `06_PRUEBAS_Y_CRITERIOS_DE_ACEPTACION.md`: pruebas técnicas y comerciales.
- `07_ACTUALIZACION_DE_EVIDENCIA.md`: mantenimiento del histórico y documentos.
- `ESCALAMIENTO_Y_OPERACION.md`: persistencia, monitoreo, rollout y rollback.
- `08_SOLUCION_DE_PROBLEMAS_EN_REPLIT.md`: diagnóstico por síntoma.
- `09_REPORTE_DE_ESTADO_DEL_PAQUETE.md`: hechos verificados de esta entrega.
- `10_LIMITE_DE_TOKENS_POR_USUARIO.md`: política de 85,000 tokens, identidad,
  reinicio UTC y relación con el límite de solicitudes.

### Archivos dirigidos a Replit Agent

- `../replit/PROMPT_REPLIT_AGENT.md`: instrucción completa para implementar.
- `../replit/replit.md`: memoria viva que puede integrarse al proyecto Replit.
- `../replit/custom_instruction/instructions.md`: reglas estables que el agente
  no debe reinterpretar.

## Principio central

El copiloto explica una precotización que ya existe. No predice costos, no
reentrena modelos, no decide qué opción debe seleccionar ventas y no confirma
capacidad de transportista. Si una implementación rompe esta separación, se
considera fuera del alcance de esta entrega.
