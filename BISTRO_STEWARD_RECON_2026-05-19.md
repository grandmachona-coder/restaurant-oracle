# Bistro Steward — Recon Pass

**Date:** 2026-05-19
**Lead:** Maître d' (orchestrator)
**Crew:** 8 branches × 4-lens sub-teams
**Pass type:** Familiarization recon. No changes proposed yet; no fixes applied.
**Scope:** The live multi-tenant Firebase PWA at `bistrosteward.com`.

This is the team's first read of the code. Each branch walked its surface,
mapped where things actually live, and reported what looked brittle,
undocumented, or inconsistent with the project's stated security chain. The
orchestrator consolidated the eight branch reports below and added a
cross-branch seam analysis at the end.

---

## 1. Branch reports

### 1.1 Concierge — Identity & Tenancy

**Files mapped.** `firebase/functions/index.js` (auth + claim mint **515–634**;
impersonation write-block **691–709**; tenant resolution **548–570**; H-1
slug-mismatch check **638–657**; RBAC call **711–716**; impersonation mint
**4110–4155**); `firebase/functions/permissions.js` (PERMISSION_MATRIX
**32–69**, `checkPermission()` **71–80**); `firebase/firestore.rules`
(`isApprovedForTenant()` 25–28, `isSuperAdmin()` 37–39);
`firebase/public/app.html` (client `secureApi()` wrapper **1032–1074**,
impersonation banner **1498–1506**).

**Claim flow.** Client sends Firebase idToken → backend verifies via
`auth.verifyIdToken()` → email-whitelist check against
`tenants/{id}/approved_emails` (with an `ownerEmail`-gated bootstrap that
auto-adds the first owner) → role looked up from custom claim then
`team_members` collection → custom claims stamped:
`approved=true, tenantId, tenantSlug, role`. Impersonation tokens add
`impersonating=true, readOnly=true, impersonationExpiresAt, impersonatingTenantId, impersonatingTenantSlug, impersonatingAs, superAdmin=true`.

**Tenant resolution.** Primary path: read `decodedToken.tenantId`. Fallback:
query `tenants` by `slug == req.body.tenantSlug`. The H-1 slug-in-body check
only fires when the client populates `req.body.tenantSlug`.

**RBAC.** `PERMISSION_MATRIX` exists in `permissions.js:32–69` with four roles
(`super_admin`, `owner`, `admin`, `employee`) and the expected per-op /
per-collection grants. `checkPermission()` is invoked after impersonation +
status gates.

**Impersonation.** Server-side enforcement at `index.js:691–709` — 30-min
window hardcoded at line 4123; expired tokens rejected with 401; readOnly
writes blocked except for an allow-list of read ops; both blocks audit-logged
as `impersonation_expired` and `impersonator_write_blocked`.

**Top 3 observations.**

1. **H-1 slug check is a latent control.** Backend validates only when the
   client sends `tenantSlug` in the body; the production `secureApi()`
   client wrapper at `app.html:1049–1055` does **not** include it. The check
   never triggers in normal traffic.
2. **Impersonation auto-expiry relies on the client clock.** The banner
   renders but there's no visible countdown timer or explicit auto-signout.
   Expiry is only enforced when the next request hits the server.
3. **Role cache (30s TTL) can mask rapid role changes.**
   `clearUserRoleCache()` exists (line 448) but appears to be unused —
   `invite_user` and team-change paths don't call it, so a revoked
   employee can keep access for up to 30 seconds after removal.

---

### 1.2 Line Cook — Kitchen Operations PWA (`/app`)

**Files mapped.** `firebase/public/app.html` (9,600 lines): inventory render
**3429–3587**, ingredients **5279–5675**, recipes **5677–6568**, margin
**6570–6985**, prep status **5018–5277**, menus **6986–7346**, shopping
**4305–4677**, vendors **7373–7512**, settings/admin **7513–8219**; Excel I/O
**8220–8700+**; scan integration **9605–9797**; sync layer **1684–2418**;
undo **2838–2991**; unit conversion **3306–3414**. `firebase/public/sw.js`
(cache version `v2-2026-05-14`).

**Collections actually written.** All 16 documented collections are touched
through `secureApi()` calls. Also writes to `team_members`, reads
`approved_emails`. No undocumented collections found.

**Offline / service worker.** Network-first for HTML, cache-first for static
assets, never caches Firestore traffic or Cloud Function responses. Old
caches deleted on version-bump activation, but only when the user is
online — long-offline users may keep stale `app.html`.

