import type Stripe from "stripe";
import { transaction, type Tx } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { getStripe } from "../../lib/stripe.js";
import { AppError } from "../../middleware/http.js";
import type { Actor } from "../../middleware/auth.js";
import { ownedPayment } from "./payment.service.js";
export async function applyRefund(tx: Tx, refund: Stripe.Refund) {
  const id = refund.metadata?.paymentId;
  if (!id) return;
  const payment = await tx.payment.findUnique({ where: { id } });
  if (!payment) throw new AppError(400, "Refund payment not found");
  if (refund.amount !== payment.amount || refund.currency !== payment.currency) throw new AppError(400, "Refund amount or currency mismatch");
  if (payment.providerRefundId && payment.providerRefundId !== refund.id) throw new AppError(400, "Refund identifier mismatch");
  if (refund.status === "succeeded" && payment.status === "REFUND_PENDING") {
    await tx.payment.update({ where: { id }, data: { status: "REFUNDED", providerRefundId: refund.id, refundedAt: new Date() } });
    await audit(tx, null, "payment.refunded", "Payment", id, { providerRefundId: refund.id, amount: refund.amount });
  }
}
export async function refundPayment(user: Actor, id: string, reason: string) {
  const stripe = getStripe();
  const payment = await ownedPayment(user, id);
  if (payment.status === "REFUNDED") return payment;
  if (payment.status !== "PAID" && payment.status !== "REFUND_PENDING") throw new AppError(409, "Only a paid shipment can be refunded");
  if (!payment.providerSessionId) throw new AppError(409, "Payment session missing");
  if (payment.status === "PAID") {
    await transaction(async tx => {
      const current = await tx.payment.findUniqueOrThrow({ where: { id }, include: { shipment: true } });
      if (current.status === "REFUND_PENDING") return;
      if (current.status !== "PAID" || !["CREATED", "ASSIGNED"].includes(current.shipment.status)) throw new AppError(409, "Refunds are available only before pickup");
      await tx.payment.update({ where: { id }, data: { status: "REFUND_PENDING" } });
      await tx.shipment.update({ where: { id: current.shipmentId }, data: { status: "CANCELLED", version: { increment: 1 }, events: { create: { actorId: user.id, status: "CANCELLED", note: `Refund requested: ${reason}` } } } });
      await audit(tx, user.id, "payment.refundRequested", "Payment", id, { reason });
    });
  }
  const session = await stripe.checkout.sessions.retrieve(payment.providerSessionId);
  const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!intent) throw new AppError(502, "Stripe payment intent is unavailable; retry refund");
  const refund = payment.providerRefundId ? await stripe.refunds.retrieve(payment.providerRefundId) : await stripe.refunds.create({ payment_intent: intent, amount: payment.amount, reason: "requested_by_customer", metadata: { paymentId: id } }, { idempotencyKey: `refund-${id}` });
  await transaction(async tx => {
    await tx.payment.update({ where: { id }, data: { providerRefundId: refund.id } });
    await applyRefund(tx, refund);
  });
  if (refund.status === "failed" || refund.status === "canceled") throw new AppError(502, "Stripe refund failed; inspect the refund in Stripe before retrying");
  return ownedPayment(user, id);
}
