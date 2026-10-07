import { z } from "zod";
import { createModule } from "../../lib/routes.js";
import { idParams, uuid } from "../../lib/validation.js";
import { actor } from "../../middleware/auth.js";
import { ok } from "../../middleware/http.js";
import { expire, initiate, ownedPayment, verify } from "./payment.service.js";
import { refundPayment } from "./refund.service.js";

const { router, endpoint } = createModule("/payments");
endpoint(
  "get",
  "/success",
  {
    summary: "Checkout return notice; authenticated verification is still required",
    query: z.object({ session_id: z.string().max(255).optional() }),
  },
  async (_req, res) =>
    ok(
      res,
      {
        nextStep:
          "Call POST /api/v1/payments/:id/verify with your Bearer token. A browser redirect does not prove payment.",
      },
      "Returned from Stripe",
    ),
);
endpoint(
  "get",
  "/cancel",
  {
    summary: "Checkout cancellation notice; does not change financial state",
    query: z.object({ payment_id: uuid.optional() }),
  },
  async (_req, res) =>
    ok(
      res,
      {
        nextStep:
          "Call POST /api/v1/payments/:id/expire to close unpaid checkout, or reuse it to pay.",
      },
      "Checkout cancelled by visitor",
    ),
);
endpoint(
  "post",
  "/initiate",
  {
    summary: "Open or reuse a real Stripe Checkout session",
    roles: ["CUSTOMER"],
    body: z.object({ shipmentId: uuid }).strict(),
  },
  async (req, res) =>
    ok(res, await initiate(actor(res), req.body.shipmentId), "Checkout session ready"),
);
endpoint(
  "get",
  "/:id",
  { summary: "Get own payment state", roles: ["CUSTOMER", "ADMIN"], params: idParams },
  async (req, res) => ok(res, await ownedPayment(actor(res), String(req.params.id))),
);
endpoint(
  "post",
  "/:id/verify",
  {
    summary: "Verify payment directly with Stripe",
    roles: ["CUSTOMER", "ADMIN"],
    params: idParams,
  },
  async (req, res) => ok(res, await verify(actor(res), String(req.params.id)), "Payment verified"),
);
endpoint(
  "post",
  "/:id/expire",
  {
    summary: "Expire unpaid Stripe checkout before cancelling or retrying",
    roles: ["CUSTOMER", "ADMIN"],
    params: idParams,
  },
  async (req, res) => ok(res, await expire(actor(res), String(req.params.id)), "Checkout expired"),
);
endpoint(
  "post",
  "/:id/refund",
  {
    summary: "Refund and cancel a paid shipment before pickup",
    roles: ["ADMIN"],
    params: idParams,
    body: z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
  },
  async (req, res) =>
    ok(
      res,
      await refundPayment(actor(res), String(req.params.id), req.body.reason),
      "Refund processed or pending Stripe confirmation",
    ),
);
export default router;
