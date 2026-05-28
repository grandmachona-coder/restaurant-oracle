# E2E Smoke — Bistro Steward

Two layers:

1. **Automated suites** (~101 tests, runs in <1s, no network) —
   `node firebase/functions/_test_all.js`
2. **Manual production runbook** (~30 min, live Square sandbox + real DNS) —
   the steps below. Run these before flipping the public signup form to live.

---

## Layer 1 — Automated suites

Coverage:

| Suite                       | Asserts                                                                 |
|-----------------------------|-------------------------------------------------------------------------|
| `_test_permissions.js`      | RBAC: super_admin/owner/employee × all ops × all collections, edge cases |
| `_test_conversions.js`      | Unit conversion math (storage↔recipe), rounding, shopping multiplier     |
| `_test_billing_state.js`    | Signup validation, Square→tenant status mapping, access gate, full flow  |

Run:
```bash
cd /Users/mulefamily/Claude/Bistro-Steward/firebase/functions
node _test_all.js
```

Expected: `Suites: 3/3 passed` and zero red lines. Add to CI / pre-deploy
hook before promoting to production.

---

## Layer 2 — Manual production runbook (signup → trial → cancel)

Run this after Email Setup ([EMAIL_SETUP.md](EMAIL_SETUP.md)) and before
public launch. Use **Square sandbox** + a **disposable Gmail address** —
do NOT run against your owner account.

### Prerequisites

- Resend domain verified (green ✓ on all DNS rows).
- SendGrid Inbound Parse hostname configured.
- Firebase secrets set: `RESEND_API_KEY`, `SQUARE_ACCESS_TOKEN`,
  `SQUARE_LOCATION_ID`, `SQUARE_PLAN_VAR_STARTER/PRO/SCALE`,
  `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SENTRY_DSN`, `INVOICE_SHARED_SECRET`.
- `SQUARE_ENV=sandbox` for this run. Switch to `production` after smoke passes.
- A throwaway Gmail address (e.g. `bs-smoke-2026-05-08@gmail.com`).
- Square sandbox test card: `4111 1111 1111 1111`, exp 12/30, CVV 111,
  ZIP 94103.

### 1. Signup form — bad inputs (5 min)

Open https://bistrosteward.com/signup (or staging URL).

Try each of these and confirm the form blocks submission with a clear error:

| Input                        | Expected error                                                |
|------------------------------|---------------------------------------------------------------|
| Email blank                  | "Valid email required"                                        |
| Email = "foo"                | "Valid email required"                                        |
| Password = "short"           | "Password must be at least 8 characters"                      |
| Password = 200 'x' chars     | "Password too long"                                           |
| Restaurant name blank        | "Restaurant name must be 2-100 characters"                    |
| Restaurant name 1 char       | same                                                          |
| Plan field tampered          | "Plan must be starter, pro, or scale"                         |
| Card form skipped            | Submit disabled or "Invalid card token"                       |
| Terms checkbox unchecked     | "You must agree to the Terms of Service and Privacy Policy"   |

These mirror the assertions in `_test_billing_state.js` — the server is the
same path, so any drift here means the form is bypassing the helper.

### 2. Signup form — happy path (5 min)

1. Email: throwaway Gmail.
2. Password: 16+ random chars (use a password manager).
3. Restaurant name: `Smoke Test Bistro`.
4. Plan: `Starter`.
5. Card: sandbox test card above.
6. Check ToS, click **Start free trial**.

Expected:
- Success page appears within 5s ("Welcome to Bistro Steward").
- Owner welcome email lands in throwaway Gmail within ~30s
  (from `noreply@bistrosteward.com`, reply-to `support@`).
- Firestore `tenants/<new-id>` exists with `status: 'active'`,
  `squareSubscriptionStatus: 'PENDING'`, `trialEndsAt` ≈ 30 days from now.
- Firebase Auth user exists with custom claims
  `{ tenantId, tenantSlug, role: 'owner', approved: true }`.
- Audit log: `tenants/<id>/audit_log` has `signup` entry.

