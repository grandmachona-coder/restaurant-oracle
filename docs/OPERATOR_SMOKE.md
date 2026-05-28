# Operator Console Smoke — Bistro Steward

Two layers, same as [E2E_SMOKE.md](E2E_SMOKE.md):

1. **Static rendering check** (10 min) — gate page renders with no console errors.
2. **Authenticated runbook** (~45 min) — drive every super-admin operation
   against a sandbox tenant with a real super-admin custom claim.

---

## Layer 1 — Static rendering check

```bash
# From repo root
node /Users/mulefamily/Claude/.claude/launch.json  # use preview "operator-console" config
# or
cd /Users/mulefamily/Claude/Bistro-Steward/firebase/public
python3 -m http.server 5065
open 'http://localhost:5065/super-admin.html'
```

Expected (no auth):
- Banner: **"Operator Console"**.
- Sub-text: **"Sign in with an account that has super-admin access."**
- Sign-in button visible.
- Browser console clean (no red errors, no 404s besides Firebase Auth bootstrap).

Captured 2026-05-08 → `marketing/qa-screenshots/2026-05-08/super-admin.html.png`.

---

## Layer 2 — Authenticated runbook

### Prerequisites
- Cloud Function `superAdmin` deployed to `restaurant-oracle` project.
- Your Firebase Auth user has the `superAdmin: true` custom claim set:
  ```bash
  # If you do not yet have the claim, ask another super-admin to grant it via
  # superOpGrantSuperAdmin, or set it directly via Admin SDK as a one-time
  # bootstrap (then remove the bootstrap script).
  node -e '
    const a = require("firebase-admin");
    a.initializeApp({ projectId: "restaurant-oracle" });
    a.auth().getUserByEmail(process.argv[1]).then(u =>
      a.auth().setCustomUserClaims(u.uid, { ...u.customClaims, superAdmin: true })
    ).then(() => console.log("ok"));
  ' you@bistrosteward.com
  ```
- A sandbox tenant exists: `tenants/smoke-test-bistro` (re-use the one
  created by the [E2E_SMOKE.md](E2E_SMOKE.md) signup smoke).
- Sign out / back in **after** the claim is set so the new ID token contains
  it. Verify in the browser console: `(await firebase.auth().currentUser.getIdTokenResult()).claims.superAdmin === true`.

### 1. Dashboard + listings (5 min)

| Operation                | UI surface                       | Expected                          |
|--------------------------|----------------------------------|-----------------------------------|
| `dashboard`              | Top "Overview" card              | tenant counts, MRR, churn         |
| `listTenants`            | Left tenant table                | sandbox tenant present            |
| `listTenantsEnriched`    | Same table w/ status/plan badges | status=`active`, plan=`starter`   |
| `getKpiOverview`         | KPI tiles                        | Active / Trial / Cancelled counts |
| `listSuperAdmins`        | "Operators" tab → Super-admins   | your account listed               |
| `listOperators`          | "Operators" tab → Roster         | shows non-super agents (may be 0) |
| `topAtRiskTenants`       | "Risk" widget                    | empty unless health < threshold   |
| `recentAudit`            | "Audit" tab                      | recent ops from your testing      |

Click each tab. Confirm no red toast / no console errors.

### 2. Tenant deep-dive (5 min)

Click sandbox tenant → opens detail panel.

| Operation             | What to verify                                         |
|-----------------------|--------------------------------------------------------|
| `getTenantDetails`    | Profile card shows name, email, plan, signup date     |
| `getTenantFull`       | Full snapshot tab loads: ings/recs/inv/users counts    |
| `getTenantMeta`       | Meta tab: tags, custom fields                          |
| `getTenantCosts`      | Costs tab: $0 expected for fresh tenant                |
| `getTenantUsage`      | Usage tab: writes/reads/invocations                    |
| `getTenantHealth`     | Health score 0-100                                     |
| `listNotes`           | Notes panel empty initially                            |
| `listAnnouncements`   | Announcements tab (global, not tenant-scoped)          |
| `listFeatureFlags`    | Feature flags tab                                      |

### 3. Notes + tags (3 min)

1. **`addNote`** — enter "Smoke test 2026-05-08", save. Note appears in
   list with your email + timestamp.
