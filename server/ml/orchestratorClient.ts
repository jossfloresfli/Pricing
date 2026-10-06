import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";

function resolveOrchestratorDir(): string {
  const candidates = [
    typeof import.meta.dirname === "string"
      ? path.resolve(import.meta.dirname, "orchestrator")
      : null,
    path.resolve(process.cwd(), "server/ml/orchestrator"),
  ].filter((p): p is string => p !== null);
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, "serve.py"))) return p;
  }
  return candidates[candidates.length - 1];
}

const ORCHESTRATOR_DIR = resolveOrchestratorDir();
const PORT = parseInt(process.env.ORCHESTRATOR_PORT || "8100", 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const STARTUP_TIMEOUT_MS = 90_000;

let child: ChildProcess | null = null;
let readyPromise: Promise<boolean> | null = null;

async function isHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function resolvePythonBin(): string {
  if (process.env.PYTHON_BIN && fs.existsSync(process.env.PYTHON_BIN)) {
    return process.env.PYTHON_BIN;
  }
  const venvCandidate = path.resolve(process.cwd(), ".venv/bin/python");
  if (fs.existsSync(venvCandidate)) return venvCandidate;
  const venvCandidate3 = path.resolve(process.cwd(), ".venv/bin/python3");
  if (fs.existsSync(venvCandidate3)) return venvCandidate3;
  return "python3";
}

function spawnService(): void {
  const pythonBin = resolvePythonBin();
  child = spawn(pythonBin, ["serve.py"], {
    cwd: ORCHESTRATOR_DIR,
    env: { ...process.env, ORCHESTRATOR_PORT: String(PORT) },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (code, signal) => {
    console.error(`[orchestrator] proceso terminó (code=${code}, signal=${signal})`);
    child = null;
    readyPromise = null;
  });
}

export function startOrchestrator(): Promise<boolean> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    if (await isHealthy()) {
      console.log("[orchestrator] servicio ya activo");
      return true;
    }
    console.log("[orchestrator] iniciando servicio Python...");
    spawnService();
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      if (await isHealthy()) {
        console.log("[orchestrator] servicio listo");
        return true;
      }
      if (!child) break;
    }
    console.error("[orchestrator] no arrancó dentro del tiempo límite");
    readyPromise = null;
    return false;
  })();
  return readyPromise;
}

export interface OrchestratorQuote {
  quote_id?: string | null;
  quote_row_id: string;
  currency: string;
  ORIGEN: string;
  DESTINO: string;
  "Tipo de Equipo"?: string | null;
  DIVISION?: string | null;
  CLIENTE?: string | null;
  PROVEEDOR?: string | null;
  RANGO?: string | null;
}

export interface OrchestratorResult {
  prediction: {
    champion_prediction_mxn: number | null;
    central_prediction_mxn: number | null;
    protected_cost_mxn: number | null;
    raw_q67_mxn: number | null;
    geo_prediction_mxn: number | null;
    route_history_count: number | null;
    history_level: string | null;
    cost_band: string | null;
    prediction_decile: string | null;
    equipment_guardrail: boolean | null;
    auto_quote: boolean | null;
    review_required: boolean | null;
    decision_status: string | null;
    guardrail_reasons: string | null;
    interval_low_mxn: number | null;
    interval_high_mxn: number | null;
    model_path: string | null;
    [key: string]: unknown;
  };
  routing: {
    mode: string;
    selected_model: string | null;
    selected_cost_mxn: number | null;
    review_required: boolean;
    action: string | null;
    reasons: string[] | null;
    segment?: string | null;
    [key: string]: unknown;
  };
}

export class OrchestratorUnavailableError extends Error {}
export class RouteNotInCacheError extends Error {}

export interface OrchestratorGeo {
  origin_lat?: number;
  origin_lng?: number;
  destination_lat?: number;
  destination_lng?: number;
  origin_elevation_m?: number;
  destination_elevation_m?: number;
}

export async function predictOrchestrated(params: {
  quote: OrchestratorQuote;
  createdAt?: string;
  distanceKm?: number;
  geo?: OrchestratorGeo;
}): Promise<OrchestratorResult> {
  const ready = await startOrchestrator();
  if (!ready) throw new OrchestratorUnavailableError("Servicio de orquestador no disponible");

  const body: Record<string, unknown> = { quote: params.quote };
  if (params.createdAt) body.created_at = params.createdAt;
  if (params.distanceKm !== undefined && isFinite(params.distanceKm)) {
    body.distance_km = params.distanceKm;
  }
  if (params.geo && Object.values(params.geo).some((v) => v !== undefined && v !== null)) {
    body.geo = params.geo;
  }

  const res = await fetch(`${BASE_URL}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (res.status === 422) throw new RouteNotInCacheError("Ruta sin distancia disponible");
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Orquestador respondió ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as OrchestratorResult;
}

/**
 * Solicita al copiloto (servicio Python) la explicación comercial de una
 * precotización ya calculada. El contrato completo (QuoteRequest/PricingResult)
 * se recupera del almacenamiento del servidor Express; nunca del navegador.
 */
export async function explainCopilot(payload: {
  quote_request: Record<string, unknown>;
  pricing_result: Record<string, unknown>;
  budget_subject: string;
}): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string; detail?: string }> {
  const ready = await startOrchestrator();
  if (!ready) return { ok: false, status: 503, error: "copilot_unavailable", detail: "Servicio Python no disponible" };
  const res = await fetch(`${BASE_URL}/copilot/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: String((body as Record<string, unknown>).error || "copilot_failed"),
      detail: typeof (body as Record<string, unknown>).detail === "string" ? String((body as Record<string, unknown>).detail) : undefined,
    };
  }
  return { ok: true, data: body as Record<string, unknown> };
}
