# Assignment requirement audit

Sources: [assignment README](https://github.com/Apollo-Level2-Web-Dev/B7A6) and [project requirements](https://github.com/Apollo-Level2-Web-Dev/B7A6/blob/main/project_requirements.md), reviewed 7 October 2026. The selected domain for last ID digit 1 is Courier & Logistics. Courier idea-hub features are starting-point suggestions; mandatory rules are enforced below.

## Implementation and local evidence

| Requirement | Implementation/evidence | State |
|---|---|---|
| Backend-only Node/TypeScript/Express API | `package.json`, strict `tsconfig.json`, compiled `src/server.ts`; no frontend required | Implemented and locally built |
| PostgreSQL + Prisma relationships, unique keys, indexes, transactions | `prisma/schema.prisma`, two reproducible SQL migrations, pg adapter, serializable transaction retry; local PostgreSQL 18 | Migrated; schema drift check reports no difference |
| 3 fixed primary roles | CUSTOMER, COURIER, ADMIN enum; current-account auth + role middleware; admin-only courier creation | Tested with real database |
| Email/password auth | Argon2id password hashes, normalized email, JWT Bearer access tokens | Tested |
| GCP social login | Google audience/signature/issuer/expiry/verified-email checks through official library; authenticated Google linking | Configured; mocked integration tests pass; real browser Google acceptance pending |
| Token management | Hashed expiring refresh tokens, one-use rotation under concurrency, logout revocation | Tested |
| At least 20 meaningful APIs | 46 application endpoints listed in `ENDPOINTS.md` | Implemented |
| Versioned REST naming | `/api/v1` domains and HTTP methods; operational `/health`, `/ready`, `/docs` outside resource API | Implemented |
| Server-side validation | Strict Zod schemas for applicable bodies, UUID paths, query pagination/filter/status | Tested |
| Consistent JSON success/error envelopes | `src/middleware/http.ts`; framework/parsing/404/role/rate-limit errors use standard responses | Tested; OpenAPI/Swagger are documentation formats |
| Pagination, filtering, sorting, relevant search | Shipment/user/hub/courier lists with bounded page/limit; shipment status/search, user role/search, created-at sort | Tested |
| Meaningful CRUD | Profiles, addresses, zones, hubs, shipments, admin users with constrained writes/soft deletion | Implemented and tested |
| Logistics business logic beyond CRUD | Integer server pricing, owned-address snapshots, paid-only assignment, hub/zone integrity, state machine, delivery retries, return workflow | Tested |
| Transactions/concurrency/race prevention | Shipment versions, serializable retries, workload checks, one-time refresh, payment/webhook idempotency | Same-version assignment, last-slot capacity, refresh, checkout, webhook tests pass |
| Soft deletes | `deletedAt` and guarded archive/retirement for domain resources; historical records retained | Tested |
| Critical audit/activity records | Transactional AuditLog plus ShipmentEvent history for accounts/access/resources/payment/workflow | Tested |
| Security | Argon2id; no privileged public registration; current-account checks; safe selects; Helmet; CORS allowlist; body/request/auth limits | Role, ownership, token, suspension, CORS/header tests pass |
| Performance/code quality | Indexed Prisma queries, selected private user fields, bounded lists, modular services, Biome, optional Redis zone cache | Build/typecheck/lint pass; optional Redis instance not configured locally |
| Real gateway integration | Actual Stripe SDK Checkout/API verification/raw signature checks/refunds, provider idempotency; no fake production payment route | Actual test-mode Checkout creation/reuse, provider verification, signed expiry webhook and retry verified; completed payment/refund pending |
| Payment creation/success/cancellation/status | Checkout initiation/reuse, verified signed events, backend verification, unpaid session expiry/retry, paid pre-pickup refund with failure retry | Tested with real database; actual provider Checkout/expiry verified; completed payment/refund pending |
| Complete API docs | OpenAPI request/resource schemas, validated document, 46-endpoint Postman collection/environment, generated inventory | Validation/coverage/request-template tests pass |
| Demo admin email/password | Random private credentials in local `.env`; safe idempotent seed; working local admin login | Local and deployed admin login verified |
| Minimum 20 meaningful backend commits | Feature-specific Git commits; `git log --oneline`, `git rev-list --count HEAD` | Satisfied; complete history published to the user-owned repository |
| Working deployment/live URL | Render blueprint, Vercel native Express export/build settings, deployment instructions, live smoke helper | Deployed on Vercel with dedicated Neon PostgreSQL; live readiness/auth/docs/provider Checkout/expiry verified; Google success and paid workflow pending |
| Tests/QA | `npm run check`, build, migration status/drift, npm audit, local runtime readiness/login | 27 local tests pass; Vercel build and public smoke/provider checks pass; GitHub PostgreSQL CI passed for cd3f1cb |
| Presentation/video | User will handle the required 5 to 10 minute API walkthrough | User-owned pending deliverable |

## Required final gates

The whole assignment is **not yet externally complete**. Provider credentials and hosted API are configured. Live readiness, admin login, docs, Stripe Checkout/expiry/webhook and invalid Google rejection are verified. Complete browser payment/login and browser identity/payment acceptance:

1. Valid real GCP Google ID-token login and rejection of invalid identity tokens.
2. Actual Stripe provider Checkout, matching amount/currency, signed webhook, backend PAID verification, duplicate handling, unpaid expiry, and eligible refund. Mocked tests do not demonstrate a live charge. If a real charge is required by evaluation, verify with an eligible activated account and live keys.
3. Hosted readiness, admin authentication, private-route protection, docs and unpaid payment workflow passed at https://ph-courier-backend.vercel.app. Complete the paid courier/delivery/refund walkthrough there.
4. Working deployed dedicated admin credentials, published API docs link, repository URL preserving commits, and the user-produced presentation/video link.

No missing credential is filled with an invented key, no deployment URL is fabricated, and no automated provider mock is described as a real payment.
