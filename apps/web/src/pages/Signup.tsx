import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { GOOGLE_CLIENT_ID } from "../lib/api";
import { useAuth } from "../lib/auth";

export function Signup() {
  const { register, googleLogin } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register({ name, email, username: username || undefined, password });
      nav("/agent", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h2>Create your account</h2>
        <p className="muted">One account for the Agent and your history.</p>
        {error && <div className="error">{error}</div>}
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Username <span className="muted">(optional)</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Password <span className="muted">(min 8 chars)</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        </label>
        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy ? "Creating…" : "Signup"}
        </button>
        {GOOGLE_CLIENT_ID && (
          <div className="google-row">
            <GoogleLogin
              text="signup_with"
              onSuccess={(c) => {
                if (c.credential) {
                  setBusy(true);
                  googleLogin(c.credential)
                    .then(() => nav("/agent", { replace: true }))
                    .catch((err) => setError((err as Error).message))
                    .finally(() => setBusy(false));
                }
              }}
              onError={() => setError("Google signup failed")}
            />
          </div>
        )}
        <p className="muted small">
          Have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
