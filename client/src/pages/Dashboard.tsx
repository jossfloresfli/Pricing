import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/MetricCard";
import { PricingCard, type PricingRequest } from "@/components/PricingCard";
import { RequestDetailModal } from "@/components/RequestDetailModal";
import { Clock, Send, Trophy, ThumbsDown, Plus, ArrowRight, Loader2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PricingStatus } from "@/components/StatusBadge";
import type { PricingRequest as DBPricingRequest } from "@shared/schema";

interface DashboardStats {
  total: number;
  activas: number;
  ganadas: number;
  perdidas: number;
  rechazadas: number;
  porStatus: Record<PricingStatus, number>;
}

interface CarrierOffer {
  id: string;
  carrier: string;
  costo: number;
  disponibilidad: number;
  carrierRep: string;
  fechaOferta: string;
  seleccionado?: boolean;
}

interface RouteStop {
  id: string;
  ubicacion: string;
  cp: string;
  tipo: "recoleccion" | "parada" | "entrega";
  notas?: string;
}

interface Route {
  id?: string;
  origen: string;
  destino: string;
  cpOrigen?: string;
  cpDestino?: string;
  volumen?: string;
  frecuencia?: string;
  targetCliente?: string;
  tipoEquipo?: string;
  costoEsperado?: number;
  ventaSugerida?: number;
  ventaFinal?: number;
  monedaVenta?: "MXN" | "USD";
  requiereCruce?: boolean;
  ciudadCruce?: string;
  stops?: RouteStop[];
  ofertas?: CarrierOffer[];
}

