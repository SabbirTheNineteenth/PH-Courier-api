import { defineConfig } from "vitest/config";
import dotenv from "dotenv";
import { readFileSync, existsSync } from "node:fs";
const local = existsSync(".env") ? dotenv.parse(readFileSync(".env")) : {};
const url = process.env.TEST_DATABASE_URL || local.DATABASE_URL?.replace(/\/courier(\?.*)?$/, "/courier_test$1");
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("Tests require a dedicated database with a name ending in _test");
export default defineConfig({ test: { fileParallelism: false, testTimeout: 30000, hookTimeout: 30000, env: {
  NODE_ENV: "test", DATABASE_URL: url,
  JWT_SECRET: "test-secret-only-never-use-this-in-production-2026",
  STRIPE_SECRET_KEY: "sk_test_local_automated_tests_only",
  STRIPE_WEBHOOK_SECRET: "whsec_local_test_signature_secret",
  GOOGLE_CLIENT_ID: "automated-tests.apps.googleusercontent.com",
} } });
