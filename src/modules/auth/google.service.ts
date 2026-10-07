import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { env } from "../../config/env.js";
import { transaction } from "../../lib/db.js";
import { AppError } from "../../middleware/http.js";
import { userSelect } from "../../lib/validation.js";
import { audit } from "../../lib/audit.js";
import { tokens } from "./auth.service.js";
export const googleSchema = z.object({ idToken: z.string().min(20).max(10000) }).strict();
const client = new OAuth2Client();
async function identity(idToken: string) {
  if (!env.GOOGLE_CLIENT_ID) throw new AppError(503, "Google login is not configured");
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.email_verified || !payload.sub) throw new Error("Unverified identity");
    return { sub: payload.sub, email: payload.email.toLowerCase(), name: payload.name || "Customer" };
  } catch { throw new AppError(401, "Invalid or unverified Google identity token"); }
}
export async function googleLogin(idToken: string) {
  const info = await identity(idToken);
  return transaction(async tx => {
    let user = await tx.user.findUnique({ where: { googleId: info.sub }, select: userSelect });
    if (!user) {
      const existing = await tx.user.findUnique({ where: { email: info.email } });
      if (existing) throw new AppError(409, "Sign in with your password and link Google from your account");
      user = await tx.user.create({ data: { email: info.email, googleId: info.sub, name: info.name }, select: userSelect });
    }
    const active = await tx.user.findFirst({ where: { id: user.id, isActive: true, deletedAt: null } });
    if (!active) throw new AppError(401, "Account unavailable");
    await audit(tx, user.id, "auth.googleLogin", "User", user.id);
    return { user, ...await tokens(tx, user.id) };
  });
}
export async function linkGoogle(userId: string, idToken: string) {
  const info = await identity(idToken);
  return transaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email !== info.email || (user.googleId && user.googleId !== info.sub)) throw new AppError(409, "Google identity must match this account");
    const updated = await tx.user.update({ where: { id: userId }, data: { googleId: info.sub }, select: userSelect });
    await audit(tx, userId, "auth.googleLinked", "User", userId);
    return updated;
  });
}
