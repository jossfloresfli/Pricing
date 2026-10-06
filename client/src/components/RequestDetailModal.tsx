import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { MentionInput, parseMentions, renderMentionText, getCleanText } from "@/components/MentionInput";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge, type PricingStatus } from "./StatusBadge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowRight,
  Edit3,
  Truck,
  MessageSquare,
  Clock,
  Plus,
  Package,
  User,
  MapPin,
  ExternalLink,
  Trash2,
  Check,
  Share2,
  Pencil,
  Sparkles,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface CarrierOffer {
  id: string;
  carrier: string;
  costo: number;
  disponibilidad: number;
  carrierRep: string;
  fechaOferta: string;
  seleccionado?: boolean;
  frecuencia?: string;
  moneda?: "MXN" | "USD";
}

export interface RouteStop {
  id: string;
  ubicacion: string;
  cp: string;
  tipo: "recoleccion" | "parada" | "entrega";
  notas?: string;
}

export interface RouteWithOffers {
  id: string;
  origen: string;
  destino: string;
  cpOrigen?: string;
  cpDestino?: string;
  volumen?: string;
  frecuencia?: string;
  targetCliente?: string;
  tipoEquipo?: string;
  ofertas: CarrierOffer[];
  costoEsperado?: number;
  ventaSugerida?: number;
  ventaFinal?: number;
  monedaVenta?: "MXN" | "USD";
  requiereCruce?: boolean;
  ciudadCruce?: string;
  stops?: RouteStop[];
}

interface RequestDetail {
  id: string;
  cliente: string;
  prospecto?: string;
  salesRep: string;
  division: string;
  tipoEquipo: string;
  peso: string;
  unidadMedida?: string;
  producto: string;
  tiempoCargaDescarga?: string;
  accesorios?: string[];
  requiereCruce?: boolean;
  ciudadCruce?: string;
  certificacion: string;
  linkDocumento?: string;
  ltlAlto?: string;
  ltlAncho?: string;
  ltlLargo?: string;
  ltlPeso?: string;
  ltlImagenes?: string;
  rutas: RouteWithOffers[];
  carrier?: string;
  costoEsperado?: number;
  ventaSugerida?: number;
  margen?: number;
  status: PricingStatus;
  fecha: string;
  notasComercial: string;
  historial: { fecha: string; accion: string; usuario: string }[];
  comentarios: { id: string; usuario: string; fecha: string; texto: string }[];
  urgencia?: number;
  fechaEntrega?: Date | string;
  esRFQ?: boolean;
}

interface RequestDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: RequestDetail | null;
  onEdit?: (id: string) => void;
  onStatusChange?: (id: string, newStatus: PricingStatus) => void;
  onDelete?: (id: string) => void;
  initialTab?: string;
}

const allStatuses: { value: PricingStatus; label: string }[] = [
  { value: "pendiente", label: "Pendiente de Info" },
  { value: "por_revisar", label: "Por Revisar" },
  { value: "cotizando", label: "Cotizando" },
  { value: "enviado", label: "Enviado" },
  { value: "cotizacion_enviada", label: "Cotización Enviada" },
  { value: "feedback", label: "Feedback" },
  { value: "ganada", label: "Ganada" },
  { value: "perdida", label: "Perdida" },
  { value: "rechazada", label: "Rechazada" },
];

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
      return ["pendiente", "por_revisar", "cotizacion_enviada", "ganada", "perdida"];
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

// Memoria de precotizaciones por cotización: al cambiar de ticket se conserva el
// resultado calculado y se restaura al volver a abrirlo (dura mientras la app esté abierta).
const predSessionCache: Record<string, {
  predictions: Record<string, any>;
  workingRef: Record<string, { key: string; motivo?: string }>;
  collapsed: Record<string, boolean>;
  expanded: Record<string, boolean>;
}> = {};

