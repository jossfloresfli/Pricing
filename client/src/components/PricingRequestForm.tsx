import { useState, useEffect, Fragment, useRef } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Plus, Trash2, Link2, Loader2, Check, ChevronsUpDown, PlusCircle, X, ChevronDown, ChevronUp, Globe2, MapPin } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { PlacesAutocomplete, type PlaceDetails } from "./PlacesAutocomplete";
import { cn } from "@/lib/utils";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Cliente, Prospecto, SalesRep, Division, TipoEquipo, Accesorio, PricingRequest } from "@shared/schema";

export const CIUDADES_CRUCE = [
  "Nuevo Laredo, TAMPS - Laredo, TX",
  "Tijuana, BC - San Diego, CA",
  "Mexicali, BC - Calexico, CA",
  "Ciudad Juárez, CHIH - El Paso, TX",
  "Nogales, SON - Nogales, AZ",
  "Piedras Negras, COAH - Eagle Pass, TX",
  "Colombia, NL - Laredo, TX",
  "Reynosa, TAMPS - Hidalgo/McAllen, TX",
  "San Luis Río Colorado, SON - San Luis, AZ",
  "Matamoros, TAMPS - Brownsville, TX",
];

export const TIPOS_STOP = [
  { value: "recoleccion", label: "Recolección" },
  { value: "parada", label: "Parada intermedia" },
  { value: "entrega", label: "Entrega" },
] as const;

export type StopTipo = (typeof TIPOS_STOP)[number]["value"];

export interface RouteStop {
  id: string;
  ubicacion: string;
  cp: string;
  tipo: StopTipo;
  notas?: string;
}

const formSchema = z.object({
  cliente: z.string().optional(),
  prospecto: z.string().optional(),
  salesRep: z.string().min(1, "Selecciona un representante"),
  division: z.string().min(1, "Selecciona una división"),
  tipoEquipo: z.string().min(1, "Selecciona tipo de equipo"),
  peso: z.string().min(1, "Ingresa el peso"),
  unidadMedida: z.string().min(1, "Selecciona unidad de medida"),
  producto: z.string().min(1, "Ingresa el producto"),
  certificaciones: z.array(z.string()).optional(),
  tiempoCargaDescarga: z.string().optional(),
  accesorios: z.array(z.string()).min(1, "Selecciona al menos un accesorio"),
  esRFQ: z.boolean().default(false),
  linkGoogleSheet: z.string().optional(),
  notasCargaComercial: z.string().optional(),
  ltlAlto: z.string().optional(),
  ltlAncho: z.string().optional(),
  ltlLargo: z.string().optional(),
  ltlPeso: z.string().optional(),
  ltlImagenes: z.string().optional(),
}).refine((data) => (data.cliente && data.cliente.length > 0) || (data.prospecto && data.prospecto.length > 0), {
  message: "Debe seleccionar un Cliente o ingresar un Prospecto",
  path: ["cliente"],
}).refine((data) => !((data.cliente && data.cliente.length > 0) && (data.prospecto && data.prospecto.length > 0)), {
  message: "Solo puedes seleccionar Cliente o Prospecto, no ambos",
  path: ["prospecto"],
});

type FormData = z.infer<typeof formSchema>;

export interface RouteOption {
  id: string;
  tipoEquipo?: string;
  origen: string;
  cpOrigen: string;
  destino: string;
  cpDestino: string;
  volumen: string;
  frecuencia: string;
  targetCliente: string;
  requiereCruce: boolean;
  ciudadCruce?: string;
  stops: RouteStop[];
}

const newRouteId = () =>
  `${Date.now().toString()}-${Math.random().toString(36).slice(2, 7)}`;

const emptyRoute = (id: string): RouteOption => ({
  id,
  origen: "",
  cpOrigen: "",
  destino: "",
  cpDestino: "",
  volumen: "",
  frecuencia: "",
  targetCliente: "",
  requiereCruce: false,
  ciudadCruce: "",
  stops: [],
});

interface PricingRequestFormProps {
  onSubmit?: (data: FormData, routes: RouteOption[]) => void | Promise<void>;
  onCancel?: () => void;
}

