import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, type PricingStatus, pricingStatusConfig } from "./StatusBadge";
import { ArrowRight, Eye, Truck, ChevronDown, ChevronUp, MapPin, MessageCircle, AlertTriangle, Clock, Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const getStatusesByRole = (role: string | undefined): PricingStatus[] => {
  switch (role) {
    case "carrier_rep":
      return ["pendiente", "por_revisar"];
    case "carrier_lead":
      return ["pendiente", "por_revisar", "cotizando", "enviado"];
    case "carrier_manager":
      return ["pendiente", "por_revisar", "cotizando", "enviado", "rechazada"];
    case "sales_rep":
    case "sales_lead":
    case "sales_manager":
      return ["pendiente", "por_revisar", "enviado", "cotizacion_enviada", "feedback", "ganada", "perdida"];
    case "pricing":
      return ["pendiente", "por_revisar", "cotizando", "enviado", "feedback", "ganada", "perdida", "rechazada"];
    case "superadmin":
      return ["pendiente", "por_revisar", "cotizando", "enviado", "cotizacion_enviada", "feedback", "ganada", "perdida", "rechazada"];
    default:
      return [];
  }
};

export interface RouteStop {
  id: string;
  ubicacion: string;
  cp: string;
  tipo: "recoleccion" | "parada" | "entrega";
  notas?: string;
}

export interface Route {
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
  ofertas?: Array<{ id: string; carrier: string; costo: number; disponibilidad: number; carrierRep: string; fechaOferta: string; seleccionado?: boolean }>;
}

export interface PricingRequest {
  id: string;
  cliente: string;
  prospecto?: string;
  division?: string;
  rutas: Route[];
  tipoEquipo: string;
  peso?: string;
  unidadMedida?: string;
  producto?: string;
  certificacionRequerida?: string;
  tiempoCargaDescarga?: string;
  accesorios?: string[];
  requiereCruce?: boolean;
  ciudadCruce?: string;
  linkGoogleSheet?: string;
  notasCargaComercial?: string;
  feedback?: string;
  carrier?: string;
  costoEsperado?: number;
  ventaSugerida?: number;
  margen?: number;
  status: PricingStatus;
  fecha: string;
  createdAtRaw?: Date;
  salesRep: string;
  comentarios?: { id: string; usuario: string; fecha: string; texto: string }[];
  historial?: { fecha: string; accion: string; usuario: string }[];
  ltlAlto?: string;
  ltlAncho?: string;
  ltlLargo?: string;
  ltlPeso?: string;
  ltlImagenes?: string;
  urgencia?: number;
  fechaEntrega?: Date | string;
  esRFQ?: boolean;
}

interface PricingCardProps {
  request: PricingRequest;
  onViewDetail?: (id: string, tab?: string) => void;
}

export function PricingCard({ request, onViewDetail }: PricingCardProps) {
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();
  
  const formatCurrency = (value: number) => 
    new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value);

  const hasMultipleRoutes = request.rutas.length > 1;
  const displayedRoutes = showAllRoutes ? request.rutas : request.rutas.slice(0, 1);
  const hasPricingInfo = request.costoEsperado !== undefined && request.ventaSugerida !== undefined;
  
  const availableStatuses = getStatusesByRole(user?.role);
  const canChangeStatus = availableStatuses.length > 0;

  const urgencia = request.urgencia || 0;
  const isTerminal = ["ganada", "perdida", "rechazada"].includes(request.status);
  const dueDate = request.fechaEntrega ? new Date(request.fechaEntrega) : null;
  const now = new Date();
  const isOverdue = dueDate && !isTerminal && dueDate < now;
  const isDueSoon = dueDate && !isTerminal && !isOverdue && 
    (dueDate.getTime() - now.getTime()) < 2 * 24 * 60 * 60 * 1000;

  const urgencyBorderColor = urgencia >= 3 ? "border-l-red-500" :
    urgencia === 2 ? "border-l-orange-500" :
    urgencia === 1 ? "border-l-yellow-500" : "";

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: PricingStatus) => {
      const response = await apiRequest("PATCH", `/api/pricing-requests/${request.id}`, { status: newStatus });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
      toast({
        title: "Estatus actualizado",
        description: "El estatus se ha cambiado correctamente",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo actualizar el estatus",
        variant: "destructive",
      });
    },
  });

  const handleStatusChange = (newStatus: PricingStatus, e: React.MouseEvent) => {
    e.stopPropagation();
    if (newStatus !== request.status) {
      updateStatusMutation.mutate(newStatus);
    }
  };

  return (
    <Card 
      className={cn(
        "hover-elevate cursor-pointer overflow-visible",
        urgencia > 0 && "border-l-4",
        urgencyBorderColor,
        isOverdue && "ring-1 ring-red-500/50"
      )} 
      data-testid={`pricing-card-${request.id}`}
      onClick={() => onViewDetail?.(request.id)}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            {urgencia > 0 && (
              <div className={cn(
                "flex items-center gap-0.5 text-xs font-bold",
                urgencia >= 3 ? "text-red-500" : urgencia === 2 ? "text-orange-500" : "text-yellow-500"
              )} data-testid={`urgency-indicator-${request.id}`}>
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{"!".repeat(urgencia)}</span>
              </div>
            )}
            {isOverdue && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5" data-testid={`overdue-badge-${request.id}`}>
                <Clock className="h-3 w-3 mr-0.5" />
                Vencida
              </Badge>
            )}
            {isDueSoon && !isOverdue && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 border-orange-500 text-orange-500" data-testid={`due-soon-badge-${request.id}`}>
                <Clock className="h-3 w-3 mr-0.5" />
                Por vencer
              </Badge>
            )}
            {request.esRFQ && (
              <Badge className="text-xs px-2 py-0.5 h-6 bg-blue-600 text-white dark:bg-blue-500 dark:text-white hover:bg-blue-700 dark:hover:bg-blue-600 font-bold tracking-wide shadow-sm ring-1 ring-blue-700/30" data-testid={`badge-rfq-${request.id}`}>
                📋 RFQ
              </Badge>
            )}
          </div>
          {canChangeStatus ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <button className="focus:outline-none" data-testid={`status-dropdown-${request.id}`}>
                  <StatusBadge status={request.status} size="sm" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                {availableStatuses.map((status) => {
                  const config = pricingStatusConfig[status];
                  const Icon = config.icon;
                  return (
                    <DropdownMenuItem
                      key={status}
                      onClick={(e) => handleStatusChange(status, e)}
                      className={cn(
                        "gap-2 cursor-pointer",
                        status === request.status && "bg-accent"
                      )}
                      data-testid={`status-option-${status}`}
                    >
                      <Icon className="h-4 w-4" />
                      {config.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <StatusBadge status={request.status} size="sm" />
          )}
        </div>
        <div className="mb-3">
          <h4 className="font-semibold text-sm truncate">{request.cliente}</h4>
          <span className="text-xs font-mono text-muted-foreground">#{request.id}</span>
        </div>

        <div className="space-y-2 mb-3">
          {displayedRoutes.map((ruta, index) => (
            <div key={index} className="space-y-1">
              <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                {hasMultipleRoutes && (
                  <MapPin className="h-3 w-3 flex-shrink-0 text-primary" />
                )}
                <span className="break-words">{ruta.origen}</span>
                <ArrowRight className="h-3 w-3 flex-shrink-0" />
                <span className="break-words">{ruta.destino}</span>
                {ruta.requiereCruce && (
                  <Globe2
                    className="h-3 w-3 flex-shrink-0 text-blue-500"
                    aria-label={ruta.ciudadCruce ? `Cruce: ${ruta.ciudadCruce}` : "Requiere cruce"}
                  >
                    <title>{ruta.ciudadCruce ? `Cruce: ${ruta.ciudadCruce}` : "Requiere cruce"}</title>
                  </Globe2>
                )}
                {ruta.stops && ruta.stops.length > 0 && (
                  <span
                    className="text-[10px] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5"
                    title={ruta.stops.map((s) => `${s.tipo}: ${s.ubicacion}`).join("\n")}
                  >
                    · {ruta.stops.length} stop{ruta.stops.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {(ruta.volumen || ruta.frecuencia || ruta.targetCliente) && (
                <div className="flex flex-wrap items-center gap-2 pl-4 text-xs">
                  {ruta.volumen && (
                    <span className="text-muted-foreground">Vol: {ruta.volumen}</span>
                  )}
                  {ruta.frecuencia && (
                    <span className="text-muted-foreground">{ruta.frecuencia}</span>
                  )}
                  {ruta.targetCliente && (
                    <span className="font-mono text-primary font-medium">Target: {ruta.targetCliente}</span>
                  )}
                </div>
              )}
            </div>
          ))}
          
          {hasMultipleRoutes && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs px-2 gap-1 text-primary"
              onClick={(e) => {
                e.stopPropagation();
                setShowAllRoutes(!showAllRoutes);
              }}
              data-testid={`button-toggle-routes-${request.id}`}
            >
              {showAllRoutes ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  Ocultar rutas
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  +{request.rutas.length - 1} ruta{request.rutas.length > 2 ? "s" : ""} más
                </>
              )}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex items-center gap-1.5 px-2 py-1 bg-muted rounded-md text-xs font-medium">
            <Truck className="h-3 w-3" />
            {request.tipoEquipo}
          </div>
          {hasMultipleRoutes && (
            <Badge variant="secondary" className="text-xs">
              {request.rutas.length} rutas
            </Badge>
          )}
          {request.accesorios && request.accesorios.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {request.accesorios.slice(0, 2).map((acc) => (
                <Badge key={acc} variant="outline" className="text-xs">
                  {acc}
                </Badge>
              ))}
              {request.accesorios.length > 2 && (
                <Badge variant="outline" className="text-xs">
                  +{request.accesorios.length - 2}
                </Badge>
              )}
            </div>
          )}
        </div>

        {hasPricingInfo && (
          <div className="grid grid-cols-2 gap-2 text-sm mb-3">
            {request.carrier && (
              <div>
                <span className="text-muted-foreground text-xs">Carrier</span>
                <p className="font-medium truncate">{request.carrier}</p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground text-xs">Costo</span>
              <p className="font-medium font-mono">{formatCurrency(request.costoEsperado!)}</p>
            </div>
            {(() => {
              // Si alguna ruta tiene venta final, mostrar el total efectivo (final ?? sugerida por ruta),
              // agrupado por moneda para no mezclar MXN y USD
              const tieneFinal = request.rutas.some(r => r.ventaFinal != null);
              if (tieneFinal) {
                const sumarPorMoneda = (getMonto: (r: typeof request.rutas[number]) => number | null | undefined) => {
                  const acc: Record<string, number> = {};
                  for (const r of request.rutas) {
                    const monto = getMonto(r);
                    if (monto == null) continue;
                    const moneda = r.monedaVenta || "MXN";
                    acc[moneda] = (acc[moneda] || 0) + monto;
                  }
                  return acc;
                };
                const fmt = (porMoneda: Record<string, number>) =>
                  Object.entries(porMoneda)
                    .map(([moneda, monto]) =>
                      new Intl.NumberFormat("es-MX", { style: "currency", currency: moneda }).format(monto))
                    .join(" + ");
                const finalTexto = fmt(sumarPorMoneda((r) => r.ventaFinal ?? r.ventaSugerida));
                const sugeridaPorMoneda = sumarPorMoneda((r) => r.ventaSugerida);
                return (
                  <div>
                    <span className="text-muted-foreground text-xs">Venta Final</span>
                    <p className="font-medium font-mono text-emerald-700 dark:text-emerald-400">{finalTexto}</p>
                    {Object.keys(sugeridaPorMoneda).length > 0 && (
                      <p className="text-[10px] text-muted-foreground font-mono line-through">{fmt(sugeridaPorMoneda)}</p>
                    )}
                  </div>
                );
              }
              return (
                <div>
                  <span className="text-muted-foreground text-xs">Venta</span>
                  <p className="font-medium font-mono">{formatCurrency(request.ventaSugerida!)}</p>
                </div>
              );
            })()}
            {request.margen !== undefined && (
              <div>
                <span className="text-muted-foreground text-xs">Margen</span>
                <p className={cn(
                  "font-semibold font-mono",
                  request.margen >= 15 ? "text-emerald-600 dark:text-emerald-400" : 
                  request.margen >= 10 ? "text-amber-600 dark:text-amber-400" : 
                  "text-red-600 dark:text-red-400"
                )}>
                  {request.margen.toFixed(1)}%
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-medium truncate">{request.salesRep}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{request.fecha}</span>
                {dueDate && !isTerminal && (
                  <span className={cn(
                    "text-[10px]",
                    isOverdue ? "text-red-500 font-semibold" : isDueSoon ? "text-orange-500" : "text-muted-foreground"
                  )}>
                    Entrega: {dueDate.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                  </span>
                )}
              </div>
            </div>
            {request.comentarios && request.comentarios.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1 text-muted-foreground hover:text-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewDetail?.(request.id, "comentarios");
                }}
                data-testid={`button-comments-${request.id}`}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span className="font-medium">{request.comentarios.length}</span>
              </Button>
            )}
          </div>
          <Button 
            size="sm" 
            variant="ghost" 
            className="h-7 text-xs gap-1 flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onViewDetail?.(request.id);
            }}
            data-testid={`button-view-detail-${request.id}`}
          >
            <Eye className="h-3 w-3" />
            Ver Detalle
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
