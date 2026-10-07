# Bitácora de Proyecto: VAX Pricing Hub

**Fecha de sesión:** 7 de Octubre de 2026  
**Repositorio:** [https://github.com/jossfloresfli/Pricing.git](https://github.com/jossfloresfli/Pricing.git)  
**Rama principal:** `main`

---

## 📌 1. Resumen Ejecutivo de lo Realizado

En esta sesión logramos desacoplar completamente la aplicación de la infraestructura propietaria de **Replit**, conectarla a la base de datos real en **Supabase**, y habilitar el sistema de correos y sincronización usando **Google Apps Script** sin costos adicionales de servicios de terceros como Resend.

---

## 🚀 2. Cambios y Desacoplamientos Clave

### A. Base de Datos (PostgreSQL en Supabase)
- **Conexión activa:** Conectado a Supabase PostgreSQL con SSL (`rejectUnauthorized: false` para certificados locales).
- **Datos reales migrados e intactos:**
  - **232 cotizaciones reales** cargadas en la tabla `pricing_requests`.
  - **21 usuarios** con sus nombres, correos (`@vaxsolutions.mx`, `@fliholding.com`, etc.), roles y contraseñas (hashes bcrypt).
- **Usuario Administrador:** Actualizado en base de datos con el correo `joss.flores@fliholding.com`.

### B. Sistema de Notificaciones por Correo (Email Service)
- **Archivo:** `server/emailService.ts`
- **Cambio:** Se eliminó el SDK de Replit / Resend y se sustituyó por una llamada directa al Webhook de **Google Apps Script**.
- **Resultado:**
  - Envía correos con la plantilla HTML corporativa de **VAX Pricing Hub**.
  - **Prueba en vivo exitosa:** Correo de mención en comentario recibido en `joss.flores@fliholding.com`.
  - Anti-spam / auto-mención preservada (el autor de un comentario no recibe auto-correos si se menciona a sí mismo).

### C. Sincronización con Google Sheets (Catálogo de Clientes)
- **Archivo:** `server/googleSheets.ts`
- **Cambio:** Se desacopló del conector de Replit y ahora consulta la acción `{ action: "getClientes" }` directamente a través del Webhook de Apps Script.
- **Sincronización automática:** Programada diariamente a las 8:00 AM hora CDMX.

### D. Integración de Slack
- **Archivo:** `server/slackService.ts`
- **Cambio:** Se migró a la API Web oficial de Slack (`https://slack.com/api/chat.postMessage`) usando `SLACK_BOT_TOKEN`.

### E. Limpieza de Dependencias
- Se removió `@replit/connectors-sdk` de `package.json`.
- Servidor de desarrollo backend Express (`localhost:5000`) y microservicio de Machine Learning Python (`localhost:8100`) probados y comunicándose correctamente.

---

## 🔑 3. Variables de Entorno Clave (`.env.local`)

El archivo `.env.local` en la raíz contiene las siguientes variables principales:

```env
# Base de datos
DATABASE_URL="postgresql://postgres.xxx:xxx@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require"
PGHOST="aws-0-us-east-1.pooler.supabase.com"
PGPORT="6543"
PGDATABASE="postgres"
PGUSER="postgres.xxx"
PGPASSWORD="xxx"
NODE_TLS_REJECT_UNAUTHORIZED="0"

# Google Apps Script Webhook (Correos y Sheets)
APPS_SCRIPT_EMAIL_URL="https://script.google.com/macros/s/AKfycbwPkCtzS_bCq-I0LqEOz97QHIfKXk_vzX2xf023V7PHxyw23tqlT2_uW1xyqzZrqehl/exec"
GOOGLE_SHEET_ID="1J2VuwPUUk0mlKu5Jri4GloxBrVuczFiRZk6Ho30-M10"

# Servidor y Sesión
SESSION_SECRET="vax-pricing-hub-secret-key-2026-production"
PORT=5000
NODE_ENV=development

# ML Orchestrator
PYTHON_EXECUTABLE="python3"
PRICING_ML_PORT=8100
PRICING_ML_URL="http://127.0.0.1:8100"
```

---

## 💻 4. Cómo Iniciar el Proyecto Mañana

Para arrancar todo el entorno de trabajo:

```bash
# 1. Ir a la carpeta del proyecto
cd ~/mis-proyectos-fli/Pricing/proyecto_completo

# 2. Iniciar el servidor de desarrollo (carga .env.local automáticamente)
npm run dev
```

La aplicación estará disponible en:
👉 **`http://localhost:5000`**

### Credenciales de Acceso:
- **Administrador:** Usuario: `admin` | Correo: `joss.flores@fliholding.com`
- **Usuarios del equipo:** Correo corporativo (ej: `daniel.chavez@vaxsolutions.mx`) con sus contraseñas existentes.

---

## 📋 5. Próximos Pasos Sugeridos para la Siguiente Sesión
1. **Validación de flujos de cotización:** Probar ciclo completo de cotización (creación de cotización -> ofertas de carrier -> aprobación de pricing).
2. **Sincronización manual de Google Sheets:** Probar el botón "Sync Google Sheets" en el módulo de Catálogos como superadmin.
3. **Despliegue / Producción:** Preparar el deployment (ej. Render, Railway, VPS o Docker) si se va a poner en línea para todo el equipo.
