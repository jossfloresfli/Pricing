# Guía para exportar VAX Pricing Hub y desarrollarlo fuera de Replit

## Objetivo

Esta guía explica cómo copiar el código y los datos de VAX Pricing Hub a una
computadora propia, instalar sus dependencias y ejecutarlo localmente sin
depender de la infraestructura de Replit.

> **Estado de portabilidad actual**
>
> - La aplicación web, PostgreSQL, Google Maps y el servicio Python/ONNX pueden
>   ejecutarse localmente.
> - Slack, Google Sheets y Resend usan conectores administrados por Replit.
>   Esas tres funciones no funcionarán fuera de Replit hasta sustituir los
>   conectores por credenciales y clientes propios de cada proveedor.
> - Nunca copies secretos al repositorio ni los incluyas en el ZIP o en un
>   commit de Git.

---

## 1. Stack, lenguajes y versiones

### Arquitectura

La aplicación es un monorepo con tres partes:

1. Un frontend React servido por Vite durante desarrollo.
2. Un backend Express que expone la API REST y, en producción, sirve también
   los archivos compilados del frontend.
3. Un servicio auxiliar Python que ejecuta el motor de costo protegido, modelos
   ONNX y el copiloto explicador. El backend Node inicia este servicio
   automáticamente como un proceso hijo.

El navegador y la API comparten el mismo origen y el mismo puerto.

### Runtimes

| Componente | Versión usada |
|---|---:|
| Node.js | 20 |
| npm | Utilizar la versión incluida con Node 20 |
| TypeScript | 5.6.3 |
| Python | 3.11 o posterior |
| PostgreSQL | 16 |

### Stack JavaScript/TypeScript principal

Las versiones siguientes son las resoluciones actuales de `package-lock.json`.
El rango solicitado originalmente está en `package.json`.

| Tecnología | Versión resuelta |
|---|---:|
| React | 18.3.1 |
| React DOM | 18.3.1 |
| Vite | 6.4.3 |
| TypeScript | 5.6.3 |
| tsx | 4.22.4 |
| Express | 4.22.2 |
| Drizzle ORM | 0.45.2 |
| Drizzle Kit | 0.31.10 |
| PostgreSQL driver `pg` | 8.16.3 |
| TanStack React Query | 5.60.5 |
| Wouter | 3.3.5 |
| Tailwind CSS | 3.4.17 |
| Zod | 3.24.2 |
| bcrypt | 6.0.0 |
| express-session | 1.19.0 |
| connect-pg-simple | 10.0.0 |
| ONNX Runtime para Node | 1.27.0 |
| Google APIs | 148.0.0 |
| Resend SDK | 4.0.0 |
| XLSX | 0.18.5 |
| esbuild | 0.25.12 |
| Replit Connectors SDK | 0.4.1 |

Otras bibliotecas de interfaz importantes son Radix UI, React Hook Form,
Recharts, Framer Motion, Lucide, date-fns y los componentes estilo shadcn/ui.

### Stack Python

El proyecto raíz declara estas dependencias en `pyproject.toml`; `uv.lock`
conserva sus resoluciones:

| Biblioteca | Versión resuelta relevante |
|---|---:|
| NumPy | El proyecto raíz admite 2.4.6 o posterior; el servicio fija 2.5.1 |
| pandas | 3.0.3 |
| ONNX Runtime | 1.27.0 |
| OpenAI | 2.53.0 |
| psycopg | 3.3.4 |
| Pydantic | 2.13.4 |
| python-dotenv | 1.2.2 |
| scikit-learn | 1.9.0 |
| tiktoken | 0.13.0 |

Para el servicio ML deben conservarse tanto `pyproject.toml`/`uv.lock` como
`server/ml/orchestrator/requirements.txt`. Este último no incluye `psycopg`,
por lo que instalar solamente ese archivo no es suficiente para todas las
funciones persistentes del copiloto.

---

## 2. Estructura del proyecto

```text
.
├── client/
│   ├── public/                    Archivos estáticos del frontend
│   └── src/
│       ├── components/            Componentes y formularios React
│       ├── contexts/              Contextos globales
│       ├── hooks/                 Hooks de la interfaz
│       ├── lib/                   Cliente de API y utilidades
│       └── pages/                 Pantallas y rutas de la aplicación
├── server/
│   ├── index.ts                   Arranque de Express, sesiones y servicios
│   ├── routes.ts                  Endpoints REST de la aplicación
│   ├── db.ts                      Conexión PostgreSQL
│   ├── storage.ts                 Acceso a datos con Drizzle
│   ├── migrate.ts                 DDL adicional ejecutado al arrancar
│   ├── seed.ts                    Datos iniciales para una base vacía
│   ├── vite.ts                    Vite como middleware en desarrollo
│   ├── static.ts                  Archivos compilados en producción
│   ├── googleSheets.ts            Integración Sheets dependiente de Replit
│   ├── slackService.ts            Integración Slack dependiente de Replit
│   ├── emailService.ts            Integración Resend dependiente de Replit
│   └── ml/
│       ├── artifacts/             Modelos ONNX y datos del predictor Node
│       └── orchestrator/
│           ├── serve.py           Servidor Python local, puerto interno
│           ├── artifacts/         Artefactos propios del orquestador
│           ├── config/            Configuración empaquetada del motor
│           ├── data/              Datos requeridos por los modelos
│           ├── protected_cost/    Motor protegido de costo
│           ├── vax_pricing/       Paquete del copiloto y retrieval
│           ├── rag/               Activos RAG y fallback local
│           ├── scripts/           Construcción de modelos/embeddings
│           └── tests/copilot/     Pruebas unittest del copiloto
├── shared/
│   └── schema.ts                  Esquema Drizzle y tipos compartidos
├── migrations/                    Migraciones SQL históricas de Drizzle
├── script/
│   └── build.ts                   Compila frontend y backend
├── scripts/
│   └── post-merge.sh              Validación automática usada en Replit
├── docs/                           Documentación del proyecto
├── attached_assets/                Archivos importados y adjuntos
├── package.json                    Scripts y dependencias Node
├── package-lock.json               Resoluciones exactas npm
├── pyproject.toml                  Dependencias Python raíz
├── uv.lock                         Resoluciones Python
├── drizzle.config.ts               Configuración PostgreSQL/Drizzle
├── vite.config.ts                  Configuración Vite
├── tsconfig.json                   Configuración TypeScript
├── tailwind.config.ts              Configuración Tailwind
└── .replit                         Configuración exclusiva de Replit
```

### Archivos que no son necesarios para correr localmente

No es necesario exportar los directorios generados:

- `node_modules/`
- `.pythonlibs/`
- `.cache/`
- `.upm/`
- `dist/`
- `.local/`
- `.agents/`

Se pueden regenerar. No deben subirse a Git.

### Archivos que sí deben conservarse

Además del código fuente, conservar:

- `server/ml/artifacts/`
- `server/ml/orchestrator/`
- Los archivos de datos/modelos incluidos dentro de esas carpetas
- `package-lock.json`
- `uv.lock`
- `shared/schema.ts`
- `migrations/`

El archivo `main.py` de la raíz no inicia el motor ML; es un ejemplo antiguo.
El servicio real se inicia con `server/ml/orchestrator/serve.py`.

---

## 3. Variables de entorno y secretos

Esta sección contiene **solamente nombres**, nunca valores.

### Núcleo de la aplicación

