import { resourceSchemas, responseData } from "./response-schemas.js";
import { apiSpecs, jsonSchema } from "./routes.js";

const errorRef = { $ref: "#/components/responses/Error" };
const successResponse = {
  description: "Operation successful",
  content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } },
};
export function openApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const { method, path, spec } of apiSpecs) {
    const pathname = path.replace(/:([A-Za-z]+)/g, "{$1}");
    const parameters: Record<string, unknown>[] = [];
    for (const [location, schema] of [
      ["path", spec.params],
      ["query", spec.query],
    ] as const) {
      if (!schema) continue;
      const object = jsonSchema(schema);
      const properties = (object.properties || {}) as Record<string, Record<string, unknown>>;
      for (const [name, value] of Object.entries(properties)) {
        const entry = { ...value };
        if (!entry.type && typeof entry.default === "number") entry.type = "integer";
        parameters.push({
          name,
          in: location,
          required:
            location === "path" ||
            (Array.isArray(object.required) && object.required.includes(name)),
          schema: entry,
        });
      }
    }
    paths[pathname] ??= {};
    paths[pathname][method] = {
      tags: [path.split("/")[3]],
      summary: spec.summary,
      description: [
        spec.description,
        spec.roles ? `Allowed roles: ${spec.roles.join(", ")}.` : "Public endpoint.",
      ]
        .filter(Boolean)
        .join(" "),
      security: spec.roles ? [{ bearerAuth: [] }] : [],
      parameters,
      ...(spec.body
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: jsonSchema(spec.body),
                  ...(spec.example ? { example: spec.example } : {}),
                },
              },
            },
          }
        : {}),
      responses: {
        [String(spec.status || 200)]: {
          description: "Operation successful",
          content: {
            "application/json": {
              schema: {
                allOf: [
                  { $ref: "#/components/schemas/Success" },
                  { type: "object", properties: { data: responseData(method, path) } },
                ],
              },
            },
          },
        },
        "400": errorRef,
        "401": errorRef,
        "403": errorRef,
        "404": errorRef,
        "409": errorRef,
        "429": errorRef,
        "503": errorRef,
      },
    };
  }
  paths["/api/v1/payments/webhook"] = {
    post: {
      tags: ["payments"],
      summary: "Receive signed Stripe events (raw body required)",
      security: [],
      parameters: [
        { name: "stripe-signature", in: "header", required: true, schema: { type: "string" } },
      ],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object" } } },
      },
      responses: { "200": successResponse, "400": errorRef, "503": errorRef },
    },
  };
  const errorSchema = {
    type: "object",
    required: ["success", "message", "errors"],
    properties: {
      success: { type: "boolean", enum: [false] },
      message: { type: "string" },
      errors: {
        type: "array",
        items: {
          type: "object",
          properties: { path: { type: "string" }, message: { type: "string" } },
        },
      },
    },
  };
  const successSchema = {
    type: "object",
    required: ["success", "message", "data"],
    properties: {
      success: { type: "boolean", enum: [true] },
      message: { type: "string" },
      data: {
        nullable: true,
        description:
          "Resource, token set, or {items, meta} list result; see endpoint examples in docs/API.md.",
      },
    },
  };
  return {
    openapi: "3.0.3",
    info: {
      title: "PH Courier & Logistics API",
      version: "1.0.0",
      description:
        "Backend-only courier platform. Money uses integer paisa (100 paisa = 1 BDT). CUSTOMER, COURIER, ADMIN roles. Stripe is the only payment source. Reload shipment versions after HTTP 409.",
    },
    servers: [{ url: "http://localhost:4000", description: "Replace with deployed API origin" }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: { Success: successSchema, Error: errorSchema, ...resourceSchemas },
      responses: {
        Error: {
          description: "Structured API error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
              example: {
                success: false,
                message: "Validation failed",
                errors: [{ path: "email", message: "Invalid email address" }],
              },
            },
          },
        },
      },
    },
  };
}
