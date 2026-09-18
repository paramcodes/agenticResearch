import type { NextFunction, Request, Response } from "express";
import { prisma } from "@repo/db";
import { isTokenBlacklisted } from "../lib/redis.js";
import { verifyToken } from "../lib/jwt.js";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  username: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      token?: string;
    }
  }
}

export function getBearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return null;
  return h.slice("Bearer ".length).trim() || null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Missing bearer token" });
      return;
    }
    if (await isTokenBlacklisted(token)) {
      res.status(401).json({ error: "Token revoked, please log in again" });
      return;
    }
    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      res.status(401).json({ error: "User no longer exists" });
      return;
    }
    req.user = { id: user.id, email: user.email, name: user.name, username: user.username };
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error("[api] error:", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
}

export function toPublicUser(u: {
  id: string;
  name: string;
  email: string;
  username: string | null;
  avatarUrl: string | null;
  provider: string;
  createdAt: Date;
}) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    username: u.username,
    avatarUrl: u.avatarUrl,
    provider: u.provider,
    createdAt: u.createdAt.toISOString(),
  };
}