Verify via:
```bash
firebase auth:export users.json --project restaurant-oracle
grep -A 5 '"email": "bs-smoke' users.json
```
And in the Firestore console, navigate to `tenants/<new-id>`.

### 3. Login + first-use (5 min)

1. Open https://bistrosteward.com/app and sign in.
2. Verify dashboard loads, no errors in browser console.
3. Verify the welcome banner shows "Trial: 30 days remaining".
4. Add one test ingredient (Tomato, 1 case, $20).
5. Verify it appears in inventory list and Firestore
   `tenants/<id>/ings/{newId}`.

### 4. Trial-end reminder (5 min, requires manual time skew)

The cron `dailyTrialReminders` only fires once a day. To test now:

1. In Firestore, edit `tenants/<id>.trialEndsAt` to **2 days from now**.
2. Trigger the cron manually:
   ```bash
   gcloud scheduler jobs run firebase-schedule-dailyTrialReminders \
     --location us-central1 --project restaurant-oracle
   ```
3. Within 60s, throwaway Gmail receives "Your trial ends in 2 days"
   (template `trial_ending_2d`).
4. Repeat with `trialEndsAt` = today → expect `trial_ending_today`.

### 5. Cancel via in-app billing (5 min)

1. In the app, navigate to **Settings → Billing**.
2. Click **Cancel subscription**, confirm in the dialog.
3. Within 5s, the page should show "Subscription cancelled — access until
   <end-of-period-date>".
4. Throwaway Gmail receives `subscription_cancelled` email.
5. Firestore `tenants/<id>.status` updates to `cancelled` once Square's
   webhook fires (~10s after cancel).
6. Sign out and back in. Verify the sign-in succeeds **but** the app shows
   the "Subscription is cancelled. Reactivate from Billing to continue."
   gate (matches `checkTenantAccessByStatus` test #5).

### 6. Cancel via Square dashboard (3 min)

1. Sandbox dashboard: https://developer.squareup.com/apps → Subscriptions →
   find tenant → Cancel.
2. Verify Square webhook hits `squareWebhook` (Cloud Run logs:
   https://console.cloud.google.com/run/detail/us-central1/squareWebhook/logs?project=restaurant-oracle).
3. Verify Firestore `tenants/<id>.status === 'cancelled'`.
4. Verify the cancel email is sent (belt-and-suspenders w/ in-app cancel).

### 7. Reactivation (5 min)

1. Sign in as the cancelled tenant owner.
2. App should show the "Reactivate" CTA on the gate page.
3. Click, re-enter card (sandbox token), confirm.
4. Within 5s, gate dismisses; Firestore status reverts to `active`.
5. Throwaway Gmail receives `subscription_reactivated` email.

### 8. Cleanup (1 min)

1. In the Cloud Function emulator or via `superAdmin` operation
   `deprovisionTenant`, delete the smoke tenant.
2. Delete throwaway Gmail or move it to spam.

---

## Failure triage cheat-sheet

| Symptom                                         | Where to look                                                                |
|-------------------------------------------------|------------------------------------------------------------------------------|
| Signup hangs / 500                              | Cloud Run logs `signupTenant`                                                |
| Email never arrives                             | Resend → Logs (https://resend.com/logs); check SPF/DKIM PASS                 |
| Email arrives but in spam                       | DMARC `p=reject` not set or DKIM signing missing                             |
| Square webhook silent                           | Square dashboard → Subscriptions → Webhooks; check signature key             |
| Webhook hits but tenant not updated             | Cloud Run logs `squareWebhook` — look for "No tenant for Square subscription"|
| Cancel succeeds in Square but in-app still allows | Frontend cache; force-reload to refresh ID token claims                    |
| `checkTenantAccessByStatus` returns wrong       | `_test_billing_state.js` will catch — re-run automated suite                 |

---

## After each smoke run

- Capture screenshots of each step → drop in
  `Bistro-Steward/marketing/qa-screenshots/2026-MM-DD/`.
- File any defects as GitHub issues with the cloud-run log link.
- Bump `MASTER.md` "Last smoke run" date.