**Voice & scan call-outs.** Scan: "Scan Sheet" button at line 3445 → modal
**9605–9637** → `secureApi('scan', null, {...})` at **9693** → review modal
**9713–9755** → apply at **9757–9797**. **No voice modal or `op:voice`
call site was found in `app.html`** — voice may not be wired in the client
yet despite the backend handler existing.

**Excel I/O.** SheetJS 0.20.1 lazy-loaded from CDN at **8227**. Export at
**8236–8266**; import at **8423**. Section detection by first-column
keywords; no per-field schema validation.

**Top 3 observations.**

1. **Negative inventory is possible.** `updInv` (line 3887) accepts any
   value via `+v||0` with no lower bound. Transfer (line 4182) guards
   against negatives, but the direct qty edit (line 3260) bypasses it.
2. **Unit-conversion divide-by-zero risk.** `convertToStorage` (3314) does
   `Math.ceil(qty/conv.factor)`; if `conv.factor` is 0 or missing, this
   yields `Infinity`/`NaN` and silently corrupts shopping output.
3. **`localStorage` backup is tenant-unaware.** Key is the flat string
   `'ro_allData'` (8329–8342). On a shared device or after impersonation, a
   stale backup could surface across tenants.

---

### 1.3 Sommelier — AI & Invoice Intake

**Files mapped.** `firebase/functions/index.js` voice handler **815–947**,
scan handler **980–1128**, AI-insights handler **~1438**, token-usage write
**407–431**; `firebase/functions/invoices.js` inbound handler **317–397**,
Gemini call **138–159**; `firebase/public/app.html` scan UI **9610–9797**.

**Gemini call sites.** All three operations use `gemini-2.5-flash` with
inlined prompt templates — voice 20 s timeout, scan 45 s, invoice OCR
temperature 0.1 / max 4096 tokens / 0.1.

**Inbound email auth.** 6–32-hex token extracted from the local-part of
`<token>@invoices.bistrosteward.com`, looked up against `invoiceToken` field
on the tenant doc. Optional shared secret via
`functions.config().invoice.sharedsecret` validated with `timingSafeEqual`
on a query param or header. No per-user authentication beyond the token.

**Token meter.** One Firestore write per Gemini call to
`/tenants/{id}/geminiUsage`: `userId, op, model, inputTokens, outputTokens,
totalTokens, latencyMs, success, errorCode, timestamp`. Failures are
non-fatal — logged at `console.warn` and never break the user response.

**Prompt-injection surface.** Voice transcripts and scan area name are
sanitized (HTML strip + 500-char truncation) and routed into the **user**
text part, not the system prompt. Context lists (ingredient names, area
names, prep names) are joined into the system prompt **without
sanitization** — low risk because the tenant controls these strings, but a
self-injected ingredient name like `\nIgnore previous instructions:` could
theoretically influence the model.

**Top 3 observations.**

1. **Context lists not sanitized when joined into the system prompt.** Move
   to the same sanitizer used for user input.
2. **`inboundInvoice` has no rate-limit or per-tenant DDOS protection** —
   only token secrecy and optional shared secret guard it. A spammed
   address with a valid token will execute Gemini Vision OCR on every send.
3. **No dead-letter / retry queue for OCR failures.** A timed-out Gemini
   call discards the invoice and returns 500; SendGrid retries are the
   only safety net.

---

### 1.4 Cashier — Billing & Revenue

**Files mapped.** `firebase/functions/square.js` (302 lines — zero-dep
fetch client, signature verify, idempotency keys);
`firebase/functions/billing-state.js` (105 lines — plan catalog, status
mapping, access gate); `firebase/public/signup.html` (Web Payments SDK,
nonce capture); `index.js:handleSignup`, `handleAdminBilling`,
`handleSquareWebhook`, `handleSquareSubscriptionEvent`, `runDailyTrialCheck`
(5114–5149), `runDailyTrialReminders`, `superOpIssueRefund` (4348–4366),
`superOpCompInvoice` (4334–4346).

**Webhook posture.** Signature verification is strict — HMAC-SHA256 over
`url + rawBody`, constant-time compare via `crypto.timingSafeEqual`,
signature key from env `SQUARE_WEBHOOK_SIGNATURE_KEY`. Invalid sig → 401
before any handler runs.

