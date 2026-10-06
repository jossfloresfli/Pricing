import { PricingRequestForm, type RouteOption } from "@/components/PricingRequestForm";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";

export default function NewRequestPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const [overlayState, setOverlayState] = useState<"hidden" | "creating" | "confirmed">("hidden");

  const createRequestMutation = useMutation({
    mutationFn: async (requestData: { 
      cliente: string; 
      prospecto?: string | null;
      division?: string | null; 
      tipoEquipo: string;
      rutas: string;
      salesRep: string;
      status: string;
      accesorios?: string[] | null;
      peso?: string | null;
      unidadMedida?: string | null;
      producto?: string | null;
      tiempoCargaDescarga?: string | null;
      linkDocumento?: string | null;
      certificacion?: string | null;
      notasCargaComercial?: string | null;
      esRFQ?: boolean;
    }) => {
      const response = await apiRequest("POST", "/api/pricing-requests", requestData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const handleSubmit = async (data: Record<string, unknown>, routes: RouteOption[]) => {
    const cliente = (data.cliente as string) || (data.prospecto as string) || "Sin cliente";
    const salesRep = (data.salesRep as string) || user?.name || "Usuario";
    
    const accesoriosValue = data.accesorios;
    let accesoriosArray: string[] | null = null;
    if (Array.isArray(accesoriosValue)) {
      accesoriosArray = accesoriosValue.filter(Boolean) as string[];
    } else if (typeof accesoriosValue === "string" && accesoriosValue) {
      accesoriosArray = [accesoriosValue];
    }

    const requestData = {
      cliente,
      prospecto: (data.prospecto as string) || null,
      division: (data.division as string) || null,
      tipoEquipo: (data.tipoEquipo as string) || "Sin equipo",
      rutas: JSON.stringify(routes),
      salesRep,
      status: "por_revisar" as const,
      esRFQ: data.esRFQ === true,
      accesorios: accesoriosArray,
      peso: (data.peso as string) || null,
      unidadMedida: (data.unidadMedida as string) || null,
      producto: (data.producto as string) || null,
      tiempoCargaDescarga: (data.tiempoCargaDescarga as string) || null,
      linkDocumento: (data.linkGoogleSheet as string) || null,
      certificacion: Array.isArray(data.certificaciones) && data.certificaciones.length > 0 
        ? (data.certificaciones as string[]).join(", ") 
        : null,
      notasCargaComercial: (data.notasCargaComercial as string) || null,
      ltlAlto: (data.ltlAlto as string) || null,
      ltlAncho: (data.ltlAncho as string) || null,
      ltlLargo: (data.ltlLargo as string) || null,
      ltlPeso: (data.ltlPeso as string) || null,
      ltlImagenes: (data.ltlImagenes as string) || null,
    };

    try {
      setOverlayState("creating");
      const created = await createRequestMutation.mutateAsync(requestData);
      setOverlayState("confirmed");
      toast({
        title: "Cotización creada",
        description: created?.id
          ? `Solicitud #${String(created.id).slice(0, 8)} enviada a revisión`
          : "Solicitud enviada a revisión",
      });
      setTimeout(() => {
        setLocation("/board");
      }, 700);
    } catch (error) {
      console.error("Error creating request:", error);
      setOverlayState("hidden");
      toast({
        title: "Error",
        description: "No se pudo crear la cotización. Intente de nuevo.",
        variant: "destructive",
      });
      throw error;
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-new-request-title">Nueva Cotización</h1>
        <p className="text-muted-foreground mt-1">
          Completa el formulario para crear una nueva solicitud de cotización
        </p>
      </div>

      <PricingRequestForm
        onSubmit={handleSubmit}
        onCancel={() => setLocation("/")}
      />

      {overlayState !== "hidden" && (
        <div
          className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center"
          data-testid="overlay-creating-request"
        >
          <div className="bg-card border rounded-xl shadow-2xl p-8 flex flex-col items-center gap-4 min-w-[320px] max-w-md mx-4">
            {overlayState === "creating" ? (
              <>
                <Loader2 className="h-12 w-12 text-primary animate-spin" />
                <div className="text-center space-y-1">
                  <p className="text-lg font-semibold">Creando cotización...</p>
                  <p className="text-sm text-muted-foreground">
                    Estamos guardando tu solicitud. No cierres esta ventana.
                  </p>
                </div>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                <div className="text-center space-y-1">
                  <p className="text-lg font-semibold">¡Cotización creada!</p>
                  <p className="text-sm text-muted-foreground">
                    Redirigiendo al tablero...
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
