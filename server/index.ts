import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import { registerRoutes } from "./routes";
import { startOrchestrator } from "./ml/orchestratorClient";
import { serveStatic } from "./static";
import { createServer } from "http";
import { runMigrations } from "./migrate";
import { seedDatabase } from "./seed";
import { syncClientesFromSheet } from "./googleSheets";
import { migrateRoutesPerLane } from "./migrateRoutesPerLane";
import { createRequestLogger, safeErrorHandler } from "./reliability";

const app = express();
const httpServer = createServer(app);

const PgSession = connectPgSimple(session);

// Trust proxy for Replit's reverse proxy (required for secure cookies in production)
app.set("trust proxy", 1);

declare module "express-session" {
  interface SessionData {
    userId?: string;
    userRole?: string;
  }
}

const sessionSecret = (() => {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET environment variable is required in production. Refusing to start with an insecure default session secret.",
    );
  }
  console.warn(
    "[security] SESSION_SECRET is not set; using an insecure development-only default. Set SESSION_SECRET before deploying to production.",
  );
  return "vax-pricing-hub-dev-secret";
})();

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new PgSession({
      pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    },
  })
);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use(createRequestLogger(log));

(async () => {
  await runMigrations();
  await seedDatabase();
  await migrateRoutesPerLane();
  await registerRoutes(httpServer, app);

  app.use(safeErrorHandler);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      startClienteSyncScheduler();
      startOrchestrator().catch((err) =>
        console.error("[orchestrator] error al iniciar:", err),
      );
    },
  );
})();

function startClienteSyncScheduler() {
  function msUntilNext8AMMexico(): number {
    const now = new Date();
    const mexicoTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
    const diffMs = now.getTime() - mexicoTime.getTime();

    const next8AMMexico = new Date(mexicoTime);
    next8AMMexico.setHours(8, 0, 0, 0);
    if (mexicoTime >= next8AMMexico) {
      next8AMMexico.setDate(next8AMMexico.getDate() + 1);
    }
    const next8AMUTC = new Date(next8AMMexico.getTime() + diffMs);
    return next8AMUTC.getTime() - now.getTime();
  }

  function scheduleNext() {
    const ms = msUntilNext8AMMexico();
    const hours = Math.round(ms / 3600000 * 10) / 10;
    log(`Próxima sincronización de clientes en ${hours} horas (8:00 AM hora CDMX)`);
    setTimeout(async () => {
      try {
        log("Iniciando sincronización automática de clientes con Google Sheets...");
        const result = await syncClientesFromSheet();
        log(`Sincronización completada: ${result.added} nuevos, ${result.total} total`);
      } catch (err) {
        log(`Error en sincronización automática: ${err instanceof Error ? err.message : 'Error desconocido'}`);
      }
      scheduleNext();
    }, ms);
  }

  scheduleNext();
}
