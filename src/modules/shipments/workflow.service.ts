import { z } from "zod";
import { transaction } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { AppError } from "../../middleware/http.js";
import type { Actor } from "../../middleware/auth.js";
import { ownedShipment } from "./shipment.service.js";
import { assignSchema, statusSchema, cancelSchema, assertTransition, terminal } from "./shipment.rules.js";
export async function assignCourier(user: Actor, id: string, input: z.infer<typeof assignSchema>) {
  return transaction(async tx => {
    const shipment = await ownedShipment(tx, user, id);
    if (!["CREATED", "ASSIGNED"].includes(shipment.status)) throw new AppError(409, "Courier can only be assigned before pickup");
    if (shipment.payment?.status !== "PAID") throw new AppError(409, "Shipment must be paid before assignment");
    if (shipment.version !== input.expectedVersion) throw new AppError(409, "Shipment version changed");
    if (shipment.courierId === input.courierId) throw new AppError(409, "Courier is already assigned");
    const courier = await tx.user.findFirst({ where: { id: input.courierId, role: "COURIER", isActive: true, deletedAt: null } });
    if (!courier) throw new AppError(404, "Active courier not found");
    const workload = await tx.shipment.count({ where: { courierId: courier.id, status: { notIn: terminal }, deletedAt: null } });
    if (workload >= 10) throw new AppError(409, "Courier has reached the 10-shipment capacity");
    const updated = await tx.shipment.update({ where: { id, version: input.expectedVersion }, data: { courierId: courier.id, status: "ASSIGNED", version: { increment: 1 }, events: { create: { actorId: user.id, status: "ASSIGNED", note: `Courier assigned: ${courier.id}` } } } });
    await audit(tx, user.id, "shipment.assigned", "Shipment", id, { courierId: courier.id, previousCourierId: shipment.courierId });
    return updated;
  });
}
export async function updateStatus(user: Actor, id: string, input: z.infer<typeof statusSchema>) {
  return transaction(async tx => {
    const shipment = await ownedShipment(tx, user, id);
    if (shipment.version !== input.expectedVersion) throw new AppError(409, "Shipment version changed; reload before updating");
    if (shipment.payment?.status !== "PAID" || !shipment.courierId) throw new AppError(409, "Paid shipment and assigned courier required");
    assertTransition(shipment.status, input.status, shipment.deliveryAttempts);
    const atHub = input.status === "AT_ORIGIN_HUB" || input.status === "AT_DESTINATION_HUB";
    if (atHub) {
      if (!input.hubId) throw new AppError(400, "hubId is required for hub arrival");
      const hub = await tx.hub.findFirst({ where: { id: input.hubId, deletedAt: null } });
      if (!hub) throw new AppError(404, "Hub not found");
      const zoneId = input.status === "AT_ORIGIN_HUB" ? shipment.originZoneId : shipment.destinationZoneId;
      if (hub.zoneId !== zoneId) throw new AppError(409, "Hub is outside the required shipment zone");
    } else if (input.hubId) throw new AppError(400, "hubId is allowed only for hub arrival");
    if (["DELIVERED", "FAILED_DELIVERY", "RETURNING", "RETURNED"].includes(input.status) && !input.note) throw new AppError(400, "A delivery proof or failure/return reason is required");
    const updated = await tx.shipment.update({ where: { id, version: input.expectedVersion }, data: {
      status: input.status, version: { increment: 1 }, currentHubId: atHub ? input.hubId : null,
      ...(input.status === "OUT_FOR_DELIVERY" ? { deliveryAttempts: { increment: 1 } } : {}),
      ...(input.status === "DELIVERED" ? { deliveredAt: new Date() } : {}),
      events: { create: { actorId: user.id, status: input.status, note: input.note, hubId: input.hubId } },
    } });
    await audit(tx, user.id, "shipment.statusChanged", "Shipment", id, { from: shipment.status, to: input.status });
    return updated;
  });
}
export async function cancelShipment(user: Actor, id: string, input: z.infer<typeof cancelSchema>) {
  return transaction(async tx => {
    const shipment = await ownedShipment(tx, user, id);
    if (!["CREATED", "ASSIGNED"].includes(shipment.status)) throw new AppError(409, "Shipment cannot be cancelled after pickup");
    if (shipment.version !== input.expectedVersion) throw new AppError(409, "Shipment version changed");
    if (shipment.payment && shipment.payment.status !== "CANCELLED") throw new AppError(409, "Expire an unpaid checkout session first; paid shipments require an admin refund");
    const updated = await tx.shipment.update({ where: { id, version: input.expectedVersion }, data: { status: "CANCELLED", version: { increment: 1 }, events: { create: { actorId: user.id, status: "CANCELLED", note: input.reason } } } });
    await audit(tx, user.id, "shipment.cancelled", "Shipment", id, { reason: input.reason });
    return updated;
  });
}
