# Bistro Steward — Consolidated Fix Plan

**Date:** 2026-05-19
**Author:** Maître d' (orchestrator)
**Scope:** All 21 findings from `BISTRO_STEWARD_RECON_2026-05-19.md`.
**Stance:** Sequence the fixes to land safe wins first, group risky changes
under a guarded rollout, and flag every item that requires a business
decision before a code change is appropriate.

> **Working principle.** The app has paying customers in production. We
> sequence by *blast radius* — anything that can produce orphaned charges
> or auth holes is treated as load-bearing and gets a guarded rollout,
> a feature flag, and an audit hook. Everything else is grouped into
> low-risk batches that can ship together.

---

## 1. At-a-glance roster

The 21 findings sort into five waves. The waves are independent — Wave 1
can ship Monday, Wave 4 can take its time.

| Wave | Theme | Count | Risk | Decision required? |
|------|-------|-------|------|--------------------|
| **0** | Contracts ledger reconciliation (docs only) | 2 | None | No |
| **1** | Self-contained code hardening (single-file changes) | 8 | Low | No |
| **2** | Cross-branch contract clean-up | 4 | Medium | One small decision per item |
| **3** | Production-critical (P0 + P1 with money/identity blast radius) | 5 | High — guarded rollout | Yes — sign-off needed |
| **4** | Non-code / business-side | 2 | None for code | Yes — business call |

---

## 2. Wave 0 — Contracts ledger reconciliation (docs only)

These are the cheapest fixes in the report. They unblock cleaner
reporting on everything downstream because every branch references these
names.

