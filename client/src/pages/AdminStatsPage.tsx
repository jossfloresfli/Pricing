import { useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import QuoteTimingView, { type QuoteTiming } from "@/components/admin/QuoteTimingView";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Users, TrendingUp, TrendingDown, Activity, BarChart3, X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface HistorialEntry {
  fecha: string;
  accion: string;
  usuario: string;
}

interface ClienteBreakdown {
  nombre: string;
  tipo: "cliente" | "prospecto";
  quotesCreated: number;
  quotesWon: number;
  quotesLost: number;
}

interface UserStats {
  userId: string;
  userName: string;
  role: string;
  email: string;
  quotesCreated: number;
  quotesWon: number;
  quotesLost: number;
  quotesQuoted: number;
  statusChanges: number;
  actions: HistorialEntry[];
  clientes: ClienteBreakdown[];
}

interface RoleStats {
  users: number;
  quotesCreated: number;
  quotesWon: number;
  quotesLost: number;
  statusChanges: number;
}

interface AdminStats {
  overall: {
    totalRequests: number;
    totalUsers: number;
    totalWon: number;
    totalLost: number;
    totalPending: number;
    totalQuoting: number;
    totalSent: number;
    totalFeedback: number;
  };
  byUser: UserStats[];
  byRole: Record<string, RoleStats>;
  timing: QuoteTiming;
}

const roleLabels: Record<string, string> = {
  superadmin: "Super Admin",
  pricing: "Pricing",
  sales_manager: "Sales Manager",
  sales_lead: "Sales Lead",
  sales_rep: "Sales Rep",
  carrier_manager: "Carrier Manager",
  carrier_lead: "Carrier Lead",
  carrier_rep: "Carrier Rep",
};

const roleColors: Record<string, string> = {
  superadmin: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  pricing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  sales_manager: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  sales_lead: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  sales_rep: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  carrier_manager: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  carrier_lead: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  carrier_rep: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
};

export default function AdminStatsPage() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [quoteType, setQuoteType] = useState("all");
  const [activeView, setActiveView] = useState<"activity" | "timing">("activity");
  const invalidRange = Boolean(fromDate && toDate && fromDate > toDate);

  const { data: stats, isPending, isFetching, error, refetch } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats", fromDate, toDate, quoteType],
    enabled: !invalidRange,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("quoteType", quoteType);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const qs = params.toString();
      const res = await fetch(`/api/admin/stats${qs ? `?${qs}` : ""}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const views = ["activity", "timing"] as const;
    const index = views.indexOf(activeView);
    const next = event.key === "ArrowRight" ? (index + 1) % 2
      : event.key === "ArrowLeft" ? (index + 1) % 2
      : event.key === "Home" ? 0
      : event.key === "End" ? 1
      : -1;
    if (next === -1) return;
    event.preventDefault();
    setActiveView(views[next]);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[next]?.focus();
  }

  const filterControls = (
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filtrar por fecha de creación">
      <div className="space-y-1">
        <Label htmlFor="stats-from" className="text-xs text-muted-foreground">Desde</Label>
        <Input
          id="stats-from"
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          aria-invalid={invalidRange}
          aria-describedby={invalidRange ? "stats-date-error" : undefined}
          className="w-40"
          data-testid="input-stats-from"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="stats-to" className="text-xs text-muted-foreground">Hasta</Label>
        <Input
          id="stats-to"
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          aria-invalid={invalidRange}
          aria-describedby={invalidRange ? "stats-date-error" : undefined}
          className="w-40"
          data-testid="input-stats-to"
        />
      </div>
      {(fromDate || toDate) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setFromDate(""); setToDate(""); }}
          data-testid="button-clear-dates"
        >
          <X className="h-4 w-4 mr-1" />
          Limpiar
        </Button>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-6 border-b border-border/70 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Panel de administración</p>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-admin-stats-title">
            Estadísticas de Uso
          </h1>
          <p className="text-muted-foreground mt-1">
            Actividad y tiempos de cotización
            {(fromDate || toDate) && (
              <span className="ml-2 text-primary" data-testid="text-date-filter-active">
                · Filtrado por fecha de creación
              </span>
            )}
          </p>
        </div>
        {filterControls}
      </div>

      <div className="flex gap-1 border-b border-border" role="tablist" aria-label="Vistas de estadísticas">
        <button type="button" role="tab" id="stats-tab-activity" aria-controls="stats-panel-activity" aria-selected={activeView === "activity"} tabIndex={activeView === "activity" ? 0 : -1} onClick={() => setActiveView("activity")} onKeyDown={onTabKeyDown}
          className={`relative -mb-px min-h-11 px-4 pb-3 pt-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${activeView === "activity" ? "border-b-2 border-primary text-foreground" : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"}`}>
          Actividad
        </button>
        <button type="button" role="tab" id="stats-tab-timing" aria-controls="stats-panel-timing" aria-selected={activeView === "timing"} tabIndex={activeView === "timing" ? 0 : -1} onClick={() => setActiveView("timing")} onKeyDown={onTabKeyDown}
          className={`relative -mb-px min-h-11 px-4 pb-3 pt-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${activeView === "timing" ? "border-b-2 border-primary text-foreground" : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"}`}>
          Tiempos de cotización
        </button>
      </div>

      {activeView === "timing" && (
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="timing-quote-type">Tipo de cotización</Label>
          <select id="timing-quote-type" value={quoteType} onChange={e => setQuoteType(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="all">Todas</option>
            <option value="rfq">RFQ</option>
            <option value="non-rfq">No RFQ</option>
          </select>
          <span className="text-xs text-muted-foreground">Aplica a los cuatro KPI · Sin sábados ni domingos</span>
        </div>
      )}
      {invalidRange ? (
        <div id="stats-date-error" role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          La fecha “Desde” no puede ser posterior a “Hasta”. Ajusta el rango para consultar las estadísticas.
        </div>
      ) : isPending || isFetching ? (
        <div role="status" aria-live="polite" className="space-y-5">
          <span className="text-sm font-medium text-muted-foreground">{isPending ? "Cargando estadísticas…" : "Actualizando estadísticas para el rango seleccionado…"}</span>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-44 animate-pulse rounded-xl border border-border bg-muted/60" />)}
          </div>
          <div className="h-52 animate-pulse rounded-xl border border-border bg-muted/40" />
        </div>
      ) : error ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <p className="font-semibold text-destructive">No se pudieron cargar las estadísticas.</p>
          <p className="mt-1 text-sm text-muted-foreground">Comprueba tu conexión e inténtalo de nuevo.</p>
          <Button variant="outline" className="mt-4" onClick={() => void refetch()}>Reintentar</Button>
        </div>
      ) : !stats ? (
        <div className="rounded-lg border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">No hay estadísticas disponibles para este rango.</div>
      ) : activeView === "timing" ? (
        <div id="stats-panel-timing" role="tabpanel" aria-labelledby="stats-tab-timing" tabIndex={0}>
          <QuoteTimingView timing={stats.timing} />
        </div>
      ) : (
      <div id="stats-panel-activity" role="tabpanel" aria-labelledby="stats-tab-activity" tabIndex={0} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Cotizaciones</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{stats.overall.totalRequests}</div>
            <p className="text-xs text-muted-foreground">
              En el sistema
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Ganadas</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-600">{stats.overall.totalWon}</div>
            <p className="text-xs text-muted-foreground">
              {stats.overall.totalRequests > 0 
                ? `${((stats.overall.totalWon / stats.overall.totalRequests) * 100).toFixed(1)}% del total`
                : "0% del total"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Perdidas</CardTitle>
            <TrendingDown className="h-4 w-4 text-gray-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-gray-600">{stats.overall.totalLost}</div>
            <p className="text-xs text-muted-foreground">
              {stats.overall.totalRequests > 0 
                ? `${((stats.overall.totalLost / stats.overall.totalRequests) * 100).toFixed(1)}% del total`
                : "0% del total"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Usuarios Activos</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{stats.overall.totalUsers}</div>
            <p className="text-xs text-muted-foreground">
              Registrados en el sistema
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Estadísticas por Rol
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rol</TableHead>
                  <TableHead className="text-right">Usuarios</TableHead>
                  <TableHead className="text-right">Creadas</TableHead>
                  <TableHead className="text-right">Ganadas</TableHead>
                  <TableHead className="text-right">Cambios</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(stats.byRole).map(([role, roleStats]) => (
                  <TableRow key={role}>
                    <TableCell>
                      <Badge className={roleColors[role] || "bg-gray-100"}>
                        {roleLabels[role] || role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">{roleStats.users}</TableCell>
                    <TableCell className="text-right font-mono">{roleStats.quotesCreated}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-600">{roleStats.quotesWon}</TableCell>
                    <TableCell className="text-right font-mono">{roleStats.statusChanges}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estado de Cotizaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Pendientes</span>
                <span className="font-mono font-medium">{stats.overall.totalPending}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Cotizando</span>
                <span className="font-mono font-medium">{stats.overall.totalQuoting}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Enviadas</span>
                <span className="font-mono font-medium">{stats.overall.totalSent}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">En Feedback</span>
                <span className="font-mono font-medium">{stats.overall.totalFeedback}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-emerald-600">Ganadas</span>
                <span className="font-mono font-medium text-emerald-600">{stats.overall.totalWon}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Perdidas</span>
                <span className="font-mono font-medium text-gray-500">{stats.overall.totalLost}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Desglose por Usuario
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead className="text-right">Creadas</TableHead>
                <TableHead className="text-right">Ganadas</TableHead>
                <TableHead className="text-right">Perdidas</TableHead>
                <TableHead className="text-right">Cambios de Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.byUser.map((user) => (
                <TableRow key={user.userId}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{user.userName}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={roleColors[user.role] || "bg-gray-100"}>
                      {roleLabels[user.role] || user.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{user.quotesCreated}</TableCell>
                  <TableCell className="text-right font-mono text-emerald-600">{user.quotesWon}</TableCell>
                  <TableCell className="text-right font-mono text-gray-500">{user.quotesLost}</TableCell>
                  <TableCell className="text-right font-mono">{user.statusChanges}</TableCell>
                </TableRow>
              ))}
              {stats.byUser.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No hay actividad registrada aún
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Desglose de Clientes por Sales Rep
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Accordion type="single" collapsible className="w-full">
            {stats.byUser.filter(u => u.clientes.length > 0 && ["sales_rep", "sales_lead", "sales_manager"].includes(u.role)).map((user) => {
              const totalClientes = user.clientes.filter(c => c.tipo === "cliente").length;
              const totalProspectos = user.clientes.filter(c => c.tipo === "prospecto").length;
              return (
                <AccordionItem key={user.userId} value={`clientes-${user.userId}`}>
                  <AccordionTrigger data-testid={`accordion-clientes-${user.userId}`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-medium">{user.userName}</span>
                      <Badge className={roleColors[user.role] || "bg-gray-100"}>
                        {roleLabels[user.role] || user.role}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {user.quotesCreated} cotizaciones
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {totalClientes} clientes · {totalProspectos} prospectos
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Cliente / Prospecto</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead className="text-right">Cotizaciones</TableHead>
                          <TableHead className="text-right">Ganadas</TableHead>
                          <TableHead className="text-right">Perdidas</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {user.clientes.map((c, idx) => (
                          <TableRow key={`${c.tipo}-${c.nombre}-${idx}`} data-testid={`row-cliente-${user.userId}-${idx}`}>
                            <TableCell className="font-medium">{c.nombre}</TableCell>
                            <TableCell>
                              <Badge
                                className={c.tipo === "cliente"
                                  ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"}
                              >
                                {c.tipo === "cliente" ? "Cliente" : "Prospecto"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono">{c.quotesCreated}</TableCell>
                            <TableCell className="text-right font-mono text-emerald-600">{c.quotesWon}</TableCell>
                            <TableCell className="text-right font-mono text-gray-500">{c.quotesLost}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
          {stats.byUser.filter(u => u.clientes.length > 0 && ["sales_rep", "sales_lead", "sales_manager"].includes(u.role)).length === 0 && (
            <p className="text-center text-muted-foreground py-8">
              No hay cotizaciones registradas aún
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de Acciones por Usuario</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {stats.byUser.filter(u => u.actions.length > 0).map((user) => (
              <AccordionItem key={user.userId} value={user.userId}>
                <AccordionTrigger>
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{user.userName}</span>
                    <Badge variant="secondary" className="text-xs">
                      {user.actions.length} acciones
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 pl-4">
                    {user.actions.slice(0, 20).map((action, idx) => (
                      <div key={idx} className="flex items-center gap-3 text-sm py-1 border-b border-border/50 last:border-0">
                        <span className="text-muted-foreground font-mono text-xs w-32 flex-shrink-0">
                          {action.fecha}
                        </span>
                        <span>{action.accion}</span>
                      </div>
                    ))}
                    {user.actions.length > 20 && (
                      <p className="text-sm text-muted-foreground pt-2">
                        ... y {user.actions.length - 20} acciones más
                      </p>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          {stats.byUser.filter(u => u.actions.length > 0).length === 0 && (
            <p className="text-center text-muted-foreground py-8">
              No hay historial de acciones registrado
            </p>
          )}
        </CardContent>
      </Card>
      </div>
      )}
    </div>
  );
}
