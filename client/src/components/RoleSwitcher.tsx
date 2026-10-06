import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth, roleLabels, type UserRole } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { User } from "lucide-react";

export function RoleSwitcher() {
  const { user, setRole } = useAuth();

  if (!user) return null;

  // Only superadmins can switch roles (check both current and original role)
  const isSuperadmin = user.role === "superadmin" || user.originalRole === "superadmin";
  
  if (isSuperadmin) {
    return (
      <div className="flex items-center gap-2">
        <User className="h-4 w-4 text-muted-foreground" />
        <Select value={user.role} onValueChange={(value) => setRole(value as UserRole)}>
          <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-role-switcher">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(roleLabels) as UserRole[]).map((role) => (
              <SelectItem key={role} value={role} className="text-xs">
                {roleLabels[role]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Other users only see their assigned role (read-only)
  return (
    <div className="flex items-center gap-2" data-testid="role-display">
      <User className="h-4 w-4 text-muted-foreground" />
      <Badge variant="secondary" className="text-xs font-medium">
        {roleLabels[user.role]}
      </Badge>
    </div>
  );
}
