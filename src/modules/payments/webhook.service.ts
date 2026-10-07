import type Stripe from "stripe";
import { env } from "../../config/env.js";
import { Prisma } from "../../generated/prisma/client.js";
import { db, transaction } from "../../lib/db.js";
import { getStripe } from "../../lib/stripe.js";
import { AppError } from "../../middleware/http.js";
import { applySession } from "./payment.service.js";
import { applyRefund } from "./refund.service.js";
export async function webhook(body: Buffer, signature: string | undefined) {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new AppError(503, "Stripe webhook is not configured");
  if (!signature) throw new AppError(400, "Stripe signature is required");
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw new AppError(400, "Invalid Stripe webhook signature");
  }
  try {
    return await transaction(async (tx) => {
      if (await tx.webhookEvent.findUnique({ where: { id: event.id } }))
        return { received: true, duplicate: true };
      await tx.webhookEvent.create({ data: { id: event.id, type: event.type } });
      if (
        [
          "checkout.session.completed",
          "checkout.session.async_payment_succeeded",
          "checkout.session.expired",
        ].includes(event.type)
      )
        await applySession(tx, event.data.object as Stripe.Checkout.Session);
      else if (["refund.created", "refund.updated"].includes(event.type))
        await applyRefund(tx, event.data.object as Stripe.Refund);
      return { received: true, duplicate: false };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      (await db.webhookEvent.findUnique({ where: { id: event.id } }))
    )
      return { received: true, duplicate: true };
    throw error;
  }
}
