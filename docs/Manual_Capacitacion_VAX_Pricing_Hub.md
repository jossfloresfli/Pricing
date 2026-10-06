# Manual de Capacitación - VAX Pricing Hub

## 1. Introducción

VAX Pricing Hub es la plataforma interna de VAX Solutions para gestionar cotizaciones de transporte y flete. Reemplaza el flujo manual en hojas de cálculo con una aplicación web moderna que permite:

- Crear y dar seguimiento a solicitudes de cotización
- Coordinar entre equipos de ventas, carriers y pricing
- Aprobar tarifas y registrar resultados
- Consultar el historial completo de cada cotización

Toda la información se guarda en una base de datos centralizada con acceso controlado por roles.

---

## 2. Acceso a la Plataforma

### 2.1 Página de Login

Al abrir la plataforma se muestra la pantalla de inicio de sesión. Hay un solo formulario con dos campos:

- **Credencial**: Aquí se escribe el correo electrónico o nombre de usuario
- **Contraseña**: La contraseña asignada por el administrador

### 2.2 Tipos de Acceso

| Tipo de usuario | Credencial | Ejemplo |
|---|---|---|
| Usuarios regulares (ventas, carriers, pricing) | Correo electrónico | `daniel.chavez@vaxsolutions.mx` |
| Administradores (superadmin) | Nombre de usuario | `admin` |

### 2.3 Contraseñas

Las contraseñas son asignadas por el administrador del sistema al crear cada cuenta de usuario. Si olvidaste tu contraseña, contacta al administrador para que la restablezca.

### 2.4 Cerrar Sesión

En la barra lateral izquierda, al fondo, encontrarás la opción para cerrar sesión.

---

## 3. Roles y Permisos

La plataforma tiene 8 roles. Cada rol determina qué puede ver y hacer cada usuario.

### 3.1 Roles de Ventas

#### Sales Rep (Representante de Ventas)
- **Qué puede hacer:**
  - Crear nuevas solicitudes de cotización
  - Ver únicamente las cotizaciones donde está asignado como representante de ventas
  - Editar detalles de sus cotizaciones (producto, peso, notas, rutas) cuando están en etapas iniciales (Pendiente, Por Revisar, Cotizando, Feedback)
  - Agregar y eliminar rutas en sus cotizaciones
  - Agregar comentarios y mencionar a otros usuarios con @
  - Marcar cotizaciones como Ganada o Perdida
- **Qué NO puede hacer:**
  - Ver cotizaciones de otros representantes
  - Ver costos internos ni ofertas de carriers
  - Acceder a la administración del sistema

#### Sales Lead (Líder de Ventas)
- **Qué puede hacer:**
  - Todo lo que hace un Sales Rep
  - Ver todas las cotizaciones del equipo de ventas (no solo las suyas)

#### Sales Manager (Gerente de Ventas)
- **Qué puede hacer:**
  - Todo lo que hace un Sales Lead
  - Cambiar el estatus de cotizaciones a: Pendiente, Por Revisar, Enviado, Feedback, Ganada, Perdida

### 3.2 Roles de Carriers

#### Carrier Rep (Representante de Carrier)
- **Qué puede hacer:**
  - Ver únicamente las cotizaciones donde tiene ofertas asignadas
  - Agregar ofertas de transporte a las cotizaciones asignadas
  - Agregar comentarios
- **Qué NO puede hacer:**
  - Crear nuevas cotizaciones
  - Ver cotizaciones donde no está involucrado

#### Carrier Lead (Líder de Carrier)
- **Qué puede hacer:**
  - Todo lo que hace un Carrier Rep
  - Ver las solicitudes del equipo de carriers
  - Ingresar información interna de ventas (costo esperado, venta sugerida)
  - Cambiar el estatus a: Pendiente, Por Revisar, Cotizando, Enviado

#### Carrier Manager (Gerente de Carrier)
- **Qué puede hacer:**
  - Todo lo que hace un Carrier Lead
  - Validar y enrutar todas las solicitudes del equipo de carriers

### 3.3 Pricing

#### Pricing (Equipo de Pricing)
- **Qué puede hacer:**
  - Ver y editar detalles de todas las cotizaciones
  - Gestionar ofertas de carriers
  - Aprobar o rechazar tarifas
  - Cambiar cotizaciones a cualquier estatus, incluyendo Rechazada
  - Agregar comentarios y menciones

### 3.4 Superadmin (Administrador)

#### Superadmin
- **Qué puede hacer:**
  - Acceso total a todas las funciones de la plataforma
  - Gestionar usuarios (crear, editar, desactivar cuentas)
  - Administrar catálogos (Clientes, Prospectos, Representantes de Ventas, Divisiones, Tipos de Equipo, Accesorios)
  - Ver estadísticas generales del sistema
  - Cambiar cotizaciones a cualquier estatus
  - Acceder al archivo de pricing

