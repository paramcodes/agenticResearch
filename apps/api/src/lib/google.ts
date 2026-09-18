import { OAuth2Client } from "google-auth-library";
import { config } from "../env.js";

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

/**
 * Verify a Google ID token (credential from GIS / @react-oauth/google).
 * Production path uses OAuth2Client.verifyIdToken with GOOGLE_CLIENT_ID.
 * Dev fallback (ALLOW_INSECURE_GOOGLE_DEV=true, no client id): decode the
 * payload without signature verification so the auth loop can be tested
 * without Google Cloud setup. Never enable the fallback in production.
 */
export async function verifyGoogleCredential(credential: string): Promise<GoogleProfile> {
  if (config.googleClientId) {
    const client = new OAuth2Client(config.googleClientId);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: config.googleClientId,
    });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error("Invalid Google token payload");
    return {
      googleId: p.sub,
      email: p.email,
      name: p.name ?? p.email.split("@")[0] ?? "Google User",
      avatarUrl: p.picture,
    };
  }
  if (config.allowInsecureGoogleDev || config.nodeEnv !== "production") {
    console.warn("[auth] verifying Google credential WITHOUT signature (dev fallback)");
    const parts = credential.split(".");
    const seg = parts[1];
    if (parts.length < 2 || !seg) throw new Error("Malformed credential");
    const payload = JSON.parse(Buffer.from(seg, "base64url").toString("utf8")) as Record<string, unknown>;
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!sub || !email) throw new Error("Invalid Google token payload");
    return {
      googleId: sub,
      email,
      name: (typeof payload.name === "string" && payload.name) || email.split("@")[0] || "Google User",
      avatarUrl: typeof payload.picture === "string" ? payload.picture : undefined,
    };
  }
  throw new Error("Google auth not configured (set GOOGLE_CLIENT_ID)");
}
