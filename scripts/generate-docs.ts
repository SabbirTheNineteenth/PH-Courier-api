import { mkdirSync, writeFileSync } from "node:fs";
import "../src/app.js";
import { apiSpecs, jsonSchema } from "../src/lib/routes.js";
import { openApi } from "../src/lib/openapi.js";
mkdirSync("docs", { recursive: true });
writeFileSync("docs/openapi.json", `${JSON.stringify(openApi(), null, 2)}\n`);
const values: Record<string, unknown> = {
  name: "Demo Customer", email: "{{customerEmail}}", password: "{{customerPassword}}", phone: "01712345678", idToken: "{{googleIdToken}}", refreshToken: "{{refreshToken}}",
  label: "Home", contactName: "Demo Receiver", contactPhone: "01712345678", line: "House 10, Road 3, Dhaka", zoneId: "{{originZoneId}}", basePrice: 6000, perKgPrice: 2000,
  pickupAddressId: "{{pickupAddressId}}", deliveryAddressId: "{{deliveryAddressId}}", originZoneId: "{{originZoneId}}", destinationZoneId: "{{destinationZoneId}}", weightGrams: 1200,
  parcelDescription: "Books and documents", pickupDate: "{{pickupDate}}", expectedVersion: "{{shipmentVersion}}", courierId: "{{courierId}}", shipmentId: "{{shipmentId}}", reason: "Customer requested cancellation", note: "Received by named recipient", hubId: "{{originHubId}}", status: "PICKED_UP", role: "COURIER", isActive: true,
};
function sample(schema: Record<string, unknown>, field = ""): unknown {
  if (field in values) return values[field];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (schema.properties) return Object.fromEntries(Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(([key, value]) => [key, sample(value, key)]));
  if (schema.type === "integer" || schema.type === "number") return 1;
  if (schema.type === "boolean") return true;
  return "example";
}
const folders = new Map<string, { name: string; item: unknown[] }>();
for (const { method, path, spec } of apiSpecs) {
  const group = path.split("/")[3] || "api";
  if (!folders.has(group)) folders.set(group, { name: group, item: [] });
  let url = `{{baseUrl}}${path}`;
  const idVariable = group === "admin" ? "targetUserId" : group === "shipments" ? "shipmentId" : group === "payments" ? "paymentId" : group === "addresses" ? "addressId" : group === "zones" ? "originZoneId" : "originHubId";
  url = url.replace(":id", `{{${idVariable}}}`).replace(":trackingNumber", "{{trackingNumber}}");
  if (spec.query) {
    const schema = jsonSchema(spec.query);
    const query = Object.entries(schema.properties as Record<string, Record<string, unknown>>).filter(([, value]) => value.default !== undefined).map(([key, value]) => `${key}=${value.default}`).join("&");
    if (query) url += `?${query}`;
  }
  const role = spec.roles?.includes("CUSTOMER") ? "customer" : spec.roles?.includes("COURIER") ? "courier" : "admin";
  let payload = spec.body ? sample(jsonSchema(spec.body)) as Record<string, unknown> : null;
  if (group === "admin" && path.endsWith("/couriers")) payload = { name: "Demo Courier", email: "{{courierEmail}}", password: "{{courierPassword}}" };
  const save: string[] = [];
  if (/\/auth\/(register|login|google|refresh-token)$/.test(path)) save.push('if (data.accessToken) pm.environment.set("customerToken", data.accessToken);', 'if (data.refreshToken) pm.environment.set("refreshToken", data.refreshToken);');
  if (group === "zones" && method === "get") save.push('if (data[0]) pm.environment.set("originZoneId", data[0].id); if (data[1]) pm.environment.set("destinationZoneId", data[1].id);');
  if (group === "hubs" && method === "get") save.push('if (data.items[0]) pm.environment.set("originHubId", data.items[0].id);');
  if (path.endsWith("/addresses") && method === "post") save.push('pm.environment.set("addressId", data.id); if (!pm.environment.get("pickupAddressId")) pm.environment.set("pickupAddressId", data.id); else pm.environment.set("deliveryAddressId", data.id);');
  if (group === "shipments" && !path.includes("/track/") && !path.endsWith("/quote") && method !== "delete") save.push('if (data.id) { pm.environment.set("shipmentId", data.id); pm.environment.set("trackingNumber", data.trackingNumber); pm.environment.set("shipmentVersion", data.version); }');
  if (path.endsWith("/payments/initiate")) save.push('pm.environment.set("paymentId", data.id); if (data.checkoutUrl) pm.environment.set("checkoutUrl", data.checkoutUrl);');
  if (path.endsWith("/admin/couriers") && method === "post") save.push('pm.environment.set("courierId", data.id);');
  const tests = [`pm.test("Expected status", () => pm.response.to.have.status(${spec.status || 200}));`, 'const result = pm.response.json(); pm.test("Structured success", () => pm.expect(result.success).to.eql(true));', 'if (result.success) { const data = result.data;', ...save, '}'];
  folders.get(group)?.item.push({ name: `${method.toUpperCase()} ${spec.summary}`, request: { method: method.toUpperCase(), url, description: `${spec.summary}. ${spec.roles ? `Roles: ${spec.roles.join(", ")}.` : "Public."} Consult docs/API.md for business rules and workflow ordering.`, auth: spec.roles ? { type: "bearer", bearer: [{ key: "token", value: `{{${role}Token}}`, type: "string" }] } : { type: "noauth" }, header: [{ key: "Content-Type", value: "application/json" }], ...(payload ? { body: { mode: "raw", raw: JSON.stringify(payload, null, 2).replace('"{{shipmentVersion}}"', '{{shipmentVersion}}'), options: { raw: { language: "json" } } } } : {}) }, event: [{ listen: "test", script: { type: "text/javascript", exec: tests } }] });
}
for (const role of ["admin", "courier"] as const) folders.get("auth")?.item.push({ name: `Sign in as ${role}`, request: { method: "POST", url: "{{baseUrl}}/api/v1/auth/login", auth: { type: "noauth" }, header: [{ key: "Content-Type", value: "application/json" }], body: { mode: "raw", raw: JSON.stringify({ email: `{{${role}Email}}`, password: `{{${role}Password}}` }, null, 2) } }, event: [{ listen: "test", script: { type: "text/javascript", exec: ['pm.test("Signed in", () => pm.response.to.have.status(200));', `const result = pm.response.json(); if (result.success) pm.environment.set("${role}Token", result.data.accessToken);`] } }] });
folders.get("payments")?.item.push({ name: "Stripe webhook (use Stripe CLI; signatures cannot be invented)", request: { method: "POST", url: "{{baseUrl}}/api/v1/payments/webhook", auth: { type: "noauth" }, header: [{ key: "Content-Type", value: "application/json" }, { key: "stripe-signature", value: "{{stripeSignature}}" }], body: { mode: "raw", raw: "{}" }, description: "Use Stripe CLI or Stripe dashboard to send the exact signed raw event. This placeholder is expected to fail signature validation." } });
const collection = { info: { name: "PH Courier & Logistics API", description: "Complete endpoint reference for 3 roles. Run requests in the workflow order in docs/API.md. This collection is for interactive testing; payment completion requires a real Stripe Checkout session. No fake payment endpoint exists.", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, event: [{ listen: "prerequest", script: { type: "text/javascript", exec: ['pm.environment.set("pickupDate", new Date(Date.now() + 86400000).toISOString());'] } }], item: [...folders.values()] };
writeFileSync("docs/courier.postman_collection.json", `${JSON.stringify(collection, null, 2)}\n`);
const variables = { baseUrl: "http://localhost:4000", customerEmail: "customer@example.com", customerPassword: "CustomerDemo!2026", courierEmail: "courier@example.com", courierPassword: "CourierDemo!2026", adminEmail: "admin@courier.example", adminPassword: "", customerToken: "", courierToken: "", adminToken: "", refreshToken: "", googleIdToken: "", stripeSignature: "", originZoneId: "", destinationZoneId: "", originHubId: "", destinationHubId: "", pickupAddressId: "", deliveryAddressId: "", addressId: "", courierId: "", targetUserId: "", shipmentId: "", shipmentVersion: "0", trackingNumber: "", paymentId: "", checkoutUrl: "" };
writeFileSync("docs/courier.postman_environment.json", `${JSON.stringify({ name: "Courier local (fill private credentials)", values: Object.entries(variables).map(([key, value]) => ({ key, value, enabled: true, type: /password|token|signature/i.test(key) ? "secret" : "default" })) }, null, 2)}\n`);
const inventory = apiSpecs.map(({ method, path, spec }) => `| ${method.toUpperCase()} | \`${path}\` | ${spec.roles?.join(", ") || "Public"} | ${spec.summary} |`);
writeFileSync("docs/ENDPOINTS.md", `# API endpoint inventory\n\n${apiSpecs.length + 1} application endpoints, including the signed Stripe webhook. Health, readiness, and documentation routes are additional operational endpoints.\n\n| Method | Route | Roles | Purpose |\n|---|---|---|---|\n${inventory.join("\n")}\n| POST | \`/api/v1/payments/webhook\` | Stripe signature | Receive and verify payment/refund events |\n`);
console.log(`Generated OpenAPI, Postman collection/environment and inventory for ${apiSpecs.length + 1} application endpoints.`);
