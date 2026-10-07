import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closeCache } from "./lib/cache.js";
import { db } from "./lib/db.js";
import { logger } from "./lib/logger.js";

await db.$connect();
const server = createApp().listen(env.PORT, "0.0.0.0", () =>
  logger.info({ port: env.PORT }, "Courier API listening"),
);
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(1), 10000);
  timer.unref();
  server.close(() => {
    Promise.all([db.$disconnect(), closeCache()]).then(
      () => {
        clearTimeout(timer);
        process.exit(0);
      },
      (error) => {
        logger.error({ err: error }, "Shutdown failed");
        process.exit(1);
      },
    );
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
