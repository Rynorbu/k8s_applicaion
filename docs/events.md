# Event catalog

All events go through one RabbitMQ **topic exchange**, `spendwise.events`. The envelope type is PascalCase, and the routing key is derived from it (`ExpenseCreated` → `expense.created`). Each service has one durable queue (`<service>.events`), three delayed retry queues (5 s, 30 s, 2 min, implemented as TTL plus dead-letter back to the main queue), and a dead-letter queue (`<service>.events.dlq`).

## Envelope

```json
{
  "id": "uuid",                       // idempotency key (inbox table: processed_events)
  "type": "ExpenseCreated",
  "version": 1,
  "source": "expense-service",
  "occurredAt": "2026-10-14T09:30:00.000Z",
  "correlationId": "web-3f1c…",       // from the browser / gateway, preserved across hops
  "causationId": "request or parent event id",
  "userId": "uuid",
  "data": { "...": "full snapshot (event-carried state transfer)" }
}
```

AMQP headers carry the same `x-correlation-id` and the W3C `traceparent`, so consumer spans join the producer's trace.

## Catalog

| Event | Producer | Consumers | Purpose |
|---|---|---|---|
| UserRegistered | auth | user, expense, income, budget, goal, notification, audit | Create profile, replicate settings and contact details, send a welcome |
| UserLoggedIn / LoginFailed / UserLoggedOut | auth | audit, notification (token-reuse alert) | Security trail |
| PasswordResetRequested | auth | notification (email only), audit (URL redacted) | Reset email |
| PasswordChanged | auth | notification, audit | Security notice |
| UserProfileUpdated | user | auth, expense, income, budget, goal, notification, audit | Base currency and name replication |
| **ExpenseCreated** | expense | budget, analytics, notification, ai, audit, search | The core fan-out |
| **ExpenseUpdated** | expense | budget, analytics, ai, audit, search | Includes the `previous` snapshot |
| **ExpenseDeleted** | expense | budget, analytics, ai, audit, search | Tombstones in projections |
| **IncomeCreated / Updated / Deleted** | income | analytics, ai, audit, search, notification (recurring) | |
| CategoryCreated / Updated / Deleted | category | expense, income, budget, recurring, analytics, search, ai, audit | Name changes and fallback reassignment |
| BudgetCreated | budget | audit | |
| **BudgetWarning / BudgetExceeded** | budget | notification, audit | At most once per budget period (unique constraint) |
| **RecurringTransactionCreated** | recurring | notification, audit | |
| RecurringTransactionDue | recurring | expense, income, audit | Generation; idempotent per (rule, date) |
| **GoalCreated** | goal | audit | |
| GoalContributionAdded | goal | audit | |
| **GoalMilestoneReached** | goal | notification, audit | 25/50/75/100 %, each announced once |
| ReportRequested | report | report (async worker), audit | |
| **ReportGenerated** / ReportFailed | report | notification, audit | |
| ReceiptUploaded | file | audit | |
| ImportBatchReady | file | expense, income, audit | ≤ 200 rows per batch; idempotent per (import, row) |
| **FileImported** | file | notification, audit | Import summary |
| AnomalyDetected | ai | notification, audit | Robust z-score > 3.5 and ≥ 2× the median |
| ExchangeRatesUpdated | currency | audit | |

Events in **bold** are the ones required by the specification.

## Reliability guarantees

| Concern | Mechanism |
|---|---|
| Lost events (dual write) | **Transactional outbox**: the event row commits atomically with the business change. A relay publishes with **publisher confirms**, using `FOR UPDATE SKIP LOCKED` so it is safe with many replicas. |
| Duplicates (at-least-once) | **Inbox**: `processed_events(event_id, consumer)` is inserted in the same transaction as the handler's side effects; duplicates are skipped. |
| Transient failures | Retry queues with increasing TTL (5 s → 30 s → 2 min) |
| Poison messages | Dead-letter queue after the final retry, plus the `events_consumed_total{outcome="dead_letter"}` metric and a Prometheus alert |
| Out-of-order delivery | Projections keep a `version` column and apply `WHERE version <= EXCLUDED.version`; deletes are tombstones |
| Broker outage | The outbox accumulates (`outbox_pending_events` gauge and alert), the client reconnects with backoff, and the HTTP API keeps working |
| Traceability | Correlation ID and trace context are carried in the envelope and headers; the audit log is searchable by correlation ID |
