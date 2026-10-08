# Local verification record

Verified on 7 October 2026 in `D:\PH\courier-backend` with Node 24.15.0, PostgreSQL 18.4, and Prisma 7.10.0.

| Check | Authoritative result |
|---|---|
| `npm run check` | TypeScript passed; Biome passed for source/tests/scripts/config; 3 source test files, **27 tests passed** |
| `npm run build` | Prisma client generated and TypeScript compiled successfully |
| `prisma migrate status` | Two migrations applied; database schema up to date |
| `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | No difference detected |
| `npm audit --audit-level=high` | Zero vulnerabilities reported |
| `npm run docs:generate` | 46 application endpoints; OpenAPI, Postman collection/environment, and inventory generated |
| OpenAPI validation | Resource references resolved and document validated in tests |
| Postman validation | Coverage checked; every generated request body template tested against its runtime Zod schema |
| Compiled server HTTP smoke | `/health`, `/ready`, `/docs/`, OpenAPI, seeded ADMIN login/permissions, 401 protection, validation, logout passed |
| Missing-provider behavior | Google endpoint returned structured 503; configuration helper reports Google/Stripe keys missing |
| Git/secret handling | More than 20 meaningful commits; private `.env` and `.local` are ignored |

The API is running locally at `http://127.0.0.1:4000`, with Swagger at `http://127.0.0.1:4000/docs`. Use `npm run start:local` after a restart. Admin credentials remain only in the private `.env`.

The isolated development database is `courier`; automated tests use and clear `courier_test`. PostgreSQL binds only to loopback port 55432, separate from the machine's existing PostgreSQL service.

External Google and Stripe calls are mocked inside automated tests. The production code calls the actual provider libraries and has no fake-payment route. Real GCP login, Stripe provider payment/refund, public deployment, and external CI execution remain unverified until credentials/hosting are configured. Optional Redis is implemented but no live Redis instance is configured locally.

Refer to [REQUIREMENTS.md](REQUIREMENTS.md) for the complete requirement audit and [SETUP.md](SETUP.md) for the remaining account/deployment checks. The presentation/video is user-owned.

## Webhook verification update: 8 October 2026

Google client ID, Stripe test-mode secret key, and Stripe CLI signing secret are configured privately. The hidden Stripe listener is forwarding to the local API, and the API was restarted to load the configured values.

Actual Stripe test-mode event forwarding, signature verification, database event recording, duplicate acknowledgment, and invalid-signature rejection passed. Only a temporary test customer was created and cleaned up; no payment/charge was created. Machine-readable evidence is saved privately under `.local/webhook-connectivity.json`. Run `npm.cmd run stripe:listen` to restart forwarding after a computer restart.

Actual Google identity login, Stripe Checkout/payment/refund completion, and public hosting acceptance remain separate pending checks. The local CLI secret applies to local forwarding; use the deployed endpoint's own signing secret for hosting.

## Checkout acceptance update: 8 October 2026

The running API created an actual Stripe test-mode Checkout session for a temporary customer shipment. Stripe's retrieved session matched the database amount, BDT currency, shipment reference, and payment metadata. Repeated initiation reused the session. Provider verification correctly left the unpaid payment PENDING.

Expiring the first session directly through Stripe caused the actual signed `checkout.session.expired` event to change the database payment to CANCELLED, without calling the API verification endpoint. Re-initiation created a new session with an incremented attempt. The API expiry endpoint then expired that session at Stripe and confirmed CANCELLED locally.

Both sessions remain expired at the provider. The temporary account, addresses, and cancelled shipment were soft-deleted through the API, and refresh tokens were revoked. No payment/charge was created. Private machine-readable evidence: `.local/stripe-checkout-acceptance.json`.

Real browser Google login, completed Stripe test-card payment and eligible refund, public deployment, and repository publication still require acceptance. Local webhook and Checkout creation/expiry are now verified against the actual provider.
