import { z } from "zod";
import type { ShipmentStatus } from "../../generated/prisma/client.js";
import { AppError } from "../../middleware/http.js";
import { uuid, pagination } from "../../lib/validation.js";
export const statuses = ["CREATED", "ASSIGNED", "PICKED_UP", "AT_ORIGIN_HUB", "IN_TRANSIT", "AT_DESTINATION_HUB", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY", "RETURNING", "RETURNED", "CANCELLED"] as const;
export const terminal: ShipmentStatus[] = ["DELIVERED", "RETURNED", "CANCELLED"];
export const transitions: Record<ShipmentStatus, ShipmentStatus[]> = {
  CREATED: ["ASSIGNED", "CANCELLED"], ASSIGNED: ["PICKED_UP", "CANCELLED"],
  PICKED_UP: ["AT_ORIGIN_HUB"], AT_ORIGIN_HUB: ["IN_TRANSIT"], IN_TRANSIT: ["AT_DESTINATION_HUB"],
  AT_DESTINATION_HUB: ["OUT_FOR_DELIVERY"], OUT_FOR_DELIVERY: ["DELIVERED", "FAILED_DELIVERY"],
  FAILED_DELIVERY: ["OUT_FOR_DELIVERY", "RETURNING"], RETURNING: ["RETURNED"],
  DELIVERED: [], RETURNED: [], CANCELLED: [],
};
export function assertTransition(from: ShipmentStatus, to: ShipmentStatus, attempts: number) {
  if (!transitions[from].includes(to)) throw new AppError(409, `Cannot change shipment from ${from} to ${to}`);
  if (from === "FAILED_DELIVERY" && to === "OUT_FOR_DELIVERY" && attempts >= 3) throw new AppError(409, "Maximum delivery attempts reached; return the shipment");
}
export function calculatePrice(weightGrams: number, origin: { basePrice: number; perKgPrice: number }, destination: { basePrice: number; perKgPrice: number }, sameZone: boolean) {
  const kilograms = Math.ceil(weightGrams / 1000);
  return { price: origin.basePrice + kilograms * origin.perKgPrice + (sameZone ? 0 : destination.basePrice), currency: "bdt", kilograms, weightGrams };
}
export const quoteSchema = z.object({ originZoneId: uuid, destinationZoneId: uuid, weightGrams: z.number().int().min(1).max(30000) }).strict();
export const createShipmentSchema = z.object({ pickupAddressId: uuid, deliveryAddressId: uuid, parcelDescription: z.string().trim().min(3).max(500), weightGrams: z.number().int().min(1).max(30000), pickupDate: z.iso.datetime({ offset: true }).refine(v => new Date(v) > new Date(), "Pickup date must be in the future").refine(v => new Date(v).getTime() < Date.now() + 30 * 86400000, "Pickup must be within 30 days") }).strict();
export const listSchema = pagination.extend({ status: z.enum(statuses).optional(), courierId: uuid.optional(), customerId: uuid.optional() });
export const statusSchema = z.object({ status: z.enum(statuses).exclude(["CREATED", "ASSIGNED", "CANCELLED"]), hubId: uuid.optional(), note: z.string().trim().min(3).max(500).optional(), expectedVersion: z.number().int().min(0) }).strict();
export const assignSchema = z.object({ courierId: uuid, expectedVersion: z.number().int().min(0) }).strict();
export const cancelSchema = z.object({ reason: z.string().trim().min(3).max(500), expectedVersion: z.number().int().min(0) }).strict();