| Nombre | Necesidad | Uso |
|---|---|---|
| `DATABASE_URL` | Obligatoria | PostgreSQL, Drizzle, sesiones y persistencia Python |
| `SESSION_SECRET` | Obligatoria en producción | Firma de sesiones |
| `NODE_ENV` | Operativa | Selecciona desarrollo o producción |
| `PORT` | Opcional | Puerto HTTP de Express |
| `ORCHESTRATOR_PORT` | Opcional | Puerto interno del servicio Python |
| `APP_BASE_URL` | Recomendable | Enlaces absolutos de notificaciones |

### Google Maps y catálogo

| Nombre | Necesidad | Uso |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Opcional al arrancar; necesaria para consultar rutas no cacheadas y geocodificar | API de Google Maps |
| `VITE_GOOGLE_MAPS_API_KEY` | Fallback heredado | Actualmente también es leído por el servidor |
| `GOOGLE_SHEET_ID` | Necesaria si se usa el catálogo de Sheets | Identificador de la hoja |

Aunque `VITE_GOOGLE_MAPS_API_KEY` tenga prefijo `VITE_`, no se debe exponer una
clave sensible al navegador. Para una instalación nueva conviene estandarizar
el backend en `GOOGLE_MAPS_API_KEY`.

### Slack

| Nombre | Necesidad | Uso |
|---|---|---|
| `SLACK_CHANNEL_NAME` | Opcional | Canal de notificaciones |

La autenticación de Slack **no tiene una variable local en el código actual**:
se obtiene con `@replit/connectors-sdk`. Al salir de Replit se deberá introducir
una credencial propia y modificar `server/slackService.ts`. Un nombre local
recomendado para esa futura variable es `SLACK_BOT_TOKEN`, pero todavía no está
implementado.

### Resend

La autenticación de Resend tampoco tiene una variable local en el código
actual. `server/emailService.ts` consulta el servicio interno de conexiones de
Replit. Para usarlo localmente se deberá modificar el servicio y agregar una
variable propia, normalmente `RESEND_API_KEY`, junto con un remitente de un
dominio verificado. Ese nombre recomendado todavía no está leído por el código.

### Google Sheets

La autenticación de Google Sheets se realiza mediante el conector de Replit.
Fuera de Replit se debe elegir uno de estos mecanismos y adaptar
`server/googleSheets.ts`:

- OAuth de Google para una cuenta de usuario; o
- una cuenta de servicio y `GOOGLE_APPLICATION_CREDENTIALS`.

`GOOGLE_APPLICATION_CREDENTIALS` es una recomendación de migración, no una
variable que el código actual ya consuma.

### Copiloto/OpenAI

Todas son opcionales si el copiloto queda desactivado:

- `OPENAI_API_KEY`
- `COPILOT_ENABLED`
- `COPILOT_MODEL_PHASE`
- `OPENAI_MODEL_TEST`
- `OPENAI_MODEL_TARGET`
- `OPENAI_EMBEDDING_MODEL`
- `COPILOT_SEMANTIC_SEARCH`
- `COPILOT_TIMEOUT_SECONDS`
- `COPILOT_MAX_INPUT_TOKENS`
- `COPILOT_MAX_OUTPUT_TOKENS`
- `COPILOT_DAILY_TOKEN_LIMIT`
- `COPILOT_DAILY_REQUEST_LIMIT`
- `COPILOT_EMBEDDING_DAILY_TOKEN_LIMIT`
- `COPILOT_EMBEDDING_DAILY_REQUEST_LIMIT`
- `COPILOT_MAX_HISTORY_RECORDS`
- `COPILOT_MAX_ROUTE_SUMMARIES`
- `COPILOT_NEARBY_ROUTE_RADIUS_KM`
- `COPILOT_NEARBY_ROUTE_DISTANCE_TOLERANCE_PCT`
- `COPILOT_MAX_NEARBY_ROUTE_SUMMARIES`
- `COPILOT_REGIONAL_SUPPORT_ENABLED`
- `COPILOT_MAX_REGIONAL_ROUTE_SUMMARIES`
- `COPILOT_REGIONAL_COST_LEVEL_LOWER_PCT`
- `COPILOT_REGIONAL_COST_LEVEL_HIGHER_PCT`
- `COPILOT_REGIONAL_MIN_TRIPS_FOR_LEVEL`
- `COPILOT_MAX_DOCUMENTS`

### Variables inyectadas por Replit que deben eliminarse o sustituirse

Estas variables no existen normalmente en una computadora local:

- `REPLIT_CONNECTORS_HOSTNAME`
- `REPL_IDENTITY`
- `WEB_REPL_RENEWAL`
- `REPLIT_DOMAINS`
- `REPL_ID`

### Integraciones configuradas pero no utilizadas por el código actual

El Repl tiene nombres de configuración de Firebase disponibles, pero no se
encontraron referencias activas en el código:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_PROJECT_ID`

No son necesarias para arrancar la versión actual.

### Cómo cargar variables localmente

El backend Node no carga automáticamente un archivo `.env`. No basta con crear
el archivo si no se exportan sus variables al proceso.

En macOS, Linux o WSL:

```bash
set -a
source .env.local
set +a
npm run dev
```

En PowerShell se deben definir las variables con `$env:NOMBRE` antes de iniciar
el proceso. No copies a local los tokens internos de Replit: no funcionan fuera
de su infraestructura.

Agregar al `.gitignore`:

```text
.env
.env.*
!.env.example
*.dump
*.sql.gz
package-lock.*backup*
```

---

## 4. Base de datos y exportación de datos

### Tecnología

- Motor: PostgreSQL 16.
- ORM: Drizzle ORM.
- Driver: `pg`.
- Esquema principal: `shared/schema.ts`.
- Configuración: `drizzle.config.ts`.
- Sesiones: tabla PostgreSQL administrada por `connect-pg-simple`.
- Migraciones adicionales de arranque: `server/migrate.ts`.

La migración SQL histórica dentro de `migrations/` es más antigua que el
esquema actual. Para conservar fielmente una instancia existente, es más seguro
exportar y restaurar toda la base que reconstruirla solo con la primera
migración.

### Información sensible

La base contiene datos de usuarios, correos, sesiones, clientes, cotizaciones,
costos, márgenes, notificaciones y persistencia del copiloto. También existe un
campo heredado de contraseña en texto. El respaldo debe tratarse como
información confidencial:

- exportarlo solo con autorización;
- cifrarlo durante almacenamiento y transferencia;
- no subirlo a GitHub;
- no compartirlo por chat;
- eliminar las copias temporales después de verificar la restauración.

Revisar también antes de publicar el repositorio:

- `production_users.sql`
- `create_admin.js`
- `generate_users.js`
- `hash_password.js`

Son herramientas de aprovisionamiento y pueden contener información que no debe
estar en un repositorio público.

### Exportar desde Replit

Abrir Shell en Replit. El comando usa la variable existente sin imprimir su
valor:

```bash
mkdir -p private-backups
chmod 700 private-backups
pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --file="private-backups/vax-pricing.dump" \
  --no-owner \
  --no-privileges \
  --exclude-table-data=public.session \
  --verbose
