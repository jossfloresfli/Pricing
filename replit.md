# VAX Pricing Hub

## Overview

VAX Pricing Hub is an internal SaaS-style platform for managing freight/transport pricing quotes, approvals, and rate tracking. It replaces a manual Google Sheets workflow with a modern web application featuring role-based access control, a Kanban-style pricing board, and comprehensive catalog management.

The application handles the full pricing request lifecycle: from sales representatives creating quote requests, through carrier teams providing cost options, to pricing team approval and final rate recording.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript, built using Vite
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state, React Context for auth/theme
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens, CSS variables for theming
- **Form Handling**: React Hook Form with Zod validation

### Backend Architecture
- **Runtime**: Node.js with Express
- **API Style**: RESTful JSON API under `/api/*` routes
- **Database ORM**: Drizzle ORM with PostgreSQL
- **Authentication**: Session-based authentication with bcrypt password hashing
  - Regular users login with email (e.g., daniel.chavez@vaxsolutions.mx)
  - Administrators (superadmin) login with username
- **Build System**: esbuild for server bundling, Vite for client

### Data Layer
- **Database**: PostgreSQL (provisioned via Replit)
- **Schema Location**: `shared/schema.ts` - shared between client and server
- **Migrations**: Drizzle Kit (`npm run db:push`)
- **Key Entities**: Users, Clientes, Prospectos, Sales Reps, Divisiones, Tipos de Equipo, Accesorios

### Role-Based Access Control
Eight user roles with hierarchical permissions:
- `carrier_rep` - Can view and add offers only on quotes where they have offers assigned; cannot create quotes
- `carrier_lead` - View team requests, send to manager/pricing
- `carrier_manager` - Validate and route all carrier requests
- `sales_rep` - Sales team member, can only view quotes where they are the assigned Sales Rep
- `sales_lead` - Sales team lead, can view all quotes from the sales team
- `sales_manager` - Sales manager with broader visibility
- `pricing` - Approve rates and manage pricing
- `superadmin` - Full system access, can manage users and catalogs

**Dashboard Filtering**:
- `sales_rep`: Dashboard and Board show only quotes where salesRep matches user's name
- `carrier_rep`: Dashboard and Board show only quotes where user has offers as carrierRep

**Sales Edit Capabilities** (sales_rep, sales_lead, sales_manager):
- Can edit quote details in statuses: pendiente, por_revisar, cotizando, feedback
- Editable fields: producto, peso, unidadMedida, tiempoCargaDescarga, notas comerciales, LTL dimensions
- Can add, edit, or delete routes from the quote detail modal when in edit mode
- Route editing includes: origen, destino, códigos postales, volumen, frecuencia, target cliente
- Changes are saved via PATCH requests and recorded in historial

### Admin Features (Superadmin Only)
- **User Management**: Create/edit/delete users with roles, passwords (bcrypt hashed + plain text stored in `plainPassword` for admin visibility), and active status
- **Password Visibility**: Admin users table shows the plain text password so superadmin always knows current credentials
- **Catalog Management**: CRUD operations for Prospectos, Sales Reps, Divisiones, Tipos de Equipo, Accesorios
- **Clientes Catalog**: Read-only, synced exclusively from Google Sheets (BD Cliente, column A). No create/edit/delete from the platform

### Key Design Patterns
- **Monorepo Structure**: Client (`client/`), server (`server/`), shared types (`shared/`)
- **Path Aliases**: `@/` for client source, `@shared/` for shared code
- **Component Examples**: Each major component has an example in `components/examples/`
- **Mock Data**: Currently uses mock data (marked with `// todo: remove mock functionality`)

## External Dependencies

### Database
- PostgreSQL via `DATABASE_URL` environment variable
- Connection pooling with `pg` package
- Schema management through Drizzle Kit

### UI Framework Dependencies
- Radix UI primitives (dialogs, dropdowns, forms, etc.)
- Lucide React for icons
- class-variance-authority for component variants
- date-fns for date formatting

### Development Tools
- Vite dev server with HMR
- Replit-specific plugins for development (cartographer, dev-banner, error overlay)
- TypeScript with strict mode

### Fonts (External)
- Inter (Google Fonts) - primary UI font
- JetBrains Mono (Google Fonts) - monospace for numerical data

### Email Notifications (Resend)
- **Service**: `server/emailService.ts` - Sends transactional emails via Resend API
- **Integration**: Uses Replit's connector system for secure API key management
- **Trigger**: Emails are automatically sent when notifications are created
- **Template**: Professional HTML email template with VAX Pricing Hub branding
- **Types**: Supports different notification types (status_change, new_offer, offer_selected, comment, info)

### Google Sheets Integration
- **Service**: `server/googleSheets.ts` - Reads and syncs client data from Google Sheets
- **Authentication**: Uses Replit's connector system for OAuth tokens
- **Environment Variable**: `GOOGLE_SHEET_ID` - The ID of the target spreadsheet (1ajf2VV31g97HV7bmTXusgZkbFZHNrJrsyOchEH0ofP0)
- **Source Sheet**: `BD Cliente` tab, column A only (client names)
- **Endpoint**: `GET /api/google-sheets/clientes` - Returns all clients from the Google Sheet
- **Sync Endpoint**: `POST /api/google-sheets/sync` - Manual sync trigger (superadmin only)
- **Auto Sync**: Daily at 8:00 AM — scheduler in `server/index.ts` syncs clientes catalog from Google Sheets to DB (adds new clients, reactivates inactive ones)
- **Clientes are read-only in the platform** — only synced from Google Sheets, never created/edited/deleted from the app
### Predicción de Tarifas (ML)
- **Orquestador (principal)**: Protected Cost Orchestrator — 28 modelos ONNX (Champion, Quantile Risk/P67, National Geo, National Hybrid) en `server/ml/orchestrator/` (paquete Python original, hashes verificados vs manifest)
  - Servicio Python interno (`server/ml/orchestrator/serve.py`, puerto 8100 local) lanzado como proceso hijo por Express al arrancar (`server/ml/orchestratorClient.ts`)
  - Modo `shadow_only`: siempre revisión humana requerida; router segmentado decide costo/modelo/razones; Crossborder mantiene incumbente; P67 protege equipos especiales, rutas nuevas y deciles D7/D8/D10
  - Requiere Python 3.11 + numpy/pandas/onnxruntime (instalados vía gestor de paquetes; deps en `pyproject.toml`)
- **Fallback**: modelo base Champion en Node (`server/ml/predictor.ts`, artifacts en `server/ml/artifacts/`) si el orquestador no está disponible o la ruta no tiene distancia
- **Endpoint**: `POST /api/predict-tarifa` — restringido a roles carrier_lead, carrier_manager, pricing y superadmin; responde `motor: "orquestador" | "modelo_base"` con costo seleccionado, centro, costo protegido, intervalo, modelo, razones, guardrails y acción
- **Distancia**: caché CSV de rutas → Google Distance Matrix (usa `GOOGLE_MAPS_API_KEY` si existe, fallback `VITE_GOOGLE_MAPS_API_KEY`) → mediana (solo fallback)
- **UI**: botón "Predecir tarifa" por ruta en la pestaña Venta; muestra costo sugerido, modelo, centro/protegido, historial de ruta, motivos de ruteo, guardrails, acción recomendada y disclaimer de precotización
