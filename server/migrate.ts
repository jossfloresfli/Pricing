import { pool } from "./db";
import { seedRouteCacheFromCsv } from "./ml/routeCacheDb";

const migrations = `
CREATE TABLE IF NOT EXISTS "pricing_requests" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cliente" text NOT NULL,
  "prospecto" text,
  "division" text,
  "tipo_equipo" text NOT NULL,
  "accesorios" text[],
  "rutas" text NOT NULL,
  "status" text DEFAULT 'por_revisar' NOT NULL,
  "sales_rep" text NOT NULL,
  "notas_carga_comercial" text,
  "feedback" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "carrier_offers" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" varchar NOT NULL,
  "carrier" text NOT NULL,
  "carrier_rep" text,
  "costo" numeric(12, 2) NOT NULL,
  "venta_sugerida" numeric(12, 2),
  "margen" numeric(5, 2),
  "selected" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "copilot_quotes" (
  "store_key" text PRIMARY KEY NOT NULL,
  "quote_request" jsonb NOT NULL,
  "pricing_result" jsonb NOT NULL,
  "modelos_disponibles" jsonb NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ix_copilot_quotes_expires_at" ON "copilot_quotes" ("expires_at");

CREATE TABLE IF NOT EXISTS "copilot_explanations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" text NOT NULL,
  "ruta_id" text NOT NULL,
  "model_key" text NOT NULL,
  "model_label" text NOT NULL,
  "pricing_hash" text NOT NULL,
  "origen" text DEFAULT '' NOT NULL,
  "destino" text DEFAULT '' NOT NULL,
  "costo_explicado" numeric,
  "moneda" text DEFAULT 'MXN' NOT NULL,
  "respuesta" jsonb,
  "error_mensaje" text,
  "status" text DEFAULT 'generating' NOT NULL,
  "solicitante_id" text NOT NULL,
  "solicitante_nombre" text DEFAULT '' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "ux_copilot_explanations_identity" ON "copilot_explanations" ("quote_id","ruta_id","model_key","pricing_hash");
CREATE INDEX IF NOT EXISTS "ix_copilot_explanations_created_at" ON "copilot_explanations" ("created_at");
CREATE INDEX IF NOT EXISTS "ix_copilot_explanations_quote" ON "copilot_explanations" ("quote_id");

CREATE TABLE IF NOT EXISTS "copilot_comments" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "author_id" text NOT NULL,
  "author_name" text DEFAULT '' NOT NULL,
  "author_role" text DEFAULT '' NOT NULL,
  "comment" text NOT NULL,
  "quote_id" text,
  "ruta_id" text,
  "model_key" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ix_copilot_comments_created_at" ON "copilot_comments" ("created_at");

CREATE TABLE IF NOT EXISTS "notification_dispatches" (
  "event_key" text PRIMARY KEY NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "google_maps_route_cache" (
  "route_key" text PRIMARY KEY NOT NULL,
  "route_label" text DEFAULT '' NOT NULL,
  "origin_address" text DEFAULT '' NOT NULL,
  "destination_address" text DEFAULT '' NOT NULL,
  "google_distance_m" double precision NOT NULL,
  "google_origin_lat" double precision,
  "google_origin_lng" double precision,
  "google_destination_lat" double precision,
  "google_destination_lng" double precision,
  "google_origin_elevation_m" double precision,
  "google_destination_elevation_m" double precision,
  "api_status" text DEFAULT 'OK' NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
`;

export async function runMigrations() {
  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error("Migration timeout")), 5000);
  });
  
  const migrationPromise = (async () => {
    try {
      const client = await pool.connect();
      await client.query(migrations);
      client.release();
      console.log("Database migrations completed successfully");
    } catch (error) {
      console.error("Migration error:", error);
    }
  })();
  
  try {
    await Promise.race([migrationPromise, timeoutPromise]);
  } catch (error) {
    console.log("Migration skipped (timeout or error), continuing server startup...");
  }

  try {
    await seedRouteCacheFromCsv();
  } catch (error) {
    console.error("No se pudo sembrar el caché de rutas en Postgres:", error);
  }
}
