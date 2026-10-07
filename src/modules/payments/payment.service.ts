import type Stripe from "stripe";
import { env } from "../../config/env.js";
import { Prisma } from "../../generated/prisma/client.js";
import { audit } from "../../lib/audit.js";
import { db, type Tx, transaction } from "../../lib/db.js";
import { getStripe } from "../../lib/stripe.js";
import type { Actor } from "../../middleware/auth.js";
import { AppError } from "../../middleware/http.js";
import { ownedShipment } from "../shipments/shipment.service.js";
export async function ownedPayment(user: Actor, id: string) {
  const payment = await db.payment.findFirst({
    where: { id, shipment: user.role === "ADMIN" ? {} : { customerId: user.id } },
    include: { shipment: true },
  });
  if (!payment) throw new AppError(404, "Payment not found");
  return payment;
}
export async function applySession(tx: Tx, session: Stripe.Checkout.Session) {
  const id = session.metadata?.paymentId;
  if (!id) throw new AppError(400, "Payment metadata is missing");
  const payment = await tx.payment.findUnique({ where: { id } });
  if (!payment) throw new AppError(400, "Payment record not found");
  if (String(payment.attempt) !== session.metadata?.attempt) return;
  if (payment.providerSessionId && payment.providerSessionId !== session.id)
    throw new AppError(400, "Payment session mismatch");
  if (
    session.amount_total !== payment.amount ||
    session.currency !== payment.currency ||
    session.client_reference_id !== payment.shipmentId
  )
    throw new AppError(400, "Payment amount, currency or shipment mismatch");
  if (session.payment_status === "paid" && payment.status === "PENDING") {
    const shipment = await tx.shipment.findUniqueOrThrow({ where: { id: payment.shipmentId } });
    if (shipment.status !== "CREATED") throw new AppError(409, "Shipment is not payable");
    await tx.payment.update({
      where: { id },
      data: { status: "PAID", paidAt: new Date(), providerSessionId: session.id },
    });
    await audit(tx, null, "payment.verified", "Payment", id, {
      amount: payment.amount,
      providerSessionId: session.id,
    });
  } else if (session.status === "expired" && payment.status === "PENDING") {
    await tx.payment.update({
      where: { id },
      data: { status: "CANCELLED", providerSessionId: session.id, checkoutUrl: null },
    });
    await audit(tx, null, "payment.expired", "Payment", id);
  }
}
export async function initiate(user: Actor, shipmentId: string) {
  const stripe = getStripe();
  const reserve = () =>
    transaction(async (tx) => {
      const shipment = await ownedShipment(tx, user, shipmentId);
      if (shipment.status !== "CREATED")
        throw new AppError(409, "Only a newly created shipment can be paid");
      if (shipment.payment) {
        if (["PAID", "REFUND_PENDING", "REFUNDED"].includes(shipment.payment.status))
          throw new AppError(409, "Shipment already paid or refunded");
        if (shipment.payment.status === "CANCELLED")
          return tx.payment.update({
            where: { id: shipment.payment.id },
            data: {
              status: "PENDING",
              attempt: { increment: 1 },
              providerSessionId: null,
              checkoutUrl: null,
            },
          });
        return shipment.payment;
      }
      const result = await tx.payment.create({
        data: { shipmentId, amount: shipment.price, currency: shipment.currency },
      });
      await audit(tx, user.id, "payment.initiated", "Payment", result.id);
      return result;
    });
  const payment = await reserve().catch(async (error: unknown) => {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      (await db.payment.findUnique({ where: { shipmentId } }))
    )
      return reserve();
    throw error;
  });
  if (payment.providerSessionId && payment.checkoutUrl) {
    const session = await stripe.checkout.sessions.retrieve(payment.providerSessionId);
    await transaction((tx) => applySession(tx, session));
    if (session.status === "expired")
      throw new AppError(409, "Checkout expired; initiate again to open a new session");
    if (session.payment_status === "paid") return ownedPayment(user, payment.id);
    return payment;
  }
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: user.email,
      client_reference_id: shipmentId,
      metadata: { paymentId: payment.id, attempt: String(payment.attempt) },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: payment.currency,
            unit_amount: payment.amount,
            product_data: { name: "Courier shipment delivery fee" },
          },
        },
      ],
      success_url: `${env.PAYMENT_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.PAYMENT_CANCEL_URL}?payment_id=${payment.id}`,
    },
    { idempotencyKey: `checkout-${payment.id}-${payment.attempt}` },
  );
  return transaction(async (tx) => {
    const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (current.attempt !== payment.attempt)
      throw new AppError(409, "Payment attempt changed; reload");
    return tx.payment.update({
      where: { id: payment.id },
      data: {
        providerSessionId: session.id,
        checkoutUrl: current.status === "PENDING" ? session.url : null,
      },
    });
  });
}
export async function verify(user: Actor, id: string) {
  const stripe = getStripe();
  const payment = await ownedPayment(user, id);
  if (!payment.providerSessionId)
    throw new AppError(409, "Checkout session has not been created; retry initiation");
  const session = await stripe.checkout.sessions.retrieve(payment.providerSessionId);
  await transaction((tx) => applySession(tx, session));
  return ownedPayment(user, id);
}
export async function expire(user: Actor, id: string) {
  const stripe = getStripe();
  const payment = await ownedPayment(user, id);
  if (payment.status !== "PENDING" || !payment.providerSessionId)
    throw new AppError(409, "No unpaid checkout session to expire");
  let session = await stripe.checkout.sessions.retrieve(payment.providerSessionId);
  if (session.payment_status === "paid") {
    await transaction((tx) => applySession(tx, session));
    throw new AppError(409, "Payment already completed; request an admin refund");
  }
  if (session.status === "open") session = await stripe.checkout.sessions.expire(session.id);
  await transaction((tx) => applySession(tx, session));
  return ownedPayment(user, id);
}
