import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const source = dirname(require.resolve("swagger-ui-dist/package.json"));
const target = "public/docs";
await mkdir(target, { recursive: true });
for (const name of [
  "swagger-ui.css",
  "swagger-ui-bundle.js",
  "swagger-ui-standalone-preset.js",
  "favicon-16x16.png",
  "favicon-32x32.png",
]) {
  await copyFile(join(source, name), join(target, name));
}
console.log("Swagger assets copied for Vercel CDN serving");