---

## 4. Navegación Principal

La plataforma tiene una barra lateral izquierda con las siguientes secciones:

| Sección | Disponible para | Descripción |
|---|---|---|
| **Dashboard** | Todos | Vista general con estadísticas y métricas |
| **Board** | Todos | Tablero principal con las cotizaciones |
| **Nueva Cotización** | Todos excepto Carrier Rep | Formulario para crear una nueva solicitud |
| **Pricing File** | Managers (Sales Manager, Carrier Manager), Pricing y Superadmin | Archivo histórico de pricing |
| **Estadísticas** | Managers (Sales Manager, Carrier Manager), Pricing y Superadmin | Métricas generales del sistema y rendimiento por usuario/rol |
| **Usuarios y Catálogos** | Superadmin | Gestión de usuarios y catálogos del sistema |

---

## 5. Vistas del Tablero (Board)

El tablero de cotizaciones ofrece tres modos de visualización:

### 5.1 Vista Kanban (por defecto)
Muestra las cotizaciones organizadas en columnas según su estatus actual. Cada columna representa una etapa del proceso. Es la vista más visual y permite ver de un vistazo en qué etapa se encuentra cada cotización.

### 5.2 Vista Lista
Muestra las cotizaciones en formato de lista vertical con la información clave de cada una en una sola fila. Ideal para revisar muchas cotizaciones rápidamente.

### 5.3 Vista Filas (Rows)
Similar a una tabla con las cotizaciones organizadas en filas con columnas de datos. Útil para comparar información entre cotizaciones.

---

## 6. Flujo de Trabajo Normal

El proceso de una cotización sigue estas etapas, representadas como columnas en el tablero Kanban:

```
Pendiente → Por Revisar → Cotizando → Enviado → Feedback → Ganada / Perdida / Rechazada
```

### 6.1 Las 8 Etapas

#### 1. Pendiente de Info (Pendiente)
- **Qué significa:** La solicitud fue creada pero le falta información para poder procesarla.
- **Quién actúa:** El representante de ventas completa los datos faltantes (producto, rutas, peso, etc.).
- **Siguiente paso:** Cuando la información está completa, se mueve a "Por Revisar".

#### 2. Por Revisar
- **Qué significa:** La solicitud tiene toda la información y está lista para ser revisada por el equipo de carriers y pricing.
- **Quién actúa:** El equipo de carriers revisa la solicitud y comienza a buscar opciones de transporte.
- **Notificaciones:** Se notifica automáticamente a los roles de carrier y pricing.
- **Siguiente paso:** Se mueve a "Cotizando" cuando se empiezan a recibir ofertas.

#### 3. Cotizando
- **Qué significa:** Se están recopilando ofertas de diferentes carriers para esta solicitud.
- **Quién actúa:** Los representantes de carrier agregan sus ofertas con precios y condiciones.
- **Notificaciones:** Se notifica a todos los carriers involucrados.
- **Siguiente paso:** Una vez que se tienen las ofertas, se mueve a "Enviado".

#### 4. Enviado
- **Qué significa:** Las opciones de precio ya fueron enviadas al cliente para su consideración.
- **Quién actúa:** El equipo de ventas da seguimiento con el cliente.
- **Notificaciones:** Se notifica al equipo de ventas y pricing.
- **Siguiente paso:** Si el cliente responde, se mueve a "Feedback". Si acepta directamente, a "Ganada".

#### 5. Feedback
- **Qué significa:** El cliente respondió con comentarios, contraoferta o solicitud de cambios.
- **Quién actúa:** Ventas, pricing y carrier manager revisan los comentarios y ajustan la propuesta.
- **Notificaciones:** Se notifica a ventas, pricing y carrier manager.
- **Siguiente paso:** Se puede regresar a "Cotizando" para ajustar ofertas, o avanzar a "Ganada" o "Perdida".

#### 6. Ganada
- **Qué significa:** El cliente aceptó la cotización. El negocio se cerró exitosamente.
- **Notificaciones:** Se notifica a todos los involucrados.

#### 7. Perdida
- **Qué significa:** El cliente rechazó la cotización o eligió otra opción.
- **Notificaciones:** Se notifica a todos los involucrados.

#### 8. Rechazada
- **Qué significa:** La cotización fue rechazada internamente por el equipo de pricing (por ejemplo, no es viable o no cumple con los criterios).
- **Quién puede rechazar:** Solo Pricing y Superadmin.

### 6.2 Ejemplo de Flujo Completo

