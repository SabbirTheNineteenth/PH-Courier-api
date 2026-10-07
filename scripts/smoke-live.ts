import "dotenv/config";
import { z } from "zod";

const input = z
  .object({ LIVE_API_URL: z.url(), ADMIN_EMAIL: z.email(), ADMIN_PASSWORD: z.string().min(16) })
  .parse(process.env);
const base = input.LIVE_API_URL.replace(/\/$/, "");
if (!base.startsWith("https://") || ["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("LIVE_API_URL must be a publicly deployed HTTPS origin");
async function call(path: string, options?: RequestInit) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return result;
}
await call("/ready");
console.log("PASS live database readiness");
const docs = await call("/api/v1/openapi.json");
if (docs.info.title !== "PH Courier & Logistics API")
  throw new Error("Unexpected application at LIVE_API_URL");
console.log("PASS live API documentation");
const login = await call("/api/v1/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: input.ADMIN_EMAIL, password: input.ADMIN_PASSWORD }),
});
if (login.data.user.role !== "ADMIN") throw new Error("Demo login is not an admin account");
await call("/api/v1/admin/statistics", {
  headers: { Authorization: `Bearer ${login.data.accessToken}` },
});
console.log("PASS live admin credentials and permissions");
const unauthenticated = await fetch(`${base}/api/v1/users/me`, {
  signal: AbortSignal.timeout(15000),
});
if (unauthenticated.status !== 401)
  throw new Error("Private profile was accessible without a token");
await call("/api/v1/auth/logout", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ refreshToken: login.data.refreshToken }),
});
console.log(
  "PASS live authentication protection. Complete the real Google login and Stripe Checkout walkthrough in docs/API.md to verify external integrations.",
);
