import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  GOOGLE_CLIENT_ID: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PAYMENT_SUCCESS_URL: z.url().default("http://localhost:4000/api/v1/payments/success"),
  PAYMENT_CANCEL_URL: z.url().default("http://localhost:4000/api/v1/payments/cancel"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  REDIS_URL: z.string().optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).max(2).default(0),
});
export const env = schema.parse(process.env);
if (
  env.NODE_ENV === "production" &&
  /replace|change|example|local-development|test-secret/i.test(env.JWT_SECRET)
) {
  throw new Error("Set a random JWT_SECRET for production");
}
