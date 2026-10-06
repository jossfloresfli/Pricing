import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: number | string;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  iconClassName?: string;
  onClick?: () => void;
}

export function MetricCard({ title, value, icon: Icon, trend, iconClassName, onClick }: MetricCardProps) {
  return (
    <Card 
      className={cn("hover-elevate", onClick && "cursor-pointer")} 
      data-testid={`metric-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
      onClick={onClick}
    >
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className={cn(
              "flex h-10 w-10 items-center justify-center rounded-md",
              iconClassName || "bg-primary/10 text-primary"
            )}>
              <Icon className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-muted-foreground mt-2">{title}</span>
            <span className="text-3xl font-bold font-mono">{value}</span>
          </div>
          {trend && (
            <div className={cn(
              "text-sm font-medium",
              trend.isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
            )}>
              {trend.isPositive ? "+" : ""}{trend.value}%
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