chmod 600 private-backups/vax-pricing.dump
pg_restore --list private-backups/vax-pricing.dump > /tmp/vax-restore-list.txt
```

Excluir los datos de `session` evita trasladar sesiones activas. Después,
descargar `private-backups/vax-pricing.dump` desde el panel de archivos de
Replit y borrarlo del Repl cuando la copia local esté verificada.

Si la base está recibiendo escrituras, hacer el respaldo durante una ventana de
mantenimiento. `pg_dump` obtiene una instantánea consistente, pero una
cotización creada después de iniciar el respaldo no quedará incluida.

### Crear PostgreSQL local

Instalar PostgreSQL 16 y sus herramientas cliente. Crear una base vacía y un
usuario local desde una cuenta administradora:

```bash
createuser --pwprompt vax_local
createdb --owner=vax_local vax_pricing_local
export DATABASE_URL='URL_LOCAL'
```

No uses en local la contraseña ni la URL de la base de producción.

### Restaurar el respaldo

Definir una URL local mediante el gestor de secretos o la terminal y ejecutar:

```bash
export TARGET_DATABASE_URL='postgresql://LOCAL_USER:LOCAL_PASSWORD@LOCAL_HOST:LOCAL_PORT/vax_pricing_local'

pg_restore \
  --dbname="$TARGET_DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  --verbose \
  ./vax-pricing.dump
```

El texto anterior es un marcador de formato, no una credencial real. No
guardarlo con una contraseña válida dentro del repositorio.

Si falla una restauración, eliminar y volver a crear únicamente la base local
de prueba antes de reintentar. No usar `--clean` contra una base valiosa.

### Validar la restauración

```bash
psql "$TARGET_DATABASE_URL" -c 'SELECT version();'
psql "$TARGET_DATABASE_URL" -c \
  "SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2;"
psql "$TARGET_DATABASE_URL" -c \
  "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM pricing_requests; SELECT COUNT(*) FROM carrier_offers; SELECT COUNT(*) FROM google_maps_route_cache;"
```

Comparar los conteos importantes contra la base de origen antes de permitir
escrituras en la copia local.

### Crear una base vacía sin datos

Para una instalación completamente nueva:

```bash
export DATABASE_URL='URL_LOCAL'
npm run db:push
npm run dev
```

Revisar cualquier propuesta destructiva de Drizzle antes de aceptarla. El
arranque ejecuta también `server/migrate.ts` y luego `server/seed.ts`. No se debe
ejecutar el seed sobre una restauración de producción de manera deliberada; el
seed solo está pensado para una base vacía.

### Otros datos persistentes

PostgreSQL es la fuente principal, pero se deben copiar los modelos y datos
versionados:

- `server/ml/artifacts/`
- `server/ml/orchestrator/`
- datos RAG y modelos dentro del orquestador

Los SQLite dentro de `server/ml/orchestrator/rag/runtime/` son fallbacks o
persistencia heredada. Con `DATABASE_URL`, el sistema actual prefiere
PostgreSQL. Copiarlos solo si se necesita conservar historial forense antiguo,
no como sustituto de la base principal.

---

## 5. Instalación y ejecución local

### Sistema recomendado

La ruta más sencilla es:

- macOS;
- Linux; o
- Windows con WSL 2.

Los scripts npm actuales usan sintaxis Unix para `NODE_ENV`, y el backend busca
el ejecutable `python3`. En Windows nativo habría que adaptar esos dos puntos.

### Herramientas necesarias

Instalar:

1. Git.
2. Node.js 20.
3. Python 3.11 o posterior.
4. PostgreSQL 16 y `pg_dump`/`pg_restore`.
5. Compilador nativo si bcrypt, ONNX Runtime u otra dependencia lo requiere.

En Debian/Ubuntu/WSL puede ser necesario:

```bash
sudo apt update
sudo apt install build-essential python3-dev libpq-dev postgresql-client
```

### Descargar el código

Opción recomendada: conectar el Repl a un repositorio privado de GitHub y luego:

```bash
git clone URL_DEL_REPOSITORIO
cd DIRECTORIO_DEL_PROYECTO
```

También se puede descargar el proyecto como ZIP desde Replit y descomprimirlo.
No incluir el respaldo de base, archivos `.env`, `node_modules`, cachés ni
credenciales en un repositorio público.

Documentación de Replit:

- https://docs.replit.com/help/projects-and-files
- https://docs.replit.com/features/workspace-tools/git-interface

### Instalar Node manteniendo las versiones resueltas

El `package-lock.json` contiene algunas URLs internas de
`package-firewall.replit.local`. Fuera de Replit pueden no responder. Para
preservar las versiones exactas, reemplazar únicamente ese host por el registro
público en la copia local antes de usar `npm ci`. Primero conservar una copia
del lockfile original:

```bash
npm config set registry https://registry.npmjs.org/
cp package-lock.json package-lock.replit-backup.json

node -e "const fs=require('fs');const p='package-lock.json';let s=fs.readFileSync(p,'utf8');s=s.replaceAll('http://package-firewall.replit.local/npm/','https://registry.npmjs.org/');fs.writeFileSync(p,s)"

npm ci
```

Comparar y conservar el lockfile adaptado si la instalación termina
correctamente. No subir `package-lock.replit-backup.json` al repositorio.

Si una dependencia ya no existe en el registro público, detenerse y revisar esa
dependencia. No borrar ni regenerar el lockfile original sin una decisión
explícita, porque hacerlo puede cambiar cientos de versiones transitivas.

### Instalar Python

En macOS, Linux o WSL:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r server/ml/orchestrator/requirements.txt
python -m pip install "psycopg[binary]>=3.3.4"
```

El proyecto raíz no está empaquetado como una biblioteca Python instalable; por
eso no se debe depender de `pip install -e .`. El archivo del orquestador aporta
sus dependencias y `psycopg` completa la persistencia PostgreSQL que falta en
ese archivo.

Alternativa usando `uv` sobre el mismo entorno explícito:

```bash
python -m pip install uv
uv pip install --python .venv/bin/python \
  -r server/ml/orchestrator/requirements.txt \
  "psycopg[binary]>=3.3.4"
```

Confirmar que el proceso Node encontrará el mismo entorno. Al activar el venv,
su `python3` debe quedar primero en `PATH`, porque el backend invoca literalmente
ese ejecutable:

```bash
which python3
python3 --version
python3 -c "import sys; assert sys.prefix != sys.base_prefix; print(sys.executable)"
```

Si `python3` no apunta dentro de `.venv`, no iniciar todavía la app: volver a
activar el entorno o adaptar `server/ml/orchestratorClient.ts` para aceptar una
variable de ejecutable Python.

### Configurar el entorno

Crear `.env.local` únicamente en la computadora local con las variables
necesarias. Para el arranque mínimo se requieren PostgreSQL y la sesión. Maps e
integraciones son opcionales según las funciones que se quieran probar. El
copiloto está desactivado de forma predeterminada; si se activa
`COPILOT_ENABLED`, también se necesita configurar OpenAI.

Cargar el archivo:

```bash
set -a
source .env.local
set +a
```

### Validaciones antes de iniciar

```bash
npm run check
python -m compileall -q server/ml/orchestrator
(cd server/ml/orchestrator && python -m unittest discover -s tests/copilot)
```

El repositorio puede contener errores TypeScript heredados en componentes de
ejemplo. Deben distinguirse de errores nuevos en los archivos productivos.

### Ejecutar en desarrollo

Con el entorno Python activado y las variables exportadas:

```bash
npm run dev
```

Abrir:

```text
http://localhost:5000
```

Express inicia automáticamente el servicio Python en loopback. Validarlo:

```bash
curl -fsS http://127.0.0.1:8100/health
```

