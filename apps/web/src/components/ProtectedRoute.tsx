import type { ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function ProtectedRoute({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="page-center">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return children;
}
