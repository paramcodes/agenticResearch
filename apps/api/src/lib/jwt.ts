import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { config } from "../env.js";

export interface JwtPayload {
  sub: string;
  email: string;
}

export function signToken(user: { id: string; email: string }): string {
  return jwt.sign(
    { sub: user.id, email: user.email } satisfies JwtPayload,
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn } as jwt.SignOptions,
  );
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("hex");
}

export function tokenExpirySeconds(): number {
  // Mirror JWT_EXPIRES_IN loosely for redis blacklist TTL (default 7d).
  const raw = config.jwtExpiresIn;
  const m = /^(\d+)([smhd])?$/.exec(raw);
  if (!m) return 7 * 24 * 3600;
  const n = Number(m[1]);
  const unit = m[2] ?? "s";
  const mult = { s: 1, m: 60, h: 3600, d: 86400 } as const;
  return n * mult[unit as keyof typeof mult];
}

export function refreshTokenExpiryDays(): number {
  return 30; // Refresh tokens valid for 30 days
}