No se necesita iniciar `serve.py` por separado durante el flujo normal. Para
diagnóstico aislado:

```bash
cd server/ml/orchestrator
python3 serve.py
```

### Compilar y ejecutar en modo producción

```bash
npm run build
npm run start
```

La compilación produce:

- frontend en `dist/public`;
- backend empaquetado en `dist/index.cjs`.

En producción, `SESSION_SECRET` debe estar definida y el sitio debe servirse con
HTTPS si conserva cookies `secure`/`SameSite=None`.

### Windows nativo sin WSL

Los scripts `dev` y `start` usan asignación Unix de `NODE_ENV`. En PowerShell se
puede iniciar temporalmente así:

```powershell
$env:NODE_ENV="development"
npx tsx server/index.ts
```

Para producción:

```powershell
$env:NODE_ENV="production"
node dist/index.cjs
```

También habría que cambiar el ejecutable `python3` usado por
`server/ml/orchestratorClient.ts`, o instalar un alias compatible. Por eso WSL 2
es la opción recomendada en Windows.

---

## 6. Configuración específica de Replit que se debe reemplazar

### `.replit`

El archivo actual configura exclusivamente:

- módulos Node 20, Python 3.11 y PostgreSQL 16;
- paquetes Nix;
- comando de Run;
- workflow de desarrollo;
- puerto interno y proxy público;
- compilación y arranque del deployment autoscale;
- conectores Firebase, base de datos, Sheets, Resend y Slack;
- variables compartidas;
- script posterior a merges.

Fuera de Replit no se interpreta. Se puede conservar como referencia o
eliminarlo después de confirmar la migración.

Reemplazos locales:

| Replit | Sustitución local |
|---|---|
| Módulos de `.replit` | Node/Python/PostgreSQL instalados en el sistema |
| Nix packages | Gestor de paquetes del sistema |
| Workflow `npm run dev` | Terminal, IDE o administrador de procesos |
| Proxy de puerto 5000 a 80 | `http://localhost:5000` |
| Deployment autoscale | Servidor propio o proveedor elegido |
| Replit Database | PostgreSQL local/administrado propio |
| Replit Secrets | `.env.local` no versionado o gestor de secretos |
| Conectores | OAuth/API keys propios y cambios de código |
| Post-merge hook | CI local/GitHub Actions |

### `replit.nix`

No existe un archivo `replit.nix` en este proyecto. La configuración Nix está
embebida dentro de `.replit`.

### `vite.config.ts`

Incluye plugins específicos de Replit:

- `@replit/vite-plugin-runtime-error-modal`
- `@replit/vite-plugin-cartographer`
- `@replit/vite-plugin-dev-banner`

Cartographer y el banner están condicionados por `REPL_ID`; fuera de Replit no
deberían activarse. Para eliminar totalmente la dependencia, quitar esos
imports/plugins y después retirar sus paquetes de `package.json`.

### Conectores administrados

#### Slack

`server/slackService.ts` usa el proxy del SDK de Replit. Para migrarlo:

1. crear una Slack App propia;
2. conceder los permisos mínimos necesarios;
3. instalarla en el workspace;
4. almacenar su token en un gestor de secretos;
5. sustituir `connectors.proxy("slack", ...)` por llamadas oficiales a Slack;
6. invitar el bot al canal;
7. conservar `users.lookupByEmail` para las menciones nativas.

#### Google Sheets

`server/googleSheets.ts` usa el proxy del SDK. Sustituirlo por `googleapis` con
OAuth o una cuenta de servicio y compartir la hoja con esa identidad.

#### Resend

`server/emailService.ts` consulta un endpoint interno de Replit para obtener la
conexión. Sustituirlo por el SDK `resend` usando una API key propia y un dominio
verificado.

### URL pública y proxy

El código usa `REPLIT_DOMAINS` como fallback para enlaces de Slack. Fuera de
Replit se debe definir `APP_BASE_URL`.

Express confía en un proxy y usa cookies seguras en producción. Si se despliega
con Nginx, Caddy, Cloudflare u otro proxy:

1. terminar HTTPS en el proxy;
2. reenviar las cabeceras `X-Forwarded-*`;
3. mantener consistente la configuración `trust proxy`;
4. verificar login y persistencia de sesión desde el dominio final.

### Archivos de colaboración de Replit

- `replit.md` es documentación para agentes, no un requisito de ejecución.
- `.agents/`, `.local/`, `.cache/`, `.upm/` y `.pythonlibs/` son estado de
  herramientas/entorno y no deben formar parte del paquete local limpio.

---

## 7. Checklist de salida

### Código

- [ ] Exportar por Git privado o ZIP.
- [ ] No incluir secretos, dumps, cachés ni dependencias generadas.
- [ ] Corregir URLs internas del `package-lock.json`.
- [ ] Instalar Node 20 y Python 3.11+.
- [ ] Copiar todos los modelos y activos de `server/ml`.

### Datos

- [ ] Congelar o reducir escrituras durante el respaldo.
- [ ] Crear `pg_dump` custom sin sesiones activas.
- [ ] Descargar el dump por un canal seguro.
- [ ] Restaurar en PostgreSQL 16 local.
- [ ] Comparar tablas y conteos.
- [ ] Eliminar copias temporales del dump.

### Configuración

- [ ] Crear variables locales sin copiar tokens internos de Replit.
- [ ] Crear un `SESSION_SECRET` nuevo.
- [ ] Usar credenciales locales, nunca las de producción.
- [ ] Configurar `APP_BASE_URL` en el entorno final.
- [ ] Revisar scripts de usuarios antes de publicar el repositorio.

### Funciones

- [ ] Login y sesiones.
- [ ] Consulta de cotizaciones.
- [ ] Creación/edición en una base local de prueba.
- [ ] Google Maps y caché de rutas.
- [ ] Salud del orquestador Python.
- [ ] Predictor ONNX.
- [ ] Copiloto, solo si se configuró OpenAI.
- [ ] Reemplazo local de Google Sheets.
- [ ] Reemplazo local de Slack y menciones.
- [ ] Reemplazo local de Resend.

### Producción fuera de Replit

- [ ] `npm run build`.
- [ ] HTTPS.
- [ ] PostgreSQL administrado con backups.
- [ ] Gestor de secretos.
- [ ] Supervisor de procesos para Node.
- [ ] Monitoreo de Node y del servicio Python.
- [ ] CI para TypeScript y pruebas Python.

---

## Resumen de comandos

```bash
# 1. Descargar
git clone URL_DEL_REPOSITORIO
cd DIRECTORIO_DEL_PROYECTO

# 2. Node
npm config set registry https://registry.npmjs.org/
node -e "const fs=require('fs');const p='package-lock.json';let s=fs.readFileSync(p,'utf8');s=s.replaceAll('http://package-firewall.replit.local/npm/','https://registry.npmjs.org/');fs.writeFileSync(p,s)"
npm ci

# 3. Python
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r server/ml/orchestrator/requirements.txt
python -m pip install "psycopg[binary]>=3.3.4"

# 4. Cargar variables locales
set -a
source .env.local
set +a

# 5. Validar
npm run check
python -m compileall -q server/ml/orchestrator
(cd server/ml/orchestrator && python -m unittest discover -s tests/copilot)

# 6. Desarrollo
npm run dev

# 7. Producción
npm run build
npm run start
```

La aplicación local queda disponible en `http://localhost:5000`; el servicio
Python interno utiliza `127.0.0.1:8100` salvo que se configure otro puerto.# Guía para exportar VAX Pricing Hub y desarrollarlo fuera de Replit

