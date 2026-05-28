# Bistro Steward — Agent Team Definition

**Project:** Bistro Steward (multi-tenant Firebase PWA, `bistrosteward.com`)
**Document type:** Agent team charter
**Last updated:** 2026-05-19

This file defines the standing review crew for Bistro Steward. It pairs one
orchestrator with eight branch agents, each fielding an identical four-person
sub-team (Functionality, Error-Handling, Security, Connectivity). The crew is
sized to the surfaces actually live in production today; branches map 1:1 to
the app's primary functions so reports compose cleanly upward.

---

## 1. Operating model

- **Orchestrator** owns *only* the seams between branches. It does not redo
  branch work; it arbitrates contracts and consolidates findings.
- **Branch agents** own one functional surface end-to-end. Each branch is
  accountable for the coherence of its internal pieces (sub-section
  interconnectivity).
- **Sub-agents** (4 per branch) each take one lens — Functionality (F),
  Error-Handling (X), Security (S), Connectivity (C) — and report up to the
  branch.
- Defects are tagged P0 / P1 / P2 and branch-stamped. Anything that crosses two
  surfaces is escalated to the orchestrator.
- The crew runs read-only against a frozen production snapshot. No writes, no
  impersonation tokens minted, no real customer notifications.

```
                       ┌────────────────────────────┐
                       │  Maître d' (Orchestrator)  │
                       └────────────┬───────────────┘
                                    │  cross-branch contracts
       ┌────────┬────────┬─────────┼─────────┬────────┬────────┬────────┐
       ▼        ▼        ▼         ▼         ▼        ▼        ▼        ▼
  Concierge  Line Cook Sommelier Cashier Expediter Engineer  Host    Inspector
  (Identity) (Kitchen) (AI/OCR) (Billing) (OpsConsole)(Infra) (Mktg)  (Obs/Compl)
       │        │        │         │         │        │        │        │
   F·X·S·C  F·X·S·C  F·X·S·C   F·X·S·C   F·X·S·C  F·X·S·C  F·X·S·C  F·X·S·C
```

---

## 2. Orchestrator — *Maître d'*

**Role:** Cross-branch integrity, contract arbitration, final report.

**Owned seams (these are the only things the orchestrator audits directly):**

- JWT claim contract — `tenantId`, `tenantSlug`, `approved`, `role`,
  `superAdmin`, `impersonating`, `readOnly`, `impersonationExpiresAt`,
  `impersonatingTenantId`, `impersonatingTenantSlug`, `impersonatingAs`.
- The `api` Cloud Function's request/response shape, including `op:*` dispatcher conventions. (The client-side wrapper that calls it is named `secureApi()` in `app.html` — references to `secureApi(...)` are call-site references to that wrapper, not to the deployed function.)
- Firestore namespace contract — `/tenants/{tenantId}/{collection}` and the
  16 per-tenant collections plus operator-side collections.
- CORS allowlist regex (anchored `*.bistrosteward.com`).
- Impersonation token lifecycle (mint → URL hand-off → scrub → 30-min expiry
  → audit close).
- Audit log schema and emit-don't-mutate invariant.
- Scheduled-job → live-UI freshness (rollups must land before KPIs are read).

**Deliverables:**

1. Cross-branch defect roll-up sorted by severity.
2. Contracts ledger — what each surface promises every other surface.
3. Prioritized punch list ready for engineering.

---

## 3. Branch agents

Each branch entry below specifies: scope, sub-team focus per lens, and the
neighboring branches it must hand off to cleanly.

### Branch 1 — Concierge · Identity & Tenancy

**Scope.** Firebase Auth (Google OAuth + email/password), JWT claim minting
and verification, tenant resolution (claim + slug fallback), RBAC matrix
(`PERMISSION_MATRIX`), impersonation read-only enforcement, approved-emails
bootstrap, `tenant_meta` updates.

**Sub-team:**

- **F — Functionality.** Sign-in, signup, claim mint, slug resolve, role
  grants, owner-bootstrap, readOnly toggling.
- **X — Error-Handling.** Expired tokens, mismatched slugs, missing claims,
  suspended/cancelled tenants, replayed impersonation tokens, race between
  claim refresh and request.
