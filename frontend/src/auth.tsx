import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api, getTokens, setTokens, Tokens, User } from "./api";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadUser = useCallback(async () => {
    if (!getTokens()) {
      setUser(null);
      return;
    }
    try {
      setUser(await api.me());
    } catch {
      setTokens(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    reloadUser().finally(() => setLoading(false));
  }, [reloadUser]);

  const login = async (username: string, password: string) => {
    const tokens: Tokens = await api.login(username, password);
    setTokens(tokens);
    setUser(await api.me());
  };

  const logout = () => {
    setTokens(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, reloadUser }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
