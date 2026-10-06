import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle, XCircle, AlertCircle, Send, FileCheck, MailCheck, MessageSquare, Trophy, ThumbsDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type PricingStatus = 
  | "pendiente" 
  | "por_revisar" 
  | "cotizando" 
  | "enviado"
  | "cotizacion_enviada"
  | "feedback"
  | "ganada"
  | "perdida"
  | "rechazada";

export type CommercialStatus = 
  | "solicitud_activa" 
  | "cerrada" 
  | "archivada";

interface StatusBadgeProps {
  status: PricingStatus | CommercialStatus;
  size?: "sm" | "default";
}

const pricingStatusConfig: Record<PricingStatus, { label: string; icon: typeof Clock; className: string }> = {
  pendiente: {
    label: "Pendiente",
    icon: Clock,
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  },
  por_revisar: {
    label: "Por Revisar",
    icon: AlertCircle,
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  },
  cotizando: {
    label: "Cotizando",
    icon: Send,
    className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  },
  enviado: {
    label: "Enviado",
    icon: FileCheck,
    className: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
  },
  cotizacion_enviada: {
    label: "Cotización Enviada",
    icon: MailCheck,
    className: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  },
  feedback: {
    label: "Feedback",
    icon: MessageSquare,
    className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  },
  ganada: {
    label: "Ganada",
    icon: Trophy,
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  perdida: {
    label: "Perdida",
    icon: ThumbsDown,
    className: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400",
  },
  rechazada: {
    label: "Rechazada",
    icon: XCircle,
    className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  },
};

const commercialStatusConfig: Record<CommercialStatus, { label: string; className: string }> = {
  solicitud_activa: {
    label: "Activa",
    className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  },
  cerrada: {
    label: "Cerrada",
    className: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400",
  },
  archivada: {
    label: "Archivada",
    className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  },
};

export function StatusBadge({ status, size = "default" }: StatusBadgeProps) {
  const isPricingStatus = status in pricingStatusConfig;
  const isCommercialStatus = status in commercialStatusConfig;
  
  if (isPricingStatus) {
    const config = pricingStatusConfig[status as PricingStatus];
    const Icon = config.icon;
    return (
      <Badge 
        variant="secondary" 
        className={cn(
          "gap-1 font-medium border-0 whitespace-nowrap",
          size === "sm" && "text-xs px-2 py-0.5",
          config.className
        )}
      >
        <Icon className={cn("h-3 w-3", size === "sm" && "h-2.5 w-2.5")} />
        {config.label}
      </Badge>
    );
  }

  if (isCommercialStatus) {
    const config = commercialStatusConfig[status as CommercialStatus];
    return (
      <Badge 
        variant="secondary" 
        className={cn(
          "font-medium border-0 whitespace-nowrap",
          size === "sm" && "text-xs px-2 py-0.5",
          config.className
        )}
      >
        {config.label}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="font-medium border-0 whitespace-nowrap">
      {status}
    </Badge>
  );
}

export { pricingStatusConfig };
