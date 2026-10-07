import { db } from "../../lib/db.js";
import { createModule } from "../../lib/routes.js";
import { pageMeta, pagination, userSelect } from "../../lib/validation.js";
import { actor } from "../../middleware/auth.js";
import { ok } from "../../middleware/http.js";
import { terminal } from "../shipments/shipment.rules.js";

const { router, endpoint } = createModule("/couriers");
endpoint(
  "get",
  "/",
  { summary: "List available couriers and current workload", roles: ["ADMIN"], query: pagination },
  async (_req, res) => {
    const q = pagination.parse(res.locals.query);
    const where = {
      role: "COURIER" as const,
      isActive: true,
      deletedAt: null,
      ...(q.search ? { name: { contains: q.search, mode: "insensitive" as const } } : {}),
    };
    const [items, total] = await Promise.all([
      db.user.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: q.sort },
        select: {
          ...userSelect,
          _count: {
            select: { deliveries: { where: { status: { notIn: terminal }, deletedAt: null } } },
          },
        },
      }),
      db.user.count({ where }),
    ]);
    return ok(res, {
      items: items.map(({ _count, ...user }) => ({
        ...user,
        activeShipments: _count.deliveries,
        capacity: 10,
        available: _count.deliveries < 10,
      })),
      meta: pageMeta(q.page, q.limit, total),
    });
  },
);
endpoint(
  "get",
  "/me/statistics",
  { summary: "Get own assigned shipment totals by state", roles: ["COURIER"] },
  async (_req, res) =>
    ok(
      res,
      await db.shipment.groupBy({
        by: ["status"],
        where: { courierId: actor(res).id, deletedAt: null },
        _count: true,
      }),
    ),
);
export default router;
