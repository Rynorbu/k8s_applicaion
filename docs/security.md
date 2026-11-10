# Security design (OWASP Top 10, 2021)

| OWASP risk | Controls in SpendWise |
|---|---|
| **A01 Broken Access Control** | Every query is scoped by `user_id` taken from the verified JWT, never from client input. Resources owned by someone else return 404, which prevents ID enumeration. Admin-only routes use role checks. `/internal/*` endpoints need a service token and are not routable from outside. The gateway strips spoofable headers (`x-internal-token`, `x-user-id`). Kubernetes NetworkPolicies default-deny ingress. Each database role can only CONNECT to its own database. |
| **A02 Cryptographic Failures** | Passwords use argon2id (m=19 MiB, t=2, p=1). JWTs are RS256 with private keys only in Secrets and public keys published via JWKS. Refresh and reset tokens are 384-bit random values stored only as SHA-256 hashes. TLS terminates at the Ingress via cert-manager. Cookies are `Secure` in production. |
| **A03 Injection** | All SQL is parameterised. Dynamic `ORDER BY` uses allow-listed maps only. LIKE wildcards are escaped. Full-text queries go through `websearch_to_tsquery`. zod validates every body, query and path parameter. Strict schemas (`.strict()`) prevent mass assignment, e.g. `roles` in a profile update. Report CSV and Excel output neutralises formulas (`=`, `+`, `-`, `@`). |
| **A04 Insecure Design** | Account lockout after 5 failures. Login timing is constant for unknown emails. Forgot-password always returns 202. Refresh-token rotation with reuse detection revokes the whole session family and alerts the user. Optimistic concurrency prevents lost updates. Budget alerts and goal milestones are deduplicated by constraints. |
| **A05 Security Misconfiguration** | Helmet headers on every service. A strict CSP and `X-Frame-Options: DENY` on the SPA. `x-powered-by` is disabled. Configuration is validated at boot, and the service refuses to start in production with development secrets or without a JWT key. Containers run as non-root with a read-only root filesystem, all capabilities dropped, seccomp `RuntimeDefault`, and no service-account token. |
| **A06 Vulnerable Components** | `npm audit`, Trivy filesystem and image scans (CI fails on CRITICAL), CodeQL, gitleaks, Dependabot (npm, Docker, Actions), and `apk upgrade` in images. |
| **A07 Identification & Auth Failures** | Password policy (10+ characters with mixed classes, must not contain the email). Short-lived access tokens (15 min). Refresh token in an httpOnly, `SameSite=Strict` cookie scoped to `/api/v1/auth`. A CSRF header is required for cookie-authenticated endpoints. Access tokens are deny-listed in Redis on logout. Session listing and per-session revocation. "Log out everywhere". Strict rate limit on authentication endpoints (30 per 15 minutes per IP). |
| **A08 Software & Data Integrity** | Audit log is hash-chained (SHA-256) and protected by DB triggers that block UPDATE, DELETE and TRUNCATE, with an admin `/audit/verify` endpoint. The CI pipeline produces immutable SHA-tagged images, and GitOps provides a reviewed, auditable deployment history. |
| **A09 Logging & Monitoring Failures** | Structured logs carry request and correlation IDs, with passwords, tokens, cookies and auth headers redacted. Security events (logins, failures, lockouts, password changes, token reuse) flow into the audit log. Prometheus alerts cover errors, latency, dead letters and outbox backlog. |
| **A10 SSRF** | Services make no user-controlled outbound requests. Only fixed service URLs and the configured FX provider are contacted. The collector strips auth headers from span attributes. |

## File uploads

* The file type is determined by **magic bytes**. Extensions and the client-declared MIME type are ignored.
* Receipts accept only JPEG, PNG, WebP and PDF. Imports accept only CSV (UTF-8 text) and XLSX.
* Limits: 5 MB, one file, a bounded field count, and 5,000 rows per import.
* Files are stored outside any web root under server-generated keys (`<userId>/<uuid>`) with mode 0600. Original names are sanitised and kept only as metadata.
* Downloads are scoped to the owner, guarded against path traversal, and sent as `Content-Disposition: attachment` (or `inline` for previews) with `nosniff` and a `sandbox` CSP.
* XLSX formulas are never evaluated; only their cached results are read.

## Secrets

* Secrets come only from environment variables or Kubernetes Secrets. For production, use `existingSecret` with Sealed Secrets or the External Secrets Operator.
* `npm run secrets:generate` creates strong random secrets and an RSA key in a git-ignored `.env`.
* Sensitive values (reset URLs, tokens) are redacted from the audit log and application logs.

## Frontend

* The access token is held **in memory only**, never in localStorage. The session is restored through the httpOnly refresh cookie.
* Concurrent 401 responses trigger a single refresh, so refresh-token reuse detection isn't tripped by accident.
* React escapes all output. Search highlighting uses text splitting, never `innerHTML`.
