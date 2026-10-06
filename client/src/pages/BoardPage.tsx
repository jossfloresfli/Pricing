import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { KanbanBoard } from "@/components/KanbanBoard";
import { RequestDetailModal } from "@/components/RequestDetailModal";
import type { PricingRequest, Route } from "@/components/PricingCard";
import type { PricingStatus } from "@/components/StatusBadge";
import { Plus, LayoutGrid, List, Filter, Loader2, Calendar, Rows3 } from "lucide-react";
import { Link, useSearch } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PricingFileTable } from "@/components/PricingFileTable";
import type { PricingRequest as DBPricingRequest, Division } from "@shared/schema";

export default function BoardPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const searchString = useSearch();
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<string | undefined>(undefined);
  const [viewMode, setViewMode] = useState<"kanban" | "list" | "rows">("kanban");
  const [divisionFilter, setDivisionFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const handleViewDetail = (id: string, tab?: string) => {
    setSelectedRequest(id);
    setSelectedTab(tab);
  };

  const { data: divisiones = [] } = useQuery<Division[]>({
    queryKey: ["/api/divisiones"],
  });

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const highlightId = params.get("highlight");
    const detailId = params.get("detail");
    const filterParam = params.get("filter");
    
    if (highlightId) {
      setSelectedRequest(highlightId);
      const tabParam = params.get("tab");
      if (tabParam) {
        setSelectedTab(tabParam);
      }
      window.history.replaceState({}, "", "/board");
    } else if (detailId) {
      setSelectedRequest(detailId);
      const tabParam = params.get("tab");
      if (tabParam) {
        setSelectedTab(tabParam);
      }
    }
    
    if (filterParam) {
      // Map filter values to column IDs for scrolling
      const filterToColumnMap: Record<string, string> = {
        pendientes: "pendiente",
        proceso: "cotizando",
        ganada: "ganada",
        perdida: "perdida",
      };
      
      const columnId = filterToColumnMap[filterParam];
      if (columnId) {
        // Wait for the board to render then scroll to the column
        setTimeout(() => {
          const columnElement = document.getElementById(`column-${columnId}`);
          if (columnElement) {
            columnElement.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
          }
        }, 300);
      }
      window.history.replaceState({}, "", "/board");
    }
  }, [searchString]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedRequest) {
      url.searchParams.set("detail", selectedRequest);
      if (selectedTab) {
        url.searchParams.set("tab", selectedTab);
      } else {
        url.searchParams.delete("tab");
      }
    } else {
      url.searchParams.delete("detail");
      url.searchParams.delete("tab");
    }
    window.history.replaceState({}, "", url.toString());
  }, [selectedRequest, selectedTab]);

  const { data: dbRequests = [], isLoading, error } = useQuery<DBPricingRequest[]>({
    queryKey: ["/api/pricing-requests"],
    // Mutations already invalidate this query; background updates need not
    // download the entire board every five seconds for every open browser.
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PricingStatus }) => {
      const response = await apiRequest("PATCH", `/api/pricing-requests/${id}`, { status });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const requests: PricingRequest[] = useMemo(() => {
    if (!Array.isArray(dbRequests)) return [];
    
    return dbRequests.map((req) => {
      let rutas: Route[] = [];
      try {
        const parsed = JSON.parse(req.rutas || "[]");
        if (Array.isArray(parsed)) {
          rutas = parsed.map((r: Route, idx: number) => ({
            id: r.id || `ruta-${idx}`,
            origen: r.origen || "",
            destino: r.destino || "",
            cpOrigen: r.cpOrigen,
            cpDestino: r.cpDestino,
            volumen: r.volumen,
            frecuencia: r.frecuencia,
            targetCliente: r.targetCliente,
            tipoEquipo: r.tipoEquipo,
            costoEsperado: r.costoEsperado,
            ventaSugerida: r.ventaSugerida,
            ventaFinal: r.ventaFinal,
            monedaVenta: r.monedaVenta,
            requiereCruce: r.requiereCruce ?? (idx === 0 ? (req.requiereCruce || false) : false),
            ciudadCruce: r.ciudadCruce ?? (idx === 0 ? (req.ciudadCruce || "") : ""),
            stops: r.stops || [],
            ofertas: r.ofertas || [],
          }));
        }
      } catch {
        rutas = [];
      }
      
      const createdAt = req.createdAt ? new Date(req.createdAt) : new Date();
      const fecha = createdAt.toLocaleDateString("es-MX", { 
        day: "2-digit", 
        month: "short", 
        year: "numeric" 
      });

      let comentarios: { id: string; usuario: string; fecha: string; texto: string }[] = [];
      try {
        const parsedComentarios = JSON.parse(req.comentarios || "[]");
        if (Array.isArray(parsedComentarios)) {
          comentarios = parsedComentarios;
        }
      } catch {
        comentarios = [];
      }

      let historial: { fecha: string; accion: string; usuario: string }[] = [];
      try {
        const parsedHistorial = JSON.parse(req.historial || "[]");
        if (Array.isArray(parsedHistorial)) {
          historial = parsedHistorial;
        }
      } catch {
        historial = [];
      }

      return {
        id: req.id,
        cliente: req.cliente,
        prospecto: req.prospecto || undefined,
        division: req.division || undefined,
        rutas,
        tipoEquipo: req.tipoEquipo,
        status: req.status as PricingStatus,
        fecha,
        createdAtRaw: createdAt,
        salesRep: req.salesRep,
        peso: req.peso || undefined,
        unidadMedida: req.unidadMedida || undefined,
        producto: req.producto || undefined,
        tiempoCargaDescarga: req.tiempoCargaDescarga || undefined,
        accesorios: req.accesorios || undefined,
        requiereCruce: req.requiereCruce || undefined,
        ciudadCruce: req.ciudadCruce || undefined,
        linkGoogleSheet: req.linkDocumento || undefined,
        certificacionRequerida: req.certificacion || undefined,
        notasCargaComercial: req.notasCargaComercial || undefined,
        ltlAlto: req.ltlAlto || undefined,
        ltlAncho: req.ltlAncho || undefined,
        ltlLargo: req.ltlLargo || undefined,
        ltlPeso: req.ltlPeso || undefined,
        ltlImagenes: req.ltlImagenes || undefined,
        urgencia: req.urgencia || 0,
        fechaEntrega: req.fechaEntrega || undefined,
        esRFQ: req.esRFQ || false,
        comentarios,
        historial,
      };
    });
  }, [dbRequests]);

  const filteredRequests = useMemo(() => {
    let result = requests;
    
    // Sales rep only sees their own quotes
    if (user?.role === "sales_rep") {
      result = result.filter(r => r.salesRep === user.name);
    }
    
    // Carrier roles visibility logic:
    // - In "por_revisar" and "cotizando": see all quotes
    // - In other statuses: only see quotes where their offers were selected
    const carrierRoles = ["carrier_rep", "carrier_lead", "carrier_manager"];
    if (user?.role && carrierRoles.includes(user.role)) {
      const earlyStatuses = ["pendiente", "por_revisar", "cotizando"];
      result = result.filter(r => {
        // In early statuses, carriers can see all quotes
        if (earlyStatuses.includes(r.status)) {
          return true;
        }
        // carrier_manager can also see ALL quotes in "enviado" status
        if (user.role === "carrier_manager" && r.status === "enviado") {
          return true;
        }
        // In later statuses, only show if their offer was selected
        return r.rutas.some(ruta => 
          ruta.ofertas?.some(oferta => oferta.seleccionado && oferta.carrierRep === user.name)
        );
      });
    }
    
    if (divisionFilter !== "all") {
      result = result.filter(r => r.division === divisionFilter);
    }

    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      fromDate.setHours(0, 0, 0, 0);
      result = result.filter(r => r.createdAtRaw && r.createdAtRaw >= fromDate);
    }

    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      result = result.filter(r => r.createdAtRaw && r.createdAtRaw <= toDate);
    }
    
    return result;
  }, [requests, user?.role, user?.name, divisionFilter, dateFrom, dateTo]);

  const getDetailRequest = () => {
    if (!selectedRequest) return null;
    const currentRequest = requests.find(r => r.id === selectedRequest);
    if (!currentRequest) return null;
    
    return {
      id: currentRequest.id,
      cliente: currentRequest.cliente,
      prospecto: currentRequest.prospecto || "",
      salesRep: currentRequest.salesRep,
      division: currentRequest.division || "",
      tipoEquipo: currentRequest.tipoEquipo,
      peso: currentRequest.peso || "",
      unidadMedida: currentRequest.unidadMedida || "",
      producto: currentRequest.producto || "",
      tiempoCargaDescarga: currentRequest.tiempoCargaDescarga || "",
      accesorios: currentRequest.accesorios || [],
      requiereCruce: currentRequest.requiereCruce || false,
      ciudadCruce: currentRequest.ciudadCruce || "",
      certificacion: currentRequest.certificacionRequerida || "",
      linkDocumento: currentRequest.linkGoogleSheet || "",
      ltlAlto: currentRequest.ltlAlto || "",
      ltlAncho: currentRequest.ltlAncho || "",
      ltlLargo: currentRequest.ltlLargo || "",
      ltlPeso: currentRequest.ltlPeso || "",
      ltlImagenes: currentRequest.ltlImagenes || "",
      rutas: currentRequest.rutas.map((r, idx) => ({
        id: r.id || `ruta-${idx}`,
        origen: r.origen,
        destino: r.destino,
        cpOrigen: r.cpOrigen || "",
        cpDestino: r.cpDestino || "",
        volumen: r.volumen || "",
        frecuencia: r.frecuencia || "",
        targetCliente: r.targetCliente || "",
        tipoEquipo: r.tipoEquipo,
        ofertas: r.ofertas || [],
        costoEsperado: r.costoEsperado,
        ventaSugerida: r.ventaSugerida,
        ventaFinal: r.ventaFinal,
        monedaVenta: r.monedaVenta,
        requiereCruce: r.requiereCruce || false,
        ciudadCruce: r.ciudadCruce || "",
        stops: r.stops || [],
      })),
      status: currentRequest.status,
      fecha: currentRequest.fecha,
      notasComercial: currentRequest.notasCargaComercial || "",
      historial: currentRequest.historial && currentRequest.historial.length > 0 
        ? currentRequest.historial 
        : [{ fecha: currentRequest.fecha, accion: "Solicitud creada", usuario: currentRequest.salesRep }],
      comentarios: currentRequest.comentarios || [],
      urgencia: currentRequest.urgencia || 0,
      fechaEntrega: currentRequest.fechaEntrega || undefined,
      esRFQ: currentRequest.esRFQ || false,
    };
  };

  const canDropToStatus = (status: PricingStatus): boolean => {
    if (status === "cotizacion_enviada") {
      const salesRoles = ["sales_rep", "sales_lead", "sales_manager", "superadmin"];
      return !!user?.role && salesRoles.includes(user.role);
    }
    return true;
  };

  const handleStatusChange = (requestId: string, newStatus: PricingStatus) => {
    updateStatusMutation.mutate({ id: requestId, status: newStatus });
    
    const statusLabels: Record<PricingStatus, string> = {
      pendiente: "Pendiente de Info",
      por_revisar: "Por Revisar",
      cotizando: "Cotizando",
      enviado: "Enviado",
      cotizacion_enviada: "Cotización Enviada",
      feedback: "Feedback",
      ganada: "Ganada",
      perdida: "Perdida",
      rechazada: "Rechazada",
    };
    
    toast({
      title: "Estado actualizado",
      description: `Cotización movida a "${statusLabels[newStatus]}"`,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-destructive mb-2">Error al cargar las cotizaciones</p>
          <Button onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] })}>
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-board-title">Pricing Board</h1>
          <p className="text-muted-foreground mt-1">
            Gestiona y da seguimiento a todas las cotizaciones
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={divisionFilter} onValueChange={setDivisionFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-division-filter">
                <SelectValue placeholder="Todas las divisiones" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las divisiones</SelectItem>
                {divisiones.map((division) => (
                  <SelectItem key={division.id} value={division.nombre}>
                    {division.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-[140px]"
              data-testid="input-date-from"
            />
            <span className="text-muted-foreground text-sm">a</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-[140px]"
              data-testid="input-date-to"
            />
          </div>
          <div className="flex border rounded-md">
            <Button
              variant={viewMode === "kanban" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setViewMode("kanban")}
              data-testid="button-view-kanban"
              title="Vista Kanban (columnas)"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setViewMode("list")}
              data-testid="button-view-list"
              title="Vista Lista (tabla)"
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "rows" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setViewMode("rows")}
              data-testid="button-view-rows"
              title="Vista Filas (vertical)"
            >
              <Rows3 className="h-4 w-4" />
            </Button>
          </div>
          {user?.role !== "carrier_rep" && user?.role !== "carrier_lead" && user?.role !== "carrier_manager" && (
            <Link href="/new">
              <Button data-testid="button-new-quote">
                <Plus className="h-4 w-4 mr-2" />
                Nueva Cotización
              </Button>
            </Link>
          )}
        </div>
      </div>

      {filteredRequests.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-96 text-center">
          <p className="text-muted-foreground mb-4">No hay cotizaciones aún</p>
          {user?.role !== "carrier_rep" && user?.role !== "carrier_lead" && user?.role !== "carrier_manager" && (
            <Link href="/new">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Crear primera cotización
              </Button>
            </Link>
          )}
        </div>
      ) : viewMode === "kanban" ? (
        <KanbanBoard
          requests={filteredRequests}
          onViewDetail={handleViewDetail}
          onStatusChange={handleStatusChange}
          canDropToStatus={canDropToStatus}
        />
      ) : viewMode === "rows" ? (
        <KanbanBoard
          requests={filteredRequests}
          onViewDetail={handleViewDetail}
          onStatusChange={handleStatusChange}
          canDropToStatus={canDropToStatus}
          layout="vertical"
        />
      ) : (
        <div className="border rounded-md bg-card">
          <PricingFileTable 
            entries={filteredRequests.map(req => ({
              id: req.id,
              idRequest: req.id.substring(0, 8).toUpperCase(),
              cliente: req.cliente,
              division: req.division || "N/A",
              salesRep: req.salesRep,
              origen: req.rutas[0]?.origen || "N/A",
              destino: req.rutas[0]?.destino || "N/A",
              equipo: req.rutas[0]?.tipoEquipo || req.tipoEquipo,
              costo: req.rutas[0]?.costoEsperado || 0,
              tarifaAprobada: req.rutas[0]?.ventaFinal || req.rutas[0]?.ventaSugerida || 0,
              margen: (() => {
                const costo = req.rutas[0]?.costoEsperado;
                const venta = req.rutas[0]?.ventaFinal || req.rutas[0]?.ventaSugerida;
                return costo && venta ? ((venta - costo) / venta) * 100 : 0;
              })(),
              carrier: req.carrier || "Pendiente",
              carrierRep: "N/A",
              fechaVigencia: "N/A",
              fechaAprobacion: req.fecha,
              aprobadoPor: "N/A"
            }))} 
            onViewDetail={handleViewDetail} 
          />
        </div>
      )}

      <RequestDetailModal
        open={!!selectedRequest}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRequest(null);
            setSelectedTab(undefined);
          }
        }}
        request={getDetailRequest()}
        onStatusChange={(id, newStatus) => handleStatusChange(id, newStatus)}
        initialTab={selectedTab}
      />
    </div>
  );
}
