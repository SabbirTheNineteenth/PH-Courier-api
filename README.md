# PH Courier & Logistics Backend

Backend-only REST API for the B7A6 Courier & Logistics assignment (student ID last digit **1**). Customers book and pay for shipments, admins manage operations and assign couriers, and couriers record pickup, hub movement, delivery attempts, and returns.

Repository: https://github.com/SabbirTheNineteenth/PH-Courier-api. Full feature commit history is preserved. GitHub PostgreSQL CI passed for revision cd3f1cb on 8 October 2026.

**Hosted API:** https://ph-courier-backend.vercel.app — API docs: https://ph-courier-backend.vercel.app/docs/. The Vercel API uses a dedicated Neon PostgreSQL database. Readiness, deployed admin login, access controls and Swagger assets passed live checks on 8 October 2026. Local tests pass (27 tests). Browser Google sign-in and completed Stripe payment/refund acceptance remain pending; test Checkout creation/expiry does not prove a live charge.

## Start on this computer

The project lives at `D:\PH\courier-backend`. Its private `.env` already contains generated local database/JWT/admin credentials. Keep that file private and do not replace it with `.env.example`.

```powershell
cd D:\PH\courier-backend
npm.cmd run start:local
```

- API: `http://localhost:4000`
- Swagger: `http://localhost:4000/docs`
- Database readiness: `http://localhost:4000/ready`
- Admin email/password: `ADMIN_EMAIL` and `ADMIN_PASSWORD` in your local `.env`.
- Background process logs: `.local/api.log` and `.local/api-error.log`.

`start:local` starts the isolated PostgreSQL 18 cluster on loopback port 55432 if needed, then builds and starts the API in a hidden process. It does not affect the existing PostgreSQL service. For development with automatic reload, use `npm.cmd run dev` after PostgreSQL is running. Stop an existing API process before starting another on the same port; its PID is stored in `.local/api.pid`.

## Stack and organization

Node.js 24, TypeScript, Express 5, PostgreSQL 18, Prisma 7 with the pg adapter, Zod, Argon2id, JWT, Google Auth Library, Stripe Checkout, optional Redis, Helmet, CORS, request limits, Pino, Biome, Vitest, and Supertest.

`src/modules` groups routes/controllers and services by domain. Route definitions hold the runtime validation schemas, role requirements, and documentation metadata. Shipment/payment services hold transactional business operations. `src/lib` supplies the database, audit trail, cache, response definitions, and documentation builders; `src/middleware` authenticates each request against the current user record and returns structured errors.

| Role | Main permissions |
|---|---|
| CUSTOMER | Manage own profile/addresses, quote/book/edit shipments, initiate/verify/expire own payments, track/cancel/archive own eligible shipments |
| COURIER | View only assigned shipments, record permitted shipment transitions, inspect own delivery totals |
| ADMIN | Manage users/couriers/zones/hubs, assign shipments, inspect all operations/audits, advance shipment states, refund eligible paid cancellations |

Public registration always creates a CUSTOMER. Couriers are created by an admin. The seed creates a dedicated admin. Password accounts must authenticate before linking Google; matching email alone does not silently link an account.

## Shipment and payment rules

- Money is stored as integer **paisa**: 100 paisa = 1 BDT. Chargeable kilograms round upward. Fee = origin base + chargeable kg × origin per-kg price + destination base when zones differ.
- Shipments capture address snapshots and server-calculated pricing. Later address/zone edits do not rewrite an existing shipment's address or fee.
- Pickup must be in the future and within 30 days; parcels are 1–30,000 grams.
- State changes and assignment require `expectedVersion`; reload the shipment after a 409 conflict. Serializable transactions retry transient conflicts, and courier workload cannot exceed 10 active shipments.
- Only PAID shipments can be assigned/picked up. There is no COD, manual paid toggle, or production fake payment route.
- Valid path: CREATED → ASSIGNED → PICKED_UP → AT_ORIGIN_HUB → IN_TRANSIT → AT_DESTINATION_HUB → OUT_FOR_DELIVERY → DELIVERED.
- A failed delivery can be retried up to three total attempts, then returned via RETURNING → RETURNED. Hub arrivals must use a hub in the appropriate zone. Delivery/failure/return actions require a note.
- Unpaid cancellation is allowed before pickup after any pending Stripe session is expired. An admin can cancel/refund a PAID shipment before pickup; the shipment is frozen as CANCELLED while the refund is pending. Confirmed failed refunds can be retried with a new provider idempotency key.
- After pickup, cancelled service/refunds are unavailable in this project. Return-to-sender retains the delivery fee.
- Soft deletion archives terminal shipments and preserves database history. Customers see only their own records; couriers see only assigned records. Public tracking reveals status/time only, excluding addresses, names, phone numbers, and event notes.
- Browser success/cancel redirects never mark money paid or cancelled. Stripe API verification or a signed webhook is authoritative. Webhook IDs and provider IDs are unique; repeats are acknowledged without repeating ledger/audit changes.

