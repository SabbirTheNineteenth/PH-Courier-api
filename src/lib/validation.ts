import { z } from "zod";
export const uuid = z.uuid();
export const idParams = z.object({ id: uuid });
export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(["asc", "desc"]).default("desc"),
});
export const pageMeta = (page: number, limit: number, total: number) => ({ page, limit, total, totalPages: Math.ceil(total / limit) });
export const userSelect = { id: true, email: true, name: true, phone: true, role: true, isActive: true, createdAt: true } as const;
