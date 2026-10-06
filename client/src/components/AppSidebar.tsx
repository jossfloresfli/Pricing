import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Kanban,
  FileText,
  FilePlus,
  Settings,
  Sparkles,
  Users,
  Database,
  LogOut,
  BarChart3,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth, roleLabels } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import vaxLogo from "@assets/ChatGPT_Image_18_ene_2026,_20_56_57_1768791470192.png";

const mainNavItems: {
  title: string;
  icon: typeof LayoutDashboard;
  url: string;
  hideForCarriers?: boolean;
  managerOrAbove?: boolean;
  superadminOnly?: boolean;
  noSales?: boolean;
}[] = [
  { title: "Dashboard", icon: LayoutDashboard, url: "/" },
  { title: "Pricing Board", icon: Kanban, url: "/board" },
  { title: "Nueva Cotización", icon: FilePlus, url: "/new", hideForCarriers: true },
  { title: "Pricing File", icon: FileText, url: "/pricing-file", managerOrAbove: true },
  // El copiloto sólo es visible para roles con acceso a la referencia de
  // costo (los roles de ventas no lo ven; el backend lo refuerza igualmente).
  { title: "Copilot", icon: Sparkles, url: "/copilot", noSales: true },
  // Desempeño del equipo de ventas: sólo líderes/managers y superadmin.
  { title: "Sales Reps", icon: BarChart3, url: "/sales-reps", managerOrAbove: true },
];

const adminNavItems = [
  { title: "Usuarios", icon: Users, url: "/admin/users", superadminOnly: true },
  { title: "Catálogos", icon: Database, url: "/admin/catalogos", superadminOnly: true },
  { title: "Estadísticas", icon: BarChart3, url: "/admin/stats" },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  const isCarrierRole = user?.role === "carrier_rep" || user?.role === "carrier_lead" || user?.role === "carrier_manager";
  const isSuperadmin = user?.role === "superadmin";
  const isManagerOrAbove = isSuperadmin || user?.role === "sales_manager" || user?.role === "carrier_manager" || user?.role === "pricing";
  const showAdminSection = isManagerOrAbove || user?.role === "sales_lead";
  const canSeePricingFile = isManagerOrAbove || user?.role === "sales_lead";

  const isSalesRole = (user?.role || "").toLowerCase().includes("sales");

  const filteredNavItems = mainNavItems.filter(item => {
    if (item.hideForCarriers && isCarrierRole) return false;
    if (item.superadminOnly && !isSuperadmin) return false;
    if (item.managerOrAbove && !canSeePricingFile) return false;
    if (item.noSales && isSalesRole) return false;
    return true;
  });

  const filteredAdminItems = adminNavItems.filter(item => {
    if (item.superadminOnly && !isSuperadmin) return false;
    return true;
  });

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <img 
            src={vaxLogo} 
            alt="VAX Solutions" 
            className="h-10 w-auto object-contain"
          />
          <div className="flex flex-col">
            <span className="font-semibold text-sm">Pricing Hub</span>
            <span className="text-xs text-muted-foreground">v1.0</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Principal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {showAdminSection && (
          <SidebarGroup>
            <SidebarGroupLabel>Administración</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {filteredAdminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url}
                      data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <Link href={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3 p-2 rounded-lg bg-sidebar-accent">
          <Avatar className="h-9 w-9">
            <AvatarImage src={undefined} alt={user?.name} />
            <AvatarFallback className="text-xs">
              {user ? getInitials(user.name) : "?"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.name}</p>
            <Badge variant="secondary" className="text-xs mt-0.5">
              {user ? roleLabels[user.role] : ""}
            </Badge>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={logout}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