export default function Dashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [initialTabFromUrl, setInitialTabFromUrl] = useState<string | undefined>(undefined);
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const detail = params.get("detail");
    const tab = params.get("tab");
    if (detail) {
      setSelectedRequest(detail);
      if (tab) setInitialTabFromUrl(tab);
    }
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedRequest) {
      url.searchParams.set("detail", selectedRequest);
      if (initialTabFromUrl) url.searchParams.set("tab", initialTabFromUrl);
    } else {
      url.searchParams.delete("detail");
      url.searchParams.delete("tab");
      if (initialTabFromUrl) setInitialTabFromUrl(undefined);
    }
    window.history.replaceState({}, "", url.toString());
  }, [selectedRequest, initialTabFromUrl]);

  const { data: dbRequests = [], isLoading: loadingRequests } = useQuery<DBPricingRequest[]>({
    queryKey: ["/api/pricing-requests"],
    refetchInterval: 10000,
  });

  const { data: stats, isLoading: loadingStats } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    refetchInterval: 10000,
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

  const requests = useMemo(() => {
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
        createdAt: req.createdAt,
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
        comentarios,
        historial,
      };
    });
  }, [dbRequests]);

  // Filter requests based on user role
  const filteredRequests = useMemo(() => {
    if (!user) return requests;
    
    // Sales rep only sees their own quotes
    if (user.role === "sales_rep") {
      return requests.filter(req => req.salesRep === user.name);
    }
    
    // Carrier roles visibility logic:
    // - In "pendiente", "por_revisar" and "cotizando": see all quotes
    // - In other statuses: only see quotes where their offers were selected
    const carrierRoles = ["carrier_rep", "carrier_lead", "carrier_manager"];
    if (carrierRoles.includes(user.role)) {
      const earlyStatuses = ["pendiente", "por_revisar", "cotizando"];
      return requests.filter(req => {
        if (earlyStatuses.includes(req.status)) {
          return true;
        }
        // carrier_manager can also see ALL quotes in "enviado" status
        if (user.role === "carrier_manager" && req.status === "enviado") {
          return true;
        }
        return req.rutas.some(ruta => 
          ruta.ofertas?.some(oferta => oferta.seleccionado && oferta.carrierRep === user.name)
        );
      });
    }
    
    // All other roles see all requests
    return requests;
  }, [requests, user]);

  const recentRequests = useMemo(() => {
    return [...filteredRequests]
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 4);
  }, [filteredRequests]);

  const getStatusAction = (status: PricingStatus): string => {
    const statusActions: Record<PricingStatus, string> = {
      pendiente: "Solicitud creada",
      por_revisar: "Enviada a revisión",
      cotizando: "En cotización",
      enviado: "Enviado a ventas",
      cotizacion_enviada: "Enviada al cliente",
      feedback: "Feedback recibido",
      ganada: "Cotización ganada",
      perdida: "Cotización perdida",
      rechazada: "Cotización rechazada",
    };
    return statusActions[status] || "Actualización";
  };

  const getStatusColor = (status: PricingStatus): string => {
    const colors: Record<PricingStatus, string> = {
      pendiente: "bg-amber-500",
      por_revisar: "bg-blue-500",
      cotizando: "bg-purple-500",
      enviado: "bg-cyan-500",
      cotizacion_enviada: "bg-teal-500",
      feedback: "bg-orange-500",
      ganada: "bg-emerald-500",
      perdida: "bg-gray-500",
      rechazada: "bg-red-500",
    };
    return colors[status] || "bg-primary";
  };

  const recentActivity = useMemo(() => {
    return filteredRequests
      .slice(0, 6)
      .map((req) => ({
        id: req.id,
        action: getStatusAction(req.status),
        detail: req.cliente,
        user: req.salesRep,
        date: req.fecha,
        status: req.status,
      }));
  }, [filteredRequests]);

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
    };
  };

  const isLoading = loadingRequests || loadingStats;

  // Calculate filtered stats for sales_rep and carrier_rep roles
  const filteredStats = useMemo(() => {
    if (!user || (user.role !== "sales_rep" && user.role !== "carrier_rep")) {
      // Use server stats for other roles
      return {
        porStatus: stats?.porStatus ?? {},
        ganadas: stats?.ganadas ?? 0,
        perdidas: stats?.perdidas ?? 0,
        rechazadas: stats?.rechazadas ?? 0,
      };
    }
    
    // Calculate stats from filtered requests
    const porStatus: Record<string, number> = {};
    let ganadas = 0;
    let perdidas = 0;
    let rechazadas = 0;
    
    filteredRequests.forEach(req => {
      porStatus[req.status] = (porStatus[req.status] || 0) + 1;
      if (req.status === "ganada") ganadas++;
      if (req.status === "perdida") perdidas++;
      if (req.status === "rechazada") rechazadas++;
    });
    
    return { porStatus, ganadas, perdidas, rechazadas };
  }, [filteredRequests, stats, user]);

  const porStatus = filteredStats.porStatus as Record<string, number>;
  const pendientes = porStatus["pendiente"] ?? 0;
  const porRevisar = porStatus["por_revisar"] ?? 0;
  const cotizando = porStatus["cotizando"] ?? 0;
  const enviado = porStatus["enviado"] ?? 0;
  const feedback = porStatus["feedback"] ?? 0;

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-dashboard-title">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Bienvenido, {user?.name}</p>
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

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard
            title="Pendientes"
            value={pendientes + porRevisar}
            icon={Clock}
            iconClassName="bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
            onClick={() => navigate("/board?filter=pendientes")}
          />
          <MetricCard
            title="En Proceso"
            value={cotizando + enviado + feedback}
            icon={Send}
            iconClassName="bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400"
            onClick={() => navigate("/board?filter=proceso")}
          />
          <MetricCard
            title="Ganadas"
            value={filteredStats.ganadas}
            icon={Trophy}
            iconClassName="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
            onClick={() => navigate("/board?filter=ganada")}
          />
          <MetricCard
            title="Perdidas"
            value={filteredStats.perdidas + filteredStats.rechazadas}
            icon={ThumbsDown}
            iconClassName="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            onClick={() => navigate("/board?filter=perdida")}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-lg">Cotizaciones Recientes</CardTitle>
              <Link href="/board">
                <Button variant="ghost" size="sm" className="gap-1" data-testid="link-view-all">
                  Ver todas
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {loadingRequests ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : recentRequests.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-center">
                <p className="text-muted-foreground mb-4">No hay cotizaciones aún</p>
                <Link href="/new">
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Crear primera cotización
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {recentRequests.map((request) => (
                  <PricingCard
                    key={request.id}
                    request={request}
                    onViewDetail={(id) => setSelectedRequest(id)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Actividad Reciente</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRequests ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : recentActivity.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">Sin actividad reciente</p>
            ) : (
              <div className="space-y-4">
                {recentActivity.map((item) => (
                  <div key={item.id} className="flex items-start gap-3" data-testid={`activity-item-${item.id}`}>
                    <div className={`h-2 w-2 rounded-full mt-2 ${getStatusColor(item.status)}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{item.action}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.detail}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                        <span className="font-medium">{item.user}</span>
                        <span>-</span>
                        <span>{item.date}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <RequestDetailModal
        open={!!selectedRequest}
        onOpenChange={(open) => !open && setSelectedRequest(null)}
        request={getDetailRequest()}
        onStatusChange={handleStatusChange}
        initialTab={initialTabFromUrl}
      />
    </div>
  );
}