1. **Daniel (Sales Rep)** crea una nueva cotización para el cliente "Empresa ABC" que necesita transportar producto de CDMX a Monterrey.
2. Daniel completa la información y cambia el estatus a **Por Revisar**.
3. **Jessica (Carrier Lead)** recibe la notificación, revisa la solicitud y la mueve a **Cotizando**.
4. **Sergio (Carrier Rep)** y otros representantes de carrier agregan sus ofertas con precios.
5. Jessica revisa las ofertas, selecciona las mejores opciones y mueve la cotización a **Enviado**.
6. Daniel recibe la notificación y envía las opciones al cliente.
7. El cliente responde pidiendo un mejor precio. Daniel mueve la cotización a **Feedback** y agrega un comentario mencionando a Jessica: "@Jessica Torres, el cliente pide 5% menos".
8. Se ajustan las ofertas y se reenvían.
9. El cliente acepta. Daniel marca la cotización como **Ganada**.

---

## 7. Detalle de una Cotización

Al hacer clic en cualquier cotización del tablero, se abre un modal con toda la información detallada:

### 7.1 Información General
- Cliente y prospecto
- Producto y división
- Tipo de equipo y accesorios
- Peso y unidad de medida
- Tiempo de carga/descarga
- Indicador de carga LTL (Less Than Truckload) con dimensiones si aplica

### 7.2 Rutas
Cada cotización puede tener una o más rutas con:
- Origen y destino (con códigos postales)
- Volumen estimado
- Frecuencia de envío
- Target del cliente (precio objetivo)
- **Cruce fronterizo (por ruta)**: si la ruta requiere cruce, se marca la casilla y se indica la ciudad de cruce (ej: Nuevo Laredo, Tijuana). Aparece con un ícono 🛂 junto al lane.
- **Stops (paradas)**: cada ruta puede tener una o más paradas intermedias, cada una con su tipo (recolección, parada, entrega), ubicación, código postal y notas.

Los representantes de ventas pueden agregar, editar o eliminar rutas, cruces y stops cuando la cotización está en etapas editables (Pendiente, Por Revisar, Cotizando, Feedback).

### 7.3 Ofertas de Carrier
*(Visible para todos los roles. Solo los roles de carrier, pricing y superadmin pueden agregar o seleccionar ofertas; ventas solo las visualiza.)*
- Lista de ofertas recibidas de diferentes carriers por cada ruta
- Encabezado de cada lane muestra origen → destino, CPs, cruce 🛂 (si aplica) y stops
- Precio, condiciones y detalles de cada oferta
- Opción de seleccionar la oferta ganadora (roles autorizados)

### 7.4 Comentarios
- Historial de todos los comentarios de la cotización
- Sistema de menciones: escribe **@** seguido del nombre para mencionar a un usuario
  - El usuario mencionado recibirá una notificación
  - Puedes escribir nombres con espacios (ej: @Sergio Nava)
  - El buscador filtra mientras escribes

### 7.5 Historial
- Registro automático de todos los cambios realizados en la cotización
- Incluye cambios de estatus, ediciones y quién los realizó

---

## 8. Sistema de Notificaciones

La plataforma envía notificaciones automáticas cuando ocurren eventos importantes:

### 8.1 Tipos de Notificación
| Evento | Quién recibe la notificación |
|---|---|
| Cambio de estatus a Por Revisar | Carriers y Pricing |
| Cambio de estatus a Cotizando | Todos los carriers |
| Cambio de estatus a Enviado | Ventas y Pricing |
| Cambio de estatus a Feedback | Ventas, Pricing y Carrier Manager |
| Cambio de estatus a Ganada o Perdida | Todos los involucrados |
| Nueva oferta de carrier | Usuarios relevantes |
| Mención en comentario (@usuario) | El usuario mencionado |

### 8.2 Dónde ver las notificaciones
Las notificaciones aparecen dentro de la plataforma. También se envían por correo electrónico cuando están configuradas.

### 8.3 Reglas importantes
- Nunca recibirás notificación por tus propias acciones
- No se envían notificaciones duplicadas

---

## 9. Dashboard

El Dashboard muestra un resumen con métricas generales:

- **Total de cotizaciones** en el sistema
- **Cotizaciones activas** (en proceso)
- **Cotizaciones ganadas**
- **Tasa de éxito** (porcentaje de cotizaciones ganadas)
- Distribución de cotizaciones por estatus

Las métricas que ves dependen de tu rol:
- **Sales Rep**: Solo ve estadísticas de sus propias cotizaciones
- **Carrier Rep**: Solo ve estadísticas de cotizaciones donde tiene ofertas
- **Otros roles**: Ven estadísticas generales

---

## 10. Crear una Nueva Cotización

