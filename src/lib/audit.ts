import type { Tx } from "./db.js";
import type { Prisma } from "../generated/prisma/client.js";
export async function audit(tx: Tx, actorId: string | null, action: string, resourceType: string, resourceId: string, details?: Prisma.InputJsonValue) {
  await tx.auditLog.create({ data: { actorId, action, resourceType, resourceId, ...(details === undefined ? {} : { details }) } });
}