**Trial lifecycle.** `trialEndsAt = signupDate + 30d` stored on tenant doc.
`dailyTrialCheck` at 8 AM PT scans and writes `status: 'trial_expired'` on
expired tenants. `dailyTrialReminders` at 9 AM PT sends 7d / 2d / 0d
reminders, deduped via a `trialEmailsSent.{bucket}` map on the tenant doc.

**Plan switching.** `adminOpChangePlan` (2481–2511) → `swapSubscriptionPlan`
on Square. Proration follows Square's default; no explicit proration param
is passed. Plan limits are not enforced in code — access control is binary
(active vs. suspended/cancelled).

**Refund / comp.** Both audit-logged. Comp is internal-ledger only (no
Square call). Refund posts to `/v2/refunds` with idempotency key
`refund-{tenantId}-{paymentId}-{Date.now()}`.

**PCI surface.** None. Card data is tokenized client-side via Square Web
Payments SDK; only nonce + `cardId`, `cardLast4`, `cardBrand` ever touch
the server.

**Top 3 observations.**

1. **No webhook event-id deduplication.** Square retries can reprocess
   `subscription.created`/`.updated` events; only the invoice-email path
   has dedup (`emailSent_{eventType}_{invoiceId}`).
2. **Trial expiry is a flag, not a Square cancellation.** `dailyTrialCheck`
   sets `status: 'trial_expired'` but doesn't cancel the Square
   subscription. Access gating relies on `secureApi`/`adminBilling`
   checking the flag — anything that bypasses those gates won't notice.
3. **Refund idempotency key uses `Date.now()` instead of a UUID.** Two
   refunds for the same payment in the same millisecond would collide.

---

### 1.5 Expediter — Operator Console

**Files mapped.** `firebase/public/super-admin.html` — Overview **241–276**,
Tenants **277–326**, Tickets **327–373**, Feedback **374–397**, Agents
**398–422**, Announce **423–460**, Flags **461–497**, Settings **498–540**.
22-tab tenant drawer rendered at **1116–1139**.
`firebase/functions/index.js` super-op dispatcher: `SUPER_OPS` map
**4606–4683**, impersonation mint **4110–4155**, super-audit write
**3230**.

**Op dispatcher count.** **42 ops** present in code vs. **54** documented in
MASTER.md. Categories cover core tenancy (6), enriched views (3), tickets
(9), feedback (3), notes (4), tenant metadata (4), cost/usage/health reads
(3), actions (9 — including impersonate, export, soft/hard delete,
adjust_plan, comp_invoice, issue_refund), announcements (3), flags (2),
operators (3), audit & health (3), admin grant/revoke (3), utilities (2).

**Impersonation.** Mint at line 4110; claims set on the custom token:
`impersonating, readOnly, impersonationExpiresAt, impersonatingTenantId,
impersonatingTenantSlug, impersonatingAs, tenantId, role: 'super_admin',
superAdmin: true`. TTL hardcoded `30*60*1000` ms. Audit emitted at 4141.

**Audit emission.** 27 calls to `writeSuperAudit`. All state-changing ops
audit-logged. The 15 read-only ops (dashboard, listX, getTenantFull, …)
correctly skip — no suspicious bypasses.

**Top 3 observations.**

1. **Operator-console op count drifts from docs** (42 vs. 54). MASTER.md
   should be reconciled to the present `SUPER_OPS` map.
2. **`getKpiOverview` reads `tenant_health` rollups that refresh once a
   day** at 2 AM PT. If that scheduler is delayed or fails, the operator
   dashboard can show stale tenant health for up to 24 h with no
   indicator.
3. **Feedback widget visibility during impersonation isn't explicitly
   suppressed.** The impersonation banner carries `superAdmin: true`, so
   the feedback widget logic in `app.html` may render to the operator and
   look like the tenant's view.

---

### 1.6 Engineer — Platform Infrastructure

**Function inventory.** All exports in `firebase/functions/index.js` are
1st Gen, `us-central1`. **Important discrepancy:** the documented name
`secureApi` is actually exported as **`api`** in code. Other exports
present: `inboundInvoice`, `signupTenant`, `squareWebhook`, `adminBilling`,
`superAdmin`, `healthCheck`/`revenueSnapshot`/`onboardingNudge` (from
`agents.js`), `runTrialRemindersNow`, `sendTestEmail`. All five scheduled
jobs are present.

