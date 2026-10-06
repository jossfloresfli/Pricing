import type { Express, Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { createServer, type Server } from "http";
import bcrypt from "bcrypt";
import { asyncHandler } from "./asyncHandler";
import { buildQuoteTiming } from "./quoteTiming";
import { storage } from "./storage";
import { pool, db } from "./db";
import { eq, lt, and, desc } from "drizzle-orm";
import {
  copilotQuotes,
  copilotExplanations,
  copilotComments,
  insertUserSchema,
  insertClienteSchema,
  insertProspectoSchema,
  insertSalesRepSchema,
  insertDivisionSchema,
  insertTipoEquipoSchema,
  insertAccesorioSchema,
  insertPricingFileEntrySchema,
  insertPricingRequestSchema,
  insertCarrierOfferSchema,
  insertNotificationSchema,
} from "@shared/schema";
import { getClientesFromSheet, syncClientesFromSheet } from "./googleSheets";
import { predictTarifa, lookupCachedRoute, appendRouteCacheEntry } from "./ml/predictor";
import { predictOrchestrated, explainCopilot, RouteNotInCacheError } from "./ml/orchestratorClient";

async function getGoogleMapsDistanceKm(origen: string, destino: string): Promise<number | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origen)}&destinations=${encodeURIComponent(destino)}&units=metric&key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    const element = data?.rows?.[0]?.elements?.[0];
    if (data.status === "OK" && element?.status === "OK" && element.distance?.value >= 0) {
      return element.distance.value / 1000;
    }
    return null;
  } catch (err) {
    console.error("Error consultando Google Maps Distance Matrix:", err);
    return null;
  }
}

let cachedUsdRate: { rate: number; fetchedAt: number } | null = null;

async function getMxnToUsdRate(): Promise<number | null> {
  const UNA_HORA = 60 * 60 * 1000;
  if (cachedUsdRate && Date.now() - cachedUsdRate.fetchedAt < UNA_HORA) {
    return cachedUsdRate.rate;
  }
  try {
    const respuesta = await fetch("https://api.frankfurter.dev/v2/rate/MXN/USD");
    if (!respuesta.ok) {
      throw new Error("No se pudo obtener el tipo de cambio");
    }
    const datos = await respuesta.json();
    const rate = Number(datos?.rate);
    if (!isFinite(rate) || rate <= 0) {
      throw new Error("Tipo de cambio inválido");
    }
    cachedUsdRate = { rate, fetchedAt: Date.now() };
    return rate;
  } catch (err) {
    console.error("Error consultando tipo de cambio MXN→USD:", err);
    return cachedUsdRate?.rate ?? null;
  }
}

async function getGoogleMapsGeo(origen: string, destino: string): Promise<{
  origin_lat?: number;
  origin_lng?: number;
  destination_lat?: number;
  destination_lng?: number;
  origin_elevation_m?: number;
  destination_elevation_m?: number;
} | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  try {
    const geocode = async (address: string): Promise<{ lat: number; lng: number } | null> => {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const loc = data?.results?.[0]?.geometry?.location;
      return data.status === "OK" && loc && typeof loc.lat === "number" && typeof loc.lng === "number" ? loc : null;
    };
    const [o, d] = await Promise.all([geocode(origen), geocode(destino)]);
    if (!o || !d) return null;

    const geo: Record<string, number> = {
      origin_lat: o.lat,
      origin_lng: o.lng,
      destination_lat: d.lat,
      destination_lng: d.lng,
    };

    try {
      const elevUrl = `https://maps.googleapis.com/maps/api/elevation/json?locations=${o.lat},${o.lng}|${d.lat},${d.lng}&key=${apiKey}`;
      const elevRes = await fetch(elevUrl);
      if (elevRes.ok) {
        const elevData = await elevRes.json();
        if (elevData.status === "OK" && Array.isArray(elevData.results) && elevData.results.length === 2) {
          geo.origin_elevation_m = elevData.results[0].elevation;
          geo.destination_elevation_m = elevData.results[1].elevation;
        }
      }
    } catch {
      // elevación opcional; continuar solo con coordenadas
    }

    return geo;
  } catch (err) {
    console.error("Error consultando Google Maps Geocoding/Elevation:", err);
    return null;
  }
}

const SALT_ROUNDS = 10;

function publicUser<T extends { password: string; plainPassword: string | null }>(user: T) {
  const { password, plainPassword, ...safeUser } = user;
  return safeUser;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "No autenticado" });
  }
  next();
}

function requireSuperadmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "No autenticado" });
  }
  if (req.session.userRole !== "superadmin") {
    return res.status(403).json({ error: "No autorizado" });
  }
  next();
}

