import Stripe from "stripe";
import { env } from "../config/env.js";
import { AppError } from "../middleware/http.js";

let stripe: Stripe | null = null;
export function getStripe() {
  if (!env.STRIPE_SECRET_KEY) throw new AppError(503, "Stripe payments are not configured");
  stripe ??= new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 10000 });
  return stripe;
}