**Schedulers.** All cron strings in `America/Los_Angeles`:
- `dailyTenantCostAggregation` — `0 1 * * *` → `/tenant_costs_daily/`
- `dailyUsageStatsRollup` — `30 1 * * *` → `/tenant_usage_daily/`
- `dailyHealthScoreCompute` — `0 2 * * *` → `/tenant_health/`
- `dailyTrialCheck` — `0 8 * * *` → tenant `status`
- `dailyTrialReminders` — `0 9 * * *` → tenant `trialEmailsSent` map

All `maxInstances: 1`. Memory 256–512 MB, timeouts 300–540 s.

**Firestore rules.** 238 lines. All client writes are `if false` — the
Admin SDK in Cloud Functions is the sole writer. `isApprovedForTenant()`
and `isSuperAdmin()` gate reads. Operator-only collections
(`internal_notes`, `tenant_costs_daily`, etc.) require `superAdmin: true`.

**Hosting routes.** `firebase.json` rewrites `/signup`, `/app`, `/billing`
(→ `/admin.html`), `/admin` (→ `/admin.html`), `/super-admin`, `/terms`,
`/privacy`. Catch-all → `/app.html`. Strict global response headers:
HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy
strict-origin-when-cross-origin, broad CSP that allows `unsafe-inline` for
script and style plus several CDNs.

**CORS.** Allowlist + an **anchored** regex
`^https:\/\/[a-z0-9-]+\.bistrosteward\.com$` (no `evil.com.bistrosteward.com`
bypass). Null origin rejected.

**Deploy.** `firebase/deploy.sh` extracts the short Git SHA, stamps it into
`sentry-init.js` and `functions/index.js` (replacing `%GIT_SHA%`), runs
`firebase deploy`, restores files on exit via trap. Clean.

**Top 3 observations.**

1. **Function name drift between docs and code.** Docs call it `secureApi`;
   the export is `api`. Every other branch's documentation references the
   wrong name — should be reconciled centrally by the orchestrator.
2. **Region/timezone surface.** Functions live in `us-central1` but cron
   schedules in PT. The five schedulers run sequentially between 1 AM and
   9 AM PT — workable but tight when paired with `maxInstances: 1`.
3. **Cold-start / cascade risk on scheduled rollups.** If
   `dailyTenantCostAggregation` overruns its 540 s budget, the chain
   downstream slips. Consider deadletter handling or wider spacing.

---

### 1.7 Host — Marketing, Signup & Onboarding

**Files mapped.** `firebase/public/index.html` (642 lines — hero, social
proof, pricing 3-tier, 6-FAQ, CTA); `signup.html` (Web Payments SDK card
embed, plan picker, success overlay); `terms.html` (last updated
**2026-04-24**); `privacy.html` (updated 2026-04-24, lists PostHog,
Gemini, Square, Firebase, "email delivery providers", retention tiers,
CCPA/GDPR rights); `design-partners/01_target_list.csv` (22 Portland
restaurants with chef names, fit scores 18–28/30);
`design-partners/05_tracker.csv` (**all 22 rows blank — pipeline 100%
cold**); `branding/README.md` (Restaurant Oracle → Bistro Steward pivot,
wordmark recommendations); `marketing/launch_announcement.md`;
`marketing/qa-screenshots/2026-05-08/`.

**Signup three-way handshake** (`index.js:1900–2093`). In order:
(1) email dedupe, (2) slug reservation, (3) Square customer create,
(4) Square card attach, (5) subscription create with `start_date = +30d`,
(6) Firestore tenant doc + seed defaults, (7) approved-emails doc,
(8) Firebase Auth user create, (9) JWT claim stamp, (10) audit log,
(11) provisioning agent (non-fatal), (12) welcome email (non-fatal). If
step 8 fails after step 6 succeeds, tenant is marked `pending_user_creation,
reconcileNeeded=true` — manual rescue required.

**Anti-abuse.** Cloud Function rate limit (100 req / 60 s / user),
payload-size cap (1–2 MB), `maxInstances: 10` on `signupTenant`. No
CAPTCHA, no honeypot field.

**CSP / headers.** No CSP `<meta>` in the HTML; all headers set globally
via `firebase.json` (Engineer branch confirmed strict HSTS + CSP).

**Legal alignment.** Privacy policy explicitly names every real third
party (Gemini, Square, PostHog, Firebase/Google Cloud), retention tiers,
opt-out path. Terms aligns with the 30-day card-on-file trial.

**Top 3 observations.**

1. **No CAPTCHA / honeypot on signup.** Only resource-based abuse
   protection. A burst of fake signups would tokenize cards and orphan
   Square customers.