## Objetivo

Esta guía explica cómo copiar el código y los datos de VAX Pricing Hub a una
computadora propia, instalar sus dependencias y ejecutarlo localmente sin
depender de la infraestructura de Replit.

> **Estado de portabilidad actual**
>
> - La aplicación web, PostgreSQL, Google Maps y el servicio Python/ONNX pueden
>   ejecutarse localmente.
> - Slack, Google Sheets y Resend usan conectores administrados por Replit.
>   Esas tres funciones no funcionarán fuera de Replit hasta sustituir los
>   conectores por credenciales y clientes propios de cada proveedor.
> - Nunca copies secretos al repositorio ni los incluyas en el ZIP o en un
>   commit de Git.

---

## 1. Stack, lenguajes y versiones

### Arquitectura

La aplicación es un monorepo con tres partes:

1. Un frontend React servido por Vite durante desarrollo.
2. Un backend Express que expone la API REST y, en producción, sirve también
   los archivos compilados del frontend.
3. Un servicio auxiliar Python que ejecuta el motor de costo protegido, modelos
   ONNX y el copiloto explicador. El backend Node inicia este servicio
   automáticamente como un proceso hijo.

El navegador y la API comparten el mismo origen y el mismo puerto.

### Runtimes

| Componente | Versión usada |
|---|---:|
| Node.js | 20 |
| npm | Utilizar la versión incluida con Node 20 |
| TypeScript | 5.6.3 |
| Python | 3.11 o posterior |
| PostgreSQL | 16 |

### Stack JavaScript/TypeScript principal

Las versiones siguientes son las resoluciones actuales de `package-lock.json`.
El rango solicitado originalmente está en `package.json`.

| Tecnología | Versión resuelta |
|---|---:|
| React | 18.3.1 |
| React DOM | 18.3.1 |
| Vite | 6.4.3 |
| TypeScript | 5.6.3 |
| tsx | 4.22.4 |
| Express | 4.22.2 |
| Drizzle ORM | 0.45.2 |
| Drizzle Kit | 0.31.10 |
| PostgreSQL driver `pg` | 8.16.3 |
| TanStack React Query | 5.60.5 |
| Wouter | 3.3.5 |
| Tailwind CSS | 3.4.17 |
| Zod | 3.24.2 |
| bcrypt | 6.0.0 |
| express-session | 1.19.0 |
| connect-pg-simple | 10.0.0 |
| ONNX Runtime para Node | 1.27.0 |
| Google APIs | 148.0.0 |
| Resend SDK | 4.0.0 |
| XLSX | 0.18.5 |
| esbuild | 0.25.12 |
| Replit Connectors SDK | 0.4.1 |

Otras bibliotecas de interfaz importantes son Radix UI, React Hook Form,
Recharts, Framer Motion, Lucide, date-fns y los componentes estilo shadcn/ui.

### Stack Python

El proyecto raíz declara estas dependencias en `pyproject.toml`; `uv.lock`
conserva sus resoluciones:

| Biblioteca | Versión resuelta relevante |
|---|---:|
| NumPy | El proyecto raíz admite 2.4.6 o posterior; el servicio fija 2.5.1 |
| pandas | 3.0.3 |
| ONNX Runtime | 1.27.0 |
| OpenAI | 2.53.0 |
| psycopg | 3.3.4 |
| Pydantic | 2.13.4 |
| python-dotenv | 1.2.2 |
| scikit-learn | 1.9.0 |
| tiktoken | 0.13.0 |

Para el servicio ML deben conservarse tanto `pyproject.toml`/`uv.lock` como
`server/ml/orchestrator/requirements.txt`. Este último no incluye `psycopg`,
por lo que instalar solamente ese archivo no es suficiente para todas las
funciones persistentes del copiloto.

---

## 2. Estructura del proyecto

```text
.
├── client/
│   ├── public/                    Archivos estáticos del frontend
│   └── src/
│       ├── components/            Componentes y formularios React
│       ├── contexts/              Contextos globales
│       ├── hooks/                 Hooks de la interfaz
│       ├── lib/                   Cliente de API y utilidades
│       └── pages/                 Pantallas y rutas de la aplicación
├── server/
│   ├── index.ts                   Arranque de Express, sesiones y servicios
│   ├── routes.ts                  Endpoints REST de la aplicación
│   ├── db.ts                      Conexión PostgreSQL
│   ├── storage.ts                 Acceso a datos con Drizzle
│   ├── migrate.ts                 DDL adicional ejecutado al arrancar
│   ├── seed.ts                    Datos iniciales para una base vacía
│   ├── vite.ts                    Vite como middleware en desarrollo
│   ├── static.ts                  Archivos compilados en producción
│   ├── googleSheets.ts            Integración Sheets dependiente de Replit
│   ├── slackService.ts            Integración Slack dependiente de Replit
│   ├── emailService.ts            Integración Resend dependiente de Replit
│   └── ml/
│       ├── artifacts/             Modelos ONNX y datos del predictor Node
│       └── orchestrator/
│           ├── serve.py           Servidor Python local, puerto interno
│           ├── artifacts/         Artefactos propios del orquestador
│           ├── config/            Configuración empaquetada del motor
│           ├── data/              Datos requeridos por los modelos
│           ├── protected_cost/    Motor protegido de costo
│           ├── vax_pricing/       Paquete del copiloto y retrieval
│           ├── rag/               Activos RAG y fallback local
│           ├── scripts/           Construcción de modelos/embeddings
│           └── tests/copilot/     Pruebas unittest del copiloto
├── shared/
│   └── schema.ts                  Esquema Drizzle y tipos compartidos
├── migrations/                    Migraciones SQL históricas de Drizzle
├── script/
│   └── build.ts                   Compila frontend y backend
├── scripts/
│   └── post-merge.sh              Validación automática usada en Replit
├── docs/                           Documentación del proyecto
├── attached_assets/                Archivos importados y adjuntos
├── package.json                    Scripts y dependencias Node
├── package-lock.json               Resoluciones exactas npm
├── pyproject.toml                  Dependencias Python raíz
├── uv.lock                         Resoluciones Python
├── drizzle.config.ts               Configuración PostgreSQL/Drizzle
├── vite.config.ts                  Configuración Vite
├── tsconfig.json                   Configuración TypeScript
├── tailwind.config.ts              Configuración Tailwind
└── .replit                         Configuración exclusiva de Replit
```

### Archivos que no son necesarios para correr localmente

No es necesario exportar los directorios generados:

- `node_modules/`
- `.pythonlibs/`
- `.cache/`
- `.upm/`
- `dist/`
- `.local/`
- `.agents/`

Se pueden regenerar. No deben subirse a Git.

### Archivos que sí deben conservarse

Además del código fuente, conservar:

- `server/ml/artifacts/`
- `server/ml/orchestrator/`
- Los archivos de datos/modelos incluidos dentro de esas carpetas
- `package-lock.json`
- `uv.lock`
- `shared/schema.ts`
- `migrations/`

El archivo `main.py` de la raíz no inicia el motor ML; es un ejemplo antiguo.
El servicio real se inicia con `server/ml/orchestrator/serve.py`.

---

## 3. Variables de entorno y secretos

Esta sección contiene **solamente nombres**, nunca valores.

### Núcleo de la aplicación

