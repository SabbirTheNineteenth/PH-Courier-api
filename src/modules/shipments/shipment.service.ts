import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db, transaction, type Tx } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { userSelect, pageMeta } from "../../lib/validation.js";
import { AppError } from "../../middleware/http.js";
import type { Actor } from "../../middleware/auth.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { calculatePrice, createShipmentSchema, quoteSchema, listSchema, terminal } from "./shipment.rules.js";
export function scope(user: Actor): Prisma.ShipmentWhereInput {
  return { deletedAt: null, ...(user.role === "CUSTOMER" ? { customerId: user.id } : user.role === "COURIER" ? { courierId: user.id } : {}) };
}
export async function ownedShipment(tx: Tx, user: Actor, id: string) {
  const shipment = await tx.shipment.findFirst({ where: { ...scope(user), id }, include: { payment: true } });
  if (!shipment) throw new AppError(404, "Shipment not found");
  return shipment;
}
export async function quote(tx: Tx, input: z.infer<typeof quoteSchema>) {
  const zones = await tx.zone.findMany({ where: { id: { in: [input.originZoneId, input.destinationZoneId] }, deletedAt: null } });
  const origin = zones.find(v => v.id === input.originZoneId);
  const destination = zones.find(v => v.id === input.destinationZoneId);
  if (!origin || !destination) throw new AppError(404, "Origin or destination zone not found");
  return calculatePrice(input.weightGrams, origin, destination, origin.id === destination.id);
}
export async function createShipment(user: Actor, input: z.infer<typeof createShipmentSchema>) {
  return transaction(async tx => {
    const addresses = await tx.address.findMany({ where: { id: { in: [input.pickupAddressId, input.deliveryAddressId] }, userId: user.id, deletedAt: null } });
    const pickup = addresses.find(v => v.id === input.pickupAddressId);
    const delivery = addresses.find(v => v.id === input.deliveryAddressId);
    if (!pickup || !delivery) throw new AppError(404, "Pickup or delivery address not found");
    const pricing = await quote(tx, { originZoneId: pickup.zoneId, destinationZoneId: delivery.zoneId, weightGrams: input.weightGrams });
    const snapshot = (address: typeof pickup) => ({ contactName: address.contactName, contactPhone: address.contactPhone, line: address.line, zoneId: address.zoneId, label: address.label });
    const shipment = await tx.shipment.create({ data: {
      customerId: user.id, trackingNumber: `PH-${randomBytes(12).toString("hex").toUpperCase()}`,
      pickupAddress: snapshot(pickup), deliveryAddress: snapshot(delivery), originZoneId: pickup.zoneId, destinationZoneId: delivery.zoneId,
      parcelDescription: input.parcelDescription, weightGrams: input.weightGrams, pickupDate: new Date(input.pickupDate), price: pricing.price,
      events: { create: { actorId: user.id, status: "CREATED", note: "Shipment created" } },
    } });
    await audit(tx, user.id, "shipment.created", "Shipment", shipment.id, { price: shipment.price });
    return shipment;
  });
}
export async function listShipments(user: Actor, q: z.infer<typeof listSchema>) {
  if (user.role !== "ADMIN" && (q.customerId || q.courierId)) throw new AppError(403, "Only admins may filter by another user");
  const where: Prisma.ShipmentWhereInput = { ...scope(user), ...(q.status ? { status: q.status } : {}), ...(q.customerId ? { customerId: q.customerId } : {}), ...(q.courierId ? { courierId: q.courierId } : {}), ...(q.search ? { OR: [{ trackingNumber: { contains: q.search, mode: "insensitive" } }, { parcelDescription: { contains: q.search, mode: "insensitive" } }] } : {}) };
  const [items, total] = await Promise.all([db.shipment.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { createdAt: q.sort }, include: { courier: { select: userSelect }, payment: { select: { id: true, status: true } } } }), db.shipment.count({ where })]);
  return { items, meta: pageMeta(q.page, q.limit, total) };
}
export async function getShipment(user: Actor, id: string) {
  const shipment = await db.shipment.findFirst({ where: { ...scope(user), id }, include: { courier: { select: userSelect }, payment: true, events: { orderBy: { createdAt: "asc" } }, currentHub: true } });
  if (!shipment) throw new AppError(404, "Shipment not found");
  return shipment;
}
export const updateSchema = createShipmentSchema.pick({ parcelDescription: true, pickupDate: true }).partial().extend({ expectedVersion: z.number().int().min(0) }).strict().refine(v => v.parcelDescription || v.pickupDate, "At least one editable field is required");
export async function updateShipment(user: Actor, id: string, input: z.infer<typeof updateSchema>) {
  return transaction(async tx => {
    const shipment = await ownedShipment(tx, user, id);
    if (shipment.status !== "CREATED" || shipment.payment) throw new AppError(409, "Only shipments without a payment session can be edited");
    if (shipment.version !== input.expectedVersion) throw new AppError(409, "Shipment version changed; reload before updating");
    const updated = await tx.shipment.update({ where: { id, version: input.expectedVersion }, data: { ...(input.parcelDescription ? { parcelDescription: input.parcelDescription } : {}), ...(input.pickupDate ? { pickupDate: new Date(input.pickupDate) } : {}), version: { increment: 1 } } });
    await audit(tx, user.id, "shipment.updated", "Shipment", id);
    return updated;
  });
}
export async function deleteShipment(user: Actor, id: string) {
  return transaction(async tx => {
    const shipment = await ownedShipment(tx, user, id);
    if (!terminal.includes(shipment.status)) throw new AppError(409, "Only terminal shipments can be archived");
    await tx.shipment.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
    await audit(tx, user.id, "shipment.deleted", "Shipment", id);
  });
}
