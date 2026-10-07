import { z } from "zod";
import { audit } from "../../lib/audit.js";
import { cached, invalidate } from "../../lib/cache.js";
import { db, transaction } from "../../lib/db.js";
import { createModule } from "../../lib/routes.js";
import { idParams } from "../../lib/validation.js";
import { actor } from "../../middleware/auth.js";
import { AppError, ok } from "../../middleware/http.js";

const { router, endpoint } = createModule("/zones");
const zoneSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    basePrice: z.number().int().min(100).max(1000000),
    perKgPrice: z.number().int().min(0).max(100000),
  })
  .strict();
const patchSchema = zoneSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");
endpoint(
  "get",
  "/",
  { summary: "List active service zones and pricing", roles: ["CUSTOMER", "COURIER", "ADMIN"] },
  async (_req, res) =>
    ok(
      res,
      await cached("zones:active", () =>
        db.zone.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
      ),
    ),
);
endpoint(
  "post",
  "/",
  {
    summary: "Create a service zone; prices in paisa",
    roles: ["ADMIN"],
    body: zoneSchema,
    status: 201,
    example: { name: "Dhaka", basePrice: 6000, perKgPrice: 2000 },
  },
  async (req, res) => {
    const zone = await transaction(async (tx) => {
      const result = await tx.zone.create({ data: req.body });
      await audit(tx, actor(res).id, "zone.created", "Zone", result.id);
      return result;
    });
    await invalidate("zones:active");
    return ok(res, zone, "Zone created", 201);
  },
);
endpoint(
  "patch",
  "/:id",
  { summary: "Update service zone pricing", roles: ["ADMIN"], params: idParams, body: patchSchema },
  async (req, res) => {
    const zone = await transaction(async (tx) => {
      const found = await tx.zone.findFirst({
        where: { id: String(req.params.id), deletedAt: null },
      });
      if (!found) throw new AppError(404, "Zone not found");
      const updated = await tx.zone.update({ where: { id: found.id }, data: req.body });
      await audit(tx, actor(res).id, "zone.updated", "Zone", found.id, req.body);
      return updated;
    });
    await invalidate("zones:active");
    return ok(res, zone, "Zone updated");
  },
);
endpoint(
  "delete",
  "/:id",
  { summary: "Retire a zone with no active shipments or hubs", roles: ["ADMIN"], params: idParams },
  async (req, res) => {
    await transaction(async (tx) => {
      const id = String(req.params.id);
      if (!(await tx.zone.findFirst({ where: { id, deletedAt: null } })))
        throw new AppError(404, "Zone not found");
      const inUse = await tx.shipment.count({
        where: {
          OR: [{ originZoneId: id }, { destinationZoneId: id }],
          status: { notIn: ["DELIVERED", "RETURNED", "CANCELLED"] },
          deletedAt: null,
        },
      });
      if (inUse || (await tx.hub.count({ where: { zoneId: id, deletedAt: null } })))
        throw new AppError(409, "Zone has active shipments or hubs");
      await tx.zone.update({ where: { id }, data: { deletedAt: new Date() } });
      await audit(tx, actor(res).id, "zone.deleted", "Zone", id);
    });
    await invalidate("zones:active");
    return ok(res, null, "Zone retired");
  },
);
export default router;
