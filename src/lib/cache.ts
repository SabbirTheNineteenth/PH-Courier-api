import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { createClient } from "redis";
const redis = env.REDIS_URL ? createClient({ url: env.REDIS_URL, socket: { connectTimeout: 2000, reconnectStrategy: false } }) : null;
redis?.on("error", error => logger.warn({ message: error.message }, "Redis unavailable; using database"));
let connecting: Promise<unknown> | null = null;
export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!redis) return load();
  try {
    if (!redis.isOpen) { connecting ??= redis.connect().finally(() => { connecting = null; }); await connecting; }
    const value = await redis.get(key);
    if (value) return JSON.parse(value) as T;
  } catch { return load(); }
  const result = await load();
  try { await redis.set(key, JSON.stringify(result), { EX: 60 }); } catch { /* Cache is optional. */ }
  return result;
}
export async function invalidate(key: string) { try { if (redis?.isReady) await redis.del(key); } catch { /* TTL bounds stale cache. */ } }
export async function closeCache() { if (redis?.isOpen) await redis.quit(); }