- **S — Security.** Claim spoofing, readOnly bypass on writes, ownerEmail
  bootstrap-window abuse, JWT tampering, RBAC drift vs. `PERMISSION_MATRIX`,
  authorized-domain allowlist.
- **C — Connectivity.** Hand-off to Firestore rules, `api` function gating, and
  the operator console's impersonation banner.

**Neighbors:** Engineer (rules ↔ claims), Cashier (status gate), Expediter
(impersonation), Host (signup hand-off).

---

### Branch 2 — Line Cook · Kitchen Operations PWA (`/app`)

**Scope.** The main tenant-facing PWA (`firebase/public/app.html`, ~9,600
lines): recipes, ingredients, inventory, prep sheets, vendor orders, areas
and categories, units and conversions, voice/scan entry points, Excel
import/export, multi-shift shopping, internal Admin tab (workspace settings,
approved-emails).

**Sub-team:**

- **F — Functionality.** CRUD across the 16 per-tenant collections (`ings`,
  `inv`, `recs`, `menus`, `preps`, `shopping`, `areas`, `cats`, `menu_cats`,
  `rec_cats`, `units`, `vendors`, `conversions`, `log`, `settings`,
  `counters`); prep math; Excel round-trip.
- **X — Error-Handling.** Offline → re-sync races, conflicting writes,
  unit-conversion edge cases, negative inventory, partial Excel imports,
  vendor-order edits mid-submit.
- **S — Security.** Per-tenant scoping in every Firestore call, XSS in
  user-entered names/notes, file-upload validation for Excel/images,
  client-side authorization checks backed server-side.
- **C — Connectivity.** Voice + scan into Sommelier, invoice OCR into
  ingredient costs, settings → Cashier plan limits, prep math → shopping
  generator.

**Neighbors:** Sommelier (AI features), Cashier (plan-gated features),
Inspector (audit on destructive ops).

---

### Branch 3 — Sommelier · AI & Invoice Intake

**Scope.** Gemini 2.5 Flash for voice (`api op:voice`) and inventory
scan (`api op:scan`); SendGrid Inbound Parse → Gemini Vision OCR for
invoices (`<token>@invoices.bistrosteward.com`); per-call token logging
into `/tenants/{id}/geminiUsage`.

**Sub-team:**

- **F — Functionality.** Voice round-trip, scan accuracy, invoice OCR
  end-to-end, token meter, ingredient-cost propagation.
- **X — Error-Handling.** Hallucinated SKUs, low-confidence OCR, malformed
  PDFs/images, SendGrid retries / duplicate deliveries, token-meter over- or
  under-counting, vendor-mapping ambiguity.
- **S — Security.** Prompt-injection from invoice content, MIME spoofing,
  address-token forgery on inbound email, PII in attachments, model-side
  data leakage.
- **C — Connectivity.** Writes into Line Cook ingredient prices,
  daily-cost rollup feeds Engineer's `dailyTenantCostAggregation` scheduler.

**Neighbors:** Line Cook (cost updates), Engineer (scheduler), Cashier
(usage → plan overage), Inspector (PII handling).

---

### Branch 4 — Cashier · Billing & Revenue

**Scope.** Square subscriptions (NOT Stripe). Plans: Starter $29 / Pro $49 /
Enterprise $99. 30-day free trial w/ card capture up front. `/billing`
canonical, `/admin` alias. Square webhook (`squareWebhook`), `adminBilling`
function, refund / comp / plan-adjust operator ops, trial reminders.

**Sub-team:**

- **F — Functionality.** Signup → trial → first charge; plan switch up/down;
  card update; refund path; comp/grant; billing history rendering.
- **X — Error-Handling.** Webhook replay, out-of-order events, idempotency
  keys, failed payments, mid-cycle proration, trial-expiry timing.
- **S — Security.** Webhook signature verification, secret rotation, PCI
  surface (Square-hosted card forms — confirm no PAN touches our servers),
  refund authorization (operator-only), tenant-owner verification on plan
  change.
- **C — Connectivity.** Tenant status gate (Concierge), plan feature flags
  (Engineer), refund audit log (Inspector), signup hand-off (Host).

**Neighbors:** Concierge, Host, Engineer, Inspector.

