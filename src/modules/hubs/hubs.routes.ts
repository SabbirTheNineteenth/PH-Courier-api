import { z } from "zod";
import { createModule } from "../../lib/routes.js";
import { db, transaction } from "../../lib/db.js";
import { idParams, uuid, pagination, pageMeta } from "../../lib/validation.js";
import { audit } from "../../lib/audit.js";
import { actor } from "../../middleware/auth.js";
import { AppError, ok } from "../../middleware/http.js";
const { router, endpoint } = createModule("/hubs");
const hubSchema = z.object({ name: z.string().trim().min(2).max(100), address: z.string().trim().min(5).max(300), zoneId: uuid }).strict();
const querySchema = pagination.extend({ zoneId: uuid.optional() });
const patchSchema = hubSchema.omit({ zoneId: true }).partial().refine(v => Object.keys(v).length > 0, "At least one field is required");
endpoint("get", "/", { summary: "List hubs with pagination and zone filtering", roles: ["CUSTOMER", "COURIER", "ADMIN"], query: querySchema }, async (_req, res) => {
  const q = querySchema.parse(res.locals.query);
  const where = { deletedAt: null, ...(q.zoneId ? { zoneId: q.zoneId } : {}), ...(q.search ? { name: { contains: q.search, mode: "insensitive" as const } } : {}) };
  const [items, total] = await Promise.all([db.hub.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { createdAt: q.sort }, include: { zone: true } }), db.hub.count({ where })]);
  return ok(res, { items, meta: pageMeta(q.page, q.limit, total) });
});
endpoint("post", "/", { summary: "Create a hub inside an active zone", roles: ["ADMIN"], body: hubSchema, status: 201 }, async (req, res) => ok(res, await transaction(async tx => {
  if (!await tx.zone.findFirst({ where: { id: req.body.zoneId, deletedAt: null } })) throw new AppError(404, "Zone not found");
  const hub = await tx.hub.create({ data: req.body }); await audit(tx, actor(res).id, "hub.created", "Hub", hub.id); return hub;
}), "Hub created", 201));
endpoint("patch", "/:id", { summary: "Update hub details", roles: ["ADMIN"], params: idParams, body: patchSchema }, async (req, res) => ok(res, await transaction(async tx => {
  const hub = await tx.hub.findFirst({ where: { id: String(req.params.id), deletedAt: null } }); if (!hub) throw new AppError(404, "Hub not found");
  const result = await tx.hub.update({ where: { id: hub.id }, data: req.body }); await audit(tx, actor(res).id, "hub.updated", "Hub", hub.id); return result;
}), "Hub updated"));
endpoint("delete", "/:id", { summary: "Retire a hub with no active shipments", roles: ["ADMIN"], params: idParams }, async (req, res) => {
  await transaction(async tx => {
    const id = String(req.params.id);
    if (!await tx.hub.findFirst({ where: { id, deletedAt: null } })) throw new AppError(404, "Hub not found");
    if (await tx.shipment.count({ where: { currentHubId: id, status: { notIn: ["DELIVERED", "RETURNED", "CANCELLED"] } } })) throw new AppError(409, "Hub contains active shipments");
    await tx.hub.update({ where: { id }, data: { deletedAt: new Date() } }); await audit(tx, actor(res).id, "hub.deleted", "Hub", id);
  }); return ok(res, null, "Hub retired");
});
export default router;