| Nombre | Necesidad | Uso |
|---|---|---|
| `DATABASE_URL` | Obligatoria | PostgreSQL, Drizzle, sesiones y persistencia Python |
| `SESSION_SECRET` | Obligatoria en producción | Firma de sesiones |
| `NODE_ENV` | Operativa | Selecciona desarrollo o producción |
| `PORT` | Opcional | Puerto HTTP de Express |
| `ORCHESTRATOR_PORT` | Opcional | Puerto interno del servicio Python |
| `APP_BASE_URL` | Recomendable | Enlaces absolutos de notificaciones |

### Google Maps y catálogo

| Nombre | Necesidad | Uso |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Opcional al arrancar; necesaria para consultar rutas no cacheadas y geocodificar | API de Google Maps |
| `VITE_GOOGLE_MAPS_API_KEY` | Fallback heredado | Actualmente también es leído por el servidor |
| `GOOGLE_SHEET_ID` | Necesaria si se usa el catálogo de Sheets | Identificador de la hoja |

Aunque `VITE_GOOGLE_MAPS_API_KEY` tenga prefijo `VITE_`, no se debe exponer una
clave sensible al navegador. Para una instalación nueva conviene estandarizar
el backend en `GOOGLE_MAPS_API_KEY`.

### Slack

| Nombre | Necesidad | Uso |
|---|---|---|
| `SLACK_CHANNEL_NAME` | Opcional | Canal de notificaciones |

La autenticación de Slack **no tiene una variable local en el código actual**:
se obtiene con `@replit/connectors-sdk`. Al salir de Replit se deberá introducir
una credencial propia y modificar `server/slackService.ts`. Un nombre local
recomendado para esa futura variable es `SLACK_BOT_TOKEN`, pero todavía no está
implementado.

### Resend

La autenticación de Resend tampoco tiene una variable local en el código
actual. `server/emailService.ts` consulta el servicio interno de conexiones de
Replit. Para usarlo localmente se deberá modificar el servicio y agregar una
variable propia, normalmente `RESEND_API_KEY`, junto con un remitente de un
dominio verificado. Ese nombre recomendado todavía no está leído por el código.

### Google Sheets

La autenticación de Google Sheets se realiza mediante el conector de Replit.
Fuera de Replit se debe elegir uno de estos mecanismos y adaptar
`server/googleSheets.ts`:

- OAuth de Google para una cuenta de usuario; o
- una cuenta de servicio y `GOOGLE_APPLICATION_CREDENTIALS`.

`GOOGLE_APPLICATION_CREDENTIALS` es una recomendación de migración, no una
variable que el código actual ya consuma.

### Copiloto/OpenAI

Todas son opcionales si el copiloto queda desactivado:

- `OPENAI_API_KEY`
- `COPILOT_ENABLED`
- `COPILOT_MODEL_PHASE`
- `OPENAI_MODEL_TEST`
- `OPENAI_MODEL_TARGET`
- `OPENAI_EMBEDDING_MODEL`
- `COPILOT_SEMANTIC_SEARCH`
- `COPILOT_TIMEOUT_SECONDS`
- `COPILOT_MAX_INPUT_TOKENS`
- `COPILOT_MAX_OUTPUT_TOKENS`
- `COPILOT_DAILY_TOKEN_LIMIT`
- `COPILOT_DAILY_REQUEST_LIMIT`
- `COPILOT_EMBEDDING_DAILY_TOKEN_LIMIT`
- `COPILOT_EMBEDDING_DAILY_REQUEST_LIMIT`
- `COPILOT_MAX_HISTORY_RECORDS`
- `COPILOT_MAX_ROUTE_SUMMARIES`
- `COPILOT_NEARBY_ROUTE_RADIUS_KM`
- `COPILOT_NEARBY_ROUTE_DISTANCE_TOLERANCE_PCT`
- `COPILOT_MAX_NEARBY_ROUTE_SUMMARIES`
- `COPILOT_REGIONAL_SUPPORT_ENABLED`
- `COPILOT_MAX_REGIONAL_ROUTE_SUMMARIES`
- `COPILOT_REGIONAL_COST_LEVEL_LOWER_PCT`
- `COPILOT_REGIONAL_COST_LEVEL_HIGHER_PCT`
- `COPILOT_REGIONAL_MIN_TRIPS_FOR_LEVEL`
- `COPILOT_MAX_DOCUMENTS`

### Variables inyectadas por Replit que deben eliminarse o sustituirse

Estas variables no existen normalmente en una computadora local:

- `REPLIT_CONNECTORS_HOSTNAME`
- `REPL_IDENTITY`
- `WEB_REPL_RENEWAL`
- `REPLIT_DOMAINS`
- `REPL_ID`

### Integraciones configuradas pero no utilizadas por el código actual

El Repl tiene nombres de configuración de Firebase disponibles, pero no se
encontraron referencias activas en el código:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_PROJECT_ID`

No son necesarias para arrancar la versión actual.

### Cómo cargar variables localmente

El backend Node no carga automáticamente un archivo `.env`. No basta con crear
el archivo si no se exportan sus variables al proceso.

En macOS, Linux o WSL:

```bash
set -a
source .env.local
set +a
npm run dev
```

En PowerShell se deben definir las variables con `$env:NOMBRE` antes de iniciar
el proceso. No copies a local los tokens internos de Replit: no funcionan fuera
de su infraestructura.

Agregar al `.gitignore`:

```text
.env
.env.*
!.env.example
*.dump
*.sql.gz
package-lock.*backup*
```

---

## 4. Base de datos y exportación de datos

### Tecnología

- Motor: PostgreSQL 16.
- ORM: Drizzle ORM.
- Driver: `pg`.
- Esquema principal: `shared/schema.ts`.
- Configuración: `drizzle.config.ts`.
- Sesiones: tabla PostgreSQL administrada por `connect-pg-simple`.
- Migraciones adicionales de arranque: `server/migrate.ts`.

La migración SQL histórica dentro de `migrations/` es más antigua que el
esquema actual. Para conservar fielmente una instancia existente, es más seguro
exportar y restaurar toda la base que reconstruirla solo con la primera
migración.

### Información sensible

La base contiene datos de usuarios, correos, sesiones, clientes, cotizaciones,
costos, márgenes, notificaciones y persistencia del copiloto. También existe un
campo heredado de contraseña en texto. El respaldo debe tratarse como
información confidencial:

- exportarlo solo con autorización;
- cifrarlo durante almacenamiento y transferencia;
- no subirlo a GitHub;
- no compartirlo por chat;
- eliminar las copias temporales después de verificar la restauración.

Revisar también antes de publicar el repositorio:

- `production_users.sql`
- `create_admin.js`
- `generate_users.js`
- `hash_password.js`

Son herramientas de aprovisionamiento y pueden contener información que no debe
estar en un repositorio público.

### Exportar desde Replit

Abrir Shell en Replit. El comando usa la variable existente sin imprimir su
valor:

```bash
mkdir -p private-backups
chmod 700 private-backups
pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --file="private-backups/vax-pricing.dump" \
  --no-owner \
  --no-privileges \
  --exclude-table-data=public.session \
  --verbose
