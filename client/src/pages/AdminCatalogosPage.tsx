import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Settings, Loader2, Building2, UserCheck, MapPin, Truck, Package, RefreshCw } from "lucide-react";

interface CatalogItem {
  id: string;
  nombre: string;
  [key: string]: string | boolean | null | undefined;
}

interface CatalogConfig {
  key: string;
  title: string;
  description: string;
  endpoint: string;
  icon: React.ElementType;
  fields: { key: string; label: string; placeholder: string; optional?: boolean }[];
  readOnly?: boolean;
}

const catalogConfigs: CatalogConfig[] = [
  {
    key: "clientes",
    title: "Clientes",
    description: "Sincronizado desde Google Sheets (solo lectura)",
    endpoint: "/api/clientes",
    icon: Building2,
    fields: [
      { key: "nombre", label: "Nombre", placeholder: "Cemex México" },
    ],
    readOnly: true,
  },
  {
    key: "prospectos",
    title: "Prospectos",
    description: "Clientes potenciales en proceso de negociación",
    endpoint: "/api/prospectos",
    icon: UserCheck,
    fields: [
      { key: "nombre", label: "Nombre", placeholder: "Juan Pérez" },
      { key: "empresa", label: "Empresa", placeholder: "Empresa SA de CV", optional: true },
    ],
  },
  {
    key: "divisiones",
    title: "Divisiones",
    description: "Divisiones geográficas o de negocio",
    endpoint: "/api/divisiones",
    icon: MapPin,
    fields: [{ key: "nombre", label: "Nombre", placeholder: "Norte" }],
  },
  {
    key: "tiposEquipo",
    title: "Tipos de Equipo",
    description: "Tipos de unidades de transporte",
    endpoint: "/api/tipos-equipo",
    icon: Truck,
    fields: [
      { key: "nombre", label: "Nombre", placeholder: "Full 53'" },
      { key: "descripcion", label: "Descripción", placeholder: "Caja seca de 53 pies", optional: true },
    ],
  },
  {
    key: "accesorios",
    title: "Accesorios",
    description: "Accesorios y equipamiento adicional",
    endpoint: "/api/accesorios",
    icon: Package,
    fields: [
      { key: "nombre", label: "Nombre", placeholder: "Tarimas" },
      { key: "descripcion", label: "Descripción", placeholder: "Tarimas de madera estándar", optional: true },
    ],
  },
];

function CatalogTable({ config }: { config: CatalogConfig }) {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});

  const { data: items = [], isLoading } = useQuery<CatalogItem[]>({
    queryKey: [config.endpoint],
  });

  const syncFromSheetMutation = useMutation({
    mutationFn: async () => {
      const sheetClientes = await fetch("/api/google-sheets/clientes").then(res => {
        if (!res.ok) throw new Error("Error al obtener datos de Google Sheets");
        return res.json();
      });
      
      let created = 0;
      let skipped = 0;
      
      for (const cliente of sheetClientes) {
        if (!cliente.nombre) continue;
        
        const exists = items.some(
          (item) => item.nombre.toLowerCase() === cliente.nombre.toLowerCase()
        );
        
        if (!exists) {
          await apiRequest("POST", "/api/clientes", {
            nombre: cliente.nombre,
            rfc: cliente.rfc || null,
          });
          created++;
        } else {
          skipped++;
        }
      }
      
      return { created, skipped, total: sheetClientes.length };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clientes"] });
      toast({
        title: "Sincronización completada",
        description: `${result.created} clientes agregados, ${result.skipped} ya existían (${result.total} en total del Sheet)`,
      });
    },
    onError: (error) => {
      toast({
        title: "Error de sincronización",
        description: error instanceof Error ? error.message : "No se pudo sincronizar con Google Sheets",
        variant: "destructive",
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      apiRequest("POST", config.endpoint, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [config.endpoint] });
      toast({ title: "Elemento creado", description: `${config.title} agregado correctamente` });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo crear el elemento", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, string> }) =>
      apiRequest("PATCH", `${config.endpoint}/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [config.endpoint] });
      toast({ title: "Elemento actualizado", description: "Cambios guardados correctamente" });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo actualizar el elemento", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `${config.endpoint}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [config.endpoint] });
      toast({ title: "Elemento eliminado", description: "El elemento ha sido eliminado" });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo eliminar el elemento", variant: "destructive" });
    },
  });

  const openCreateDialog = () => {
    setEditingItem(null);
    const initialData: Record<string, string> = {};
    config.fields.forEach((f) => (initialData[f.key] = ""));
    setFormData(initialData);
    setIsDialogOpen(true);
  };

  const openEditDialog = (item: CatalogItem) => {
    setEditingItem(item);
    const data: Record<string, string> = {};
    config.fields.forEach((f) => (data[f.key] = (item[f.key] as string) || ""));
    setFormData(data);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingItem(null);
    setFormData({});
  };

  const handleSubmit = () => {
    if (!formData.nombre?.trim()) {
      toast({ title: "Error", description: "El nombre es requerido", variant: "destructive" });
      return;
    }
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const Icon = config.icon;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">{config.title}</CardTitle>
              <CardDescription>{config.description}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {config.key === "clientes" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => syncFromSheetMutation.mutate()}
                disabled={syncFromSheetMutation.isPending}
                data-testid="button-sync-clientes"
              >
                {syncFromSheetMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                Sync Google Sheets
              </Button>
            )}
            {!config.readOnly && (
              <Button size="sm" onClick={openCreateDialog} data-testid={`button-add-${config.key}`}>
                <Plus className="h-4 w-4 mr-1" />
                Agregar
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No hay elementos. Agrega el primero.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {config.fields.map((field) => (
                  <TableHead key={field.key}>{field.label}</TableHead>
                ))}
                {!config.readOnly && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} data-testid={`row-${config.key}-${item.id}`}>
                  {config.fields.map((field) => (
                    <TableCell key={field.key} className={field.key === "nombre" ? "font-medium" : "text-muted-foreground"}>
                      {(item[field.key] as string) || "-"}
                    </TableCell>
                  ))}
                  {!config.readOnly && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEditDialog(item)}
                          data-testid={`button-edit-${config.key}-${item.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => deleteMutation.mutate(item.id)}
                          data-testid={`button-delete-${config.key}-${item.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? `Editar ${config.title}` : `Nuevo ${config.title}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {config.fields.map((field) => (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={field.key}>
                  {field.label}
                  {field.optional && <span className="text-muted-foreground ml-1">(opcional)</span>}
                </Label>
                <Input
                  id={field.key}
                  value={formData[field.key] || ""}
                  onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  data-testid={`input-${config.key}-${field.key}`}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={isPending} data-testid={`button-submit-${config.key}`}>
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingItem ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function AdminCatalogosPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Settings className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-admin-catalogos-title">Gestión de Catálogos</h1>
          <p className="text-muted-foreground text-sm">Administra las listas de opciones para las cotizaciones</p>
        </div>
      </div>

      <Tabs defaultValue="clientes" className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          {catalogConfigs.map((config) => (
            <TabsTrigger key={config.key} value={config.key} className="gap-1">
              <config.icon className="h-4 w-4" />
              {config.title}
            </TabsTrigger>
          ))}
        </TabsList>

        {catalogConfigs.map((config) => (
          <TabsContent key={config.key} value={config.key}>
            <CatalogTable config={config} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