*(Disponible para todos los roles excepto Carrier Rep)*

1. Haz clic en **"Nueva Cotización"** en la barra lateral
2. Completa el formulario con:
   - **Cliente**: Selecciona de la lista de clientes registrados
   - **Producto**: Descripción del producto a transportar
   - **División**: Área o división del negocio
   - **Tipo de equipo**: Tipo de transporte requerido
   - **Accesorios**: Equipamiento adicional necesario
   - **Peso y unidad de medida**
   - **Tiempo de carga/descarga**
   - **Notas comerciales**: Información adicional relevante
   - **Rutas**: Agrega al menos una ruta con origen, destino y detalles
3. Para cada ruta, si requiere cruce fronterizo, marca la casilla **"Requiere cruce"** e indica la ciudad de cruce. Puedes agregar stops (paradas intermedias) con su tipo, ubicación, CP y notas.
4. Si es carga LTL, marca la casilla correspondiente y agrega las dimensiones
5. Haz clic en **Crear** para guardar la cotización

Al enviar el formulario verás una pantalla de **"Creando cotización..."** que bloquea la vista mientras se guarda. Una vez confirmada, aparecerá un check verde **"¡Cotización creada!"** y serás redirigido al tablero, donde la nueva tarjeta ya estará visible. No cierres la ventana durante este proceso.

La cotización se creará con estatus **"Por Revisar"**.

---

## 11. Administración (Solo Superadmin)

### 11.1 Gestión de Usuarios
- **Crear usuarios**: Asignar nombre, correo, nombre de usuario, contraseña y rol
- **Editar usuarios**: Modificar datos y cambiar roles
- **Desactivar usuarios**: Los usuarios desactivados no pueden iniciar sesión

### 11.2 Catálogos
Gestión de los catálogos del sistema:
- **Clientes**: Empresas registradas como clientes. **Solo lectura** desde la plataforma — se sincronizan exclusivamente desde Google Sheets (hoja "BD Cliente", columna A) automáticamente cada día a las 8:00 AM (CDMX), o manualmente con el botón de sincronización.
- **Prospectos**: Clientes potenciales
- **Representantes de Ventas**: Lista del equipo comercial
- **Divisiones**: Áreas de negocio
- **Tipos de Equipo**: Tipos de transporte disponibles
- **Accesorios**: Equipamiento adicional

### 11.3 Estadísticas
*(Disponible también para Sales Manager, Carrier Manager y Pricing)*
Panel con métricas generales del sistema, rendimiento por rol y por usuario (cotizaciones creadas, ganadas, perdidas y cambios de estatus).

---

## 12. Consejos y Buenas Prácticas

1. **Mantén la información completa**: Entre más completa esté la solicitud, más rápido se podrá cotizar.
2. **Usa las menciones (@)**: Cuando necesites la atención de alguien específico, menciónalo en los comentarios para que reciba una notificación.
3. **Actualiza el estatus**: Mueve las cotizaciones al estatus correcto para que todo el equipo sepa en qué etapa se encuentra cada solicitud.
4. **Revisa tus notificaciones**: Las notificaciones te avisan cuando hay acciones pendientes que requieren tu atención.
5. **Agrega notas comerciales**: Cualquier detalle relevante del cliente o la negociación ayuda al equipo a dar un mejor servicio.

---

## 13. Preguntas Frecuentes

**No puedo ver una cotización que sé que existe.**
Tu rol determina qué cotizaciones puedes ver. Si eres Sales Rep, solo ves las tuyas. Si eres Carrier Rep, solo ves donde tienes ofertas. Contacta a tu líder o al administrador si necesitas acceso.

**No veo el cliente que necesito en el catálogo.**
El catálogo de clientes se sincroniza desde Google Sheets diariamente a las 8:00 AM. Si agregaste un cliente nuevo a la hoja "BD Cliente", el superadmin puede ejecutar la sincronización manual o esperar al siguiente día.

**Cree una cotización pero no aparece en el tablero.**
Al crear una cotización verás una pantalla de carga con spinner que espera la confirmación del servidor. Si te redirige al tablero, la cotización ya está guardada. Si no aparece, revisa el filtro por rol (Sales Rep solo ve las suyas) o recarga la página.

**No puedo cambiar el estatus de una cotización.**
Cada rol tiene permisos limitados para cambiar estatus. Si necesitas mover una cotización a un estatus que no te permite tu rol, pide a alguien con el permiso adecuado que lo haga.

**Olvidé mi contraseña.**
Contacta al administrador del sistema para que restablezca tu contraseña.

**No recibo notificaciones por correo.**
Las notificaciones por correo dependen de la configuración del sistema. Contacta al administrador si no las estás recibiendo.
