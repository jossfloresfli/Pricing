import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Filter, Download, ArrowUpDown, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";

const formatDate = (dateValue: string | Date | null | undefined): string => {
  if (!dateValue) return "-";
  try {
    const dateStr = typeof dateValue === 'string' ? dateValue : dateValue.toISOString();
    if (dateStr.includes('T')) {
      const [datePart] = dateStr.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      return format(new Date(year, month - 1, day), "dd MMM yyyy", { locale: es });
    }
    return format(parseISO(dateStr), "dd MMM yyyy", { locale: es });
  } catch {
    return "-";
  }
};
import type { PricingRequest as DBPricingRequest } from "@shared/schema";
import type { PricingStatus } from "@/components/StatusBadge";

const ALL_STATUSES: PricingStatus[] = ["pendiente", "por_revisar", "cotizando", "enviado", "cotizacion_enviada", "feedback", "ganada", "perdida", "rechazada"];

interface PricingFileRow {
  id: string;
  requestId: string;
  cliente: string;
  tipoCliente: "Cliente" | "Prospecto";
  division: string;
  salesRep: string;
  origen: string;
  destino: string;
  volumen: string;
  frecuencia: string;
  tipoEquipo: string;
  costoAprobado: number | null;
  tarifaVenta: number | null;   // ventaSugerida (referencia)
  ventaFinal: number | null;    // venta final acordada (cuando existe)
  monedaVenta: "MXN" | "USD";   // moneda de los montos de venta de la ruta
  margen: number | null;        // calculado sobre ventaFinal si existe, si no sobre tarifaVenta
  status: PricingStatus;
  fechaEnvio: string;
  fechaCierre: string;
  createdAt: string;
}

const STATUS_LABELS: Record<PricingStatus, string> = {
  pendiente: "Pendiente",
  por_revisar: "Por Revisar",
  cotizando: "Cotizando",
  enviado: "Enviado",
  cotizacion_enviada: "Cotización Enviada",
  feedback: "Feedback",
  ganada: "Ganada",
  perdida: "Perdida",
  rechazada: "Rechazada",
};