function requireManagerOrAbove(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "No autenticado" });
  }
  const allowed = ["superadmin", "sales_manager", "sales_lead", "carrier_manager", "pricing"];
  if (!allowed.includes(req.session.userRole || "")) {
    return res.status(403).json({ error: "No autorizado" });
  }
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Users API (protected - superadmin only)
  app.get("/api/users", requireSuperadmin, asyncHandler(async (req, res) => {
    const users = await storage.getUsers();
    res.json(users.map(publicUser));
  }));

  app.get("/api/users-with-passwords", requireSuperadmin, asyncHandler(async (req, res) => {
    const users = await storage.getUsers();
    res.json(users.map(publicUser));
  }));

  app.post("/api/users", requireSuperadmin, asyncHandler(async (req, res) => {
    const parsed = insertUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const hashedPassword = await bcrypt.hash(parsed.data.password, SALT_ROUNDS);
    const user = await storage.createUser({ ...parsed.data, password: hashedPassword, plainPassword: null });
    res.status(201).json(publicUser(user));
  }));

  app.patch("/api/users/:id", requireSuperadmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const allowedFields = ["username", "password", "name", "email", "role", "active"];
    const updateData: Record<string, unknown> = {};
    
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === "password") {
          if (req.body[field]) {
            updateData[field] = await bcrypt.hash(req.body[field], SALT_ROUNDS);
            updateData["plainPassword"] = null;
          }
        } else {
          updateData[field] = req.body[field];
        }
      }
    }
    
    const user = await storage.updateUser(id, updateData);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(publicUser(user));
  }));

  app.delete("/api/users/:id", requireSuperadmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    await storage.deleteUser(id);
    res.status(204).send();
  }));

  // Authentication API
  app.post("/api/auth/login", asyncHandler(async (req, res) => {
    const { credential, password } = req.body;
    if (!credential || !password) {
      return res.status(400).json({ error: "Correo/Usuario y contraseña son requeridos" });
    }

    // Check if credential is an email (contains @) or username
    const isEmail = credential.includes("@");
    
    let user;
    if (isEmail) {
      // Try to find user by email (for regular users)
      user = await storage.getUserByEmail(credential);
    } else {
      // Try to find user by username (for admins/superadmin)
      user = await storage.getUserByUsername(credential);
    }
    
    if (!user) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    if (!user.active) {
      return res.status(401).json({ error: "Usuario desactivado" });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    req.session.userId = user.id;
    req.session.userRole = user.role;

    res.json(publicUser(user));
  }));

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Error al cerrar sesión" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Sesión cerrada" });
    });
  });

  app.get("/api/auth/me", asyncHandler(async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "No autenticado" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }
    res.json(publicUser(user));
  }));

  // Capacidad aislada: cualquier usuario autenticado puede calcular referencias de costo.
  // No otorga ningún otro permiso; el resto de los módulos conserva sus restricciones por rol.
  function requirePredictAccess(req: Request, res: Response, next: NextFunction) {
    if (!req.session.userId) {
      return res.status(401).json({ error: "No autenticado" });
    }
    // Los roles de ventas (sales_*) no tienen acceso a la referencia de costo.
    if ((req.session.userRole || "").toLowerCase().includes("sales")) {
      return res.status(403).json({ error: "Tu rol no tiene acceso a la referencia de costo" });
    }
    next();
  }

  // --- Copiloto explicador ---
  // Almacén persistente (Postgres compartido) de las precotizaciones
  // calculadas por el orquestador, recuperables por quoteId+rutaId desde
  // cualquier proceso y tras reinicios. El copiloto NUNCA acepta costos desde
  // el navegador: recupera aquí el resultado original.
  const COPILOT_STORE_TTL_MS = 60 * 60 * 1000;
  const copilotStoreKey = (quoteId: string, rutaId: string) => `${quoteId}::${rutaId}`;
  async function copilotStoreSet(key: string, value: {
    quoteRequest: Record<string, unknown>;
    pricingResult: Record<string, unknown>;
    modelosDisponibles: string[];
  }) {
    const expiresAt = new Date(Date.now() + COPILOT_STORE_TTL_MS);
    await db
      .insert(copilotQuotes)
      .values({
        storeKey: key,
        quoteRequest: value.quoteRequest,
        pricingResult: value.pricingResult,
        modelosDisponibles: value.modelosDisponibles,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: copilotQuotes.storeKey,
        set: {
          quoteRequest: value.quoteRequest,
          pricingResult: value.pricingResult,
          modelosDisponibles: value.modelosDisponibles,
          expiresAt,
        },
      });
    // Limpieza oportunista de entradas vencidas (fuera del camino crítico).
    db.delete(copilotQuotes)
      .where(lt(copilotQuotes.expiresAt, new Date()))
      .catch((err) => console.error("[copilot] limpieza de precotizaciones vencidas falló:", err));
  }
  async function copilotStoreGet(key: string): Promise<{
    quoteRequest: Record<string, unknown>;
    pricingResult: Record<string, unknown>;
    modelosDisponibles: string[];
  } | null> {
    const rows = await db
      .select()
      .from(copilotQuotes)
      .where(eq(copilotQuotes.storeKey, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) {
      db.delete(copilotQuotes)
        .where(eq(copilotQuotes.storeKey, key))
        .catch(() => {});
      return null;
    }
    return {
      quoteRequest: row.quoteRequest as Record<string, unknown>,
      pricingResult: row.pricingResult as Record<string, unknown>,
      modelosDisponibles: (row.modelosDisponibles as string[]) ?? [],
    };
  }

  // Mapeo entre las opciones comerciales de la UI y los componentes del orquestador.
  const COPILOT_MODEL_OPTIONS: { key: string; label: string; componentField: string; modelMatch: (m: string) => boolean }[] = [
    { key: "historica", label: "Estimación histórica", componentField: "lightgbm_mxn", modelMatch: (m) => m.includes("incumbent") && !m.includes("p67") },
    { key: "proteccion", label: "Estimación con protección", componentField: "quantile_p67_mxn", modelMatch: (m) => m.includes("p67") || m.includes("quantile") },
    { key: "ajustada", label: "Estimación ajustada por ruta", componentField: "national_geo_mxn", modelMatch: (m) => m.includes("geo") },
    { key: "comparacion", label: "Comparación con rutas similares", componentField: "national_hybrid_mxn", modelMatch: (m) => m.includes("hybrid") },
  ];

  app.post("/api/predict-tarifa", requirePredictAccess, asyncHandler(async (req, res) => {
    try {
      const { cliente, origen, destino, tipoEquipo, division, rango, fechaCreacion } = req.body || {};
      if (!origen || !destino || typeof origen !== "string" || typeof destino !== "string") {
        return res.status(400).json({ error: "Se requiere origen y destino" });
      }

      let distanceKm: number | undefined = undefined;
      let distanceSource: "cache" | "google_maps" | "median" = "median";
      let geo: Awaited<ReturnType<typeof getGoogleMapsGeo>> = null;
      const geoCompleto = (g: Awaited<ReturnType<typeof getGoogleMapsGeo>>): boolean =>
        g !== null &&
        g.origin_lat !== undefined &&
        g.origin_lng !== undefined &&
        g.destination_lat !== undefined &&
        g.destination_lng !== undefined;

      const cached = await lookupCachedRoute(origen, destino);
      if (cached !== null) {
        distanceKm = cached.distanceKm;
        distanceSource = "cache";
        geo = {
          origin_lat: cached.origin_lat,
          origin_lng: cached.origin_lng,
          destination_lat: cached.destination_lat,
          destination_lng: cached.destination_lng,
          origin_elevation_m: cached.origin_elevation_m,
          destination_elevation_m: cached.destination_elevation_m,
        };
        if (!geoCompleto(geo)) {
          const gmapsGeo = await getGoogleMapsGeo(origen, destino);
          if (geoCompleto(gmapsGeo)) {
            geo = gmapsGeo;
            await appendRouteCacheEntry(origen, destino, {
              distanceKm: cached.distanceKm,
              ...gmapsGeo,
            });
          }
        }
      } else {
        const [gmaps, gmapsGeo] = await Promise.all([
          getGoogleMapsDistanceKm(origen, destino),
          getGoogleMapsGeo(origen, destino),
        ]);
        if (gmaps !== null) {
          distanceKm = gmaps;
          distanceSource = "google_maps";
          if (geoCompleto(gmapsGeo)) {
            await appendRouteCacheEntry(origen, destino, {
              distanceKm: gmaps,
              ...gmapsGeo,
            });
          }
        }
        geo = gmapsGeo;
      }

      const divisionNorm = String(division || "").trim().toLowerCase();
      const requiereUsd = divisionNorm.includes("crossborder") || divisionNorm.includes("cross border") || divisionNorm.includes("domestic");
      const tipoCambioUsd = requiereUsd ? await getMxnToUsdRate() : null;

      const fecha = fechaCreacion ? new Date(fechaCreacion) : new Date();
      const fechaValida = isNaN(fecha.getTime()) ? new Date() : fecha;
      const createdAtStr = `${String(fechaValida.getDate()).padStart(2, "0")}/${String(fechaValida.getMonth() + 1).padStart(2, "0")}/${fechaValida.getFullYear()}`;
      const rutaId = req.body?.rutaId ? String(req.body.rutaId) : `${origen}->${destino}`;

      try {
        const orch = await predictOrchestrated({
          quote: {
            quote_id: req.body?.quoteId ? String(req.body.quoteId) : null,
            quote_row_id: rutaId,
            currency: "MXN",
            ORIGEN: origen,
            DESTINO: destino,
            "Tipo de Equipo": tipoEquipo || null,
            DIVISION: division || null,
            CLIENTE: cliente || null,
            PROVEEDOR: null,
            RANGO: rango || null,
          },
          createdAt: createdAtStr,
          distanceKm,
          geo: geo ?? undefined,
        });

        const p = orch.prediction;
        const r = orch.routing;
        let guardrailReasons: string[] = [];
        try {
          guardrailReasons = p.guardrail_reasons ? JSON.parse(String(p.guardrail_reasons)) : [];
        } catch {
          guardrailReasons = [];
        }
        const costoSeleccionado = r.selected_cost_mxn ?? p.protected_cost_mxn ?? p.central_prediction_mxn;

        // Guardar la precotización íntegra en el servidor para que el copiloto
        // pueda explicarla después sin aceptar montos desde el navegador.
        if (req.body?.quoteId && costoSeleccionado !== null && costoSeleccionado !== undefined) {
          try {
            const componentesOrq = ((r as Record<string, unknown>).components ?? {}) as Record<string, unknown>;
            const modeloSel = String(r.selected_model ?? p.model_path ?? "");
            const targetMarginPct = 18;
            const costoNum = Number(costoSeleccionado);
            const ventaEstimada = costoNum * (1 + targetMarginPct / 100);
            const modelos = COPILOT_MODEL_OPTIONS.map((opt) => {
              const valor = componentesOrq[opt.componentField];
              const disponible = typeof valor === "number" && isFinite(valor) && valor > 0;
              return {
                key: opt.key,
                label: opt.label,
                role: opt.modelMatch(modeloSel.toLowerCase()) ? "selected" : "alternative",
                selected: opt.modelMatch(modeloSel.toLowerCase()),
                available: disponible,
                prediction: disponible ? Number(valor) : null,
              };
            });
            await copilotStoreSet(copilotStoreKey(String(req.body.quoteId), rutaId), {
              quoteRequest: {
                quote_id: String(req.body.quoteId),
                quote_row_id: rutaId,
                currency: "MXN",
                origin: origen,
                destination: destino,
                equipment: tipoEquipo || "N/D",
                division: division || "N/D",
                service_range: rango || null,
                distance_km: distanceKm !== undefined && distanceKm > 0 ? distanceKm : null,
                target_margin_pct: targetMarginPct,
                created_at: fechaValida.toISOString(),
                geo: geo ? {
                  origin_lat: geo.origin_lat ?? null,
                  origin_lng: geo.origin_lng ?? null,
                  destination_lat: geo.destination_lat ?? null,
                  destination_lng: geo.destination_lng ?? null,
                  origin_elevation_m: geo.origin_elevation_m ?? null,
                  destination_elevation_m: geo.destination_elevation_m ?? null,
                } : null,
                // Regla de negocio: Crossborder/Domestic se cotiza en USD. Este
                // campo es sólo para presentación; se retira antes de enviar al
                // orquestador (su contrato prohíbe campos extra) porque el
                // historial y los modelos operan en MXN.
                usd_display: requiereUsd && tipoCambioUsd !== null ? { rate: tipoCambioUsd } : null,
              },
              pricingResult: {
                quote_id: String(req.body.quoteId),
                currency: "MXN",
                selected_cost: costoNum,
                all_in_rate_sale: ventaEstimada,
                margin_amount: ventaEstimada - costoNum,
                margin_percentage: targetMarginPct,
                selected_model: modeloSel || "desconocido",
                models: modelos,
                inference_runtime: "onnx",
                base_cost: p.central_prediction_mxn !== null ? Number(p.central_prediction_mxn) : null,
                protection_amount: p.protected_cost_mxn !== null && p.central_prediction_mxn !== null
                  ? Number(p.protected_cost_mxn) - Number(p.central_prediction_mxn)
                  : null,
                protection_applied: modeloSel.toLowerCase().includes("p67") || modeloSel.toLowerCase().includes("quantile"),
                review_required: r.review_required !== false,
                decision_blocked: p.decision_status === "blocked",
                route_history_count: p.route_history_count !== null && p.route_history_count !== undefined
                  ? Math.round(Number(p.route_history_count))
                  : 0,
                history_level: p.history_level ?? "desconocido",
                reasons: Array.isArray(r.reasons) ? r.reasons : [],
                guardrail_reasons: guardrailReasons,
                action: r.action ?? "desconocida",
              },
              modelosDisponibles: modelos.filter((m) => m.available).map((m) => m.key),
            });
          } catch (storeErr) {
            console.error("[copilot] no se pudo guardar la precotización:", storeErr);
          }
        }

        return res.json({
          motor: "orquestador",
          costoEstimado: costoSeleccionado !== null && costoSeleccionado !== undefined ? Math.round(Number(costoSeleccionado)) : null,
          costoCentral: p.central_prediction_mxn !== null ? Math.round(Number(p.central_prediction_mxn)) : null,
          costoProtegido: p.protected_cost_mxn !== null ? Math.round(Number(p.protected_cost_mxn)) : null,
          // Rango de variación fijo respecto a la referencia de costo (predicción central,
          // sin protección): -5% / +15%
          rangoBajo: p.central_prediction_mxn !== null && p.central_prediction_mxn !== undefined
            ? Math.round(Number(p.central_prediction_mxn) * 0.95)
            : null,
          rangoAlto: p.central_prediction_mxn !== null && p.central_prediction_mxn !== undefined
            ? Math.round(Number(p.central_prediction_mxn) * 1.15)
            : null,
          modeloSeleccionado: r.selected_model ?? p.model_path ?? null,
          accion: r.action ?? null,
          razones: Array.isArray(r.reasons) ? r.reasons : [],
          razonesGuardrails: guardrailReasons,
          revisionRequerida: r.review_required !== false,
          estadoDecision: p.decision_status ?? null,
          nivelHistorial: p.history_level ?? null,
          conteoHistorialRuta: p.route_history_count !== null && p.route_history_count !== undefined
            ? Math.round(Number(p.route_history_count))
            : null,
          decil: p.prediction_decile ?? null,
          distanciaKm: distanceKm !== undefined ? Math.round(distanceKm) : null,
          fuenteDistancia: distanceSource,
          modo: r.mode ?? "shadow_only",
          componentes: (r as Record<string, unknown>).components ?? null,
          tipoCambioUsd,
          costoEstimadoUsd: tipoCambioUsd !== null && costoSeleccionado !== null && costoSeleccionado !== undefined
            ? Math.ceil(Number(costoSeleccionado) * tipoCambioUsd)
            : null,
        });
      } catch (orchErr) {
        if (!(orchErr instanceof RouteNotInCacheError)) {
          console.error("[orchestrator] fallo, usando modelo base:", orchErr);
        }
      }

      const result = await predictTarifa({
        cliente: cliente || null,
        proveedor: null,
        origen,
        destino,
        tipoEquipo: tipoEquipo || null,
        division: division || null,
        rango: rango || null,
        fechaCreacion: fechaValida,
        distanceKm,
      });

      res.json({
        motor: "modelo_base",
        costoEstimado: Math.round(result.costMxnPrediction),
        // Rango de variación fijo respecto al costo de referencia: -5% / +15%
        rangoBajo: Math.round(result.costMxnPrediction * 0.95),
        rangoAlto: Math.round(result.costMxnPrediction * 1.15),
        distanciaKm: distanceKm !== undefined ? Math.round(distanceKm) : null,
        fuenteDistancia: distanceSource,
        categoriasDesconocidas: result.unknownCategories,
        modelVersion: result.modelVersion,
        trainedThrough: result.trainedThrough,
        revisionRequerida: true,
        tipoCambioUsd,
        costoEstimadoUsd: tipoCambioUsd !== null
          ? Math.ceil(result.costMxnPrediction * tipoCambioUsd)
          : null,
      });
    } catch (err) {
      console.error("Error en predicción de tarifa:", err);
      res.status(500).json({ error: "No se pudo generar la predicción" });
    }
  }));

  // Hash estable del resultado de pricing: identifica la versión del pricing
  // que respalda una explicación (claves ordenadas recursivamente).
  function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
      return `{${entries.join(",")}}`;
    }
    return JSON.stringify(value);
  }
  const pricingHashOf = (pricingResult: unknown) =>
    createHash("sha256").update(stableStringify(pricingResult)).digest("hex");

  // ¿El rol puede ver quién solicitó cada explicación?
  const canSeeSolicitante = (role: string | undefined) => {
    const r = (role || "").toLowerCase();
    return r === "superadmin" || r.includes("manager") || r === "pricing";
  };

  const sanitizeExplanation = (row: typeof copilotExplanations.$inferSelect, showSolicitante: boolean) => ({
    id: row.id,
    quoteId: row.quoteId,
    rutaId: row.rutaId,
    modelKey: row.modelKey,
    modelLabel: row.modelLabel,
    origen: row.origen,
    destino: row.destino,
    costoExplicado: row.costoExplicado !== null ? Number(row.costoExplicado) : null,
    moneda: row.moneda,
    status: row.status,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    solicitante: showSolicitante ? row.solicitanteNombre || row.solicitanteId : null,
  });

  // Explicación comercial del copiloto sobre una precotización ya calculada.
  // El navegador sólo envía quoteId, rutaId y modelKey; el costo y demás
  // evidencia se recuperan del almacenamiento del servidor. Las explicaciones
  // se persisten y se reutilizan: identidad quoteId+rutaId+modelKey+pricingHash.
  app.post("/api/copilot/explain", requirePredictAccess, asyncHandler(async (req, res) => {
    try {
      const quoteId = typeof req.body?.quoteId === "string" ? req.body.quoteId : "";
      const rutaId = typeof req.body?.rutaId === "string" ? req.body.rutaId : "";
      const modelKey = typeof req.body?.modelKey === "string" ? req.body.modelKey : "";
      if (!quoteId || !rutaId || !modelKey) {
        return res.status(400).json({ error: "Se requiere quoteId, rutaId y modelKey" });
      }
      const showSolicitante = canSeeSolicitante(req.session.userRole);
      const identidad = (hash: string) =>
        and(
          eq(copilotExplanations.quoteId, quoteId),
          eq(copilotExplanations.rutaId, rutaId),
          eq(copilotExplanations.modelKey, modelKey),
          eq(copilotExplanations.pricingHash, hash),
        );

      const stored = await copilotStoreGet(copilotStoreKey(quoteId, rutaId));
      if (!stored) {
        // Sin precotización vigente aún se puede reutilizar la explicación más
        // reciente ya guardada para esta referencia (no consume tokens).
        const previas = await db
          .select()
          .from(copilotExplanations)
          .where(
            and(
              eq(copilotExplanations.quoteId, quoteId),
              eq(copilotExplanations.rutaId, rutaId),
              eq(copilotExplanations.modelKey, modelKey),
              eq(copilotExplanations.status, "completed"),
            ),
          )
          .orderBy(desc(copilotExplanations.createdAt))
          .limit(1);
        if (previas[0]) {
          return res.json({
            copilot: previas[0].respuesta,
            modelKey,
            reused: true,
            explanation: sanitizeExplanation(previas[0], showSolicitante),
          });
        }
        return res.status(404).json({
          error: "precotizacion_no_encontrada",
          mensaje: "Primero calcula la referencia de costo; la explicación se genera sobre el resultado guardado en el servidor.",
        });
      }
      if (!stored.modelosDisponibles.includes(modelKey)) {
        return res.status(400).json({ error: "opcion_no_disponible", mensaje: "La opción indicada no estaba disponible en esta precotización." });
      }
      // Aplicar la opción solicitada al contrato: la explicación debe generarse
      // sobre la referencia que el usuario eligió, no sobre la seleccionada por
      // defecto. Los montos siguen proviniendo del almacenamiento del servidor.
      const baseResult = stored.pricingResult as Record<string, any>;
      const modelos = (Array.isArray(baseResult.models) ? baseResult.models : []) as Record<string, any>[];
      const elegido = modelos.find((m) => m.key === modelKey);
      if (!elegido || typeof elegido.prediction !== "number") {
        return res.status(400).json({ error: "opcion_no_disponible", mensaje: "La opción indicada no estaba disponible en esta precotización." });
      }
      const targetPct = Number(baseResult.margin_percentage) || 18;
      const costoElegido = Number(elegido.prediction);
      const ventaElegida = costoElegido * (1 + targetPct / 100);
      const pricingResult = {
        ...baseResult,
        selected_model: String(elegido.label || modelKey),
        selected_cost: costoElegido,
        all_in_rate_sale: ventaElegida,
        margin_amount: ventaElegida - costoElegido,
        protection_applied: modelKey === "proteccion",
        models: modelos.map((m) => ({
          ...m,
          selected: m.key === modelKey,
          role: m.key === modelKey ? "selected" : "alternative",
        })),
      };
      const quoteReq = stored.quoteRequest as Record<string, any>;
      const modelLabel = String(elegido.label || modelKey);

      // Regla de negocio: Crossborder/Domestic se cotiza en USD. La evidencia
      // histórica y los modelos siguen en MXN; la conversión es de presentación
      // y usa el mismo redondeo hacia arriba que el cotizador.
      const usdRate = typeof quoteReq?.usd_display?.rate === "number" && quoteReq.usd_display.rate > 0
        ? Number(quoteReq.usd_display.rate)
        : null;
      // El tipo de cambio forma parte de la identidad: si cambia (o la
      // explicación es anterior a la presentación en USD), se regenera en
      // lugar de reutilizar montos convertidos con un tipo de cambio viejo.
      const pricingHash = pricingHashOf(
        usdRate !== null ? { ...pricingResult, usd_display_rate: usdRate } : pricingResult,
      );
      const costoElegidoUsd = usdRate !== null ? Math.ceil(costoElegido * usdRate) : null;
      // Cubre tanto la nota vigente como la versión anterior (que terminaba en
      // "permanecen en MXN.") para reemplazarla al reutilizar explicaciones.
      const NOTA_USD_REGEX = /\s*Nota: esta división se cotiza en dólares;[\s\S]*?USD\/MXN\)\.(\s*Los montos históricos mostrados permanecen en MXN\.)?/g;
      const notaUsd = () =>
        ` Nota: esta división se cotiza en dólares; todos los montos mostrados están en USD ` +
        `y el costo de referencia es $${(costoElegidoUsd as number).toLocaleString("en-US")} USD ` +
        `(tipo de cambio ${(usdRate as number).toFixed(4)} USD/MXN).`;
      // Reconciliación determinista de la presentación en USD (también para
      // explicaciones reutilizadas: el tipo de cambio pudo cambiar o la fila
      // ser anterior a esta regla). No modifica la evidencia ni el modelo.
      const aplicarUsd = (respuesta: unknown): unknown => {
        if (costoElegidoUsd === null || usdRate === null) return respuesta;
        if (!respuesta || typeof respuesta !== "object") return respuesta;
        const r = { ...(respuesta as Record<string, any>) };
        if (r.status === "unavailable") return respuesta;
        r.usd_display = { cost_usd: costoElegidoUsd, rate: usdRate };
        if (typeof r.answer === "string" && r.answer.trim()) {
          r.answer = r.answer.replace(NOTA_USD_REGEX, "").trimEnd() + notaUsd();
        }
        return r;
      };

      // 1) ¿Ya existe una explicación para esta identidad?
      const findExisting = async () =>
        (await db.select().from(copilotExplanations).where(identidad(pricingHash)).limit(1))[0];

      const responder = (row: typeof copilotExplanations.$inferSelect, reused: boolean) => {
        const explanation = sanitizeExplanation(row, showSolicitante);
        if (costoElegidoUsd !== null && usdRate !== null && row.status === "completed") {
          explanation.costoExplicado = costoElegidoUsd;
          explanation.moneda = "USD";
        }
        return res.json({
          copilot: aplicarUsd(row.respuesta),
          modelKey,
          reused,
          explanation,
        });
      };

      // Espera a que otra solicitud simultánea termine su generación.
      const esperarGeneracion = async () => {
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const actual = await findExisting();
          if (!actual) return null;
          if (actual.status === "completed") return actual;
          if (actual.status === "failed") return actual;
        }
        return await findExisting();
      };

      let claimId: string | null = null;
      const existente = await findExisting();
      if (existente?.status === "completed") {
        return responder(existente, true);
      }
      if (existente?.status === "generating") {
        // Recuperación de reclamos huérfanos: si la fila lleva demasiado
        // tiempo en "generating" (proceso caído a mitad de la generación),
        // se retoma atómicamente en lugar de bloquear la identidad para
        // siempre.
        const STALE_CLAIM_MS = 5 * 60 * 1000;
        const limite = new Date(Date.now() - STALE_CLAIM_MS);
        const esVieja = existente.createdAt && existente.createdAt.getTime() < limite.getTime();
        if (esVieja) {
          const retomada = await db
            .update(copilotExplanations)
            .set({ status: "generating", errorMensaje: null, solicitanteId: String(req.session.userId), createdAt: new Date() })
            .where(and(
              eq(copilotExplanations.id, existente.id),
              eq(copilotExplanations.status, "generating"),
              lt(copilotExplanations.createdAt, limite),
            ))
            .returning({ id: copilotExplanations.id });
          claimId = retomada[0]?.id ?? null;
        }
        if (!claimId) {
          const terminada = await esperarGeneracion();
          if (terminada?.status === "completed") return responder(terminada, true);
          return res.status(503).json({
            error: "copiloto_no_disponible",
            mensaje: "La explicación sigue preparándose o falló. Intenta de nuevo en unos momentos; la referencia de costo no se ve afectada.",
          });
        }
      }

      // 2) Reclamo atómico de la generación (evita duplicados con clics
      //    simultáneos): sólo un proceso inserta la fila `generating`.
      if (claimId) {
        // Ya retomamos una generación huérfana; continuar directo a generar.
      } else if (existente?.status === "failed") {
        const updated = await db
          .update(copilotExplanations)
          .set({ status: "generating", errorMensaje: null, solicitanteId: String(req.session.userId), createdAt: new Date() })
          .where(and(eq(copilotExplanations.id, existente.id), eq(copilotExplanations.status, "failed")))
          .returning({ id: copilotExplanations.id });
        claimId = updated[0]?.id ?? null;
      } else {
        const solicitante = await storage.getUser(String(req.session.userId)).catch(() => null);
        const inserted = await db
          .insert(copilotExplanations)
          .values({
            quoteId,
            rutaId,
            modelKey,
            modelLabel,
            pricingHash,
            origen: String(quoteReq.origin || ""),
            destino: String(quoteReq.destination || ""),
            costoExplicado: costoElegidoUsd !== null ? String(costoElegidoUsd) : String(costoElegido),
            moneda: costoElegidoUsd !== null ? "USD" : String(quoteReq.currency || "MXN"),
            status: "generating",
            solicitanteId: String(req.session.userId),
            solicitanteNombre: solicitante?.name || solicitante?.username || "",
          })
          .onConflictDoNothing({
            target: [
              copilotExplanations.quoteId,
              copilotExplanations.rutaId,
              copilotExplanations.modelKey,
              copilotExplanations.pricingHash,
            ],
          })
          .returning({ id: copilotExplanations.id });
        claimId = inserted[0]?.id ?? null;
      }

      if (!claimId) {
        // Otro proceso reclamó la generación: esperar y devolver su resultado.
        const terminada = await esperarGeneracion();
        if (terminada?.status === "completed") return responder(terminada, true);
        return res.status(503).json({
          error: "copiloto_no_disponible",
          mensaje: "La explicación sigue preparándose. Intenta de nuevo en unos momentos; la referencia de costo no se ve afectada.",
        });
      }

      // 3) Generar con el copiloto ya integrado (budget_subject viene de la
      //    sesión autenticada; nunca del navegador).
      // usd_display se envía al orquestador: el servicio Python convierte toda
      // la salida (evidencia, tablas y texto) a USD; la recuperación histórica
      // sigue operando en MXN internamente.
      const result = await explainCopilot({
        quote_request: quoteReq,
        pricing_result: pricingResult,
        budget_subject: String(req.session.userId),
      });
      if (!result.ok) {
        console.error("[copilot] fallo:", result.error, result.detail || "");
        await db
          .update(copilotExplanations)
          .set({ status: "failed", errorMensaje: String(result.error || "error"), completedAt: new Date() })
          .where(eq(copilotExplanations.id, claimId))
          .catch((e) => console.error("[copilot] no se pudo marcar failed:", e));
        return res.status(result.status === 503 ? 503 : 502).json({
          error: "copiloto_no_disponible",
          mensaje: "No se pudo generar la explicación. La referencia de costo no se ve afectada.",
        });
      }
      // Nota determinista (no generada por el modelo): misma regla que el
      // cotizador para divisiones que se cotizan en dólares.
      const copilotData = aplicarUsd(result.data) as Record<string, any>;
      const failed = copilotData?.status === "unavailable";
      const updatedRows = await db
        .update(copilotExplanations)
        .set({
          status: failed ? "failed" : "completed",
          respuesta: copilotData,
          errorMensaje: failed ? String((copilotData?.warnings || [])[0] || "no disponible") : null,
          completedAt: new Date(),
        })
        .where(eq(copilotExplanations.id, claimId))
        .returning();
      const rowFinal = updatedRows[0];
      res.json({
        copilot: copilotData,
        modelKey,
        reused: false,
        explanation: rowFinal ? sanitizeExplanation(rowFinal, showSolicitante) : null,
      });
    } catch (err) {
      console.error("[copilot] error:", err);
      res.status(500).json({
        error: "copiloto_no_disponible",
        mensaje: "No se pudo generar la explicación. La referencia de costo no se ve afectada.",
      });
    }
  }));

  // --- Comentarios y sugerencias sobre el modelo/copiloto (carriers y pricing) ---
  // Nunca se expone author_id (identificador interno) a los clientes.
  const sanitizeCopilotComment = (row: typeof copilotComments.$inferSelect) => ({
    id: row.id,
    authorName: row.authorName,
    authorRole: row.authorRole,
    comment: row.comment,
    quoteId: row.quoteId,
    rutaId: row.rutaId,
    modelKey: row.modelKey,
    createdAt: row.createdAt,
  });

  app.get("/api/copilot/comments", requirePredictAccess, asyncHandler(async (req, res) => {
    try {
      // Cada apartado del copiloto muestra únicamente los comentarios hechos
      // dentro de esa cotización (quoteId + rutaId).
      const quoteId = typeof req.query.quoteId === "string" ? req.query.quoteId : "";
      const rutaId = typeof req.query.rutaId === "string" ? req.query.rutaId : "";
      const condiciones = [];
      if (quoteId) condiciones.push(eq(copilotComments.quoteId, quoteId));
      if (rutaId) condiciones.push(eq(copilotComments.rutaId, rutaId));
      const base = db.select().from(copilotComments);
      const rows = await (condiciones.length ? base.where(and(...condiciones)) : base)
        .orderBy(desc(copilotComments.createdAt))
        .limit(100);
      res.json({ comments: rows.map(sanitizeCopilotComment) });
    } catch (err) {
      console.error("[copilot] listado de comentarios falló:", err);
      res.status(500).json({ error: "No se pudieron consultar los comentarios" });
    }
  }));

  app.post("/api/copilot/comments", requirePredictAccess, asyncHandler(async (req, res) => {
    try {
      const comment = String(req.body?.comment || "").trim();
      if (!comment) {
        return res.status(400).json({ error: "El comentario no puede estar vacío" });
      }
      if (comment.length > 2000) {
        return res.status(400).json({ error: "El comentario no puede exceder 2000 caracteres" });
      }
      const author = await storage.getUser(String(req.session.userId)).catch(() => null);
      const [row] = await db
        .insert(copilotComments)
        .values({
          authorId: String(req.session.userId),
          authorName: author?.name || author?.username || "",
          authorRole: req.session.userRole || "",
          comment,
          quoteId: req.body?.quoteId ? String(req.body.quoteId).slice(0, 100) : null,
          rutaId: req.body?.rutaId ? String(req.body.rutaId).slice(0, 100) : null,
          modelKey: req.body?.modelKey ? String(req.body.modelKey).slice(0, 100) : null,
        })
        .returning();
      res.status(201).json({ comment: sanitizeCopilotComment(row) });
    } catch (err) {
      console.error("[copilot] guardar comentario falló:", err);
      res.status(500).json({ error: "No se pudo guardar el comentario" });
    }
  }));

  // Listado de explicaciones guardadas (solo lectura; nunca consume tokens).
  app.get("/api/copilot/explanations", requirePredictAccess, asyncHandler(async (req, res) => {
    try {
      const showSolicitante = canSeeSolicitante(req.session.userRole);
      const rows = await db
        .select()
        .from(copilotExplanations)
        .orderBy(desc(copilotExplanations.createdAt))
        .limit(300);
      // Marca qué cotizaciones tienen comentarios hechos dentro del copiloto
      // (coincidencia por quoteId + rutaId).
      const pares = await db
        .selectDistinct({ quoteId: copilotComments.quoteId, rutaId: copilotComments.rutaId })
        .from(copilotComments);
      const conComentarios = new Set(pares.map((p) => `${p.quoteId}::${p.rutaId}`));
      res.json({
        explanations: rows.map((r) => ({
          ...sanitizeExplanation(r, showSolicitante),
          hasComments: conComentarios.has(`${r.quoteId}::${r.rutaId}`),
        })),
        canSeeSolicitante: showSolicitante,
      });
    } catch (err) {
      console.error("[copilot] listado falló:", err);
      res.status(500).json({ error: "No se pudieron consultar las explicaciones guardadas" });
    }
  }));

  // Detalle completo de una explicación guardada (solo lectura).
  app.get("/api/copilot/explanations/:id", requirePredictAccess, asyncHandler(async (req, res) => {
    try {
      const rows = await db
        .select()
        .from(copilotExplanations)
        .where(eq(copilotExplanations.id, req.params.id))
        .limit(1);
      const row = rows[0];
      if (!row) return res.status(404).json({ error: "Explicación no encontrada" });
      const showSolicitante = canSeeSolicitante(req.session.userRole);
      res.json({
        explanation: sanitizeExplanation(row, showSolicitante),
        copilot: row.respuesta,
        errorMensaje: row.errorMensaje,
      });
    } catch (err) {
      console.error("[copilot] detalle falló:", err);
      res.status(500).json({ error: "No se pudo consultar la explicación" });
    }
  }));

  app.get("/api/users/:id", requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const user = await storage.getUser(id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(publicUser(user));
  }));

  // Clientes API
  app.get("/api/clientes", requireAuth, asyncHandler(async (req, res) => {
    try {
      const clientes = await storage.getClientes();
      console.log(`[Clientes API] Returning ${clientes.length} clientes`);
      res.json(clientes);
    } catch (error) {
      console.error("[Clientes API] Error fetching clientes:", error);
      res.status(500).json({ error: "Error al cargar clientes" });
    }
  }));

  app.post("/api/clientes", requireSuperadmin, asyncHandler(async (req, res) => {
    const parsed = insertClienteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const cliente = await storage.createCliente(parsed.data);
    res.status(201).json(cliente);
  }));

  app.patch("/api/clientes/:id", requireSuperadmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const cliente = await storage.updateCliente(id, req.body);
    if (!cliente) {
      return res.status(404).json({ error: "Cliente not found" });
    }
    res.json(cliente);
  }));

  app.delete("/api/clientes/:id", requireSuperadmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    await storage.deleteCliente(id);
    res.status(204).send();
  }));

  // Prospectos API
  app.get("/api/prospectos", requireAuth, asyncHandler(async (req, res) => {
    const prospectos = await storage.getProspectos();
    res.json(prospectos);
  }));

  app.post("/api/prospectos", requireSuperadmin, asyncHandler(async (req, res) => {
    const parsed = insertProspectoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const prospecto = await storage.createProspecto(parsed.data);
    res.status(201).json(prospecto);
  }));

  app.patch("/api/prospectos/:id", requireSuperadmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const prospecto = await storage.updateProspecto(id, req.body);
    if (!prospecto) {
      return res.status(404).json({ error: "Prospecto not found" });
    }
    res.json(prospecto);
  }));

  app.delete("/api/prospectos/:id", requireSuperadmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    await storage.deleteProspecto(id);
    res.status(204).send();
  }));

  // Sales Reps API (catalog)
  app.get("/api/sales-reps", requireAuth, asyncHandler(async (req, res) => {
    const salesReps = await storage.getSalesReps();
    res.json(salesReps);
  }));

  // Sales Users API (users with sales roles: sales_rep, sales_lead, sales_manager)
  app.get("/api/sales-users", requireAuth, asyncHandler(async (req, res) => {
    try {
      const salesUsers = await storage.getSalesUsers();
      console.log(`[Sales Users API] Returning ${salesUsers.length} sales users`);
      res.json(salesUsers.map(u => ({ id: u.id, name: u.name, role: u.role })));
    } catch (error) {
      console.error("[Sales Users API] Error:", error);
      res.status(500).json({ error: "Error al cargar usuarios de ventas" });
    }
  }));

  // Get all active users for mentions (accessible by any authenticated user)
  app.get("/api/users-for-mentions", requireAuth, asyncHandler(async (req, res) => {
    try {
      const users = await storage.getUsers();
      const activeUsers = users.filter(u => u.active);
      res.json(activeUsers.map(u => ({ 
        id: u.id, 
        name: u.name, 
        role: u.role,
        username: u.username 
      })));
    } catch (error) {
      console.error("[Users for Mentions API] Error:", error);
      res.status(500).json({ error: "Error al cargar usuarios" });
    }
  }));

  app.post("/api/sales-reps", requireSuperadmin, asyncHandler(async (req, res) => {
    const parsed = insertSalesRepSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const salesRep = await storage.createSalesRep(parsed.data);
    res.status(201).json(salesRep);
  }));

  app.patch("/api/sales-reps/:id", requireSuperadmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const salesRep = await storage.updateSalesRep(id, req.body);
    if (!salesRep) {
      return res.status(404).json({ error: "Sales Rep not found" });
    }
    res.json(salesRep);
  }));

  app.delete("/api/sales-reps/:id", requireSuperadmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    await storage.deleteSalesRep(id);
    res.status(204).send();
  }));

  // Divisiones API
  app.get("/api/divisiones", requireAuth, asyncHandler(async (req, res) => {
    const divisiones = await storage.getDivisiones();
    res.json(divisiones);
  }));

  app.post("/api/divisiones", requireSuperadmin, asyncHandler(async (req, res) => {
    const parsed = insertDivisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const division = await storage.createDivision(parsed.data);
    res.status(201).json(division);
  }));

  app.patch("/api/divisiones/:id", requireSuperadmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const division = await storage.updateDivision(id, req.body);
    if (!division) {
      return res.status(404).json({ error: "Division not found" });
    }
    res.json(division);
  }));

  app.delete("/api/divisiones/:id", requireSuperadmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    await storage.deleteDivision(id);
    res.status(204).send();
  }));

  // Tipos de Equipo API
  app.get("/api/tipos-equipo", requireAuth, asyncHandler(async (req, res) => {
    const tipos = await storage.getTiposEquipo();
    res.json(tipos);
  }));

  app.post("/api/tipos-equipo", requireAuth, asyncHandler(async (req, res) => {
    const parsed = insertTipoEquipoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const tipo = await storage.createTipoEquipo(parsed.data);
    res.status(201).json(tipo);
  }));

  app.patch("/api/tipos-equipo/:id", requireSuperadmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const tipo = await storage.updateTipoEquipo(id, req.body);
    if (!tipo) {
      return res.status(404).json({ error: "Tipo de Equipo not found" });
    }
    res.json(tipo);
  }));

  app.delete("/api/tipos-equipo/:id", requireSuperadmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    await storage.deleteTipoEquipo(id);
    res.status(204).send();
  }));

  // Accesorios API
  app.get("/api/accesorios", requireAuth, asyncHandler(async (req, res) => {
    const accesorios = await storage.getAccesorios();
    res.json(accesorios);
  }));

  app.post("/api/accesorios", requireAuth, asyncHandler(async (req, res) => {
    const parsed = insertAccesorioSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const accesorio = await storage.createAccesorio(parsed.data);
    res.status(201).json(accesorio);
  }));

  app.patch("/api/accesorios/:id", requireSuperadmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const accesorio = await storage.updateAccesorio(id, req.body);
    if (!accesorio) {
      return res.status(404).json({ error: "Accesorio not found" });
    }
    res.json(accesorio);
  }));

  app.delete("/api/accesorios/:id", requireSuperadmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    await storage.deleteAccesorio(id);
    res.status(204).send();
  }));

  // Pricing File API
  app.get("/api/pricing-file", requireAuth, asyncHandler(async (req, res) => {
    const entries = await storage.getPricingFileEntries();
    res.json(entries);
  }));

  app.post("/api/pricing-file", requireAuth, asyncHandler(async (req, res) => {
    const parsed = insertPricingFileEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const entry = await storage.createPricingFileEntry(parsed.data);
    res.status(201).json(entry);
  }));

  app.post("/api/pricing-file/batch", requireAuth, asyncHandler(async (req, res) => {
    const { entries } = req.body;
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: "entries must be an array" });
    }
    const validatedEntries = [];
    for (const entry of entries) {
      const parsed = insertPricingFileEntrySchema.safeParse(entry);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      validatedEntries.push(parsed.data);
    }
    const results = await storage.createPricingFileEntries(validatedEntries);
    res.status(201).json(results);
  }));

  // Pricing Requests API
  app.get("/api/pricing-requests", requireAuth, asyncHandler(async (req, res) => {
    const requests = await storage.getPricingRequests();
    res.json(requests);
  }));

  app.get("/api/pricing-requests/:id", requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const request = await storage.getPricingRequest(id);
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }
    res.json(request);
  }));

  app.post("/api/pricing-requests", requireAuth, asyncHandler(async (req, res) => {
    const parsed = insertPricingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    // Auto-calculate fechaEntrega: RFQ = 7 business days, normal = 3 business days
    if (!parsed.data.fechaEntrega) {
      const businessDays = parsed.data.esRFQ ? 7 : 3;
      const dueDate = new Date();
      let added = 0;
      while (added < businessDays) {
        dueDate.setDate(dueDate.getDate() + 1);
        const day = dueDate.getDay();
        if (day !== 0 && day !== 6) added++;
      }
      parsed.data.fechaEntrega = dueDate;
    }

    let request;
    try {
      request = await storage.createPricingRequest(parsed.data);
    } catch (error) {
      console.error("[PricingRequest] database insert failed:", error);
      return res.status(500).json({
        error: "No fue posible guardar la cotización. Intenta nuevamente.",
      });
    }

    // The quote is already persisted at this point. Notification failures must
    // never turn a successful creation into a misleading 500 response.
    void (async () => {
      const users = await storage.getUsers();
      const rolesToNotify = ["pricing", "carrier_manager", "carrier_lead", "carrier_rep"];
      const usersToNotify = users.filter(
        (user) => rolesToNotify.includes(user.role) && user.active,
      );

      const notificationResults = await Promise.allSettled(
        usersToNotify.map((user) =>
          storage.createNotification(
            {
              userId: user.id,
              title: "Nueva Cotización Creada",
              message: `Se ha creado una nueva cotización para ${request.cliente}`,
              type: "new_request",
              requestId: request.id,
            },
            { sendEmail: user.role !== "pricing" },
          ),
        ),
      );

      const failures = notificationResults.filter(
        (result) => result.status === "rejected",
      );
      if (failures.length > 0) {
        console.error(
          `[PricingRequest] ${failures.length}/${notificationResults.length} in-app notifications failed for request ${request.id}`,
        );
      }
    })().catch((error) => {
      console.error(
        `[PricingRequest] notification fan-out failed for request ${request.id}:`,
        error,
      );
    });

    // Slack: one fire-and-forget message per event to the team channel (non-blocking)
    import("./slackService")
      .then(({ dispatchPricingTeamNotification }) =>
        dispatchPricingTeamNotification({
          title: "Nueva Cotización Creada",
          message: `Se ha creado una nueva cotización para ${request.cliente}`,
          type: "new_request",
          requestId: request.id,
          cliente: request.cliente,
          division: request.division,
        })
      )
      .catch((error) => console.error("[Slack] new request notification failed:", error));
    
    res.status(201).json(request);
  }));

  app.patch("/api/pricing-requests/:id", requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    // Omitted RFQ means "keep existing", never reset it on status/route edits.
    if (req.body.esRFQ !== undefined && typeof req.body.esRFQ !== "boolean") {
      return res.status(400).json({ error: "Es RFQ debe ser verdadero o falso" });
    }
    
    const existingRequest = await storage.getPricingRequest(id);
    const previousStatus = existingRequest?.status;
    
    const currentUser = req.session.userId ? await storage.getUser(req.session.userId) : null;
    const userRole = currentUser?.role;
    
    // Only sales roles and superadmin can edit fechaEntrega
    if (req.body.fechaEntrega !== undefined) {
      const canEditFechaEntrega = ["sales_rep", "sales_lead", "sales_manager", "superadmin"].includes(userRole || "");
      if (!canEditFechaEntrega) {
        return res.status(403).json({ error: "No tienes permiso para editar la fecha de entrega" });
      }
    }
    
    // Only sales roles and superadmin can move a quote to "Cotización Enviada"
    if (req.body.status === "cotizacion_enviada" && previousStatus !== "cotizacion_enviada") {
      const canSendToClient = ["sales_rep", "sales_lead", "sales_manager", "superadmin"].includes(userRole || "");
      if (!canSendToClient) {
        return res.status(403).json({ error: "Solo el equipo de ventas puede mover la cotización a Cotización Enviada" });
      }
    }
    
    // Solo ventas y superadmin pueden establecer o cambiar la venta final de una ruta
    if (req.body.rutas !== undefined) {
      try {
        const prevRutas: Array<{ id?: string; ventaFinal?: number }> = JSON.parse(existingRequest?.rutas || "[]");
        const newRutas: Array<{ id?: string; ventaFinal?: number }> = JSON.parse(req.body.rutas || "[]");
        const prevById = new Map(prevRutas.map(r => [r.id, r.ventaFinal]));
        const ventaFinalCambiada = newRutas.some(r => r.ventaFinal !== prevById.get(r.id));
        if (ventaFinalCambiada) {
          const canEditVentaFinal = ["sales_rep", "sales_lead", "sales_manager", "pricing", "superadmin"].includes(userRole || "");
          if (!canEditVentaFinal) {
            return res.status(403).json({ error: "No tienes permiso para cambiar la venta final" });
          }
        }
      } catch {
        // rutas ilegibles: se deja pasar al manejo normal
      }
    }

    // Set fechaEnvio when status changes to "enviado" for the first time
    const updateData = { ...req.body };
    if (req.body.status === "enviado" && previousStatus !== "enviado" && !existingRequest?.fechaEnvio) {
      updateData.fechaEnvio = new Date().toISOString();
    }
    
    // Set fechaCierre when status changes to ganada/perdida/rechazada for the first time
    const closedStatuses = ["ganada", "perdida", "rechazada"];
    if (closedStatuses.includes(req.body.status) && !closedStatuses.includes(previousStatus || "") && !existingRequest?.fechaCierre) {
      updateData.fechaCierre = new Date().toISOString();
    }
    
    const request = await storage.updatePricingRequest(id, updateData);
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }
    
    // Role-based notifications for status changes
    if (req.body.status && previousStatus !== req.body.status) {
      const newStatus = req.body.status;
      const users = await storage.getUsers();
      const activeUsers = users.filter(u => u.active);
      const currentUserId = req.session.userId;
      
      // Define which roles to notify based on status change
      const statusNotificationRules: Record<string, { roles: string[]; title: string; message: string }> = {
        por_revisar: {
          roles: ["carrier_manager", "carrier_lead", "pricing"],
          title: "Nueva Cotización por Revisar",
          message: `La cotización para ${request.cliente} está lista para revisión`,
        },
        cotizando: {
          roles: ["carrier_manager", "carrier_lead", "carrier_rep", "pricing"],
          title: "Cotización en Proceso",
          message: `Se está cotizando la solicitud para ${request.cliente}`,
        },
        enviado: {
          roles: ["sales_rep", "sales_lead", "sales_manager", "pricing"],
          title: "Cotización Lista para Enviar",
          message: `La cotización para ${request.cliente} está lista para que ventas la envíe al cliente`,
        },
        cotizacion_enviada: {
          roles: ["pricing", "carrier_manager", "sales_lead", "sales_manager"],
          title: "Cotización Enviada al Cliente",
          message: `La cotización para ${request.cliente} fue enviada al cliente por ventas`,
        },
        feedback: {
          roles: ["sales_rep", "sales_lead", "sales_manager", "pricing", "carrier_manager"],
          title: "Feedback Recibido",
          message: `Se recibió feedback del cliente para la cotización de ${request.cliente}`,
        },
        ganada: {
          roles: ["sales_rep", "sales_lead", "sales_manager", "pricing", "carrier_manager", "carrier_lead", "carrier_rep"],
          title: "Cotización Ganada",
          message: `La cotización para ${request.cliente} fue ganada`,
        },
        perdida: {
          roles: ["sales_rep", "sales_lead", "sales_manager", "pricing", "carrier_manager"],
          title: "Cotización Perdida",
          message: `La cotización para ${request.cliente} fue perdida`,
        },
        rechazada: {
          roles: ["sales_rep", "sales_lead", "sales_manager", "pricing"],
          title: "Cotización Rechazada",
          message: `La cotización para ${request.cliente} fue rechazada`,
        },
      };
      
      const rule = statusNotificationRules[newStatus];
      if (rule) {
        // Notify users with specified roles
        const usersToNotify = activeUsers.filter(u => 
          rule.roles.includes(u.role) && u.id !== currentUserId
        );
        
        for (const user of usersToNotify) {
          // For sales roles, only notify if they're the assigned sales rep
          if (["sales_rep", "sales_lead", "sales_manager"].includes(user.role)) {
            if (user.role === "sales_rep" && user.name !== request.salesRep) {
              continue; // Skip sales reps not assigned to this quote
            }
          }
          
          // For carrier_rep, only notify if they have offers on this quote
          if (user.role === "carrier_rep") {
            try {
              const rutas = JSON.parse(request.rutas || "[]");
              const hasOffers = rutas.some((ruta: any) => 
                ruta.ofertas?.some((oferta: any) => oferta.carrierRep === user.name)
              );
              if (!hasOffers) continue;
            } catch {
              continue;
            }
          }
          
          await storage.createNotification(
            {
              userId: user.id,
              title: rule.title,
              message: rule.message,
              type: "status_change",
              requestId: id,
            },
            { sendEmail: user.role !== "pricing" },
          );
        }
        
        // Always notify the assigned sales rep (if not the current user)
        const salesRepUser = await storage.getUserBySalesRep(request.salesRep);
        if (salesRepUser && salesRepUser.id !== currentUserId) {
          const alreadyNotified = usersToNotify.some(u => u.id === salesRepUser.id);
          if (!alreadyNotified) {
            await storage.createNotification({
              userId: salesRepUser.id,
              title: rule.title,
              message: rule.message,
              type: "status_change",
              requestId: id,
            });
          }
        }

        // Slack: one fire-and-forget message per status-change event (non-blocking)
        import("./slackService")
          .then(({ dispatchPricingTeamNotification }) =>
            dispatchPricingTeamNotification({
              title: rule.title,
              message: rule.message,
              type: "status_change",
              requestId: id,
              cliente: request.cliente,
              division: request.division,
            })
          )
          .catch((error) => console.error("[Slack] status change notification failed:", error));
      }
    }
    
    // Urgency change notifications
    const newUrgency = typeof req.body.urgencia === "number" ? req.body.urgencia : undefined;
    if (newUrgency !== undefined && existingRequest && newUrgency !== (existingRequest.urgencia || 0)) {
      const previousUrgency = existingRequest.urgencia || 0;
      
      if (newUrgency > previousUrgency && newUrgency >= 2) {
        const urgencyLabels: Record<number, string> = { 1: "Baja (!)", 2: "Media (!!)", 3: "Alta (!!!)" };
        const urgencyLabel = urgencyLabels[newUrgency] || `Nivel ${newUrgency}`;
        
        const users = await storage.getUsers();
        const activeUsers = users.filter(u => u.active);
        const currentUserId = req.session.userId;
        
        const rolesToNotify = ["carrier_manager", "carrier_lead", "pricing", "superadmin"];
        const notifiedUserIds = new Set<string>();
        
        for (const user of activeUsers) {
          if (user.id === currentUserId) continue;
          
          let shouldNotify = rolesToNotify.includes(user.role);
          
          if (!shouldNotify && user.role === "carrier_rep") {
            try {
              const rutas = JSON.parse(existingRequest.rutas || "[]");
              shouldNotify = rutas.some((ruta: any) => 
                ruta.ofertas?.some((oferta: any) => oferta.carrierRep === user.name)
              );
            } catch { /* skip */ }
          }
          
          if (shouldNotify && !notifiedUserIds.has(user.id)) {
            notifiedUserIds.add(user.id);
            await storage.createNotification(
              {
                userId: user.id,
                title: newUrgency >= 3 ? "Cotización Urgente" : "Urgencia Actualizada",
                message: `La cotización de ${request.cliente} fue marcada con urgencia ${urgencyLabel}`,
                type: "status_change",
                requestId: id,
              },
              { sendEmail: user.role !== "pricing" },
            );
          }
        }
        
        // Notify the assigned sales rep separately (consistent with status change pattern)
        const salesRepUser = await storage.getUserBySalesRep(request.salesRep);
        if (salesRepUser && salesRepUser.id !== currentUserId && !notifiedUserIds.has(salesRepUser.id)) {
          await storage.createNotification({
            userId: salesRepUser.id,
            title: newUrgency >= 3 ? "Cotización Urgente" : "Urgencia Actualizada",
            message: `Tu cotización de ${request.cliente} fue marcada con urgencia ${urgencyLabel}`,
            type: "status_change",
            requestId: id,
          });
        }

        // Slack: one fire-and-forget message per urgency-change event (non-blocking)
        import("./slackService")
          .then(({ dispatchPricingTeamNotification }) =>
            dispatchPricingTeamNotification({
              title: newUrgency >= 3 ? "Cotización Urgente" : "Urgencia Actualizada",
              message: `La cotización de ${request.cliente} fue marcada con urgencia ${urgencyLabel}`,
              type: "status_change",
              requestId: id,
              cliente: request.cliente,
              division: request.division,
            })
          )
          .catch((error) => console.error("[Slack] urgency notification failed:", error));
      }
    }
    
    res.json(request);
  }));

  // Endpoint to create notifications for comments and @mentions
  app.post("/api/pricing-requests/:id/comment-notification", requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { commentId, commentText } = req.body;
    
    if (
      typeof commentId !== "string" ||
      !commentId.trim() ||
      typeof commentText !== "string" ||
      !commentText.trim()
    ) {
      return res.status(400).json({ error: "commentId and commentText are required" });
    }
    
    const request = await storage.getPricingRequest(id);
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }
    
    const currentUserId = req.session.userId;
    const users = await storage.getUsers();
    const activeUsers = users.filter(u => u.active);
    const currentUser = activeUsers.find((user) => user.id === currentUserId);
    if (!currentUser) {
      return res.status(401).json({ error: "Usuario no autenticado o inactivo" });
    }
    const commentAuthor = currentUser.name || currentUser.username || "Usuario";

    // The comment must already exist on the quote. This prevents an
    // authenticated caller from using this endpoint to forge/spam outbound
    // Slack and email messages that were never saved in the platform.
    try {
      const savedComments = JSON.parse(request.comentarios || "[]");
      const savedCommentExists =
        Array.isArray(savedComments) &&
        savedComments.some(
          (comment: any) =>
            comment?.id === commentId &&
            comment?.texto === commentText &&
            comment?.usuario === commentAuthor,
        );
      if (!savedCommentExists) {
        return res.status(409).json({
          error: "El comentario debe guardarse antes de enviar notificaciones",
        });
      }
    } catch {
      return res.status(409).json({
        error: "No fue posible validar el comentario guardado",
      });
    }

    const claimed = await storage.claimNotificationDispatch(
      `pricing-comment:${id}:${commentId}`,
    );
    if (!claimed) {
      return res.json({
        success: true,
        notifiedCount: 0,
        duplicate: true,
      });
    }

    const notifiedUserIds = new Set<string>();
    const slackMentionTargets: Array<{ name: string; email: string }> = [];

    // Mentions are derived server-side from the saved comment and active user
    // directory. The client-provided mention list is never trusted.
    const detectedMentions: Array<{
      user: (typeof activeUsers)[number];
      token: string;
    }> = [];
    const seenMentionedUserIds = new Set<string>();
    const mentionMatches = (token: string) => {
      const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(
        `@${escapedToken}(?=[\\s,;.!?:\"'\\)\\]\\}]|$)`,
        "i",
      ).test(commentText);
    };
    for (const user of activeUsers) {
      const token = mentionMatches(user.name)
        ? user.name
        : user.username && mentionMatches(user.username)
          ? user.username
          : null;
      if (token && !seenMentionedUserIds.has(user.id)) {
        seenMentionedUserIds.add(user.id);
        detectedMentions.push({ user, token });
      }
    }

    // Handle @mentions first - they get a special notification
    if (detectedMentions.length > 0) {
      for (const { user: mentionedUser, token } of detectedMentions) {
        if (mentionedUser?.email) {
          const email = mentionedUser.email.trim();
          if (
            email &&
            !slackMentionTargets.some(
              (target) => target.email.toLowerCase() === email.toLowerCase(),
            )
          ) {
            slackMentionTargets.push({ name: token, email });
          }
        }

        if (mentionedUser && mentionedUser.id !== currentUserId) {
          await storage.createNotification(
            {
              userId: mentionedUser.id,
              title: "Te mencionaron en un comentario",
              message: `${commentAuthor} te mencionó en la cotización de ${request.cliente}: "${commentText.substring(0, 80)}${commentText.length > 80 ? '...' : ''}"`,
              type: "comment",
              requestId: id,
            },
            { sendEmail: mentionedUser.role !== "pricing" },
          );
          notifiedUserIds.add(mentionedUser.id);
        }
      }
    }
    
    // Notify the sales rep assigned to the quote (if not the commenter and not already mentioned)
    const salesRepUser = await storage.getUserBySalesRep(request.salesRep);
    if (salesRepUser && salesRepUser.id !== currentUserId && !notifiedUserIds.has(salesRepUser.id)) {
      await storage.createNotification(
        {
          userId: salesRepUser.id,
          title: "Nuevo comentario en tu cotización",
          message: `${commentAuthor} comentó en la cotización de ${request.cliente}: "${commentText.substring(0, 60)}${commentText.length > 60 ? '...' : ''}"`,
          type: "comment",
          requestId: id,
        },
        { sendEmail: salesRepUser.role !== "pricing" },
      );
      notifiedUserIds.add(salesRepUser.id);
    }
    
    // Notify carrier reps who have offers on this quote (if not already notified)
    try {
      const rutas = JSON.parse(request.rutas || "[]");
      const carrierRepsWithOffers = new Set<string>();
      for (const ruta of rutas) {
        if (ruta.ofertas && Array.isArray(ruta.ofertas)) {
          for (const oferta of ruta.ofertas) {
            if (oferta.carrierRep) {
              carrierRepsWithOffers.add(oferta.carrierRep);
            }
          }
        }
      }
      
      for (const carrierRepName of Array.from(carrierRepsWithOffers)) {
        const carrierUser = activeUsers.find(u => u.name === carrierRepName);
        if (carrierUser && carrierUser.id !== currentUserId && !notifiedUserIds.has(carrierUser.id)) {
          await storage.createNotification(
            {
              userId: carrierUser.id,
              title: "Nuevo comentario en cotización",
              message: `${commentAuthor} comentó en la cotización de ${request.cliente}`,
              type: "comment",
              requestId: id,
            },
            { sendEmail: carrierUser.role !== "pricing" },
          );
          notifiedUserIds.add(carrierUser.id);
        }
      }
    } catch {
      // Ignore parsing errors
    }

    // Slack: one fire-and-forget message per comment event (non-blocking)
    {
      const hasMentions = detectedMentions.length > 0;
      const commentPreview = `${commentText.substring(0, 120)}${commentText.length > 120 ? "..." : ""}`;
      const missingMentionTokens = slackMentionTargets
        .filter((target) => {
          const escapedName = target.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return !new RegExp(
            `@${escapedName}(?=[\\s,;.!?:\"'\\)\\]\\}]|$)`,
            "i",
          ).test(commentPreview);
        })
        .map((target) => `@${target.name}`);
      const mentionSuffix =
        missingMentionTokens.length > 0
          ? `\nMenciones: ${missingMentionTokens.join(" ")}`
          : "";
      const slackMessage = `${commentAuthor} comentó en la cotización de ${request.cliente}: "${commentPreview}"${mentionSuffix}`;
      import("./slackService")
        .then(({ dispatchPricingTeamNotification }) =>
          dispatchPricingTeamNotification({
            title: "Nuevo comentario en cotización",
            message: slackMessage,
            type: hasMentions ? "mention" : "comment",
            requestId: id,
            cliente: request.cliente,
            division: request.division,
            mentions: slackMentionTargets,
          })
        )
        .catch((error) => console.error("[Slack] comment notification failed:", error));
    }
    
    res.json({ success: true, notifiedCount: notifiedUserIds.size });
  }));

  app.delete("/api/pricing-requests/:id", requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userRole = req.session.userRole;
    const userId = req.session.userId;
    
    try {
      // Check permissions: sales_rep, sales_lead, or superadmin
      const allowedRoles = ["sales_rep", "sales_lead", "superadmin"];
      if (!userRole || !allowedRoles.includes(userRole)) {
        return res.status(403).json({ error: "No tienes permisos para eliminar cotizaciones" });
      }
      
      const existingRequest = await storage.getPricingRequest(id);
      if (!existingRequest) {
        return res.status(404).json({ error: "Request not found" });
      }
      
      // Additional check: sales_rep can only delete their own quotes
      if (userRole === "sales_rep") {
        const user = await storage.getUser(userId!);
        if (user && existingRequest.salesRep !== user.name) {
          return res.status(403).json({ error: "Solo puedes eliminar tus propias cotizaciones" });
        }
      }
      
      await storage.deletePricingRequest(id);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting pricing request:', error);
      res.status(500).json({ error: "Error al eliminar cotización", details: error instanceof Error ? error.message : 'Unknown error' });
    }
  }));

  // Carrier Offers API
  app.get("/api/carrier-offers", requireAuth, asyncHandler(async (req, res) => {
    const offers = await storage.getAllCarrierOffers();
    res.json(offers);
  }));

  app.get("/api/pricing-requests/:id/offers", requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const offers = await storage.getCarrierOffersByRequest(id);
    res.json(offers);
  }));

  app.post("/api/pricing-requests/:id/offers", requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const parsed = insertCarrierOfferSchema.safeParse({ ...req.body, requestId: id });
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const offer = await storage.createCarrierOffer(parsed.data);
    res.status(201).json(offer);
  }));

  app.post("/api/pricing-requests/:id/route-offer", requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rutaId, offer, historialEntry } = req.body;

    if (!rutaId || !offer || !offer.carrier || !offer.costo) {
      return res.status(400).json({ error: "rutaId, offer.carrier and offer.costo are required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        "SELECT rutas, historial FROM pricing_requests WHERE id = $1 FOR UPDATE",
        [id]
      );

      if (rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Request not found" });
      }

      let rutas: any[] = [];
      try {
        rutas = typeof rows[0].rutas === "string" ? JSON.parse(rows[0].rutas) : (rows[0].rutas || []);
      } catch {
        rutas = [];
      }

      const rutaIndex = rutas.findIndex((r: any) => r.id === rutaId);
      if (rutaIndex === -1) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Route not found" });
      }

      if (!rutas[rutaIndex].ofertas) {
        rutas[rutaIndex].ofertas = [];
      }
      rutas[rutaIndex].ofertas.push(offer);

      let historial: any[] = [];
      try {
        historial = typeof rows[0].historial === "string" ? JSON.parse(rows[0].historial) : (rows[0].historial || []);
      } catch {
        historial = [];
      }

      if (historialEntry) {
        historial.unshift(historialEntry);
      }

      const { rows: updated } = await client.query(
        "UPDATE pricing_requests SET rutas = $1, historial = $2 WHERE id = $3 RETURNING *",
        [JSON.stringify(rutas), JSON.stringify(historial), id]
      );

      await client.query("COMMIT");
      res.json(updated[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("[Route Offer API] Error:", error);
      res.status(500).json({ error: "Error al agregar oferta" });
    } finally {
      client.release();
    }
  }));

  app.patch("/api/pricing-requests/:id/route-offer", requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rutaId, offerId, offer, historialEntry } = req.body;

    if (!rutaId || !offerId || !offer) {
      return res.status(400).json({ error: "rutaId, offerId and offer are required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        "SELECT rutas, historial FROM pricing_requests WHERE id = $1 FOR UPDATE",
        [id]
      );

      if (rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Request not found" });
      }

      let rutas: any[] = [];
      try {
        rutas = typeof rows[0].rutas === "string" ? JSON.parse(rows[0].rutas) : (rows[0].rutas || []);
      } catch {
        rutas = [];
      }

      const rutaIndex = rutas.findIndex((r: any) => r.id === rutaId);
      if (rutaIndex === -1) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Route not found" });
      }

      const ofertas = rutas[rutaIndex].ofertas || [];
      const offerIndex = ofertas.findIndex((o: any) => o.id === offerId);
      if (offerIndex === -1) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Offer not found" });
      }

      ofertas[offerIndex] = {
        ...ofertas[offerIndex],
        ...offer,
        id: offerId,
      };
      rutas[rutaIndex].ofertas = ofertas;

      let historial: any[] = [];
      try {
        historial = typeof rows[0].historial === "string" ? JSON.parse(rows[0].historial) : (rows[0].historial || []);
      } catch {
        historial = [];
      }

      if (historialEntry) {
        historial.unshift(historialEntry);
      }

      const { rows: updated } = await client.query(
        "UPDATE pricing_requests SET rutas = $1, historial = $2 WHERE id = $3 RETURNING *",
        [JSON.stringify(rutas), JSON.stringify(historial), id]
      );

      await client.query("COMMIT");
      res.json(updated[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("[Route Offer PATCH] Error:", error);
      res.status(500).json({ error: "Error al actualizar oferta" });
    } finally {
      client.release();
    }
  }));

  app.delete("/api/pricing-requests/:id/route-offer", requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rutaId, offerId, historialEntry } = req.body;

    if (!rutaId || !offerId) {
      return res.status(400).json({ error: "rutaId and offerId are required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        "SELECT rutas, historial FROM pricing_requests WHERE id = $1 FOR UPDATE",
        [id]
      );

      if (rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Request not found" });
      }

      let rutas: any[] = [];
      try {
        rutas = typeof rows[0].rutas === "string" ? JSON.parse(rows[0].rutas) : (rows[0].rutas || []);
      } catch {
        rutas = [];
      }

      const rutaIndex = rutas.findIndex((r: any) => r.id === rutaId);
      if (rutaIndex === -1) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Route not found" });
      }

      const ofertas = rutas[rutaIndex].ofertas || [];
      const offerIndex = ofertas.findIndex((o: any) => o.id === offerId);
      if (offerIndex === -1) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Offer not found" });
      }

      ofertas.splice(offerIndex, 1);
      rutas[rutaIndex].ofertas = ofertas;

      let historial: any[] = [];
      try {
        historial = typeof rows[0].historial === "string" ? JSON.parse(rows[0].historial) : (rows[0].historial || []);
      } catch {
        historial = [];
      }

      if (historialEntry) {
        historial.unshift(historialEntry);
      }

      const { rows: updated } = await client.query(
        "UPDATE pricing_requests SET rutas = $1, historial = $2 WHERE id = $3 RETURNING *",
        [JSON.stringify(rutas), JSON.stringify(historial), id]
      );

      await client.query("COMMIT");
      res.json(updated[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("[Route Offer DELETE] Error:", error);
      res.status(500).json({ error: "Error al eliminar oferta" });
    } finally {
      client.release();
    }
  }));

  app.post("/api/pricing-requests/:id/select-offer", requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rutaId, offerId, historialEntry } = req.body;

    if (!rutaId || !offerId) {
      return res.status(400).json({ error: "rutaId and offerId are required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        "SELECT rutas, historial FROM pricing_requests WHERE id = $1 FOR UPDATE",
        [id]
      );

      if (rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Request not found" });
      }

      let rutas: any[] = [];
      try {
        rutas = typeof rows[0].rutas === "string" ? JSON.parse(rows[0].rutas) : (rows[0].rutas || []);
      } catch {
        rutas = [];
      }

      const rutaIndex = rutas.findIndex((r: any) => r.id === rutaId);
      if (rutaIndex === -1) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Route not found" });
      }

      const ofertas = rutas[rutaIndex].ofertas || [];
      rutas[rutaIndex].ofertas = ofertas.map((o: any) => ({
        ...o,
        seleccionado: o.id === offerId ? !o.seleccionado : o.seleccionado,
      }));

      const selectedOffers = rutas[rutaIndex].ofertas.filter((o: any) => o.seleccionado);
      if (selectedOffers.length > 0) {
        const totalUnidades = selectedOffers.reduce((sum: number, o: any) => sum + (o.disponibilidad || 1), 0);
        const weightedCosto = selectedOffers.reduce((sum: number, o: any) => sum + (o.costo * (o.disponibilidad || 1)), 0);
        const promedioPonderado = Math.round(weightedCosto / totalUnidades);
        rutas[rutaIndex].costoEsperado = promedioPonderado;
        rutas[rutaIndex].ventaSugerida = Math.round(promedioPonderado / 0.9);
      } else {
        rutas[rutaIndex].costoEsperado = 0;
        rutas[rutaIndex].ventaSugerida = 0;
      }

      let historial: any[] = [];
      try {
        historial = typeof rows[0].historial === "string" ? JSON.parse(rows[0].historial) : (rows[0].historial || []);
      } catch {
        historial = [];
      }

      if (historialEntry) {
        historial.unshift(historialEntry);
      }

      const { rows: updated } = await client.query(
        "UPDATE pricing_requests SET rutas = $1, historial = $2 WHERE id = $3 RETURNING *",
        [JSON.stringify(rutas), JSON.stringify(historial), id]
      );

      await client.query("COMMIT");
      res.json(updated[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("[Select Offer API] Error:", error);
      res.status(500).json({ error: "Error al seleccionar oferta" });
    } finally {
      client.release();
    }
  }));

  // Dashboard Stats API
  app.get("/api/dashboard/stats", requireAuth, asyncHandler(async (req, res) => {
    const requests = await storage.getPricingRequests();
    
    const statusCounts = {
      pendiente: 0,
      por_revisar: 0,
      cotizando: 0,
      enviado: 0,
      cotizacion_enviada: 0,
      feedback: 0,
      ganada: 0,
      perdida: 0,
      rechazada: 0,
    };
    
    for (const request of requests) {
      const status = request.status as keyof typeof statusCounts;
      if (statusCounts[status] !== undefined) {
        statusCounts[status]++;
      }
    }
    
    res.json({
      total: requests.length,
      activas: statusCounts.pendiente + statusCounts.por_revisar + statusCounts.cotizando + statusCounts.enviado + statusCounts.cotizacion_enviada + statusCounts.feedback,
      ganadas: statusCounts.ganada,
      perdidas: statusCounts.perdida,
      rechazadas: statusCounts.rechazada,
      porStatus: statusCounts,
    });
  }));

  // Notifications API
  app.get("/api/notifications/:userId", requireAuth, asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const notifications = await storage.getNotificationsByUser(userId);
    res.json(notifications.sort((a, b) => 
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    ));
  }));

  app.get("/api/notifications/:userId/count", requireAuth, asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const count = await storage.getUnreadNotificationCount(userId);
    res.json({ count });
  }));

  app.post("/api/notifications", requireAuth, asyncHandler(async (req, res) => {
    const parsed = insertNotificationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const notification = await storage.createNotification(parsed.data);
    res.status(201).json(notification);
  }));

  app.patch("/api/notifications/:id/read", requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.params;
    await storage.markNotificationAsRead(id);
    res.status(204).send();
  }));

  app.post("/api/notifications/:userId/read-all", requireAuth, asyncHandler(async (req, res) => {
    const { userId } = req.params;
    await storage.markAllNotificationsAsRead(userId);
    res.status(204).send();
  }));

  // Global Search API
  // Seed users from CSV data (one-time use, superadmin only)
  app.post("/api/seed-users", requireSuperadmin, asyncHandler(async (req, res) => {
    const usersData = [
      { username: "daniel_chavez", email: "daniel.chavez@vaxsolutions.mx", name: "Daniel Chavez", role: "sales_rep", password: "danielvax" },
      { username: "jessica_hernandez", email: "jessica.hernandez@vaxsolutions.mx", name: "Jessica Hernández", role: "sales_rep", password: "jessicavax" },
      { username: "jesus_velazquez", email: "jesus.velazquez@vaxsolutions.mx", name: "Jesus Velazquez", role: "sales_rep", password: "jesusvax" },
      { username: "juan_macias", email: "juan.macias@vaxsolutions.mx", name: "Juan Macías", role: "sales_rep", password: "maciasvax" },
      { username: "juan_rojas", email: "juan.rojas@vaxsolutions.mx", name: "Juan Rojas", role: "sales_rep", password: "rojasvax" },
      { username: "thalia_orendain", email: "thalia.orendain@vaxsolutions.mx", name: "Thalia Orendain", role: "sales_rep", password: "thaliavax" },
      { username: "luis_ortiz", email: "luis.ortiz@vaxsolutions.mx", name: "Luis Ortiz", role: "sales_lead", password: "luisvax" },
      { username: "marco_martinez", email: "marco.martinez@vaxsolutions.mx", name: "Marco Martínez", role: "sales_lead", password: "marcovax" },
      { username: "blanca_rodriguez", email: "blanca.rodriguez@vaxsolutions.mx", name: "Blanca Rodríguez", role: "sales_lead", password: "blancavax" },
      { username: "eduardo_chaim", email: "eduardo.chaim@vaxsolutions.mx", name: "Eduardo Chaim", role: "sales_lead", password: "chaimvax" },
      { username: "cinthia_solorio", email: "cinthia.solorio@vaxsolutions.mx", name: "Cinthia Solorio", role: "pricing", password: "cinthiavax" },
      { username: "eduardo_varela", email: "eduardo.varela@vaxsolutions.mx", name: "Eduardo Varela", role: "carrier_manager", password: "varelavax" },
      { username: "montserrat_najera", email: "montserrat.najera@vaxsolutions.mx", name: "Montse Najera", role: "carrier_lead", password: "montsevax" },
      { username: "paula_aya", email: "paula.aya@vaxsolutions.mx", name: "Paula Aya", role: "carrier_lead", password: "paulavax" },
      { username: "andrea_vazquez", email: "andrea.vazquez@vaxsolutions.mx", name: "Andrea Vazquez", role: "carrier_rep", password: "andreavax" },
      { username: "ulises_meneses", email: "ulises.meneses@vaxsolutions.mx", name: "Ulises Meneses", role: "carrier_rep", password: "ulisesvax" },
      { username: "juan_inzunza", email: "juan.inzunza@vaxsolutions.mx", name: "Juan Pablo Inzunza", role: "carrier_rep", password: "inzunzavax" },
    ];

    const results: { created: string[]; skipped: string[]; errors: string[] } = {
      created: [],
      skipped: [],
      errors: [],
    };

    for (const userData of usersData) {
      try {
        // Check if user already exists by username or email
        const existingByUsername = await storage.getUserByUsername(userData.username);
        const existingByEmail = await storage.getUserByEmail(userData.email);
        
        if (existingByUsername || existingByEmail) {
          // Update email if user exists but doesn't have email set
          if (existingByUsername && !existingByUsername.email) {
            await storage.updateUser(existingByUsername.id, { email: userData.email });
            results.skipped.push(`${userData.username} (updated email)`);
          } else {
            results.skipped.push(userData.username);
          }
          continue;
        }

        const hashedPassword = await bcrypt.hash(userData.password, SALT_ROUNDS);
        await storage.createUser({
          username: userData.username,
          email: userData.email,
          name: userData.name,
          role: userData.role,
          password: hashedPassword,
          plainPassword: null,
          active: true,
        });
        results.created.push(userData.username);
      } catch (error) {
        results.errors.push(`${userData.username}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    res.json(results);
  }));

  app.post("/api/reset-all-passwords", requireSuperadmin, asyncHandler(async (req, res) => {
    const defaultPasswords: Record<string, string> = {
      admin: "adminvax",
      daniel_chavez: "danielvax",
      jessica_hernandez: "jessicavax",
      jesus_velazquez: "jesusvax",
      juan_macias: "maciasvax",
      juan_rojas: "rojasvax",
      thalia_orendain: "thaliavax",
      luis_ortiz: "luisvax",
      marco_martinez: "marcovax",
      blanca_rodriguez: "blancavax",
      eduardo_chaim: "chaimvax",
      cinthia_solorio: "cinthiavax",
      eduardo_varela: "varelavax",
      montserrat_najera: "montsevax",
      paula_aya: "paulavax",
      andrea_vazquez: "andreavax",
      ulises_meneses: "ulisesvax",
      juan_inzunza: "inzunzavax",
      jpjpjp: "jpvax",
      diego_nunez: "diegovax",
      hector_ibarra: "hectorvax",
      sergio_nava: "sergiovax",
    };

    const users = await storage.getUsers();
    const results: string[] = [];

    for (const user of users) {
      if (!user.plainPassword) {
        const defaultPwd = defaultPasswords[user.username];
        if (defaultPwd) {
          const hashed = await bcrypt.hash(defaultPwd, SALT_ROUNDS);
          await storage.updateUser(user.id, { password: hashed, plainPassword: null });
          results.push(`${user.username}: reset to default`);
        }
      }
    }

    res.json({ updated: results.length, details: results });
  }));

  app.get("/api/search", requireAuth, asyncHandler(async (req, res) => {
    const query = (req.query.q as string || "").toLowerCase().trim();
    if (!query) {
      return res.json([]);
    }
    
    const requests = await storage.getPricingRequests();
    const results = requests.filter(r => 
      r.id.toLowerCase().includes(query) ||
      r.cliente.toLowerCase().includes(query) ||
      (r.prospecto && r.prospecto.toLowerCase().includes(query)) ||
      r.salesRep.toLowerCase().includes(query) ||
      (r.division && r.division.toLowerCase().includes(query))
    ).slice(0, 10).map(r => ({
      id: r.id,
      type: "request",
      title: r.cliente || r.prospecto,
      subtitle: `#${r.id} - ${r.salesRep}`,
      status: r.status,
    }));
    
    res.json(results);
  }));

  app.get("/api/google-sheets/clientes", requireAuth, asyncHandler(async (req, res) => {
    try {
      const clientes = await getClientesFromSheet();
      res.json(clientes);
    } catch (error) {
      console.error('Error fetching clientes from Google Sheets:', error);
      res.status(500).json({ 
        error: 'Error al obtener clientes de Google Sheets',
        details: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }));

  app.post("/api/google-sheets/sync", requireSuperadmin, asyncHandler(async (req, res) => {
    try {
      const result = await syncClientesFromSheet();
      res.json({ 
        message: `Sincronización completada: ${result.added} nuevos, ${result.reactivated} reactivados. ${result.total} únicos en Sheet, ${result.totalInDb} en BD.`,
        ...result 
      });
    } catch (error) {
      console.error('Error syncing clientes from Google Sheets:', error);
      res.status(500).json({ 
        error: 'Error al sincronizar clientes',
        details: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }));

  // Admin Statistics API
  app.get("/api/admin/stats", requireManagerOrAbove, asyncHandler(async (req, res) => {
    try {
      const allRequests = await storage.getPricingRequests();
      const users = await storage.getUsers();

      const { from, to } = req.query as { from?: string; to?: string };
      const quoteType = req.query.quoteType ?? "all";
      if (quoteType !== "all" && quoteType !== "rfq" && quoteType !== "non-rfq") {
        return res.status(400).json({ error: "Tipo de cotización inválido" });
      }
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      if ((from && !dateRe.test(from)) || (to && !dateRe.test(to))) {
        return res.status(400).json({ error: "Formato de fecha inválido (YYYY-MM-DD)" });
      }
      // Interpret dates in Mexico City time (UTC-6, no DST since 2022)
      const fromDate = from ? new Date(`${from}T00:00:00-06:00`) : null;
      const toDate = to ? new Date(`${to}T23:59:59.999-06:00`) : null;
      if ((fromDate && isNaN(fromDate.getTime())) || (toDate && isNaN(toDate.getTime()))) {
        return res.status(400).json({ error: "Fecha inválida" });
      }
      if (fromDate && toDate && fromDate > toDate) {
        return res.status(400).json({ error: "La fecha 'desde' no puede ser mayor que 'hasta'" });
      }

      const requests = allRequests.filter(r => {
        if (!fromDate && !toDate) return true;
        const created = r.createdAt ? new Date(r.createdAt) : null;
        if (!created) return false;
        if (fromDate && created < fromDate) return false;
        if (toDate && created > toDate) return false;
        return true;
      });
      
      interface HistorialEntry {
        fecha: string;
        accion: string;
        usuario: string;
      }
      
      interface ClienteBreakdown {
        nombre: string;
        tipo: "cliente" | "prospecto";
        quotesCreated: number;
        quotesWon: number;
        quotesLost: number;
      }

      interface UserStats {
        userId: string;
        userName: string;
        role: string;
        email: string;
        quotesCreated: number;
        quotesWon: number;
        quotesLost: number;
        quotesQuoted: number;
        statusChanges: number;
        actions: HistorialEntry[];
        clientes: ClienteBreakdown[];
      }
      
      const userStatsMap = new Map<string, UserStats>();
      
      // Initialize stats for all users
      for (const user of users) {
        userStatsMap.set(user.name, {
          userId: user.id,
          userName: user.name,
          role: user.role,
          email: user.email || "",
          quotesCreated: 0,
          quotesWon: 0,
          quotesLost: 0,
          quotesQuoted: 0,
          statusChanges: 0,
          actions: [],
          clientes: [],
        });
      }
      
      // Process all requests
      for (const request of requests) {
        // Count quotes by salesRep (only from current status, no double counting)
        const salesRepStats = userStatsMap.get(request.salesRep);
        if (salesRepStats) {
          salesRepStats.quotesCreated++;
          // Count won/lost only from current status
          if (request.status === "ganada") {
            salesRepStats.quotesWon++;
          } else if (request.status === "perdida") {
            salesRepStats.quotesLost++;
          }

          // Breakdown by cliente/prospecto
          const isProspecto = !!(request.prospecto && request.prospecto.trim().length > 0);
          const nombre = isProspecto ? request.prospecto!.trim() : (request.cliente?.trim() || "Sin cliente");
          const tipo = isProspecto ? "prospecto" as const : "cliente" as const;
          let breakdown = salesRepStats.clientes.find(c => c.nombre === nombre && c.tipo === tipo);
          if (!breakdown) {
            breakdown = { nombre, tipo, quotesCreated: 0, quotesWon: 0, quotesLost: 0 };
            salesRepStats.clientes.push(breakdown);
          }
          breakdown.quotesCreated++;
          if (request.status === "ganada") breakdown.quotesWon++;
          else if (request.status === "perdida") breakdown.quotesLost++;
        }
        
        // Parse historial to count status changes and actions (no duplicates with above)
        try {
          const historial: HistorialEntry[] = JSON.parse(request.historial || "[]");
          for (const entry of historial) {
            const userStats = userStatsMap.get(entry.usuario);
            if (userStats) {
              userStats.statusChanges++;
              userStats.actions.push(entry);
              
              // Count quotes moved to "cotizando" status
              if (entry.accion.toLowerCase().includes("cotizando")) {
                userStats.quotesQuoted++;
              }
              // Note: quotesWon/quotesLost are counted from current status only, not historial
              // to avoid double counting
            }
          }
        } catch {
          // Skip if historial is not valid JSON
        }
      }
      
      // Convert to array and sort by activity
      const userStats = Array.from(userStatsMap.values())
        .map(u => ({ ...u, clientes: [...u.clientes].sort((a, b) => b.quotesCreated - a.quotesCreated) }))
        .filter(u => u.quotesCreated > 0 || u.statusChanges > 0)
        .sort((a, b) => (b.quotesCreated + b.statusChanges) - (a.quotesCreated + a.statusChanges));
      
      // Role statistics
      const roleStats: Record<string, { users: number; quotesCreated: number; quotesWon: number; quotesLost: number; statusChanges: number }> = {};
      for (const stats of Array.from(userStatsMap.values())) {
        if (!roleStats[stats.role]) {
          roleStats[stats.role] = { users: 0, quotesCreated: 0, quotesWon: 0, quotesLost: 0, statusChanges: 0 };
        }
        roleStats[stats.role].users++;
        roleStats[stats.role].quotesCreated += stats.quotesCreated;
        roleStats[stats.role].quotesWon += stats.quotesWon;
        roleStats[stats.role].quotesLost += stats.quotesLost;
        roleStats[stats.role].statusChanges += stats.statusChanges;
      }
      
      // Overall stats
      const overallStats = {
        totalRequests: requests.length,
        totalUsers: users.length,
        totalWon: requests.filter(r => r.status === "ganada").length,
        totalLost: requests.filter(r => r.status === "perdida").length,
        totalPending: requests.filter(r => r.status === "pendiente").length,
        totalQuoting: requests.filter(r => r.status === "cotizando").length,
        totalSent: requests.filter(r => r.status === "enviado").length,
        totalFeedback: requests.filter(r => r.status === "feedback").length,
      };
      
      res.json({
        overall: overallStats,
        timing: buildQuoteTiming(requests, quoteType),
        byUser: userStats,
        byRole: roleStats,
      });
    } catch (error) {
      console.error('Error fetching admin stats:', error);
      res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
  }));

  // Email test endpoint (superadmin only)
  app.get("/api/admin/test-email", requireSuperadmin, asyncHandler(async (req, res) => {
    try {
      const { testEmailConnection } = await import('./emailService');
      const isConnected = await testEmailConnection();
      res.json({ 
        connected: isConnected,
        message: isConnected ? 'Conexión con Resend exitosa' : 'Error de conexión con Resend'
      });
    } catch (error) {
      console.error('Error testing email connection:', error);
      res.status(500).json({ 
        connected: false, 
        message: 'Error al probar conexión de email',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }));

  // Slack test endpoint (superadmin only)
  app.get("/api/admin/test-slack", requireSuperadmin, asyncHandler(async (req, res) => {
    try {
      const { testSlackConnection } = await import('./slackService');
      const result = await testSlackConnection();
      res.json({
        connected: result.ok,
        channelFound: result.channelFound,
        canPost: result.canPost,
        message: !result.ok
          ? 'Error de conexión con Slack'
          : !result.channelFound
          ? 'Conectado a Slack, pero no se encontró el canal #PricingHub.'
          : !result.canPost
          ? 'Conectado a Slack y canal #PricingHub encontrado, pero el bot no es miembro del canal. Invítalo con /invite @TuApp en #PricingHub para poder enviar mensajes.'
          : 'Conexión con Slack exitosa: el bot puede publicar en #PricingHub',
      });
    } catch (error) {
      console.error('Error testing Slack connection:', error);
      res.status(500).json({
        connected: false,
        channelFound: false,
        message: 'Error al probar conexión de Slack',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }));

  return httpServer;
}
