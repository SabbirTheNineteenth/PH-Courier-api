import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodType } from "zod";
import { Prisma } from "../generated/prisma/client.js";
import { logger } from "../lib/logger.js";
export class AppError extends Error {
  constructor(public status: number, message: string, public errors: { path: string; message: string }[] = []) { super(message); }
}
export const ok = (res: Response, data: unknown, message = "Operation successful", status = 200) => res.status(status).json({ success: true, message, data });
export const asyncHandler = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res)).catch(next); };
export function validate<T>(schema: ZodType<T>, input: unknown): T { return schema.parse(input); }
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  let status = 500;
  let message = "Internal server error";
  let errors: { path: string; message: string }[] = [];
  if (error instanceof AppError) { status = error.status; message = error.message; errors = error.errors; }
  else if (error instanceof ZodError) { status = 400; message = "Validation failed"; errors = error.issues.map(i => ({ path: i.path.join("."), message: i.message })); }
  else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") { status = 409; message = "A record with these values already exists"; }
    else if (error.code === "P2025") { status = 404; message = "Record not found"; }
    else if (error.code === "P2003") { status = 409; message = "Referenced record is unavailable or still in use"; }
    else if (error.code === "P2034") { status = 409; message = "Concurrent change detected; retry the request"; }
  } else if (error instanceof SyntaxError && "body" in error) { status = 400; message = "Invalid JSON body"; }
  else if (typeof error === "object" && error && "type" in error && error.type === "entity.too.large") { status = 413; message = "Request body too large"; }
  if (status === 500) logger.error({ err: error, requestId: res.locals.requestId, method: req.method, path: req.path }, "Request failed");
  res.status(status).json({ success: false, message, errors });
}
