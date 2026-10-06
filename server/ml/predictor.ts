import * as ort from "onnxruntime-node";
import fs from "fs";
import path from "path";
import {
  fetchAllRoutes,
  fetchRoute,
  upsertRoute,
  normalizeKey as normalizeKeyShared,
  type CachedRouteEntry as SharedCachedRouteEntry,
} from "./routeCacheDb";

function resolveArtifactsDir(): string {
  const candidates = [
    typeof import.meta.dirname === "string"
      ? path.resolve(import.meta.dirname, "artifacts")
      : null,
    path.resolve(process.cwd(), "server/ml/artifacts"),
  ].filter((p): p is string => p !== null);
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, "model_manifest.json"))) return p;
  }
  return candidates[candidates.length - 1];
}

const ARTIFACTS_DIR = resolveArtifactsDir();

interface PreprocessingState {
  features: string[];
  missing_token: string;
  state: {
    numeric_medians: Record<string, number>;
    freq_maps: Record<string, Record<string, number>>;
    te_maps: Record<string, Record<string, number>>;
    te_prior: number;
    use_te: boolean;
  };
}

interface ModelManifest {
  model_version: string;
  trained_through: string;
  input_name: string;
  models: { seed: number; file: string }[];
  uncertainty: {
    residual_q95_mxn: number;
  };
}

const ROUTE_TYPE_MAP: Record<string, string> = {
  national: "national",
  crossborder: "crossborder",
  domestic: "domestic",
  "port freight": "port_freight",
};

let preprocessing: PreprocessingState | null = null;
let manifest: ModelManifest | null = null;
let sessions: ort.InferenceSession[] | null = null;
export type CachedRouteEntry = SharedCachedRouteEntry;

let routeCache: Map<string, CachedRouteEntry> | null = null;
let routeCacheFromDb = false;

export const normalizeKey = normalizeKeyShared;

function parseCsvLine(line: string): string[] {
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

function loadRouteCacheFromCsv(): Map<string, CachedRouteEntry> {
  const cache = new Map<string, CachedRouteEntry>();
  const csvPath = path.join(ARTIFACTS_DIR, "google_maps_route_cache.csv");
  const content = fs.readFileSync(csvPath, "utf-8").replace(/^\uFEFF/, "");
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  const header = parseCsvLine(lines[0]);
  const idxKey = header.indexOf("route_key");
  const idxDist = header.indexOf("google_distance_m");
  const idxStatus = header.indexOf("api_status");
  const idxOLat = header.indexOf("google_origin_lat");
  const idxOLng = header.indexOf("google_origin_lng");
  const idxDLat = header.indexOf("google_destination_lat");
  const idxDLng = header.indexOf("google_destination_lng");
  const idxOElev = header.indexOf("google_origin_elevation_m");
  const idxDElev = header.indexOf("google_destination_elevation_m");
  const num = (row: string[], idx: number): number | undefined => {
    if (idx < 0) return undefined;
    const v = parseFloat(row[idx]);
    return isFinite(v) ? v : undefined;
  };
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (row[idxStatus] !== "OK") continue;
    const distM = parseFloat(row[idxDist]);
    if (!isFinite(distM) || distM < 0) continue;
    cache.set(row[idxKey], {
      distanceKm: distM / 1000,
      origin_lat: num(row, idxOLat),
      origin_lng: num(row, idxOLng),
      destination_lat: num(row, idxDLat),
      destination_lng: num(row, idxDLng),
      origin_elevation_m: num(row, idxOElev),
      destination_elevation_m: num(row, idxDElev),
    });
  }
  return cache;
}

/**
 * Fuente compartida (Postgres) con respaldo de solo lectura al CSV empaquetado.
 * La base sobrevive reinicios y es común a todas las réplicas.
 */
async function loadRouteCache(): Promise<Map<string, CachedRouteEntry>> {
  if (routeCache && routeCacheFromDb) return routeCache;
  try {
    routeCache = await fetchAllRoutes();
    routeCacheFromDb = true;
    return routeCache;
  } catch (err) {
    console.error("No se pudo cargar el caché de rutas desde Postgres; usando CSV de respaldo:", err);
    if (!routeCache) routeCache = loadRouteCacheFromCsv();
    return routeCache;
  }
}

async function loadModels(): Promise<void> {
  if (sessions && preprocessing && manifest) return;
  preprocessing = JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, "preprocessing_state.json"), "utf-8"));
  manifest = JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, "model_manifest.json"), "utf-8"));
  sessions = [];
  for (const m of manifest!.models) {
    const session = await ort.InferenceSession.create(path.join(ARTIFACTS_DIR, m.file));
    sessions.push(session);
  }
  await loadRouteCache();
  console.log(`Modelo de predicción cargado: ${manifest!.model_version} (${sessions.length} semillas)`);
}

export interface QuoteInput {
  cliente?: string | null;
  proveedor?: string | null;
  origen: string;
  destino: string;
  tipoEquipo?: string | null;
  division?: string | null;
  rango?: string | null;
  fechaCreacion?: Date;
  distanceKm?: number;
}

export interface PredictionResult {
  costMxnPrediction: number;
  seedStdMxn: number;
  riskRangeLowMxn: number;
  riskRangeHighMxn: number;
  seedPredictionsMxn: number[];
  modelVersion: string;
  trainedThrough: string;
  distanceKm: number | null;
  distanceSource: "cache" | "provided" | "median";
  unknownCategories: string[];
}

export async function lookupCachedDistance(origen: string, destino: string): Promise<number | null> {
  const entry = await lookupCachedRoute(origen, destino);
  return entry !== null ? entry.distanceKm : null;
}

