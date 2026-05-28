# Bistro Steward — Recon Pass 3 (Post-Fix Verification)

**Date:** 2026-05-19
**Lead:** Maître d' (orchestrator)
**Pass type:** Verification of Phase A + B fixes. Each branch re-read its
scope, confirmed the fixes landed correctly, and hunted for regressions
or new issues the changes introduced.
**Code under review:** Phase A (operator role guard, doc reconciliation,
Pub/Sub audit queue) + Phase B (signup rollback, OCR confidence gating,
vendor geo scope, Firestore suspension rule, trial-expiry webhook+gates).

---

## 0. Orchestrator corrections

Two agent reports needed correction before consolidation — this is why
the orchestrator verifies high-impact claims directly.

| Agent claim | Reality | Action |
|-------------|---------|--------|
| **Cashier:** "`subscription.trial_ended` webhook NOT implemented; trial expiry is polling-only" (called it a P1) | **False.** Verified directly: `index.js:2289–2296` handles `subscription.trial_ended` and forces `status='trial_expired'`. The agent read stale line numbers from before the edit. | Claim **rejected.** B5 is correctly wired. |
| **Host:** "No signup.html / frontend files found in codebase" | **False.** They exist at `firebase/public/signup.html`, `index.html`, etc. The agent's path resolution failed. | Client-UX findings from Host marked **incomplete**; re-checked by Line Cook (which did see app.html). |

Everything else in the branch reports is taken at face value.

---

## 1. Verified — fixes confirmed correct

| Fix | Branch confirmation | Evidence |
|-----|--------------------|----------|
| **E-1 operator role guard** | Expediter: cross-edit→403, role→400, photoUrl validated, audit on all paths | `index.js:4726/4732/4746/4752` |
| **Op count = 57** | Expediter independently counted `SUPER_OPS` keys | matches orchestrator's count |
| **Signup rollback (steps 5–9)** | Host: `partialState.tenantId` set *before* seed batch + approved_emails, so a seeding failure still deletes the tenant | `index.js:2079` before `2084/2094` |
| **Audit-queue durability** | Inspector: 3-layer fallback (publish→direct→pending_audit→Sentry), no silent-drop path | `index.js:316–375`, `audit-queue.js` |
| **Audit-queue idempotency** | Inspector: consumer `.create()` keyed by eventId; duplicate delivery = ALREADY_EXISTS ack | `audit-queue.js` processAuditMessage |
| **isActiveTenant Firestore rule** | Concierge + Engineer: `tenantId == tenantId` checked *before* the expensive `get()`; null/missing status fails open intentionally, suspended/canceled/trial_expired fail closed | `firestore.rules` isApprovedForTenant + isActiveTenant |
| **trial_ended webhook** | Orchestrator (direct) | `index.js:2289–2296` |
| **Prompt-injection sanitization** | Sommelier: context lists now sanitized before reaching the Gemini system prompt — the Pass 2 P2 is **fixed** | `index.js:859–861, 1058–1076` |
| **Pricing consistency** | Host: landing + signup + PLAN_CATALOG all agree $29/$49/$99 | `billing-state.js:9–11` |
| **Token revocation on status flip** | Concierge: bounded by tenant roster, not client-exposed, no self-DOS | `index.js:2238–2266` |

**93 unit tests passing** across audit-queue (19), signup-rollback (29),
billing-state (45).

---

## 2. New findings — introduced or surfaced by Phase A/B

These are the actionable results of this pass. Two are gaps that my own
Phase B work created; the rest are hardening opportunities on the new code.

### 2.1 P1 — Unconfirmed-invoice queue is orphaned *(new, from B2)*
Phase B2 routes low-confidence OCR items into `unconfirmed[]` and marks
the invoice `needs_review` — but there is **no operator path to act on
them**. No `superOp` exists to approve/reject, and no super-admin.html
surface renders them. Flagged independently by **Sommelier (CRITICAL),
Expediter (MEDIUM), and Line Cook**. The data lands in Firestore and sits
there. → **New task: Phase B6.** This is the most important Pass-3
finding because B2 created the gap.

### 2.2 P1 — Trial-expired has no client UX *(new, from B4/B5)*
After the Firestore `isActiveTenant` rule + the gate change, a
trial-expired tenant's reads fail — but `app.html` only handles a
`'not approved'` error string and otherwise shows a generic
"Could not load" toast (Line Cook: `app.html:1606–1609, 1739`). The
customer sees a broken app, not a "renew your subscription" message.
→ **New task: Phase B7.**

