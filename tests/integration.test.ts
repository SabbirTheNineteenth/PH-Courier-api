import argon2 from "argon2";
import { OAuth2Client } from "google-auth-library";
import type Stripe from "stripe";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { db } from "../src/lib/db.js";
import { getStripe } from "../src/lib/stripe.js";

const app = createApp();
const stripe = getStripe();
const sessions = new Map<string, Stripe.Checkout.Session>();
const refunds = new Map<string, Stripe.Refund>();
let failNextRefund = false;
let created = 0;
let customer = "";
let other = "";
let admin = "";
let courier = "";
let courier2 = "";
let customerId = "";
let courierId = "";
let courier2Id = "";
let adminId = "";
let zoneId = "";
let zone2Id = "";
let hubId = "";
let hub2Id = "";
let pickupId = "";
let deliveryId = "";
let shipmentId = "";
let paymentId = "";
let tracking = "";
let version = 0;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
async function register(email: string) {
  const response = await request(app)
    .post("/api/v1/auth/register")
    .send({ email, password: "CustomerDemo!2026", name: "Test Customer" });
  expect(response.status).toBe(201);
  return response.body.data;
}
async function createParcel() {
  const response = await request(app)
    .post("/api/v1/shipments")
    .set(auth(customer))
    .send({
      pickupAddressId: pickupId,
      deliveryAddressId: deliveryId,
      weightGrams: 1200,
      parcelDescription: "Books and documents",
      pickupDate: new Date(Date.now() + 86400000).toISOString(),
    });
  expect(response.status).toBe(201);
  return response.body.data;
}
async function signed(eventId: string, type: string, object: unknown) {
  const payload = JSON.stringify({ id: eventId, object: "event", type, data: { object } });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: env.STRIPE_WEBHOOK_SECRET || "",
  });
  return request(app)
    .post("/api/v1/payments/webhook")
    .set("Content-Type", "application/json")
    .set("stripe-signature", signature)
    .send(payload);
}
async function pay(id: string) {
  const response = await request(app)
    .post("/api/v1/payments/initiate")
    .set(auth(customer))
    .send({ shipmentId: id });
  expect(response.status).toBe(200);
  const payment = response.body.data;
  const session = sessions.get(payment.providerSessionId);
  if (!session) throw new Error("Missing test session");
  session.status = "complete";
  session.payment_status = "paid";
  const event = await signed(`evt_paid_${payment.id}`, "checkout.session.completed", session);
  expect(event.status).toBe(200);
  return payment;
}
beforeAll(async () => {
  if (env.NODE_ENV !== "test" || !new URL(env.DATABASE_URL).pathname.endsWith("_test"))
    throw new Error("Refusing to clear a non-test database");
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "WebhookEvent", "AuditLog", "ShipmentEvent", "Payment", "Shipment", "Address", "Hub", "Zone", "RefreshToken", "User" CASCADE',
  );
  vi.spyOn(stripe.checkout.sessions, "create").mockImplementation(async (...args: unknown[]) => {
    const params = args[0] as Stripe.Checkout.SessionCreateParams;
    const options = args[1] as Stripe.RequestOptions;
    const existing = [...sessions.values()].find(
      (s) => s.metadata?.idempotency === options?.idempotencyKey,
    );
    if (existing) return existing as never;
    const session = {
      id: `cs_test_${++created}`,
      url: `https://checkout.stripe.com/test/${created}`,
      status: "open",
      payment_status: "unpaid",
      amount_total: params?.line_items?.[0]?.price_data?.unit_amount,
      currency: params?.line_items?.[0]?.price_data?.currency,
      client_reference_id: params?.client_reference_id,
      payment_intent: `pi_test_${created}`,
      metadata: { ...params?.metadata, idempotency: options?.idempotencyKey },
    } as unknown as Stripe.Checkout.Session;
    sessions.set(session.id, session);
    return session as never;
  });
  vi.spyOn(stripe.checkout.sessions, "retrieve").mockImplementation(async (id) => {
    const session = sessions.get(id);
    if (!session) throw new Error("Session missing");
    return session as never;
  });
  vi.spyOn(stripe.checkout.sessions, "expire").mockImplementation(async (id) => {
    const session = sessions.get(id);
    if (!session) throw new Error("Session missing");
    session.status = "expired";
    return session as never;
  });
  vi.spyOn(stripe.refunds, "create").mockImplementation(async (...args: unknown[]) => {
    const params = args[0] as Stripe.RefundCreateParams;
    const metadata = (params.metadata || {}) as Record<string, string>;
    const id = `re_${metadata.paymentId}_${metadata.refundAttempt}`;
    const existing = refunds.get(id);
    if (existing) return existing as never;
    const refund = {
      id,
      status: failNextRefund ? "failed" : "succeeded",
      failure_reason: failNextRefund ? "declined" : null,
      amount: params.amount,
      currency: "bdt",
      metadata: params.metadata,
    } as unknown as Stripe.Refund;
    failNextRefund = false;
    refunds.set(id, refund);
    return refund as never;
  });
  vi.spyOn(stripe.refunds, "retrieve").mockImplementation(async (id) => {
    const refund = refunds.get(id);
    if (!refund) throw new Error("Missing refund");
    return refund as never;
  });
  const first = await register("customer@test.example");
  customer = first.accessToken;
  customerId = first.user.id;
  other = (await register("other@test.example")).accessToken;
  const passwordHash = await argon2.hash("AdminDemo!2026", { type: argon2.argon2id });
  const user = await db.user.create({
    data: { email: "admin@test.example", name: "Admin", passwordHash, role: "ADMIN" },
  });
  adminId = user.id;
  const logged = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: user.email, password: "AdminDemo!2026" });
  admin = logged.body.data.accessToken;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await db.$disconnect();
});
describe.sequential("real PostgreSQL API acceptance", () => {
  it("returns consistent validation errors and prevents choosing a privileged role", async () => {
    const invalid = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "bad", password: "short", name: "x" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.success).toBe(false);
    expect(invalid.body.errors.length).toBeGreaterThan(0);
    const escalation = await request(app).post("/api/v1/auth/register").send({
      email: "escape@test.example",
      name: "Bad Role",
      password: "CustomerDemo!2026",
      role: "ADMIN",
    });
    expect(escalation.status).toBe(400);
  });
  it("enforces bearer tokens role restrictions malformed IDs and security headers", async () => {
    expect((await request(app).get("/api/v1/users/me")).status).toBe(401);
    expect((await request(app).get("/api/v1/admin/users").set(auth(customer))).status).toBe(403);
    expect(
      (await request(app).get("/api/v1/shipments/not-a-uuid").set(auth(customer))).status,
    ).toBe(400);
    const health = await request(app).get("/health");
    expect(health.headers["x-content-type-options"]).toBe("nosniff");
    expect(
      (await request(app).get("/health").set("Origin", "https://untrusted.example")).status,
    ).toBe(403);
    expect((await request(app).get("/missing")).status).toBe(404);
  });
  it("rotates refresh tokens only once under concurrent requests and revokes logout", async () => {
    const data = await register("rotate@test.example");
    const responses = await Promise.all([
      request(app).post("/api/v1/auth/refresh-token").send({ refreshToken: data.refreshToken }),
      request(app).post("/api/v1/auth/refresh-token").send({ refreshToken: data.refreshToken }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
    const fresh = responses.find((r) => r.status === 200)?.body.data.refreshToken;
    expect(
      (await request(app).post("/api/v1/auth/logout").send({ refreshToken: fresh })).status,
    ).toBe(200);
    expect(
      (await request(app).post("/api/v1/auth/refresh-token").send({ refreshToken: fresh })).status,
    ).toBe(401);
  });
  it("creates zones hubs and two couriers through admin APIs", async () => {
    for (const [name, index] of [
      ["Dhaka", 1],
      ["Sylhet", 2],
    ] as const) {
      const zone = await request(app)
        .post("/api/v1/zones")
        .set(auth(admin))
        .send({ name, basePrice: 6000, perKgPrice: 2000 });
      expect(zone.status).toBe(201);
      const hub = await request(app)
        .post("/api/v1/hubs")
        .set(auth(admin))
        .send({ name: `${name} Hub`, address: `${name} Central Road`, zoneId: zone.body.data.id });
      expect(hub.status).toBe(201);
      if (index === 1) {
        zoneId = zone.body.data.id;
        hubId = hub.body.data.id;
      } else {
        zone2Id = zone.body.data.id;
        hub2Id = hub.body.data.id;
      }
    }
    for (const [email, index] of [
      ["courier@test.example", 1],
      ["courier2@test.example", 2],
    ] as const) {
      const response = await request(app)
        .post("/api/v1/admin/couriers")
        .set(auth(admin))
        .send({ email, name: "Test Courier", password: "CourierDemo!2026" });
      expect(response.status).toBe(201);
      const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email, password: "CourierDemo!2026" });
      if (index === 1) {
        courierId = response.body.data.id;
        courier = login.body.data.accessToken;
      } else {
        courier2Id = response.body.data.id;
        courier2 = login.body.data.accessToken;
      }
    }
  });
  it("manages customer addresses and prevents cross-customer edits", async () => {
    for (const [zone, index] of [
      [zoneId, 1],
      [zone2Id, 2],
    ] as const) {
      const response = await request(app).post("/api/v1/addresses").set(auth(customer)).send({
        label: "Home",
        contactName: "Receiver",
        contactPhone: "01712345678",
        line: "House 10, Road 3",
        zoneId: zone,
      });
      expect(response.status).toBe(201);
      if (index === 1) pickupId = response.body.data.id;
      else deliveryId = response.body.data.id;
    }
    expect(
      (
        await request(app)
          .patch(`/api/v1/addresses/${pickupId}`)
          .set(auth(other))
          .send({ line: "Attacker address" })
      ).status,
    ).toBe(404);
  });
  it("creates priced shipments and hides personal data from public tracking", async () => {
    const shipment = await createParcel();
    shipmentId = shipment.id;
    tracking = shipment.trackingNumber;
    expect(shipment.price).toBe(16000);
    expect(shipment.version).toBe(0);
    const publicData = await request(app).get(`/api/v1/shipments/track/${tracking}`);
    expect(publicData.status).toBe(200);
    expect(publicData.body.data.pickupAddress).toBeUndefined();
    expect(
      (await request(app).get(`/api/v1/shipments/${shipmentId}`).set(auth(other))).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/v1/shipments/${shipmentId}`).set(auth(courier))).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/v1/shipments/${shipmentId}/assign`)
          .set(auth(admin))
          .send({ courierId, expectedVersion: 0 })
      ).status,
    ).toBe(409);
  });
  it("rejects spoofed signatures and never treats browser redirects as payment", async () => {
    expect((await request(app).get("/api/v1/payments/success")).status).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/v1/payments/webhook")
          .set("stripe-signature", "invalid")
          .send({ id: "bad" })
      ).status,
    ).toBe(400);
  });
  it("reuses checkout sessions under concurrency and verifies signed events exactly once", async () => {
    const responses = await Promise.all([
      request(app).post("/api/v1/payments/initiate").set(auth(customer)).send({ shipmentId }),
      request(app).post("/api/v1/payments/initiate").set(auth(customer)).send({ shipmentId }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses[0]?.body.data.providerSessionId).toBe(
      responses[1]?.body.data.providerSessionId,
    );
    paymentId = responses[0]?.body.data.id;
    expect(
      (
        await request(app)
          .post(`/api/v1/shipments/${shipmentId}/cancel`)
          .set(auth(customer))
          .send({ reason: "Changed my mind", expectedVersion: 0 })
      ).status,
    ).toBe(409);
    const session = sessions.get(responses[0]?.body.data.providerSessionId);
    if (!session) throw new Error("Missing session");
    const wrong = await signed("evt_wrong_amount", "checkout.session.completed", {
      ...session,
      payment_status: "paid",
      amount_total: 1,
    });
    expect(wrong.status).toBe(400);
    expect(await db.webhookEvent.findUnique({ where: { id: "evt_wrong_amount" } })).toBeNull();
    session.payment_status = "paid";
    session.status = "complete";
    const events = await Promise.all([
      signed("evt_main_paid", "checkout.session.completed", session),
      signed("evt_main_paid", "checkout.session.completed", session),
    ]);
    expect(events.map((r) => r.status)).toEqual([200, 200]);
    expect(events.filter((r) => r.body.data.duplicate)).toHaveLength(1);
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("PAID");
    expect((await request(app).get(`/api/v1/payments/${paymentId}`).set(auth(other))).status).toBe(
      404,
    );
  });
  it("allows only one courier assignment for a given shipment version", async () => {
    const responses = await Promise.all([
      request(app)
        .post(`/api/v1/shipments/${shipmentId}/assign`)
        .set(auth(admin))
        .send({ courierId, expectedVersion: 0 }),
      request(app)
        .post(`/api/v1/shipments/${shipmentId}/assign`)
        .set(auth(admin))
        .send({ courierId: courier2Id, expectedVersion: 0 }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const current = await db.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    version = current.version;
    if (current.courierId === courier2Id) {
      [courier, courier2] = [courier2, courier];
      [courierId, courier2Id] = [courier2Id, courierId];
    }
    expect(
      (
        await request(app)
          .patch(`/api/v1/shipments/${shipmentId}/status`)
          .set(auth(courier2))
          .send({ status: "PICKED_UP", expectedVersion: version })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/v1/admin/users/${courierId}`)
          .set(auth(admin))
          .send({ isActive: false })
      ).status,
    ).toBe(409);
  });
  it("enforces valid shipment progression and correct origin/destination hubs", async () => {
    expect(
      (
        await request(app)
          .patch(`/api/v1/shipments/${shipmentId}/status`)
          .set(auth(courier))
          .send({ status: "DELIVERED", expectedVersion: version, note: "Received" })
      ).status,
    ).toBe(409);
    for (const state of [
      "PICKED_UP",
      "AT_ORIGIN_HUB",
      "IN_TRANSIT",
      "AT_DESTINATION_HUB",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ] as const) {
      if (state === "AT_ORIGIN_HUB")
        expect(
          (
            await request(app)
              .patch(`/api/v1/shipments/${shipmentId}/status`)
              .set(auth(courier))
              .send({ status: state, expectedVersion: version, hubId: hub2Id })
          ).status,
        ).toBe(409);
      const response = await request(app)
        .patch(`/api/v1/shipments/${shipmentId}/status`)
        .set(auth(courier))
        .send({
          status: state,
          expectedVersion: version,
          ...(state === "AT_ORIGIN_HUB"
            ? { hubId }
            : state === "AT_DESTINATION_HUB"
              ? { hubId: hub2Id }
              : {}),
          ...(state === "DELIVERED" ? { note: "Received by named recipient" } : {}),
        });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      version = response.body.data.version;
    }
    expect(
      (
        await request(app)
          .post(`/api/v1/payments/${paymentId}/refund`)
          .set(auth(admin))
          .send({ reason: "Too late" })
      ).status,
    ).toBe(409);
  });
  it("supports filtered paginated lists and audit evidence without exposing password hashes", async () => {
    const list = await request(app)
      .get("/api/v1/shipments?status=DELIVERED&page=1&limit=1&search=Books")
      .set(auth(customer));
    expect(list.body.data.meta.total).toBe(1);
    const users = await request(app).get("/api/v1/admin/users?role=COURIER").set(auth(admin));
    expect(JSON.stringify(users.body)).not.toContain("passwordHash");
    const audits = await request(app)
      .get(`/api/v1/admin/audit-logs?resourceId=${shipmentId}`)
      .set(auth(admin));
    expect(audits.body.data.meta.total).toBeGreaterThanOrEqual(8);
    expect(
      (
        await request(app)
          .patch(`/api/v1/admin/users/${adminId}`)
          .set(auth(admin))
          .send({ role: "CUSTOMER" })
      ).status,
    ).toBe(409);
    expect(
      (await request(app).get("/api/v1/admin/statistics").set(auth(admin))).body.data.paidRevenue,
    ).toBe(16000);
  });
  it("archives terminal shipments without destroying tracking history", async () => {
    expect(
      (await request(app).delete(`/api/v1/shipments/${shipmentId}`).set(auth(customer))).status,
    ).toBe(200);
    expect(
      (await request(app).get(`/api/v1/shipments/${shipmentId}`).set(auth(customer))).status,
    ).toBe(404);
    expect(
      (await db.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).deletedAt,
    ).not.toBeNull();
    expect(await db.shipmentEvent.count({ where: { shipmentId } })).toBeGreaterThan(0);
  });
  it("expires unpaid checkout before cancellation and supports a new payment attempt", async () => {
    const shipment = await createParcel();
    const first = await request(app)
      .post("/api/v1/payments/initiate")
      .set(auth(customer))
      .send({ shipmentId: shipment.id });
    expect(
      (await request(app).post(`/api/v1/payments/${first.body.data.id}/expire`).set(auth(customer)))
        .status,
    ).toBe(200);
    const second = await request(app)
      .post("/api/v1/payments/initiate")
      .set(auth(customer))
      .send({ shipmentId: shipment.id });
    expect(second.status).toBe(200);
    expect(second.body.data.attempt).toBe(2);
    expect(second.body.data.providerSessionId).not.toBe(first.body.data.providerSessionId);
    expect(
      (
        await request(app)
          .post(`/api/v1/payments/${second.body.data.id}/expire`)
          .set(auth(customer))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/v1/shipments/${shipment.id}/cancel`)
          .set(auth(customer))
          .send({ reason: "No longer needed", expectedVersion: 0 })
      ).status,
    ).toBe(200);
  });
  it("refunds a paid pre-pickup shipment and prevents subsequent courier progression", async () => {
    const shipment = await createParcel();
    const payment = await pay(shipment.id);
    const response = await request(app)
      .post(`/api/v1/payments/${payment.id}/refund`)
      .set(auth(admin))
      .send({ reason: "Customer requested cancellation" });
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("REFUNDED");
    expect((await db.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe(
      "CANCELLED",
    );
    expect(
      (
        await request(app)
          .post(`/api/v1/shipments/${shipment.id}/assign`)
          .set(auth(admin))
          .send({ courierId, expectedVersion: 1 })
      ).status,
    ).toBe(409);
  });
  it("applies user suspension immediately to previously issued access tokens", async () => {
    const blocked = await register("blocked@test.example");
    expect(
      (
        await request(app)
          .patch(`/api/v1/admin/users/${blocked.user.id}`)
          .set(auth(admin))
          .send({ isActive: false })
      ).status,
    ).toBe(200);
    expect((await request(app).get("/api/v1/users/me").set(auth(blocked.accessToken))).status).toBe(
      401,
    );
  });
  it("verifies Google tokens and refuses silent linking of a password account", async () => {
    const spy = vi.spyOn(OAuth2Client.prototype, "verifyIdToken");
    spy.mockResolvedValue({
      getPayload: () => ({
        sub: "google-customer",
        email: "customer@test.example",
        email_verified: true,
        name: "Google User",
      }),
    } as never);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/google")
          .send({ idToken: "test-google-token-at-least-twenty-characters" })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post("/api/v1/auth/google/link")
          .set(auth(customer))
          .send({ idToken: "test-google-token-at-least-twenty-characters" })
      ).status,
    ).toBe(200);
    const response = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "test-google-token-at-least-twenty-characters" });
    expect(response.status).toBe(200);
    expect(response.body.data.user.id).toBe(customerId);
    spy.mockRejectedValue(new Error("Invalid Google token"));
    expect(
      (
        await request(app)
          .post("/api/v1/auth/google")
          .send({ idToken: "test-google-token-at-least-twenty-characters" })
      ).status,
    ).toBe(401);
    spy.mockRestore();
  });
  it("publishes OpenAPI coverage for every meaningful route", async () => {
    const docs = await request(app).get("/api/v1/openapi.json");
    expect(docs.status).toBe(200);
    expect(
      Object.values(docs.body.paths).flatMap((v) => Object.keys(v as object)).length,
    ).toBeGreaterThanOrEqual(40);
    expect((await request(app).get("/ready")).status).toBe(200);
  });
  it("retains immutable shipment address snapshots after address updates", async () => {
    const shipment = await createParcel();
    const oldLine = shipment.pickupAddress.line;
    const updated = await request(app)
      .patch(`/api/v1/addresses/${pickupId}`)
      .set(auth(customer))
      .send({ line: "New location, House 99" });
    expect(updated.status).toBe(200);
    const saved = await request(app).get(`/api/v1/shipments/${shipment.id}`).set(auth(customer));
    expect(saved.body.data.pickupAddress.line).toBe(oldLine);
    expect(
      (await request(app).delete(`/api/v1/shipments/${shipment.id}`).set(auth(customer))).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post(`/api/v1/shipments/${shipment.id}/cancel`)
          .set(auth(customer))
          .send({ reason: "Snapshot test complete", expectedVersion: 0 })
      ).status,
    ).toBe(200);
  });
  it("retries a provider-confirmed failed refund without marking it paid back early", async () => {
    const shipment = await createParcel();
    const payment = await pay(shipment.id);
    failNextRefund = true;
    const failed = await request(app)
      .post(`/api/v1/payments/${payment.id}/refund`)
      .set(auth(admin))
      .send({ reason: "Refund failure scenario" });
    expect(failed.status).toBe(502);
    const pending = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(pending.status).toBe("REFUND_PENDING");
    expect(pending.refundFailure).toBe("declined");
    const retry = await request(app)
      .post(`/api/v1/payments/${payment.id}/refund`)
      .set(auth(admin))
      .send({ reason: "Retry confirmed failed refund" });
    expect(retry.status).toBe(200);
    expect(retry.body.data.status).toBe("REFUNDED");
    expect(retry.body.data.refundAttempt).toBe(2);
  });
  it("enforces three failed delivery attempts followed by return-to-sender", async () => {
    const shipment = await createParcel();
    await pay(shipment.id);
    const assigned = await request(app)
      .post(`/api/v1/shipments/${shipment.id}/assign`)
      .set(auth(admin))
      .send({ courierId: courier2Id, expectedVersion: 0 });
    expect(assigned.status).toBe(200);
    let currentVersion = assigned.body.data.version;
    const step = async (status: string, extra = {}) => {
      const response = await request(app)
        .patch(`/api/v1/shipments/${shipment.id}/status`)
        .set(auth(courier2))
        .send({ status, expectedVersion: currentVersion, ...extra });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      currentVersion = response.body.data.version;
      return response;
    };
    await step("PICKED_UP");
    await step("AT_ORIGIN_HUB", { hubId });
    expect((await request(app).delete(`/api/v1/hubs/${hubId}`).set(auth(admin))).status).toBe(409);
    expect((await request(app).delete(`/api/v1/zones/${zoneId}`).set(auth(admin))).status).toBe(
      409,
    );
    await step("IN_TRANSIT");
    await step("AT_DESTINATION_HUB", { hubId: hub2Id });
    for (let attempt = 1; attempt <= 3; attempt++) {
      await step("OUT_FOR_DELIVERY");
      await step("FAILED_DELIVERY", { note: "Recipient unavailable" });
    }
    const fourth = await request(app)
      .patch(`/api/v1/shipments/${shipment.id}/status`)
      .set(auth(courier2))
      .send({ status: "OUT_FOR_DELIVERY", expectedVersion: currentVersion });
    expect(fourth.status).toBe(409);
    await step("RETURNING", { note: "Maximum attempts reached" });
    const returned = await step("RETURNED", { note: "Returned to original sender" });
    expect(returned.body.data.deliveryAttempts).toBe(3);
  });
  it("cannot overbook a courier when two assignments compete for the last slot", async () => {
    for (let index = 0; index < 9; index++) {
      const shipment = await createParcel();
      await pay(shipment.id);
      const response = await request(app)
        .post(`/api/v1/shipments/${shipment.id}/assign`)
        .set(auth(admin))
        .send({ courierId, expectedVersion: 0 });
      expect(response.status).toBe(200);
    }
    const first = await createParcel();
    const second = await createParcel();
    await pay(first.id);
    await pay(second.id);
    const responses = await Promise.all([
      request(app)
        .post(`/api/v1/shipments/${first.id}/assign`)
        .set(auth(admin))
        .send({ courierId, expectedVersion: 0 }),
      request(app)
        .post(`/api/v1/shipments/${second.id}/assign`)
        .set(auth(admin))
        .send({ courierId, expectedVersion: 0 }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const total = await db.shipment.count({
      where: { courierId, status: { notIn: ["DELIVERED", "RETURNED", "CANCELLED"] } },
    });
    expect(total).toBe(10);
    const roster = await request(app).get("/api/v1/couriers").set(auth(admin));
    expect(
      roster.body.data.items.find((item: { id: string }) => item.id === courierId).available,
    ).toBe(false);
  });
});
