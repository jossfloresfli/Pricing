import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "../AppSidebar";
import { AuthProvider } from "@/contexts/AuthContext";

export default function AppSidebarExample() {
  return (
    <AuthProvider>
      <SidebarProvider>
        <div className="flex h-[500px] w-full">
          <AppSidebar />
          <div className="flex-1 p-6 bg-background">
            <p className="text-muted-foreground">Main content area</p>
          </div>
        </div>
      </SidebarProvider>
    </AuthProvider>
  );
}
