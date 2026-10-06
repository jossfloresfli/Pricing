import { SidebarProvider } from "@/components/ui/sidebar";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { Header } from "../Header";

export default function HeaderExample() {
  return (
    <ThemeProvider>
      <SidebarProvider>
        <div className="w-full">
          <Header title="Dashboard" />
        </div>
      </SidebarProvider>
    </ThemeProvider>
  );
}