export async function lookupCachedRoute(origen: string, destino: string): Promise<CachedRouteEntry | null> {
  const cache = await loadRouteCache();
  const key = `${normalizeKey(origen)} -> ${normalizeKey(destino)}`;
  const local = cache.get(key);
  if (local !== undefined) return local;
  // Otra réplica pudo haber escrito la ruta después de nuestra carga inicial.
  if (routeCacheFromDb) {
    try {
      const fromDb = await fetchRoute(key);
      if (fromDb !== null) {
        cache.set(key, fromDb);
        return fromDb;
      }
    } catch (err) {
      console.error("Fallo la consulta puntual del caché de rutas en Postgres:", err);
    }
  }
  return null;
}

export async function appendRouteCacheEntry(
  origen: string,
  destino: string,
  entry: CachedRouteEntry,
): Promise<void> {
  const cache = await loadRouteCache();
  const key = `${normalizeKey(origen)} -> ${normalizeKey(destino)}`;
  cache.set(key, entry);
  try {
    await upsertRoute(key, origen, destino, entry);
    console.log(`Ruta agregada al caché compartido: ${key}`);
  } catch (err) {
    console.error(`No se pudo escribir la ruta en el caché compartido (${key}):`, err);
  }
}

export async function predictTarifa(input: QuoteInput): Promise<PredictionResult> {
  await loadModels();
  const pp = preprocessing!;
  const mf = manifest!;
  const st = pp.state;

  const clienteKey = normalizeKey(input.cliente);
  const proveedorKey = normalizeKey(input.proveedor);
  const origenKey = normalizeKey(input.origen);
  const destinoKey = normalizeKey(input.destino);
  const routeKey = `${origenKey} -> ${destinoKey}`;
  const equipoKey = normalizeKey(input.tipoEquipo);
  const divisionKey = normalizeKey(input.division);
  const rangoKey = normalizeKey(input.rango);
  const routeType = ROUTE_TYPE_MAP[divisionKey] ?? "pendiente_validacion";

  const fecha = input.fechaCreacion ?? new Date();
  const mes = fecha.getMonth() + 1;
  const trimestre = Math.floor((mes - 1) / 3) + 1;
  const diaSemana = (fecha.getDay() + 6) % 7;

  let distanceKm: number | null = null;
  let distanceSource: PredictionResult["distanceSource"] = "median";
  if (input.distanceKm !== undefined && isFinite(input.distanceKm) && input.distanceKm >= 0) {
    distanceKm = input.distanceKm;
    distanceSource = "provided";
  } else {
    const cached = (await loadRouteCache()).get(routeKey);
    if (cached !== undefined) {
      distanceKm = cached.distanceKm;
      distanceSource = "cache";
    }
  }
  const distanceForModel = distanceKm ?? st.numeric_medians["google_distance_km"];

  const unknownCategories: string[] = [];
  const freq = (col: string, key: string): number => {
    const map = st.freq_maps[col] || {};
    if (key in map) return map[key];
    unknownCategories.push(`${col}=${key}`);
    return 0;
  };
  const te = (col: string, key: string): number => {
    const map = st.te_maps[col] || {};
    return key in map ? map[key] : st.te_prior;
  };

  const featureValues: Record<string, number> = {
    mes_creacion: mes,
    trimestre_creacion: trimestre,
    dia_semana_creacion: diaSemana,
    google_distance_km: distanceForModel,
    "CLIENTE_key__freq": freq("CLIENTE_key", clienteKey),
    "PROVEEDOR_key__freq": freq("PROVEEDOR_key", proveedorKey),
    "ORIGEN_key__freq": freq("ORIGEN_key", origenKey),
    "DESTINO_key__freq": freq("DESTINO_key", destinoKey),
    "route_key__freq": freq("route_key", routeKey),
    "Tipo de Equipo_key__freq": freq("Tipo de Equipo_key", equipoKey),
    "DIVISION_key__freq": freq("DIVISION_key", divisionKey),
    "RANGO_key__freq": freq("RANGO_key", rangoKey),
    "route_type__freq": freq("route_type", routeType),
    distance_log1p: Math.log1p(Math.max(distanceForModel, 0)),
    "ORIGEN_key__te": te("ORIGEN_key", origenKey),
    "DESTINO_key__te": te("DESTINO_key", destinoKey),
  };

  const tensorData = new Float32Array(pp.features.length);
  pp.features.forEach((f, i) => {
    tensorData[i] = featureValues[f];
  });
  const tensor = new ort.Tensor("float32", tensorData, [1, pp.features.length]);

  const seedPredictionsMxn: number[] = [];
  for (const session of sessions!) {
    const output = await session.run({ [mf.input_name]: tensor });
    const outName = session.outputNames[0];
    const raw = output[outName].data as Float32Array;
    const mxn = Math.max(Math.expm1(raw[0]), 0);
    seedPredictionsMxn.push(mxn);
  }

  const mean = seedPredictionsMxn.reduce((a, b) => a + b, 0) / seedPredictionsMxn.length;
  const variance = seedPredictionsMxn.reduce((a, b) => a + (b - mean) ** 2, 0) / seedPredictionsMxn.length;
  const std = Math.sqrt(variance);
  const halfWidth = mf.uncertainty.residual_q95_mxn + 1.645 * std;

  return {
    costMxnPrediction: mean,
    seedStdMxn: std,
    riskRangeLowMxn: Math.max(mean - halfWidth, 0),
    riskRangeHighMxn: mean + halfWidth,
    seedPredictionsMxn,
    modelVersion: mf.model_version,
    trainedThrough: mf.trained_through,
    distanceKm,
    distanceSource,
    unknownCategories,
  };
}
