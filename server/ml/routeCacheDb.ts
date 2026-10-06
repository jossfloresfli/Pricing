import fs from "fs";
import path from "path";
import { pool } from "../db";

export interface CachedRouteEntry {
  distanceKm: number;
  origin_lat?: number;
  origin_lng?: number;
  destination_lat?: number;
  destination_lng?: number;
  origin_elevation_m?: number;
  destination_elevation_m?: number;
}

export function normalizeKey(value: string | null | undefined): string {
  if (value === null || value === undefined) return "__MISSING__";
  let s = String(value)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[^a-z0-9 ,./#-]/g, "");
  s = s.trim().replace(/\s+/g, " ");
  return s.length === 0 ? "__MISSING__" : s;
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { fields.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function toNum(value: string | undefined): number | null {
  if (value === undefined) return null;
  const v = parseFloat(value);
  return isFinite(v) ? v : null;
}

/**
 * Siembra la tabla compartida desde el CSV empaquetado (solo si la tabla está vacía).
 * El CSV queda como artefacto de solo lectura; la base es la fuente de verdad.
 */
export async function seedRouteCacheFromCsv(): Promise<void> {
  // Idempotente: garantiza la tabla aunque la migración general siga en curso.
  await pool.query(`
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
    )
  `);
  const countRes = await pool.query(`SELECT COUNT(*)::int AS n FROM google_maps_route_cache`);
  if (countRes.rows[0].n > 0) return;

  const candidates = [
    path.resolve(process.cwd(), "server/ml/artifacts/google_maps_route_cache.csv"),
    path.resolve(process.cwd(), "server/ml/orchestrator/data/google_maps_route_cache.csv"),
  ];
  const csvPath = candidates.find((p) => fs.existsSync(p));
  if (!csvPath) {
    console.warn("Siembra del caché de rutas omitida: no se encontró el CSV empaquetado");
    return;
  }

  const content = fs.readFileSync(csvPath, "utf-8").replace(/^\uFEFF/, "");
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = parseCsvLine(lines[0]);
  const idx = (name: string) => header.indexOf(name);
  const iKey = idx("route_key");
  const iLabel = idx("route_label");
  const iOrig = idx("origin_address");
  const iDest = idx("destination_address");
  const iDist = idx("google_distance_m");
  const iOLat = idx("google_origin_lat");
  const iOLng = idx("google_origin_lng");
  const iDLat = idx("google_destination_lat");
  const iDLng = idx("google_destination_lng");
  const iOElev = idx("google_origin_elevation_m");
  const iDElev = idx("google_destination_elevation_m");
  const iStatus = idx("api_status");
  const iUpdated = idx("updated_at");

  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i]);
      const status = (row[iStatus] || "").toUpperCase();
      if (status !== "OK") continue;
      const distM = toNum(row[iDist]);
      if (distM === null || distM < 0) continue;
      const key = row[iKey];
      if (!key) continue;
      await client.query(
        `INSERT INTO google_maps_route_cache
           (route_key, route_label, origin_address, destination_address, google_distance_m,
            google_origin_lat, google_origin_lng, google_destination_lat, google_destination_lng,
            google_origin_elevation_m, google_destination_elevation_m, api_status, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'OK', COALESCE($12::timestamptz, now()))
         ON CONFLICT (route_key) DO NOTHING`,
        [
          key,
          row[iLabel] ?? "",
          row[iOrig] ?? "",
          row[iDest] ?? "",
          distM,
          toNum(row[iOLat]), toNum(row[iOLng]),
          toNum(row[iDLat]), toNum(row[iDLng]),
          toNum(row[iOElev]), toNum(row[iDElev]),
          row[iUpdated] || null,
        ],
      );
      inserted++;
    }
    await client.query("COMMIT");
    console.log(`Caché de rutas sembrado en Postgres desde CSV: ${inserted} filas (${csvPath})`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function rowToEntry(row: any): CachedRouteEntry {
  const opt = (v: any): number | undefined => {
    const n = v === null || v === undefined ? NaN : Number(v);
    return isFinite(n) ? n : undefined;
  };
  return {
    distanceKm: Number(row.google_distance_m) / 1000,
    origin_lat: opt(row.google_origin_lat),
    origin_lng: opt(row.google_origin_lng),
    destination_lat: opt(row.google_destination_lat),
    destination_lng: opt(row.google_destination_lng),
    origin_elevation_m: opt(row.google_origin_elevation_m),
    destination_elevation_m: opt(row.google_destination_elevation_m),
  };
}

export async function fetchAllRoutes(): Promise<Map<string, CachedRouteEntry>> {
  const res = await pool.query(
    `SELECT * FROM google_maps_route_cache WHERE api_status = 'OK' AND google_distance_m >= 0`,
  );
  const map = new Map<string, CachedRouteEntry>();
  for (const row of res.rows) map.set(row.route_key, rowToEntry(row));
  return map;
}

export async function fetchRoute(routeKey: string): Promise<CachedRouteEntry | null> {
  const res = await pool.query(
    `SELECT * FROM google_maps_route_cache
     WHERE route_key = $1 AND api_status = 'OK' AND google_distance_m >= 0`,
    [routeKey],
  );
  if (res.rows.length === 0) return null;
  return rowToEntry(res.rows[0]);
}

export async function upsertRoute(
  routeKey: string,
  origen: string,
  destino: string,
  entry: CachedRouteEntry,
): Promise<void> {
  const opt = (v: number | undefined): number | null =>
    v !== undefined && isFinite(v) ? v : null;
  await pool.query(
    `INSERT INTO google_maps_route_cache
       (route_key, route_label, origin_address, destination_address, google_distance_m,
        google_origin_lat, google_origin_lng, google_destination_lat, google_destination_lng,
        google_origin_elevation_m, google_destination_elevation_m, api_status, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'OK', now())
     ON CONFLICT (route_key) DO UPDATE SET
       google_distance_m = EXCLUDED.google_distance_m,
       google_origin_lat = COALESCE(EXCLUDED.google_origin_lat, google_maps_route_cache.google_origin_lat),
       google_origin_lng = COALESCE(EXCLUDED.google_origin_lng, google_maps_route_cache.google_origin_lng),
       google_destination_lat = COALESCE(EXCLUDED.google_destination_lat, google_maps_route_cache.google_destination_lat),
       google_destination_lng = COALESCE(EXCLUDED.google_destination_lng, google_maps_route_cache.google_destination_lng),
       google_origin_elevation_m = COALESCE(EXCLUDED.google_origin_elevation_m, google_maps_route_cache.google_origin_elevation_m),
       google_destination_elevation_m = COALESCE(EXCLUDED.google_destination_elevation_m, google_maps_route_cache.google_destination_elevation_m),
       api_status = 'OK',
       updated_at = now()`,
    [
      routeKey,
      `${origen.trim()} -> ${destino.trim()}`,
      origen.trim(),
      destino.trim(),
      Math.round(entry.distanceKm * 1000),
      opt(entry.origin_lat), opt(entry.origin_lng),
      opt(entry.destination_lat), opt(entry.destination_lng),
      opt(entry.origin_elevation_m), opt(entry.destination_elevation_m),
    ],
  );
}
