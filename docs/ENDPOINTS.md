# API endpoint inventory

46 application endpoints, including the signed Stripe webhook. Health, readiness, and documentation routes are additional operational endpoints.

| Method | Route | Roles | Purpose |
|---|---|---|---|
| POST | `/api/v1/addresses` | CUSTOMER | Create a saved customer address |
| GET | `/api/v1/addresses` | CUSTOMER | List own saved addresses |
| PATCH | `/api/v1/addresses/:id` | CUSTOMER | Update own saved address |
| DELETE | `/api/v1/addresses/:id` | CUSTOMER | Soft-delete own saved address |
| GET | `/api/v1/admin/users` | ADMIN | List users with pagination search and role filtering |
| POST | `/api/v1/admin/couriers` | ADMIN | Create a courier account; public registration cannot choose a role |
| PATCH | `/api/v1/admin/users/:id` | ADMIN | Change user role or suspend account with workload safeguards |
| DELETE | `/api/v1/admin/users/:id` | ADMIN | Soft-delete an account after its shipments are resolved |
| GET | `/api/v1/admin/audit-logs` | ADMIN | Inspect critical action audit logs |
| GET | `/api/v1/admin/statistics` | ADMIN | Summarize shipment operations and verified revenue |
| POST | `/api/v1/auth/register` | Public | Register a customer |
| POST | `/api/v1/auth/login` | Public | Sign in with email and password |
| POST | `/api/v1/auth/refresh-token` | Public | Rotate a single-use refresh token |
| POST | `/api/v1/auth/logout` | Public | Revoke a refresh token |
| POST | `/api/v1/auth/google` | Public | Sign in with a verified Google ID token |
| POST | `/api/v1/auth/google/link` | CUSTOMER, COURIER, ADMIN | Link Google to the signed-in account |
| GET | `/api/v1/couriers` | ADMIN | List available couriers and current workload |
| GET | `/api/v1/couriers/me/statistics` | COURIER | Get own assigned shipment totals by state |
| GET | `/api/v1/hubs` | CUSTOMER, COURIER, ADMIN | List hubs with pagination and zone filtering |
| POST | `/api/v1/hubs` | ADMIN | Create a hub inside an active zone |
| PATCH | `/api/v1/hubs/:id` | ADMIN | Update hub details |
| DELETE | `/api/v1/hubs/:id` | ADMIN | Retire a hub with no active shipments |
| GET | `/api/v1/payments/success` | Public | Checkout return notice; authenticated verification is still required |
| GET | `/api/v1/payments/cancel` | Public | Checkout cancellation notice; does not change financial state |
| POST | `/api/v1/payments/initiate` | CUSTOMER | Open or reuse a real Stripe Checkout session |
| GET | `/api/v1/payments/:id` | CUSTOMER, ADMIN | Get own payment state |
| POST | `/api/v1/payments/:id/verify` | CUSTOMER, ADMIN | Verify payment directly with Stripe |
| POST | `/api/v1/payments/:id/expire` | CUSTOMER, ADMIN | Expire unpaid Stripe checkout before cancelling or retrying |
| POST | `/api/v1/payments/:id/refund` | ADMIN | Refund and cancel a paid shipment before pickup |
| POST | `/api/v1/shipments/quote` | CUSTOMER, ADMIN | Calculate a delivery fee in paisa |
| GET | `/api/v1/shipments/track/:trackingNumber` | Public | Public tracking with no customer contact details |
| POST | `/api/v1/shipments` | CUSTOMER | Create a shipment using owned saved addresses |
| GET | `/api/v1/shipments` | CUSTOMER, COURIER, ADMIN | List visible shipments with search, status filtering and pagination |
| GET | `/api/v1/shipments/:id` | CUSTOMER, COURIER, ADMIN | Get a visible shipment and tracking history |
| PATCH | `/api/v1/shipments/:id` | CUSTOMER | Edit own shipment before opening payment |
| DELETE | `/api/v1/shipments/:id` | CUSTOMER, ADMIN | Archive a terminal shipment using soft deletion |
| POST | `/api/v1/shipments/:id/assign` | ADMIN | Assign or reassign an available courier |
| PATCH | `/api/v1/shipments/:id/status` | COURIER, ADMIN | Advance an assigned shipment through valid states |
| POST | `/api/v1/shipments/:id/cancel` | CUSTOMER, ADMIN | Cancel an unpaid shipment before pickup |
| GET | `/api/v1/users/me` | CUSTOMER, COURIER, ADMIN | Get own profile |
| PATCH | `/api/v1/users/me` | CUSTOMER, COURIER, ADMIN | Update own profile |
| GET | `/api/v1/zones` | CUSTOMER, COURIER, ADMIN | List active service zones and pricing |
| POST | `/api/v1/zones` | ADMIN | Create a service zone; prices in paisa |
| PATCH | `/api/v1/zones/:id` | ADMIN | Update service zone pricing |
| DELETE | `/api/v1/zones/:id` | ADMIN | Retire a zone with no active shipments or hubs |
| POST | `/api/v1/payments/webhook` | Stripe signature | Receive and verify payment/refund events |
