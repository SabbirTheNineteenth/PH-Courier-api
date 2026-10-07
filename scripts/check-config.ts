import "dotenv/config";

const keys = [
  "DATABASE_URL",
  "JWT_SECRET",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "GOOGLE_CLIENT_ID",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];
let missing = false;
for (const key of keys) {
  const configured =
    !!process.env[key]?.trim() && !/REPLACE_WITH|YOUR_DATABASE/.test(process.env[key] || "");
  console.log(`${key}: ${configured ? "configured" : "missing"}`);
  if (!configured) missing = true;
}
if (missing) {
  console.log(
    "Fill the missing values in your private .env file or hosting environment. No secret values are printed.",
  );
  process.exitCode = 1;
}
