import { StatusBadge } from "../StatusBadge";

export default function StatusBadgeExample() {
  return (
    <div className="flex flex-wrap gap-2">
      <StatusBadge status="pendiente" />
      <StatusBadge status="por_revisar" />
      <StatusBadge status="en_pricing" />
      <StatusBadge status="aprobado" />
      <StatusBadge status="rechazado" />
      <StatusBadge status="entregado" />
    </div>
  );
}
