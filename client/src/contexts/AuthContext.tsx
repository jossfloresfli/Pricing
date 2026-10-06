import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { queryClient } from "@/lib/queryClient";
import type { UserRole } from "@shared/schema";

export type { UserRole };

export interface User {
  id: string;
  name: string;
  email?: string | null;
  username: string;
  role: UserRole;
  active?: boolean;
  originalRole?: UserRole;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (user: User) => void;
  logout: () => Promise<void>;
  setRole: (role: UserRole) => void;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });
      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshSession().finally(() => setIsLoading(false));
  }, [refreshSession]);

  const login = (newUser: User) => {
    setUser(newUser);
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore errors, still clear local state
    }
    setUser(null);
    queryClient.clear();
  };

  const setRole = (role: UserRole) => {
    if (user) {
      // Track original role for superadmins so they can switch back
      const originalRole = user.originalRole || user.role;
      setUser({ ...user, role, originalRole });
    }
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout, setRole, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

export const roleLabels: Record<UserRole, string> = {
  carrier_rep: "Carrier Rep",
  carrier_lead: "Carrier Lead",
  carrier_manager: "Carrier Manager",
  sales_rep: "Sales Rep",
  sales_lead: "Sales Lead",
  sales_manager: "Sales Manager",
  pricing: "Pricing",
  superadmin: "Superadmin",
};