### 0.1 Rename references from `secureApi` → `api` in docs
**Severity:** P2 (doc) · **Branch:** Engineer · all
**Current:** Code exports `api`; MASTER.md, SECURITY.md,
`BISTRO_STEWARD_AGENT.md`, and inline comments call it `secureApi`.
**Target:** Treat `api` as canonical. Replace references in markdown.
Leave inline `secureApi()` client wrapper name alone (that *is* the
wrapper — it's a client helper that calls the `api` function).
**Effort:** XS · **Test:** grep clean afterward.

### 0.2 Reconcile operator-console op count
**Severity:** P2 (doc) · **Branch:** Expediter
**Current:** MASTER.md said 54 ops; the Pass 2 Expediter agent reported
42 but the agent's own category enumeration summed to 55 — both numbers
were wrong. Orchestrator counted `SUPER_OPS` keys directly: **57 ops**.
**Target:** Update MASTER.md to the ground-truth 57, enumerated by
category. The discrepancy in prior reports was a counting error, not
historical drift — no ops have been removed.
**Effort:** S (done) · **Test:** `awk '/^const SUPER_OPS/,/^\};/' index.js | grep -E '^\s+[a-zA-Z]' | wc -l` returns 57.

---

## 3. Wave 1 — Self-contained code hardening

Each item below is a single-file change with no cross-branch impact.
Group them into one PR per branch; ship together.

### 1.1 Divide-by-zero guard in `convertToStorage`
**Severity:** P1 · **Branch:** Line Cook · **File:** `firebase/public/app.html:3306–3414`
**Current:** `Math.ceil(qty/conv.factor)` produces `Infinity`/`NaN` when
`conv.factor` is 0, missing, or undefined.
**Target:** Wrap conversion math in a guard:
```js
function safeConvert(qty, factor) {
  if (!Number.isFinite(factor) || factor === 0) {
    console.warn('Conversion factor invalid', { qty, factor });
    return qty; // pass through; do not corrupt shopping math
  }
  return Math.ceil(qty / factor);
}
```
Apply at `convertToStorage`, `convertToRecipe`, and the four call sites
in margin / recipes (4913, 4927, 6410, 6413).
**Effort:** S · **Test:** add unit case for factor=0, factor=null,
factor=undefined.

### 1.2 Negative-inventory guard in direct edit
**Severity:** P2 · **Branch:** Line Cook · **File:** `firebase/public/app.html:3260`
**Current:** Direct quantity edit in the inventory table bypasses the
transfer-guard's `qty<=0` check.
**Target:** Clamp at zero with a confirmation toast if the user typed a
negative; never store negative qty.
**Effort:** XS · **Test:** manual smoke.

### 1.3 Tenant-scope `localStorage` backup key
**Severity:** P2 · **Branch:** Line Cook · **File:** `firebase/public/app.html:8329–8342`
**Current:** Key is the flat string `'ro_allData'`. After impersonation
or on a shared device, two tenants' data can collide.
**Target:** Key becomes `bs_allData_{tenantId}`; clear all
`bs_allData_*` keys on sign-out.
**Effort:** S · **Test:** smoke across two tenants on one browser
profile.

### 1.4 Sanitize Gemini context lists
**Severity:** P2 · **Branch:** Sommelier · **File:** `firebase/functions/index.js:825–827, 1024–1025`
**Current:** Ingredient/area/prep names interpolated into the system
prompt without `sanitizeString()`.
**Target:** Pipe every context list item through the existing
`sanitizeString()` before `join()`.
**Effort:** XS · **Test:** add an ingredient named
`Tomato\nIgnore previous instructions:` and confirm the model output is
unaffected.

### 1.5 Refund idempotency key uses UUID
**Severity:** P3 · **Branch:** Cashier · **File:** `firebase/functions/index.js:4348–4366`
**Current:** `refund-{tenantId}-{paymentId}-{Date.now()}` — collision in
sub-millisecond is theoretical but possible.
**Target:** `crypto.randomUUID()` matched against the card/subscription
endpoints which already use UUIDs.
**Effort:** XS · **Test:** unit.

### 1.6 Sentry tenant tag for pre-auth events
**Severity:** P2 · **Branch:** Inspector · **File:** `firebase/functions/index.js:31–69`
**Current:** `auth_failure` and `tenant_not_found` events lack a tenant
tag because tenant hasn't been resolved at error time.
**Target:** In the function entry, derive a best-effort tenant hint from
the request (`req.body.tenantSlug`, `req.headers['x-tenant-slug']`, the
Origin URL) and attach it to the Sentry scope before any throw site.
**Effort:** S · **Test:** force an auth failure and confirm Sentry event
carries a `tenantSlug` tag.

### 1.7 PostHog `identify` after access gate
**Severity:** P2 · **Branch:** Inspector / Concierge · **File:** `firebase/public/app.html:~1553`
**Current:** `roIdentify()` runs inside `onAuthStateChange` before
`checkTenantAccess()` completes.
**Target:** Move the `roIdentify()` call to *after* the access check
returns `approved=true`. Users who get rejected never create a PostHog
profile.
**Effort:** XS · **Test:** sign in with a non-approved email and confirm
no `$identify` event lands in PostHog.

### 1.8 Role-cache invalidation on team change
**Severity:** P2 · **Branch:** Concierge · **File:** `firebase/functions/index.js:446–494, 766`
**Current:** `clearUserRoleCache()` exists but is unreferenced. A
revoked employee keeps access for up to 30 s.
**Target:** Call `clearUserRoleCache(uid)` from `invite_user`,
`remove_user`, `change_role`, and the operator's `revokeTokens` /
`adjustPlan` paths (anywhere `approved_emails` or `team_members` is
mutated).
**Effort:** S · **Test:** revoke a user, then make a request inside the
30-s window — should now be denied immediately.

---

## 4. Wave 2 — Cross-branch contract clean-up

These four cross two or more branches. Each has one small decision
embedded; the recommended option is in **bold**.

### 2.1 H-1 slug check — make active or remove
**Severity:** P1 · **Branches:** Concierge ↔ Line Cook
**Current:** Server validates `req.body.tenantSlug` against
`tenant.slug` if present; client never sends it.
**Decision required.** Pick one:
- **A. Activate (recommended).** Update `secureApi()` client wrapper at
  `app.html:1049` to include `tenantSlug` from the active claim on every
  request. Keep the server check as a defense-in-depth layer against
  forged or replayed tokens with mismatched slugs.
- B. Remove. Strip the check from `index.js:638–657` and revise
  SECURITY.md to drop H-1 from the security chain.
**Effort if A:** S · **Test:** integration — send a request with a
tampered `tenantSlug` and confirm 403.

### 2.2 Impersonation client-side timer
**Severity:** P2 · **Branches:** Concierge ↔ Expediter
**Current:** Server enforces 30-min expiry per request; client banner
shows the session but no live countdown or auto-signout.
**Target:** Add a 1-second-tick countdown timer in the impersonation
banner (`app.html:1498–1506`) that signs the operator out at expiry, and
shows a 60-second warning toast at T-60.
**Effort:** S · **Test:** start an impersonation session, wait 60 s
before expiry, confirm warning + auto-signout.

### 2.3 Audit-log retry / queue
**Severity:** P1 · **Branches:** Inspector ↔ all
**Current:** `writeAuditLog()` is fire-and-forget; Firestore write
failures swallowed silently.
**Decision required.** Pick one:
- **A. Retry with backoff (recommended).** Wrap the call in a
  3-attempt exponential backoff. If all attempts fail, write the entry
  to a `pending_audit` collection that a daily scheduler drains.
- B. Pub/Sub queue. Higher overhead but cleaner semantics.
**Effort if A:** M · **Test:** induce a Firestore write failure (rules
deny) and confirm entry lands in `pending_audit`; confirm scheduler
drains it.

### 2.4 KPI dashboard staleness signal
**Severity:** P2 · **Branches:** Expediter ↔ Engineer
**Current:** `getKpiOverview` reads `tenant_health` rollups. If
`dailyHealthScoreCompute` fails, dashboard shows yesterday's numbers
silently for up to 24 h.
**Target:** Each rollup writes a `lastSuccessAt` timestamp on a
`platform_meta/rollups` doc. The operator dashboard renders a "stale"
badge on each KPI if `lastSuccessAt` is older than 26 h.
**Effort:** S · **Test:** disable the scheduler manually and confirm the
badge appears.

---

## 5. Wave 3 — Production-critical (guarded rollout required)

Each of these touches money, identity, or the public signup. Each ships
behind a `feature_flags` document so the operator can disable
immediately if a regression appears.

### 3.1 Signup partial-failure rollback — **P0**
**Branches:** Host ↔ Cashier ↔ Concierge ↔ Engineer
**Current:** Steps 3–9 of `handleSignup` (`index.js:1900–2093`) have no
compensating transaction. Failure at step 8 leaves Square customer,
card, subscription, Firestore tenant, and approved_emails doc with no
Firebase Auth user.
**Target.** Implement `rollbackSignup({squareCustomerId, squareCardId,
squareSubscriptionId, tenantId})`:
1. Best-effort `POST /v2/subscriptions/{id}/cancel` (Square — cancel
   immediate, not at period end).
2. Best-effort delete card.
3. Best-effort archive customer.
4. `tenantRef.delete()` and recursive subcollection delete via batched
   Admin SDK calls.
5. `auth.deleteUser(uid)` if a user got created before the failure.
6. Always: write a `signup_rollback` audit entry with `reasonCode` and
   `errorMessage`.
Wrap `handleSignup` body in a try/catch that calls `rollbackSignup` on
any throw past step 3 (after Square customer create).
**Feature flag:** `signup_rollback_enabled` — default off in production
for first 48 h; canary on staging tenant; enable globally after.
**Effort:** L · **Test:** induce a failure at every step (3 through 8),
verify clean state after rollback. Add E2E covering each.

### 3.2 Square webhook event-id deduplication — **P1**
**Branch:** Cashier · **File:** `firebase/functions/index.js:handleSquareWebhook`
**Current:** Square retries can reprocess `subscription.created`/`.updated`
events; only the invoice-email path has a dedup flag.
**Target:** At the top of the handler, read `event.event_id` and try to
write `/webhook_events/{event_id}` with `createdAt`, `eventType`,
`tenantId`. Use a Firestore transaction with a pre-existence check —
if it exists, return 200 immediately (idempotent ack). The doc has a
TTL of 30 days.
**Feature flag:** `webhook_dedup_enabled`.
**Effort:** M · **Test:** replay a captured webhook payload twice;
confirm the second is a no-op and audited as `webhook_duplicate`.

### 3.3 Trial expiry → tenant access posture — **P1**
**Branches:** Cashier ↔ Concierge
**Current:** `dailyTrialCheck` sets `status: 'trial_expired'` but
doesn't cancel the Square subscription or downgrade JWT claims.
**Decision required.** Pick one:
- **A. Conservative (recommended).** Keep the flag-only behavior, but
  add explicit `status === 'trial_expired'` checks at every secureApi
  entry point and on Firestore-rules read paths (via `approved` claim).
  Treat trial-expired the same as suspended for read/write purposes.
  Let the natural Square billing cycle handle the conversion to paid
  or cancellation; never cancel from our side.
- B. Aggressive. On `trial_expired`, cancel the Square subscription
  immediately. Risk: customers who intended to continue lose service
  while their card processes.
**Effort if A:** M · **Test:** simulate trial expiry, confirm tenant is
read-only across `app`, `super-admin`, and Firestore rules.

### 3.4 `inboundInvoice` rate-limit + dead-letter queue — **P1**
**Branch:** Sommelier · **File:** `firebase/functions/invoices.js:317–397`
**Current:** No rate limit; no retry/DLQ on OCR failure.
**Target:** Two changes:
- Add a Firestore-transaction rate-limit per tenant invoice token:
  100 invoices / 24 h. Excess returns 429 and records a `rate_limited`
  status doc.
- Failed OCR runs (timeout, Gemini error, malformed schema) write to a
  `pending_invoices` collection with the original attachment, error,
  and a `retryCount`. A new `hourlyInvoiceRetry` scheduler retries up
  to 3 times with backoff; after that, an alert goes out.
**Feature flag:** `invoice_retry_enabled`.
**Effort:** M · **Test:** flood the endpoint, confirm 429; force a
timeout, confirm retry behavior.

### 3.5 Signup honeypot (CAPTCHA-free anti-abuse) — **P1**
**Branch:** Host · **File:** `firebase/public/signup.html`
**Current:** No CAPTCHA, no honeypot. Resource-based limits only.
**Target.** Add a hidden honeypot input (`name="company_website"`,
`tabindex=-1`, CSS-hidden). The server-side `signupTenant` rejects with
202 (silent accept) if the field is non-empty. No CAPTCHA UX cost.
Optionally add a time-on-form check: reject if the form was submitted
< 2 s after render.
**Effort:** S · **Test:** scripted signup with the honeypot field
populated returns 202 and never reaches Square.

---

## 6. Wave 4 — Non-code / business-side

### 4.1 Design-partner pipeline activation
**Severity:** P3 (business) · **Branch:** Host
**Current:** All 22 targets in `not_started`.
**Target:** Operator opens the pipeline. Not a code task.
**Recommended cadence:** five intros / week, four-week cycle from intro
to onboarded.

### 4.2 PCI restriction audit
**Severity:** maintenance · **Branch:** Engineer
**Current:** Firebase Web API key is in the client bundle (correctly —
that's how Firebase Web SDKs work). Cloud Console restrictions weren't
checked from inside the repo.
**Target:** Operator confirms in Cloud Console that the key is
restricted to (a) HTTP referrer = `*.bistrosteward.com`, and (b) the
specific APIs in use. Not a code task; one screenshot in `docs/`.

---

## 7. Business decisions — RESOLVED 2026-05-19

The owner has chosen, and the through-line is *"build it correctly from
the start, regardless of timelines"* — he is the only customer, so a
phased rollout protects nobody; we spend the time on correctness
instead.

1. **H-1 slug check (item 2.1):** **ACTIVATE.** Update client wrapper
   to include `tenantSlug` from the active JWT claim on every secureApi
   call. Keep the server check as defense-in-depth.
2. **Audit-log retry strategy (item 2.3):** **Pub/Sub queue** (the
   rigorous option). Build a dedicated receipts pipeline; every audit
   event is published to a topic, consumed by a function that writes
   to Firestore with retry. Once built, every other fix can audit
   cleanly through this surface.
3. **Trial expiry behavior (item 3.3):** **Webhook + poll fallback.**
   Listen for Square's `subscription.trial_ended` webhook for instant
   flagging. Keep `dailyTrialCheck` as a safety-net poll. Add
   `status === 'trial_expired'` as a read/write block at the secureApi
   gate AND in Firestore rules. Let Square's natural billing convert.
4. **Signup rollback canary policy (item 3.1):** **No canary, no
   shadow mode.** Build the compensating-transaction rollback
   carefully with E2E coverage for every failure step, then ship it
   enabled. No feature flag gating the rollback path itself. Because
   the operator is currently the only customer, false-positive
   rollbacks would hurt only him, and he's accepted that risk in
   exchange for not carrying a partially-deployed safety net.

---

## 8. Sequencing & dependencies

```
Wave 0 (docs)     ──┐
                    ├── parallel, can ship today
Wave 1 (8 fixes)  ──┘

Wave 2 (4 fixes)  ── waits on Wave 0 contract names landing first

Wave 3 (5 fixes)  ── each ships behind its own feature flag
                       3.1 ─┐
                       3.2 ─┤ parallel under flags
                       3.3 ─┤
                       3.4 ─┤
                       3.5 ─┘

Wave 4 (business) ── parallel with all of the above
```

**Critical path estimate** (one engineer, focused):
- Wave 0: ½ day
- Wave 1: 2 days
- Wave 2: 2 days
- Wave 3: 5 days (the P0 signup rollback dominates)
- **Total: ~2 working weeks** to fully cleared queue.

---

## 9. Rollback strategy

Every Wave 3 item ships behind a `feature_flags` document. Disabling the
flag in the operator console reverts behavior within one minute (the
client picks up flag changes on next render).

For Waves 0–2, the change set is small enough that a `git revert` plus
re-deploy is the rollback path. No flag needed.

---

## 10. Definition of done

A wave is done when:
1. All listed items have shipped to production.
2. Each item has either an automated test (`functions/_test_*.js`) or
   a documented manual smoke test in `docs/`.
3. The recon report's severity table is updated to mark each item
   `closed` with a commit reference.
4. The Inspector branch re-runs and confirms audit emission, Sentry
   coverage, and PostHog timing are intact.
