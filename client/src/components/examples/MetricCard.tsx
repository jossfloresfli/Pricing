import { MetricCard } from "../MetricCard";
import { Clock, Send, CheckCircle, RotateCcw } from "lucide-react";

export default function MetricCardExample() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <MetricCard
        title="Pendientes"
        value={12}
        icon={Clock}
        iconClassName="bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
      />
      <MetricCard
        title="En Pricing"
        value={8}
        icon={Send}
        iconClassName="bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400"
        trend={{ value: 15, isPositive: true }}
      />
      <MetricCard
        title="Aprobadas"
        value={45}
        icon={CheckCircle}
        iconClassName="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
        trend={{ value: 8, isPositive: true }}
      />
      <MetricCard
        title="Devueltas"
        value={3}
        icon={RotateCcw}
        iconClassName="bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
        trend={{ value: 2, isPositive: false }}
      />
    </div>
  );
}
