# Architecture

## Goals

1. **Clear service boundaries.** Each of the 17 services owns one business capability and its own data.
2. **Loose coupling.** Services integrate through events by default, and through REST only when a synchronous answer is required.
3. **Production behaviour.** The system must survive failures, scale horizontally, be observable, and be secure by default.

## Building blocks

```
shared/common  ─ platform library used by every service
  config.js        fail-fast env validation (zod)
  logger.js        pino JSON logs + request/correlation/trace ids + secret redaction
  tracing.js       OpenTelemetry SDK (loaded with node --import before the app)
  metrics.js       Prometheus registry, HTTP/event/outbox metrics
  http.js          hardened Express app: helmet, request context, access logs, health, docs, errors
  router.js        ApiRouter: one declaration → auth + validation + handler + OpenAPI
  auth.js          RS256/JWKS verification, roles, internal service token
  db.js            pg pool, transactions, advisory-locked SQL migrations
  messaging.js     outbox, relay, consumer with inbox/retries/DLQ, trace propagation
  serviceClient.js REST client: timeout, retries, circuit breaker, context propagation
```

Each service follows the same layout:

```
services/<name>/
  src/index.js      composition root: config → db → migrations → bus → app → server
  src/app.js        routes (ApiRouter) → OpenAPI is generated from the same definitions
  src/service.js    business logic + event handlers
  src/<domain>.js   pure domain logic (unit-tested in isolation)
  migrations/*.sql  forward-only migrations applied at startup under an advisory lock
  tests/unit, tests/integration
  Dockerfile
```

## Data ownership

| Service | Database | Main tables |
|---|---|---|
| auth | `auth` | users, refresh_tokens, password_reset_tokens |
| user | `users` | profiles |
| expense | `expenses` | expenses, user_settings (replica) |
| income | `incomes` | incomes, user_settings (replica) |
| category | `categories` | categories (seeded built-ins + custom) |
| budget | `budgets` | budgets, budget_transactions (projection), budget_alerts |
| recurring | `recurring` | recurring_rules, recurring_occurrences |
| goal | `goals` | goals, goal_contributions, goal_milestones |
| analytics | `analytics` | transactions (read model) |
| notification | `notifications` | notifications, notification_preferences, recipients, email_log |
| report | `reports` | reports (+ files on a volume) |
| search | `search` | search_documents (tsvector + trigram indexes) |
| currency | `currency` | currencies, exchange_rates |
| audit | `audit` | audit_logs (append-only, hash-chained) |
| ai | `ai` | ai_transactions (projection), insights |
| file | `files` | files, imports (+ blobs on a volume) |

Every database also contains `outbox`, `processed_events` and `schema_migrations`.

**Event-carried state transfer.** Services that need another service's data keep a local, event-fed copy instead of calling it. For example, expense-service keeps each user's base currency, and analytics keeps category names and colours. This removes runtime coupling and N+1 network calls.

## Synchronous calls (and why)

| Caller → callee | Why it must be synchronous | Resilience |
|---|---|---|
| expense/income → category `/internal/categories/:id`, `/resolve` | Reject invalid categories and auto-categorize *before* saving | 3 s timeout, 2 retries, circuit breaker |
| expense/income → currency `/internal/convert` | Store an immutable base-currency snapshot at the historical rate | Redis-cached rates, offline seed rates |
| expense → file `/internal/files/:id` | Verify receipt ownership | |
| user → currency `/internal/currencies/:code` | Validate a base-currency change | |
| report → analytics/expense/income `/internal/*` | Assemble report data in the async worker | 15 s timeout; 503 → event retry |
| gateway → 7 services | Dashboard BFF aggregation | `Promise.allSettled`, partial results |

Internal endpoints require `x-internal-token` (compared timing-safe) and are never routed by the gateway. In Kubernetes, NetworkPolicies add a second layer of protection.

## Consistency model

* **Strong** inside a service: database transactions, optimistic concurrency on expenses and incomes (`version`), and unique constraints for idempotency (recurring occurrences, import rows, alerts, milestones).
* **Eventual** across services: projections converge after an event is processed, typically in tens of milliseconds locally.
* Projections are **idempotent and order-tolerant**: they use version guards and tombstones.

## Scalability

* All services are stateless apart from report and file storage, so they scale out behind Kubernetes Services. HPAs scale on CPU and memory.
* Every background job is safe with N replicas:
  * the outbox relay and recurring scheduler use `FOR UPDATE SKIP LOCKED`;
  * FX refresh uses `pg_try_advisory_xact_lock`;
  * migrations use `pg_advisory_lock`.
* RabbitMQ competing consumers spread a service's queue across its replicas; the prefetch setting bounds work in flight.
* Redis provides analytics caching (per-user versioned keys, invalidated by events), FX caching, distributed rate limiting and the token deny-list.

## Observability

* **Traces:** browser `traceparent` → gateway (http) → service (express, pg, ioredis, undici) → outbox (context captured at write time) → RabbitMQ publish span → consumer span in every subscriber. Everything is exported over OTLP to the collector and on to Jaeger.
* **Metrics:**
  * HTTP latency histograms;
  * events published, consumed (by outcome) and processing time;
  * outbox backlog;
  * business counters (expenses created, budget alerts, anomalies);
  * Node.js runtime metrics.
* **Logs:** JSON lines with `service`, `requestId`, `correlationId`, `userId`, `traceId` and `spanId`, with secrets redacted.
* **Health:** `/health/live` (process) and `/health/ready` (database, broker, Redis) back the Kubernetes probes.
* **Alerts:** service down, 5xx ratio, p95 latency, outbox backlog, and dead-lettered events.
