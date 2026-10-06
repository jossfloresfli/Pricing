# Seguridad, privacidad y auditoría

## Principio de mínimo acceso

El copiloto debe heredar la autenticación del software existente. Un usuario
sólo puede solicitar explicaciones de cotizaciones que ya tiene permiso de ver.
Hacer visible el botón a más roles no elimina las reglas de acceso a datos ni
otorga facultad para autorizar tarifas.

## Secrets en Replit

`OPENAI_API_KEY` debe existir en Replit Secrets y nunca en el repositorio,
frontend, logs o `.env.example`. El backend accede a la variable de entorno. La
aplicación no debe incluir un endpoint que confirme o muestre su valor.

Los Secrets deben revisarse también en la configuración del Deployment. La
aplicación requiere backend y no es compatible con una publicación puramente
estática.

## Datos que no deben enviarse a OpenAI

El contrato actual elimina cliente y proveedor del paquete de generación. Deben
mantenerse fuera también correos, teléfonos, nombres de contacto, instrucciones
privadas, credenciales, tokens de sesión y cualquier identificador que no sea
necesario para explicar el precio.

Los folios de carga se usan como referencia interna en la interfaz. Antes de una
liberación debe confirmarse con el responsable de datos si pueden enviarse o si
deben sustituirse por identificadores opacos. El principio recomendado es enviar
el mínimo contexto suficiente.

## Confianza en las fuentes

Los documentos recuperados son evidencia, no instrucciones. El prompt indica
que cualquier texto que intente cambiar reglas, pedir secretos o ejecutar
acciones debe ignorarse. Replit no debe habilitar herramientas web, ejecución de
código ni conectores para esta operación.

Las citas solicitadas al modelo se comparan contra el conjunto de evidencia
servido. Una cita inventada se descarta. La interfaz sólo debe mostrar
referencias validadas por el backend.

## Persistencia segura

Las cotizaciones, selecciones y auditoría deben almacenarse en la base existente
o en una base compartida. El filesystem de un deployment no debe considerarse
una fuente persistente para contadores, decisiones o cambios de caché.

Los archivos RAG pueden empaquetarse como artefactos de sólo lectura. Debe
evitarse exponer `rag/`, `data/` o `docs/` mediante el servidor estático.

## Logging

Los logs operativos deberían contener identificadores hash u opacos, usuario,
evento, estado, latencia, versión, citas y consumo. No deberían contener clave
API, prompt completo, respuesta completa, cliente, proveedor ni filas completas
del histórico.

Los errores enviados al navegador deben estar sanitizados. El stack trace se
conserva únicamente en observabilidad restringida.

La cuota diaria utiliza un identificador estable obtenido de la autenticación.
No debe emplearse correo, nombre visible ni un valor controlado por el cliente.
El componente persiste solamente SHA-256 del identificador. En una base
compartida debe conservarse la misma propiedad y una restricción única o índice
por fecha UTC y hash de usuario.

## Auditoría mínima

Por solicitud debe poder reconstruirse:

- quién pidió la explicación y con qué rol;
- qué cotización y alternativa se explicaron;
- qué resultado de pricing estaba guardado;
- qué versión de prompt, modelo y evidencia se usó;
- qué citas fueron aceptadas;
- qué estado y advertencias se devolvieron;
- cuántos tokens se consumieron;
- si ventas cambió de alternativa y por qué;
- qué costo fue posteriormente confirmado.

## Retención y gobierno

El periodo de retención debe alinearse con las políticas internas de cotización,
privacidad y auditoría. La existencia de datos históricos en este paquete no
autoriza una retención indefinida ni su uso para otros fines.

Antes de producción deben asignarse responsables de la clave, corpus,
presupuesto, incidentes, evaluación comercial y aprobación del lenguaje mostrado
a ventas.
