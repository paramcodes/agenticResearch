import { BrowserRouter, Route, Routes } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { GOOGLE_CLIENT_ID } from "./lib/api";
import { AuthProvider } from "./lib/auth";
import { Navbar } from "./components/Navbar";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { Agent } from "./pages/Agent";
import { Profile } from "./pages/Profile";

export function App() {
  const tree = (
    <AuthProvider>
      <BrowserRouter>
        <Navbar />
        <main className="main">
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route
              path="/agent"
              element={
                <ProtectedRoute>
                  <Agent />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<div className="page-center">404 — page not found</div>} />
          </Routes>
        </main>
      </BrowserRouter>
    </AuthProvider>
  );
  // Google provider is optional so local dev works without a client id.
  return GOOGLE_CLIENT_ID ? (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{tree}</GoogleOAuthProvider>
  ) : (
    tree
  );
}