2. **`updateNote`** — edit text to "Smoke test edited". Save. List updates.
3. **`addTenantTag`** — add `smoke-test` tag. Badge appears on tenant card.
4. **`removeTenantTag`** — remove. Badge gone.
5. **`deleteNote`** — delete. Note removed.

Audit log (refresh `recentAudit`) shows 5 entries with `super_admin_*` prefix.

### 4. Meta + feature flags (3 min)

1. **`setTenantMeta`** — set `customField.priority = 'high'`. Verify save.
2. **`getTenantMeta`** — re-read. Field present.
3. **`setFeatureFlag`** — toggle `experimental_voice = true` for tenant.
   Verify in `listFeatureFlags`.
4. Reset both.

### 5. Tickets + feedback (5 min)

1. **`createTicket`** — title "Smoke ticket", body "test". Submit.
2. **`listTickets`** — new ticket appears.
3. **`getTicket`** — opens detail.
4. **`replyTicket`** — add reply "ack". Reply visible.
5. **`assignTicket`** — assign to yourself. Owner badge updates.
6. **`addTicketTag` / `removeTicketTag`** — same as tenant tags.
7. **`closeTicket`** — status flips to `closed`.
8. **`reopenTicket`** — status flips back to `open`.

Then for feedback:
1. **`listFeedback`** — list of submitted feedback (likely empty).
2. **`aggregateFeedbackByFeature`** — KPI rollup.
3. If any feedback: **`markFeedbackReviewed`** — flag set.

### 6. Announcements (2 min)

1. **`pushAnnouncement`** — title "Smoke broadcast", body "ignore", target
   `all`. Submit.
2. **`listAnnouncements`** — appears.
3. Verify in app.html as a tenant: announcement banner shows up.
4. **`deleteAnnouncement`** — remove. Banner gone after refresh.

### 7. Billing actions (10 min, sandbox Square)

> **Caution:** these mutate Square subscriptions. Use the smoke tenant only.

1. **`adjustPlan`** — change starter → pro. Verify Square dashboard reflects
   plan change; tenant `plan` field updates.
2. **`compInvoice`** — comp the next invoice ($49). Verify Square invoice
   marked paid w/ note "Comped by super_admin".
3. **`issueRefund`** — refund the most recent invoice. Verify Square refund
   appears; tenant balance decremented.
4. **`forceCancel`** — cancel subscription bypassing Square's grace period.
   Tenant `status` → `cancelled`, Square subscription → `CANCELED`.
5. After verifying 1-4, **`resumeSubscription`** is on the tenant flow
   (admin-billing handler), not super-admin. Skip here.

### 8. Auth actions (3 min)

1. **`resetUserPassword`** — sends reset email to tenant owner.
   Owner receives email within 30s.
2. **`revokeTokens`** — forces re-auth across all sessions. Existing tabs
   for that tenant get auth errors on next API call.
3. **`resendVerification`** — re-sends Firebase Auth email-verify link.

### 9. Impersonation (2 min)

1. **`impersonateTenant`** — opens app.html in a new tab with auth claim
   `impersonating: { realUid, tenantId, readOnly: true }`.
2. Verify the impersonation banner across the top: "Impersonating
   smoke-test-bistro (read-only). Exit impersonation." No write controls
   active.
3. Exit. Banner clears.

Audit log records `super_admin_impersonate_start` and `_end` with the real
uid + impersonated tenant.

### 10. Export + delete (3 min)

1. **`exportTenant`** — generates JSON dump of all tenant data.
   Download URL in response. Open the JSON, sanity-check it has ings/recs/inv.
2. **`softDeleteTenant`** — sets `status: 'deleted'`, hides from
   `listTenants` default view. Toggle "show deleted" → reappears.
3. **`hardDeleteTenant`** — DESTRUCTIVE. Skip during smoke unless you are
   certain. If running, verify Firestore `tenants/<id>` is gone (subcollections
   cascade-deleted), Firebase Auth users deleted, Square subscription cancelled.

### 11. Operators (3 min)

1. **`grantSuperAdmin`** — grant a teammate super-admin. They must sign
   out/in to pick up the claim. Verify via `listSuperAdmins`.
2. **`revokeSuperAdmin`** — revoke. They lose access on next ID token refresh
   (≤ 1 hour or immediately on sign-out/in).
3. **`updateOperatorStatus`** / **`updateOperatorProfile`** — mutate roster
   fields. Verify in `listOperators`.

