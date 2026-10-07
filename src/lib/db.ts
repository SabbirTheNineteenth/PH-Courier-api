import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";
import { Prisma, PrismaClient } from "../generated/prisma/client.js";
export const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
  }),
});
export type Tx = Prisma.TransactionClient;
export async function transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(run, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034" ||
        attempt >= 3
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
}
