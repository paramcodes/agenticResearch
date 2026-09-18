import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@repo/db";
import { signToken, tokenExpirySeconds } from "../lib/jwt.js";
import { blacklistToken } from "../lib/redis.js";
import { verifyGoogleCredential } from "../lib/google.js";
import { asyncHandler, requireAuth, toPublicUser } from "../middleware/auth.js";

const router: Router = Router();

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(255),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).optional(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  identifier: z.string().min(1).max(255), // email OR username
  password: z.string().min(1).max(128),
});

const googleSchema = z.object({
  credential: z.string().min(10),
});

const profileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().max(255).optional(),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).nullable().optional(),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

function zodError(res: Response, err: unknown) {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: "Validation failed", details: err.flatten().fieldErrors });
    return true;
  }
  return false;
}

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    let body;
    try {
      body = registerSchema.parse(req.body);
    } catch (err) {
      if (zodError(res, err)) return;
      throw err;
    }
    const email = body.email.toLowerCase().trim();
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email }, ...(body.username ? [{ username: body.username }] : [])],
      },
    });
    if (existing) {
      res.status(409).json({ error: "Email or username already in use" });
      return;
    }
    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await prisma.user.create({
      data: {
        name: body.name.trim(),
        email,
        username: body.username ?? null,
        passwordHash,
        provider: "CREDENTIALS",
      },
    });
    const token = signToken(user);
    res.status(201).json({ user: toPublicUser(user), token });
  }),
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    let body;
    try {
      body = loginSchema.parse(req.body);
    } catch (err) {
      if (zodError(res, err)) return;
      throw err;
    }
    const id = body.identifier.trim();
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: id.toLowerCase() }, { username: id }],
      },
    });
    if (!user?.passwordHash || !(await bcrypt.compare(body.password, user.passwordHash))) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const token = signToken(user);
    res.json({ user: toPublicUser(user), token });
  }),
);

router.post(
  "/google",
  asyncHandler(async (req, res) => {
    let body;
    try {
      body = googleSchema.parse(req.body);
    } catch (err) {
      if (zodError(res, err)) return;
      throw err;
    }
    let profile;
    try {
      profile = await verifyGoogleCredential(body.credential);
    } catch (err) {
      res.status(401).json({ error: (err as Error).message });
      return;
    }
    const email = profile.email.toLowerCase().trim();
    let user = (await prisma.user.findUnique({ where: { googleId: profile.googleId } })) ??
      (await prisma.user.findUnique({ where: { email } }));
    if (!user) {
      user = await prisma.user.create({
        data: {
          name: profile.name,
          email,
          googleId: profile.googleId,
          avatarUrl: profile.avatarUrl,
          provider: "GOOGLE",
        },
      });
    } else if (!user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId: profile.googleId, avatarUrl: user.avatarUrl ?? profile.avatarUrl },
      });
    }
    const token = signToken(user);
    res.json({ user: toPublicUser(user), token });
  }),
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user: toPublicUser(user) });
  }),
);

router.patch(
  "/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    let body;
    try {
      body = profileSchema.parse(req.body);
    } catch (err) {
      if (zodError(res, err)) return;
      throw err;
    }
    const data: { name?: string; email?: string; username?: string | null } = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.email !== undefined) data.email = body.email.toLowerCase().trim();
    if (body.username !== undefined) data.username = body.username?.trim() || null;
    try {
      const user = await prisma.user.update({ where: { id: req.user!.id }, data });
      res.json({ user: toPublicUser(user) });
    } catch {
      res.status(409).json({ error: "Email or username already in use" });
    }
  }),
);

router.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    let body;
    try {
      body = passwordSchema.parse(req.body);
    } catch (err) {
      if (zodError(res, err)) return;
      throw err;
    }
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (user.provider === "GOOGLE" && !user.passwordHash) {
      // Google users setting their first password — no current password needed
      // if they send an empty string; otherwise verify normally below.
      if (body.currentPassword !== "") {
        res.status(400).json({ error: "Google accounts have no password yet — leave current password empty" });
        return;
      }
    } else if (!user.passwordHash || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(body.newPassword, 10) },
    });
    res.json({ ok: true });
  }),
);

router.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.token) await blacklistToken(req.token, tokenExpirySeconds());
    res.json({ ok: true });
  }),
);

export default router;
