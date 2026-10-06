import { KanbanBoard } from "../KanbanBoard";
import type { PricingRequest } from "../PricingCard";

// todo: remove mock functionality
const mockRequests: PricingRequest[] = [
  {
    id: "PR-2025-001",
    cliente: "Cemex México",
    rutas: [{ origen: "Monterrey, NL", destino: "CDMX" }],
    tipoEquipo: "Full 53'",
    carrier: "Transportes del Norte",
    costoEsperado: 45000,
    ventaSugerida: 52500,
    margen: 16.7,
    status: "pendiente",
    fecha: "22 Dic 2025",
    salesRep: "Carlos López",
  },
  {
    id: "PR-2025-002",
    cliente: "FEMSA Logística",
    rutas: [{ origen: "Guadalajara, JAL", destino: "Querétaro, QRO" }],
    tipoEquipo: "Caja Seca 48'",
    carrier: "TDR Express",
    costoEsperado: 28000,
    ventaSugerida: 32500,
    margen: 16.1,
    status: "por_revisar",
    fecha: "21 Dic 2025",
    salesRep: "Ana Martínez",
  },
  {
    id: "PR-2025-003",
    cliente: "Bimbo Distribución",
    rutas: [
      { origen: "Toluca, MEX", destino: "Puebla, PUE" },
      { origen: "CDMX", destino: "Querétaro, QRO" },
      { origen: "Guadalajara, JAL", destino: "León, GTO" },
    ],
    tipoEquipo: "Refrigerado",
    carrier: "FríoTransport",
    costoEsperado: 35000,
    ventaSugerida: 42000,
    margen: 20.0,
    status: "en_pricing",
    fecha: "20 Dic 2025",
    salesRep: "Roberto Sánchez",
  },
  {
    id: "PR-2025-004",
    cliente: "Volkswagen MX",
    rutas: [{ origen: "Silao, GTO", destino: "Laredo, TX" }],
    tipoEquipo: "Porta Autos",
    carrier: "AutoTrans MX",
    costoEsperado: 75000,
    ventaSugerida: 85000,
    margen: 13.3,
    status: "aprobado",
    fecha: "19 Dic 2025",
    salesRep: "Carlos López",
  },
  {
    id: "PR-2025-005",
    cliente: "Herdez",
    rutas: [{ origen: "CDMX", destino: "Cancún, QR" }],
    tipoEquipo: "Full 53'",
    carrier: "Logistics Sur",
    costoEsperado: 62000,
    ventaSugerida: 68000,
    margen: 9.7,
    status: "rechazado",
    fecha: "18 Dic 2025",
    salesRep: "Ana Martínez",
  },
];

export default function KanbanBoardExample() {
  return (
    <div className="min-h-[600px]">
      <KanbanBoard 
        requests={mockRequests} 
        onViewDetail={(id) => console.log("View detail:", id)} 
      />
    </div>
  );
}
