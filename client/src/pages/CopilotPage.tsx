import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  Search,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

// ---------- Tipos (contrato del backend; nunca se envían montos al servidor) ----------

interface ExplanationSummary {
  id: string;
  quoteId: string;
  rutaId: string;
  modelKey: string;
  modelLabel: string;
  origen: string;
  destino: string;
  costoExplicado: number | null;
  moneda: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  solicitante: string | null;
  hasComments?: boolean;
}

interface MoneyRange {
  low?: number | null;
  usual?: number | null;
  high?: number | null;
}

interface MarginSummary {
  usual_amount?: number | null;
  usual_percentage?: number | null;
  negative_record_count?: number | null;
}

const MODEL_LABELS: Record<string, string> = {
  historica: "Estimación histórica",
  proteccion: "Estimación con protección",
  ajustada: "Estimación ajustada por ruta",
  comparacion: "Comparación con rutas similares",
};

const fmtMoney = (v: number | null | undefined, moneda = "MXN") =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? null
    : `${new Intl.NumberFormat("es-MX", { style: "currency", currency: moneda === "USD" ? "USD" : "MXN", maximumFractionDigits: 0 }).format(Number(v))} ${moneda}`;

const fmtFecha = (iso: string | null | undefined) => {
  if (!iso) return null;
  try {
    return format(new Date(iso), "d MMM yyyy, HH:mm 'UTC'xxx", { locale: es });
  } catch {
    return iso;
  }
};

function StatusBadge({ status }: { status: string | undefined }) {
  if (status === "grounded" || status === "completed")
    return <Badge variant="default" data-testid="badge-estado">Con evidencia</Badge>;
  if (status === "limited_evidence")
    return <Badge variant="secondary" data-testid="badge-estado">Evidencia limitada</Badge>;
  if (status === "generating")
    return <Badge variant="secondary" data-testid="badge-estado">Generando…</Badge>;
  if (status === "failed" || status === "unavailable")
    return <Badge variant="outline" data-testid="badge-estado">No disponible</Badge>;
  return <Badge variant="outline" data-testid="badge-estado">{status || "—"}</Badge>;
}

