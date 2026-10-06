import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge, type PricingStatus } from "@/components/StatusBadge";
import { Users, ChevronDown, ChevronRight, AlertTriangle, Download } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import * as XLSX from "xlsx";

interface RawRequest {
  id: string;
  cliente: string;
  prospecto: string | null;
  division: string | null;
  salesRep: string;
  status: string;
  rutas: string;
  createdAt: string | null;
  updatedAt: string | null;
  fechaCierre: string | null;
}

interface QuoteRow {
  id: string;
  cliente: string;
  esProspecto: boolean;
  division: string;
  salesRep: string;
  status: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  fechaCierre: Date | null;
  volumen: number;
  rutasResumen: string;
  sinActualizar: boolean;
  ventaSugerida: Record<string, number> | null;  // suma de ventaSugerida por ruta, agrupada por moneda
  ventaFinal: Record<string, number> | null;     // total efectivo (ventaFinal ?? ventaSugerida) por moneda, solo si alguna ruta tiene venta final
}

const DIAS_SIN_ACTUALIZAR = 14;
const ESTADOS_CERRADOS = new Set(["ganada", "perdida", "rechazada"]);

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function parseVolumen(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fmtInt(n: number) {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);
}

// Montos agrupados por moneda (MXN/USD); las rutas guardan su moneda en monedaVenta (default MXN)
function fmtMontos(montos: Record<string, number> | null) {
  if (!montos) return "—";
  return Object.entries(montos)
    .map(([moneda, monto]) =>
      new Intl.NumberFormat("es-MX", { style: "currency", currency: moneda, maximumFractionDigits: 0 }).format(monto)
      + (Object.keys(montos).length > 1 ? ` ${moneda}` : ""),
    )
    .join(" + ");
}

