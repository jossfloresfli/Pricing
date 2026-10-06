import { PricingFileTable, type PricingFileEntry } from "../PricingFileTable";

// todo: remove mock functionality
const mockEntries: PricingFileEntry[] = [
  {
    id: "1",
    idRequest: "PR-2025-004",
    cliente: "Volkswagen MX",
    origen: "Silao, GTO",
    destino: "Laredo, TX",
    equipo: "Porta Autos",
    costo: 75000,
    tarifaAprobada: 85000,
    margen: 13.3,
    carrier: "AutoTrans MX",
    fechaVigencia: "31 Dic 2025",
    fechaAprobacion: "19 Dic 2025",
    aprobadoPor: "María García",
  },
  {
    id: "2",
    idRequest: "PR-2025-010",
    cliente: "Cemex México",
    origen: "Monterrey, NL",
    destino: "CDMX",
    equipo: "Full 53'",
    costo: 45000,
    tarifaAprobada: 54000,
    margen: 20.0,
    carrier: "Transportes del Norte",
    fechaVigencia: "15 Ene 2025",
    fechaAprobacion: "05 Dic 2025",
    aprobadoPor: "María García",
  },
  {
    id: "3",
    idRequest: "PR-2025-008",
    cliente: "FEMSA Logística",
    origen: "Guadalajara, JAL",
    destino: "Querétaro, QRO",
    equipo: "Caja Seca 48'",
    costo: 28000,
    tarifaAprobada: 31500,
    margen: 12.5,
    carrier: "TDR Express",
    fechaVigencia: "20 Dic 2025",
    fechaAprobacion: "04 Dic 2025",
    aprobadoPor: "Juan Pérez",
  },
  {
    id: "4",
    idRequest: "PR-2025-012",
    cliente: "Bimbo Distribución",
    origen: "Toluca, MEX",
    destino: "Puebla, PUE",
    equipo: "Refrigerado",
    costo: 35000,
    tarifaAprobada: 42000,
    margen: 20.0,
    carrier: "FríoTransport",
    fechaVigencia: "10 Ene 2025",
    fechaAprobacion: "03 Dic 2025",
    aprobadoPor: "María García",
  },
];

export default function PricingFileTableExample() {
  return (
    <PricingFileTable
      entries={mockEntries}
      onViewDetail={(id) => console.log("View detail:", id)}
      onExport={() => console.log("Export")}
    />
  );
}