// Fila etiqueta/valor que se omite por completo cuando no hay dato (no se
// muestran campos vacíos ni se inventa información).
function Dato({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function rangoUsual(r: MoneyRange | null | undefined, moneda: string) {
  if (!r) return null;
  return fmtMoney(r.usual ?? null, moneda);
}

function margenTexto(m: MarginSummary | null | undefined, moneda: string) {
  if (!m) return null;
  const partes: string[] = [];
  const monto = fmtMoney(m.usual_amount ?? null, moneda);
  if (monto) partes.push(monto);
  if (m.usual_percentage !== null && m.usual_percentage !== undefined)
    partes.push(`${Number(m.usual_percentage).toFixed(1)}%`);
  return partes.length ? partes.join(" · ") : null;
}

// ---------- Detalle ----------

function DetalleExplicacion({
  meta,
  copilot,
  reused,
  errorMensaje,
  onVolverLista,
}: {
  meta: ExplanationSummary | null;
  copilot: any;
  reused: boolean | null;
  errorMensaje?: string | null;
  onVolverLista: () => void;
}) {
  const [, navigate] = useLocation();
  const [verAuditoria, setVerAuditoria] = useState(false);
  const moneda = meta?.moneda || "MXN";
  const hs = copilot?.historical_support;
  const nearby = hs?.nearby_routes;
  const carriers: any[] = Array.isArray(hs?.carriers) ? [...hs.carriers] : [];
  carriers.sort((a, b) => (b?.shipment_count ?? 0) - (a?.shipment_count ?? 0));
  const records: any[] = Array.isArray(hs?.records) ? hs.records : [];
  const rutasExactas: any[] = Array.isArray(hs?.routes) ? hs.routes : [];
  const rutasCercanas: any[] = Array.isArray(nearby?.routes) ? nearby.routes : [];
  const warnings: string[] = Array.isArray(copilot?.warnings) ? copilot.warnings : [];
  const citations: any[] = Array.isArray(copilot?.citations) ? copilot.citations : [];
  const unavailable = !copilot || copilot?.status === "unavailable" || meta?.status === "failed";

  return (
    <div className="space-y-4" data-testid="copilot-detalle">
      {/* 7.1 Encabezado */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-primary" />
                Copilot
              </CardTitle>
              {meta && (
                <div className="text-sm text-muted-foreground">
                  {meta.origen && meta.destino ? `${meta.origen} → ${meta.destino}` : null}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={unavailable ? "unavailable" : copilot?.status} />
              {reused === true && (
                <Badge variant="secondary" data-testid="badge-reutilizada">Explicación guardada</Badge>
              )}
              {reused === false && <Badge variant="default" data-testid="badge-nueva">Explicación nueva</Badge>}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {reused === true && (
            <div className="text-sm text-muted-foreground" data-testid="text-reutilizada">
              Explicación guardada. No fue necesario generar una nueva.
              {meta?.completedAt ? ` Generada originalmente el ${fmtFecha(meta.completedAt)}.` : ""}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1">
            <Dato label="Cotización" value={meta ? `#${meta.quoteId}` : null} />
            <Dato label="Referencia explicada" value={meta ? MODEL_LABELS[meta.modelKey] || meta.modelLabel : null} />
            <Dato label="Costo explicado" value={fmtMoney(meta?.costoExplicado, moneda)} />
            <Dato label="Moneda" value={moneda} />
            <Dato label="Fecha de generación" value={fmtFecha(meta?.completedAt || meta?.createdAt)} />
            {meta?.solicitante && <Dato label="Solicitado por" value={meta.solicitante} />}
          </div>
          <div className="flex gap-2 pt-2 flex-wrap">
            {meta?.quoteId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/board?detail=${encodeURIComponent(meta.quoteId)}&tab=ofertas`)}
                data-testid="button-volver-cotizacion"
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Regresar a la cotización
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onVolverLista} data-testid="button-volver-lista">
              Ver todas las explicaciones
            </Button>
          </div>
        </CardContent>
      </Card>

      {unavailable ? (
        <Card>
          <CardContent className="pt-6 space-y-2 text-sm">
            <p className="font-medium">Explicación no disponible</p>
            <p className="text-muted-foreground">
              {errorMensaje ||
                warnings[0] ||
                "No se pudo generar la explicación. La referencia de costo no se ve afectada; valida el costo con el transportista, Operaciones o Procurement."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 7.2 Explicación */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Explicación de la referencia</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="whitespace-pre-wrap leading-relaxed" data-testid="text-explicacion">
                {copilot.answer}
              </p>
              {warnings.length > 0 && (
                <div>
                  <p className="font-medium mb-1">Advertencias y limitaciones</p>
                  <ul className="list-disc pl-5 space-y-0.5 text-amber-700 dark:text-amber-400">
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {citations.length > 0 && (
                <Dato label="Fuentes utilizadas" value={`${citations.length}`} />
              )}
              {citations.length > 0 && (
                <div className="text-muted-foreground text-xs">
                  {citations.map((c) => c?.title).filter(Boolean).join(" · ")}
                </div>
              )}
              <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                Esta explicación no autoriza una tarifa, no confirma disponibilidad y no
                sustituye la validación con el carrier, Operaciones o Procurement.
              </div>
            </CardContent>
          </Card>

          {/* 7.3 Rutas y resultados anteriores */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Rutas y resultados anteriores</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1">
                <Dato label="Nivel de coincidencia histórica" value={hs?.comparison_basis === "same_route" ? "Misma ruta" : hs?.comparison_basis === "same_route_equipment" ? "Misma ruta y equipo" : hs?.comparison_basis === "comparable_routes" ? "Rutas comparables (la ruta no tiene historial propio)" : hs?.comparison_basis === "nearby_routes" ? "Rutas cercanas" : hs?.comparison_basis || null} />
                <Dato label="Periodo consultado" value={hs?.history_window || null} />
                <Dato label="Viajes útiles" value={hs?.comparable_count ?? null} />
                <Dato label="Transportistas observados" value={hs?.carrier_count ?? null} />
              </div>
              {hs?.message && <p className="text-muted-foreground">{hs.message}</p>}
              {rutasExactas.length === 0 && !hs?.message && (
                <p className="text-muted-foreground">
                  No hay viajes de la misma ruta y equipo en el periodo consultado. La
                  confiabilidad depende de referencias secundarias; valida el costo con el
                  transportista antes de proponer tarifa.
                </p>
              )}
              {rutasExactas.length > 0 && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ruta</TableHead>
                        <TableHead>División / Equipo</TableHead>
                        <TableHead className="text-right">Viajes</TableHead>
                        <TableHead className="text-right">Costo all-in habitual</TableHead>
                        <TableHead className="text-right">Venta all-in habitual</TableHead>
                        <TableHead className="text-right">Margen habitual</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rutasExactas.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="min-w-[180px]">
                            {r.origin} → {r.destination}
                            {r.flow ? <div className="text-xs text-muted-foreground">{r.flow}</div> : null}
                            {r.service_type ? <div className="text-xs text-muted-foreground">{r.service_type}</div> : null}
                          </TableCell>
                          <TableCell>{[r.division, r.equipment].filter(Boolean).join(" / ") || "—"}</TableCell>
                          <TableCell className="text-right">{r.shipment_count ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{rangoUsual(r.cost, r.currency || moneda) || "—"}</TableCell>
                          <TableCell className="text-right font-mono">{rangoUsual(r.all_in_rate_sale, r.currency || moneda) || "—"}</TableCell>
                          <TableCell className="text-right font-mono">{margenTexto(r.margin, r.currency || moneda) || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 7.4 Rutas cercanas */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Rutas cercanas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Referencias secundarias: no sustituyen la ruta exacta. Radio configurado
                para beta: {nearby?.radius_km ?? 30} km. Una ruta histórica sólo es candidata
                cuando su origen está a {nearby?.radius_km ?? 30} km o menos del origen
                solicitado <span className="font-medium">y</span> su destino a{" "}
                {nearby?.radius_km ?? 30} km o menos del destino solicitado; ambas
                condiciones se evalúan de forma independiente (no se suman distancias ni
                basta un solo extremo cercano). El radio es un parámetro configurable de la
                beta, no una regla aprendida por los modelos ni un umbral comercial
                validado definitivamente.
              </p>
              {nearby?.message && <p className="text-muted-foreground">{nearby.message}</p>}
              {rutasCercanas.length === 0 && !nearby?.message && (
                <p className="text-muted-foreground">
                  No se encontraron rutas cercanas dentro del radio configurado (o faltan
                  coordenadas para evaluarlas). Sin esta referencia secundaria, valida el
                  costo directamente con transportistas de la zona.
                </p>
              )}
              {rutasCercanas.length > 0 && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ruta</TableHead>
                        <TableHead>División / Equipo</TableHead>
                        <TableHead className="text-right">Dist. orígenes</TableHead>
                        <TableHead className="text-right">Dist. destinos</TableHead>
                        <TableHead className="text-right">Δ recorrido</TableHead>
                        <TableHead className="text-right">Viajes</TableHead>
                        <TableHead className="text-right">Costo all-in habitual</TableHead>
                        <TableHead className="text-right">Venta habitual</TableHead>
                        <TableHead className="text-right">Margen habitual</TableHead>
                        <TableHead className="text-right">Margen negativo</TableHead>
                        <TableHead>Transportistas / Folios</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rutasCercanas.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="min-w-[180px]">
                            {r.origin} → {r.destination}
                            {r.service_type ? <div className="text-xs text-muted-foreground">{r.service_type}</div> : null}
                          </TableCell>
                          <TableCell>{[r.division, r.equipment].filter(Boolean).join(" / ") || "—"}</TableCell>
                          <TableCell className="text-right">{r.origin_distance_km !== undefined ? `${Number(r.origin_distance_km).toFixed(1)} km` : "—"}</TableCell>
                          <TableCell className="text-right">{r.destination_distance_km !== undefined ? `${Number(r.destination_distance_km).toFixed(1)} km` : "—"}</TableCell>
                          <TableCell className="text-right">{r.route_distance_difference_pct !== null && r.route_distance_difference_pct !== undefined ? `${Number(r.route_distance_difference_pct).toFixed(1)}%` : "—"}</TableCell>
                          <TableCell className="text-right">{r.shipment_count ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{rangoUsual(r.cost, r.currency || moneda) || "—"}</TableCell>
                          <TableCell className="text-right font-mono">{rangoUsual(r.all_in_rate_sale, r.currency || moneda) || "—"}</TableCell>
                          <TableCell className="text-right font-mono">{margenTexto(r.margin, r.currency || moneda) || "—"}</TableCell>
                          <TableCell className="text-right">{r.margin?.negative_record_count ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground min-w-[160px]">
                            {Array.isArray(r.carriers) && r.carriers.length > 0 && (
                              <div>{r.carriers.map((c: any) => c?.carrier).filter(Boolean).join(", ")}</div>
                            )}
                            {Array.isArray(r.carriers) &&
                              r.carriers.some((c: any) => Array.isArray(c?.reference_ids) && c.reference_ids.length > 0) && (
                                <div className="font-mono">
                                  {r.carriers
                                    .flatMap((c: any) => c?.reference_ids || [])
                                    .slice(0, 5)
                                    .join(", ")}
                                </div>
                              )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 7.4b Comparación regional */}
          {(() => {
            const regional = hs?.regional_support;
            const rutasRegionales: any[] = Array.isArray(regional?.routes) ? regional.routes : [];
            const nivelTexto =
              regional?.comparison_level === "same_state_pair"
                ? "Mismo par de estados (dirigido)"
                : regional?.comparison_level === "same_regional_corridor"
                  ? "Mismo corredor regional (dirigido)"
                  : regional?.comparison_level === "related_corridor"
                    ? "Corredor relacionado (catálogo aprobado)"
                    : regional?.comparison_level === "comparable_distance_equipment"
                      ? "Distancia y equipo comparables"
                      : null;
            return (
              <Card data-testid="card-regional-support">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Comparación regional</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {!regional || regional.status === "unavailable" ? (
                    <p className="text-muted-foreground">
                      La comparación regional no está disponible para esta explicación
                      (capa regional no verificada o explicación generada antes de esta
                      funcionalidad).
                    </p>
                  ) : regional.status === "not_applicable" ? (
                    <p className="text-muted-foreground">
                      {regional.reason === "division_not_national"
                        ? "La comparación regional sólo aplica a la división National."
                        : regional.reason === "equipment_ltl"
                          ? "La comparación regional no aplica a embarques LTL."
                          : regional.reason === "missing_coordinates"
                            ? "No aplica: la cotización no tiene coordenadas completas y válidas."
                            : regional.message || "La comparación regional no aplica para esta cotización."}
                    </p>
                  ) : (
                    <>
                      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1">
                        <Dato label="Estados (dirigido)" value={regional.origin_state && regional.destination_state ? `${regional.origin_state} → ${regional.destination_state}` : null} />
                        <Dato label="Corredor regional (dirigido)" value={regional.origin_region_label && regional.destination_region_label ? `${regional.origin_region_label} → ${regional.destination_region_label}` : null} />
                        <Dato label="Nivel de comparación" value={nivelTexto} />
                        <Dato label="Influencia en el costo" value={regional.used_by_selected_cost ? "Influyó en el costo seleccionado" : "Sólo contexto"} />
                        <Dato label="Viajes regionales" value={regional.comparable_count ?? null} />
                        <Dato label="Transportistas observados" value={regional.carrier_count ?? null} />
                        <Dato label="Periodo consultado" value={regional.history_window === "recent_6_months" ? "Últimos 6 meses" : regional.history_window === "older_than_6_months" ? "Anterior a 6 meses" : null} />
                        <Dato label="Registros con margen negativo" value={regional.negative_margin_count ?? null} />
                        <Dato
                          label="Nivel de costo regional"
                          value={
                            regional.regional_cost_level === "lower"
                              ? "Por debajo del promedio regional (≥10%)"
                              : regional.regional_cost_level === "similar"
                                ? "Similar al promedio regional (±10%)"
                                : regional.regional_cost_level === "higher"
                                  ? "Por encima del promedio regional (≥10%)"
                                  : regional.regional_cost_level === "insufficient_evidence"
                                    ? "Evidencia insuficiente para clasificar"
                                    : null
                          }
                        />
                      </div>
                      {regional.message && <p className="text-muted-foreground">{regional.message}</p>}
                      <p className="text-muted-foreground text-xs">
                        El sentido del corredor importa: el regreso no es equivalente a la
                        ida. El nivel de costo regional compara el costo cotizado contra la
                        mediana histórica del corredor (umbrales ±10 %, mínimo 3 viajes).
                        Las regiones son agrupaciones aproximadas del modelo, no fronteras
                        oficiales; sus nombres provienen de los estados dominantes y están
                        pendientes de aprobación comercial.{" "}
                        {regional.related_corridors_enabled
                          ? "La comparación con corredores relacionados usa exclusivamente el catálogo aprobado por Pricing/Operaciones/Procurement (relaciones dirigidas)."
                          : "La comparación con corredores relacionados está deshabilitada hasta contar con un catálogo aprobado por Pricing/Operaciones/Procurement."}
                      </p>
                      {rutasRegionales.length > 0 && (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Corredor (estados)</TableHead>
                                <TableHead>Equipo</TableHead>
                                <TableHead className="text-right">Viajes</TableHead>
                                <TableHead className="text-right">Costo all-in habitual</TableHead>
                                <TableHead className="text-right">Venta habitual</TableHead>
                                <TableHead className="text-right">Margen habitual</TableHead>
                                <TableHead className="text-right">Margen negativo</TableHead>
                                <TableHead className="text-right">Distancias</TableHead>
                                <TableHead>Transportistas / Folios</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {rutasRegionales.map((r: any, i: number) => (
                                <TableRow key={i} data-testid={`row-regional-${i}`}>
                                  <TableCell className="min-w-[160px]">
                                    {r.origin_state} → {r.destination_state}
                                    {r.origin && r.destination ? (
                                      <div className="text-xs text-muted-foreground">
                                        Ruta de referencia: {r.origin} → {r.destination}
                                      </div>
                                    ) : null}
                                  </TableCell>
                                  <TableCell>{r.equipment || "—"}</TableCell>
                                  <TableCell className="text-right">{r.shipment_count ?? "—"}</TableCell>
                                  <TableCell className="text-right font-mono">{rangoUsual(r.cost, r.currency || moneda) || "—"}</TableCell>
                                  <TableCell className="text-right font-mono">{rangoUsual(r.all_in_rate_sale, r.currency || moneda) || "—"}</TableCell>
                                  <TableCell className="text-right font-mono">{margenTexto(r.margin, r.currency || moneda) || "—"}</TableCell>
                                  <TableCell className="text-right">{r.margin?.negative_record_count ?? "—"}</TableCell>
                                  <TableCell className="text-right text-xs">
                                    {r.distance_km_min != null && r.distance_km_max != null
                                      ? `${Number(r.distance_km_min).toFixed(0)}–${Number(r.distance_km_max).toFixed(0)} km`
                                      : "—"}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground min-w-[160px]">
                                    {Array.isArray(r.carriers) && r.carriers.length > 0 && (
                                      <div>{r.carriers.map((c: any) => c?.carrier).filter(Boolean).join(", ")}</div>
                                    )}
                                    {Array.isArray(r.reference_ids) && r.reference_ids.length > 0 && (
                                      <div className="font-mono">{r.reference_ids.slice(0, 5).join(", ")}</div>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                      {rutasRegionales.length === 0 && (
                        <p className="text-muted-foreground">
                          No se encontraron viajes regionales comparables para este
                          corredor dirigido. Valida el costo directamente con
                          transportistas de la zona.
                        </p>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* 7.5 Resultados por transportista */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Resultados por transportista</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {carriers.length === 0 ? (
                <p className="text-muted-foreground">
                  No hay resultados por transportista para esta referencia. Consulta con
                  Procurement qué carriers operan actualmente este corredor.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Transportista</TableHead>
                        <TableHead>Ruta</TableHead>
                        <TableHead>Equipo</TableHead>
                        <TableHead className="text-right">Viajes</TableHead>
                        <TableHead className="text-right">Costo all-in habitual</TableHead>
                        <TableHead className="text-right">Venta habitual</TableHead>
                        <TableHead className="text-right">Margen habitual</TableHead>
                        <TableHead>Folios recientes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {carriers.map((c, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{c.carrier || "—"}</TableCell>
                          <TableCell className="min-w-[160px]">{c.origin} → {c.destination}</TableCell>
                          <TableCell>{c.equipment || "—"}</TableCell>
                          <TableCell className="text-right">{c.shipment_count ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{rangoUsual(c.cost, c.currency || moneda) || "—"}</TableCell>
                          <TableCell className="text-right font-mono">{rangoUsual(c.all_in_rate_sale, c.currency || moneda) || "—"}</TableCell>
                          <TableCell className="text-right font-mono">{margenTexto(c.margin, c.currency || moneda) || "—"}</TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">
                            {Array.isArray(c.reference_ids) && c.reference_ids.length > 0 ? c.reference_ids.join(", ") : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 7.6 Viajes usados como referencia */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Viajes usados como referencia</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {records.length === 0 ? (
                <p className="text-muted-foreground">
                  No hay viajes individuales elegibles como referencia para esta
                  explicación. Solicita validación humana del costo antes de proponer una
                  tarifa.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Folio</TableHead>
                        <TableHead>Transportista</TableHead>
                        <TableHead>Ruta</TableHead>
                        <TableHead>División / Equipo</TableHead>
                        <TableHead className="text-right">Costo all-in</TableHead>
                        <TableHead className="text-right">Venta all-in</TableHead>
                        <TableHead className="text-right">Margen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {records.map((r, i) => (
                        <TableRow key={i} className={cn(r.has_negative_margin && "bg-destructive/5")}>
                          <TableCell className="whitespace-nowrap">{r.shipment_date ? format(new Date(r.shipment_date), "d MMM yyyy", { locale: es }) : "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{r.evidence_id || "—"}</TableCell>
                          <TableCell>{r.carrier || "—"}</TableCell>
                          <TableCell className="min-w-[160px]">{r.origin} → {r.destination}</TableCell>
                          <TableCell>{[r.division, r.equipment].filter(Boolean).join(" / ") || "—"}</TableCell>
                          <TableCell className="text-right font-mono">{fmtMoney(r.cost, r.currency || moneda) || "—"}</TableCell>
                          <TableCell className="text-right font-mono">{fmtMoney(r.all_in_rate_sale, r.currency || moneda) || "—"}</TableCell>
                          <TableCell className="text-right font-mono">
                            {fmtMoney(r.margin_amount, r.currency || moneda) || "—"}
                            {r.margin_percentage !== null && r.margin_percentage !== undefined ? ` (${Number(r.margin_percentage).toFixed(1)}%)` : ""}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Comentarios y sugerencias (carriers / pricing) */}
          <ComentariosCopilot meta={meta} />

          {/* Auditoría técnica (secundaria) */}
          <Card>
            <CardHeader className="pb-0">
              <button
                type="button"
                className="w-full flex items-center justify-between text-sm font-medium py-2"
                onClick={() => setVerAuditoria((v) => !v)}
                data-testid="button-auditoria"
              >
                Datos técnicos de auditoría
                {verAuditoria ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </CardHeader>
            {verAuditoria && (
              <CardContent className="pt-2 text-sm">
                <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1">
                  <Dato label="Modelo" value={copilot.model} />
                  <Dato label="Fase del modelo" value={copilot.model_phase} />
                  <Dato label="Versión del prompt" value={copilot.prompt_version} />
                  <Dato label="Versión del corpus RAG" value={copilot.index_version} />
                  <Dato label="Tokens de entrada" value={copilot.usage?.input_tokens ?? null} />
                  <Dato label="Tokens de salida" value={copilot.usage?.output_tokens ?? null} />
                  <Dato label="Identificador de explicación" value={meta?.id || null} />
                </div>
              </CardContent>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ---------- Comentarios y sugerencias (carriers / pricing) ----------

function ComentariosCopilot({ meta }: { meta: ExplanationSummary | null }) {
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  // Sólo los comentarios hechos dentro de esta cotización (quoteId + rutaId).
  const comentariosUrl = `/api/copilot/comments?quoteId=${encodeURIComponent(meta?.quoteId || "")}&rutaId=${encodeURIComponent(meta?.rutaId || "")}`;
  const { data, isLoading } = useQuery<{ comments: any[] }>({
    queryKey: [comentariosUrl],
    enabled: Boolean(meta?.quoteId),
  });
  const comentarios: any[] = Array.isArray(data?.comments) ? data.comments : [];
  const crearComentario = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/copilot/comments", {
        comment: texto.trim(),
        quoteId: meta?.quoteId || null,
        rutaId: meta?.rutaId || null,
        modelKey: meta?.modelKey || null,
      });
      return await res.json();
    },
    onSuccess: () => {
      setTexto("");
      queryClient.invalidateQueries({ queryKey: [comentariosUrl] });
      // La columna "Comentarios" del listado depende de si existen comentarios.
      queryClient.invalidateQueries({ queryKey: ["/api/copilot/explanations"] });
    },
  });
  const rolLegible = (rol: string) =>
    (rol || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "—";

  return (
    <Card data-testid="card-copilot-comments">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Comentarios y sugerencias</CardTitle>
        <p className="text-xs text-muted-foreground">
          Espacio para que carriers y pricing dejen sugerencias sobre esta
          cotización. Aquí sólo se muestran los comentarios hechos dentro de esta
          cotización; son visibles para todo el equipo con acceso al copiloto.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-2">
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Escribe tu sugerencia sobre el modelo o el copiloto…"
            maxLength={2000}
            rows={3}
            data-testid="input-copilot-comment"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{texto.length}/2000</span>
            <Button
              size="sm"
              disabled={!texto.trim() || crearComentario.isPending}
              onClick={() => crearComentario.mutate()}
              data-testid="button-enviar-comentario"
            >
              {crearComentario.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Enviar comentario"
              )}
            </Button>
          </div>
          {crearComentario.isError && (
            <p className="text-xs text-destructive">
              No se pudo guardar el comentario. Intenta de nuevo.
            </p>
          )}
        </div>
        {isLoading ? (
          <p className="text-muted-foreground text-xs">Cargando comentarios…</p>
        ) : comentarios.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Aún no hay comentarios. Sé la primera persona en dejar una sugerencia.
          </p>
        ) : (
          <div className="space-y-3">
            {comentarios.map((c) => (
              <div
                key={c.id}
                className="rounded-md border p-3 space-y-1"
                data-testid={`comment-${c.id}`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.authorName || "Usuario"}</span>
                    <Badge variant="secondary" className="text-xs">
                      {rolLegible(c.authorRole)}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {c.createdAt
                      ? format(new Date(c.createdAt), "d MMM yyyy, HH:mm", { locale: es })
                      : ""}
                  </span>
                </div>
                <p className="whitespace-pre-wrap">{c.comment}</p>
                {(c.quoteId || c.modelKey) && (
                  <p className="text-xs text-muted-foreground">
                    Contexto: {[c.quoteId, c.modelKey].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Página ----------

export default function CopilotPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const quoteParam = params.get("quote");
  const rutaParam = params.get("ruta");
  const modelParam = params.get("model");
  const idParam = params.get("id");
  const modoGenerar = Boolean(quoteParam && rutaParam && modelParam);

  const [busqueda, setBusqueda] = useState("");
  const [filtroModelo, setFiltroModelo] = useState("todos");
  const [filtroUsuario, setFiltroUsuario] = useState("todos");
  const [filtroFecha, setFiltroFecha] = useState("");

  // Resultado del flujo "explicar" (generación o reutilización en servidor).
  const explainMutation = useMutation({
    mutationFn: async (args: { quoteId: string; rutaId: string; modelKey: string }) => {
      const res = await apiRequest("POST", "/api/copilot/explain", args);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/copilot/explanations"] });
    },
  });

  // Re-dispara la solicitud cuando cambian los parámetros (no sólo la primera
  // vez): la mutación se reinicia para cada combinación quote/ruta/model.
  const claveGeneracion = modoGenerar ? `${quoteParam}::${rutaParam}::${modelParam}` : null;
  const [claveActual, setClaveActual] = useState<string | null>(null);
  useEffect(() => {
    if (claveGeneracion && claveGeneracion !== claveActual) {
      setClaveActual(claveGeneracion);
      explainMutation.reset();
      explainMutation.mutate({ quoteId: quoteParam!, rutaId: rutaParam!, modelKey: modelParam! });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveGeneracion]);

  const listaQuery = useQuery<{ explanations: ExplanationSummary[]; canSeeSolicitante: boolean }>({
    queryKey: ["/api/copilot/explanations"],
    enabled: !modoGenerar,
  });

  const detalleQuery = useQuery<{ explanation: ExplanationSummary; copilot: any; errorMensaje: string | null }>({
    queryKey: [`/api/copilot/explanations/${idParam}`],
    enabled: Boolean(idParam) && !modoGenerar,
  });

  const volverLista = () => navigate("/copilot");

  // --- Modo generar/reutilizar (desde el botón de la cotización) ---
  if (modoGenerar) {
    if (explainMutation.isPending || explainMutation.isIdle) {
      return (
        <div className="p-6 max-w-3xl mx-auto">
          <Card>
            <CardContent className="pt-6 flex items-center gap-3 text-sm" data-testid="copilot-cargando">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div>
                <p className="font-medium">Preparando la explicación…</p>
                <p className="text-muted-foreground">
                  Si ya existe una explicación guardada para esta referencia se mostrará al
                  instante sin generar una nueva.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }
    if (explainMutation.isError) {
      const msg = String((explainMutation.error as any)?.message || "");
      const amable = msg.includes("precotizacion_no_encontrada")
        ? "La precotización expiró en el servidor y no hay una explicación guardada para esta referencia. Regresa a la cotización, vuelve a calcular la referencia de costo y solicita la explicación de nuevo."
        : "No se pudo generar la explicación. La referencia de costo no se ve afectada.";
      return (
        <div className="p-6 max-w-3xl mx-auto space-y-4">
          <Card>
            <CardContent className="pt-6 space-y-3 text-sm" data-testid="copilot-error">
              <p className="font-medium">Explicación no disponible</p>
              <p className="text-muted-foreground">{amable}</p>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/board?detail=${encodeURIComponent(quoteParam!)}&tab=ofertas`)}
                >
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Regresar a la cotización
                </Button>
                <Button variant="ghost" size="sm" onClick={volverLista}>
                  Ver explicaciones guardadas
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }
    const data = explainMutation.data as any;
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <DetalleExplicacion
          meta={data?.explanation ?? null}
          copilot={data?.copilot ?? null}
          reused={typeof data?.reused === "boolean" ? data.reused : null}
          onVolverLista={volverLista}
        />
      </div>
    );
  }

  // --- Detalle de una explicación guardada ---
  if (idParam) {
    if (detalleQuery.isLoading) {
      return (
        <div className="p-6 max-w-3xl mx-auto flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando explicación guardada…
        </div>
      );
    }
    if (detalleQuery.isError || !detalleQuery.data) {
      return (
        <div className="p-6 max-w-3xl mx-auto space-y-3 text-sm">
          <p>No se pudo cargar la explicación solicitada.</p>
          <Button variant="outline" size="sm" onClick={volverLista}>Volver al listado</Button>
        </div>
      );
    }
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <DetalleExplicacion
          meta={detalleQuery.data.explanation}
          copilot={detalleQuery.data.copilot}
          reused={true}
          errorMensaje={detalleQuery.data.errorMensaje}
          onVolverLista={volverLista}
        />
      </div>
    );
  }

  // --- Vista general (listado) ---
  const explicaciones = listaQuery.data?.explanations ?? [];
  const canSeeSolicitante = listaQuery.data?.canSeeSolicitante ?? false;
  const usuarios = Array.from(new Set(explicaciones.map((e) => e.solicitante).filter(Boolean))) as string[];

  const filtradas = explicaciones.filter((e) => {
    const q = busqueda.trim().toLowerCase();
    if (q) {
      const texto = `${e.origen} ${e.destino} ${e.quoteId} ${MODEL_LABELS[e.modelKey] || e.modelLabel}`.toLowerCase();
      if (!texto.includes(q)) return false;
    }
    if (filtroModelo !== "todos" && e.modelKey !== filtroModelo) return false;
    if (filtroUsuario !== "todos" && e.solicitante !== filtroUsuario) return false;
    if (filtroFecha) {
      const dia = (e.completedAt || e.createdAt || "").slice(0, 10);
      if (dia !== filtroFecha) return false;
    }
    return true;
  });

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto" data-testid="copilot-lista">
      <div className="flex items-center gap-2">
        <Sparkles className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Copilot</h1>
          <p className="text-sm text-muted-foreground">
            Explicaciones guardadas de referencias de costo. Consultarlas no genera nuevas
            llamadas ni consume tokens.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Buscar por ruta, cotización o referencia…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                data-testid="input-buscar-explicaciones"
              />
            </div>
            <Select value={filtroModelo} onValueChange={setFiltroModelo}>
              <SelectTrigger className="w-[220px]" data-testid="select-filtro-referencia">
                <SelectValue placeholder="Referencia" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas las referencias</SelectItem>
                {Object.entries(MODEL_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              className="w-[160px]"
              value={filtroFecha}
              onChange={(e) => setFiltroFecha(e.target.value)}
              data-testid="input-filtro-fecha"
            />
            {canSeeSolicitante && usuarios.length > 0 && (
              <Select value={filtroUsuario} onValueChange={setFiltroUsuario}>
                <SelectTrigger className="w-[200px]" data-testid="select-filtro-usuario">
                  <SelectValue placeholder="Usuario" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los usuarios</SelectItem>
                  {usuarios.map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {listaQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando explicaciones…
            </div>
          ) : filtradas.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center" data-testid="text-sin-explicaciones">
              {explicaciones.length === 0
                ? "Aún no hay explicaciones guardadas. Genera una desde el botón \u201CExplicar esta referencia (copiloto)\u201D en una cotización."
                : "Ninguna explicación coincide con los filtros."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ruta</TableHead>
                    <TableHead>Cotización</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead className="text-right">Costo explicado</TableHead>
                    <TableHead>Moneda</TableHead>
                    <TableHead>Fecha</TableHead>
                    {canSeeSolicitante && <TableHead>Usuario</TableHead>}
                    <TableHead>Comentarios</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.map((e) => (
                    <TableRow
                      key={e.id}
                      className="cursor-pointer hover-elevate"
                      onClick={() => navigate(`/copilot?id=${encodeURIComponent(e.id)}`)}
                      data-testid={`row-explicacion-${e.id}`}
                    >
                      <TableCell className="min-w-[200px]">{e.origen} → {e.destino}</TableCell>
                      <TableCell className="font-mono text-xs">#{e.quoteId.slice(0, 8)}</TableCell>
                      <TableCell>{MODEL_LABELS[e.modelKey] || e.modelLabel}</TableCell>
                      <TableCell className="text-right font-mono">{fmtMoney(e.costoExplicado, e.moneda) || "—"}</TableCell>
                      <TableCell>{e.moneda}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtFecha(e.completedAt || e.createdAt)}</TableCell>
                      {canSeeSolicitante && <TableCell>{e.solicitante || "—"}</TableCell>}
                      <TableCell data-testid={`cell-comentarios-${e.id}`}>{e.hasComments ? "Sí" : "No"}</TableCell>
                      <TableCell><StatusBadge status={e.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
