import { readFileSync } from "node:fs";
import SwaggerParser from "@apidevtools/swagger-parser";
import { describe, expect, it } from "vitest";
import "../src/app.js";
import { openApi } from "../src/lib/openapi.js";
import { apiSpecs } from "../src/lib/routes.js";

describe("API documentation", () => {
  it("validates a complete OpenAPI 3 document and resolves resource references", async () => {
    const document = JSON.parse(JSON.stringify(openApi()));
    const validated = await SwaggerParser.validate(document);
    expect(validated.info.title).toBe("PH Courier & Logistics API");
  });
  it("exports Postman requests for every application route", () => {
    const collection = JSON.parse(readFileSync("docs/courier.postman_collection.json", "utf8"));
    const requests = collection.item.flatMap(
      (folder: { item: { request: { method: string; url: string } }[] }) => folder.item,
    );
    expect(requests.length).toBeGreaterThanOrEqual(apiSpecs.length + 1);
    for (const endpoint of apiSpecs) {
      const prefix = endpoint.path.split("/:")[0];
      expect(
        requests.some(
          (entry: { request: { method: string; url: string } }) =>
            entry.request.method === endpoint.method.toUpperCase() &&
            entry.request.url.startsWith(`{{baseUrl}}${prefix}`),
        ),
        endpoint.path,
      ).toBe(true);
    }
    expect(collection.info.schema).toContain("v2.1.0");
  });
  it("provides request templates that satisfy the same runtime body schemas", () => {
    const collection = JSON.parse(readFileSync("docs/courier.postman_collection.json", "utf8"));
    const requests = collection.item.flatMap(
      (folder: { item: { request: { method: string; url: string; body?: { raw: string } } }[] }) =>
        folder.item,
    );
    for (const spec of apiSpecs.filter((endpoint) => endpoint.spec.body)) {
      const entry = requests.find(
        (item: { request: { method: string; url: string } }) =>
          item.request.method === spec.method.toUpperCase() &&
          item.request.url.split("?")[0] ===
            `{{baseUrl}}${spec.path.replace(":id", spec.path.includes("/admin/") ? "{{targetUserId}}" : spec.path.includes("/shipments") ? "{{shipmentId}}" : spec.path.includes("/payments") ? "{{paymentId}}" : spec.path.includes("/addresses") ? "{{addressId}}" : spec.path.includes("/zones") ? "{{originZoneId}}" : "{{originHubId}}")}`,
      );
      expect(entry, spec.path).toBeDefined();
      const raw = entry.request.body.raw.replace(
        /\{\{(\w+)\}\}/g,
        (_match: string, name: string) => {
          if (name.endsWith("Email")) return "demo@example.com";
          if (name.endsWith("Password")) return "CustomerDemo!2026";
          if (name === "googleIdToken") return "test-identity-token-at-least-twenty-characters";
          if (name === "refreshToken") return "f".repeat(96);
          if (name === "pickupDate") return new Date(Date.now() + 86400000).toISOString();
          if (name === "shipmentVersion") return "0";
          return "00000000-0000-4000-8000-000000000001";
        },
      );
      const parsed = JSON.parse(raw);
      expect(spec.spec.body?.safeParse(parsed).success, `${spec.method} ${spec.path}: ${raw}`).toBe(
        true,
      );
      if (spec.path.endsWith("/status")) expect(parsed.hubId).toBeUndefined();
    }
  });
});
