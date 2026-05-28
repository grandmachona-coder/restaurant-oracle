# Bistro Steward — Recon Pass 2 (Deep Dive)

**Date:** 2026-05-19
**Lead:** Maître d' (orchestrator)
**Crew:** 8 branches × 4-lens sub-teams
**Pass type:** Deep dive — verify Pass 1 findings, threat-model the cited
items, and surface anything the first pass missed.
**Scope reference:** `BISTRO_STEWARD_RECON_2026-05-19.md` (Pass 1) and
`BISTRO_STEWARD_FIX_PLAN.md`.

This pass changes the picture in three ways: it **confirms most of Pass
1**, it **corrects two findings that were wrong**, and it **surfaces
material new issues — including one (operator role update) that's a
real P1 and one (committed Gemini key) that the agent over-claimed and
the orchestrator downgraded after direct verification**.

---

## 0. Orchestrator's verifications

The orchestrator independently verified the highest-blast-radius new
findings before publishing. Two notable results:

| Finding | Agent's claim | Orchestrator verification | Result |
|--------|--------------|--------------------------|--------|
| Committed `.env` with Gemini API key | "File is in git history; rotate immediately" (P0) | `git ls-files` shows zero `.env` files tracked; `.gitignore` excludes `.env` and `.env.*`; the key string appears **0 times** in `git log -p --all`. The file exists only on the local developer disk. | **Downgraded to P3** — local hygiene note, not a leak |
| Operator role update accepts `role` field without hierarchy check | P1 — "any super-admin can demote any other operator" | Read `index.js:4534–4542` directly. `superOpUpdateOperatorProfile` writes `role` straight through with `if (role !== undefined) updates.role = role`. No self/other check. | **Confirmed P1** |
| Webhook signature key missing "fails open" | HIGH | Read `index.js:2266–2272`. Missing key returns 500 *before* any business logic. Square will retry, which is an operational nuisance, but no event is processed unsigned. | **Downgraded to P2** — operational, not security |

---

## 1. Pass 1 status summary

| # | Pass 1 finding | Pass 2 verdict |
|---|----------------|----------------|
| 1 | Signup partial-failure orphans Square (P0) | **Confirmed** (Host §1.7) — `reconcileNeeded=true` flag set, no compensating job exists |
| 2 | Webhook event-id dedup missing (P1) | **Confirmed** (Cashier §1.4) — duplicate `invoice.payment_made` can re-send receipts |
| 3 | Trial expiry is a flag, not a Square cancel (P1) | **Confirmed + extended** (Cashier) — also relies on polling rather than `subscription.trial_ended` webhook |
| 4 | H-1 slug check dormant (P1) | **Confirmed** (Concierge) — present at `index.js:640–656`, never triggered |
| 5 | Unit-conversion divide-by-zero (P1) | **Confirmed + extended** (Line Cook) — `convertToStorage` 3314 lacks the guard that `convertToStorageUnits` 4672 has |
| 6 | No CAPTCHA / honeypot on signup (P1) | **Confirmed** (Host) — trade-off matrix added |
| 7 | `inboundInvoice` lacks rate limit (P1) | **Confirmed** (Sommelier) — token entropy is 2³² ≈ 4B per tenant; no IP rate-limit |
| 8 | Audit-log writes fire-and-forget (P1) | **Confirmed but downgraded to P2** — 61+ call sites verified; in practice writes are low-latency, blocking on failure would hurt API |
| 9 | Negative inventory possible via direct edit (P2) | **Confirmed** — also `applyScanResults` at 9774 accepts unbounded `newQty` |
| 10 | Impersonation auto-expiry has no client timer (P2) | **CORRECTED — finding was wrong.** Timer exists at `app.html:1523–1543`. Concierge confirmed by direct read. Item closed. |
| 11 | Role cache 30 s TTL not invalidated (P2) | **Confirmed** (Concierge) — `clearUserRoleCache()` defined at 448, never called |
| 12 | Context lists not sanitized before Gemini prompt (P2) | **Confirmed** (Sommelier) |
| 13 | OCR failures discarded (no DLQ) (P2) | **Confirmed** (Sommelier) |
| 14 | Operator-console op count drift 42 vs 54 (P2 doc) | **Confirmed** (Expediter) — enumerated all 42 by category |
| 15 | `secureApi` vs `api` doc drift (P2 doc) | **Confirmed** (Engineer) |
| 16 | PostHog `identify` before access gate (P2) | **Refined.** Pass 2 found that `roIdentify()` only runs after Firebase Auth succeeds; the gap is narrower than Pass 1 framed it, but a denied-by-whitelist user can still receive an identify after sign-in. **Still P2 but timing window is smaller than Pass 1 suggested.** |
| 17 | Pre-auth Sentry events lack tenant tag (P2) | **Confirmed** (Inspector) |
| 18 | `localStorage` `'ro_allData'` is tenant-unaware (P2) | **Confirmed** (Line Cook) |
| 19 | KPI dashboard can be 24 h stale on rollup failure (P2) | **Confirmed** (Expediter / Engineer) — no `lastSuccessAt` indicator |
| 20 | Refund idempotency key uses `Date.now()` (P3) | **Confirmed + upgraded to P2** (Cashier) — combined with no amount cap and no 2FA |
| 21 | Design-partner pipeline 100% cold (P3 biz) | **Confirmed** |

