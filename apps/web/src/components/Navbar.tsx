import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function Navbar() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const onLogout = async () => {
    await logout();
    setOpen(false);
    nav("/");
  };

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="brand">
          ResearcherIt
        </Link>
        <nav className="nav-center">
          <Link to="/" className="nav-link">
            Home
          </Link>
          <Link to={user ? "/agent" : "/login"} className="nav-link">
            Agent
          </Link>
        </nav>
        <div className="nav-right">
          {!user ? (
            <>
              <Link to="/login" className="nav-link">
                Login
              </Link>
              <Link to="/signup" className="btn btn-primary btn-sm">
                Signup
              </Link>
            </>
          ) : (
            <div className="profile-menu" ref={menuRef}>
              <button className="profile-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
                <span className="avatar">{user.name.charAt(0).toUpperCase()}</span>
                <span className="profile-name">{user.name}</span>
                <span className="caret">▾</span>
              </button>
              {open && (
                <div className="dropdown" role="menu">
                  <Link to="/profile" className="dropdown-item" onClick={() => setOpen(false)}>
                    Profile
                  </Link>
                  <button className="dropdown-item" onClick={onLogout}>
                    Logout
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
