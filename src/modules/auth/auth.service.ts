import { randomBytes, createHash } from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { db, transaction, type Tx } from "../../lib/db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/http.js";
import { userSelect } from "../../lib/validation.js";
import { audit } from "../../lib/audit.js";
export const email = z.email().trim().toLowerCase().max(254);
export const password = z.string().min(12).max(128);
export const registerSchema = z.object({ email, password, name: z.string().trim().min(2).max(100), phone: z.string().regex(/^\+?[0-9]{10,15}$/).optional() }).strict();
export const loginSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();
export const refreshSchema = z.object({ refreshToken: z.string().regex(/^[a-f0-9]{96}$/) }).strict();
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
async function tokens(tx: Tx, userId: string) {
  const refreshToken = randomBytes(48).toString("hex");
  await tx.refreshToken.create({ data: { userId, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400000) } });
  const accessToken = jwt.sign({}, env.JWT_SECRET, { algorithm: "HS256", subject: userId, issuer: "courier-api", audience: "courier-api", expiresIn: env.ACCESS_TOKEN_MINUTES * 60 });
  return { accessToken, refreshToken, tokenType: "Bearer", expiresIn: env.ACCESS_TOKEN_MINUTES * 60 };
}
export async function register(input: z.infer<typeof registerSchema>) {
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  return transaction(async tx => {
    const user = await tx.user.create({ data: { email: input.email, name: input.name, phone: input.phone, passwordHash }, select: userSelect });
    await audit(tx, user.id, "auth.register", "User", user.id);
    return { user, ...await tokens(tx, user.id) };
  });
}
export async function login(input: z.infer<typeof loginSchema>) {
  const user = await db.user.findUnique({ where: { email: input.email } });
  if (!user?.passwordHash || !await argon2.verify(user.passwordHash, input.password) || !user.isActive || user.deletedAt) throw new AppError(401, "Invalid email or password");
  return transaction(async tx => {
    const current = await tx.user.findFirst({ where: { id: user.id, isActive: true, deletedAt: null }, select: userSelect });
    if (!current) throw new AppError(401, "Account unavailable");
    await audit(tx, user.id, "auth.login", "User", user.id);
    return { user: current, ...await tokens(tx, user.id) };
  });
}
export async function refresh(token: string) {
  return transaction(async tx => {
    const stored = await tx.refreshToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.isActive || stored.user.deletedAt) throw new AppError(401, "Invalid or expired refresh token");
    const changed = await tx.refreshToken.updateMany({ where: { id: stored.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (changed.count !== 1) throw new AppError(401, "Refresh token already used");
    return tokens(tx, stored.userId);
  });
}
export async function logout(token: string) {
  await db.refreshToken.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
}
export { tokens };
