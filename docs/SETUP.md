# Account setup and external acceptance

## Local configuration

Open the existing private `.env` in the project folder. Local PostgreSQL/JWT/admin credentials have already been generated and the admin seeded. Preserve those values unless intentionally moving to a different database. The PostgreSQL data lives in `.local/postgres`; both `.local` and `.env` are ignored by Git.

For a fresh clone on another computer: `npm ci`, copy `.env.example` to `.env`, provide an actual PostgreSQL URL and random secrets, run `npx prisma generate`, `npm run db:migrate`, `npm run db:seed`, then `npm run dev`. Create a separate `_test` database and set `TEST_DATABASE_URL` for tests. Prisma migrations create tables; they do not provision the database itself.

Redis is optional. Set `REDIS_URL` to a Redis connection to cache active zones for 60 seconds, with invalidation after zone edits. Pricing always reads the database inside the shipment transaction, so stale cache cannot set the payable amount. Redis failure falls back to PostgreSQL. Redis is not required for the local API to start.

## Google login (GCP)

1. Create/configure a Google Cloud project and OAuth consent screen, then a Web OAuth client in Google Auth Platform. Add the appropriate authorized JavaScript origins for the tool/page where you obtain the identity token.
2. Save the Web client ID as `GOOGLE_CLIENT_ID`. This backend uses Google ID-token verification, so a client secret is not needed by the server.
3. Obtain a current **ID token**, not an OAuth access token, using Google Identity Services for that client ID. Send `{ "idToken": "..." }` to `POST /api/v1/auth/google`.
4. The server verifies Google's signature, issuer, expiry, audience, and verified email with the official library. New Google users receive the CUSTOMER role.
5. If the email is already registered with a password, log in normally and call `POST /api/v1/auth/google/link` with that account's Bearer token and matching Google ID token. Then Google login works for the linked account.
6. Verify actual successful Google login and a rejected invalid/expired token in Postman. Never export real ID/access/refresh tokens in shared documentation.

