import argon2 from "argon2";
import { z } from "zod";
import { createModule } from "../../lib/routes.js";
import { db, transaction } from "../../lib/db.js";
import { userSelect, pagination, idParams, pageMeta } from "../../lib/validation.js";
import { audit } from "../../lib/audit.js";
import { actor } from "../../middleware/auth.js";
import { AppError, ok } from "../../middleware/http.js";
import { registerSchema } from "../auth/auth.service.js";
import { terminal } from "../shipments/shipment.rules.js";
const { router, endpoint } = createModule("/admin");
const userQuery = pagination.extend({ role: z.enum(["CUSTOMER", "COURIER", "ADMIN"]).optional(), active: z.enum(["true", "false"]).optional() });
const patchSchema = z.object({ role: z.enum(["CUSTOMER", "COURIER", "ADMIN"]).optional(), isActive: z.boolean().optional() }).strict().refine(v => Object.keys(v).length > 0, "At least one field is required");
endpoint("get", "/users", { summary: "List users with pagination search and role filtering", roles: ["ADMIN"], query: userQuery }, async (_req, res) => {
  const q = userQuery.parse(res.locals.query);
  const where = { deletedAt: null, ...(q.role ? { role: q.role } : {}), ...(q.active ? { isActive: q.active === "true" } : {}), ...(q.search ? { OR: [{ email: { contains: q.search, mode: "insensitive" as const } }, { name: { contains: q.search, mode: "insensitive" as const } }] } : {}) };
  const [items, total] = await Promise.all([db.user.findMany({ where, select: userSelect, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { createdAt: q.sort } }), db.user.count({ where })]);
  return ok(res, { items, meta: pageMeta(q.page, q.limit, total) });
});
endpoint("post", "/couriers", { summary: "Create a courier account; public registration cannot choose a role", roles: ["ADMIN"], body: registerSchema, status: 201 }, async (req, res) => {
  const passwordHash = await argon2.hash(req.body.password, { type: argon2.argon2id });
  const courier = await transaction(async tx => { const result = await tx.user.create({ data: { email: req.body.email, name: req.body.name, phone: req.body.phone, passwordHash, role: "COURIER" }, select: userSelect }); await audit(tx, actor(res).id, "courier.created", "User", result.id); return result; });
  return ok(res, courier, "Courier created", 201);
});
endpoint("patch", "/users/:id", { summary: "Change user role or suspend account with workload safeguards", roles: ["ADMIN"], params: idParams, body: patchSchema }, async (req, res) => ok(res, await transaction(async tx => {
  const id = String(req.params.id);
  if (id === actor(res).id) throw new AppError(409, "Admins cannot change their own role or availability");
  const user = await tx.user.findFirst({ where: { id, deletedAt: null } }); if (!user) throw new AppError(404, "User not found");
  if (user.role === "ADMIN" && (req.body.role && req.body.role !== "ADMIN" || req.body.isActive === false)) {
    if (await tx.user.count({ where: { role: "ADMIN", isActive: true, deletedAt: null } }) <= 1) throw new AppError(409, "At least one active admin is required");
  }
  if ((req.body.role && req.body.role !== user.role) || (user.role === "COURIER" && req.body.isActive === false)) {
    if (await tx.shipment.count({ where: { OR: [{ customerId: id }, { courierId: id }], status: { notIn: terminal }, deletedAt: null } })) throw new AppError(409, "Resolve active shipments before changing role or suspending courier");
  }
  const updated = await tx.user.update({ where: { id }, data: req.body, select: userSelect });
  await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(tx, actor(res).id, "user.accessChanged", "User", id, { oldRole: user.role, ...req.body });
  return updated;
}), "User access updated"));
endpoint("delete", "/users/:id", { summary: "Soft-delete an account after its shipments are resolved", roles: ["ADMIN"], params: idParams }, async (req, res) => {
  await transaction(async tx => {
    const id = String(req.params.id);
    if (id === actor(res).id) throw new AppError(409, "Cannot delete your own admin account");
    const user = await tx.user.findFirst({ where: { id, deletedAt: null } }); if (!user) throw new AppError(404, "User not found");
    if (user.role === "ADMIN" && await tx.user.count({ where: { role: "ADMIN", isActive: true, deletedAt: null } }) <= 1) throw new AppError(409, "At least one active admin is required");
    if (await tx.shipment.count({ where: { OR: [{ customerId: id }, { courierId: id }], status: { notIn: terminal }, deletedAt: null } })) throw new AppError(409, "Resolve active shipments before deleting user");
    await tx.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, actor(res).id, "user.deleted", "User", id);
  }); return ok(res, null, "User deleted");
});
const auditQuery = pagination.extend({ resourceType: z.string().max(50).optional(), resourceId: z.string().max(100).optional() });
endpoint("get", "/audit-logs", { summary: "Inspect critical action audit logs", roles: ["ADMIN"], query: auditQuery }, async (_req, res) => {
  const q = auditQuery.parse(res.locals.query);
  const where = { ...(q.resourceType ? { resourceType: q.resourceType } : {}), ...(q.resourceId ? { resourceId: q.resourceId } : {}) };
  const [items, total] = await Promise.all([db.auditLog.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { createdAt: q.sort }, include: { actor: { select: { id: true, name: true, role: true } } } }), db.auditLog.count({ where })]);
  return ok(res, { items, meta: pageMeta(q.page, q.limit, total) });
});
endpoint("get", "/statistics", { summary: "Summarize shipment operations and verified revenue", roles: ["ADMIN"] }, async (_req, res) => {
  const [users, shipments, revenue, refunds] = await Promise.all([db.user.groupBy({ by: ["role"], where: { deletedAt: null }, _count: true }), db.shipment.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true }), db.payment.aggregate({ where: { status: "PAID" }, _sum: { amount: true }, _count: true }), db.payment.aggregate({ where: { status: "REFUNDED" }, _sum: { amount: true }, _count: true })]);
  return ok(res, { users, shipments, paidRevenue: revenue._sum.amount || 0, refundedAmount: refunds._sum.amount || 0, currency: "bdt", moneyUnit: "paisa" });
});
export default router;
