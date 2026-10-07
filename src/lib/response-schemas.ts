const nullableString = { type: "string", nullable: true };
const id = { type: "string", format: "uuid" };
const date = { type: "string", format: "date-time" };
export const resourceSchemas = {
  User: {
    type: "object",
    properties: {
      id,
      email: { type: "string", format: "email" },
      name: { type: "string" },
      phone: nullableString,
      role: { type: "string", enum: ["CUSTOMER", "COURIER", "ADMIN"] },
      isActive: { type: "boolean" },
      createdAt: date,
    },
  },
  Tokens: {
    type: "object",
    properties: {
      user: { $ref: "#/components/schemas/User" },
      accessToken: { type: "string" },
      refreshToken: { type: "string" },
      tokenType: { type: "string", enum: ["Bearer"] },
      expiresIn: { type: "integer", example: 900 },
    },
  },
  Address: {
    type: "object",
    properties: {
      id,
      userId: id,
      zoneId: id,
      label: { type: "string" },
      contactName: { type: "string" },
      contactPhone: { type: "string" },
      line: { type: "string" },
      deletedAt: { ...date, nullable: true },
    },
  },
  Zone: {
    type: "object",
    properties: {
      id,
      name: { type: "string" },
      basePrice: { type: "integer", description: "Integer paisa" },
      perKgPrice: { type: "integer" },
      deletedAt: { ...date, nullable: true },
    },
  },
  Hub: {
    type: "object",
    properties: {
      id,
      zoneId: id,
      name: { type: "string" },
      address: { type: "string" },
      deletedAt: { ...date, nullable: true },
    },
  },
  Shipment: {
    type: "object",
    properties: {
      id,
      trackingNumber: { type: "string", example: "PH-0123456789ABCDEF01234567" },
      customerId: id,
      courierId: { ...id, nullable: true },
      originZoneId: id,
      destinationZoneId: id,
      currentHubId: { ...id, nullable: true },
      pickupAddress: { $ref: "#/components/schemas/Address" },
      deliveryAddress: { $ref: "#/components/schemas/Address" },
      parcelDescription: { type: "string" },
      weightGrams: { type: "integer" },
      price: { type: "integer", description: "Integer paisa" },
      currency: { type: "string", enum: ["bdt"] },
      status: {
        type: "string",
        enum: [
          "CREATED",
          "ASSIGNED",
          "PICKED_UP",
          "AT_ORIGIN_HUB",
          "IN_TRANSIT",
          "AT_DESTINATION_HUB",
          "OUT_FOR_DELIVERY",
          "DELIVERED",
          "FAILED_DELIVERY",
          "RETURNING",
          "RETURNED",
          "CANCELLED",
        ],
      },
      version: { type: "integer" },
      deliveryAttempts: { type: "integer" },
      pickupDate: date,
      deliveredAt: { ...date, nullable: true },
      createdAt: date,
      events: { type: "array", items: { $ref: "#/components/schemas/ShipmentEvent" } },
    },
  },
  ShipmentEvent: {
    type: "object",
    properties: {
      id,
      shipmentId: id,
      actorId: id,
      status: { type: "string" },
      note: nullableString,
      hubId: { ...id, nullable: true },
      createdAt: date,
    },
  },
  Payment: {
    type: "object",
    properties: {
      id,
      shipmentId: id,
      amount: { type: "integer" },
      currency: { type: "string", enum: ["bdt"] },
      status: {
        type: "string",
        enum: ["PENDING", "PAID", "CANCELLED", "REFUND_PENDING", "REFUNDED"],
      },
      attempt: { type: "integer" },
      providerSessionId: nullableString,
      checkoutUrl: nullableString,
      paidAt: { ...date, nullable: true },
      providerRefundId: nullableString,
      refundAttempt: { type: "integer" },
      refundFailure: nullableString,
      refundedAt: { ...date, nullable: true },
    },
  },
  AuditLog: {
    type: "object",
    properties: {
      id,
      actorId: { ...id, nullable: true },
      action: { type: "string" },
      resourceType: { type: "string" },
      resourceId: { type: "string" },
      details: { type: "object", nullable: true },
      createdAt: date,
    },
  },
  Pagination: {
    type: "object",
    properties: {
      page: { type: "integer" },
      limit: { type: "integer" },
      total: { type: "integer" },
      totalPages: { type: "integer" },
    },
  },
};
export function responseData(method: string, path: string): Record<string, unknown> {
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const list = (name: string) => ({
    type: "object",
    properties: { items: { type: "array", items: ref(name) }, meta: ref("Pagination") },
  });
  if (method === "delete" || path.endsWith("/logout")) return { nullable: true, example: null };
  if (/\/auth\/(register|login|google|refresh-token)$/.test(path)) return ref("Tokens");
  if (
    path.includes("/users/me") ||
    path.includes("/google/link") ||
    /\/admin\/users\/:id$/.test(path)
  )
    return ref("User");
  if (path.endsWith("/admin/users")) return list("User");
  if (path.endsWith("/admin/couriers")) return ref("User");
  if (path.endsWith("/couriers")) return list("User");
  if (path.endsWith("/audit-logs")) return list("AuditLog");
  if (path.includes("/addresses"))
    return method === "get" && path.endsWith("addresses")
      ? { type: "array", items: ref("Address") }
      : ref("Address");
  if (path.includes("/zones"))
    return method === "get" && path.endsWith("zones")
      ? { type: "array", items: ref("Zone") }
      : ref("Zone");
  if (path.includes("/hubs"))
    return method === "get" && path.endsWith("hubs") ? list("Hub") : ref("Hub");
  if (path.endsWith("/quote"))
    return {
      type: "object",
      properties: {
        price: { type: "integer" },
        currency: { type: "string" },
        kilograms: { type: "integer" },
        weightGrams: { type: "integer" },
      },
    };
  if (path.includes("/track/"))
    return {
      type: "object",
      properties: {
        trackingNumber: { type: "string" },
        status: { type: "string" },
        createdAt: date,
        deliveredAt: { ...date, nullable: true },
        events: {
          type: "array",
          items: { type: "object", properties: { status: { type: "string" }, createdAt: date } },
        },
      },
    };
  if (path.includes("/shipments"))
    return method === "get" && path.endsWith("shipments") ? list("Shipment") : ref("Shipment");
  if (path.includes("/payments") && !/\/(success|cancel)$/.test(path)) return ref("Payment");
  return {
    type: "object",
    description: "See docs/API.md for the operating summary or next-step notice.",
  };
}
