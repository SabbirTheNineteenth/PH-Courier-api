import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { db } from "../lib/db.js";
import { userSelect } from "../lib/validation.js";
import { AppError } from "./http.js";
import type { Role } from "../generated/prisma/client.js";
export type Actor = { id: string; email: string; name: string; role: Role; isActive: boolean };
export const actor = (res: Response): Actor => res.locals.user as Actor;
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => { authorizeRequest(req, res).then(() => next(), next); };
async function authorizeRequest(req: Request, res: Response) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new AppError(401, "Bearer token required");
  let userId: string;
  try {
    const decoded = jwt.verify(header.slice(7), env.JWT_SECRET, { algorithms: ["HS256"], issuer: "courier-api", audience: "courier-api" });
    if (typeof decoded === "string" || typeof decoded.sub !== "string") throw new Error("Invalid subject");
    userId = decoded.sub;
  } catch { throw new AppError(401, "Invalid or expired access token"); }
  const user = await db.user.findFirst({ where: { id: userId, isActive: true, deletedAt: null }, select: userSelect });
  if (!user) throw new AppError(401, "Account unavailable");
  res.locals.user = user;
}
export const roles = (allowed: Role[]) => (_req: Request, res: Response, next: NextFunction) => {
  if (!allowed.includes(actor(res).role)) return next(new AppError(403, "This role cannot perform this operation"));
  next();
};