chmod 600 private-backups/vax-pricing.dump
pg_restore --list private-backups/vax-pricing.dump > /tmp/vax-restore-list.txt
```

Excluir los datos de `session` evita trasladar sesiones activas. Después,
descargar `private-backups/vax-pricing.dump` desde el panel de archivos de
Replit y borrarlo del Repl cuando la copia local esté verificada.

Si la base está recibiendo escrituras, hacer el respaldo durante una ventana de
mantenimiento. `pg_dump` obtiene una instantánea consistente, pero una
cotización creada después de iniciar el respaldo no quedará incluida.

### Crear PostgreSQL local

Instalar PostgreSQL 16 y sus herramientas cliente. Crear una base vacía y un
usuario local desde una cuenta administradora:

```bash
createuser --pwprompt vax_local
createdb --owner=vax_local vax_pricing_local
export DATABASE_URL='URL_LOCAL'
```

No uses en local la contraseña ni la URL de la base de producción.

### Restaurar el respaldo

Definir una URL local mediante el gestor de secretos o la terminal y ejecutar:

```bash
export TARGET_DATABASE_URL='postgresql://LOCAL_USER:LOCAL_PASSWORD@LOCAL_HOST:LOCAL_PORT/vax_pricing_local'

pg_restore \
  --dbname="$TARGET_DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  --verbose \
  ./vax-pricing.dump
```

El texto anterior es un marcador de formato, no una credencial real. No
guardarlo con una contraseña válida dentro del repositorio.

Si falla una restauración, eliminar y volver a crear únicamente la base local
de prueba antes de reintentar. No usar `--clean` contra una base valiosa.

### Validar la restauración

```bash
psql "$TARGET_DATABASE_URL" -c 'SELECT version();'
psql "$TARGET_DATABASE_URL" -c \
  "SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2;"
psql "$TARGET_DATABASE_URL" -c \
  "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM pricing_requests; SELECT COUNT(*) FROM carrier_offers; SELECT COUNT(*) FROM google_maps_route_cache;"
```

Comparar los conteos importantes contra la base de origen antes de permitir
escrituras en la copia local.

### Crear una base vacía sin datos

Para una instalación completamente nueva:

```bash
export DATABASE_URL='URL_LOCAL'
npm run db:push
npm run dev
```

Revisar cualquier propuesta destructiva de Drizzle antes de aceptarla. El
arranque ejecuta también `server/migrate.ts` y luego `server/seed.ts`. No se debe
ejecutar el seed sobre una restauración de producción de manera deliberada; el
seed solo está pensado para una base vacía.

### Otros datos persistentes

PostgreSQL es la fuente principal, pero se deben copiar los modelos y datos
versionados:

- `server/ml/artifacts/`
- `server/ml/orchestrator/`
- datos RAG y modelos dentro del orquestador

Los SQLite dentro de `server/ml/orchestrator/rag/runtime/` son fallbacks o
persistencia heredada. Con `DATABASE_URL`, el sistema actual prefiere
PostgreSQL. Copiarlos solo si se necesita conservar historial forense antiguo,
no como sustituto de la base principal.

---

## 5. Instalación y ejecución local

### Sistema recomendado

La ruta más sencilla es:

- macOS;
- Linux; o
- Windows con WSL 2.

Los scripts npm actuales usan sintaxis Unix para `NODE_ENV`, y el backend busca
el ejecutable `python3`. En Windows nativo habría que adaptar esos dos puntos.

### Herramientas necesarias

Instalar:

1. Git.
2. Node.js 20.
3. Python 3.11 o posterior.
4. PostgreSQL 16 y `pg_dump`/`pg_restore`.
5. Compilador nativo si bcrypt, ONNX Runtime u otra dependencia lo requiere.

En Debian/Ubuntu/WSL puede ser necesario:

```bash
sudo apt update
sudo apt install build-essential python3-dev libpq-dev postgresql-client
```

### Descargar el código

Opción recomendada: conectar el Repl a un repositorio privado de GitHub y luego:

```bash
git clone URL_DEL_REPOSITORIO
cd DIRECTORIO_DEL_PROYECTO
```

También se puede descargar el proyecto como ZIP desde Replit y descomprimirlo.
No incluir el respaldo de base, archivos `.env`, `node_modules`, cachés ni
credenciales en un repositorio público.

Documentación de Replit:

- https://docs.replit.com/help/projects-and-files
- https://docs.replit.com/features/workspace-tools/git-interface

### Instalar Node manteniendo las versiones resueltas

El `package-lock.json` contiene algunas URLs internas de
`package-firewall.replit.local`. Fuera de Replit pueden no responder. Para
preservar las versiones exactas, reemplazar únicamente ese host por el registro
público en la copia local antes de usar `npm ci`. Primero conservar una copia
del lockfile original:

```bash
npm config set registry https://registry.npmjs.org/
cp package-lock.json package-lock.replit-backup.json

node -e "const fs=require('fs');const p='package-lock.json';let s=fs.readFileSync(p,'utf8');s=s.replaceAll('http://package-firewall.replit.local/npm/','https://registry.npmjs.org/');fs.writeFileSync(p,s)"

npm ci
```

Comparar y conservar el lockfile adaptado si la instalación termina
correctamente. No subir `package-lock.replit-backup.json` al repositorio.

Si una dependencia ya no existe en el registro público, detenerse y revisar esa
dependencia. No borrar ni regenerar el lockfile original sin una decisión
explícita, porque hacerlo puede cambiar cientos de versiones transitivas.

### Instalar Python

En macOS, Linux o WSL:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r server/ml/orchestrator/requirements.txt
python -m pip install "psycopg[binary]>=3.3.4"
```

El proyecto raíz no está empaquetado como una biblioteca Python instalable; por
eso no se debe depender de `pip install -e .`. El archivo del orquestador aporta
sus dependencias y `psycopg` completa la persistencia PostgreSQL que falta en
ese archivo.

Alternativa usando `uv` sobre el mismo entorno explícito:

```bash
python -m pip install uv
uv pip install --python .venv/bin/python \
  -r server/ml/orchestrator/requirements.txt \
  "psycopg[binary]>=3.3.4"
```

Confirmar que el proceso Node encontrará el mismo entorno. Al activar el venv,
su `python3` debe quedar primero en `PATH`, porque el backend invoca literalmente
ese ejecutable:

```bash
which python3
python3 --version
python3 -c "import sys; assert sys.prefix != sys.base_prefix; print(sys.executable)"
```

Si `python3` no apunta dentro de `.venv`, no iniciar todavía la app: volver a
activar el entorno o adaptar `server/ml/orchestratorClient.ts` para aceptar una
variable de ejecutable Python.

### Configurar el entorno

Crear `.env.local` únicamente en la computadora local con las variables
necesarias. Para el arranque mínimo se requieren PostgreSQL y la sesión. Maps e
integraciones son opcionales según las funciones que se quieran probar. El
copiloto está desactivado de forma predeterminada; si se activa
`COPILOT_ENABLED`, también se necesita configurar OpenAI.

Cargar el archivo:

```bash
set -a
source .env.local
set +a
```

### Validaciones antes de iniciar

```bash
npm run check
python -m compileall -q server/ml/orchestrator
(cd server/ml/orchestrator && python -m unittest discover -s tests/copilot)
```

El repositorio puede contener errores TypeScript heredados en componentes de
ejemplo. Deben distinguirse de errores nuevos en los archivos productivos.

### Ejecutar en desarrollo

Con el entorno Python activado y las variables exportadas:

```bash
npm run dev
```

Abrir:

```text
http://localhost:5000
```

Express inicia automáticamente el servicio Python en loopback. Validarlo:

```bash
curl -fsS http://127.0.0.1:8100/health
```

No se necesita iniciar `serve.py` por separado durante el flujo normal. Para
diagnóstico aislado:

