import { Router, type Request, type Response, type RequestHandler } from "express";
import { z, type ZodType } from "zod";
import { authMiddleware, roles } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/http.js";
import type { Role } from "../generated/prisma/client.js";
export type Spec = { summary: string; roles?: Role[]; body?: ZodType; query?: ZodType; params?: ZodType; status?: number; example?: unknown; description?: string; middleware?: RequestHandler[] };
export const apiSpecs: { method: string; path: string; spec: Spec }[] = [];
export function createModule(prefix: string) {
  const router = Router();
  function endpoint(method: "get" | "post" | "patch" | "delete", path: string, spec: Spec, handler: (req: Request, res: Response) => Promise<unknown>) {
    apiSpecs.push({ method, path: `/api/v1${prefix}${path === "/" ? "" : path}`, spec });
    const middleware = [...(spec.middleware || []), ...(spec.roles ? [authMiddleware, roles(spec.roles)] : [])];
    router[method](path, ...middleware, asyncHandler(async (req, res) => {
      if (spec.body) req.body = spec.body.parse(req.body);
      if (spec.params) spec.params.parse(req.params);
      if (spec.query) res.locals.query = spec.query.parse(req.query);
      return handler(req, res);
    }));
  }
  return { router, endpoint };
}
export function jsonSchema(schema: ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
}