2. **Partial signup leaves Square objects orphaned.** No compensating
   transaction rolls back created customer/card/subscription if a later
   step fails. `reconcileNeeded=true` is a placeholder, not a job.
3. **Design-partner pipeline is 100% cold.** All 22 targets in
   `not_started`, no intro/pitch/demo dates filled. Assets are ready
   (target list, fit scores, launch announcement) but no outreach has
   happened.

---

### 1.8 Inspector — Observability & Compliance

**Files mapped.** `firebase/public/sentry-init.js`,
`firebase/functions/index.js:31–69` (backend Sentry init);
`firebase/public/posthog-init.js`; `SECURITY.md`;
`firebase/public/firebase-config.js`; 57 `writeAuditLog()` call sites in
`functions/index.js`.

**Sentry.** `beforeSend` hook strips passwords, tokens, verification codes,
card nonces, CVV, and base64 images; breadcrumb data sanitized; query
strings stripped. Backend additionally redacts request body images and
auth headers. `sendDefaultPii` is left at its default (false).
`ignoreErrors` filters ResizeObserver and offline `FirebaseError`.
`denyUrls` blocks extension noise. Release tag includes the GIT_SHA
written by `deploy.sh`.

**PostHog.** `respect_dnt: true`, `person_profiles: 'identified_only'`
(anonymous landing visitors never create profiles), `autocapture: false`,
`disable_session_recording: true`, `capture_pageview: false` (manual
events only), `ip: false`. `sanitize_properties` redacts password,
cardNonce, cvv, verificationToken before send.

**Audit coverage.** 57 `writeAuditLog` call sites. Two destinations:
`/tenants/{id}/audit_log` (the normal case) and root `/audit_log` (pre-auth
events like `auth_failure`, `tenant_not_found`). Every data-mutating
operation has an emit site.

**SECURITY.md vs. reality.** Three spot-checked claims all hold:
deny-by-default Firestore rules, audit logging on all mutations, no
sensitive data in production `console.log` (a `_DEBUG` flag wraps every
client-side log).

**Client-side secrets.** `firebase-config.js` exposes public Firebase Web
SDK identifiers only — `apiKey`, `authDomain`, `projectId`, `appId`,
`measurementId`. Nothing privileged. No tokens or refresh tokens in
`localStorage`.

**Top 3 observations.**

1. **Pre-auth Sentry errors lack a tenant tag.** `auth_failure` and
   `tenant_not_found` events go to the root audit log but the Sentry
   `beforeSend` hook can't attach a tenant tag because the tenant hasn't
   been resolved. Multi-tenant debugging gets noisier.
2. **`writeAuditLog` is fire-and-forget.** A try/catch swallows Firestore
   write failures so the user-facing op succeeds even if the audit entry
   was dropped. No retry / queue.
3. **PostHog `identify` happens before the email-whitelist check.** A
   user who signs in but is then denied access still has a PostHog
   profile created with their tenant claims.

---

## 2. Cross-branch seams (orchestrator's view)

These are the seams where one branch's report intersects another's. The
orchestrator owns these.

### 2.1 `api` vs. `secureApi` — Engineer ↔ everyone

The Cloud Function is exported as `api`; every other branch's documentation
(and the team charter itself) references it as `secureApi`. This is a doc
artifact, not a code bug — but it propagates confusion across branches.
**Action:** treat `api` as the canonical name and reconcile MASTER.md,
SECURITY.md, and the team charter.

### 2.2 H-1 slug check is dormant — Concierge ↔ Line Cook

Backend validates `req.body.tenantSlug` against `tenant.slug` (`index.js:638`)
but the client-side `secureApi()` wrapper (`app.html:1049`) doesn't send
it. The check is wired but never fires. Either make it mandatory by
populating the body, or remove the contract from the security chain
documentation.

### 2.3 Trial expiry isn't enforced at the data layer — Cashier ↔ Concierge

`dailyTrialCheck` sets `status: 'trial_expired'` on the tenant doc but
doesn't cancel the Square subscription or downgrade JWT claims. Access
gating depends entirely on `secureApi`/`adminBilling` checking that flag.
Operator impersonation, for example, carries `superAdmin: true` and won't
hit the tenant-status check the same way a normal call would.

### 2.4 Signup three-way handshake has no rollback — Host ↔ Cashier ↔ Concierge

