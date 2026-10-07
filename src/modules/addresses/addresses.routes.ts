import { z } from "zod";
import { audit } from "../../lib/audit.js";
import { db, type Tx, transaction } from "../../lib/db.js";
import { createModule } from "../../lib/routes.js";
import { idParams, uuid } from "../../lib/validation.js";
import { actor } from "../../middleware/auth.js";
import { AppError, ok } from "../../middleware/http.js";

const { router, endpoint } = createModule("/addresses");
export const addressSchema = z
  .object({
    label: z.string().trim().min(1).max(50),
    contactName: z.string().trim().min(2).max(100),
    contactPhone: z.string().regex(/^\+?[0-9]{10,15}$/),
    line: z.string().trim().min(5).max(300),
    zoneId: uuid,
  })
  .strict();
const patchSchema = addressSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");
async function zoneExists(tx: Tx, id: string) {
  if (!(await tx.zone.findFirst({ where: { id, deletedAt: null } })))
    throw new AppError(404, "Zone not found");
}
endpoint(
  "post",
  "/",
  {
    summary: "Create a saved customer address",
    roles: ["CUSTOMER"],
    body: addressSchema,
    status: 201,
  },
  async (req, res) =>
    ok(
      res,
      await transaction(async (tx) => {
        await zoneExists(tx, req.body.zoneId);
        const address = await tx.address.create({ data: { ...req.body, userId: actor(res).id } });
        await audit(tx, actor(res).id, "address.created", "Address", address.id);
        return address;
      }),
      "Address created",
      201,
    ),
);
endpoint(
  "get",
  "/",
  { summary: "List own saved addresses", roles: ["CUSTOMER"] },
  async (_req, res) =>
    ok(
      res,
      await db.address.findMany({
        where: { userId: actor(res).id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ),
);
endpoint(
  "patch",
  "/:id",
  { summary: "Update own saved address", roles: ["CUSTOMER"], params: idParams, body: patchSchema },
  async (req, res) =>
    ok(
      res,
      await transaction(async (tx) => {
        const address = await tx.address.findFirst({
          where: { id: String(req.params.id), userId: actor(res).id, deletedAt: null },
        });
        if (!address) throw new AppError(404, "Address not found");
        if (req.body.zoneId) await zoneExists(tx, req.body.zoneId);
        const updated = await tx.address.update({ where: { id: address.id }, data: req.body });
        await audit(tx, actor(res).id, "address.updated", "Address", address.id);
        return updated;
      }),
      "Address updated",
    ),
);
endpoint(
  "delete",
  "/:id",
  { summary: "Soft-delete own saved address", roles: ["CUSTOMER"], params: idParams },
  async (req, res) => {
    await transaction(async (tx) => {
      const address = await tx.address.findFirst({
        where: { id: String(req.params.id), userId: actor(res).id, deletedAt: null },
      });
      if (!address) throw new AppError(404, "Address not found");
      await tx.address.update({ where: { id: address.id }, data: { deletedAt: new Date() } });
      await audit(tx, actor(res).id, "address.deleted", "Address", address.id);
    });
    return ok(res, null, "Address deleted");
  },
);
export default router;