export function RequestDetailModal({
  open,
  onOpenChange,
  request,
  onEdit,
  onStatusChange,
  onDelete,
  initialTab,
}: RequestDetailModalProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab || "overview");
  const { toast } = useToast();
  const [newComment, setNewComment] = useState("");

  const { data: mentionUsers = [] } = useQuery<{ id: string; name: string; role: string }[]>({
    queryKey: ["/api/users-for-mentions"],
  });
  const [showAddOfferForm, setShowAddOfferForm] = useState<string | null>(null);
  const [newOffer, setNewOffer] = useState({ carrier: "", costo: "", disponibilidad: "", frecuencia: "semanal", moneda: "MXN" as "MXN" | "USD" });
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [editingOfferData, setEditingOfferData] = useState({ carrier: "", costo: "", disponibilidad: "", frecuencia: "semanal", moneda: "MXN" as "MXN" | "USD" });
  const [routeSalesInfo, setRouteSalesInfo] = useState<Record<string, { costoEsperado: string; ventaSugerida: string; margen: string; moneda: "MXN" | "USD" }>>({});
  // Venta final por ruta: qué ruta está en edición y el valor capturado
  const [ventaFinalEditing, setVentaFinalEditing] = useState<Record<string, boolean>>({});
  const [ventaFinalDraft, setVentaFinalDraft] = useState<Record<string, string>>({});
  const [isSavingVentaFinal, setIsSavingVentaFinal] = useState(false);
  const [localOffers, setLocalOffers] = useState<Record<string, CarrierOffer[]>>({});
  const [isSavingSales, setIsSavingSales] = useState(false);
  const [predictingRouteId, setPredictingRouteId] = useState<string | null>(null);
  const [routePredictions, setRoutePredictions] = useState<Record<string, {
    motor?: string;
    costoEstimado: number | null;
    costoCentral?: number | null;
    costoProtegido?: number | null;
    rangoBajo: number | null;
    rangoAlto: number | null;
    modeloSeleccionado?: string | null;
    accion?: string | null;
    razones?: string[];
    razonesGuardrails?: string[];
    revisionRequerida?: boolean;
    estadoDecision?: string | null;
    nivelHistorial?: string | null;
    conteoHistorialRuta?: number | null;
    decil?: string | null;
    distanciaKm: number | null;
    fuenteDistancia: string;
    componentes?: Record<string, number | null> | null;
    tipoCambioUsd?: number | null;
    costoEstimadoUsd?: number | null;
  }>>({});
  const [expandedPredOptions, setExpandedPredOptions] = useState<Record<string, boolean>>({});
  const [predCollapsed, setPredCollapsed] = useState<Record<string, boolean>>({});
  const [predWorkingRef, setPredWorkingRef] = useState<Record<string, { key: string; motivo?: string }>>({});
  const [predPendingAlt, setPredPendingAlt] = useState<Record<string, { key: string; motivo: string }>>({});
  const [, navigate] = useLocation();
  const [localComentarios, setLocalComentarios] = useState<{ id: string; usuario: string; fecha: string; texto: string }[]>([]);
  const [localHistorial, setLocalHistorial] = useState<{ fecha: string; accion: string; usuario: string }[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Local status state to show immediate feedback
  const [localStatus, setLocalStatus] = useState<PricingStatus | null>(null);
  const displayStatus = localStatus ?? request?.status ?? "pendiente";
  
  // Reset local status when request changes or modal opens/closes
  useEffect(() => {
    setLocalStatus(null);
  }, [request?.id, open]);

  // Al cambiar de ticket, restaurar las precotizaciones guardadas de esa cotización
  // (o mostrar limpio si nunca se calculó). Cambiar de pestaña no borra nada.
  const skipPredSaveRef = useRef(false);
  const currentRequestIdRef = useRef<string | null>(null);
  useEffect(() => {
    const cached = request?.id ? predSessionCache[request.id] : undefined;
    currentRequestIdRef.current = request?.id ?? null;
    skipPredSaveRef.current = true;
    setRoutePredictions(cached?.predictions ?? {});
    setPredWorkingRef(cached?.workingRef ?? {});
    setPredCollapsed(cached?.collapsed ?? {});
    setExpandedPredOptions(cached?.expanded ?? {});
    setPredPendingAlt({});
    setPredictingRouteId(null);
  }, [request?.id, open]);

  // Guardar en memoria las precotizaciones de la cotización actual
  useEffect(() => {
    if (skipPredSaveRef.current) {
      skipPredSaveRef.current = false;
      return;
    }
    if (!request?.id || !open) return;
    predSessionCache[request.id] = {
      predictions: routePredictions,
      workingRef: predWorkingRef,
      collapsed: predCollapsed,
      expanded: expandedPredOptions,
    };
  }, [request?.id, open, routePredictions, predWorkingRef, predCollapsed, expandedPredOptions]);
  
  // Edit mode state for sales roles
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editedFields, setEditedFields] = useState({
    producto: "",
    peso: "",
    unidadMedida: "",
    tiempoCargaDescarga: "",
    notasCargaComercial: "",
    ltlLargo: "",
    ltlAncho: "",
    ltlAlto: "",
    ltlPeso: "",
    ltlImagenes: "",
  });
  const [localRutas, setLocalRutas] = useState<RouteWithOffers[]>([]);
  const [showAddRouteForm, setShowAddRouteForm] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [editingRouteData, setEditingRouteData] = useState({
    origen: "",
    destino: "",
    cpOrigen: "",
    cpDestino: "",
    volumen: "",
    frecuencia: "",
    targetCliente: "",
  });
  const [newRoute, setNewRoute] = useState({
    origen: "",
    destino: "",
    cpOrigen: "",
    cpDestino: "",
    volumen: "",
    frecuencia: "",
    targetCliente: "",
    tipoEquipo: "",
  });

  const { data: tiposEquipoCatalog = [] } = useQuery<{ id: string; nombre: string }[]>({
    queryKey: ["/api/tipos-equipo"],
    enabled: open,
  });

  // Equipos de la cotización (el resumen puede ser "Caja Seca 53, Plataforma")
  const equiposCotizacion = (request?.tipoEquipo || "")
    .split(", ")
    .map((e) => e.trim())
    .filter(Boolean);
  const equiposOpciones = Array.from(
    new Set([...equiposCotizacion, ...tiposEquipoCatalog.map((e) => e.nombre)]),
  );

  // Equipo a mostrar para una ruta: el propio de la fila; si no tiene (cotización
  // vieja), sólo cae al de la cotización cuando ésta tiene un único equipo.
  const equipoDeRuta = (ruta: { tipoEquipo?: string }) =>
    ruta.tipoEquipo || (equiposCotizacion.length === 1 ? equiposCotizacion[0] : "");

  // Update activeTab when initialTab changes or modal opens
  useEffect(() => {
    if (open) {
      const canViewOffersForUser = true;
      const requestedTab = initialTab || "overview";
      const safeTab = requestedTab === "ofertas" && !canViewOffersForUser ? "overview" : requestedTab;
      setActiveTab(safeTab);
    }
  }, [open, initialTab, user?.role]);

  const handleShare = async () => {
    if (!request) return;
    const url = `${window.location.origin}${window.location.pathname}?detail=${request.id}&tab=${activeTab}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copiado", description: "El enlace a esta cotización se copió al portapapeles" });
    } catch {
      toast({ title: "Error", description: "No se pudo copiar el link", variant: "destructive" });
    }
  };

  // Initialize routeSalesInfo, localComentarios, and localHistorial from request when modal opens
  useEffect(() => {
    if (request && open) {
      const initialRouteSalesInfo: Record<string, { costoEsperado: string; ventaSugerida: string; margen: string; moneda: "MXN" | "USD" }> = {};
      for (const ruta of request.rutas) {
        const costo = ruta.costoEsperado || 0;
        const venta = ruta.ventaSugerida || 0;
        const marginCalc = costo > 0 ? ((venta - costo) / costo) * 100 : 10;
        initialRouteSalesInfo[ruta.id] = {
          costoEsperado: ruta.costoEsperado?.toString() || "",
          ventaSugerida: ruta.ventaSugerida?.toString() || "",
          margen: marginCalc.toFixed(1),
          moneda: ruta.monedaVenta || "MXN",
        };
      }
      setRouteSalesInfo(initialRouteSalesInfo);
      setLocalComentarios(request.comentarios || []);
      setLocalHistorial(request.historial || []);
      setLocalRutas(request.rutas || []);
      setEditedFields({
        producto: request.producto || "",
        peso: request.peso || "",
        unidadMedida: request.unidadMedida || "TON",
        tiempoCargaDescarga: request.tiempoCargaDescarga || "",
        notasCargaComercial: request.notasComercial || "",
        ltlLargo: request.ltlLargo || "",
        ltlAncho: request.ltlAncho || "",
        ltlAlto: request.ltlAlto || "",
        ltlPeso: request.ltlPeso || "",
        ltlImagenes: request.ltlImagenes || "",
      });
      setIsEditMode(false);
      setShowAddRouteForm(false);
      setEditingRouteId(null);
    }
  }, [request?.id, open]);

  useEffect(() => {
    if (request && open) {
      const updatedInfo: Record<string, { costoEsperado: string; ventaSugerida: string; margen: string; moneda: "MXN" | "USD" }> = {};
      for (const ruta of request.rutas) {
        const costo = ruta.costoEsperado || 0;
        const venta = ruta.ventaSugerida || 0;
        const marginCalc = costo > 0 ? ((venta - costo) / costo) * 100 : 10;
        updatedInfo[ruta.id] = {
          costoEsperado: ruta.costoEsperado?.toString() || "",
          ventaSugerida: ruta.ventaSugerida?.toString() || "",
          margen: marginCalc.toFixed(1),
          moneda: ruta.monedaVenta || "MXN",
        };
      }
      setRouteSalesInfo(updatedInfo);
    }
  }, [request?.rutas, open]);

  if (!request) return null;

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value);

  const formatOfferCost = (value: number, moneda?: "MXN" | "USD") =>
    new Intl.NumberFormat(moneda === "USD" ? "en-US" : "es-MX", {
      style: "currency",
      currency: moneda === "USD" ? "USD" : "MXN",
    }).format(value);

  const isCarrierRole = user?.role === "carrier_rep" || user?.role === "carrier_lead" || user?.role === "carrier_manager";
  const canPredictTarifa = !(user?.role || "").toLowerCase().includes("sales");
  const canEdit = user?.role === "superadmin" || user?.role === "sales_rep" || user?.role === "sales_lead" || user?.role === "sales_manager";
  
  // Editable statuses for sales roles
  const editableStatuses: PricingStatus[] = ["pendiente", "por_revisar", "cotizando", "feedback"];
  const canEditInCurrentStatus = canEdit && editableStatuses.includes(request.status);
  const canDelete = user?.role === "superadmin" || user?.role === "sales_rep" || user?.role === "sales_lead" || user?.role === "sales_manager";
  const canEditFechaEntrega = user?.role === "sales_rep" || user?.role === "sales_lead" || user?.role === "sales_manager" || user?.role === "superadmin";
  const canAddOffer = isCarrierRole || user?.role === "pricing" || user?.role === "superadmin";
  const canAddSalesInfo = user?.role === "carrier_lead" || user?.role === "carrier_manager" || user?.role === "pricing" || user?.role === "superadmin";
  // Sales roles can VIEW (read-only) the venta/costo/margen saved per route, but cannot edit it
  const canViewSalesInfo = user?.role === "sales_rep" || user?.role === "sales_lead" || user?.role === "sales_manager";
  // Venta final: roles de ventas, pricing y superadmin (no carriers).
  const canEditVentaFinal = user?.role === "sales_rep" || user?.role === "sales_lead" || user?.role === "sales_manager" || user?.role === "pricing" || user?.role === "superadmin";
  const canSelectOffer = user?.role === "carrier_lead" || user?.role === "carrier_manager" || user?.role === "pricing" || user?.role === "superadmin";
  const canViewOffers = true;
  const allowedStatuses = getStatusesByRole(user?.role);
  const availableStatusOptions = allStatuses.filter(s => allowedStatuses.includes(s.value));

  const handleUrgencyChange = async (newUrgency: number) => {
    try {
      const urgencyLabels = ["Sin urgencia", "Baja (!)", "Media (!!)", "Alta (!!!)"];
      const updatedHistorial = await addHistorialEntry(
        `Cambió urgencia a: ${urgencyLabels[newUrgency]}`,
        localHistorial
      );
      await apiRequest("PATCH", `/api/pricing-requests/${request.id}`, {
        urgencia: newUrgency,
        historial: JSON.stringify(updatedHistorial),
      });
      setLocalHistorial(updatedHistorial);
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
      toast({
        title: newUrgency === 0 ? "Urgencia removida" : "Urgencia actualizada",
        description: newUrgency === 0 ? "Se removió la urgencia" : `Urgencia establecida a ${"!".repeat(newUrgency)}`,
      });
    } catch {
      toast({ title: "Error", description: "No se pudo actualizar la urgencia", variant: "destructive" });
    }
  };

  const handleFechaEntregaChange = async (dateStr: string) => {
    try {
      const dateLabel = dateStr ? new Date(dateStr).toLocaleDateString("es-MX") : "sin fecha";
      const updatedHistorial = await addHistorialEntry(
        `Cambió fecha de entrega a: ${dateLabel}`,
        localHistorial
      );
      await apiRequest("PATCH", `/api/pricing-requests/${request.id}`, {
        fechaEntrega: dateStr ? new Date(dateStr).toISOString() : null,
        historial: JSON.stringify(updatedHistorial),
      });
      setLocalHistorial(updatedHistorial);
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
      toast({ title: "Fecha de entrega actualizada" });
    } catch {
      toast({ title: "Error", description: "No se pudo actualizar la fecha", variant: "destructive" });
    }
  };

  // Handle save edits for sales roles
  const handleSaveEdits = async () => {
    if (!request) return;
    setIsSavingEdit(true);
    try {
      const updatedHistorial = await addHistorialEntry(
        `Editó campos de la cotización`,
        localHistorial
      );
      
      await apiRequest("PATCH", `/api/pricing-requests/${request.id}`, {
        producto: editedFields.producto || null,
        peso: editedFields.peso || null,
        unidadMedida: editedFields.unidadMedida || null,
        tiempoCargaDescarga: editedFields.tiempoCargaDescarga || null,
        notasCargaComercial: editedFields.notasCargaComercial || null,
        ltlLargo: editedFields.ltlLargo || null,
        ltlAncho: editedFields.ltlAncho || null,
        ltlAlto: editedFields.ltlAlto || null,
        ltlPeso: editedFields.ltlPeso || null,
        ltlImagenes: editedFields.ltlImagenes || null,
        rutas: JSON.stringify(localRutas),
        historial: JSON.stringify(updatedHistorial),
      });
      
      setLocalHistorial(updatedHistorial);
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
      toast({
        title: "Cambios guardados",
        description: "Los cambios han sido guardados correctamente",
      });
      setIsEditMode(false);
      setEditingRouteId(null);
      setShowAddRouteForm(false);
    } catch (error: any) {
      toast({
        title: "Error al guardar",
        description: error?.message || "No se pudieron guardar los cambios",
        variant: "destructive",
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Handle add new route
  const handleAddRoute = async () => {
    if (!newRoute.origen.trim() || !newRoute.destino.trim()) {
      toast({
        title: "Campos requeridos",
        description: "Origen y destino son obligatorios",
        variant: "destructive",
      });
      return;
    }

    // Si la cotización es multi-equipo, la fila nueva debe llevar su equipo.
    const equipoFila =
      newRoute.tipoEquipo ||
      (equiposCotizacion.length === 1 ? equiposCotizacion[0] : "");
    if (!equipoFila) {
      toast({
        title: "Equipo requerido",
        description: "Selecciona el tipo de equipo para esta ruta",
        variant: "destructive",
      });
      return;
    }

    const newRouteData: RouteWithOffers = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      tipoEquipo: equipoFila,
      origen: newRoute.origen,
      destino: newRoute.destino,
      cpOrigen: newRoute.cpOrigen || "",
      cpDestino: newRoute.cpDestino || "",
      volumen: newRoute.volumen || "",
      frecuencia: newRoute.frecuencia || "",
      targetCliente: newRoute.targetCliente || "",
      ofertas: [] as CarrierOffer[],
      requiereCruce: false,
      ciudadCruce: "",
      stops: [],
    };

    const updatedRutas = [...localRutas, newRouteData];
    const updatedHistorial = await addHistorialEntry(
      `Agregó nueva ruta: ${newRoute.origen} → ${newRoute.destino}`,
      localHistorial
    );

    try {
      await apiRequest("PATCH", `/api/pricing-requests/${request.id}`, {
        rutas: JSON.stringify(updatedRutas),
        historial: JSON.stringify(updatedHistorial),
      });

      setLocalRutas(updatedRutas);
      setLocalHistorial(updatedHistorial);
      setNewRoute({
        origen: "",
        destino: "",
        cpOrigen: "",
        cpDestino: "",
        volumen: "",
        frecuencia: "",
        targetCliente: "",
        tipoEquipo: "",
      });
      setShowAddRouteForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
      toast({
        title: "Ruta agregada",
        description: `Nueva ruta: ${newRouteData.origen} → ${newRouteData.destino}`,
      });
    } catch (error: any) {
      toast({
        title: "Error al agregar ruta",
        description: error?.message || "No se pudo agregar la ruta",
        variant: "destructive",
      });
    }
  };

  const handleEditRoute = (ruta: RouteWithOffers) => {
    setEditingRouteId(ruta.id);
    setEditingRouteData({
      origen: ruta.origen || "",
      destino: ruta.destino || "",
      cpOrigen: ruta.cpOrigen || "",
      cpDestino: ruta.cpDestino || "",
      volumen: ruta.volumen || "",
      frecuencia: ruta.frecuencia || "",
      targetCliente: ruta.targetCliente || "",
    });
  };

  const handleSaveRouteEdit = async () => {
    if (!request || !editingRouteId) return;

    if (!editingRouteData.origen.trim() || !editingRouteData.destino.trim()) {
      toast({
        title: "Campos requeridos",
        description: "Origen y destino son obligatorios",
        variant: "destructive",
      });
      return;
    }

    const updatedRutas = localRutas.map(ruta => {
      if (ruta.id === editingRouteId) {
        return {
          ...ruta,
          origen: editingRouteData.origen,
          destino: editingRouteData.destino,
          cpOrigen: editingRouteData.cpOrigen,
          cpDestino: editingRouteData.cpDestino,
          volumen: editingRouteData.volumen,
          frecuencia: editingRouteData.frecuencia,
          targetCliente: editingRouteData.targetCliente,
        };
      }
      return ruta;
    });

    const updatedHistorial = await addHistorialEntry(
      `Modificó ruta: ${editingRouteData.origen} → ${editingRouteData.destino}`,
      localHistorial
    );

    try {
      await apiRequest("PATCH", `/api/pricing-requests/${request.id}`, {
        rutas: JSON.stringify(updatedRutas),
        historial: JSON.stringify(updatedHistorial),
      });

      setLocalRutas(updatedRutas);
      setLocalHistorial(updatedHistorial);
      setEditingRouteId(null);
      setEditingRouteData({
        origen: "",
        destino: "",
        cpOrigen: "",
        cpDestino: "",
        volumen: "",
        frecuencia: "",
        targetCliente: "",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
      toast({
        title: "Ruta actualizada",
        description: `Ruta modificada correctamente`,
      });
    } catch (error: any) {
      toast({
        title: "Error al actualizar ruta",
        description: error?.message || "No se pudo actualizar la ruta",
        variant: "destructive",
      });
    }
  };

  const handleCancelRouteEdit = () => {
    setEditingRouteId(null);
    setEditingRouteData({
      origen: "",
      destino: "",
      cpOrigen: "",
      cpDestino: "",
      volumen: "",
      frecuencia: "",
      targetCliente: "",
    });
  };

  const handleDeleteRoute = async (rutaId: string) => {
    if (!request) return;

    const rutaToDelete = localRutas.find(r => r.id === rutaId);
    if (!rutaToDelete) return;

    const updatedRutas = localRutas.filter(r => r.id !== rutaId);
    const updatedHistorial = await addHistorialEntry(
      `Eliminó ruta: ${rutaToDelete.origen} → ${rutaToDelete.destino}`,
      localHistorial
    );

    try {
      await apiRequest("PATCH", `/api/pricing-requests/${request.id}`, {
        rutas: JSON.stringify(updatedRutas),
        historial: JSON.stringify(updatedHistorial),
      });

      setLocalRutas(updatedRutas);
      setLocalHistorial(updatedHistorial);
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
      toast({
        title: "Ruta eliminada",
        description: `Ruta eliminada correctamente`,
      });
    } catch (error: any) {
      toast({
        title: "Error al eliminar ruta",
        description: error?.message || "No se pudo eliminar la ruta",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!request) return;
    setIsDeleting(true);
    try {
      await apiRequest("DELETE", `/api/pricing-requests/${request.id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
      toast({
        title: "Cotización eliminada",
        description: `La cotización #${request.id} ha sido eliminada`,
      });
      setShowDeleteConfirm(false);
      onOpenChange(false);
      onDelete?.(request.id);
    } catch (error: any) {
      const message = error?.message || "No se pudo eliminar la cotización";
      toast({
        title: "Error al eliminar",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const formatHistorialDate = () => {
    return new Date().toLocaleDateString("es-MX", { 
      day: "2-digit", 
      month: "short", 
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const addHistorialEntry = async (accion: string, currentHistorial: { fecha: string; accion: string; usuario: string }[]) => {
    const newEntry = {
      fecha: formatHistorialDate(),
      accion,
      usuario: user?.name || "Usuario",
    };
    const updatedHistorial = [...currentHistorial, newEntry];
    return updatedHistorial;
  };

  const renderCommentWithMentions = (texto: string) => {
    const parts = renderMentionText(texto, mentionUsers);
    return parts.map((part, index) => {
      if (part.isMention) {
        return (
          <span key={index} className="text-blue-400 font-medium bg-blue-500/15 px-1 py-0.5 rounded text-xs">
            {part.text}
          </span>
        );
      }
      return <span key={index}>{part.text}</span>;
    });
  };

  const handleAddComment = async () => {
    if (newComment.trim() && request) {
      const commentText = getCleanText(newComment.trim());
      const mentions = parseMentions(commentText, mentionUsers);
      
      const newCommentData = {
        id: Date.now().toString(),
        usuario: user?.name || "Usuario",
        fecha: formatHistorialDate(),
        texto: commentText,
      };
      
      const updatedComentarios = [...localComentarios, newCommentData];
      const updatedHistorial = await addHistorialEntry(`Agrego comentario: "${commentText.substring(0, 50)}${commentText.length > 50 ? '...' : ''}"`, localHistorial);
      
      try {
        await apiRequest("PATCH", `/api/pricing-requests/${request.id}`, {
          comentarios: JSON.stringify(updatedComentarios),
          historial: JSON.stringify(updatedHistorial),
        });
        
        setLocalComentarios(updatedComentarios);
        setLocalHistorial(updatedHistorial);
        queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
        
        try {
          await apiRequest("POST", `/api/pricing-requests/${request.id}/comment-notification`, {
            commentId: newCommentData.id,
            commentText: commentText,
          });
        } catch (notifError) {
          console.error("Error sending comment notifications:", notifError);
        }
        
        toast({
          title: "Comentario agregado",
          description: mentions.length > 0 
            ? `Tu comentario ha sido guardado y se notificó a ${mentions.length} usuario(s)`
            : "Tu comentario ha sido guardado",
        });
        setNewComment("");
      } catch {
        toast({
          title: "Error",
          description: "No se pudo guardar el comentario",
          variant: "destructive",
        });
      }
    }
  };

  const handleAddOffer = async (rutaId: string) => {
    if (newOffer.carrier && newOffer.costo && newOffer.disponibilidad) {
      const ruta = request.rutas.find(r => r.id === rutaId);
      const rutaLabel = ruta ? `${ruta.origen} -> ${ruta.destino}` : rutaId;
      
      const newOfferData: CarrierOffer = {
        id: Date.now().toString(),
        carrier: newOffer.carrier,
        costo: parseFloat(newOffer.costo),
        disponibilidad: parseInt(newOffer.disponibilidad),
        carrierRep: user?.name || "Usuario",
        fechaOferta: new Date().toLocaleDateString("es-MX"),
        frecuencia: newOffer.frecuencia,
        moneda: newOffer.moneda,
      };
      
      setLocalOffers(prev => ({
        ...prev,
        [rutaId]: [...(prev[rutaId] || []), newOfferData],
      }));
      
      const historialEntry = {
        fecha: formatHistorialDate(),
        accion: `Agregó oferta de ${newOffer.carrier} por ${newOffer.moneda} $${parseFloat(newOffer.costo).toLocaleString()} (${newOffer.disponibilidad} uds) en ruta ${rutaLabel}`,
        usuario: user?.name || "Usuario",
      };
      
      try {
        await apiRequest("POST", `/api/pricing-requests/${request.id}/route-offer`, {
          rutaId,
          offer: newOfferData,
          historialEntry,
        });
        setLocalHistorial(prev => [...prev, historialEntry]);
        setLocalOffers({});
        queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
      } catch (error) {
        console.error("Error saving offer:", error);
        setLocalOffers(prev => {
          const updated = { ...prev };
          if (updated[rutaId]) {
            updated[rutaId] = updated[rutaId].filter(o => o.id !== newOfferData.id);
          }
          return updated;
        });
        toast({
          title: "Error",
          description: "No se pudo guardar la oferta",
          variant: "destructive",
        });
        return;
      }
      
      toast({
        title: "Oferta agregada",
        description: `Oferta de ${newOffer.carrier} registrada correctamente`,
      });
      setNewOffer({ carrier: "", costo: "", disponibilidad: "", frecuencia: "semanal", moneda: "MXN" });
      setShowAddOfferForm(null);
    }
  };

  const handleStartEditOffer = (rutaId: string, oferta: CarrierOffer) => {
    setEditingOfferId(oferta.id);
    setEditingOfferData({
      carrier: oferta.carrier,
      costo: String(oferta.costo),
      disponibilidad: String(oferta.disponibilidad),
      frecuencia: oferta.frecuencia || "semanal",
      moneda: oferta.moneda || "MXN",
    });
  };

  const handleCancelEditOffer = () => {
    setEditingOfferId(null);
    setEditingOfferData({ carrier: "", costo: "", disponibilidad: "", frecuencia: "semanal", moneda: "MXN" });
  };

  const handleDeleteOffer = async (rutaId: string, oferta: CarrierOffer) => {
    const ruta = request.rutas.find(r => r.id === rutaId);
    const rutaLabel = ruta ? `${ruta.origen} → ${ruta.destino}` : rutaId;
    const moneda = oferta.moneda || "MXN";
    const historialEntry = {
      fecha: formatHistorialDate(),
      accion: `Eliminó oferta de ${oferta.carrier} (${moneda} $${oferta.costo.toLocaleString()}) en ruta ${rutaLabel}`,
      usuario: user?.name || "Usuario",
    };
    try {
      await apiRequest("DELETE", `/api/pricing-requests/${request.id}/route-offer`, {
        rutaId,
        offerId: oferta.id,
        historialEntry,
      });
      setLocalOffers(prev => ({
        ...prev,
        [rutaId]: (prev[rutaId] || []).filter(o => o.id !== oferta.id),
      }));
      setLocalHistorial(prev => [...prev, historialEntry]);
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
      toast({ title: "Oferta eliminada", description: `Se eliminó la oferta de ${oferta.carrier}` });
    } catch (error) {
      console.error("Error deleting offer:", error);
      toast({ title: "Error", description: "No se pudo eliminar la oferta", variant: "destructive" });
    }
  };

  const handleSaveEditOffer = async (rutaId: string, offerId: string) => {
    if (!editingOfferData.carrier || !editingOfferData.costo || !editingOfferData.disponibilidad) {
      toast({ title: "Datos incompletos", description: "Completa carrier, costo y disponibilidad", variant: "destructive" });
      return;
    }
    const ruta = request.rutas.find(r => r.id === rutaId);
    const rutaLabel = ruta ? `${ruta.origen} → ${ruta.destino}` : rutaId;
    const updatedOffer = {
      carrier: editingOfferData.carrier,
      costo: parseFloat(editingOfferData.costo),
      disponibilidad: parseInt(editingOfferData.disponibilidad),
      frecuencia: editingOfferData.frecuencia,
      moneda: editingOfferData.moneda,
    };
    const historialEntry = {
      fecha: formatHistorialDate(),
      accion: `Editó oferta de ${updatedOffer.carrier} en ruta ${rutaLabel} (${updatedOffer.moneda} $${updatedOffer.costo.toLocaleString()})`,
      usuario: user?.name || "Usuario",
    };
    try {
      await apiRequest("PATCH", `/api/pricing-requests/${request.id}/route-offer`, {
        rutaId,
        offerId,
        offer: updatedOffer,
        historialEntry,
      });
      setLocalHistorial(prev => [...prev, historialEntry]);
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
      toast({ title: "Oferta actualizada", description: `Cambios guardados para ${updatedOffer.carrier}` });
      handleCancelEditOffer();
    } catch (error) {
      console.error("Error updating offer:", error);
      toast({ title: "Error", description: "No se pudo actualizar la oferta", variant: "destructive" });
    }
  };

  const handleStatusChange = async (newStatus: PricingStatus) => {
    if (!allowedStatuses.includes(newStatus)) {
      toast({
        title: "Acción no permitida",
        description: "No tienes permisos para cambiar a este status",
        variant: "destructive",
      });
      return;
    }

    if (newStatus === "ganada") {
      const pricingFileEntries = request.rutas.map((ruta) => {
        const allOffers = getOffersForRoute(ruta.id, ruta.ofertas);
        const selectedOffers = allOffers.filter(o => o.seleccionado);
        const routeInfo = routeSalesInfo[ruta.id] || { costoEsperado: "", ventaSugerida: "" };
        
        const costo = ruta.costoEsperado || parseFloat(routeInfo.costoEsperado) || 0;
        // Al ganar, la tarifa registrada debe ser la venta final si existe; si no, la sugerida
        const tarifa = ruta.ventaFinal || ruta.ventaSugerida || parseFloat(routeInfo.ventaSugerida) || costo / 0.85;
        const margen = costo > 0 ? ((tarifa - costo) / costo) * 100 : 0;

        const carrierNames = selectedOffers.length > 0 
          ? selectedOffers.map(o => o.carrier).join(", ") 
          : "Sin carrier";
        const carrierReps = selectedOffers.length > 0
          ? [...new Set(selectedOffers.map(o => o.carrierRep))].join(", ")
          : null;

        return {
          idRequest: request.id,
          cliente: request.cliente,
          division: request.division,
          salesRep: request.salesRep,
          origen: ruta.origen,
          destino: ruta.destino,
          equipo: ruta.tipoEquipo || request.tipoEquipo,
          carrier: carrierNames,
          carrierRep: carrierReps,
          costo: costo.toString(),
          tarifaAprobada: tarifa.toString(),
          margen: margen.toFixed(2),
          aprobadoPor: user?.name || null,
          fechaVigencia: null,
          active: true,
        };
      }).filter(entry => parseFloat(entry.costo) > 0);

      if (pricingFileEntries.length > 0) {
        try {
          await apiRequest("POST", "/api/pricing-file/batch", { entries: pricingFileEntries });
          queryClient.invalidateQueries({ queryKey: ["/api/pricing-file"] });
          toast({
            title: "Rutas agregadas al Pricing File",
            description: `Se agregaron ${pricingFileEntries.length} ruta(s) al registro de precios`,
          });
        } catch (error) {
          toast({
            title: "Error al guardar",
            description: "No se pudieron agregar las rutas al Pricing File. El status no se actualizó.",
            variant: "destructive",
          });
          return;
        }
      }
    }
    
    // When changing to "enviado", save the fechaEnvio (don't invalidate queries here, let parent handle it)
    if (newStatus === "enviado") {
      try {
        await apiRequest("PATCH", `/api/pricing-requests/${request.id}`, {
          fechaEnvio: new Date().toISOString().split('T')[0],
        });
      } catch (error) {
        console.error("Error saving fechaEnvio:", error);
      }
    }
    
    // Add to historial when status changes
    const oldStatusLabel = allStatuses.find(s => s.value === request.status)?.label || request.status;
    const newStatusLabel = allStatuses.find(s => s.value === newStatus)?.label || newStatus;
    const updatedHistorial = await addHistorialEntry(`Cambio de estatus: ${oldStatusLabel} -> ${newStatusLabel}`, localHistorial);
    
    try {
      await apiRequest("PATCH", `/api/pricing-requests/${request.id}`, {
        historial: JSON.stringify(updatedHistorial),
      });
      setLocalHistorial(updatedHistorial);
    } catch (error) {
      console.error("Error saving historial:", error);
    }
    
    if (onStatusChange) {
      // Update local status immediately for visual feedback
      setLocalStatus(newStatus);
      onStatusChange(request.id, newStatus);
      toast({
        title: "Status actualizado",
        description: `La cotización se movió a "${newStatusLabel}"`,
      });
    }
  };

  const getOffersForRoute = (rutaId: string, existingOffers: CarrierOffer[]) => {
    const local = localOffers[rutaId] || [];
    const allOffers = [...existingOffers, ...local];
    return allOffers.sort((a, b) => {
      if (a.seleccionado && !b.seleccionado) return -1;
      if (!a.seleccionado && b.seleccionado) return 1;
      return 0;
    });
  };

  const handleSelectOffer = async (rutaId: string, offerId: string, offerCosto: number) => {
    const ruta = request.rutas.find(r => r.id === rutaId);
    const currentOffer = ruta?.ofertas.find(o => o.id === offerId);
    const willBeSelected = currentOffer ? !currentOffer.seleccionado : true;
    const rutaLabel = ruta ? `${ruta.origen} → ${ruta.destino}` : rutaId;

    try {
      const historialEntry = {
        fecha: formatHistorialDate(),
        accion: willBeSelected 
          ? `Seleccionó oferta de ${currentOffer?.carrier || "carrier"} ($${offerCosto.toLocaleString()}) en ruta ${rutaLabel}`
          : `Deseleccionó oferta de ${currentOffer?.carrier || "carrier"} en ruta ${rutaLabel}`,
        usuario: user?.name || "Usuario",
      };
      await apiRequest("POST", `/api/pricing-requests/${request.id}/select-offer`, {
        rutaId,
        offerId,
        historialEntry,
      });
      setLocalHistorial(prev => [...prev, historialEntry]);
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
      
      toast({
        title: willBeSelected ? "Oferta seleccionada" : "Oferta deseleccionada",
        description: willBeSelected 
          ? `Se seleccionó la oferta de ${currentOffer?.carrier || "carrier"}`
          : `Se deseleccionó la oferta de ${currentOffer?.carrier || "carrier"}`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo guardar la selección",
        variant: "destructive",
      });
    }
  };

  const updateRouteSalesInfo = (rutaId: string, field: "costoEsperado" | "ventaSugerida", value: string) => {
    setRouteSalesInfo(prev => ({
      ...prev,
      [rutaId]: {
        ...prev[rutaId],
        [field]: value,
      }
    }));
  };

  const PRED_OPTIONS: { key: string; label: string; componentField: string; modelMatch: (m: string) => boolean }[] = [
    { key: "historica", label: "Estimación histórica", componentField: "lightgbm_mxn", modelMatch: (m) => m.includes("incumbent") && !m.includes("p67") },
    { key: "proteccion", label: "Estimación con protección", componentField: "quantile_p67_mxn", modelMatch: (m) => m.includes("p67") || m.includes("quantile") },
    { key: "ajustada", label: "Estimación ajustada por ruta", componentField: "national_geo_mxn", modelMatch: (m) => m.includes("geo") },
    { key: "comparacion", label: "Comparación con rutas similares", componentField: "national_hybrid_mxn", modelMatch: (m) => m.includes("hybrid") },
  ];

  const MOTIVOS_ALTERNATIVA = [
    "Cotización de carrier",
    "Experiencia comercial",
    "Condición particular del cliente",
    "Ajuste de mercado",
    "Requerimiento de equipo especial",
    "Corrección de datos",
  ];

  type EstadoOpcion = "recomendado" | "revision" | "no_aplicable";

  interface ReglasResultado {
    manual: boolean;
    motivosManual: string[];
    estados: Record<string, { estado: EstadoOpcion; nota?: string }>;
    enValidacion: boolean;
    soloHistorica: boolean;
  }

  const evaluarReglasOperativas = (
    pred: (typeof routePredictions)[string],
    division: string | null | undefined,
    tipoEquipo: string | null | undefined,
  ): ReglasResultado => {
    const div = (division || "").toLowerCase();
    const equipo = (tipoEquipo || "").toLowerCase();
    const esNational = div.includes("national");
    const esCrossborder = div.includes("cross");
    const esPortFreight = div.includes("port");
    const esLTL = equipo.includes("ltl");
    const comp = (pred.componentes || {}) as Record<string, number | null>;
    const razones = pred.razones || [];
    const guardrails = pred.razonesGuardrails || [];
    const hist = pred.conteoHistorialRuta ?? (razones.includes("route:new") ? 0 : null);
    const central = pred.costoCentral ?? pred.costoEstimado ?? null;
    const historico = comp.lightgbm_mxn ?? null;
    const proteccion = comp.quantile_p67_mxn ?? pred.costoProtegido ?? null;
    const geoVal = comp.national_geo_mxn ?? null;
    const hybridVal = comp.national_hybrid_mxn ?? null;
    const decil = pred.decil || "";
    const equipoEspecial = razones.includes("special_equipment") || guardrails.includes("special_equipment");
    const enValidacion = razones.includes("calibrator_not_fitted") || guardrails.includes("calibrator_not_fitted");

    const motivosManual: string[] = [];

    if (/maritim|multimodal|aereo|aéreo|air|central\s*am/i.test(div)) {
      motivosManual.push("Esta división está fuera del alcance de los modelos, por lo que la operación debe cotizarse manualmente.");
    }
    if (!division || !tipoEquipo) {
      motivosManual.push("Faltan datos críticos de la operación (división o tipo de equipo), por lo que debe cotizarse manualmente.");
    }
    if (pred.fuenteDistancia === "median" || pred.distanciaKm === null || pred.distanciaKm <= 0) {
      motivosManual.push("No fue posible verificar la distancia de la ruta, por lo que debe cotizarse manualmente.");
    }
    if (central === null || !isFinite(central) || central <= 0) {
      motivosManual.push("El sistema no pudo generar una estimación válida, por lo que la operación debe cotizarse manualmente.");
    }
    if (pred.rangoBajo === null || pred.rangoAlto === null || !isFinite(pred.rangoBajo) || !isFinite(pred.rangoAlto) || pred.rangoAlto < pred.rangoBajo) {
      motivosManual.push("El rango estimado de variación no está disponible, por lo que la operación debe cotizarse manualmente.");
    } else if (central !== null && central > 0 && pred.rangoAlto - pred.rangoBajo > 1.25 * central) {
      motivosManual.push("El rango estimado de variación es demasiado amplio para dar una referencia confiable, por lo que debe cotizarse manualmente.");
    }
    if (proteccion !== null && central !== null && central > 0 && proteccion > 1.5 * central) {
      motivosManual.push("El ajuste de protección incrementa demasiado la estimación, por lo que la operación debe cotizarse manualmente.");
    }
    if (historico !== null && historico > 0) {
      const aplicables: (number | null)[] = [];
      if ((esNational || esPortFreight) && !esLTL && geoVal !== null && geoVal > 0) aplicables.push(geoVal);
      if (esNational && !esLTL && hybridVal !== null && hybridVal > 0 && !guardrails.includes("low_hybrid_confidence")) aplicables.push(hybridVal);
      if (aplicables.some((v) => v !== null && Math.abs(v - historico) / historico > 0.4)) {
        motivosManual.push("Los resultados de los modelos difieren demasiado entre sí para esta ruta, por lo que debe cotizarse manualmente.");
      }
    }
    if (/pipa|hazmat|40/.test(equipo) && hist !== null && hist < 4) {
      motivosManual.push("Este tipo de operación (pipa, hazmat o contenedor de 40 pies) requiere cotizarse manualmente.");
    }
    const proteccionRequerida =
      !esCrossborder &&
      (razones.includes("route:new") ||
        (hist !== null && hist >= 1 && hist <= 3) ||
        esPortFreight ||
        equipoEspecial ||
        ["D7", "D8", "D10"].includes(decil));
    if (proteccionRequerida && (proteccion === null || !isFinite(proteccion) || proteccion <= 0)) {
      motivosManual.push("La protección de costo es necesaria para esta operación pero no está disponible, por lo que debe cotizarse manualmente.");
    }

    const manual = motivosManual.length > 0;

    const estados: ReglasResultado["estados"] = {};

    // Estimación histórica
    if (esLTL) {
      estados.historica = { estado: "revision", nota: "Única referencia disponible para operaciones LTL; siempre requiere revisión manual." };
    } else {
      estados.historica = { estado: "revision" };
    }

    // Estimación ajustada por ruta
    if (!esNational || esLTL || geoVal === null || geoVal <= 0) {
      estados.ajustada = {
        estado: "no_aplicable",
        nota: esLTL
          ? "No aplica para operaciones LTL."
          : !esNational
            ? "Solo aplica para la división National."
            : "No hay información geográfica completa para esta ruta.",
      };
    } else if (hist !== null && hist >= 4) {
      estados.ajustada = { estado: "revision", nota: "Solo informativa: esta ruta ya tiene historial suficiente." };
    } else if (hist !== null && hist >= 1) {
      estados.ajustada = { estado: "revision", nota: "Usa únicamente el modelo geográfico (duración y elevación de la ruta)." };
    } else {
      estados.ajustada = { estado: "revision", nota: "Usa únicamente el modelo geográfico (duración y elevación de la ruta)." };
    }

    // Estimación con protección
    if (esCrossborder) {
      estados.proteccion = { estado: "no_aplicable", nota: "En Crossborder la protección no se aplica automáticamente." };
    } else if (proteccion === null || proteccion <= 0) {
      estados.proteccion = { estado: "no_aplicable", nota: "No disponible para esta operación." };
    } else {
      estados.proteccion = { estado: "revision", nota: "Es un piso de seguridad: se usa el valor mayor entre la estimación y la protección." };
    }

    // Comparación con rutas similares
    if (esLTL) {
      estados.comparacion = { estado: "no_aplicable", nota: "No aplica para operaciones LTL." };
    } else if (guardrails.includes("low_hybrid_confidence")) {
      estados.comparacion = { estado: "no_aplicable", nota: "La confianza de la comparación es menor al mínimo requerido (45%)." };
    } else if (esPortFreight && hybridVal !== null && hybridVal > 0) {
      estados.comparacion = { estado: "revision", nota: "Referencia base: el modelo especialista no intervino en este cálculo." };
    } else if (!esNational || hybridVal === null || hybridVal <= 0) {
      estados.comparacion = { estado: "no_aplicable", nota: !esNational && !esPortFreight ? "Solo aplica para National y Port Freight." : "No hay soporte suficiente de ruta y equipo." };
    } else if (hist !== null && hist < 1) {
      estados.comparacion = { estado: "no_aplicable", nota: "Se requiere al menos un antecedente de la ruta con este equipo." };
    } else {
      estados.comparacion = { estado: "revision", nota: "Combina 50% del modelo base y 50% del modelo especialista." };
    }

    return { manual, motivosManual, estados, enValidacion, soloHistorica: esLTL };
  };

  const nombreComercialModelo = (modelo: string | null | undefined): string => {
    if (!modelo) return "Recomendación integral";
    const m = modelo.toLowerCase();
    if (m.includes("+") || m.includes("blend") || m.includes("combin")) return "Recomendación integral";
    if (m.includes("hybrid")) return "Comparación con rutas similares";
    if (m.includes("geo")) return "Estimación ajustada por ruta";
    if (m.includes("p67") || m.includes("quantile")) return "Estimación con protección";
    if (m.includes("incumbent") || m.includes("lightgbm")) return "Estimación histórica";
    return "Recomendación integral";
  };

  const razonAmigable = (r: string): string | null => {
    const map: Record<string, string> = {
      "route:new": "Esta ruta no tiene viajes registrados anteriormente, por lo que el sistema calculó el costo con un margen de seguridad adicional para proteger la operación.",
      "route:low_history": "Esta ruta tiene pocos viajes registrados, así que el cálculo combina su historial con la experiencia de rutas parecidas para dar un resultado más confiable.",
      "route:established": "Esta ruta ya se ha trabajado varias veces, por lo que el resultado se basa principalmente en los costos reales que se han registrado en ella.",
      geo_coordinates_unavailable: "No fue posible ubicar la ruta en el mapa, así que el cálculo se basó únicamente en la experiencia histórica, sin ajuste por zona geográfica.",
      lightgbm_incumbent: "El resultado se basa en la experiencia acumulada de miles de viajes anteriores en rutas y condiciones similares.",
      calibrator_not_fitted: "Para esta ruta aún no hay suficiente información para afinar el cálculo al detalle, por eso el resultado es una referencia general.",
      low_hybrid_confidence: "Las rutas parecidas disponibles no se asemejan lo suficiente a esta, así que se dio más peso a la experiencia histórica directa.",
      crossborder_incumbent: "Al ser una ruta de cruce fronterizo, se utilizó la referencia que mejor ha funcionado históricamente para este tipo de operaciones.",
      special_equipment: "El tipo de equipo solicitado es especial, por lo que se agregó un margen de seguridad al costo para cubrir su mayor variabilidad.",
    };
    if (map[r]) return map[r];
    if (r.startsWith("protected_prediction_decile")) {
      return "El costo de esta ruta se encuentra en un nivel donde los precios suelen variar más, así que se aplicó un margen de seguridad adicional.";
    }
    if (r.includes("geo_hierarchical_support") || r.includes("geo_support")) {
      return "Se tomó en cuenta la ubicación geográfica de origen y destino (distancia, zona y altitud) para ajustar el costo a las condiciones reales de la ruta.";
    }
    if (r.includes("hybrid")) {
      return "El resultado también considera lo que han costado rutas parecidas a esta.";
    }
    return null;
  };

  const opcionRecomendadaKey = (modelo: string | null | undefined): string | null => {
    if (!modelo) return null;
    const m = modelo.toLowerCase();
    if (m.includes("+")) {
      if (m.includes("incumbent")) return "historica";
      return "proteccion";
    }
    const found = PRED_OPTIONS.find((o) => o.modelMatch(m));
    return found?.key ?? null;
  };

  const aplicarReferenciaTrabajo = async (rutaId: string, optionKey: string, costo: number, motivo?: string) => {
    setPredWorkingRef((prev) => ({ ...prev, [rutaId]: { key: optionKey, motivo } }));
    const predSel = routePredictions[rutaId];
    const tcUsdSel = typeof predSel?.tipoCambioUsd === "number" && predSel.tipoCambioUsd > 0 ? predSel.tipoCambioUsd : null;
    const fmtSel = (v: number) => tcUsdSel
      ? `$${Math.ceil(v * tcUsdSel).toLocaleString("en-US")} USD`
      : fmtMxnGlobal(v);
    setRouteSalesInfo((prev) => ({
      ...prev,
      [rutaId]: {
        ...prev[rutaId],
        costoEsperado: String(tcUsdSel ? Math.ceil(costo * tcUsdSel) : Math.round(costo)),
        ...(tcUsdSel ? { moneda: "USD" as const } : {}),
      },
    }));
    const label = PRED_OPTIONS.find((o) => o.key === optionKey)?.label || optionKey;
    const pred = routePredictions[rutaId];
    const costoProtegido = pred?.costoProtegido ?? null;
    const subestimacion = costoProtegido !== null && costo < costoProtegido;
    toast({
      title: "Referencia de trabajo actualizada",
      description: motivo
        ? `Se usará "${label}" (${fmtSel(costo)}). Motivo registrado: ${motivo}.`
        : `Se usará "${label}" (${fmtSel(costo)}) como referencia de trabajo.`,
    });
    // Trazabilidad: registrar la selección en el historial de la cotización
    try {
      const ruta = request.rutas.find((r) => r.id === rutaId);
      const rutaLabel = ruta ? `${ruta.origen} → ${ruta.destino}` : rutaId;
      const comp = (pred?.componentes || {}) as Record<string, number | null>;
      const resumenModelos = PRED_OPTIONS.map((o) => {
        const v = comp[o.componentField];
        return `${o.label}: ${v !== null && v !== undefined ? fmtSel(v) : "N/D"}`;
      }).join("; ");
      const recomendada = PRED_OPTIONS.find((o) => o.key === opcionRecomendadaKey(pred?.modeloSeleccionado))?.label || "N/D";
      const partes = [
        `Precotización en ruta ${rutaLabel}: eligió "${label}" (${fmtSel(costo)})`,
        `Recomendada por el sistema: ${recomendada}`,
        `Resultados: ${resumenModelos}`,
      ];
      if (motivo) partes.push(`Motivo del cambio: ${motivo}`);
      if (subestimacion) partes.push("Advertencia: referencia menor al costo protegido (riesgo de subestimación)");
      const updatedHistorial = await addHistorialEntry(partes.join(" | "), localHistorial);
      await apiRequest("PATCH", `/api/pricing-requests/${request.id}`, {
        historial: JSON.stringify(updatedHistorial),
      });
      setLocalHistorial(updatedHistorial);
    } catch (error) {
      console.error("Error registrando trazabilidad de precotización:", error);
    }
  };

  const fmtMxnGlobal = (v: number | null | undefined) =>
    v !== null && v !== undefined
      ? new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(v)
      : "N/D";

  const handlePredictTarifa = async (rutaId: string, origen: string, destino: string) => {
    const requestIdAtCall = request?.id ?? null;
    setPredictingRouteId(rutaId);
    try {
      const res = await apiRequest("POST", "/api/predict-tarifa", {
        cliente: request.cliente,
        origen,
        destino,
        tipoEquipo: request.rutas.find((r) => r.id === rutaId)?.tipoEquipo || request.tipoEquipo,
        division: request.division,
        fechaCreacion: request.fecha,
        quoteId: request.id,
        rutaId,
      });
      const data = await res.json();
      // Si el usuario cambió de ticket mientras se calculaba, descartar la respuesta
      // para no contaminar el estado ni el caché de otra cotización.
      if (currentRequestIdRef.current !== requestIdAtCall) return;
      setRoutePredictions(prev => ({ ...prev, [rutaId]: data }));
      setPredWorkingRef(prev => {
        const next = { ...prev };
        delete next[rutaId];
        return next;
      });
      setPredPendingAlt(prev => {
        const next = { ...prev };
        delete next[rutaId];
        return next;
      });
      if (data.costoEstimado !== null && data.costoEstimado !== undefined) {
        const esUsd = typeof data.tipoCambioUsd === "number" && data.tipoCambioUsd > 0;
        setRouteSalesInfo(prev => ({
          ...prev,
          [rutaId]: {
            ...prev[rutaId],
            costoEsperado: esUsd
              ? String(Math.ceil(data.costoEstimado * data.tipoCambioUsd))
              : String(data.costoEstimado),
            ...(esUsd ? { moneda: "USD" as const } : {}),
          }
        }));
      }
      toast({
        title: "Referencia de costo calculada",
        description: "La referencia se colocó en el campo Costo estimado por el modelo. Es una referencia preliminar, no una tarifa confirmada.",
      });
    } catch (err) {
      toast({
        title: "Error en la predicción",
        description: "No se pudo generar la predicción de tarifa. Intenta de nuevo.",
        variant: "destructive",
      });
    } finally {
      setPredictingRouteId(null);
    }
  };

  const calculateMargin = (costoEsperado: string, ventaSugerida: string) => {
    const costo = parseFloat(costoEsperado);
    const venta = parseFloat(ventaSugerida);
    if (!costo || !venta || costo === 0) return null;
    return ((venta - costo) / costo) * 100;
  };

  const updateMargin = (rutaId: string, marginPercent: string) => {
    const info = routeSalesInfo[rutaId];
    
    setRouteSalesInfo(prev => ({
      ...prev,
      [rutaId]: {
        ...prev[rutaId],
        margen: marginPercent,
      }
    }));
    
    if (!info?.costoEsperado) return;
    const costo = parseFloat(info.costoEsperado);
    const margin = parseFloat(marginPercent);
    if (isNaN(costo) || isNaN(margin) || costo === 0 || margin >= 100) return;
    
    const newVenta = Math.round(costo / (1 - margin / 100));
    setRouteSalesInfo(prev => ({
      ...prev,
      [rutaId]: {
        ...prev[rutaId],
        margen: marginPercent,
        ventaSugerida: newVenta.toString(),
      }
    }));
  };

  const handleSaveVentaFinal = async (rutaId: string) => {
    const raw = ventaFinalDraft[rutaId];
    const nuevaVentaFinal = parseFloat(raw || "");
    if (!raw || !Number.isFinite(nuevaVentaFinal) || nuevaVentaFinal <= 0) {
      toast({
        title: "Monto inválido",
        description: "Ingresa un monto válido para la venta final",
        variant: "destructive",
      });
      return;
    }
    const ruta = request.rutas.find(r => r.id === rutaId);
    const rutaLabel = ruta ? `${ruta.origen} -> ${ruta.destino}` : rutaId;
    const monedaRuta = ruta?.monedaVenta || "MXN";

    const updatedRutas = request.rutas.map(r =>
      r.id === rutaId ? { ...r, ventaFinal: nuevaVentaFinal } : r
    );

    // Recalcular totales usando venta final cuando exista (la sugerida se conserva)
    let totalCosto = 0;
    let totalVenta = 0;
    for (const r of updatedRutas) {
      totalCosto += r.costoEsperado || 0;
      totalVenta += r.ventaFinal ?? (r.ventaSugerida || 0);
    }
    const margen = totalCosto > 0 ? ((totalVenta - totalCosto) / totalCosto) * 100 : 0;

    const updatedHistorial = await addHistorialEntry(
      `Registró venta final en ruta ${rutaLabel}: ${monedaRuta} $${nuevaVentaFinal.toLocaleString()} (venta sugerida: ${monedaRuta} $${(ruta?.ventaSugerida || 0).toLocaleString()})`,
      localHistorial
    );

    setIsSavingVentaFinal(true);
    try {
      await apiRequest("PATCH", `/api/pricing-requests/${request.id}`, {
        rutas: JSON.stringify(updatedRutas),
        costoAprobado: totalCosto.toString(),
        tarifaVenta: totalVenta.toString(),
        margen: margen.toFixed(2),
        historial: JSON.stringify(updatedHistorial),
      });
      setLocalHistorial(updatedHistorial);
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
      setVentaFinalEditing(prev => ({ ...prev, [rutaId]: false }));
      toast({
        title: "Venta final guardada",
        description: `${rutaLabel}: ${formatCurrency(nuevaVentaFinal)}`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo guardar la venta final",
        variant: "destructive",
      });
    } finally {
      setIsSavingVentaFinal(false);
    }
  };

  const handleSaveRouteSalesInfo = async (rutaId: string) => {
    const info = routeSalesInfo[rutaId];
    if (!info?.costoEsperado || !info?.ventaSugerida) {
      toast({
        title: "Campos requeridos",
        description: "Ingresa el costo y la venta sugerida",
        variant: "destructive",
      });
      return;
    }

    const costo = parseFloat(info.costoEsperado);
    const venta = parseFloat(info.ventaSugerida);
    const ruta = request.rutas.find(r => r.id === rutaId);
    const rutaLabel = ruta ? `${ruta.origen} -> ${ruta.destino}` : rutaId;
    
    // Build updated rutas using local state (routeSalesInfo) to preserve all edits
    const updatedRutas = request.rutas.map(ruta => {
      const localInfo = routeSalesInfo[ruta.id];
      const rutaCosto = localInfo?.costoEsperado ? parseFloat(localInfo.costoEsperado) : (ruta.costoEsperado || 0);
      const rutaVenta = localInfo?.ventaSugerida ? parseFloat(localInfo.ventaSugerida) : (ruta.ventaSugerida || 0);
      const rutaMoneda = localInfo?.moneda || ruta.monedaVenta || "MXN";
      return { 
        ...ruta, 
        costoEsperado: rutaCosto || undefined, 
        ventaSugerida: rutaVenta || undefined,
        monedaVenta: rutaMoneda,
      };
    });

    // Calculate totals for request-level fields
    let totalCosto = 0;
    let totalVenta = 0;
    for (const ruta of updatedRutas) {
      totalCosto += ruta.costoEsperado || 0;
      // La venta final (si existe) manda sobre la sugerida en los totales
      totalVenta += ruta.ventaFinal ?? (ruta.ventaSugerida || 0);
    }
    const margen = totalCosto > 0 ? ((totalVenta - totalCosto) / totalCosto) * 100 : 0;

    // Add to historial
    const monedaRuta = info.moneda || "MXN";
    const updatedHistorial = await addHistorialEntry(
      `Registro datos de venta en ruta ${rutaLabel}: Costo ${monedaRuta} $${costo.toLocaleString()}, Venta ${monedaRuta} $${venta.toLocaleString()}`, 
      localHistorial
    );

    setIsSavingSales(true);
    try {
      await apiRequest("PATCH", `/api/pricing-requests/${request.id}`, {
        rutas: JSON.stringify(updatedRutas),
        costoAprobado: totalCosto.toString(),
        tarifaVenta: totalVenta.toString(),
        margen: margen.toFixed(2),
        historial: JSON.stringify(updatedHistorial),
      });
      setLocalHistorial(updatedHistorial);
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
      toast({
        title: "Datos de ruta guardados",
        description: `Costo: ${formatCurrency(costo)}, Venta: ${formatCurrency(venta)}`,
      });
    } catch (error) {
      toast({
        title: "Error al guardar",
        description: "No se pudo guardar la información de venta",
        variant: "destructive",
      });
    } finally {
      setIsSavingSales(false);
    }
  };

  const totalOfertas = request.rutas.reduce((acc, r) => acc + getOffersForRoute(r.id, r.ofertas).length, 0);

  // El botón "Explicar esta referencia (copiloto)" ya no muestra la
  // explicación aquí: navega a la página Copilot, que reutiliza la explicación
  // guardada o la genera una sola vez en el servidor.
  const handleExplainCopilot = (rutaId: string, modelKey: string | null) => {
    if (!modelKey || !request?.id) return;
    navigate(
      `/copilot?quote=${encodeURIComponent(request.id)}&ruta=${encodeURIComponent(rutaId)}&model=${encodeURIComponent(modelKey)}`,
    );
  };

  const renderPrediccionCard = (ruta: RouteWithOffers) => {
    if (!routePredictions[ruta.id]) return null;
    return (() => {
                          const pred = routePredictions[ruta.id];
                          const tcUsd = typeof pred.tipoCambioUsd === "number" && pred.tipoCambioUsd > 0 ? pred.tipoCambioUsd : null;
                          const fmtMxn = tcUsd
                            ? (v: number | null | undefined) =>
                                v === null || v === undefined
                                  ? "N/D"
                                  : `$${Math.ceil(v * tcUsd).toLocaleString("en-US")} USD`
                            : fmtMxnGlobal;
                          const esOrq = pred.motor === "orquestador";
                          const recomendadaKey = esOrq ? opcionRecomendadaKey(pred.modeloSeleccionado) : null;
                          const componentes = pred.componentes || {};
                          const experiencia = pred.nivelHistorial === "new"
                            ? "Sin historial"
                            : pred.nivelHistorial === "low_history"
                              ? `Historial limitado (${pred.conteoHistorialRuta ?? "?"} viajes)`
                              : pred.nivelHistorial
                                ? `Historial suficiente (${pred.conteoHistorialRuta ?? "?"} viajes)`
                                : null;
                          const workingRef = predWorkingRef[ruta.id];
                          const pendingAlt = predPendingAlt[ruta.id];
                          const reglas = evaluarReglasOperativas(pred, request.division, ruta.tipoEquipo || request.tipoEquipo);
                          const esManual = reglas?.manual ?? false;
                          const colapsada = predCollapsed[ruta.id] ?? false;
                          return (
                          <div className="rounded-md border bg-muted/50 text-sm" data-testid={`prediction-result-${ruta.id}`}>
                            <button
                              type="button"
                              className="w-full flex items-center gap-2 font-medium flex-wrap p-3 text-left hover-elevate rounded-md"
                              onClick={() => setPredCollapsed((prev) => ({ ...prev, [ruta.id]: !colapsada }))}
                              data-testid={`button-toggle-prediccion-${ruta.id}`}
                            >
                              <Sparkles className="h-4 w-4 text-primary" />
                              Referencia de costo ({tcUsd ? "USD" : "MXN"}): <span className="font-mono text-base">{fmtMxn(esOrq && pred.costoCentral !== null && pred.costoCentral !== undefined ? pred.costoCentral : pred.costoEstimado)}</span>
                              {tcUsd && (
                                <span className="text-muted-foreground text-xs" data-testid={`text-tipo-cambio-${ruta.id}`}>
                                  (TC del día: {tcUsd.toFixed(4)})
                                </span>
                              )}
                              {reglas?.enValidacion && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0" data-testid={`badge-validacion-${ruta.id}`}>Sistema en etapa de validación</Badge>
                              )}
                              <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                                {colapsada ? "Mostrar detalle" : "Ocultar detalle"}
                                {colapsada ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                              </span>
                            </button>
                            {!colapsada && (
                            <div className="px-3 pb-3 space-y-2">
                            <div className="flex items-start gap-2 rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700 p-2.5" data-testid={`warning-prediction-${ruta.id}`}>
                              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                              <div className="text-xs text-amber-800 dark:text-amber-300">
                                <span className="font-semibold">Referencia preliminar:</span> este resultado ayuda a preparar la cotización, pero no confirma tarifa ni disponibilidad. Valida el costo con el transportista antes de enviarlo al cliente.
                              </div>
                            </div>
                            {esManual && reglas && (
                              <div className="text-xs rounded-md border bg-background/60 p-2.5" data-testid={`banner-manual-${ruta.id}`}>
                                <div className="font-medium text-foreground/80">Cotización manual</div>
                                <div className="text-muted-foreground mt-0.5">
                                  {reglas.motivosManual.map((m, i) => (
                                    <div key={i}>{m}</div>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                              {esOrq && (
                                <div data-testid={`text-modelo-${ruta.id}`}>
                                  <span className="text-foreground/80">Método utilizado:</span> {nombreComercialModelo(pred.modeloSeleccionado)}
                                </div>
                              )}
                              {esOrq && pred.costoProtegido !== null && pred.costoProtegido !== undefined && (
                                <div>
                                  <span className="text-foreground/80">Referencia con protección:</span> {fmtMxn(pred.costoProtegido)}
                                </div>
                              )}
                              {experiencia && (
                                <div data-testid={`text-historial-${ruta.id}`}>
                                  <span className="text-foreground/80">Experiencia en la ruta:</span> {experiencia}
                                </div>
                              )}
                              {pred.rangoBajo !== null && pred.rangoAlto !== null && (
                                <div>
                                  <span className="text-foreground/80">Rango estimado de variación:</span> {fmtMxn(pred.rangoBajo)} — {fmtMxn(pred.rangoAlto)}
                                </div>
                              )}
                              {pred.fuenteDistancia === "median" && (
                                <div>Sin distancia de ruta disponible (estimación menos precisa)</div>
                              )}
                            </div>
                            {esOrq && Array.isArray(pred.razones) && pred.razones.map((r) => razonAmigable(r)).filter((t): t is string => t !== null).length > 0 && (
                              <div className="text-xs" data-testid={`text-razones-${ruta.id}`}>
                                <div className="font-medium text-foreground/80">¿Por qué se recomienda este resultado?</div>
                                <ul className="list-disc pl-4 text-muted-foreground">
                                  {pred.razones
                                    .map((r) => razonAmigable(r))
                                    .filter((t): t is string => t !== null)
                                    .map((t, i) => (
                                      <li key={i}>{t}</li>
                                    ))}
                                </ul>
                              </div>
                            )}
                            <div className="text-xs" data-testid={`text-accion-${ruta.id}`}>
                              <span className="font-medium text-foreground/80">Siguiente paso recomendado:</span>{" "}
                              <span className="text-muted-foreground">Valida el costo con el transportista antes de proponer una tarifa al cliente. Este resultado requiere revisión humana.</span>
                            </div>

                            {esOrq && Object.keys(componentes).length > 0 && (
                              <div className="rounded-md border bg-background/60">
                                <button
                                  type="button"
                                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium"
                                  onClick={() => setExpandedPredOptions((prev) => ({ ...prev, [ruta.id]: !prev[ruta.id] }))}
                                  data-testid={`button-mas-opciones-${ruta.id}`}
                                >
                                  Más opciones de precotización
                                  {expandedPredOptions[ruta.id] ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                </button>
                                {expandedPredOptions[ruta.id] && (
                                  <div className="px-3 pb-3 space-y-2">
                                    {PRED_OPTIONS.filter((opt) => !reglas?.soloHistorica || opt.key === "historica").map((opt) => {
                                      const costo = componentes[opt.componentField];
                                      const estadoOpt = reglas?.estados[opt.key];
                                      const noAplicable = estadoOpt?.estado === "no_aplicable";
                                      const disponible = costo !== null && costo !== undefined && !noAplicable;
                                      const seleccionable = disponible && canAddSalesInfo;
                                      const esRecomendada = !esManual && recomendadaKey === opt.key;
                                      const esSeleccionada = workingRef ? workingRef.key === opt.key : esRecomendada;
                                      const advertencia = estadoOpt?.nota ?? null;
                                      return (
                                        <div
                                          key={opt.key}
                                          className={cn(
                                            "rounded-md border p-2.5 text-xs space-y-1",
                                            esSeleccionada && "border-primary bg-primary/5"
                                          )}
                                          data-testid={`option-pred-${opt.key}-${ruta.id}`}
                                        >
                                          <div className="flex items-center justify-between gap-2 flex-wrap">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="font-medium">{opt.label}</span>
                                              {!esManual && esRecomendada && (
                                                <Badge variant="default" className="text-[10px] px-1.5 py-0">Recomendada para esta ruta</Badge>
                                              )}
                                              {!esManual && !esRecomendada && disponible && (
                                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Disponible con revisión</Badge>
                                              )}
                                              {!esManual && !disponible && (
                                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">No aplicable</Badge>
                                              )}
                                            </div>
                                            <span className="font-mono">{disponible ? fmtMxn(costo) : "N/D"}</span>
                                          </div>
                                          {opt.key === recomendadaKey && pred.rangoBajo !== null && pred.rangoAlto !== null && (
                                            <div className="text-muted-foreground">Rango estimado: {fmtMxn(pred.rangoBajo)} — {fmtMxn(pred.rangoAlto)}</div>
                                          )}
                                          {advertencia && (
                                            <div className={esManual ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"}>{advertencia}</div>
                                          )}
                                          {esManual && (
                                            <div className="text-muted-foreground">Recomendación: esta operación se sugiere cotizar manualmente; usa este valor solo como referencia.</div>
                                          )}
                                          {seleccionable && !esSeleccionada && (
                                            esRecomendada ? (
                                              <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() => aplicarReferenciaTrabajo(ruta.id, opt.key, costo as number)}
                                                data-testid={`button-usar-${opt.key}-${ruta.id}`}
                                              >
                                                Usar como referencia de trabajo
                                              </Button>
                                            ) : pendingAlt?.key === opt.key ? (
                                              <div className="flex items-center gap-2 flex-wrap pt-1">
                                                <Select
                                                  value={pendingAlt.motivo}
                                                  onValueChange={(v) => setPredPendingAlt((prev) => ({ ...prev, [ruta.id]: { key: opt.key, motivo: v } }))}
                                                >
                                                  <SelectTrigger className="h-7 w-[200px] text-xs" data-testid={`select-motivo-${opt.key}-${ruta.id}`}>
                                                    <SelectValue placeholder="Motivo del cambio..." />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    {MOTIVOS_ALTERNATIVA.map((m) => (
                                                      <SelectItem key={m} value={m}>{m}</SelectItem>
                                                    ))}
                                                  </SelectContent>
                                                </Select>
                                                <Button
                                                  type="button"
                                                  size="sm"
                                                  className="h-7 text-xs"
                                                  disabled={!pendingAlt.motivo}
                                                  onClick={() => {
                                                    aplicarReferenciaTrabajo(ruta.id, opt.key, costo as number, pendingAlt.motivo);
                                                    setPredPendingAlt((prev) => {
                                                      const next = { ...prev };
                                                      delete next[ruta.id];
                                                      return next;
                                                    });
                                                  }}
                                                  data-testid={`button-confirmar-${opt.key}-${ruta.id}`}
                                                >
                                                  Confirmar
                                                </Button>
                                              </div>
                                            ) : (
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() => setPredPendingAlt((prev) => ({ ...prev, [ruta.id]: { key: opt.key, motivo: "" } }))}
                                                data-testid={`button-usar-${opt.key}-${ruta.id}`}
                                              >
                                                Usar esta opción (requiere motivo)
                                              </Button>
                                            )
                                          )}
                                          {esSeleccionada && (
                                            <div className="text-primary font-medium flex items-center gap-1">
                                              <Check className="h-3 w-3" />
                                              Referencia de trabajo actual
                                              {workingRef?.motivo && <span className="text-muted-foreground font-normal">· Motivo: {workingRef.motivo}</span>}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}

                            {esOrq && (() => {
                              const modelKeyExplicar = workingRef?.key ?? recomendadaKey;
                              return (
                                <div className="space-y-2" data-testid={`copilot-block-${ruta.id}`}>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    disabled={!modelKeyExplicar}
                                    onClick={() => handleExplainCopilot(ruta.id, modelKeyExplicar)}
                                    data-testid={`button-copilot-${ruta.id}`}
                                  >
                                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                                    Explicar esta referencia (copiloto)
                                  </Button>
                                </div>
                              );
                            })()}
                            </div>
                            )}
                          </div>
                          );
    })();
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <DialogTitle className="text-xl">{request.cliente}</DialogTitle>
              <span className="text-sm font-mono text-muted-foreground">#{request.id}</span>
              <StatusBadge status={displayStatus} />
            </div>
            <div className="flex items-center gap-2 mr-8">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleShare}
                title="Copiar link a esta cotización"
                data-testid="button-share-ofertas"
              >
                <Share2 className="h-4 w-4" />
              </Button>
              {canEditInCurrentStatus && !isEditMode && (
                <Button variant="outline" size="sm" onClick={() => setIsEditMode(true)} data-testid="button-edit-request">
                  <Edit3 className="h-4 w-4 mr-1" />
                  Editar
                </Button>
              )}
              {isEditMode && (
                <>
                  <Button 
                    variant="default" 
                    size="sm" 
                    onClick={handleSaveEdits}
                    disabled={isSavingEdit}
                    data-testid="button-save-edits"
                  >
                    <Check className="h-4 w-4 mr-1" />
                    {isSavingEdit ? "Guardando..." : "Guardar"}
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      setIsEditMode(false);
                      setEditingRouteId(null);
                      setShowAddRouteForm(false);
                    }}
                    disabled={isSavingEdit}
                    data-testid="button-cancel-edit"
                  >
                    Cancelar
                  </Button>
                </>
              )}
              {canDelete && !isEditMode && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setShowDeleteConfirm(true)} 
                  className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  data-testid="button-delete-request"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Eliminar
                </Button>
              )}
              {availableStatusOptions.length > 0 && (
                <Select value={displayStatus} onValueChange={(value) => handleStatusChange(value as PricingStatus)}>
                  <SelectTrigger className="w-[180px]" data-testid="select-status">
                    <SelectValue placeholder="Cambiar status" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableStatusOptions.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="flex items-center gap-1" data-testid="urgency-selector">
                {[1, 2, 3].map((level) => (
                  <Button
                    key={level}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-8 w-8 p-0 text-xs font-bold",
                      (request.urgencia || 0) >= level
                        ? level >= 3 ? "text-red-500 bg-red-500/10" 
                          : level === 2 ? "text-orange-500 bg-orange-500/10" 
                          : "text-yellow-500 bg-yellow-500/10"
                        : "text-muted-foreground/40"
                    )}
                    onClick={() => handleUrgencyChange((request.urgencia || 0) === level ? 0 : level)}
                    title={level === 1 ? "Urgente" : level === 2 ? "Muy urgente" : "Crítico"}
                    data-testid={`urgency-level-${level}`}
                  >
                    !
                  </Button>
                ))}
              </div>

              {canEditFechaEntrega && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="fechaEntrega" className="text-xs whitespace-nowrap">Entrega:</Label>
                  <Input
                    id="fechaEntrega"
                    type="date"
                    className="h-8 w-[140px] text-xs"
                    value={request.fechaEntrega ? new Date(request.fechaEntrega).toISOString().split("T")[0] : ""}
                    onChange={(e) => handleFechaEntregaChange(e.target.value)}
                    data-testid="input-fecha-entrega"
                  />
                </div>
              )}
              {!canEditFechaEntrega && request.fechaEntrega && (
                <span className={cn(
                  "text-xs",
                  new Date(request.fechaEntrega) < new Date() && !["ganada", "perdida", "rechazada"].includes(request.status)
                    ? "text-red-500 font-semibold" : "text-muted-foreground"
                )}>
                  Entrega: {new Date(request.fechaEntrega).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
              )}
            </div>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="requerimiento">Requerimiento</TabsTrigger>
            {canViewOffers && (
              <TabsTrigger value="ofertas" className="gap-1">
                Ofertas
                {totalOfertas > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs">{totalOfertas}</Badge>
                )}
              </TabsTrigger>
            )}
            <TabsTrigger value="venta">Venta</TabsTrigger>
            <TabsTrigger value="historial">Historial</TabsTrigger>
            <TabsTrigger value="comentarios">Comentarios</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Información Comercial</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Cliente</span>
                    <span className="text-sm font-medium">{request.cliente}</span>
                  </div>
                  {request.prospecto && (
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Prospecto</span>
                      <span className="text-sm font-medium">{request.prospecto}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Sales Rep</span>
                    <span className="text-sm font-medium">{request.salesRep}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">División</span>
                    <span className="text-sm font-medium">{request.division}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Fecha</span>
                    <span className="text-sm font-medium">{request.fecha}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">RFQ</span>
                    {request.esRFQ ? (
                      <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 hover:bg-blue-100" data-testid="badge-overview-rfq">
                        Sí — RFQ
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground" data-testid="badge-overview-rfq">
                        No
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Rutas</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{(isEditMode ? localRutas : request.rutas).length} ruta{(isEditMode ? localRutas : request.rutas).length !== 1 ? "s" : ""}</Badge>
                      {canEditInCurrentStatus && isEditMode && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => setShowAddRouteForm(true)}
                          data-testid="button-add-route"
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Agregar
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(isEditMode ? localRutas : request.rutas).map((ruta) => (
                    <div key={ruta.id} className="p-2 rounded-md bg-muted/50 space-y-1">
                      {isEditMode && editingRouteId === ruta.id ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-xs">Origen *</Label>
                              <Input
                                placeholder="Ciudad origen"
                                value={editingRouteData.origen}
                                onChange={(e) => setEditingRouteData({ ...editingRouteData, origen: e.target.value })}
                                data-testid="input-edit-route-origen"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Destino *</Label>
                              <Input
                                placeholder="Ciudad destino"
                                value={editingRouteData.destino}
                                onChange={(e) => setEditingRouteData({ ...editingRouteData, destino: e.target.value })}
                                data-testid="input-edit-route-destino"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">CP Origen</Label>
                              <Input
                                placeholder="Código postal"
                                value={editingRouteData.cpOrigen}
                                onChange={(e) => setEditingRouteData({ ...editingRouteData, cpOrigen: e.target.value })}
                                data-testid="input-edit-route-cp-origen"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">CP Destino</Label>
                              <Input
                                placeholder="Código postal"
                                value={editingRouteData.cpDestino}
                                onChange={(e) => setEditingRouteData({ ...editingRouteData, cpDestino: e.target.value })}
                                data-testid="input-edit-route-cp-destino"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Volumen</Label>
                              <Input
                                placeholder="Ej: 20 tarimas"
                                value={editingRouteData.volumen}
                                onChange={(e) => setEditingRouteData({ ...editingRouteData, volumen: e.target.value })}
                                data-testid="input-edit-route-volumen"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Frecuencia</Label>
                              <Input
                                placeholder="Ej: Semanal"
                                value={editingRouteData.frecuencia}
                                onChange={(e) => setEditingRouteData({ ...editingRouteData, frecuencia: e.target.value })}
                                data-testid="input-edit-route-frecuencia"
                              />
                            </div>
                            <div className="col-span-2">
                              <Label className="text-xs">Target Cliente</Label>
                              <Input
                                placeholder="Ej: 15000"
                                value={editingRouteData.targetCliente}
                                onChange={(e) => setEditingRouteData({ ...editingRouteData, targetCliente: e.target.value })}
                                data-testid="input-edit-route-target"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={handleCancelRouteEdit} data-testid="button-cancel-route-edit">
                              Cancelar
                            </Button>
                            <Button size="sm" onClick={handleSaveRouteEdit} data-testid="button-save-route-edit">
                              Guardar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 text-sm">
                            <MapPin className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                            <span className="truncate font-medium">{ruta.origen} {ruta.cpOrigen && ruta.cpOrigen !== "N/A" ? `(CP ${ruta.cpOrigen})` : ""}</span>
                            <ArrowRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                            <span className="truncate font-medium">{ruta.destino} {ruta.cpDestino && ruta.cpDestino !== "N/A" ? `(CP ${ruta.cpDestino})` : ""}</span>
                            {canEditInCurrentStatus && isEditMode && (
                              <div className="ml-auto flex items-center gap-1">
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleEditRoute(ruta)} data-testid={`button-edit-route-${ruta.id}`}>
                                  <Edit3 className="h-3 w-3" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => handleDeleteRoute(ruta.id)} data-testid={`button-delete-route-${ruta.id}`}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground pl-5 flex-wrap">
                            {equipoDeRuta(ruta) && (
                              <Badge variant="outline" className="text-xs" data-testid={`badge-equipo-overview-${ruta.id}`}>
                                {equipoDeRuta(ruta)}
                              </Badge>
                            )}
                            {ruta.volumen && <span>Vol: {ruta.volumen}</span>}
                            {ruta.frecuencia && <span>Freq: {ruta.frecuencia}</span>}
                            {ruta.targetCliente && <span className="font-mono">Target: ${ruta.targetCliente}</span>}
                            {ruta.requiereCruce && (
                              <span className="text-blue-600 dark:text-blue-400 font-medium" title={ruta.ciudadCruce || "Requiere cruce"}>
                                🛂 Cruce{ruta.ciudadCruce ? `: ${ruta.ciudadCruce}` : ""}
                              </span>
                            )}
                            {ruta.ofertas.length > 0 && (
                              <Badge variant="outline" className="ml-auto text-xs">
                                {ruta.ofertas.length} oferta{ruta.ofertas.length > 1 ? "s" : ""}
                              </Badge>
                            )}
                          </div>
                          {ruta.stops && ruta.stops.length > 0 && (
                            <div className="pl-5 space-y-0.5">
                              {ruta.stops.map((stop, sIdx) => (
                                <div key={stop.id || sIdx} className="text-xs text-muted-foreground flex items-center gap-2" data-testid={`text-stop-${ruta.id}-${sIdx}`}>
                                  <span className="inline-block w-1 h-1 rounded-full bg-muted-foreground" />
                                  <span className="capitalize font-medium">{stop.tipo}:</span>
                                  <span>{stop.ubicacion}{stop.cp ? ` (CP ${stop.cp})` : ""}</span>
                                  {stop.notas && <span className="italic">— {stop.notas}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  
                  {/* Add Route Form */}
                  {showAddRouteForm && (
                    <div className="p-3 rounded-md border bg-card space-y-3">
                      <p className="text-sm font-medium">Nueva Ruta</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Origen *</Label>
                          <Input
                            placeholder="Ciudad origen"
                            value={newRoute.origen}
                            onChange={(e) => setNewRoute({ ...newRoute, origen: e.target.value })}
                            data-testid="input-route-origen"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Destino *</Label>
                          <Input
                            placeholder="Ciudad destino"
                            value={newRoute.destino}
                            onChange={(e) => setNewRoute({ ...newRoute, destino: e.target.value })}
                            data-testid="input-route-destino"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">CP Origen</Label>
                          <Input
                            placeholder="Código postal"
                            value={newRoute.cpOrigen}
                            onChange={(e) => setNewRoute({ ...newRoute, cpOrigen: e.target.value })}
                            data-testid="input-route-cp-origen"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">CP Destino</Label>
                          <Input
                            placeholder="Código postal"
                            value={newRoute.cpDestino}
                            onChange={(e) => setNewRoute({ ...newRoute, cpDestino: e.target.value })}
                            data-testid="input-route-cp-destino"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Volumen</Label>
                          <Input
                            placeholder="Volumen"
                            value={newRoute.volumen}
                            onChange={(e) => setNewRoute({ ...newRoute, volumen: e.target.value })}
                            data-testid="input-route-volumen"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Frecuencia</Label>
                          <Input
                            placeholder="semanal, mensual..."
                            value={newRoute.frecuencia}
                            onChange={(e) => setNewRoute({ ...newRoute, frecuencia: e.target.value })}
                            data-testid="input-route-frecuencia"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Tipo de Equipo {equiposCotizacion.length > 1 ? "*" : ""}</Label>
                          <Select
                            value={newRoute.tipoEquipo}
                            onValueChange={(value) => setNewRoute({ ...newRoute, tipoEquipo: value })}
                          >
                            <SelectTrigger data-testid="select-route-equipo">
                              <SelectValue
                                placeholder={
                                  equiposCotizacion.length === 1
                                    ? equiposCotizacion[0]
                                    : "Seleccionar equipo"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {equiposOpciones.map((nombre) => (
                                <SelectItem key={nombre} value={nombre}>{nombre}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Target Cliente ($)</Label>
                          <Input
                            placeholder="Precio objetivo"
                            value={newRoute.targetCliente}
                            onChange={(e) => setNewRoute({ ...newRoute, targetCliente: e.target.value })}
                            data-testid="input-route-target"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Button size="sm" onClick={handleAddRoute} data-testid="button-save-route">
                          <Plus className="h-3 w-3 mr-1" />
                          Agregar Ruta
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setShowAddRouteForm(false)} data-testid="button-cancel-route">
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-2 pt-2 border-t">
                    <Truck className="h-4 w-4 text-muted-foreground" />
                    <Badge variant="secondary">{request.tipoEquipo}</Badge>
                  </div>
                </CardContent>
              </Card>
            </div>

            {request.costoEsperado !== undefined && request.ventaSugerida !== undefined && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Resumen Financiero</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-6">
                    <div>
                      <p className="text-sm text-muted-foreground">Costo Esperado</p>
                      <p className="text-2xl font-bold font-mono">{formatCurrency(request.costoEsperado)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Venta Sugerida</p>
                      <p className="text-2xl font-bold font-mono">{formatCurrency(request.ventaSugerida)}</p>
                    </div>
                    {request.margen !== undefined && (
                      <div>
                        <p className="text-sm text-muted-foreground">Margen</p>
                        <p className={cn(
                          "text-2xl font-bold font-mono",
                          request.margen >= 15 ? "text-emerald-600" : request.margen >= 10 ? "text-amber-600" : "text-red-600"
                        )}>
                          {request.margen.toFixed(1)}%
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="requerimiento" className="mt-4">
            <Card>
              <CardContent className="pt-6 space-y-4">
                {isEditMode && canEditInCurrentStatus ? (
                  <div className="space-y-4">
                    <p className="text-sm font-medium text-muted-foreground">Modo Edición</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <Label className="text-xs text-muted-foreground">Producto</Label>
                        <Input
                          value={editedFields.producto}
                          onChange={(e) => setEditedFields({ ...editedFields, producto: e.target.value })}
                          placeholder="Producto"
                          data-testid="input-edit-producto"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Peso</Label>
                        <div className="flex gap-2">
                          <Input
                            value={editedFields.peso}
                            onChange={(e) => setEditedFields({ ...editedFields, peso: e.target.value })}
                            placeholder="Peso"
                            className="flex-1"
                            data-testid="input-edit-peso"
                          />
                          <Select
                            value={editedFields.unidadMedida}
                            onValueChange={(value) => setEditedFields({ ...editedFields, unidadMedida: value })}
                          >
                            <SelectTrigger className="w-20" data-testid="select-edit-unidad">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="TON">TON</SelectItem>
                              <SelectItem value="KG">KG</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Tiempo Carga/Descarga</Label>
                        <Input
                          value={editedFields.tiempoCargaDescarga}
                          onChange={(e) => setEditedFields({ ...editedFields, tiempoCargaDescarga: e.target.value })}
                          placeholder="2 horas, 4 horas..."
                          data-testid="input-edit-tiempo"
                        />
                      </div>
                      <div className="col-span-2 md:col-span-3">
                        <Label className="text-xs text-muted-foreground">Notas Comerciales</Label>
                        <Textarea
                          value={editedFields.notasCargaComercial}
                          onChange={(e) => setEditedFields({ ...editedFields, notasCargaComercial: e.target.value })}
                          placeholder="Notas adicionales..."
                          rows={3}
                          data-testid="input-edit-notas"
                        />
                      </div>
                    </div>
                    
                    {request.division?.toLowerCase() === "ltl" && (
                      <>
                        <Separator />
                        <p className="text-sm font-medium">Dimensiones LTL</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div>
                            <Label className="text-xs text-muted-foreground">Largo (cm)</Label>
                            <Input
                              value={editedFields.ltlLargo}
                              onChange={(e) => setEditedFields({ ...editedFields, ltlLargo: e.target.value })}
                              placeholder="Largo"
                              data-testid="input-edit-ltl-largo"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Ancho (cm)</Label>
                            <Input
                              value={editedFields.ltlAncho}
                              onChange={(e) => setEditedFields({ ...editedFields, ltlAncho: e.target.value })}
                              placeholder="Ancho"
                              data-testid="input-edit-ltl-ancho"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Alto (cm)</Label>
                            <Input
                              value={editedFields.ltlAlto}
                              onChange={(e) => setEditedFields({ ...editedFields, ltlAlto: e.target.value })}
                              placeholder="Alto"
                              data-testid="input-edit-ltl-alto"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Peso (kg)</Label>
                            <Input
                              value={editedFields.ltlPeso}
                              onChange={(e) => setEditedFields({ ...editedFields, ltlPeso: e.target.value })}
                              placeholder="Peso"
                              data-testid="input-edit-ltl-peso"
                            />
                          </div>
                          <div className="col-span-2 md:col-span-4">
                            <Label className="text-xs text-muted-foreground">Links de Imágenes (separados por coma)</Label>
                            <Textarea
                              value={editedFields.ltlImagenes}
                              onChange={(e) => setEditedFields({ ...editedFields, ltlImagenes: e.target.value })}
                              placeholder="https://ejemplo.com/imagen1.jpg, https://ejemplo.com/imagen2.jpg"
                              rows={2}
                              data-testid="input-edit-ltl-imagenes"
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Tipo de Equipo</p>
                    <p className="font-medium">{request.tipoEquipo}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Peso</p>
                    <p className="font-medium">
                      {request.peso ? `${request.peso} ${request.unidadMedida || "TON"}` : "No especificado"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Producto</p>
                    <p className="font-medium">{request.producto || "No especificado"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Tiempo Carga/Descarga</p>
                    <p className="font-medium">{request.tiempoCargaDescarga || "No especificado"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Certificación</p>
                    <p className="font-medium">{request.certificacion || "No requerida"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Accesorios</p>
                    <p className="font-medium">
                      {request.accesorios && request.accesorios.length > 0 
                        ? request.accesorios.join(", ") 
                        : "Ninguno"}
                    </p>
                  </div>
                </div>
                )}
                
                {/* LTL Details Section - Dimensions + Images (only for LTL division) - only show in view mode */}
                {!isEditMode && request.division?.toLowerCase() === "ltl" && (
                  <>
                    <Separator />
                    <div className="space-y-4">
                      <p className="text-sm font-medium">Dimensiones LTL (Less Than Truckload)</p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-xs text-muted-foreground">Largo (cm)</p>
                          <p className="font-medium font-mono">{request.ltlLargo || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Ancho (cm)</p>
                          <p className="font-medium font-mono">{request.ltlAncho || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Alto (cm)</p>
                          <p className="font-medium font-mono">{request.ltlAlto || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Peso (kg)</p>
                          <p className="font-medium font-mono">{request.ltlPeso || "—"}</p>
                        </div>
                      </div>
                      
                      {/* LTL Images Links */}
                      <div className="pt-2">
                        <p className="text-xs text-muted-foreground mb-2">Links de Imágenes</p>
                        {request.ltlImagenes ? (
                          <div className="space-y-2">
                            {(() => {
                              let urls: string[] = [];
                              try {
                                const parsed = JSON.parse(request.ltlImagenes || "[]");
                                urls = Array.isArray(parsed) ? parsed : [];
                              } catch {
                                urls = request.ltlImagenes?.split(/[,\n]/).map(u => u.trim()).filter(Boolean) || [];
                              }
                              return urls.map((url: string, idx: number) => (
                                <a 
                                  key={idx}
                                  href={url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="block text-sm text-primary hover:underline truncate"
                                  data-testid={`ltl-image-link-${idx}`}
                                >
                                  {url}
                                </a>
                              ));
                            })()}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">Sin imágenes</p>
                        )}
                      </div>
                    </div>
                  </>
                )}
                
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {request.linkDocumento && (
                    <div className="col-span-2 md:col-span-3">
                      <p className="text-sm text-muted-foreground">Link al Documento</p>
                      <a 
                        href={request.linkDocumento} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary hover:underline font-medium flex items-center gap-1"
                        data-testid="link-documento"
                      >
                        <ExternalLink className="h-4 w-4" />
                        {request.linkDocumento}
                      </a>
                    </div>
                  )}
                </div>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Notas Comerciales</p>
                  <p className="text-sm">{request.notasComercial || "Sin notas"}</p>
                </div>
                
              </CardContent>
            </Card>
          </TabsContent>

          {canViewOffers && (
          <TabsContent value="ofertas" className="mt-4 space-y-4">
            {request.rutas.map((ruta) => (
              <Card key={ruta.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <MapPin className="h-4 w-4 text-primary flex-shrink-0" />
                        <CardTitle className="text-sm font-medium">
                          {ruta.origen} {ruta.cpOrigen && ruta.cpOrigen !== "N/A" ? `(CP ${ruta.cpOrigen})` : ""} <ArrowRight className="h-3 w-3 inline mx-1" /> {ruta.destino} {ruta.cpDestino && ruta.cpDestino !== "N/A" ? `(CP ${ruta.cpDestino})` : ""}
                        </CardTitle>
                        {equipoDeRuta(ruta) && (
                          <Badge variant="outline" className="text-xs" data-testid={`badge-equipo-oferta-${ruta.id}`}>
                            {equipoDeRuta(ruta)}
                          </Badge>
                        )}
                        {ruta.requiereCruce && (
                          <span className="text-xs text-blue-600 dark:text-blue-400 font-medium" title={ruta.ciudadCruce || "Requiere cruce"} data-testid={`text-offer-cruce-${ruta.id}`}>
                            🛂 Cruce{ruta.ciudadCruce ? `: ${ruta.ciudadCruce}` : ""}
                          </span>
                        )}
                      </div>
                      {(ruta.volumen || ruta.frecuencia || ruta.targetCliente) && (
                        <div className="flex items-center gap-3 ml-6 text-xs text-muted-foreground flex-wrap">
                          {ruta.volumen && <span>Vol: {ruta.volumen}</span>}
                          {ruta.frecuencia && <span>Frecuencia: {ruta.frecuencia}</span>}
                          {ruta.targetCliente && <span className="font-mono text-primary font-medium">Target: {ruta.targetCliente}</span>}
                        </div>
                      )}
                      {ruta.stops && ruta.stops.length > 0 && (
                        <div className="ml-6 space-y-0.5 mt-1">
                          {ruta.stops.map((stop, sIdx) => (
                            <div key={stop.id || sIdx} className="text-xs text-muted-foreground flex items-center gap-2" data-testid={`text-offer-stop-${ruta.id}-${sIdx}`}>
                              <span className="inline-block w-1 h-1 rounded-full bg-muted-foreground" />
                              <span className="capitalize font-medium">{stop.tipo}:</span>
                              <span>{stop.ubicacion}{stop.cp ? ` (CP ${stop.cp})` : ""}</span>
                              {stop.notas && <span className="italic">— {stop.notas}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {canAddOffer && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAddOfferForm(showAddOfferForm === ruta.id ? null : ruta.id)}
                        data-testid={`button-add-offer-${ruta.id}`}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Agregar Oferta
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {renderPrediccionCard(ruta)}
                  {showAddOfferForm === ruta.id && (
                    <div className="p-4 rounded-lg border border-dashed bg-muted/30 space-y-4">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-sm font-medium">Nueva Oferta</p>
                        {canPredictTarifa && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePredictTarifa(ruta.id, ruta.origen, ruta.destino)}
                            disabled={predictingRouteId === ruta.id}
                            data-testid={`button-predict-tarifa-${ruta.id}`}
                          >
                            <Sparkles className="h-4 w-4 mr-1" />
                            {predictingRouteId === ruta.id ? "Calculando..." : "Calcular referencia de costo"}
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="carrier">Nombre Carrier</Label>
                          <Input
                            id="carrier"
                            placeholder="Ej: Transportes del Norte"
                            value={newOffer.carrier}
                            onChange={(e) => setNewOffer({ ...newOffer, carrier: e.target.value })}
                            data-testid="input-offer-carrier"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="costo">Costo</Label>
                          <Input
                            id="costo"
                            type="number"
                            placeholder="Ej: 45000"
                            value={newOffer.costo}
                            onChange={(e) => setNewOffer({ ...newOffer, costo: e.target.value })}
                            data-testid="input-offer-cost"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="moneda">Moneda</Label>
                          <Select
                            value={newOffer.moneda}
                            onValueChange={(value) => setNewOffer({ ...newOffer, moneda: value as "MXN" | "USD" })}
                          >
                            <SelectTrigger id="moneda" data-testid="select-offer-moneda">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="MXN">MXN</SelectItem>
                              <SelectItem value="USD">USD</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="disponibilidad">Disponibilidad (uds)</Label>
                          <Input
                            id="disponibilidad"
                            type="number"
                            placeholder="Ej: 10"
                            value={newOffer.disponibilidad}
                            onChange={(e) => setNewOffer({ ...newOffer, disponibilidad: e.target.value })}
                            data-testid="input-offer-availability"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="frecuencia">Frecuencia</Label>
                          <Select
                            value={newOffer.frecuencia}
                            onValueChange={(value) => setNewOffer({ ...newOffer, frecuencia: value })}
                          >
                            <SelectTrigger id="frecuencia" data-testid="select-offer-frequency">
                              <SelectValue placeholder="Frecuencia" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="diaria">Diaria</SelectItem>
                              <SelectItem value="semanal">Semanal</SelectItem>
                              <SelectItem value="mensual">Mensual</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pt-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          Carrier Rep: <span className="font-medium text-foreground">{user?.name}</span>
                        </span>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowAddOfferForm(null);
                            setNewOffer({ carrier: "", costo: "", disponibilidad: "", frecuencia: "semanal", moneda: "MXN" });
                          }}
                        >
                          Cancelar
                        </Button>
                        <Button size="sm" onClick={() => handleAddOffer(ruta.id)} data-testid="button-submit-offer">
                          Guardar Oferta
                        </Button>
                      </div>
                    </div>
                  )}

                  {(() => {
                    const allOffers = getOffersForRoute(ruta.id, ruta.ofertas);
                    return allOffers.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground text-sm">
                        Sin ofertas para esta ruta
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {allOffers.map((oferta) => (
                          <div
                            key={oferta.id}
                            className={cn(
                              "p-4 rounded-lg border",
                              canSelectOffer && editingOfferId !== oferta.id && "cursor-pointer hover-elevate",
                              oferta.seleccionado && "bg-primary/10 border-primary"
                            )}
                            onClick={() => editingOfferId !== oferta.id && canSelectOffer && handleSelectOffer(ruta.id, oferta.id, oferta.costo)}
                          >
                            {editingOfferId === oferta.id ? (
                              <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                                <p className="text-sm font-medium">Editar Oferta</p>
                                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-xs">Carrier</Label>
                                    <Input
                                      value={editingOfferData.carrier}
                                      onChange={(e) => setEditingOfferData({ ...editingOfferData, carrier: e.target.value })}
                                      data-testid={`input-edit-offer-carrier-${oferta.id}`}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">Costo</Label>
                                    <Input
                                      type="number"
                                      value={editingOfferData.costo}
                                      onChange={(e) => setEditingOfferData({ ...editingOfferData, costo: e.target.value })}
                                      data-testid={`input-edit-offer-cost-${oferta.id}`}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">Moneda</Label>
                                    <Select
                                      value={editingOfferData.moneda}
                                      onValueChange={(value) => setEditingOfferData({ ...editingOfferData, moneda: value as "MXN" | "USD" })}
                                    >
                                      <SelectTrigger data-testid={`select-edit-offer-moneda-${oferta.id}`}>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="MXN">MXN</SelectItem>
                                        <SelectItem value="USD">USD</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">Disponibilidad</Label>
                                    <Input
                                      type="number"
                                      value={editingOfferData.disponibilidad}
                                      onChange={(e) => setEditingOfferData({ ...editingOfferData, disponibilidad: e.target.value })}
                                      data-testid={`input-edit-offer-availability-${oferta.id}`}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">Frecuencia</Label>
                                    <Select
                                      value={editingOfferData.frecuencia}
                                      onValueChange={(value) => setEditingOfferData({ ...editingOfferData, frecuencia: value })}
                                    >
                                      <SelectTrigger data-testid={`select-edit-offer-frequency-${oferta.id}`}>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="diaria">Diaria</SelectItem>
                                        <SelectItem value="semanal">Semanal</SelectItem>
                                        <SelectItem value="mensual">Mensual</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                                <div className="flex justify-end gap-2">
                                  <Button variant="ghost" size="sm" onClick={handleCancelEditOffer} data-testid={`button-cancel-edit-offer-${oferta.id}`}>
                                    Cancelar
                                  </Button>
                                  <Button size="sm" onClick={() => handleSaveEditOffer(ruta.id, oferta.id)} data-testid={`button-save-edit-offer-${oferta.id}`}>
                                    Guardar
                                  </Button>
                                </div>
                              </div>
                            ) : (
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex items-start gap-3">
                                {(canSelectOffer || oferta.seleccionado) && (
                                  <div className={cn(
                                    "mt-0.5 h-5 w-5 rounded border-2 flex items-center justify-center transition-colors",
                                    oferta.seleccionado 
                                      ? "bg-primary border-primary text-primary-foreground" 
                                      : "border-muted-foreground/30"
                                  )}>
                                    {oferta.seleccionado && <Check className="h-3.5 w-3.5" />}
                                  </div>
                                )}
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold">{oferta.carrier}</span>
                                    {oferta.seleccionado && <Badge variant="default">Seleccionado</Badge>}
                                  </div>
                                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                    <div className="flex items-center gap-1">
                                      <Package className="h-3.5 w-3.5" />
                                      <span>{oferta.disponibilidad} unidades{oferta.frecuencia ? ` / ${oferta.frecuencia}` : ""}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <User className="h-3.5 w-3.5" />
                                      <span>{oferta.carrierRep}</span>
                                    </div>
                                  </div>
                                  <p className="text-xs text-muted-foreground">{oferta.fechaOferta}</p>
                                </div>
                              </div>
                              <div className="text-right flex flex-col items-end gap-1">
                                <p className="text-lg font-bold font-mono" data-testid={`text-offer-cost-${oferta.id}`}>
                                  {formatOfferCost(oferta.costo, oferta.moneda)}
                                </p>
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-mono">
                                  {oferta.moneda || "MXN"}
                                </Badge>
                                {canAddOffer && (
                                  <div className="flex gap-1 mt-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 px-2"
                                      onClick={(e) => { e.stopPropagation(); handleStartEditOffer(ruta.id, oferta); }}
                                      data-testid={`button-edit-offer-${oferta.id}`}
                                    >
                                      <Pencil className="h-3 w-3 mr-1" />
                                      Editar
                                    </Button>
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 px-2 text-destructive hover:text-destructive"
                                          onClick={(e) => e.stopPropagation()}
                                          data-testid={`button-delete-offer-${oferta.id}`}
                                        >
                                          <Trash2 className="h-3 w-3 mr-1" />
                                          Eliminar
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>¿Eliminar oferta?</AlertDialogTitle>
                                          <AlertDialogDescription>
                                            Se eliminará la oferta de <strong>{oferta.carrier}</strong> ({oferta.moneda || "MXN"} ${oferta.costo.toLocaleString()}). Esta acción quedará registrada en el historial.
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel data-testid={`button-cancel-delete-offer-${oferta.id}`}>Cancelar</AlertDialogCancel>
                                          <AlertDialogAction
                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                            onClick={() => handleDeleteOffer(ruta.id, oferta)}
                                            data-testid={`button-confirm-delete-offer-${oferta.id}`}
                                          >
                                            Eliminar
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  </div>
                                )}
                              </div>
                            </div>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            ))}
          </TabsContent>
          )}

          <TabsContent value="venta" className="mt-4 space-y-4">
            {request.rutas.map((ruta, index) => {
              const routeInfo = routeSalesInfo[ruta.id] || { costoEsperado: "", ventaSugerida: "", margen: "" };
              const monedaRuta = routeInfo.moneda || ruta.monedaVenta || "MXN";
              const editandoVentaFinal = !!ventaFinalEditing[ruta.id];
              const ventaFinalSection = canEditVentaFinal || ruta.ventaFinal !== undefined ? (
                <div className="pt-1 space-y-2">
                  {ruta.ventaFinal !== undefined && (
                    <div className="flex items-center gap-3">
                      <div className="space-y-0.5">
                        <p className="text-xs text-muted-foreground">Venta Final</p>
                        <p className="font-mono font-semibold" data-testid={`text-venta-final-${ruta.id}`}>
                          {formatOfferCost(ruta.ventaFinal, monedaRuta)}
                        </p>
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-xs text-muted-foreground">Venta Sugerida original</p>
                        <p className="font-mono text-sm text-muted-foreground" data-testid={`text-venta-sugerida-original-${ruta.id}`}>
                          {formatOfferCost(ruta.ventaSugerida || 0, monedaRuta)}
                        </p>
                      </div>
                    </div>
                  )}
                  {canEditVentaFinal && !editandoVentaFinal && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      onClick={() => {
                        setVentaFinalDraft(prev => ({ ...prev, [ruta.id]: ruta.ventaFinal?.toString() || "" }));
                        setVentaFinalEditing(prev => ({ ...prev, [ruta.id]: true }));
                      }}
                      data-testid={`button-cambiar-venta-final-${ruta.id}`}
                    >
                      {ruta.ventaFinal !== undefined ? "Editar venta final" : "Cambiar venta final"}
                    </Button>
                  )}
                  {canEditVentaFinal && editandoVentaFinal && (
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1">
                        <Label htmlFor={`venta-final-${ruta.id}`} className="text-xs">Venta Final</Label>
                        <Input
                          id={`venta-final-${ruta.id}`}
                          type="number"
                          placeholder={`Ej: ${ruta.ventaSugerida || 55000}`}
                          className="font-mono h-8 w-40"
                          value={ventaFinalDraft[ruta.id] || ""}
                          onChange={(e) => setVentaFinalDraft(prev => ({ ...prev, [ruta.id]: e.target.value }))}
                          data-testid={`input-venta-final-${ruta.id}`}
                        />
                      </div>
                      <Button
                        size="sm"
                        className="h-8"
                        onClick={() => handleSaveVentaFinal(ruta.id)}
                        disabled={isSavingVentaFinal}
                        data-testid={`button-guardar-venta-final-${ruta.id}`}
                      >
                        {isSavingVentaFinal ? "Guardando..." : "Guardar"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        onClick={() => setVentaFinalEditing(prev => ({ ...prev, [ruta.id]: false }))}
                        data-testid={`button-cancelar-venta-final-${ruta.id}`}
                      >
                        Cancelar
                      </Button>
                    </div>
                  )}
                </div>
              ) : null;
              
              return (
                <Card key={ruta.id}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="h-4 w-4" />
                        <span>Ruta {index + 1}:</span>
                      </div>
                      <span className="font-semibold">{ruta.origen}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold">{ruta.destino}</span>
                      {ruta.tipoEquipo && (
                        <Badge variant="outline" data-testid={`badge-equipo-ruta-${ruta.id}`}>
                          {ruta.tipoEquipo}
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                        <div className="flex items-center gap-3 pb-1">
                          {canAddSalesInfo && (
                          <>
                          <Label htmlFor={`moneda-venta-${ruta.id}`} className="text-sm">Moneda</Label>
                          <Select
                            value={routeInfo.moneda || "MXN"}
                            onValueChange={(value) => setRouteSalesInfo(prev => ({
                              ...prev,
                              [ruta.id]: { ...prev[ruta.id], moneda: value as "MXN" | "USD" },
                            }))}
                          >
                            <SelectTrigger id={`moneda-venta-${ruta.id}`} className="w-28 h-8" data-testid={`select-moneda-venta-${ruta.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="MXN">MXN</SelectItem>
                              <SelectItem value="USD">USD</SelectItem>
                            </SelectContent>
                          </Select>
                          </>
                          )}
                          <div className="flex-1" />
                        </div>
                    {canAddSalesInfo ? (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor={`costo-${ruta.id}`}>Costo Esperado</Label>
                            <Input
                              id={`costo-${ruta.id}`}
                              type="number"
                              placeholder="Ej: 45000"
                              className="font-mono"
                              value={routeInfo.costoEsperado}
                              onChange={(e) => updateRouteSalesInfo(ruta.id, "costoEsperado", e.target.value)}
                              data-testid={`input-costo-esperado-${ruta.id}`}
                            />
                            <p className="text-xs text-muted-foreground">
                              {routePredictions[ruta.id] && String(routeInfo.costoEsperado) === String(routePredictions[ruta.id]?.costoEstimado ?? "")
                                ? "Costo estimado por el modelo — pendiente de confirmar con transportista"
                                : "Costo confirmado con transportista (o estimado por el modelo)"}
                            </p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`venta-${ruta.id}`}>Venta Sugerida</Label>
                            <Input
                              id={`venta-${ruta.id}`}
                              type="number"
                              placeholder="Ej: 55000"
                              className="font-mono"
                              value={routeInfo.ventaSugerida}
                              onChange={(e) => updateRouteSalesInfo(ruta.id, "ventaSugerida", e.target.value)}
                              data-testid={`input-venta-sugerida-${ruta.id}`}
                            />
                            <p className="text-xs text-muted-foreground">Tarifa propuesta al cliente</p>
                            {ventaFinalSection}
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`margen-${ruta.id}`}>Margen Estimado</Label>
                            <div className="flex items-center gap-2">
                              <Input
                                id={`margen-${ruta.id}`}
                                type="number"
                                step="0.1"
                                placeholder="10"
                                className={cn(
                                  "font-mono font-bold text-center",
                                  !routeInfo.margen ? "bg-muted" :
                                  parseFloat(routeInfo.margen) >= 15 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
                                  parseFloat(routeInfo.margen) >= 10 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                                  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                )}
                                value={routeInfo.margen || ""}
                                onChange={(e) => updateMargin(ruta.id, e.target.value)}
                                data-testid={`input-margen-${ruta.id}`}
                              />
                              <span className="text-lg font-bold">%</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleSaveRouteSalesInfo(ruta.id)}
                            disabled={isSavingSales}
                            data-testid={`button-save-sales-${ruta.id}`}
                          >
                            {isSavingSales ? "Guardando..." : "Guardar Ruta"}
                          </Button>
                        </div>
                      </>
                    ) : canViewSalesInfo ? (
                      (() => {
                        const costo = ruta.costoEsperado || 0;
                        const venta = ruta.ventaSugerida || 0;
                        const moneda = ruta.monedaVenta || "MXN";
                        // Same formula used across the app: margin over cost
                        const margen = costo > 0 && venta > 0 ? ((venta - costo) / costo) * 100 : null;
                        if (venta === 0) {
                          return (
                            <>
                            <div className="text-center py-4 text-muted-foreground" data-testid={`text-venta-pendiente-${ruta.id}`}>
                              Aún no se ha registrado la venta para esta ruta
                            </div>
                            {ventaFinalSection}
                            </>
                          );
                        }
                        return (
                          <>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Costo Esperado</p>
                              <p className="font-mono font-semibold" data-testid={`text-costo-esperado-${ruta.id}`}>
                                {formatOfferCost(costo, moneda)}
                              </p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Venta Sugerida</p>
                              <p className="font-mono font-semibold text-base" data-testid={`text-venta-sugerida-${ruta.id}`}>
                                {formatOfferCost(venta, moneda)}
                              </p>
                              {ventaFinalSection}
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Margen</p>
                              {margen === null ? (
                                <span className="inline-block font-mono font-bold px-2 py-1 rounded bg-muted text-muted-foreground" data-testid={`text-margen-${ruta.id}`}>
                                  —
                                </span>
                              ) : (
                                <span
                                  className={cn(
                                    "inline-block font-mono font-bold px-2 py-1 rounded",
                                    margen >= 15 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
                                    margen >= 10 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                                    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                  )}
                                  data-testid={`text-margen-${ruta.id}`}
                                >
                                  {margen.toFixed(1)}%
                                </span>
                              )}
                            </div>
                          </div>
                          </>
                        );
                      })()
                    ) : (
                      <div className="text-center py-4 text-muted-foreground">
                        No tienes permisos para ver información de venta
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="historial" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  {localHistorial.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No hay actividad registrada</p>
                  ) : (
                    [...localHistorial].reverse().map((item, index) => (
                      <div key={index} className="flex gap-4">
                        <div className="flex flex-col items-center">
                          <div className="h-2 w-2 rounded-full bg-primary" />
                          {index < localHistorial.length - 1 && (
                            <div className="flex-1 w-px bg-border my-1" />
                          )}
                        </div>
                        <div className="flex-1 pb-4">
                          <div className="flex items-center gap-2 text-sm">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span className="text-muted-foreground">{item.fecha}</span>
                          </div>
                          <p className="font-medium mt-1">{item.accion}</p>
                          <p className="text-sm text-muted-foreground">{item.usuario}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="comentarios" className="mt-4">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs">
                      {user?.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 space-y-2">
                    <MentionInput
                      value={newComment}
                      onChange={setNewComment}
                      placeholder="Agregar un comentario... (escribe @ para mencionar)"
                      rows={2}
                      data-testid="textarea-new-comment"
                    />
                    <Button size="sm" onClick={handleAddComment} data-testid="button-add-comment">
                      <MessageSquare className="h-4 w-4 mr-1" />
                      Comentar
                    </Button>
                  </div>
                </div>
                <Separator />
                <div className="space-y-4">
                  {localComentarios.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No hay comentarios aun</p>
                  ) : (
                    localComentarios.map((comment) => (
                      <div key={comment.id} className="flex gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs">
                            {comment.usuario.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{comment.usuario}</span>
                            <span className="text-xs text-muted-foreground">{comment.fecha}</span>
                          </div>
                          <p className="text-sm mt-1">{renderCommentWithMentions(comment.texto)}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>

    <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Estás seguro que vas a borrar?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer. La cotización #{request.id} será eliminada permanentemente.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction 
            onClick={handleDelete} 
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="button-confirm-delete"
          >
            {isDeleting ? "Eliminando..." : "Eliminar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