```bash
cd server/ml/orchestrator
python3 serve.py
```

### Compilar y ejecutar en modo producción

```bash
npm run build
npm run start
```

La compilación produce:

- frontend en `dist/public`;
- backend empaquetado en `dist/index.cjs`.

En producción, `SESSION_SECRET` debe estar definida y el sitio debe servirse con
HTTPS si conserva cookies `secure`/`SameSite=None`.

### Windows nativo sin WSL

Los scripts `dev` y `start` usan asignación Unix de `NODE_ENV`. En PowerShell se
puede iniciar temporalmente así:

```powershell
$env:NODE_ENV="development"
npx tsx server/index.ts
```

Para producción:

```powershell
$env:NODE_ENV="production"
node dist/index.cjs
```

También habría que cambiar el ejecutable `python3` usado por
`server/ml/orchestratorClient.ts`, o instalar un alias compatible. Por eso WSL 2
es la opción recomendada en Windows.

---

## 6. Configuración específica de Replit que se debe reemplazar

### `.replit`

El archivo actual configura exclusivamente:

- módulos Node 20, Python 3.11 y PostgreSQL 16;
- paquetes Nix;
- comando de Run;
- workflow de desarrollo;
- puerto interno y proxy público;
- compilación y arranque del deployment autoscale;
- conectores Firebase, base de datos, Sheets, Resend y Slack;
- variables compartidas;
- script posterior a merges.

Fuera de Replit no se interpreta. Se puede conservar como referencia o
eliminarlo después de confirmar la migración.

Reemplazos locales:

| Replit | Sustitución local |
|---|---|
| Módulos de `.replit` | Node/Python/PostgreSQL instalados en el sistema |
| Nix packages | Gestor de paquetes del sistema |
| Workflow `npm run dev` | Terminal, IDE o administrador de procesos |
| Proxy de puerto 5000 a 80 | `http://localhost:5000` |
| Deployment autoscale | Servidor propio o proveedor elegido |
| Replit Database | PostgreSQL local/administrado propio |
| Replit Secrets | `.env.local` no versionado o gestor de secretos |
| Conectores | OAuth/API keys propios y cambios de código |
| Post-merge hook | CI local/GitHub Actions |

### `replit.nix`

No existe un archivo `replit.nix` en este proyecto. La configuración Nix está
embebida dentro de `.replit`.

### `vite.config.ts`

Incluye plugins específicos de Replit:

- `@replit/vite-plugin-runtime-error-modal`
- `@replit/vite-plugin-cartographer`
- `@replit/vite-plugin-dev-banner`

Cartographer y el banner están condicionados por `REPL_ID`; fuera de Replit no
deberían activarse. Para eliminar totalmente la dependencia, quitar esos
imports/plugins y después retirar sus paquetes de `package.json`.

### Conectores administrados

#### Slack

`server/slackService.ts` usa el proxy del SDK de Replit. Para migrarlo:

1. crear una Slack App propia;
2. conceder los permisos mínimos necesarios;
3. instalarla en el workspace;
4. almacenar su token en un gestor de secretos;
5. sustituir `connectors.proxy("slack", ...)` por llamadas oficiales a Slack;
6. invitar el bot al canal;
7. conservar `users.lookupByEmail` para las menciones nativas.

#### Google Sheets

`server/googleSheets.ts` usa el proxy del SDK. Sustituirlo por `googleapis` con
OAuth o una cuenta de servicio y compartir la hoja con esa identidad.

#### Resend

`server/emailService.ts` consulta un endpoint interno de Replit para obtener la
conexión. Sustituirlo por el SDK `resend` usando una API key propia y un dominio
verificado.

### URL pública y proxy

El código usa `REPLIT_DOMAINS` como fallback para enlaces de Slack. Fuera de
Replit se debe definir `APP_BASE_URL`.

Express confía en un proxy y usa cookies seguras en producción. Si se despliega
con Nginx, Caddy, Cloudflare u otro proxy:

1. terminar HTTPS en el proxy;
2. reenviar las cabeceras `X-Forwarded-*`;
3. mantener consistente la configuración `trust proxy`;
4. verificar login y persistencia de sesión desde el dominio final.

### Archivos de colaboración de Replit

- `replit.md` es documentación para agentes, no un requisito de ejecución.
- `.agents/`, `.local/`, `.cache/`, `.upm/` y `.pythonlibs/` son estado de
  herramientas/entorno y no deben formar parte del paquete local limpio.

---

## 7. Checklist de salida

### Código

- [ ] Exportar por Git privado o ZIP.
- [ ] No incluir secretos, dumps, cachés ni dependencias generadas.
- [ ] Corregir URLs internas del `package-lock.json`.
- [ ] Instalar Node 20 y Python 3.11+.
- [ ] Copiar todos los modelos y activos de `server/ml`.

### Datos

- [ ] Congelar o reducir escrituras durante el respaldo.
- [ ] Crear `pg_dump` custom sin sesiones activas.
- [ ] Descargar el dump por un canal seguro.
- [ ] Restaurar en PostgreSQL 16 local.
- [ ] Comparar tablas y conteos.
- [ ] Eliminar copias temporales del dump.

### Configuración

- [ ] Crear variables locales sin copiar tokens internos de Replit.
- [ ] Crear un `SESSION_SECRET` nuevo.
- [ ] Usar credenciales locales, nunca las de producción.
- [ ] Configurar `APP_BASE_URL` en el entorno final.
- [ ] Revisar scripts de usuarios antes de publicar el repositorio.

### Funciones

- [ ] Login y sesiones.
- [ ] Consulta de cotizaciones.
- [ ] Creación/edición en una base local de prueba.
- [ ] Google Maps y caché de rutas.
- [ ] Salud del orquestador Python.
- [ ] Predictor ONNX.
- [ ] Copiloto, solo si se configuró OpenAI.
- [ ] Reemplazo local de Google Sheets.
- [ ] Reemplazo local de Slack y menciones.
- [ ] Reemplazo local de Resend.

### Producción fuera de Replit

- [ ] `npm run build`.
- [ ] HTTPS.
- [ ] PostgreSQL administrado con backups.
- [ ] Gestor de secretos.
- [ ] Supervisor de procesos para Node.
- [ ] Monitoreo de Node y del servicio Python.
- [ ] CI para TypeScript y pruebas Python.

---

## Resumen de comandos

```bash
# 1. Descargar
git clone URL_DEL_REPOSITORIO
cd DIRECTORIO_DEL_PROYECTO

# 2. Node
npm config set registry https://registry.npmjs.org/
node -e "const fs=require('fs');const p='package-lock.json';let s=fs.readFileSync(p,'utf8');s=s.replaceAll('http://package-firewall.replit.local/npm/','https://registry.npmjs.org/');fs.writeFileSync(p,s)"
npm ci

# 3. Python
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r server/ml/orchestrator/requirements.txt
python -m pip install "psycopg[binary]>=3.3.4"

# 4. Cargar variables locales
set -a
source .env.local
set +a

# 5. Validar
npm run check
python -m compileall -q server/ml/orchestrator
(cd server/ml/orchestrator && python -m unittest discover -s tests/copilot)

# 6. Desarrollo
npm run dev

# 7. Producción
npm run build
npm run start
```

La aplicación local queda disponible en `http://localhost:5000`; el servicio
Python interno utiliza `127.0.0.1:8100` salvo que se configure otro puerto.