## Configure your accounts

Fill `GOOGLE_CLIENT_ID`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` in the private `.env`; restart the API afterward. For deployment, supply a hosted `DATABASE_URL`, new strong JWT/admin secrets, HTTPS callback URLs, CORS origins, and the correct `TRUST_PROXY` value. `DIRECT_URL` is optional when migration access differs from the runtime pool connection.

```powershell
npm.cmd run config:check
```

This command reports configured/missing fields without printing their values. An empty external integration returns a structured 503; no placeholder credential is treated as a working integration. See [SETUP.md](docs/SETUP.md) for Google, Stripe, hosting, and final verification.

## API documentation and Postman

[Endpoint inventory](docs/ENDPOINTS.md) lists **46 application endpoints**, plus operational health/docs routes. OpenAPI is available at `/api/v1/openapi.json` and [docs/openapi.json](docs/openapi.json).

Import [courier.postman_collection.json](docs/courier.postman_collection.json) and [courier.postman_environment.json](docs/courier.postman_environment.json) into Postman. Enter the private admin credentials in your local Postman environment. The collection contains all endpoints, examples for each role, and scripts that capture IDs, tokens, and shipment versions. Run requests in the sequence in [API.md](docs/API.md), rather than running all CRUD/administration requests blindly.

Generate synchronized documentation after changing a route:

```powershell
npm.cmd run docs:generate
```

## Verification

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd audit --audit-level=high
```

Tests execute actual HTTP requests against a real PostgreSQL database named with the `_test` suffix. The suite deliberately clears that dedicated database. `TEST_DATABASE_URL` can specify another dedicated test database; otherwise this computer's local `courier_test` is selected. Never point tests at your development/production data.

Coverage includes validation, role escalation prevention, JWT protection, refresh/logout rotation under concurrency, ownership boundaries, live account suspension, Google account linking, integer pricing, immutable addresses, status/hub rules, delivery retry/return rules, concurrent assignment/capacity, signed webhook checks, duplicate events, amount checks, checkout expiry/retry, refund failure/retry, soft deletion, audits, and OpenAPI/Postman coverage. External Google/Stripe calls are mocked only inside tests.

GitHub Actions performs migrations, type/lint/API tests, build, documentation drift detection, and dependency auditing against PostgreSQL 18.

## Deployment and submission

Render configuration is in `docs/deployment/render.yaml`. Vercel uses root `app.js` to export the compiled Express application, with build settings in `vercel.json`. Swagger assets are copied to `public/docs` during the build for Vercel CDN serving. For Vercel, run migrations and seeding against the hosted database before deploying, using its private environment configuration. Render's start command performs both before starting the server.

After deployment, set `LIVE_API_URL` privately and run `npm.cmd run smoke:live`. This checks live readiness, docs, admin login/permissions, and unauthenticated protection. Complete actual Google sign-in and Stripe Checkout/payment/refund checks as described in [SETUP.md](docs/SETUP.md).

[REQUIREMENTS.md](docs/REQUIREMENTS.md) maps assignment requirements to evidence and explicitly lists the remaining external gates. Keep the Git history when pushing your repository; the implementation has more than 20 meaningful backend commits. Your presentation/video and submission links are yours to supply.

Assignment sources: [README](https://github.com/Apollo-Level2-Web-Dev/B7A6), [requirements](https://github.com/Apollo-Level2-Web-Dev/B7A6/blob/main/project_requirements.md), [courier idea](https://github.com/Apollo-Level2-Web-Dev/B7A6/blob/main/idea-hub.md), [timeline](https://github.com/Apollo-Level2-Web-Dev/B7A6/blob/main/timeline-breakdown.md).
