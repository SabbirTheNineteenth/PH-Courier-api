# API usage and walkthrough

Base path: `/api/v1`. Every private route uses `Authorization: Bearer <accessToken>`. Access tokens live for 15 minutes by default; refresh tokens last seven days, are stored hashed, and rotate once. Logout revokes the supplied refresh token; an existing access token expires naturally. Role/suspension/deletion changes are read from the database on every private request.

## Responses

```json
{"success":true,"message":"Shipment created","data":{"id":"uuid","price":16000,"currency":"bdt","status":"CREATED","version":0}}
```

```json
{"success":false,"message":"Validation failed","errors":[{"path":"email","message":"Invalid email address"}]}
```

List result example: `data: { items: [...], meta: { page: 1, limit: 10, total: 23, totalPages: 3 } }`. A 400 indicates invalid input, 401 invalid/missing authentication, 403 disallowed role, 404 inaccessible/missing resource, 409 invalid workflow or stale version, 429 rate limit, 502 provider request failure, and 503 missing integration configuration. UUID path IDs and query parameters are validated. All POST/PATCH request bodies are strict schemas; undeclared fields are rejected.

OpenAPI includes request validation, role permissions, typed resources, and response envelopes. [ENDPOINTS.md](ENDPOINTS.md) lists the complete endpoint set.

## Interactive Postman sequence

Import the collection and environment, then select the environment. Enter `adminEmail`/`adminPassword` privately from `.env`. The collection is an endpoint reference; a single automatic run of every endpoint includes operations that intentionally conflict with business state. Choose the following requests for a successful walkthrough.

1. Register/sign in as the customer. The collection saves `customerToken` and `refreshToken`. Sign in as admin using the separate admin request; it saves `adminToken`.
2. Get zones. The script saves `originZoneId` and `destinationZoneId`. List hubs and select a hub in each matching zone; save them as `originHubId` and `destinationHubId`.
3. As admin, create a courier and use the separate courier sign-in request. The collection saves `courierId` and `courierToken`.
4. As customer, create two addresses: first in the origin zone, second in the destination zone. Their IDs are saved as `pickupAddressId`/`deliveryAddressId`. The latest address ID is saved as `addressId` for update/delete examples.
5. Quote a fee and create a shipment. The script sets a future pickup date and saves `shipmentId`, `trackingNumber`, and `shipmentVersion`. Optional edits are allowed only before starting payment; reload the shipment after each mutation/conflict.
6. Initiate payment. The collection saves `paymentId` and `checkoutUrl`. Open that URL and complete the actual Stripe Checkout flow. Verify payment and get its state. See [SETUP.md](SETUP.md) for provider configuration and the distinction between test and real charges.
7. As admin, assign the saved courier with the current `shipmentVersion`. Assignment requires verified PAID status. The collection saves the new version.
8. As courier, advance status with the current version. Send one status at a time:

   ```text
   PICKED_UP
   AT_ORIGIN_HUB       + hubId = originHubId
   IN_TRANSIT
   AT_DESTINATION_HUB  + hubId = destinationHubId
   OUT_FOR_DELIVERY
   DELIVERED          + note = delivery proof/reference
   ```

   Omit `hubId` for states other than hub arrival. The default status template is PICKED_UP without a hub. Add `hubId` for hub arrival and `note` for delivery/failure/return states.

9. Demonstrate private detail/list and public tracking. Search: `/shipments?search=Books&page=1&limit=10&status=DELIVERED&sort=desc`. Courier list results contain only assigned work; customer results contain only owned work. Only admins may filter by `customerId`/`courierId`.
10. Archive the delivered shipment, then show its private GET returns 404. Its database history remains stored. Show admin audit logs and statistics.

## Failure, return, and refund demonstrations

Use separate shipments for these mutually exclusive paths:

- **Unpaid cancellation:** create shipment → optionally initiate checkout → expire that unpaid checkout → cancel shipment with a reason and current version.
- **Paid cancellation/refund:** create shipment → pay → admin refund before pickup. The endpoint atomically freezes the shipment as CANCELLED, requests a real Stripe refund, and records REFUND_PENDING/REFUNDED. Calling it again reuses an in-flight refund or retries a provider-confirmed failure.
- **Failed delivery and return:** progress to OUT_FOR_DELIVERY → FAILED_DELIVERY with reason → retry OUT_FOR_DELIVERY up to three total attempts → RETURNING with reason → RETURNED with handover note. A fourth delivery attempt is rejected.
- **Invalid transition:** attempt CREATED → DELIVERED; expect 409.
- **Stale update:** resend a status mutation with the old version; expect 409.
- **Cross-role access:** use a customer token on `/admin/users`; expect 403. Use an unrelated customer/courier token for another shipment; expect 404.
- **Validation:** send an invalid email/negative weight/unrecognized role field; expect structured 400. Omit the token from `/users/me`; expect 401.

Google sign-in is a distinct flow: obtain a real ID token for the configured GCP client and send it to `/auth/google`. Password accounts must link Google while authenticated before using it to sign in.

## Payment trust boundary

Amounts are never accepted from the client. Checkout creation uses server-owned shipment pricing and stable provider idempotency keys. Webhooks require the exact raw request bytes and Stripe signature. Successful payment requires matching payment ID, attempt, session, shipment reference, amount, and currency. A successful browser return is only a notice. Unknown old-attempt events cannot rewrite a newer payment attempt. Public responses never reveal password hashes, provider keys, address data through public tracking, or private audit notes.

The webhook placeholder in the Postman collection cannot produce a valid Stripe signature. Use Stripe CLI/dashboard event delivery; sending an invented body/signature should return 400.