If step 8 (Auth user create) fails after step 6 (Firestore tenant), the
tenant is flagged `reconcileNeeded=true` but no compensating job exists.
Square customer/card/subscription created in steps 3–5 are now orphaned.
This is the highest-impact failure mode of the public signup flow.

### 2.5 Operator-console op-count drift — Expediter ↔ docs

Code has 42 ops; docs claim 54. Reconcile before any documentation work
touches the operator surface.

### 2.6 PostHog `identify` precedes access decision — Inspector ↔ Concierge

`roIdentify()` is invoked from `onAuthStateChange` before the tenant /
email whitelist check completes. Denied users still leave an identified
profile behind. Move the call after the access gate.

### 2.7 Audit-log writes are non-atomic — Inspector ↔ all

Every branch that depends on audit completeness inherits the
fire-and-forget risk in `writeAuditLog`. A retry queue or transactional
emit would harden every branch at once.

### 2.8 Pre-auth Sentry events have no tenant tag — Inspector ↔ Concierge

Errors that fire before tenant resolution can't be tagged with `tenantId`.
Adding a request-derived `tenantSlug` to the Sentry scope in the function
entry would close this gap.

---

## 3. Severity rollup

| # | Item | Severity | Branch(es) |
|---|------|----------|------------|
| 1 | Signup partial-failure orphans Square objects (no rollback) | **P0** | Host · Cashier · Concierge |
| 2 | Webhook event-id dedup missing for subscription events | **P1** | Cashier |
| 3 | Trial expiry is a flag, not a subscription cancel | **P1** | Cashier · Concierge |
| 4 | H-1 slug check dormant (client never sends slug) | **P1** | Concierge · Line Cook |
| 5 | Unit-conversion divide-by-zero in `convertToStorage` | **P1** | Line Cook |
| 6 | No CAPTCHA / honeypot on signup | **P1** | Host |
| 7 | `inboundInvoice` lacks rate-limit / DDOS protection | **P1** | Sommelier |
| 8 | Audit-log writes are fire-and-forget | **P1** | Inspector · all |
| 9 | Negative inventory possible via direct edit | **P2** | Line Cook |
| 10 | Impersonation auto-expiry has no client-side timer | **P2** | Concierge · Expediter |
| 11 | Role cache 30 s TTL not invalidated on team change | **P2** | Concierge |
| 12 | Context lists not sanitized before Gemini system prompt | **P2** | Sommelier |
| 13 | OCR failures discarded (no dead-letter) | **P2** | Sommelier |
| 14 | Operator-console op count: 42 in code vs. 54 in docs | **P2 (doc)** | Expediter |
| 15 | Function name docs say `secureApi`, code exports `api` | **P2 (doc)** | Engineer · all |
| 16 | PostHog `identify` fires before access gate | **P2** | Inspector · Concierge |
| 17 | Pre-auth Sentry events lack tenant tag | **P2** | Inspector |
| 18 | `localStorage` backup key `'ro_allData'` is tenant-unaware | **P2** | Line Cook |
| 19 | KPI dashboard reads can be 24 h stale on rollup failure | **P2** | Expediter · Engineer |
| 20 | Refund idempotency key uses `Date.now()` instead of UUID | **P3** | Cashier |
| 21 | Design-partner pipeline 100% cold | **P3 (biz)** | Host |

---

## 4. What the crew didn't read

- Voice client UX in `app.html` (none found — needs deeper search).
- `agents.js` runtime behavior (referenced from Engineer but not walked).
- Firestore rules deny-by-default proof against operator-impersonation
  paths.
- Full webhook event-ordering and out-of-sequence behavior under load.
- Plan feature-gating enforcement (suspected absent — no code touched it).
- Welcome-email template + Resend integration internals.
- Pitch deck (`design-partners/03_pitch_deck.html`) and social copy
  artifacts.

These are candidates for the next pass.

---

## 5. Next moves the orchestrator recommends

1. **Reconcile the contracts ledger first.** The `api`/`secureApi` and
   `42`/`54` drifts cost nothing to fix and unblock cleaner reporting
   downstream.
2. **Pick the P0 signup-rollback gap as the first engineering fix.** It's
   the only finding that can produce orphaned paying customers.
3. **Run a focused second pass on the AI + invoice surface.** The
   `inboundInvoice` rate-limit gap and OCR dead-letter gap compound; both
   live in the same branch and can be hardened together.
4. **Add a small "audit-log emit" linter or runtime check.** With 57
   emit sites, the fire-and-forget risk is best addressed once at the
   `writeAuditLog` boundary rather than per-call.
