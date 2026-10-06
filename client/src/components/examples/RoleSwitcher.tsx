import { AuthProvider } from "@/contexts/AuthContext";
import { RoleSwitcher } from "../RoleSwitcher";

export default function RoleSwitcherExample() {
  return (
    <AuthProvider>
      <RoleSwitcher />
    </AuthProvider>
  );
}
