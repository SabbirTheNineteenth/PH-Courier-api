import "dotenv/config";
import argon2 from "argon2";
import { z } from "zod";
import { db, transaction } from "../src/lib/db.js";
import { audit } from "../src/lib/audit.js";
const settings = z.object({ ADMIN_EMAIL: z.email(), ADMIN_PASSWORD: z.string().min(16).max(128) }).parse(process.env);
try {
  const passwordHash = await argon2.hash(settings.ADMIN_PASSWORD, { type: argon2.argon2id });
  await transaction(async tx => {
    const existing = await tx.user.findUnique({ where: { email: settings.ADMIN_EMAIL.toLowerCase() } });
    if (existing && (existing.role !== "ADMIN" || !existing.isActive || existing.deletedAt)) throw new Error("Seed email belongs to a non-active-admin account; choose a dedicated admin email");
    const admin = existing || await tx.user.create({ data: { email: settings.ADMIN_EMAIL.toLowerCase(), passwordHash, name: "Demo Admin", role: "ADMIN" } });
    if (!existing) await audit(tx, admin.id, "admin.seeded", "User", admin.id);
    for (const zone of [{ name: "Dhaka", basePrice: 6000, perKgPrice: 2000 }, { name: "Chattogram", basePrice: 10000, perKgPrice: 2500 }, { name: "Sylhet", basePrice: 10000, perKgPrice: 2500 }]) {
      const result = await tx.zone.upsert({ where: { name: zone.name }, create: zone, update: {} });
      await tx.hub.upsert({ where: { zoneId_name: { zoneId: result.id, name: `${zone.name} Central Hub` } }, create: { zoneId: result.id, name: `${zone.name} Central Hub`, address: `${zone.name} central logistics depot` }, update: {} });
    }
  });
  console.log("Seed complete. Admin credentials are the ADMIN_EMAIL and ADMIN_PASSWORD values in your local .env file. Existing admin passwords are never overwritten.");
} finally { await db.$disconnect(); }