### 12. Suspend / unsuspend (2 min)

1. **`suspendTenant`** — sets `status: 'suspended'`. Tenant gets
   `checkTenantAccessByStatus` block on next sign-in (matches
   `_test_billing_state.js` group "checkTenantAccessByStatus — gate").
2. **`unsuspendTenant`** — restores `status: 'active'`. Access works.

### 13. Audit + manual entry (1 min)

1. **`recentAudit`** — should now have ~50+ entries from this smoke run.
2. **`manualAuditEntry`** — write an explicit "smoke run complete"
   note. Verify entry persists with your uid + timestamp.

### 14. Rollups (1 min)

1. **`runRollupsNow`** — kicks the daily rollup off-cycle for the smoke
   tenant. Wait ~10s, refresh `getTenantCosts` / `getTenantUsage` —
   should now have a row for today.

---

## Operation matrix (54 ops covered)

| Group                  | Operations                                                                                                |
|------------------------|-----------------------------------------------------------------------------------------------------------|
| Listings               | `dashboard`, `listTenants`, `listTenantsEnriched`, `getKpiOverview`, `topAtRiskTenants`                  |
| Tenant deep-dive       | `getTenantDetails`, `getTenantFull`, `getTenantMeta`, `getTenantCosts`, `getTenantUsage`, `getTenantHealth` |
| Notes                  | `listNotes`, `addNote`, `updateNote`, `deleteNote`                                                        |
| Meta + tags            | `setTenantMeta`, `addTenantTag`, `removeTenantTag`                                                        |
| Tickets                | `listTickets`, `getTicket`, `createTicket`, `replyTicket`, `assignTicket`, `closeTicket`, `reopenTicket`, `addTicketTag`, `removeTicketTag` |
| Feedback               | `listFeedback`, `aggregateFeedbackByFeature`, `markFeedbackReviewed`                                      |
| Announcements          | `pushAnnouncement`, `listAnnouncements`, `deleteAnnouncement`                                             |
| Billing                | `adjustPlan`, `compInvoice`, `issueRefund`, `forceCancel`                                                 |
| Auth                   | `resetUserPassword`, `revokeTokens`, `resendVerification`                                                 |
| Lifecycle              | `impersonateTenant`, `exportTenant`, `softDeleteTenant`, `hardDeleteTenant`                               |
| Operators              | `listSuperAdmins`, `grantSuperAdmin`, `revokeSuperAdmin`, `listOperators`, `updateOperatorStatus`, `updateOperatorProfile` |
| Suspension             | `suspendTenant`, `unsuspendTenant`                                                                        |
| Feature flags          | `listFeatureFlags`, `setFeatureFlag`                                                                      |
| Audit + rollups        | `recentAudit`, `manualAuditEntry`, `runRollupsNow`                                                        |

Total: **54 operations** — every entry in the `SUPER_OPS` table at
`firebase/functions/index.js` (around line 4540).

---

## Failure triage cheat-sheet

| Symptom                                            | Where to look                                                                |
|----------------------------------------------------|------------------------------------------------------------------------------|
| `401 Unauthorized` on every op                     | Custom claim missing — re-run `setCustomUserClaims`, sign out/in              |
| `429 Rate limit exceeded`                          | Per-uid throttle hit; wait 60s                                                |
| `400 Unknown operation: foo`                       | Op typo or `SUPER_OPS` table missing entry — grep `index.js` line ~4540       |
| Square ops fail with `INVALID_ENV`                 | `SQUARE_ENV` secret not set or set to wrong value (sandbox/production)        |
| Impersonation banner missing                       | `app.html` not reading `claims.impersonating` — check token refresh in console|
| Audit entries never appear                         | `writeSuperAudit` failing silently — check Cloud Run `superAdmin` logs        |
| Rollups don't update                               | `runRollupsNow` returned ok but UI cached — hard refresh                      |

---

## After each smoke run

- Capture screenshots of any unexpected UI state →
  `Bistro-Steward/marketing/qa-screenshots/2026-MM-DD/`.
- Bump `MASTER.md` "Last operator smoke" date.
- File defects as GitHub issues with the Cloud Run log link
  (https://console.cloud.google.com/run/detail/us-central1/superAdmin/logs?project=restaurant-oracle).
