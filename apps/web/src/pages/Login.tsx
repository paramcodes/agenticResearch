import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { GOOGLE_CLIENT_ID } from "../lib/api";
import { useAuth } from "../lib/auth";

export function Login() {
  const { login, googleLogin } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(identifier, password);
      nav(loc.state?.from || "/agent", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h2>Welcome back</h2>
        <p className="muted">Log in to reach the Agent.</p>
        {error && <div className="error">{error}</div>}
        <label>
          Email or username
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoComplete="username" />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </label>
        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy ? "Logging in…" : "Login"}
        </button>
        {GOOGLE_CLIENT_ID ? (
          <div className="google-row">
            <GoogleLogin
              onSuccess={(c) => {
                if (c.credential) {
                  setBusy(true);
                  googleLogin(c.credential)
                    .then(() => nav(loc.state?.from || "/agent", { replace: true }))
                    .catch((err) => setError((err as Error).message))
                    .finally(() => setBusy(false));
                }
              }}
              onError={() => setError("Google login failed")}
            />
          </div>
        ) : (
          <p className="muted small">Google login is disabled (set VITE_GOOGLE_CLIENT_ID).</p>
        )}
        <p className="muted small">
          No account? <Link to="/signup">Sign up</Link>
        </p>
      </form>
    </div>
  );
}