const STATUS_COLORS: Record<PricingStatus, string> = {
  pendiente: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  por_revisar: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  cotizando: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  enviado: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  cotizacion_enviada: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  feedback: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  ganada: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  perdida: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  rechazada: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export default function PricingFilePage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [clienteFilter, setClienteFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [divisionFilter, setDivisionFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<keyof PricingFileRow | null>("fechaEnvio");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Prevent browser back/forward navigation on horizontal scroll (Mac trackpad gesture)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // If there's horizontal scroll intent
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const { scrollLeft, scrollWidth, clientWidth } = container;
        const maxScroll = scrollWidth - clientWidth;
        
        // Prevent default only when at edges to stop browser navigation
        if ((e.deltaX < 0 && scrollLeft > 0) || 
            (e.deltaX > 0 && scrollLeft < maxScroll)) {
          // Allow normal scrolling within bounds
        } else if (maxScroll > 0) {
          // At edge but container is scrollable - prevent navigation
          e.preventDefault();
        }
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  const { data: dbRequests = [], isLoading } = useQuery<DBPricingRequest[]>({
    queryKey: ["/api/pricing-requests"],
    refetchInterval: 10000,
  });

  // Extract offers from rutas JSON for each request
  interface RutaOferta {
    id: string;
    carrier: string;
    costo: number;
    carrierRep: string;
  }
  
  interface RutaWithOfertas {
    ofertas?: RutaOferta[];
  }

  const entries: PricingFileRow[] = useMemo(() => {
    const rows: PricingFileRow[] = [];
    
    dbRequests
      .forEach((req) => {
        let rutas: Array<{ origen: string; destino: string; volumen?: string; frecuencia?: string; tipoEquipo?: string; costoEsperado?: number; ventaSugerida?: number; ventaFinal?: number; monedaVenta?: "MXN" | "USD" }> = [];
        try {
          const parsed = JSON.parse(req.rutas || "[]");
          rutas = Array.isArray(parsed) ? parsed : [];
        } catch {
          rutas = [];
        }

        const fechaEnvio = req.fechaEnvio 
          ? formatDate(req.fechaEnvio)
          : "-";
        const fechaCierre = req.fechaCierre 
          ? formatDate(req.fechaCierre)
          : "-";
        const createdAt = formatDate(req.createdAt);

        if (rutas.length === 0) {
          const costoStr = req.costoAprobado;
          const ventaStr = req.tarifaVenta;
          const margenStr = req.margen;
          const costoAprobado = costoStr != null && costoStr !== "" ? parseFloat(String(costoStr)) : null;
          const tarifaVenta = ventaStr != null && ventaStr !== "" ? parseFloat(String(ventaStr)) : null;
          const margen = margenStr != null && margenStr !== "" ? parseFloat(String(margenStr)) : null;
          
          rows.push({
            id: `${req.id}-0`,
            requestId: req.id,
            cliente: req.cliente,
            tipoCliente: req.prospecto && req.prospecto.trim().length > 0 ? "Prospecto" : "Cliente",
            division: req.division || "-",
            salesRep: req.salesRep,
            origen: "-",
            destino: "-",
            volumen: "-",
            frecuencia: "-",
            tipoEquipo: req.tipoEquipo,
            costoAprobado,
            tarifaVenta,
            ventaFinal: null,
            monedaVenta: "MXN",
            margen,
            status: req.status as PricingStatus,
            fechaEnvio,
            fechaCierre,
            createdAt,
          });
        } else {
          rutas.forEach((ruta, index) => {
            const costoAprobado = ruta.costoEsperado ?? null;
            const tarifaVenta = ruta.ventaSugerida ?? null;
            const ventaFinal = ruta.ventaFinal ?? null;
            // Margen se calcula sobre ventaFinal cuando existe; si no, sobre ventaSugerida
            const ventaEfectiva = ventaFinal ?? tarifaVenta;
            const margen = costoAprobado && ventaEfectiva && costoAprobado > 0 
              ? ((ventaEfectiva - costoAprobado) / costoAprobado) * 100 
              : null;
            
            rows.push({
              id: `${req.id}-${index}`,
              requestId: req.id,
              cliente: req.cliente,
              tipoCliente: req.prospecto && req.prospecto.trim().length > 0 ? "Prospecto" : "Cliente",
              division: req.division || "-",
              salesRep: req.salesRep,
              origen: ruta.origen || "-",
              destino: ruta.destino || "-",
              volumen: ruta.volumen || "-",
              frecuencia: ruta.frecuencia || "-",
              tipoEquipo: ruta.tipoEquipo || req.tipoEquipo,
              costoAprobado,
              tarifaVenta,
              ventaFinal,
              monedaVenta: ruta.monedaVenta || "MXN",
              margen,
              status: req.status as PricingStatus,
              fechaEnvio,
              fechaCierre,
              createdAt,
            });
          });
        }
      });
    
    return rows;
  }, [dbRequests]);

  const formatCurrency = (value: number | null, currency: "MXN" | "USD" = "MXN") => {
    if (value === null) return "-";
    return new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(value);
  };

  // Calculate per-request aggregated data from rutas.ofertas
  const requestOfferAggregates = useMemo(() => {
    const aggregates: Record<string, {
      numOfertas: number;
      montos: number[];
      carriers: string[];
      carrierReps: string[];
    }> = {};
    
    dbRequests.forEach(req => {
      let rutas: RutaWithOfertas[] = [];
      try {
        const parsed = JSON.parse(req.rutas || "[]");
        rutas = Array.isArray(parsed) ? parsed : [];
      } catch {
        rutas = [];
      }
      
      aggregates[req.id] = {
        numOfertas: 0,
        montos: [],
        carriers: [],
        carrierReps: [],
      };
      
      rutas.forEach(ruta => {
        const ofertas = ruta.ofertas || [];
        ofertas.forEach(oferta => {
          aggregates[req.id].numOfertas++;
          if (oferta.costo !== null && oferta.costo !== undefined) {
            aggregates[req.id].montos.push(oferta.costo);
          }
          if (oferta.carrier && !aggregates[req.id].carriers.includes(oferta.carrier)) {
            aggregates[req.id].carriers.push(oferta.carrier);
          }
          if (oferta.carrierRep && !aggregates[req.id].carrierReps.includes(oferta.carrierRep)) {
            aggregates[req.id].carrierReps.push(oferta.carrierRep);
          }
        });
      });
    });
    
    return aggregates;
  }, [dbRequests]);

  const uniqueClientes = Array.from(new Set(entries.map((e) => e.cliente)));
  const uniqueDivisiones = Array.from(new Set(entries.map((e) => e.division).filter(d => d !== "-")));

  const exportToCSV = () => {
    const headers = [
      "ID",
      "Cliente",
      "Tipo",
      "Division",
      "Sales Rep",
      "Origen",
      "Destino",
      "Volumen",
      "Frecuencia",
      "Equipo",
      "Costo",
      "Venta Sugerida",
      "Venta Final",
      "Moneda Venta",
      "Margen %",
      "Status",
      "Fecha Creacion",
      "Fecha Envio",
      "Fecha Cierre"
    ];
    
    const rows = sortedEntries.map(entry => [
      entry.requestId,
      entry.cliente,
      entry.tipoCliente,
      entry.division,
      entry.salesRep,
      entry.origen,
      entry.destino,
      entry.volumen,
      entry.frecuencia,
      entry.tipoEquipo,
      entry.costoAprobado || "",
      entry.tarifaVenta || "",
      entry.ventaFinal || "",
      entry.tarifaVenta != null || entry.ventaFinal != null ? entry.monedaVenta : "",
      entry.margen || "",
      STATUS_LABELS[entry.status],
      entry.createdAt,
      entry.fechaEnvio,
      entry.fechaCierre
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `pricing_file_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredEntries = entries.filter((entry) => {
    const matchesSearch =
      searchTerm === "" ||
      entry.cliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.origen.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.destino.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.salesRep.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCliente = clienteFilter === "all" || entry.cliente === clienteFilter;
    const matchesStatus = statusFilter === "all" || entry.status === statusFilter;
    const matchesDivision = divisionFilter === "all" || entry.division === divisionFilter;

    return matchesSearch && matchesCliente && matchesStatus && matchesDivision;
  });

  const sortedEntries = [...filteredEntries].sort((a, b) => {
    if (!sortField) return 0;
    const aVal = a[sortField];
    const bVal = b[sortField];
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    }
    return sortDirection === "asc"
      ? String(aVal).localeCompare(String(bVal))
      : String(bVal).localeCompare(String(aVal));
  });

  const handleSort = (field: keyof PricingFileRow) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const clearFilters = () => {
    setSearchTerm("");
    setClienteFilter("all");
    setStatusFilter("all");
    setDivisionFilter("all");
  };

  const hasFilters = searchTerm !== "" || clienteFilter !== "all" || statusFilter !== "all" || divisionFilter !== "all";

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Pricing File</h1>
          <p className="text-muted-foreground mt-1">Registro de todas las cotizaciones</p>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-pricing-file-title">Pricing File</h1>
        <p className="text-muted-foreground mt-1">
          Registro de todas las cotizaciones
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-lg">Todas las Cotizaciones</CardTitle>
            <Button variant="outline" size="sm" onClick={exportToCSV} data-testid="button-export">
              <Download className="h-4 w-4 mr-2" />
              Exportar CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por cliente, ruta, sales rep..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-search-pricing-file"
              />
            </div>
            <Select value={clienteFilter} onValueChange={setClienteFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-filter-cliente">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Cliente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los clientes</SelectItem>
                {uniqueClientes.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]" data-testid="select-filter-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los status</SelectItem>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={divisionFilter} onValueChange={setDivisionFilter}>
              <SelectTrigger className="w-[150px]" data-testid="select-filter-division">
                <SelectValue placeholder="Division" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las divisiones</SelectItem>
                {uniqueDivisiones.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
                <X className="h-4 w-4 mr-1" />
                Limpiar
              </Button>
            )}
          </div>

          <div ref={scrollContainerRef} className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 -ml-3 font-medium"
                      onClick={() => handleSort("cliente")}
                    >
                      Cliente
                      <ArrowUpDown className="ml-1 h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 -ml-3 font-medium"
                      onClick={() => handleSort("tipoCliente")}
                    >
                      Tipo
                      <ArrowUpDown className="ml-1 h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 -ml-3 font-medium"
                      onClick={() => handleSort("division")}
                    >
                      Division
                      <ArrowUpDown className="ml-1 h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead>Sales Rep</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead>Volumen</TableHead>
                  <TableHead>Frecuencia</TableHead>
                  <TableHead>Equipo</TableHead>
                  <TableHead className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 -mr-3 font-medium"
                      onClick={() => handleSort("costoAprobado")}
                    >
                      Costo
                      <ArrowUpDown className="ml-1 h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 -mr-3 font-medium"
                      onClick={() => handleSort("tarifaVenta")}
                    >
                      Venta Sug.
                      <ArrowUpDown className="ml-1 h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead className="text-right font-medium">Venta Final</TableHead>
                  <TableHead className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 -mr-3 font-medium"
                      onClick={() => handleSort("margen")}
                    >
                      Margen
                      <ArrowUpDown className="ml-1 h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 -ml-3 font-medium"
                      onClick={() => handleSort("status")}
                    >
                      Status
                      <ArrowUpDown className="ml-1 h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 -ml-3 font-medium"
                      onClick={() => handleSort("createdAt")}
                    >
                      Fecha Creación
                      <ArrowUpDown className="ml-1 h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 -ml-3 font-medium"
                      onClick={() => handleSort("fechaEnvio")}
                    >
                      Fecha Envio
                      <ArrowUpDown className="ml-1 h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 -ml-3 font-medium"
                      onClick={() => handleSort("fechaCierre")}
                    >
                      Fecha Cierre
                      <ArrowUpDown className="ml-1 h-3 w-3" />
                    </Button>
                  </TableHead>
                  <TableHead className="text-center"># Ofertas</TableHead>
                  <TableHead className="text-right">Montos Ofertados</TableHead>
                  <TableHead>Carriers</TableHead>
                  <TableHead>Ofertado Por</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedEntries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={21} className="text-center py-8 text-muted-foreground">
                      {entries.length === 0 
                        ? "No hay cotizaciones todavia" 
                        : "No se encontraron registros con los filtros aplicados"}
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedEntries.map((entry) => (
                    <TableRow key={entry.id} className="hover-elevate" data-testid={`row-pricing-file-${entry.id}`}>
                      <TableCell className="font-medium">{entry.cliente}</TableCell>
                      <TableCell data-testid={`badge-tipo-${entry.id}`}>
                        <Badge
                          variant="secondary"
                          className={cn(
                            "text-xs",
                            entry.tipoCliente === "Cliente"
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                          )}
                        >
                          {entry.tipoCliente}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{entry.division}</TableCell>
                      <TableCell className="text-sm">{entry.salesRep}</TableCell>
                      <TableCell className="text-sm">{entry.origen}</TableCell>
                      <TableCell className="text-sm">{entry.destino}</TableCell>
                      <TableCell className="text-sm font-mono">{entry.volumen}</TableCell>
                      <TableCell className="text-sm">
                        {entry.frecuencia !== "-" ? (
                          <Badge variant="secondary" className="text-xs capitalize">{entry.frecuencia}</Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">{entry.tipoEquipo}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(entry.costoAprobado)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {entry.ventaFinal != null ? (
                          <span className="text-muted-foreground line-through text-xs">{formatCurrency(entry.tarifaVenta, entry.monedaVenta)}</span>
                        ) : (
                          formatCurrency(entry.tarifaVenta, entry.monedaVenta)
                        )}
                        {entry.tarifaVenta != null && entry.monedaVenta === "USD" && (
                          <span className="ml-1 text-[10px] text-muted-foreground">USD</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-medium">
                        {entry.ventaFinal != null ? (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            {formatCurrency(entry.ventaFinal, entry.monedaVenta)}
                            {entry.monedaVenta === "USD" && (
                              <span className="ml-1 text-[10px] text-muted-foreground">USD</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.margen !== null ? (
                          <Badge
                            variant="secondary"
                            className={cn(
                              "font-mono",
                              entry.margen >= 15
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                : entry.margen >= 10
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            )}
                          >
                            {entry.margen.toFixed(1)}%
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={cn("text-xs", STATUS_COLORS[entry.status])}>
                          {STATUS_LABELS[entry.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{entry.createdAt}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{entry.fechaEnvio}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{entry.fechaCierre}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary" className="text-xs">
                          {requestOfferAggregates[entry.requestId]?.numOfertas || 0}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {(() => {
                          const agg = requestOfferAggregates[entry.requestId];
                          if (!agg || agg.montos.length === 0) return "-";
                          if (agg.montos.length === 1) return formatCurrency(agg.montos[0]);
                          const min = Math.min(...agg.montos);
                          const max = Math.max(...agg.montos);
                          return `${formatCurrency(min)} - ${formatCurrency(max)}`;
                        })()}
                      </TableCell>
                      <TableCell className="text-sm">
                        {(() => {
                          const agg = requestOfferAggregates[entry.requestId];
                          if (!agg || agg.carriers.length === 0) return "-";
                          return agg.carriers.join(", ");
                        })()}
                      </TableCell>
                      <TableCell className="text-sm">
                        {(() => {
                          const agg = requestOfferAggregates[entry.requestId];
                          if (!agg || agg.carrierReps.length === 0) return "-";
                          return agg.carrierReps.join(", ");
                        })()}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-muted-foreground">
              Mostrando {sortedEntries.length} de {entries.length} cotizaciones enviadas
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