**Net result:** 19 of 21 Pass 1 findings stand. **#10 is closed
(false-positive)** and **#16 is refined**. Pass 1 was substantively
right on everything it called.

---

## 2. New findings from Pass 2

The deep dive surfaced 23 items not in Pass 1. Listed by branch. The
**bolded** items are the ones the orchestrator considers production-
relevant in the next two weeks.

### 2.1 Concierge (Identity & Tenancy)

| ID | Severity | Item | File:line |
|----|----------|------|-----------|
| C-1 | **P2** | **No email-verification gate for users invited via Google SSO** — federated providers auto-verify; invited admins can use any Google account | `index.js:1244, 2654` |
| C-2 | P2 | Multi-instance clock skew on impersonation expiry — CF instances rely on local `Date.now()` | `index.js:696` |
| C-3 | P2 | Background role change (not via re-login) doesn't trigger client token refresh; up to 1 h of stale claims | `app.html:1472` + `index.js:446–494` |
| C-4 | P3 | Account-enumeration via password-reset error message ("No account found with this email") | `app.html:1314` |
| C-5 | P3 | No multi-factor authentication for super-admins | — (absent) |

### 2.2 Line Cook (Kitchen Ops PWA)

| ID | Severity | Item | File:line |
|----|----------|------|-----------|
| L-1 | **P1** | **Two conversion functions inconsistent** — `convertToStorage` lacks guard that `convertToStorageUnits` has | `app.html:3314` vs `4672` |
| L-2 | P2 | Undo snapshot can be overwritten by an in-flight Firestore listener mid-restore | `app.html:2969–2988` |
| L-3 | P2 | Impersonation end doesn't flush in-memory `undoHistory` or `_scanReviewItems` | `app.html:1010, 2907, 9716` |
| L-4 | P2 | Excel importer section-header match is case-sensitive | `app.html:8455` |
| L-5 | P2 | Excel importer doesn't dedup rows with duplicate `id`; second upsert overwrites first | `app.html:8498–8530` |
| L-6 | P2 | Negative qty not rejected at the conversion function boundary | `app.html:4660, 4673` |
| L-7 | P3 | Round-trip conversion loses precision via `Math.ceil(... * 10) / 10` | `app.html:4929` |

### 2.3 Sommelier (AI & Invoice Intake)

| ID | Severity | Item | File:line |
|----|----------|------|-----------|
| **S-1** | **P1** | **OCR `confidence` field is logged but never used to gate downstream writes.** A `low`-confidence reading with `qty=900` will overwrite `ingredient.cost`. | `invoices.js:260–265` |
| S-2 | **P1** | Vendor matching has no geographic scope — "Sysco Inc" in WA matches "Sysco Inc" in OR | `invoices.js:175–217` |
| S-3 | P2 | `region` field is interpolated into AI-insights prompt without sanitization | `index.js:1444–1450` |
| S-4 | P2 | No PDF-decompression bomb defense; oversized decompressed PDFs can OOM the function | `invoices.js:55–77` |
| S-5 | P3 | Token-lookup endpoint has no IP-based rate-limit; 2³² brute-force possible | `invoices.js:351–352` |
| S-6 | P3 | The backend voice handler is dead code — no client call site exists. Remove or document. | `index.js:815–947` |

### 2.4 Cashier (Billing & Revenue)

