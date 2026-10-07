import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env.js";
import { db } from "./lib/db.js";
import { logger } from "./lib/logger.js";
import { openApi } from "./lib/openapi.js";
import { AppError, asyncHandler, errorHandler, ok } from "./middleware/http.js";
import addresses from "./modules/addresses/addresses.routes.js";
import admin from "./modules/admin/admin.routes.js";
import auth from "./modules/auth/auth.routes.js";
import couriers from "./modules/couriers/couriers.routes.js";
import hubs from "./modules/hubs/hubs.routes.js";
import payments from "./modules/payments/payment.routes.js";
import { webhook } from "./modules/payments/webhook.service.js";
import shipments from "./modules/shipments/shipment.routes.js";
import users from "./modules/users/users.routes.js";
import zones from "./modules/zones/zones.routes.js";
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader("X-Request-Id", res.locals.requestId);
    const start = Date.now();
    res.on("finish", () =>
      logger.info(
        {
          requestId: res.locals.requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - start,
        },
        "Request completed",
      ),
    );
    next();
  });
  app.use(helmet());
  const allowed = env.CORS_ORIGINS.split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowed.includes(origin)) callback(null, true);
        else callback(new AppError(403, "Origin is not allowed"));
      },
      credentials: false,
    }),
  );
  app.post(
    "/api/v1/payments/webhook",
    express.raw({ type: "application/json", limit: "256kb" }),
    asyncHandler(async (req, res) => {
      if (!Buffer.isBuffer(req.body))
        throw new AppError(400, "Webhook requires application/json raw body");
      return ok(res, await webhook(req.body, req.get("stripe-signature")), "Webhook processed");
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: env.NODE_ENV === "test" ? 10000 : 120,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, res) =>
        res.status(429).json({ success: false, message: "Too many requests", errors: [] }),
    }),
  );
  app.get("/health", (_req, res) => ok(res, { status: "alive" }));
  app.get(
    "/ready",
    asyncHandler(async (_req, res) => {
      try {
        await db.$queryRaw`SELECT 1`;
      } catch {
        throw new AppError(503, "Database is not ready");
      }
      return ok(res, { status: "ready" });
    }),
  );
  for (const [path, router] of Object.entries({
    auth,
    users,
    addresses,
    zones,
    hubs,
    shipments,
    payments,
    admin,
    couriers,
  }))
    app.use(`/api/v1/${path}`, router);
  app.get("/api/v1/openapi.json", (_req, res) => res.json(openApi()));
  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(openApi(), {
      swaggerOptions: { persistAuthorization: true },
      customSiteTitle: "Courier API Docs",
    }),
  );
  app.use((_req, _res, next) => next(new AppError(404, "Route not found")));
  app.use(errorHandler);
  return app;
}

export default createApp();
