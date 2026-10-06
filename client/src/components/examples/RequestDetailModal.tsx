import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RequestDetailModal } from "../RequestDetailModal";
import { AuthProvider } from "@/contexts/AuthContext";

// todo: remove mock functionality
const mockRequest = {
  id: "PR-2025-003",
  cliente: "Bimbo Distribución",
  prospecto: "",
  salesRep: "Roberto Sánchez",
  division: "Centro",
  tipoEquipo: "Refrigerado",
  peso: "18 TON",
  producto: "Productos congelados",
  certificacion: "ISO 9001",
  origen: "Toluca, MEX",
  cpOrigen: "50000",
  destino: "Puebla, PUE",
  cpDestino: "72000",
  carrier: "FríoTransport",
  costoEsperado: 35000,
  ventaSugerida: 42000,
  margen: 20.0,
  status: "en_pricing" as const,
  fecha: "20 Dic 2025",
  notasComercial: "Cliente requiere entrega antes de las 10am.",
  carrierOptions: [
    { carrier: "FríoTransport", precio: 35000 },
    { carrier: "RefriLogistics", precio: 37500 },
    { carrier: "ColdChain MX", precio: 38000 },
  ],
  historial: [
    { fecha: "20 Dic 2025 14:30", accion: "Solicitud creada", usuario: "Roberto Sánchez" },
    { fecha: "20 Dic 2025 15:45", accion: "Enviada a revisión", usuario: "Roberto Sánchez" },
    { fecha: "21 Dic 2025 09:00", accion: "Validada por Carrier Lead", usuario: "Ana Martínez" },
    { fecha: "21 Dic 2025 10:30", accion: "Enviada a Pricing", usuario: "Ana Martínez" },
  ],
  comentarios: [
    {
      id: "1",
      usuario: "Ana Martínez",
      fecha: "21 Dic 2025 10:30",
      texto: "Cliente prioritario, favor de procesar con urgencia.",
    },
    {
      id: "2",
      usuario: "María García",
      fecha: "21 Dic 2025 11:15",
      texto: "Revisando histórico de tarifas para esta ruta.",
    },
  ],
};

export default function RequestDetailModalExample() {
  const [open, setOpen] = useState(false);

  return (
    <AuthProvider>
      <div>
        <Button onClick={() => setOpen(true)}>Abrir Detalle</Button>
        <RequestDetailModal
          open={open}
          onOpenChange={setOpen}
          request={mockRequest}
          onApprove={(id) => console.log("Approve:", id)}
          onReject={(id) => console.log("Reject:", id)}
          onEdit={(id) => console.log("Edit:", id)}
          onSendToPricing={(id) => console.log("Send to Pricing:", id)}
        />
      </div>
    </AuthProvider>
  );
}