Reference: [Google server-side ID-token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

## Stripe payments

1. Use a Stripe account you are eligible to operate. Save its secret key in `STRIPE_SECRET_KEY`. An account/secret key alone does not make the assignment's live payment gate verified.
2. Start with Stripe test mode/sandbox to test the actual provider API and signed callbacks. Configure a webhook endpoint at `https://YOUR_API/api/v1/payments/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `refund.created`, and `refund.updated`.
3. Save that endpoint's signing secret as `STRIPE_WEBHOOK_SECRET`. For localhost, use Stripe CLI:

   ```text
   stripe listen --forward-to localhost:4000/api/v1/payments/webhook
   ```

   Use the signing secret printed by that CLI listener for local callbacks. A dashboard endpoint's signing secret differs from the CLI listener's secret.

4. Set `PAYMENT_SUCCESS_URL` and `PAYMENT_CANCEL_URL` to the API's HTTPS success/cancel routes after deploying. Restart/redeploy after changing environment values.
5. As a customer, create a shipment and call `POST /api/v1/payments/initiate` with its ID. Open the returned `checkoutUrl` in your browser; payment always uses the database's integer BDT fee.
6. In **Stripe test mode only**, use a documented test card such as `4242 4242 4242 4242`, any future expiry, and any three-digit CVC. Call `POST /api/v1/payments/:id/verify` after payment; confirm PAID through `GET /api/v1/payments/:id`. Test cards do not perform a real charge.
7. Confirm the signed webhook was processed; repeating delivery must not duplicate the paid audit. Confirm browser redirects by themselves cannot change payment state.
8. As an admin, refund a paid shipment **before pickup**. Confirm REFUNDED or inspect REFUND_PENDING until Stripe confirms success. An external rejection leaves the shipment cancelled and refund pending with failure evidence; retry the refund endpoint after a confirmed failed/cancelled provider refund. Pending provider refunds are reused rather than duplicated.
9. To satisfy any requirement for actual live processing, use an activated eligible Stripe account, live keys, a live webhook signing secret, and a permitted real transaction. Verify amount/currency, PAID state, webhook delivery, and refund behavior against Stripe. Do not describe automated mocks or test-card transactions as a real live charge. Confirm the course's permitted evaluation environment if sandbox acceptance is unclear.

References: [Stripe webhooks](https://docs.stripe.com/webhooks), [Stripe testing](https://docs.stripe.com/testing).

### Local listener helper

The official Stripe CLI is installed on this computer. Run `npm.cmd run stripe:listen` in the project folder to start the hidden local listener using the private `STRIPE_SECRET_KEY`. The helper captures the real CLI signing secret directly into `.env`, keeps logs/process state under gitignored `.local`, and never prints credentials. If it reports a changed secret, restart the API to load it. Restart the listener after restarting the computer; it must be running to forward local events.

On 8 October 2026, an actual Stripe test-mode `customer.created` event was forwarded to `/api/v1/payments/webhook`, its signature verified, and its event ID persisted in PostgreSQL. A duplicate was acknowledged and an invalid signature rejected. The temporary test customer was deleted. This verifies local webhook connectivity and verification, not payment completion. Hosted Stripe endpoints have their own signing secrets.

## Render (alternative)

1. Push this complete Git history to your own GitHub repository. Create a Render Node web service from it, or import the included `docs/deployment/render.yaml` blueprint (set that Blueprint Path in Render). The blueprint selects the free web-service plan and expects an independently supplied PostgreSQL database URL; it does not create a paid database.
2. Build command: `npm ci --include=dev && npm run build`. Start command: `npm run db:migrate && npm run db:seed && npm start`. Health path: `/ready`. Node: `24.15.0`.
3. Set production `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `GOOGLE_CLIENT_ID`, Stripe keys, callback URLs, and CORS origins. Use a dedicated evaluation admin. Set `NODE_ENV=production` and `TRUST_PROXY=1` behind Render's single trusted proxy.
4. Use PostgreSQL TLS settings required by your provider. If runtime uses a pooler, set `DIRECT_URL` to its migration-capable direct connection.
5. Visit `/ready` and `/docs` on the assigned HTTPS URL. Register the exact live Stripe webhook URL and obtain its signing secret.
6. After changing secrets, redeploy. Store `LIVE_API_URL` locally and run `npm run smoke:live` with credentials matching the deployed admin.

Reference: [Render Express deployment](https://render.com/docs/deploy-node-express-app).

## Vercel (selected deployment path)

Root `app.js` exports the compiled Express application from `dist/src/app.js` for Vercel. This avoids differing TypeScript module-resolution behavior in Vercel's framework compiler. The build copies Swagger assets to `public/docs`, since Vercel serves static assets through its CDN. Import the repository, configure the same private environment fields, and use the included `vercel.json` build/install settings. Before deploying, apply migrations and run the seed against the hosted PostgreSQL URL. Runtime connection pooling is capped at 10 per instance; use a provider pooler and appropriate concurrency settings for serverless deployments. Rate limits are per application instance, so multi-instance hosting should additionally enforce distributed limits at the platform/Redis layer.

Set the callback/webhook URLs to the deployed HTTPS origin and rerun live acceptance. The dedicated project is deployed at https://ph-courier-backend.vercel.app and connected to its own Neon Free-plan database in Singapore. Production credentials are configured privately in Vercel. A dedicated Stripe test-mode webhook points to the hosted endpoint; its signing secret differs from the local CLI secret.

Reference: [Vercel Express support](https://vercel.com/docs/frameworks/backend/express).

## Final external checks

- A working hosted HTTPS URL with PostgreSQL-backed `/ready`, admin login, role restrictions, and documented endpoints.
- Real Google ID-token login (valid and invalid token cases).
- Real provider Checkout, amount verification, signature rejection, event replay, cancellation/session expiry, and eligible refund.
- Dedicated demo admin credentials shared privately for evaluation.
- Postman collection published or live `/docs` URL shared.
- Your 5–10 minute API presentation/video and final submission links.

No live API URL, Google provider success, Stripe live charge, or external CI run is claimed until actually verified.

## Local Google acceptance helper

Run npm run google:verify and open http://localhost:3000 on the same computer. Add http://localhost:3000 to the OAuth client's Authorized JavaScript origins. The helper uses Google's popup callback, so no authorized redirect URI is needed for this flow. It checks actual Google login against LIVE_API_URL, Bearer profile access, and repeat identity consistency, then logs out both verification sessions. Tokens are neither displayed nor written to disk. The tool binds to loopback; successful evidence is written to ignored .local/google-acceptance.json.

The working evaluation admin credentials and public links are prepared privately in .local/SUBMISSION.txt. Add your video URL there before submitting; do not publish that credentials file in GitHub.