export default function SalesRepsPage() {
  const { user } = useAuth();
  // Misma regla que el sidebar: líderes/managers, pricing y superadmin.
  const puedeVer =
    user?.role === "superadmin" ||
    user?.role === "sales_manager" ||
    user?.role === "carrier_manager" ||
    user?.role === "pricing" ||
    user?.role === "sales_lead";

  const { data: rawRequests = [], isLoading } = useQuery<RawRequest[]>({
    queryKey: ["/api/pricing-requests"],
    enabled: puedeVer,
  });

  // Filtro: mes específico o rango de fechas
  const now = new Date();
  const [modo, setModo] = useState<"mes" | "rango">("mes");
  const [mesSel, setMesSel] = useState(`${now.getFullYear()}-${now.getMonth()}`);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [repAbierto, setRepAbierto] = useState<string | null>(null);

  const quotes: QuoteRow[] = useMemo(() => {
    return rawRequests.map((req) => {
      let rutas: Array<{ origen?: string; destino?: string; volumen?: string; ventaSugerida?: number; ventaFinal?: number; monedaVenta?: string }> = [];
      try {
        const parsed = JSON.parse(req.rutas || "[]");
        if (Array.isArray(parsed)) rutas = parsed;
      } catch { /* rutas ilegibles */ }
      const createdAt = req.createdAt ? new Date(req.createdAt) : null;
      const updatedAt = req.updatedAt ? new Date(req.updatedAt) : null;
      const fechaCierre = req.fechaCierre ? new Date(req.fechaCierre) : null;
      const cerrada = ESTADOS_CERRADOS.has(req.status);
      const diasDesdeUpdate = updatedAt
        ? (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)
        : Infinity;

      // Sumas por moneda (monedaVenta, default MXN) para no mezclar MXN y USD
      const sumaPorMoneda = (getMonto: (r: typeof rutas[number]) => number | null | undefined) => {
        const acc: Record<string, number> = {};
        for (const r of rutas) {
          const monto = getMonto(r);
          if (monto == null) continue;
          const moneda = r.monedaVenta || "MXN";
          acc[moneda] = (acc[moneda] || 0) + monto;
        }
        return Object.keys(acc).length > 0 ? acc : null;
      };
      const ventaSugerida = sumaPorMoneda((r) => r.ventaSugerida);
      // Total efectivo de cierre: ventaFinal cuando existe, si no la sugerida de esa ruta;
      // solo se reporta si al menos una ruta tiene venta final registrada
      const algunaFinal = rutas.some((r) => r.ventaFinal != null);
      const ventaFinal = algunaFinal ? sumaPorMoneda((r) => r.ventaFinal ?? r.ventaSugerida) : null;

      return {
        id: req.id,
        cliente: req.prospecto?.trim() ? req.prospecto : req.cliente,
        esProspecto: !!req.prospecto?.trim(),
        division: req.division || "Sin división",
        salesRep: req.salesRep || "Sin asignar",
        status: req.status,
        createdAt,
        updatedAt,
        fechaCierre,
        volumen: rutas.reduce((acc, r) => acc + parseVolumen(r.volumen), 0),
        rutasResumen: rutas
          .slice(0, 3)
          .map((r) => `${r.origen || "?"} → ${r.destino || "?"}`)
          .join(" · ") + (rutas.length > 3 ? ` (+${rutas.length - 3})` : ""),
        sinActualizar: !cerrada && diasDesdeUpdate > DIAS_SIN_ACTUALIZAR,
        ventaSugerida,
        ventaFinal,
      };
    });
  }, [rawRequests]);

  // Opciones de mes: desde la cotización más antigua hasta hoy
  const opcionesMes = useMemo(() => {
    const fechas = quotes.map((q) => q.createdAt).filter(Boolean) as Date[];
    const min = fechas.length ? new Date(Math.min(...fechas.map((d) => d.getTime()))) : now;
    const opts: { value: string; label: string }[] = [];
    const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
    const inicio = new Date(min.getFullYear(), min.getMonth(), 1);
    while (cursor >= inicio) {
      opts.push({
        value: `${cursor.getFullYear()}-${cursor.getMonth()}`,
        label: `${MESES[cursor.getMonth()]} ${cursor.getFullYear()}`,
      });
      cursor.setMonth(cursor.getMonth() - 1);
    }
    return opts;
  }, [quotes]);

  // Intervalo semiabierto [inicio, fin): el fin es el inicio del día/mes siguiente.
  const [rangoIni, rangoFin] = useMemo((): [Date, Date] => {
    if (modo === "mes") {
      const [y, m] = mesSel.split("-").map(Number);
      return [new Date(y, m, 1), new Date(y, m + 1, 1)];
    }
    const ini = desde ? new Date(`${desde}T00:00:00`) : new Date(2000, 0, 1);
    const finBase = hasta ? new Date(`${hasta}T00:00:00`) : new Date(2100, 0, 1);
    const fin = new Date(finBase);
    if (hasta) fin.setDate(fin.getDate() + 1);
    return [ini, fin];
  }, [modo, mesSel, desde, hasta]);

  const enRango = (d: Date | null) => !!d && d >= rangoIni && d < rangoFin;

  // Enviadas: por fecha de creación. Ganadas/perdidas: por fecha de cierre
  // (si no hay fecha de cierre, se usa la de última actualización).
  const fechaCierreEfectiva = (q: QuoteRow) => q.fechaCierre || q.updatedAt;

  interface RepStats {
    rep: string;
    enviadas: QuoteRow[];
    ganadas: QuoteRow[];
    perdidas: QuoteRow[];
    sinActualizar: QuoteRow[];
    divisiones: Map<string, number>;
    volumenGanado: number;
  }

  const statsPorRep: RepStats[] = useMemo(() => {
    const map = new Map<string, RepStats>();
    const get = (rep: string) => {
      if (!map.has(rep)) {
        map.set(rep, {
          rep,
          enviadas: [],
          ganadas: [],
          perdidas: [],
          sinActualizar: [],
          divisiones: new Map(),
          volumenGanado: 0,
        });
      }
      return map.get(rep)!;
    };
    quotes.forEach((q) => {
      const s = get(q.salesRep);
      if (enRango(q.createdAt)) {
        s.enviadas.push(q);
        s.divisiones.set(q.division, (s.divisiones.get(q.division) || 0) + 1);
        if (q.sinActualizar) s.sinActualizar.push(q);
      }
      if (q.status === "ganada" && enRango(fechaCierreEfectiva(q))) {
        s.ganadas.push(q);
        s.volumenGanado += q.volumen;
      }
      if ((q.status === "perdida" || q.status === "rechazada") && enRango(fechaCierreEfectiva(q))) {
        s.perdidas.push(q);
      }
    });
    return Array.from(map.values())
      .filter((s) => s.enviadas.length || s.ganadas.length || s.perdidas.length)
      .sort((a, b) => b.enviadas.length - a.enviadas.length);
  }, [quotes, rangoIni, rangoFin]);

  const totales = useMemo(() => statsPorRep.reduce(
    (acc, s) => ({
      enviadas: acc.enviadas + s.enviadas.length,
      ganadas: acc.ganadas + s.ganadas.length,
      perdidas: acc.perdidas + s.perdidas.length,
      volumen: acc.volumen + s.volumenGanado,
    }),
    { enviadas: 0, ganadas: 0, perdidas: 0, volumen: 0 },
  ), [statsPorRep]);

  const cotizacionesDeRep = (s: RepStats): QuoteRow[] => {
    const vistos = new Set<string>();
    return [...s.enviadas, ...s.ganadas, ...s.perdidas].filter((q) => {
      if (vistos.has(q.id)) return false;
      vistos.add(q.id);
      return true;
    }).sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  };

  const etiquetaPeriodo = modo === "mes"
    ? opcionesMes.find((o) => o.value === mesSel)?.label || "Periodo"
    : `${desde || "inicio"} a ${hasta || "hoy"}`;

  const exportarExcel = () => {
    const wb = XLSX.utils.book_new();

    // Hoja 1: resumen por rep
    const resumen = statsPorRep.map((s) => {
      const cerradas = s.ganadas.length + s.perdidas.length;
      return {
        "Sales Rep": s.rep,
        "Enviadas": s.enviadas.length,
        "Clientes": s.enviadas.filter((q) => !q.esProspecto).length,
        "Prospectos": s.enviadas.filter((q) => q.esProspecto).length,
        "Ganadas": s.ganadas.length,
        "Perdidas": s.perdidas.length,
        "% Ganadas": cerradas > 0 ? Math.round((s.ganadas.length / cerradas) * 100) / 100 : "",
        "Vol. ganado": s.volumenGanado,
        "Divisiones": Array.from(s.divisiones.entries()).map(([d, n]) => `${d}: ${n}`).join(", "),
        "Sin actualizar": s.sinActualizar.length,
      };
    });
    resumen.push({
      "Sales Rep": "TOTAL",
      "Enviadas": totales.enviadas,
      "Clientes": statsPorRep.reduce((a, s) => a + s.enviadas.filter((q) => !q.esProspecto).length, 0),
      "Prospectos": statsPorRep.reduce((a, s) => a + s.enviadas.filter((q) => q.esProspecto).length, 0),
      "Ganadas": totales.ganadas,
      "Perdidas": totales.perdidas,
      "% Ganadas": (totales.ganadas + totales.perdidas) > 0
        ? Math.round((totales.ganadas / (totales.ganadas + totales.perdidas)) * 100) / 100
        : "",
      "Vol. ganado": totales.volumen,
      "Divisiones": "",
      "Sin actualizar": statsPorRep.reduce((a, s) => a + s.sinActualizar.length, 0),
    });
    const wsResumen = XLSX.utils.json_to_sheet(resumen);
    wsResumen["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 11 }, { wch: 40 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen por Rep");

    // Hoja 2: detalle de cotizaciones del periodo
    const detalle = statsPorRep.flatMap((s) =>
      cotizacionesDeRep(s).map((q) => ({
        "Sales Rep": s.rep,
        "ID": q.id.slice(0, 8).toUpperCase(),
        "Cliente / Prospecto": q.cliente,
        "Tipo": q.esProspecto ? "Prospecto" : "Cliente",
        "División": q.division,
        "Rutas": q.rutasResumen,
        "Volumen": q.volumen,
        "Venta Sugerida": q.ventaSugerida ? fmtMontos(q.ventaSugerida) : "",
        "Venta Final": q.ventaFinal ? fmtMontos(q.ventaFinal) : "",
        "Creada": q.createdAt ? q.createdAt.toLocaleDateString("es-MX") : "",
        "Cierre": ESTADOS_CERRADOS.has(q.status) && fechaCierreEfectiva(q)
          ? fechaCierreEfectiva(q)!.toLocaleDateString("es-MX")
          : "",
        "Estado": q.status,
        "Sin actualizar": q.sinActualizar ? "Sí" : "",
      })),
    );
    const wsDetalle = XLSX.utils.json_to_sheet(detalle);
    wsDetalle["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 28 }, { wch: 10 }, { wch: 14 }, { wch: 50 }, { wch: 9 }, { wch: 14 }, { wch: 13 }, { wch: 11 }, { wch: 11 }, { wch: 14 }, { wch: 13 }];
    XLSX.utils.book_append_sheet(wb, wsDetalle, "Cotizaciones");

    const nombre = `sales-reps-${etiquetaPeriodo.toLowerCase().replace(/\s+/g, "-")}.xlsx`;
    XLSX.writeFile(wb, nombre);
  };

  if (!puedeVer) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No tienes acceso a esta sección.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Sales Reps</h1>
          <p className="text-sm text-muted-foreground">
            Desempeño de cotizaciones por representante de ventas
          </p>
        </div>
        <div className="flex-1" />
        <Button
          variant="outline"
          onClick={exportarExcel}
          disabled={statsPorRep.length === 0}
          data-testid="button-exportar-excel"
        >
          <Download className="h-4 w-4 mr-2" />
          Descargar Excel
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label>Periodo</Label>
            <Select value={modo} onValueChange={(v) => setModo(v as "mes" | "rango")}>
              <SelectTrigger className="w-44" data-testid="select-modo-periodo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mes">Mes específico</SelectItem>
                <SelectItem value="rango">Rango de fechas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {modo === "mes" ? (
            <div className="space-y-1">
              <Label>Mes</Label>
              <Select value={mesSel} onValueChange={setMesSel}>
                <SelectTrigger className="w-48" data-testid="select-mes">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {opcionesMes.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label>Desde</Label>
                <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-44" data-testid="input-desde" />
              </div>
              <div className="space-y-1">
                <Label>Hasta</Label>
                <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-44" data-testid="input-hasta" />
              </div>
            </>
          )}
          <div className="flex-1" />
          <div className="flex gap-6 text-sm">
            <div className="text-center">
              <p className="text-2xl font-semibold">{totales.enviadas}</p>
              <p className="text-muted-foreground">Enviadas</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold text-green-600 dark:text-green-400">{totales.ganadas}</p>
              <p className="text-muted-foreground">Ganadas</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold text-red-600 dark:text-red-400">{totales.perdidas}</p>
              <p className="text-muted-foreground">Perdidas</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold">{fmtInt(totales.volumen)}</p>
              <p className="text-muted-foreground">Vol. ganado</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resumen por Sales Rep</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : statsPorRep.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin cotizaciones en el periodo seleccionado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Sales Rep</TableHead>
                  <TableHead className="text-right">Enviadas</TableHead>
                  <TableHead className="text-right">Ganadas</TableHead>
                  <TableHead className="text-right">Perdidas</TableHead>
                  <TableHead className="text-right">% Ganadas</TableHead>
                  <TableHead className="text-right">Vol. ganado</TableHead>
                  <TableHead>Divisiones</TableHead>
                  <TableHead className="text-right">Sin actualizar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statsPorRep.map((s) => {
                  const cerradas = s.ganadas.length + s.perdidas.length;
                  const pctGanadas = cerradas > 0 ? Math.round((s.ganadas.length / cerradas) * 100) : null;
                  const abierto = repAbierto === s.rep;
                  return [
                      <TableRow
                        key={s.rep}
                        className="cursor-pointer"
                        onClick={() => setRepAbierto(abierto ? null : s.rep)}
                        data-testid={`row-rep-${s.rep}`}
                      >
                        <TableCell>
                          {abierto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="font-medium">{s.rep}</TableCell>
                        <TableCell className="text-right">
                          {(() => {
                            const prospectos = s.enviadas.filter((q) => q.esProspecto).length;
                            const clientes = s.enviadas.length - prospectos;
                            return (
                              <div className="inline-flex flex-col items-end gap-1" title={`${clientes} clientes · ${prospectos} prospectos`}>
                                <span>{s.enviadas.length}</span>
                                {s.enviadas.length > 0 && (
                                  <>
                                    <div className="flex h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                                      {clientes > 0 && (
                                        <div className="bg-sky-500" style={{ width: `${(clientes / s.enviadas.length) * 100}%` }} />
                                      )}
                                      {prospectos > 0 && (
                                        <div className="bg-violet-500" style={{ width: `${(prospectos / s.enviadas.length) * 100}%` }} />
                                      )}
                                    </div>
                                    <span className="text-[10px] leading-none text-muted-foreground whitespace-nowrap">
                                      <span className="text-sky-500">●</span> {clientes} C{" "}
                                      <span className="text-violet-500">●</span> {prospectos} P
                                    </span>
                                  </>
                                )}
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-right text-green-600 dark:text-green-400 font-medium">{s.ganadas.length}</TableCell>
                        <TableCell className="text-right text-red-600 dark:text-red-400">{s.perdidas.length}</TableCell>
                        <TableCell className="text-right">{pctGanadas !== null ? `${pctGanadas}%` : "—"}</TableCell>
                        <TableCell className="text-right font-mono">{fmtInt(s.volumenGanado)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {Array.from(s.divisiones.entries()).map(([d, n]) => (
                              <Badge key={d} variant="secondary" className="text-xs">{d}: {n}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {s.sinActualizar.length > 0 ? (
                            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              {s.sinActualizar.length}
                            </span>
                          ) : (
                            "0"
                          )}
                        </TableCell>
                      </TableRow>,
                      abierto ? (
                        <TableRow key={`${s.rep}-detalle`}>
                          <TableCell colSpan={9} className="bg-muted/40 p-4">
                            <p className="text-sm font-medium mb-2">
                              Cotizaciones de {s.rep} en el periodo
                            </p>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>ID</TableHead>
                                  <TableHead>Cliente / Prospecto</TableHead>
                                  <TableHead>Tipo</TableHead>
                                  <TableHead>División</TableHead>
                                  <TableHead>Rutas</TableHead>
                                  <TableHead className="text-right">Volumen</TableHead>
                                  <TableHead className="text-right">Venta Sug.</TableHead>
                                  <TableHead className="text-right">Venta Final</TableHead>
                                  <TableHead>Creada</TableHead>
                                  <TableHead>Cierre</TableHead>
                                  <TableHead>Estado</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {cotizacionesDeRep(s).map((q) => (
                                  <TableRow key={q.id} data-testid={`row-quote-${q.id}`}>
                                    <TableCell className="font-mono text-xs">{q.id.slice(0, 8).toUpperCase()}</TableCell>
                                    <TableCell className="font-medium">{q.cliente}</TableCell>
                                    <TableCell>
                                      <Badge variant={q.esProspecto ? "outline" : "secondary"} className="text-xs">
                                        {q.esProspecto ? "Prospecto" : "Cliente"}
                                      </Badge>
                                    </TableCell>
                                    <TableCell>{q.division}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground max-w-64 truncate">{q.rutasResumen}</TableCell>
                                    <TableCell className="text-right font-mono">{fmtInt(q.volumen)}</TableCell>
                                    <TableCell className="text-right font-mono text-xs">
                                      {q.ventaFinal != null ? (
                                        <span className="text-muted-foreground line-through">{fmtMontos(q.ventaSugerida)}</span>
                                      ) : (
                                        fmtMontos(q.ventaSugerida)
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-xs font-medium">
                                      {q.ventaFinal != null ? (
                                        <span className="text-emerald-700 dark:text-emerald-400">{fmtMontos(q.ventaFinal)}</span>
                                      ) : (
                                        <span className="text-muted-foreground">—</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-xs">
                                      {q.createdAt ? q.createdAt.toLocaleDateString("es-MX") : "—"}
                                      {q.sinActualizar && (
                                        <span className="ml-2 text-amber-600 dark:text-amber-400" title={`Más de ${DIAS_SIN_ACTUALIZAR} días sin actualizarse`}>
                                          ⚠︎
                                        </span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-xs">
                                      {ESTADOS_CERRADOS.has(q.status) && fechaCierreEfectiva(q)
                                        ? fechaCierreEfectiva(q)!.toLocaleDateString("es-MX")
                                        : "—"}
                                    </TableCell>
                                    <TableCell><StatusBadge status={q.status as PricingStatus} /></TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableCell>
                        </TableRow>
                      ) : null,
                  ];
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