---

### Branch 5 — Expediter · Operator Console (`/super-admin`)

**Scope.** `firebase/public/super-admin.html` (~1,925 lines). Sidebar with 8
tabs (Overview, Tenants, Tickets, Feedback, Agents, Announce, Flags,
Settings). 22-tab tenant drawer. 54-op `superAdmin` dispatcher. 30-min
read-only impersonation flow.

**Sub-team:**

- **F — Functionality.** Each of the 54 ops; ticket lifecycle
  (create/reply/assign/close/reopen/tag); announcement publish; flag scoping
  (global vs. per-tenant); operator profile management; manual audit entry.
- **X — Error-Handling.** Dispatcher routing on unknown op, partial drawer
  loads (one of 22 tabs fails), stale KPI cache, impersonation auto-expiry
  during in-progress action.
- **S — Security.** `superAdmin: true` claim re-verified server-side per
  request; impersonation auto-expiry honored; writes blocked when
  `readOnly === true`; audit completeness across every op; feedback widget
  hidden during impersonation.
- **C — Connectivity.** Impersonation token → tenant PWA URL hand-off and
  scrub; announcements → all signed-in tenant clients; flags → Engineer's
  flag resolver; refund/comp → Cashier.

**Neighbors:** Concierge (impersonation), Cashier (refund/plan), Engineer
(flags), Inspector (audit).

---

### Branch 6 — Engineer · Platform Infrastructure

**Scope.** Cloud Functions (Node 22, Gen 1, `us-central1`): `api`,
`superAdmin`, `adminBilling`, `inboundInvoice`, `squareWebhook`,
`signupTenant`. Five scheduled jobs: `dailyTenantCostAggregation`,
`dailyUsageStatsRollup`, `dailyHealthScoreCompute`, `dailyTrialCheck`,
`dailyTrialReminders`. `functions/index.js` (~5,200 lines). Firestore rules,
indexes, hosting (`firebase.json`), `deploy.sh`, CORS allowlist.

**Sub-team:**

- **F — Functionality.** Each function cold/warm; each scheduler's daily
  output present in expected collection; hosting routes resolve correctly;
  deploy reproducibility.
- **X — Error-Handling.** Scheduler skew, partial rollup failures, region
  pinning issues, retry/backoff behavior, function timeouts, cold-start
  budget.
- **S — Security.** Firestore rules vs. claims (the rules-claims-RBAC
  triple-lock), CORS regex anchoring (no `bistrosteward.com.attacker.tld`
  bypass), env/secret hygiene, `deploy.sh` safety (no prod overwrite from
  branch).
- **C — Connectivity.** Function ↔ rules ↔ claims triple-lock; scheduler
  output → Expediter KPIs; webhook entrypoint → Cashier; inbound email
  entrypoint → Sommelier.

**Neighbors:** all other branches — Engineer is the substrate.

---

### Branch 7 — Host · Marketing, Signup & Onboarding

**Scope.** Public landing (`firebase/public/index.html`, ~640 lines),
`/signup` Square-card flow, `/terms`, `/privacy`, design-partner pipeline
(`design-partners/`), branding assets (`branding/`), marketing collateral
(`marketing/`).

**Sub-team:**

- **F — Functionality.** Signup happy path → tenant provisioned with owner
  claim; legal pages reachable and current; design-partner outreach assets
  consistent.
- **X — Error-Handling.** Signup mid-flow drop-off recovery, duplicate
  signup, email collision, Square card-tokenization failure, abandoned
  carts.
- **S — Security.** Honeypot / rate-limit on signup; privacy claims match
  actual data flows; no PII leaked into marketing analytics; CSP on landing
  pages.
- **C — Connectivity.** Signup three-way handshake — Square subscription
  created (Cashier) + tenant doc written (Engineer) + owner claim minted
  (Concierge). Partial completion is the highest-risk failure mode.

**Neighbors:** Cashier, Concierge, Engineer.

---

### Branch 8 — Inspector · Observability & Compliance

**Scope.** Sentry (errors), PostHog (product analytics, identified-only, DNT
respected, no session replay), `audit_log` integrity across tenant-scoped
and platform-scoped locations, secret hygiene, legal/privacy alignment,
`SECURITY.md` adherence.

