import { z } from "zod";
import { audit } from "../../lib/audit.js";
import { db, transaction } from "../../lib/db.js";
import { createModule } from "../../lib/routes.js";
import { userSelect } from "../../lib/validation.js";
import { actor } from "../../middleware/auth.js";
import { ok } from "../../middleware/http.js";

const { router, endpoint } = createModule("/users");
const profileSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: z
      .string()
      .regex(/^\+?[0-9]{10,15}$/)
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");
endpoint(
  "get",
  "/me",
  { summary: "Get own profile", roles: ["CUSTOMER", "COURIER", "ADMIN"] },
  async (_req, res) =>
    ok(res, await db.user.findUnique({ where: { id: actor(res).id }, select: userSelect })),
);
endpoint(
  "patch",
  "/me",
  { summary: "Update own profile", roles: ["CUSTOMER", "COURIER", "ADMIN"], body: profileSchema },
  async (req, res) =>
    ok(
      res,
      await transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: actor(res).id },
          data: req.body,
          select: userSelect,
        });
        await audit(tx, user.id, "user.profileUpdated", "User", user.id);
        return user;
      }),
      "Profile updated",
    ),
);
export default router;