### 2.3 P2 — `writeSuperAudit` not migrated to the queue
`writeSuperAudit` (`index.js:3408–3426`) is still a fire-and-forget
direct Firestore write. The operator-console audit trail therefore does
NOT have the durability guarantees that `writeAuditLog` got in Phase A3.
For a security-sensitive surface this asymmetry matters (Expediter).
→ **Folded into Phase B8.**

### 2.4 P2 — Vendor backfill race
`upsertVendor` (`invoices.js:203–229`) reads all vendors, matches, then
updates state/city — not atomic. Two concurrent invoices from the same
vendor can both pass the match and race their backfill writes (Sommelier).
→ **Folded into Phase B8** (wrap in transaction).

### 2.5 P2 — OCR confidence format variance
`String(li.confidence || 'medium').toLowerCase()` coerces a numeric
confidence (e.g. `0.9`) to `"0.9"`, which then fails the `=== 'low'`
check and silently writes without gating (Sommelier). → **Folded into
Phase B8** (validate against the enum).

### 2.6 P2 — Audit idempotencyKey collision risk
If a caller reuses the same `idempotencyKey` for two semantically
different audit events, the consumer's `.create()` silently drops the
second (Inspector). The risk is caller-discipline; the fix is a JSDoc
warning + optional content-hash suffix. → **Folded into Phase B8.**

### 2.7 P2 — Ticket-tag ops don't audit-emit
`superOpAddTicketTag` / `superOpRemoveTicketTag` exist and are
registered, but unlike every other ticket op they don't call
`writeSuperAudit` (Expediter). Tag changes are invisible in the audit
trail. → **Folded into Phase B8.**

### 2.8 P2 — Pub/Sub topic is a hard deploy prerequisite
The audit queue fails its publish path until
`bistro-steward-audit-events` exists in GCP (Engineer). The fallback
catches it (direct-write still works), so it's not a runtime outage —
but the topic + DLQ creation is manual and undocumented outside the
`audit-queue.js` header. → Tracked; needs a deploy-checklist or
automation note before go-live.

### 2.9 P3 — Lower-severity items
- `publishAuditEvent` 5 s timeout can race Pub/Sub batching and produce a
  duplicate publish — idempotency handles it, but worth a comment (Engineer).
- `dailyAuditReconcile` drains 500/day — fine now, slow if `pending_audit`
  ever piles into the thousands (Engineer).
- Sentry publish-error tags `tenantId` in `extra`, not `tags`, so it's not
  filterable in the Sentry UI (Inspector).
- `rollbackSignup` suppresses `auth.deleteUser` failure silently — should
  log at `error` level so a stuck Auth user is operator-visible (Host).
- DLQ wiring is a manual `gcloud` step (Engineer).

→ The first four fold into **Phase B8**; DLQ wiring is a deploy note.

---

## 3. Still-open, correctly deferred

These were known before Pass 3 and remain queued for later phases — no
regression, no surprise:

| Item | Going to |
|------|----------|
| L-1…L-7 kitchen-PWA fixes (divide-by-zero, undo race, Excel, etc.) | Phase C |
| Pre-auth Sentry tenant tag | Phase C |
| PostHog identify-before-gate timing | Phase C |
| Announcement XSS (tag-strip only) | Phase D1 |
| Feature-flag precedence undefined | Phase D2 |
| Scheduler heartbeat + idempotency | Phase D3 |
| Retention enforcement | Phase E1 |
| Webhook event-id dedup | Phase E2 |
| privacy.html processor names + robots/sitemap/JSON-LD | Phase E3 |
| Signup CAPTCHA/honeypot | Phase E4 |
| Refund UUID + amount cap + 2FA | Phase E5 |

---

## 4. Verdict

Phase A + B fixes are **confirmed correct** — no regressions, the P0 is
closed, the prompt-injection P2 is closed, and 93 unit tests are green.
Pass 3 surfaced **two genuinely new gaps** that the fixes themselves
introduced (orphaned unconfirmed-invoice queue; missing trial-expired
client UX) plus a cluster of small hardening items on the new code.
These became tasks **B6, B7, B8**.

The loop continues: next I close B6/B7/B8, then proceed to Phase C, then
re-run the agent team for Pass 4. Convergence criterion: a pass that
produces no new P0/P1/P2 findings on shipped code.
