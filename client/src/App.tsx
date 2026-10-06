import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/LoginPage";
import Dashboard from "@/pages/Dashboard";
import BoardPage from "@/pages/BoardPage";
import NewRequestPage from "@/pages/NewRequestPage";
import PricingFilePage from "@/pages/PricingFilePage";
import CopilotPage from "@/pages/CopilotPage";
import AdminUsersPage from "@/pages/AdminUsersPage";
import AdminCatalogosPage from "@/pages/AdminCatalogosPage";
import AdminStatsPage from "@/pages/AdminStatsPage";
import SalesRepsPage from "@/pages/SalesRepsPage";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/board" component={BoardPage} />
      <Route path="/new" component={NewRequestPage} />
      <Route path="/pricing-file" component={PricingFilePage} />
      <Route path="/copilot" component={CopilotPage} />
      <Route path="/admin/users" component={AdminUsersPage} />
      <Route path="/admin/catalogos" component={AdminCatalogosPage} />
      <Route path="/admin/stats" component={AdminStatsPage} />
      <Route path="/sales-reps" component={SalesRepsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Cargando...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Header />
          <div className="flex items-center justify-end px-4 py-2 border-b bg-muted/30">
            <RoleSwitcher />
          </div>
          <main className="flex-1 overflow-auto">
            <Router />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <AuthenticatedApp />
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
