import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

export function Profile() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return <div className="page-center">Loading…</div>;

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const { user: updated } = await api.updateProfile({
        name,
        email,
        username: username || null,
      });
      setUser(updated);
      setMsg("Profile updated.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setMsg("Password updated.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-page">
      <h2>Profile</h2>
      {msg && <div className="success">{msg}</div>}
      {error && <div className="error">{error}</div>}
      <form className="card" onSubmit={saveProfile}>
        <h3>Account</h3>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="optional" />
        </label>
        <p className="muted small">Signed in via {user.provider === "GOOGLE" ? "Google" : "email"} · joined {new Date(user.createdAt).toLocaleDateString()}</p>
        <button className="btn btn-primary" disabled={busy} type="submit">
          Save changes
        </button>
      </form>
      <form className="card" onSubmit={savePassword}>
        <h3>Password</h3>
        <label>
          Current password {user.provider === "GOOGLE" && <span className="muted">(leave empty for first password)</span>}
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        </label>
        <label>
          New password <span className="muted">(min 8 chars)</span>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        </label>
        <button className="btn btn-ghost" disabled={busy} type="submit">
          Update password
        </button>
      </form>
    </div>
  );
}
