import { useState, useRef, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, Filter, Download, MoreHorizontal, ArrowUpDown, X, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PricingFileEntry {
  id: string;
  idRequest: string;
  cliente: string;
  division: string;
  salesRep: string;
  origen: string;
  destino: string;
  equipo: string;
  costo: number;
  tarifaAprobada: number;
  margen: number;
  carrier: string;
  carrierRep: string;
  fechaVigencia: string;
  fechaAprobacion: string;
  aprobadoPor: string;
}

interface PricingFileTableProps {
  entries: PricingFileEntry[];
  onViewDetail?: (id: string, tab?: string) => void;
}

export function PricingFileTable({ entries = [], onViewDetail }: PricingFileTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [clienteFilter, setClienteFilter] = useState<string>("all");
  const [carrierFilter, setCarrierFilter] = useState<string>("all");
  const [divisionFilter, setDivisionFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<keyof PricingFileEntry | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Prevent browser back/forward navigation on horizontal scroll (Mac trackpad gesture)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const { scrollLeft, scrollWidth, clientWidth } = container;
        const maxScroll = scrollWidth - clientWidth;
        if ((e.deltaX < 0 && scrollLeft > 0) || 
            (e.deltaX > 0 && scrollLeft < maxScroll)) {
        } else if (maxScroll > 0) {
          e.preventDefault();
        }
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value);

  const uniqueClientes = Array.from(new Set((entries || []).map((e) => e.cliente)));
  const uniqueCarriers = Array.from(new Set((entries || []).map((e) => e.carrier)));
  const uniqueDivisiones = Array.from(new Set((entries || []).map((e) => e.division)));

  const exportToCSV = () => {
    const headers = [
      "ID Request",
      "Cliente",
      "División",
      "Sales Rep",
      "Origen",
      "Destino",
      "Equipo",
      "Carrier",
      "Carrier Rep",
      "Costo",
      "Tarifa Aprobada",
      "Margen %",
      "Fecha Aprobación",
      "Aprobado Por",
      "Fecha Vigencia"
    ];
    
    const rows = sortedEntries.map(entry => [
      entry.idRequest,
      entry.cliente,
      entry.division,
      entry.salesRep,
      entry.origen,
      entry.destino,
      entry.equipo,
      entry.carrier,
      entry.carrierRep,
      entry.costo,
      entry.tarifaAprobada,
      entry.margen,
      entry.fechaAprobacion,
      entry.aprobadoPor,
      entry.fechaVigencia
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `pricing_file_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredEntries = entries.filter((entry) => {
    const matchesSearch =
      searchTerm === "" ||
      entry.cliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.origen.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.destino.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.idRequest.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.division.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCliente = clienteFilter === "all" || entry.cliente === clienteFilter;
    const matchesCarrier = carrierFilter === "all" || entry.carrier === carrierFilter;
    const matchesDivision = divisionFilter === "all" || entry.division === divisionFilter;

    return matchesSearch && matchesCliente && matchesCarrier && matchesDivision;
  });

  const sortedEntries = [...filteredEntries].sort((a, b) => {
    if (!sortField) return 0;
    const aVal = a[sortField];
    const bVal = b[sortField];
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    }
    return sortDirection === "asc"
      ? String(aVal).localeCompare(String(bVal))
      : String(bVal).localeCompare(String(aVal));
  });

  const handleSort = (field: keyof PricingFileEntry) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const clearFilters = () => {
    setSearchTerm("");
    setClienteFilter("all");
    setCarrierFilter("all");
    setDivisionFilter("all");
  };

  const hasFilters = searchTerm !== "" || clienteFilter !== "all" || carrierFilter !== "all" || divisionFilter !== "all";

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-lg">Pricing File</CardTitle>
          <Button variant="outline" size="sm" onClick={exportToCSV} data-testid="button-export">
            <Download className="h-4 w-4 mr-2" />
            Exportar CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por cliente, ruta, ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
              data-testid="input-search-pricing-file"
            />
          </div>
          <Select value={clienteFilter} onValueChange={setClienteFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-filter-cliente">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Cliente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los clientes</SelectItem>
              {uniqueClientes.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={carrierFilter} onValueChange={setCarrierFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-filter-carrier">
              <SelectValue placeholder="Carrier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los carriers</SelectItem>
              {uniqueCarriers.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={divisionFilter} onValueChange={setDivisionFilter}>
            <SelectTrigger className="w-[150px]" data-testid="select-filter-division">
              <SelectValue placeholder="División" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las divisiones</SelectItem>
              {uniqueDivisiones.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
              <X className="h-4 w-4 mr-1" />
              Limpiar
            </Button>
          )}
        </div>

        <div ref={scrollContainerRef} className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">ID</TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 -ml-3 font-medium"
                    onClick={() => handleSort("cliente")}
                  >
                    Cliente
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 -ml-3 font-medium"
                    onClick={() => handleSort("division")}
                  >
                    División
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead>Sales Rep</TableHead>
                <TableHead>Origen</TableHead>
                <TableHead>Destino</TableHead>
                <TableHead>Equipo</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 -mr-3 font-medium"
                    onClick={() => handleSort("costo")}
                  >
                    Costo
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 -mr-3 font-medium"
                    onClick={() => handleSort("tarifaAprobada")}
                  >
                    Tarifa
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 -mr-3 font-medium"
                    onClick={() => handleSort("margen")}
                  >
                    Margen
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead>Aprobado</TableHead>
                <TableHead>Vigencia</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} className="text-center py-8 text-muted-foreground">
                    No se encontraron registros
                  </TableCell>
                </TableRow>
              ) : (
                sortedEntries.map((entry) => (
                  <TableRow 
                    key={entry.id} 
                    className="hover-elevate cursor-pointer" 
                    data-testid={`row-pricing-file-${entry.id}`}
                    onClick={() => onViewDetail?.(entry.id)}
                  >
                    <TableCell className="font-mono text-xs">{entry.idRequest}</TableCell>
                    <TableCell className="font-medium">{entry.cliente}</TableCell>
                    <TableCell className="text-sm">{entry.division}</TableCell>
                    <TableCell className="text-sm">{entry.salesRep}</TableCell>
                    <TableCell className="text-sm">{entry.origen}</TableCell>
                    <TableCell className="text-sm">{entry.destino}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{entry.equipo}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{entry.carrier}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatCurrency(entry.costo)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-medium">
                      {formatCurrency(entry.tarifaAprobada)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="secondary"
                        className={cn(
                          "font-mono",
                          entry.margen >= 15
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : entry.margen >= 10
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        )}
                      >
                        {entry.margen.toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex flex-col">
                        <span>{entry.fechaAprobacion}</span>
                        <span className="text-xs text-muted-foreground">{entry.aprobadoPor}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{entry.fechaVigencia}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" data-testid={`button-menu-${entry.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onViewDetail?.(entry.id)}>
                            <Eye className="h-4 w-4 mr-2" />
                            Ver Detalle
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">
            Mostrando {sortedEntries.length} de {entries.length} registros
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
