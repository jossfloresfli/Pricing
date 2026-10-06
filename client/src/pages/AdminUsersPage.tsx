import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Users, Loader2, KeyRound } from "lucide-react";
import { userRoles, type UserRole } from "@shared/schema";

interface UserData {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: string;
  active: boolean;
  plainPassword?: string | null;
}

const roleLabels: Record<string, string> = {
  carrier_rep: "Carrier Rep",
  carrier_lead: "Carrier Lead",
  carrier_manager: "Carrier Manager",
  sales_rep: "Sales Rep",
  sales_lead: "Sales Lead",
  pricing: "Pricing",
  superadmin: "Super Admin",
};

const roleColors: Record<string, string> = {
  superadmin: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  pricing: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  carrier_manager: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  carrier_lead: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
  carrier_rep: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  sales_rep: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  sales_lead: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
};

export default function AdminUsersPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    name: "",
    email: "",
    role: "sales_rep" as UserRole,
    active: true,
  });

  const { data: users = [], isLoading } = useQuery<UserData[]>({
    queryKey: ["/api/users-with-passwords"],
  });

  const invalidateUsers = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    queryClient.invalidateQueries({ queryKey: ["/api/users-with-passwords"] });
  };

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => apiRequest("POST", "/api/users", data),
    onSuccess: () => {
      invalidateUsers();
      toast({ title: "Usuario creado", description: "El usuario ha sido creado exitosamente" });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo crear el usuario", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<typeof formData> }) =>
      apiRequest("PATCH", `/api/users/${id}`, data),
    onSuccess: () => {
      invalidateUsers();
      toast({ title: "Usuario actualizado", description: "El usuario ha sido actualizado exitosamente" });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo actualizar el usuario", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/users/${id}`),
    onSuccess: () => {
      invalidateUsers();
      toast({ title: "Usuario eliminado", description: "El usuario ha sido eliminado" });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo eliminar el usuario", variant: "destructive" });
    },
  });

  const openCreateDialog = () => {
    setEditingUser(null);
    setFormData({ username: "", password: "", name: "", email: "", role: "sales_rep", active: true });
    setIsDialogOpen(true);
  };

  const openEditDialog = (user: UserData) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      password: "",
      name: user.name,
      email: user.email || "",
      role: user.role as UserRole,
      active: user.active,
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingUser(null);
    setFormData({ username: "", password: "", name: "", email: "", role: "sales_rep", active: true });
  };

  const handleSubmit = () => {
    if (editingUser) {
      const updateData: Partial<typeof formData> = { ...formData };
      if (!updateData.password) {
        delete updateData.password;
      }
      updateMutation.mutate({ id: editingUser.id, data: updateData });
    } else {
      if (!formData.password) {
        toast({ title: "Error", description: "La contraseña es requerida", variant: "destructive" });
        return;
      }
      createMutation.mutate(formData);
    }
  };

  const resetPasswordsMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/reset-all-passwords"),
    onSuccess: () => {
      invalidateUsers();
      toast({ title: "Contraseñas actualizadas", description: "Se restauraron las contraseñas por defecto para todos los usuarios sin contraseña registrada" });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudieron resetear las contraseñas", variant: "destructive" });
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-admin-users-title">Administración de Usuarios</h1>
            <p className="text-muted-foreground text-sm">Gestiona las cuentas y permisos del sistema</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {users.some(u => !u.plainPassword) && (
            <Button
              variant="outline"
              onClick={() => resetPasswordsMutation.mutate()}
              disabled={resetPasswordsMutation.isPending}
              data-testid="button-reset-passwords"
            >
              {resetPasswordsMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />}
              Restaurar Contraseñas
            </Button>
          )}
          <Button onClick={openCreateDialog} data-testid="button-create-user">
            <Plus className="h-4 w-4 mr-2" />
            Nuevo Usuario
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Usuarios del Sistema</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No hay usuarios registrados. Crea el primero.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Contraseña</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                    <TableCell className="font-medium">{user.username}</TableCell>
                    <TableCell>{user.name}</TableCell>
                    <TableCell className="text-muted-foreground">{user.email || "-"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{user.plainPassword || "-"}</TableCell>
                    <TableCell>
                      <Badge className={roleColors[user.role] || ""}>
                        {roleLabels[user.role] || user.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.active ? "default" : "secondary"}>
                        {user.active ? "Activo" : "Inactivo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEditDialog(user)}
                          data-testid={`button-edit-user-${user.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => deleteMutation.mutate(user.id)}
                          data-testid={`button-delete-user-${user.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? "Editar Usuario" : "Nuevo Usuario"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">Usuario</Label>
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  placeholder="nombre.usuario"
                  data-testid="input-username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{editingUser ? "Nueva Contraseña (opcional)" : "Contraseña"}</Label>
                {editingUser && (
                  <p className={`text-xs font-mono px-2 py-1 rounded ${editingUser.plainPassword ? "text-muted-foreground bg-muted" : "text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30"}`} data-testid="text-current-password">
                    {editingUser.plainPassword ? `Actual: ${editingUser.plainPassword}` : "Sin contraseña registrada"}
                  </p>
                )}
                <Input
                  id="password"
                  type="text"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder={editingUser ? "Dejar vacío para mantener" : "••••••••"}
                  data-testid="input-password"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Nombre Completo</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Juan Pérez"
                data-testid="input-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="juan@empresa.com"
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Rol</Label>
              <Select
                value={formData.role}
                onValueChange={(value) => setFormData({ ...formData, role: value as UserRole })}
              >
                <SelectTrigger data-testid="select-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {userRoles.map((role) => (
                    <SelectItem key={role} value={role}>
                      {roleLabels[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={isPending} data-testid="button-submit-user">
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingUser ? "Guardar Cambios" : "Crear Usuario"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