| ID | Severity | Item | File:line |
|----|----------|------|-----------|
| **K-1** | **P1** | **Suspended tenants can still read data** — Firestore rules grant read on `isApprovedForTenant()` regardless of `tenant.status`; suspension is enforced only at the secureApi gate | `firestore.rules:44–130` |
| K-2 | P1 | Trial-to-paid relies on daily polling; `subscription.trial_ended` webhook is not handled | `index.js:5114–5142` |
| K-3 | P2 | Webhook missing-key returns 500 instead of paging — Square will retry indefinitely | `index.js:2266–2272` |
| K-4 | P2 | Email dedup uses a flag on the tenant doc; if the flag is cleared, receipt emails replay | `index.js:2192–2215` |
| K-5 | P2 | No rate-limit on webhook processing under Square retry-storms | `index.js:2325` |
| K-6 | P2 | Refund has no amount cap and no second-approval — a typo in `amountCents` can refund 10× the plan | `index.js:4348–4366` |

### 2.5 Expediter (Operator Console)

| ID | Severity | Item | File:line |
|----|----------|------|-----------|
| **E-1** | **P1** | **`superOpUpdateOperatorProfile` accepts an unbounded `role` field — any super-admin can demote any other super-admin** (verified by orchestrator) | `index.js:4534–4542` |
| E-2 | **P1** | Announcement sanitization is tag-strip only — no XSS defense for HTML entities, event handlers, or unsafe attributes | `index.js:4374–4375`, `222–226` |
| E-3 | **P1** | Feature flag *evaluation* logic isn't visible in code — server stores `enabledTenants[]` / `disabledTenants[]` / `rolloutPercent`, but precedence between tenant-scoped and global flags depends on client implementation that wasn't read | `index.js:4420–4446` |
| E-4 | P2 | No rate-limit specific to announcement pushes (only the global 100/min covers it) | `index.js:4699–4703` |
| E-5 | P2 | Ticket-tag operations (`addTicketTag`, `removeTicketTag`) are exposed in the dispatcher but their handlers may be absent — needs follow-up read | `index.js:4631–4632` |
| E-6 | P3 | Tenant drawer has no loading spinner; empty state renders silently on fetch failure | `super-admin.html:1195` |

### 2.6 Engineer (Platform Infra)

| ID | Severity | Item | File:line |
|----|----------|------|-----------|
| N-1 | **P1** | **Scheduler chain has no idempotency guard or dependency check** — if `dailyTenantCostAggregation` is killed at the 540 s budget, `dailyUsageStatsRollup` still runs against the missing data | `index.js:4906–4983` |
| N-2 | P2 | No scheduler heartbeat — silent failures of `dailyTrialCheck` won't surface until customers complain | `index.js:5101–5256` |
| N-3 | P2 | No multi-region failover documented — everything pinned to `us-central1` | `index.js` (region calls) |
| N-4 | P3 | `deploy.sh` has no clean-tree check before deploying | `firebase/deploy.sh:1–52` |
| N-5 | P3 | Node 22 EOL in April 2027 — migration path to Node 24 should be on the roadmap | `firebase/functions/package.json:14` |

### 2.7 Host (Marketing & Signup)

| ID | Severity | Item | File:line |
|----|----------|------|-----------|
| H-1 | **P1** | **`privacy.html` omits Resend and SendGrid by name** — code uses both; GDPR / CCPA wants named processors | `privacy.html:115` |
| H-2 | P2 | Missing `robots.txt` and `sitemap.xml` | (absent) |
| H-3 | P2 | No JSON-LD structured data (Organization, FAQPage, Product) | `index.html` |
| H-4 | P3 | Footer logo `alt=""` — should name the brand | `index.html:576` |
| H-5 | P3 | No skip-to-content link for keyboard navigation | `index.html` |

### 2.8 Inspector (Observability & Compliance)

| ID | Severity | Item | File:line |
|----|----------|------|-----------|
| I-1 | **DOWNGRADED to P3** | ~~Committed `.env` with Gemini API key~~ — **the agent over-claimed**. The file exists locally, is in `.gitignore`, has never been tracked, and the key string appears 0× in `git log -p --all`. Local-hygiene only. Recommend a `.env.example` and Firebase Secret Manager in production. | `firebase/functions/.env` (local, untracked) |
| I-2 | **P1** | **Retention policy is documented in `privacy.html` but not enforced in code** — 30 d / 60 d / 7 yr retention has no scheduled cleanup function | `privacy.html:126–132` (no enforcement code) |
| I-3 | P3 | `errorSampleRate` not explicitly set in Sentry (defaults to 1.0) — quota risk at scale | `index.js:31–69` |

---

