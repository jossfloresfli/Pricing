import { PricingCard } from "../PricingCard";

// todo: remove mock functionality
const mockRequestSingleRoute = {
  id: "PR-2025-001",
  cliente: "Cemex México",
  rutas: [{ origen: "Monterrey, NL", destino: "CDMX" }],
  tipoEquipo: "Full 53'",
  carrier: "Transportes del Norte",
  costoEsperado: 45000,
  ventaSugerida: 52500,
  margen: 16.7,
  status: "en_pricing" as const,
  fecha: "10 Dic 2025",
  salesRep: "Carlos López",
};

const mockRequestMultipleRoutes = {
  id: "PR-2025-002",
  cliente: "Bimbo Distribución",
  rutas: [
    { origen: "Toluca, MEX", destino: "Puebla, PUE" },
    { origen: "CDMX", destino: "Querétaro, QRO" },
    { origen: "Guadalajara, JAL", destino: "León, GTO" },
  ],
  tipoEquipo: "Refrigerado",
  status: "pendiente" as const,
  fecha: "09 Dic 2025",
  salesRep: "Ana Martínez",
};

export default function PricingCardExample() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
      <PricingCard 
        request={mockRequestSingleRoute} 
        onViewDetail={(id) => console.log("View detail:", id)} 
      />
      <PricingCard 
        request={mockRequestMultipleRoutes} 
        onViewDetail={(id) => console.log("View detail:", id)} 
      />
    </div>
  );
}