export function PricingRequestForm({ onSubmit, onCancel }: PricingRequestFormProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const submitInFlightRef = useRef(false);
  const [isConfirmSubmitting, setIsConfirmSubmitting] = useState(false);
  
  const isSalesRole = user?.role === "sales_rep" || user?.role === "sales_lead";
  
  const { data: clientes = [], isLoading: loadingClientes } = useQuery<Cliente[]>({
    queryKey: ["/api/clientes"],
  });

  const { data: prospectos = [], isLoading: loadingProspectos } = useQuery<Prospecto[]>({
    queryKey: ["/api/prospectos"],
  });
  
  const { data: salesUsers = [], isLoading: loadingSalesUsers } = useQuery<{ id: string; name: string; role: string }[]>({
    queryKey: ["/api/sales-users"],
  });
  
  const { data: divisiones = [], isLoading: loadingDivisiones } = useQuery<Division[]>({
    queryKey: ["/api/divisiones"],
  });
  
  const { data: tiposEquipo = [], isLoading: loadingTiposEquipo } = useQuery<TipoEquipo[]>({
    queryKey: ["/api/tipos-equipo"],
  });
  
  const { data: accesoriosCatalog = [] } = useQuery<Accesorio[]>({
    queryKey: ["/api/accesorios"],
  });

  const isLoadingCatalogs = loadingClientes || loadingSalesUsers || loadingDivisiones || loadingTiposEquipo;

  const [clienteOpen, setClienteOpen] = useState(false);
  const [clienteSearch, setClienteSearch] = useState("");
  const [prospectoOpen, setProspectoOpen] = useState(false);
  const [prospectoSearch, setProspectoSearch] = useState("");

  const createProspectoMutation = useMutation({
    mutationFn: async (nombre: string) => {
      const response = await apiRequest("POST", "/api/prospectos", { nombre });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prospectos"] });
    },
  });

  const [showAddEquipoDialog, setShowAddEquipoDialog] = useState(false);
  const [nuevoEquipoNombre, setNuevoEquipoNombre] = useState("");

  const createEquipoMutation = useMutation({
    mutationFn: async (nombre: string) => {
      const response = await apiRequest("POST", "/api/tipos-equipo", { nombre });
      return response.json();
    },
    onSuccess: (newEquipo) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tipos-equipo"] });
      setEquiposSel((prev) => {
        const updated = prev.includes(newEquipo.nombre) ? prev : [...prev, newEquipo.nombre];
        form.setValue("tipoEquipo", updated.join(", "), { shouldValidate: true });
        return updated;
      });
      setShowAddEquipoDialog(false);
      setNuevoEquipoNombre("");
      toast({
        title: "Equipo agregado",
        description: `"${newEquipo.nombre}" se agregó correctamente.`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo agregar el tipo de equipo.",
        variant: "destructive",
      });
    },
  });

  const handleAddEquipo = () => {
    if (nuevoEquipoNombre.trim()) {
      createEquipoMutation.mutate(nuevoEquipoNombre.trim());
    }
  };

  const [showAddAccesorioDialog, setShowAddAccesorioDialog] = useState(false);
  const [nuevoAccesorioNombre, setNuevoAccesorioNombre] = useState("");
  const [selectedAccesorios, setSelectedAccesorios] = useState<string[]>([]);

  const createAccesorioMutation = useMutation({
    mutationFn: async (nombre: string) => {
      const response = await apiRequest("POST", "/api/accesorios", { nombre });
      return response.json();
    },
    onSuccess: (newAccesorio) => {
      queryClient.invalidateQueries({ queryKey: ["/api/accesorios"] });
      const updated = [...selectedAccesorios, newAccesorio.nombre];
      setSelectedAccesorios(updated);
      form.setValue("accesorios", updated);
      setShowAddAccesorioDialog(false);
      setNuevoAccesorioNombre("");
      toast({
        title: "Accesorio agregado",
        description: `"${newAccesorio.nombre}" se agregó correctamente.`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo agregar el accesorio.",
        variant: "destructive",
      });
    },
  });

  const handleAddAccesorio = () => {
    if (nuevoAccesorioNombre.trim()) {
      createAccesorioMutation.mutate(nuevoAccesorioNombre.trim());
    }
  };

  const toggleAccesorio = (nombre: string) => {
    const updated = selectedAccesorios.includes(nombre)
      ? selectedAccesorios.filter((a) => a !== nombre)
      : [...selectedAccesorios, nombre];
    setSelectedAccesorios(updated);
    form.setValue("accesorios", updated);
  };

  const [showAddCertificacionDialog, setShowAddCertificacionDialog] = useState(false);
  const [nuevaCertificacionNombre, setNuevaCertificacionNombre] = useState("");
  const [selectedCertificaciones, setSelectedCertificaciones] = useState<string[]>([]);
  const [certificacionesCatalog, setCertificacionesCatalog] = useState<string[]>([
    "ISO 9001", "CTPAT", "OEA", "FAST", "PIP", "ISO 14001", "BASC"
  ]);

  const handleAddCertificacion = () => {
    if (nuevaCertificacionNombre.trim() && !certificacionesCatalog.includes(nuevaCertificacionNombre.trim())) {
      const newCert = nuevaCertificacionNombre.trim();
      setCertificacionesCatalog([...certificacionesCatalog, newCert]);
      const updated = [...selectedCertificaciones, newCert];
      setSelectedCertificaciones(updated);
      form.setValue("certificaciones", updated);
      setShowAddCertificacionDialog(false);
      setNuevaCertificacionNombre("");
      toast({
        title: "Certificación agregada",
        description: `"${newCert}" se agregó correctamente.`,
      });
    }
  };

  const toggleCertificacion = (nombre: string) => {
    const updated = selectedCertificaciones.includes(nombre)
      ? selectedCertificaciones.filter((c) => c !== nombre)
      : [...selectedCertificaciones, nombre];
    setSelectedCertificaciones(updated);
    form.setValue("certificaciones", updated);
  };

  const [showAddTiempoDialog, setShowAddTiempoDialog] = useState(false);
  const [nuevoTiempoNombre, setNuevoTiempoNombre] = useState("");
  const [tiemposCatalog, setTiemposCatalog] = useState<string[]>([
    "1 hora", "2 horas", "3 horas", "4 horas", "Medio día", "Día completo", "Libre"
  ]);

  const handleAddTiempo = () => {
    if (nuevoTiempoNombre.trim() && !tiemposCatalog.includes(nuevoTiempoNombre.trim())) {
      const newTiempo = nuevoTiempoNombre.trim();
      setTiemposCatalog([...tiemposCatalog, newTiempo]);
      form.setValue("tiempoCargaDescarga", newTiempo);
      setShowAddTiempoDialog(false);
      setNuevoTiempoNombre("");
      toast({
        title: "Tiempo agregado",
        description: `"${newTiempo}" se agregó correctamente.`,
      });
    }
  };

  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingFormData, setPendingFormData] = useState<FormData | null>(null);
  const [routeErrors, setRouteErrors] = useState<Record<string, Record<string, boolean>>>({});

  const [routes, setRoutes] = useState<RouteOption[]>([emptyRoute("1")]);
  const [equiposSel, setEquiposSel] = useState<string[]>([]);
  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());

  const toggleEquipo = (nombre: string) => {
    setEquiposSel((prev) => {
      const updated = prev.includes(nombre) ? prev.filter((e) => e !== nombre) : [...prev, nombre];
      form.setValue("tipoEquipo", updated.join(", "), { shouldValidate: true });
      return updated;
    });
  };

  const toggleRouteExpand = (id: string) => {
    setExpandedRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const updateRouteField = <K extends keyof RouteOption>(id: string, field: K, value: RouteOption[K]) => {
    setRoutes((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const addStop = (routeId: string) => {
    setRoutes((prev) => prev.map((r) => r.id !== routeId ? r : {
      ...r,
      stops: [...r.stops, { id: `stop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ubicacion: "", cp: "", tipo: "parada" as StopTipo, notas: "" }],
    }));
  };

  const removeStop = (routeId: string, stopId: string) => {
    setRoutes((prev) => prev.map((r) => r.id !== routeId ? r : {
      ...r,
      stops: r.stops.filter((s) => s.id !== stopId),
    }));
  };

  const updateStop = (routeId: string, stopId: string, field: keyof RouteStop, value: string) => {
    setRoutes((prev) => prev.map((r) => r.id !== routeId ? r : {
      ...r,
      stops: r.stops.map((s) => s.id === stopId ? { ...s, [field]: value } : s),
    }));
  };

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      cliente: "",
      prospecto: "",
      salesRep: "",
      division: "",
      tipoEquipo: "",
      peso: "",
      unidadMedida: "TON",
      producto: "",
      certificaciones: [],
      tiempoCargaDescarga: "",
      accesorios: [],
      esRFQ: false,
      linkGoogleSheet: "",
      notasCargaComercial: "",
      ltlAlto: "",
      ltlAncho: "",
      ltlLargo: "",
      ltlPeso: "",
      ltlImagenes: "",
    },
  });

  useEffect(() => {
    if (isSalesRole && user?.name) {
      form.setValue("salesRep", user.name);
    }
  }, [isSalesRole, user?.name, form]);

  const addRoute = () => {
    const newRoute = emptyRoute(newRouteId());
    setRoutes((prev) => [...prev, newRoute]);
  };

  const removeRoute = (id: string) => {
    setRoutes((prev) => prev.length > 1 ? prev.filter((row) => row.id !== id) : prev);
  };

  const updateRoute = (id: string, field: keyof RouteOption, value: string) => {
    setRoutes((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const updateRouteWithPlace = (id: string, field: "origen" | "destino", value: string, details?: PlaceDetails) => {
    setRoutes((prev) => prev.map((row) => {
      if (row.id !== id) return row;
      const update: Partial<RouteOption> = { [field]: value };
      if (details?.postalCode) {
        const cpField = field === "origen" ? "cpOrigen" : "cpDestino";
        update[cpField] = details.postalCode;
      }
      return { ...row, ...update };
    }));
  };

  const fieldLabels: Record<string, string> = {
    cliente: "Cliente o Prospecto",
    prospecto: "Cliente o Prospecto",
    salesRep: "Representante de Ventas",
    division: "División",
    tipoEquipo: "Tipo de Equipo",
    peso: "Peso",
    unidadMedida: "Unidad de Medida",
    producto: "Producto",
    certificaciones: "Certificaciones",
    accesorios: "Accesorios",
    ciudadCruce: "Ciudad de Cruce",
  };

  const handleFormError = (errors: Record<string, unknown>) => {
    const missingFields = Object.keys(errors)
      .map((key) => fieldLabels[key] || key)
      .filter((v, i, a) => a.indexOf(v) === i);

    toast({
      title: "Información incompleta",
      description: `Faltan los siguientes campos: ${missingFields.join(", ")}`,
      variant: "destructive",
    });
  };

  const handleFormSubmit = (data: FormData) => {
    const errors: Record<string, Record<string, boolean>> = {};
    let hasErrors = false;
    
    if (!data.esRFQ) {
      routes.forEach((r) => {
        const rowErrors: Record<string, boolean> = {};
        if (!r.origen.trim()) { rowErrors.origen = true; hasErrors = true; }
        if (!r.destino.trim()) { rowErrors.destino = true; hasErrors = true; }
        if (!r.volumen.trim()) { rowErrors.volumen = true; hasErrors = true; }
        if (!r.frecuencia.trim()) { rowErrors.frecuencia = true; hasErrors = true; }
        if (!r.targetCliente.trim()) { rowErrors.targetCliente = true; hasErrors = true; }
        if (!r.cpOrigen.trim()) { rowErrors.cpOrigen = true; hasErrors = true; }
        if (!r.cpDestino.trim()) { rowErrors.cpDestino = true; hasErrors = true; }
        if (Object.keys(rowErrors).length > 0) {
          errors[r.id] = rowErrors;
        }
      });
    }
    
    setRouteErrors(errors);
    
    if (hasErrors) {
      toast({
        title: "Campos incompletos",
        description: "Por favor llena todos los campos obligatorios de las rutas",
        variant: "destructive",
      });
      return;
    }
    setPendingFormData(data);
    setShowConfirmDialog(true);
  };

  const confirmSubmit = async () => {
    if (pendingFormData && !submitInFlightRef.current) {
      submitInFlightRef.current = true;
      setIsConfirmSubmitting(true);
      // Con varios equipos, cada ruta se separa en una fila por equipo:
      // cada fila lleva su propio id, equipo, ofertas, costo y venta.
      const equipos = equiposSel.length > 0
        ? equiposSel
        : [pendingFormData.tipoEquipo].filter(Boolean);
      const routesWithNA = routes.flatMap((r) =>
        (equipos.length > 0 ? equipos : [undefined]).map((equipo, i) => ({
          ...r,
          id: equipos.length > 1 ? `${r.id}-eq${i + 1}` : r.id,
          tipoEquipo: equipo,
          cpOrigen: r.cpOrigen.trim() || "N/A",
          cpDestino: r.cpDestino.trim() || "N/A",
        })),
      );
      try {
        await onSubmit?.(pendingFormData, routesWithNA);
        setShowConfirmDialog(false);
        setPendingFormData(null);
      } catch {
        // The parent owns the user-facing error message.
      } finally {
        submitInFlightRef.current = false;
        setIsConfirmSubmitting(false);
      }
    }
  };

  const { data: previousRequests = [], isLoading: loadingPrevious } = useQuery<PricingRequest[]>({
    queryKey: ["/api/pricing-requests"],
  });

  const [copyOpen, setCopyOpen] = useState(false);
  const [copySearch, setCopySearch] = useState("");
  const [copiedFromId, setCopiedFromId] = useState<string | null>(null);

  const applyPreviousRequest = (req: PricingRequest) => {
    form.setValue("cliente", req.prospecto ? "" : (req.cliente || ""));
    form.setValue("prospecto", req.prospecto || "");
    if (!isSalesRole) {
      form.setValue("salesRep", req.salesRep || "");
    }
    form.setValue("division", req.division || "");
    form.setValue("tipoEquipo", req.tipoEquipo || "");
    setEquiposSel((req.tipoEquipo || "").split(", ").map((e) => e.trim()).filter(Boolean));
    form.setValue("peso", req.peso || "");
    form.setValue("unidadMedida", req.unidadMedida || "TON");
    form.setValue("producto", req.producto || "");
    form.setValue("tiempoCargaDescarga", req.tiempoCargaDescarga || "");
    form.setValue("esRFQ", !!req.esRFQ);
    form.setValue("linkGoogleSheet", req.linkDocumento || "");
    form.setValue("notasCargaComercial", req.notasCargaComercial || "");
    form.setValue("ltlAlto", req.ltlAlto || "");
    form.setValue("ltlAncho", req.ltlAncho || "");
    form.setValue("ltlLargo", req.ltlLargo || "");
    form.setValue("ltlPeso", req.ltlPeso || "");
    form.setValue("ltlImagenes", req.ltlImagenes || "");

    const certs = (req.certificacion || "").split(",").map((c) => c.trim()).filter(Boolean);
    setSelectedCertificaciones(certs);
    form.setValue("certificaciones", certs);
    setCertificacionesCatalog((prev) => Array.from(new Set([...prev, ...certs])));

    const accs = Array.isArray(req.accesorios) ? req.accesorios.filter(Boolean) : [];
    setSelectedAccesorios(accs);
    form.setValue("accesorios", accs);

    if (req.tiempoCargaDescarga) {
      setTiemposCatalog((prev) => prev.includes(req.tiempoCargaDescarga!) ? prev : [...prev, req.tiempoCargaDescarga!]);
    }

    try {
      const parsed = JSON.parse(req.rutas || "[]");
      // Las cotizaciones multi-equipo guardan una fila por equipo (id con sufijo
      // -eqN). Al copiar, colapsamos a la ruta original para no duplicar filas
      // cuando el envío vuelva a expandir por equipo.
      const lanesUnicas: Partial<RouteOption>[] = [];
      const lanesVistas = new Set<string>();
      if (Array.isArray(parsed)) {
        parsed.forEach((r: Partial<RouteOption>, idx: number) => {
          const baseId = String(r.id ?? idx).replace(/-eq\d+$/, "");
          if (!lanesVistas.has(baseId)) {
            lanesVistas.add(baseId);
            lanesUnicas.push(r);
          }
        });
      }
      if (lanesUnicas.length > 0) {
        const newRoutes: RouteOption[] = lanesUnicas.map((r: Partial<RouteOption>, idx: number) => ({
          id: `${newRouteId()}-${idx}`,
          origen: r.origen || "",
          cpOrigen: r.cpOrigen && r.cpOrigen !== "N/A" ? r.cpOrigen : "",
          destino: r.destino || "",
          cpDestino: r.cpDestino && r.cpDestino !== "N/A" ? r.cpDestino : "",
          volumen: r.volumen || "",
          frecuencia: r.frecuencia || "",
          targetCliente: r.targetCliente || "",
          requiereCruce: !!r.requiereCruce,
          ciudadCruce: r.ciudadCruce || "",
          stops: Array.isArray(r.stops)
            ? r.stops.map((s, sIdx) => ({
                id: `stop-${Date.now()}-${idx}-${sIdx}`,
                ubicacion: s.ubicacion || "",
                cp: s.cp || "",
                tipo: s.tipo || "parada",
                notas: s.notas || "",
              }))
            : [],
        }));
        setRoutes(newRoutes);
      } else {
        setRoutes([emptyRoute(Date.now().toString())]);
      }
    } catch {
      setRoutes([emptyRoute(Date.now().toString())]);
    }
    setRouteErrors({});
    setCopiedFromId(req.id);
    setCopyOpen(false);
    setCopySearch("");
    toast({
      title: "Datos copiados",
      description: `Se cargaron los datos de la cotización de ${req.cliente}. Revisa y ajusta antes de enviar.`,
    });
  };

  const clearCopiedData = () => {
    form.reset();
    if (isSalesRole && user?.name) {
      form.setValue("salesRep", user.name);
    }
    setSelectedAccesorios([]);
    setSelectedCertificaciones([]);
    setEquiposSel([]);
    setRoutes([emptyRoute(Date.now().toString())]);
    setRouteErrors({});
    setCopiedFromId(null);
    toast({ title: "Formulario reiniciado", description: "Se limpiaron los datos copiados." });
  };

  const watchEsRFQ = form.watch("esRFQ");
  const watchDivision = form.watch("division");
  const watchCliente = form.watch("cliente");
  const watchProspecto = form.watch("prospecto");
  const hasCliente = !!(watchCliente && watchCliente.length > 0);
  const hasProspecto = !!(watchProspecto && watchProspecto.length > 0);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleFormSubmit, handleFormError)} className="space-y-8">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="h-6 w-1 bg-primary rounded-full" />
              Copiar de cotización previa
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Opcional: carga los datos de una cotización anterior para crear una nueva con las mismas características. La cotización original no se modifica.
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Popover open={copyOpen} onOpenChange={setCopyOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={copyOpen}
                  className="w-full md:w-[420px] justify-between font-normal text-muted-foreground"
                  data-testid="combobox-copiar-cotizacion"
                >
                  {loadingPrevious
                    ? "Cargando cotizaciones..."
                    : copiedFromId
                      ? (() => {
                          const req = previousRequests.find((r) => r.id === copiedFromId);
                          return req ? `Copiado de: ${req.cliente} — ${req.producto || "sin producto"}` : "Buscar cotización previa...";
                        })()
                      : "Buscar cotización previa..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[420px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Buscar por cliente o producto..."
                    value={copySearch}
                    onValueChange={setCopySearch}
                    data-testid="input-copiar-search"
                  />
                  <CommandList>
                    <CommandEmpty>No se encontraron cotizaciones</CommandEmpty>
                    <CommandGroup>
                      {previousRequests
                        .filter((r) => {
                          const q = copySearch.toLowerCase();
                          if (!q) return true;
                          return (
                            (r.cliente || "").toLowerCase().includes(q) ||
                            (r.prospecto || "").toLowerCase().includes(q) ||
                            (r.producto || "").toLowerCase().includes(q) ||
                            (r.salesRep || "").toLowerCase().includes(q)
                          );
                        })
                        .slice(0, 50)
                        .map((r) => (
                          <CommandItem
                            key={r.id}
                            value={r.id}
                            onSelect={() => applyPreviousRequest(r)}
                            data-testid={`option-copiar-${r.id}`}
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">{r.cliente}{r.producto ? ` — ${r.producto}` : ""}</span>
                              <span className="text-xs text-muted-foreground">
                                {r.salesRep}
                                {r.createdAt ? ` · ${new Date(r.createdAt).toLocaleDateString("es-MX")}` : ""}
                                {r.tipoEquipo ? ` · ${r.tipoEquipo}` : ""}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {copiedFromId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearCopiedData}
                data-testid="button-limpiar-copiado"
              >
                <X className="h-4 w-4 mr-1" />
                Limpiar formulario
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="h-6 w-1 bg-primary rounded-full" />
              Información Comercial
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="cliente"
              render={({ field }) => {
                const filteredClientes = clientes.filter((c) =>
                  c.nombre.toLowerCase().includes(clienteSearch.toLowerCase())
                );

                return (
                  <FormItem className="flex flex-col">
                    <FormLabel>Cliente {!hasProspecto && "*"}</FormLabel>
                    <div className="flex gap-1">
                      <Popover open={clienteOpen} onOpenChange={(open) => { if (!hasProspecto) setClienteOpen(open); }}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={clienteOpen}
                              disabled={hasProspecto}
                              className={cn(
                                "w-full justify-between font-normal",
                                !field.value && "text-muted-foreground",
                                hasProspecto && "opacity-50 cursor-not-allowed"
                              )}
                              data-testid="combobox-cliente"
                            >
                              {hasProspecto ? "Bloqueado (Prospecto seleccionado)" : field.value || "Buscar cliente..."}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-[300px] p-0" align="start">
                          <Command shouldFilter={false}>
                            <CommandInput
                              placeholder="Buscar cliente..."
                              value={clienteSearch}
                              onValueChange={setClienteSearch}
                              data-testid="input-cliente-search"
                            />
                            <CommandList>
                              <CommandEmpty>No se encontraron clientes</CommandEmpty>
                              <CommandGroup>
                                {filteredClientes.map((c) => (
                                  <CommandItem
                                    key={c.id}
                                    value={c.nombre}
                                    onSelect={() => {
                                      field.onChange(c.nombre);
                                      form.setValue("prospecto", "");
                                      setClienteSearch("");
                                      setClienteOpen(false);
                                    }}
                                    data-testid={`option-cliente-${c.id}`}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        field.value === c.nombre ? "opacity-100" : "opacity-0"
                                      )}
                                    />
                                    {c.nombre}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      {field.value && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 shrink-0"
                          onClick={() => { field.onChange(""); }}
                          data-testid="button-clear-cliente"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
            <FormField
              control={form.control}
              name="prospecto"
              render={({ field }) => {
                const filteredProspectos = prospectos.filter((p) =>
                  p.nombre.toLowerCase().includes(prospectoSearch.toLowerCase())
                );
                const exactMatch = prospectos.some(
                  (p) => p.nombre.toLowerCase() === prospectoSearch.toLowerCase()
                );

                return (
                  <FormItem className="flex flex-col">
                    <FormLabel>Prospecto {!hasCliente && "*"}</FormLabel>
                    <div className="flex gap-1">
                      <Popover open={prospectoOpen} onOpenChange={(open) => { if (!hasCliente) setProspectoOpen(open); }}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={prospectoOpen}
                              disabled={hasCliente}
                              className={cn(
                                "w-full justify-between font-normal",
                                !field.value && "text-muted-foreground",
                                hasCliente && "opacity-50 cursor-not-allowed"
                              )}
                              data-testid="combobox-prospecto"
                            >
                              {hasCliente ? "Bloqueado (Cliente seleccionado)" : field.value || "Buscar o escribir prospecto..."}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-[300px] p-0" align="start">
                          <Command shouldFilter={false}>
                            <CommandInput
                              placeholder="Buscar prospecto..."
                              value={prospectoSearch}
                              onValueChange={setProspectoSearch}
                              data-testid="input-prospecto-search"
                            />
                            <CommandList>
                              <CommandEmpty>
                                {prospectoSearch.trim() && !exactMatch && (
                                  <Button
                                    variant="ghost"
                                    className="w-full justify-start"
                                    onClick={() => {
                                      const newName = prospectoSearch.trim();
                                      createProspectoMutation.mutate(newName);
                                      field.onChange(newName);
                                      form.setValue("cliente", "");
                                      setProspectoSearch("");
                                      setProspectoOpen(false);
                                      toast({
                                        title: "Prospecto guardado",
                                        description: `"${newName}" se agregó a la lista`,
                                      });
                                    }}
                                    data-testid="button-add-prospecto"
                                  >
                                    <Plus className="mr-2 h-4 w-4" />
                                    Agregar "{prospectoSearch.trim()}"
                                  </Button>
                                )}
                              </CommandEmpty>
                              <CommandGroup>
                                {filteredProspectos.map((p) => (
                                  <CommandItem
                                    key={p.id}
                                    value={p.nombre}
                                    onSelect={() => {
                                      field.onChange(p.nombre);
                                      form.setValue("cliente", "");
                                      setProspectoSearch("");
                                      setProspectoOpen(false);
                                    }}
                                    data-testid={`option-prospecto-${p.id}`}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        field.value === p.nombre ? "opacity-100" : "opacity-0"
                                      )}
                                    />
                                    {p.nombre}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      {field.value && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 shrink-0"
                          onClick={() => { field.onChange(""); }}
                          data-testid="button-clear-prospecto"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
            <FormField
              control={form.control}
              name="salesRep"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sales Rep *</FormLabel>
                  {isSalesRole ? (
                    <FormControl>
                      <Input 
                        value={user?.name || ""} 
                        disabled 
                        className="bg-muted cursor-not-allowed"
                        data-testid="input-sales-rep-locked"
                      />
                    </FormControl>
                  ) : (
                    <Select onValueChange={field.onChange} value={field.value} disabled={loadingSalesUsers}>
                      <FormControl>
                        <SelectTrigger data-testid="select-sales-rep">
                          {loadingSalesUsers ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <SelectValue placeholder="Seleccionar representante" />
                          )}
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {salesUsers.map((u) => (
                          <SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="division"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>División *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={loadingDivisiones}>
                    <FormControl>
                      <SelectTrigger data-testid="select-division">
                        {loadingDivisiones ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <SelectValue placeholder="Seleccionar división" />
                        )}
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {divisiones.map((d) => (
                        <SelectItem key={d.id} value={d.nombre}>{d.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="h-6 w-1 bg-purple-500 rounded-full" />
              Requerimiento
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="tipoEquipo"
                render={() => (
                  <FormItem>
                    <FormLabel>Tipo de Equipo *</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            className="w-full justify-between font-normal"
                            disabled={loadingTiposEquipo}
                            data-testid="select-tipo-equipo"
                          >
                            {loadingTiposEquipo ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : equiposSel.length > 0 ? (
                              <span className="truncate">
                                {equiposSel.length === 1
                                  ? equiposSel[0]
                                  : `${equiposSel.length} equipos: ${equiposSel.join(", ")}`}
                              </span>
                            ) : (
                              "Seleccionar equipo(s)"
                            )}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-[300px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Buscar equipo..." />
                          <CommandList>
                            <CommandEmpty>No se encontró equipo</CommandEmpty>
                            <CommandGroup>
                              <CommandItem
                                onSelect={() => setShowAddEquipoDialog(true)}
                                className="text-primary font-medium"
                              >
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Agregar nuevo equipo
                              </CommandItem>
                            </CommandGroup>
                            <Separator />
                            <CommandGroup>
                              {tiposEquipo.map((e) => (
                                <CommandItem key={e.id} onSelect={() => toggleEquipo(e.nombre)}>
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      equiposSel.includes(e.nombre) ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  {e.nombre}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {equiposSel.length > 1 && (
                      <p className="text-xs text-muted-foreground">
                        Cada ruta se cotizará por separado para cada equipo seleccionado.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-2">
                <FormField
                  control={form.control}
                  name="peso"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Peso *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="0" type="number" data-testid="input-peso" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="unidadMedida"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unidad *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-unidad">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="TON">TON</SelectItem>
                          <SelectItem value="KG">KG</SelectItem>
                          <SelectItem value="LB">LB</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="producto"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Producto *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Descripción del producto" data-testid="input-producto" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="certificaciones"
                render={() => (
                  <FormItem>
                    <FormLabel>Certificaciones</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            className="w-full justify-between font-normal"
                            data-testid="select-certificaciones"
                          >
                            {selectedCertificaciones.length > 0
                              ? `${selectedCertificaciones.length} seleccionada${selectedCertificaciones.length > 1 ? "s" : ""}`
                              : "Seleccionar certificaciones"}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-[300px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Buscar certificación..." />
                          <CommandList>
                            <CommandEmpty>No se encontró certificación</CommandEmpty>
                            <CommandGroup>
                              <CommandItem
                                onSelect={() => setShowAddCertificacionDialog(true)}
                                className="text-primary font-medium"
                              >
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Agregar nueva certificación
                              </CommandItem>
                            </CommandGroup>
                            <Separator />
                            <CommandGroup>
                              {certificacionesCatalog.map((cert) => (
                                <CommandItem
                                  key={cert}
                                  onSelect={() => toggleCertificacion(cert)}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      selectedCertificaciones.includes(cert) ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  {cert}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {selectedCertificaciones.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {selectedCertificaciones.map((cert) => (
                          <Badge
                            key={cert}
                            variant="secondary"
                            className="text-xs cursor-pointer"
                            onClick={() => toggleCertificacion(cert)}
                          >
                            {cert}
                            <X className="ml-1 h-3 w-3" />
                          </Badge>
                        ))}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tiempoCargaDescarga"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tiempo Carga/Descarga</FormLabel>
                    <Select 
                      onValueChange={(val) => {
                        if (val === "__add_new__") {
                          setShowAddTiempoDialog(true);
                        } else {
                          field.onChange(val);
                        }
                      }} 
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-tiempo">
                          <SelectValue placeholder="Seleccionar tiempo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__add_new__" className="text-primary font-medium">
                          <span className="flex items-center gap-2">
                            <PlusCircle className="h-4 w-4" />
                            Agregar nuevo tiempo
                          </span>
                        </SelectItem>
                        <Separator className="my-1" />
                        {tiemposCatalog.map((tiempo) => (
                          <SelectItem key={tiempo} value={tiempo}>{tiempo}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="accesorios"
                render={() => (
                  <FormItem>
                    <FormLabel>Accesorios *</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            className="w-full justify-between font-normal"
                            data-testid="select-accesorios"
                          >
                            {selectedAccesorios.length > 0
                              ? `${selectedAccesorios.length} seleccionado${selectedAccesorios.length > 1 ? "s" : ""}`
                              : "Seleccionar accesorios"}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-[300px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Buscar accesorio..." />
                          <CommandList>
                            <CommandEmpty>No se encontró accesorio</CommandEmpty>
                            <CommandGroup>
                              <CommandItem
                                onSelect={() => setShowAddAccesorioDialog(true)}
                                className="text-primary font-medium"
                              >
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Agregar nuevo accesorio
                              </CommandItem>
                            </CommandGroup>
                            <Separator />
                            <CommandGroup>
                              {accesoriosCatalog.map((a) => (
                                <CommandItem
                                  key={a.id}
                                  onSelect={() => toggleAccesorio(a.nombre)}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      selectedAccesorios.includes(a.nombre) ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  {a.nombre}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {selectedAccesorios.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {selectedAccesorios.map((acc) => (
                          <Badge
                            key={acc}
                            variant="secondary"
                            className="text-xs cursor-pointer"
                            onClick={() => toggleAccesorio(acc)}
                          >
                            {acc}
                            <X className="ml-1 h-3 w-3" />
                          </Badge>
                        ))}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {watchDivision === "LTL" && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-muted-foreground">Dimensiones LTL (Less Than Truckload)</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <FormField
                      control={form.control}
                      name="ltlLargo"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Largo (cm)</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="0" type="number" data-testid="input-ltl-largo" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="ltlAncho"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Ancho (cm)</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="0" type="number" data-testid="input-ltl-ancho" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="ltlAlto"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Alto (cm)</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="0" type="number" data-testid="input-ltl-alto" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="ltlPeso"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Peso (kg)</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="0" type="number" data-testid="input-ltl-peso" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="ltlImagenes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Links de Imagenes</FormLabel>
                        <FormControl>
                          <Textarea 
                            {...field} 
                            placeholder="Ingresa los links de las imagenes separados por coma o salto de linea" 
                            className="resize-none"
                            rows={3}
                            data-testid="input-ltl-imagenes" 
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </>
            )}

            <Separator />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <FormField
                control={form.control}
                name="esRFQ"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-es-rfq"
                      />
                    </FormControl>
                    <FormLabel className="!mt-0">Es RFQ</FormLabel>
                  </FormItem>
                )}
              />
              {watchEsRFQ && (
                <FormField
                  control={form.control}
                  name="linkGoogleSheet"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1">
                        <Link2 className="h-3 w-3" />
                        Link Referencia
                      </FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="URL del documento" type="url" data-testid="input-link" />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="h-6 w-1 bg-blue-500 rounded-full" />
                Rutas (Origen / Destino)
              </CardTitle>
              <Button type="button" size="sm" variant="outline" onClick={addRoute} data-testid="button-add-route">
                <Plus className="h-4 w-4 mr-1" />
                Agregar Ruta
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={cn("min-w-[180px]", Object.values(routeErrors).some(e => e.origen) && "text-destructive")}>Origen <span className="text-destructive">*</span></TableHead>
                    <TableHead className={cn("min-w-[120px]", Object.values(routeErrors).some(e => e.cpOrigen) && "text-destructive")}>CP Origen <span className="text-destructive">*</span></TableHead>
                    <TableHead className={cn("min-w-[180px]", Object.values(routeErrors).some(e => e.destino) && "text-destructive")}>Destino <span className="text-destructive">*</span></TableHead>
                    <TableHead className={cn("min-w-[120px]", Object.values(routeErrors).some(e => e.cpDestino) && "text-destructive")}>CP Destino <span className="text-destructive">*</span></TableHead>
                    <TableHead className={cn("min-w-[80px]", Object.values(routeErrors).some(e => e.volumen) && "text-destructive")}>Volumen <span className="text-destructive">*</span></TableHead>
                    <TableHead className={cn("min-w-[110px]", Object.values(routeErrors).some(e => e.frecuencia) && "text-destructive")}>Frecuencia <span className="text-destructive">*</span></TableHead>
                    <TableHead className={cn("min-w-[110px]", Object.values(routeErrors).some(e => e.targetCliente) && "text-destructive")}>Target Cliente <span className="text-destructive">*</span></TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {routes.map((row, index) => (
                    <Fragment key={row.id}>
                    <TableRow>
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <PlacesAutocomplete
                            value={row.origen}
                            onChange={(value, details) => updateRouteWithPlace(row.id, "origen", value, details)}
                            placeholder="Ciudad, Estado"
                            className={cn("h-9", routeErrors[row.id]?.origen && "border-destructive")}
                            data-testid={`input-origen-${index}`}
                          />
                          {routeErrors[row.id]?.origen && (
                            <p className="text-xs text-destructive">Ingresa el origen</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="space-y-1.5">
                          <Input
                            value={row.cpOrigen === "N/A" ? "" : row.cpOrigen}
                            onChange={(e) => updateRoute(row.id, "cpOrigen", e.target.value.replace(/[^0-9]/g, ""))}
                            placeholder="Código Postal"
                            className={cn("h-9 font-mono w-full", routeErrors[row.id]?.cpOrigen && "border-destructive")}
                            disabled={row.cpOrigen === "N/A"}
                            data-testid={`input-cp-origen-${index}`}
                          />
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={row.cpOrigen === "N/A"}
                              onChange={(e) => updateRoute(row.id, "cpOrigen", e.target.checked ? "N/A" : "")}
                              className="h-4 w-4 rounded border-border"
                              data-testid={`checkbox-na-cp-origen-${index}`}
                            />
                            <span className="text-xs text-muted-foreground">No aplica</span>
                          </label>
                          {routeErrors[row.id]?.cpOrigen && (
                            <p className="text-xs text-destructive">Ingresa CP o marca N/A</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <PlacesAutocomplete
                            value={row.destino}
                            onChange={(value, details) => updateRouteWithPlace(row.id, "destino", value, details)}
                            placeholder="Ciudad, Estado"
                            className={cn("h-9", routeErrors[row.id]?.destino && "border-destructive")}
                            data-testid={`input-destino-${index}`}
                          />
                          {routeErrors[row.id]?.destino && (
                            <p className="text-xs text-destructive">Ingresa el destino</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="space-y-1.5">
                          <Input
                            value={row.cpDestino === "N/A" ? "" : row.cpDestino}
                            onChange={(e) => updateRoute(row.id, "cpDestino", e.target.value.replace(/[^0-9]/g, ""))}
                            placeholder="Código Postal"
                            className={cn("h-9 font-mono w-full", routeErrors[row.id]?.cpDestino && "border-destructive")}
                            disabled={row.cpDestino === "N/A"}
                            data-testid={`input-cp-destino-${index}`}
                          />
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={row.cpDestino === "N/A"}
                              onChange={(e) => updateRoute(row.id, "cpDestino", e.target.checked ? "N/A" : "")}
                              className="h-4 w-4 rounded border-border"
                              data-testid={`checkbox-na-cp-destino-${index}`}
                            />
                            <span className="text-xs text-muted-foreground">No aplica</span>
                          </label>
                          {routeErrors[row.id]?.cpDestino && (
                            <p className="text-xs text-destructive">Ingresa CP o marca N/A</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <Input
                            value={row.volumen}
                            onChange={(e) => updateRoute(row.id, "volumen", e.target.value)}
                            placeholder="Ej: 10"
                            className={cn("h-9", routeErrors[row.id]?.volumen && "border-destructive")}
                            data-testid={`input-volumen-${index}`}
                          />
                          {routeErrors[row.id]?.volumen && (
                            <p className="text-xs text-destructive">Ingresa volumen</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <Select
                            value={row.frecuencia}
                            onValueChange={(value) => updateRoute(row.id, "frecuencia", value)}
                          >
                            <SelectTrigger className={cn("h-9", routeErrors[row.id]?.frecuencia && "border-destructive")} data-testid={`select-frecuencia-${index}`}>
                              <SelectValue placeholder="Seleccionar" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="diaria">Diaria</SelectItem>
                              <SelectItem value="semanal">Semanal</SelectItem>
                              <SelectItem value="mensual">Mensual</SelectItem>
                            </SelectContent>
                          </Select>
                          {routeErrors[row.id]?.frecuencia && (
                            <p className="text-xs text-destructive">Selecciona frecuencia</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="space-y-1">
                          <Input
                            value={row.targetCliente}
                            onChange={(e) => updateRoute(row.id, "targetCliente", e.target.value)}
                            placeholder="$0"
                            className={cn("h-9 font-mono", routeErrors[row.id]?.targetCliente && "border-destructive")}
                            data-testid={`input-target-${index}`}
                          />
                          {routeErrors[row.id]?.targetCliente && (
                            <p className="text-xs text-destructive">Ingresa target</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => toggleRouteExpand(row.id)}
                            title={expandedRoutes.has(row.id) ? "Ocultar detalles" : "Cruce y stops"}
                            data-testid={`button-toggle-route-detail-${index}`}
                          >
                            {expandedRoutes.has(row.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => removeRoute(row.id)}
                            disabled={routes.length === 1}
                            data-testid={`button-remove-route-${index}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedRoutes.has(row.id) && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={8} className="p-4">
                          <div className="space-y-4">
                            <div className="flex flex-wrap items-center gap-4">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <Switch
                                  checked={row.requiereCruce}
                                  onCheckedChange={(checked) => updateRouteField(row.id, "requiereCruce", checked)}
                                  data-testid={`switch-route-cruce-${index}`}
                                />
                                <span className="text-sm font-medium flex items-center gap-1">
                                  <Globe2 className="h-4 w-4" />
                                  Requiere Cruce
                                </span>
                              </label>
                              {row.requiereCruce && (
                                <div className="flex-1 min-w-[260px] space-y-1">
                                  <Select
                                    value={row.ciudadCruce || ""}
                                    onValueChange={(value) => updateRouteField(row.id, "ciudadCruce", value)}
                                  >
                                    <SelectTrigger className={cn("h-9", routeErrors[row.id]?.ciudadCruce && "border-destructive")} data-testid={`select-route-ciudad-cruce-${index}`}>
                                      <SelectValue placeholder="Seleccionar ciudad de cruce" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {CIUDADES_CRUCE.map((ciudad) => (
                                        <SelectItem key={ciudad} value={ciudad}>{ciudad}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {routeErrors[row.id]?.ciudadCruce && (
                                    <p className="text-xs text-destructive">Selecciona ciudad de cruce</p>
                                  )}
                                </div>
                              )}
                            </div>

                            <Separator />

                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-medium flex items-center gap-1">
                                  <MapPin className="h-4 w-4" />
                                  Stops intermedios {row.stops.length > 0 && <span className="text-muted-foreground">({row.stops.length})</span>}
                                </p>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => addStop(row.id)}
                                  data-testid={`button-add-stop-${index}`}
                                >
                                  <Plus className="h-3.5 w-3.5 mr-1" /> Agregar stop
                                </Button>
                              </div>

                              {routeErrors[row.id]?.stops && (
                                <p className="text-xs text-destructive">Completa la ubicación de todos los stops</p>
                              )}
                              {row.stops.length === 0 ? (
                                <p className="text-xs text-muted-foreground">Sin stops. Agrega uno si la ruta tiene paradas, recolecciones o entregas extra.</p>
                              ) : (
                                <div className="space-y-2">
                                  {row.stops.map((stop, sIdx) => (
                                    <div key={stop.id} className="grid grid-cols-12 gap-2 items-start p-2 rounded-md border bg-background">
                                      <div className="col-span-12 md:col-span-4">
                                        <PlacesAutocomplete
                                          value={stop.ubicacion}
                                          onChange={(value, details) => {
                                            updateStop(row.id, stop.id, "ubicacion", value);
                                            if (details?.postalCode && !stop.cp) {
                                              updateStop(row.id, stop.id, "cp", details.postalCode);
                                            }
                                          }}
                                          placeholder="Ubicación del stop"
                                          className="h-9"
                                          data-testid={`input-stop-ubicacion-${index}-${sIdx}`}
                                        />
                                      </div>
                                      <div className="col-span-6 md:col-span-2">
                                        <Input
                                          value={stop.cp}
                                          onChange={(e) => updateStop(row.id, stop.id, "cp", e.target.value.replace(/[^0-9]/g, ""))}
                                          placeholder="CP"
                                          className="h-9 font-mono"
                                          data-testid={`input-stop-cp-${index}-${sIdx}`}
                                        />
                                      </div>
                                      <div className="col-span-6 md:col-span-2">
                                        <Select
                                          value={stop.tipo}
                                          onValueChange={(value) => updateStop(row.id, stop.id, "tipo", value)}
                                        >
                                          <SelectTrigger className="h-9" data-testid={`select-stop-tipo-${index}-${sIdx}`}>
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {TIPOS_STOP.map((t) => (
                                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div className="col-span-10 md:col-span-3">
                                        <Input
                                          value={stop.notas || ""}
                                          onChange={(e) => updateStop(row.id, stop.id, "notas", e.target.value)}
                                          placeholder="Notas (opcional)"
                                          className="h-9"
                                          data-testid={`input-stop-notas-${index}-${sIdx}`}
                                        />
                                      </div>
                                      <div className="col-span-2 md:col-span-1 flex justify-end">
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant="ghost"
                                          onClick={() => removeStop(row.id, stop.id)}
                                          data-testid={`button-remove-stop-${index}-${sIdx}`}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="h-6 w-1 bg-amber-500 rounded-full" />
              Notas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="notasCargaComercial"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas de Carga Comercial</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Notas comerciales" rows={3} data-testid="textarea-notas-comercial" />
                  </FormControl>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onCancel} data-testid="button-cancel">
            Cancelar
          </Button>
          <Button 
            type="submit" 
            onClick={() => {
              const errors: Record<string, Record<string, boolean>> = {};
              if (!watchEsRFQ) {
                routes.forEach((r) => {
                  const rowErrors: Record<string, boolean> = {};
                  if (!r.origen.trim()) rowErrors.origen = true;
                  if (!r.destino.trim()) rowErrors.destino = true;
                  if (!r.volumen.trim()) rowErrors.volumen = true;
                  if (!r.frecuencia.trim()) rowErrors.frecuencia = true;
                  if (!r.targetCliente.trim()) rowErrors.targetCliente = true;
                  if (!r.cpOrigen.trim()) rowErrors.cpOrigen = true;
                  if (!r.cpDestino.trim()) rowErrors.cpDestino = true;
                  if (r.requiereCruce && !(r.ciudadCruce || "").trim()) rowErrors.ciudadCruce = true;
                  if (r.stops.some((s) => !s.ubicacion.trim())) rowErrors.stops = true;
                  if (Object.keys(rowErrors).length > 0) {
                    errors[r.id] = rowErrors;
                    if (rowErrors.ciudadCruce || rowErrors.stops) {
                      setExpandedRoutes((prev) => new Set(prev).add(r.id));
                    }
                  }
                });
              }
              setRouteErrors(errors);
            }}
            data-testid="button-submit"
          >
            Crear Cotización
          </Button>
        </div>
      </form>

      <Dialog open={showAddEquipoDialog} onOpenChange={setShowAddEquipoDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar Tipo de Equipo</DialogTitle>
            <DialogDescription>
              Ingresa el nombre del nuevo tipo de equipo. Estará disponible para futuras cotizaciones.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Nombre del equipo (ej. Caja Seca 53')"
              value={nuevoEquipoNombre}
              onChange={(e) => setNuevoEquipoNombre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddEquipo();
                }
              }}
              data-testid="input-nuevo-equipo"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowAddEquipoDialog(false);
                setNuevoEquipoNombre("");
              }}
              data-testid="button-cancel-equipo"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleAddEquipo}
              disabled={!nuevoEquipoNombre.trim() || createEquipoMutation.isPending}
              data-testid="button-save-equipo"
            >
              {createEquipoMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Agregar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddAccesorioDialog} onOpenChange={setShowAddAccesorioDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar Accesorio</DialogTitle>
            <DialogDescription>
              Ingresa el nombre del nuevo accesorio. Estará disponible para futuras cotizaciones.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Nombre del accesorio (ej. Lonas, Tarimas)"
              value={nuevoAccesorioNombre}
              onChange={(e) => setNuevoAccesorioNombre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddAccesorio();
                }
              }}
              data-testid="input-nuevo-accesorio"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowAddAccesorioDialog(false);
                setNuevoAccesorioNombre("");
              }}
              data-testid="button-cancel-accesorio"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleAddAccesorio}
              disabled={!nuevoAccesorioNombre.trim() || createAccesorioMutation.isPending}
              data-testid="button-save-accesorio"
            >
              {createAccesorioMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Agregar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddCertificacionDialog} onOpenChange={setShowAddCertificacionDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar Certificación</DialogTitle>
            <DialogDescription>
              Ingresa el nombre de la nueva certificación. Estará disponible para futuras cotizaciones.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Nombre de la certificación (ej. ISO 22000)"
              value={nuevaCertificacionNombre}
              onChange={(e) => setNuevaCertificacionNombre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCertificacion();
                }
              }}
              data-testid="input-nueva-certificacion"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowAddCertificacionDialog(false);
                setNuevaCertificacionNombre("");
              }}
              data-testid="button-cancel-certificacion"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleAddCertificacion}
              disabled={!nuevaCertificacionNombre.trim()}
              data-testid="button-save-certificacion"
            >
              <Plus className="h-4 w-4 mr-2" />
              Agregar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddTiempoDialog} onOpenChange={setShowAddTiempoDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar Tiempo de Carga/Descarga</DialogTitle>
            <DialogDescription>
              Ingresa el nuevo tiempo. Estará disponible para futuras cotizaciones.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Ej: 5 horas, 2 días"
              value={nuevoTiempoNombre}
              onChange={(e) => setNuevoTiempoNombre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTiempo();
                }
              }}
              data-testid="input-nuevo-tiempo"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowAddTiempoDialog(false);
                setNuevoTiempoNombre("");
              }}
              data-testid="button-cancel-tiempo"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleAddTiempo}
              disabled={!nuevoTiempoNombre.trim()}
              data-testid="button-save-tiempo"
            >
              <Plus className="h-4 w-4 mr-2" />
              Agregar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showConfirmDialog}
        onOpenChange={(open) => {
          if (!open && (isConfirmSubmitting || submitInFlightRef.current)) return;
          setShowConfirmDialog(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar Envío</DialogTitle>
            <DialogDescription>
              ¿Estás seguro que deseas enviar esta cotización? Una vez enviada, será procesada por el equipo de pricing.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md border p-3 text-sm" data-testid="confirm-rfq-type">
            Tipo de cotización: <strong>{pendingFormData?.esRFQ ? "RFQ" : "No RFQ"}</strong>.
            {" "}Esta clasificación se guardará para el tablero y las estadísticas.
          </p>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowConfirmDialog(false);
                setPendingFormData(null);
              }}
              disabled={isConfirmSubmitting}
              data-testid="button-cancel-confirm"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={confirmSubmit}
              disabled={isConfirmSubmitting}
              data-testid="button-confirm-submit"
            >
              {isConfirmSubmitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              {isConfirmSubmitting ? "Enviando..." : "Sí, Enviar Cotización"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Form>
  );
}
