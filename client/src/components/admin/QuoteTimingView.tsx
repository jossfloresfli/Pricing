import { Clock3, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface TimingSummary {
  total: number;
  valid: number;
  missingDates: number;
  invalidDates: number;
  averageHours: number | null;
  medianHours: number | null;
}

export interface QuoteTiming {
  rfq: TimingSummary;
  nonRfq: TimingSummary;
  general: TimingSummary;
  crossborder: TimingSummary;
  national: TimingSummary;
  portFreight: TimingSummary;
}

const countFormat = new Intl.NumberFormat("es-MX");
const hourFormat = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

function hours(value: number | null) {
  return value === null || !Number.isFinite(value) ? "—" : `${hourFormat.format(value)} h`;
}

function TimingCard({
  title,
  scope,
  summary,
  featured = false,
}: {
  title: string;
  scope: string;
  summary: TimingSummary;
  featured?: boolean;
}) {
  const hasData = summary.valid > 0 && summary.averageHours !== null;
  const coverage = summary.total > 0 ? (summary.valid / summary.total) * 100 : null;

  return (
    <Card className={`overflow-hidden border-border/70 shadow-none ${featured ? "bg-primary/[0.045] border-primary/20" : "bg-card"}`}>
      <CardContent className={`${featured ? "p-5 sm:p-7" : "p-5"} flex h-full flex-col`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className={`${featured ? "text-xl" : "text-lg"} font-semibold tracking-tight`}>{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{scope}</p>
          </div>
          {featured && <Clock3 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
        </div>

        <div className={`mt-6 ${featured ? "sm:mt-10" : ""}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Tiempo promedio por cotización</p>
          <div className={`${featured ? "text-5xl sm:text-6xl" : "text-4xl"} mt-1 font-semibold tracking-tight tabular-nums`} data-testid={`timing-${title.toLowerCase()}-average`}>
            {hasData ? hours(summary.averageHours) : "—"}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Horas por cotización, no horas acumuladas. Excluye sábados y domingos; incluye noches de lunes a viernes.
          </p>
          {!hasData && <p className="mt-2 text-sm text-muted-foreground">
            {summary.total === 0
              ? "Sin cotizaciones de este tipo en el rango seleccionado."
              : "Hay cotizaciones registradas, pero ninguna tiene ambas fechas válidas de creación y envío de Pricing a Ventas."}
          </p>}
        </div>

        <div className="mt-auto pt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-t border-border/70 pt-4 text-sm">
            <span className="text-muted-foreground">Mediana <span className="font-medium text-foreground tabular-nums">{hasData ? hours(summary.medianHours) : "—"}</span></span>
            <span className="font-medium tabular-nums">{countFormat.format(summary.valid)} {summary.valid === 1 ? "cotización válida" : "cotizaciones válidas"}</span>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Cobertura: {coverage === null ? "—" : `${hourFormat.format(coverage)} %`} · {countFormat.format(summary.valid)} de {countFormat.format(summary.total)} cotizaciones
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {countFormat.format(summary.missingDates)} sin fechas · {countFormat.format(summary.invalidDates)} con fechas inválidas
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function QuoteTimingView({ timing }: { timing: QuoteTiming }) {
  return (
    <section aria-labelledby="timing-heading" className="space-y-6">
      <div className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Tiempo de respuesta</p>
        <h2 id="timing-heading" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Tiempos de cotización</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Cuánto tarda una cotización, en promedio, desde su creación hasta el envío de Pricing a Ventas. No es la suma de los tiempos de todas las cotizaciones.
        </p>
      </div>

      <section aria-labelledby="rfq-comparison-heading" className="space-y-3">
        <h3 id="rfq-comparison-heading" className="text-lg font-semibold">Comparación RFQ / No RFQ</h3>
        <p className="text-sm text-muted-foreground">
          Todas las divisiones dentro del rango de fechas elegido. Estas dos tarjetas siempre muestran ambos tipos, independientemente del filtro de tipo.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <TimingCard title="RFQ" scope="Cotizaciones marcadas como Es RFQ" summary={timing.rfq} />
          <TimingCard title="No RFQ" scope="Cotizaciones sin la marca Es RFQ" summary={timing.nonRfq} />
        </div>
      </section>
      <h3 className="text-lg font-semibold">General y divisiones · Tipo seleccionado en el filtro</h3>
      <div className="grid gap-4 lg:grid-cols-2">
        <TimingCard title="General" scope="Todas las divisiones" summary={timing.general} featured />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <TimingCard title="Crossborder" scope="División Crossborder" summary={timing.crossborder} />
          <TimingCard title="Nacional" scope="Solo división National" summary={timing.national} />
        </div>
        <div className="lg:col-span-2">
          <TimingCard title="Puertos" scope="Solo división Port Freight" summary={timing.portFreight} />
        </div>
      </div>

      <aside className="rounded-lg border border-border/70 bg-muted/40 p-4 sm:p-5" aria-label="Cómo se calculan los tiempos">
        <div className="flex gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <h3 className="font-semibold text-foreground">Cómo leer estos tiempos</h3>
            <p>Promedio: sumamos los tiempos de las cotizaciones válidas y dividimos entre su cantidad. Mediana: el valor central al ordenar esos tiempos de menor a mayor.</p>
            <p>Es una estimación histórica entre la creación de la cotización (<span className="font-mono text-xs">created_at</span>) y su fecha de envío (<span className="font-mono text-xs">fecha_envio</span>). No garantiza el momento real en que entró a “Por revisar”.</p>
            <p>Se cuentan las 24 horas de lunes a viernes, según la hora de Ciudad de México. No se cuentan sábados ni domingos; sí se incluyen noches y días festivos entre semana. “Enviado” significa el paso de Pricing a Ventas. Se excluyen los registros sin fechas o con intervalos negativos.</p>
            <p>El filtro RFQ usa la opción “Es RFQ” de la cotización y aplica al KPI general y a las tres divisiones. La comparación RFQ / No RFQ siempre muestra ambos tipos. Los registros antiguos sin clasificación se agrupan en No RFQ para este cálculo; esto no confirma que comercialmente fueran No RFQ.</p>
            <p>El rango de fechas de arriba filtra por fecha de creación de la cotización, también en esta vista.</p>
          </div>
        </div>
      </aside>
    </section>
  );
}