**Sub-team:**

- **F — Functionality.** Errors land in Sentry with tenant tag; PostHog
  events identify cleanly; audit entries present for every super-admin op;
  feedback events flow.
- **X — Error-Handling.** Dropped events under burst load, audit gaps on
  failure paths, DNT not honored, retry storms on the observability stack.
- **S — Security.** PII scrubbing in Sentry, no secrets in client bundles,
  audit log immutability (emit-don't-mutate), `SECURITY.md` claims match
  reality.
- **C — Connectivity.** Audit hooks across every branch — Inspector is the
  conscience of the others. Every branch must emit; only Inspector
  certifies completeness.

**Neighbors:** all — Inspector audits everyone.

---

## 4. Sub-team shape (identical across all eight branches)

| Sub-agent | Focus | Produces |
|-----------|-------|----------|
| **F — Functionality** | Walk the happy paths and documented features of the branch. | Pass/fail per feature, screenshots/log excerpts, list of undocumented behavior. |
| **X — Error-Handling** | Stress failure modes — bad inputs, partial failures, retries, idempotency. | Repro steps per fault, severity tag, suggested guard. |
| **S — Security** | AuthN/Z, input validation, secret exposure, PII handling, abuse paths. | Threat list mapped to OWASP-style categories, mitigations. |
| **C — Connectivity** | How the branch's internal pieces fit together, and contract checks to neighbors. | Seam diagram, contract violations, escalations to orchestrator. |

---

## 5. Cross-branch seams the orchestrator owns

- **Concierge ↔ Engineer.** Claims minted by auth must match what Firestore
  rules expect. Drift here silently breaks RBAC.
- **Cashier ↔ Concierge.** Subscription status (active / trial / past_due /
  cancelled) must drive the tenant status gate. A cancelled tenant must go
  read-only immediately.
- **Sommelier ↔ Line Cook.** OCR'd invoices update real ingredient prices.
  Wrong vendor mapping = wrong recipe cost = wrong margin.
- **Expediter ↔ Concierge.** Impersonation tokens carry `readOnly`. Every
  write path must honor it; every audit entry must record the operator.
- **Host ↔ Cashier ↔ Concierge.** Signup is a three-way handshake: Square
  sub + tenant doc + owner claim. Partial completion is the
  highest-priority defect class.
- **Inspector ↔ all.** Audit log is the cross-cutting source of truth.
  Every branch must emit, never mutate.

---

## 6. Run protocol

1. Orchestrator freezes a production read-only snapshot and publishes the
   contracts ledger (current truth for JWT claims, `api` function shape,
   Firestore namespace, audit schema).
2. All eight branches dispatch their sub-teams in parallel.
3. Sub-agents file findings to their branch with severity (P0/P1/P2) and
   branch tag.
4. Branch agents produce: (a) a one-page F/X/S/C summary, (b) a defect list
   with repro steps, (c) a seam diagram showing neighbor touch-points.
5. Orchestrator produces: (a) cross-branch defect roll-up, (b) contracts
   ledger with drift highlighted, (c) prioritized punch list.

---

## 7. Roster at a glance

| # | Branch | Codename | Surface |
|---|--------|----------|---------|
| — | Orchestrator | Maître d' | Branch-to-branch contracts |
| 1 | Identity & Tenancy | Concierge | Auth, claims, RBAC, impersonation |
| 2 | Kitchen Operations | Line Cook | `/app` PWA — recipes, inventory, prep, vendors |
| 3 | AI & Invoice Intake | Sommelier | Gemini voice/scan, SendGrid → OCR |
| 4 | Billing & Revenue | Cashier | Square subs, plans, trial, webhook |
| 5 | Operator Console | Expediter | `/super-admin`, 54-op dispatcher, impersonation UX |
| 6 | Platform Infrastructure | Engineer | Functions, Firestore rules, schedulers, hosting |
| 7 | Marketing & Signup | Host | Landing, `/signup`, legal, design partners |
| 8 | Observability & Compliance | Inspector | Sentry, PostHog, audit log, secret hygiene |

**Total:** 1 orchestrator + 8 branches + 32 sub-agents = 41 roles.