## 3. Updated severity table (post Pass 2)

The original 21 items are listed in the Pass 1 table. The eight new
items that need to enter the fix plan are below.

| Severity | New ID | Item | Branch |
|----------|--------|------|--------|
| P1 | L-1 | Two conversion functions inconsistent — apply same guard to both | Line Cook |
| P1 | S-1 | OCR low-confidence writes are not gated | Sommelier |
| P1 | S-2 | Vendor matching has no geographic scope | Sommelier |
| P1 | K-1 | Suspended tenants can still read data (Firestore-rules gap) | Cashier |
| P1 | K-2 | Trial-to-paid relies on polling, not webhook | Cashier |
| P1 | E-1 | Operator role-update has no internal hierarchy check | Expediter |
| P1 | E-2 | Announcement sanitization is tag-strip only (XSS risk) | Expediter |
| P1 | E-3 | Feature flag evaluation logic / precedence undefined | Expediter |
| P1 | N-1 | Scheduler chain has no idempotency / dependency guard | Engineer |
| P1 | H-1 | `privacy.html` omits Resend and SendGrid by name | Host |
| P1 | I-2 | Retention policy documented but not enforced | Inspector |
| P2 | C-1 | Invited-via-SSO bypass of email-verification gate | Concierge |
| P2 | C-2 | Multi-instance clock skew on impersonation expiry | Concierge |
| P2 | C-3 | Background role change has no client token-refresh trigger | Concierge |
| P2 | L-2..L-6, S-3, S-4, K-3..K-6, E-4..E-5, N-2, N-3, H-2, H-3, I-3 | (see §2 tables) | — |
| P3 | C-4, C-5, L-7, S-5, S-6, N-4, N-5, H-4, H-5, I-1 (downgraded) | (see §2 tables) | — |

---

## 4. Implications for the fix plan

The Pass 2 reports change the fix plan in five ways. The plan in
`BISTRO_STEWARD_FIX_PLAN.md` is otherwise still good.

1. **Add Wave 3.6 — Operator-side hardening.** E-1, E-2, E-3 are P1
   items that all touch the operator console. Bundle them into a
   single PR. E-1 should land first because it's a literal lock-out
   risk between super-admins; gating by a not-self check is one line.
2. **Add Wave 3.7 — OCR confidence + vendor scope.** S-1 (gate
   low-confidence writes) and S-2 (vendor geographic scope) belong
   together; both are price-history correctness fixes. Implement S-1
   as a threshold-based "send to needs_review" path rather than
   writing the value.
3. **Update Wave 3 trial-expiry decision.** K-2 reframes the choice
   from "should we cancel from our side" to "should we react to
   `subscription.trial_ended` webhook and stop polling." Recommended
   answer becomes **C. Listen for the webhook AND keep polling as a
   safety net**, then deprecate the poll after a quarter.
4. **Add K-1 to Wave 2.** Suspended tenants reading data is a
   Firestore-rules edit, not an application change. Drop it next to
   the H-1 slug-check decision.
5. **Add Wave 3.8 — Retention enforcement.** I-2 needs a new
   scheduled function `dailyRetentionSweep` that hard-deletes
   cancelled tenants past their 60-day window. Touch it under a
   feature flag — this is irreversible.

The plan still resolves in ~2 working weeks of focused effort, plus
~3 days for the new items.

---

## 5. What Pass 2 still didn't read

- Server-side flag evaluation logic (E-3 followup). Either it lives
  in a path the crew missed, or it's truly client-only.
- `addTicketTag` / `removeTicketTag` handler implementations (E-5).
- Plan feature-gating enforcement (still absent — every plan is
  binary active vs. suspended).
- Whether the `pending_audit` retry path (if shipped) is itself
  audited.
- The Canva pitch deck and social copy artifacts.

---

## 6. Confidence notes for the operator

The orchestrator wants this said plainly. Two items in Pass 2 needed
direct verification because the agent's framing was stronger than the
evidence supported:

- **I-1 (`.env`)** — the agent said "remove from git history, rotate
  immediately." The file has never been in git history. Local hygiene
  matters but the public-facing risk is zero.
- **K-3 (webhook fail-open)** — the agent called it HIGH. The handler
  returns 500 *before* any processing; nothing is processed unsigned.
  The real concern is operational (Square retries) and that's a P2,
  not a security issue.

This is the orchestrator's job and the reason cross-branch
verification exists. Treat the rest of the report as worth the depth
the branches gave it.
