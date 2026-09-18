import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getToken, setToken, type PublicUser } from "./api";

interface AuthCtx {
  user: PublicUser | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; username?: string; password: string }) => Promise<void>;
  googleLogin: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: PublicUser | null) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { user } = await api.me();
      setUser(user);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (identifier: string, password: string) => {
    const { user, token } = await api.login({ identifier, password });
    setToken(token);
    setUser(user);
  }, []);

  const register = useCallback(async (input: { name: string; email: string; username?: string; password: string }) => {
    const { user, token } = await api.register(input);
    setToken(token);
    setUser(user);
  }, []);

  const googleLogin = useCallback(async (credential: string) => {
    const { user, token } = await api.google(credential);
    setToken(token);
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // still clear locally
    }
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, googleLogin, logout, refresh, setUser }),
    [user, loading, login, register, googleLogin, logout, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
