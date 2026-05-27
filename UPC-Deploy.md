# UPC Scanner — Deploy & Go-Live Runbook

Last updated: 2026-05-27

This runbook ships three bodies of work that are built, reviewed, and verified in the working tree, then turns the barcode scanner on for **LaChona only**.

- **UPC Phase 1** — backend `upcLookup` API + cost rollup (in `firebase/functions/index.js`, `permissions.js`, `firestore.rules`, `_test_upc_lookup.js`).
- **Operator-console repair** — fixed the super-admin tenant drawer (it couldn't open + most tabs were blank) in `index.js` + `super-admin.html`.
- **UPC Phase 2** — camera barcode scanner UI in `firebase/public/app.html`, gated behind a feature flag.

Everything below runs from the repo root: `~/Claude/Bistro-Steward`.

> **Heads-up before you start:** your working folder contains other uncommitted changes from earlier work too. `firebase deploy` ships **whatever is in the folder right now** — not only the UPC/console work. Step 1 (optional) isolates this work onto its own branch so the deploy is clean and reversible. If you skip it, you're deploying the entire current working tree.

---

## Step 0 — One-time prerequisites (skip if already set up)

```bash
# Firebase CLI installed and logged in as the project owner
firebase --version            # if "command not found": npm install -g firebase-tools
firebase login                # opens a browser; log in as the Firebase project owner

# Application Default Credentials for the enable script (Step 4)
gcloud auth application-default login
```

Confirm you're pointed at the right project:

```bash
cd ~/Claude/Bistro-Steward/firebase
firebase use            # should show project "restaurant-oracle"
```

---

## Step 1 — (Recommended) Put this work on its own branch

So you can deploy cleanly and roll back by simply switching branches.

```bash
cd ~/Claude/Bistro-Steward
git status                                   # see what's changed
git checkout -b upc-scanner-go-live
git add firebase/functions/index.js firebase/functions/permissions.js \
        firebase/functions/square.js firebase/functions/_test_upc_lookup.js \
        firebase/firestore.rules \
        firebase/public/app.html firebase/public/super-admin.html \
        enable-upc-lachona.js UPC-Deploy.md
git commit -m "UPC scanner (Phase 1 + 2) + operator-console contract repair"
```

(If you'd rather just deploy the whole working tree as-is, skip this step.)

---

## Step 2 — Verify before deploying

Run the backend test suite and a syntax check. All should pass.

```bash
cd ~/Claude/Bistro-Steward/firebase/functions
node _test_all.js                 # expect: Suites: 12/12 passed
node --check index.js && echo OK
node --check square.js && echo OK
node --check permissions.js && echo OK
```

Expected: `Suites: 12/12 passed` and three `OK` lines. If anything fails, **stop** and re-check — do not deploy.

---

## Step 3 — Deploy

Two commands, because `deploy.sh` ships only hosting + functions; the scanner also needs the new **Firestore rules**.

```bash
cd ~/Claude/Bistro-Steward/firebase

# 3a. Database rules first (adds upc_cache + upcUsage rules)
firebase deploy --only firestore:rules

# 3b. Backend + frontend (deploy.sh stamps the Sentry release SHA)
./deploy.sh
```

Notes:
- Order is safe either way (the server uses the Admin SDK, which bypasses rules), but rules-first is cleanest.
- A half-deploy doesn't break anything: if hosting lands before functions, a scan call just returns a clean error and the scanner falls back to manual entry.
- `./deploy.sh` with no argument deploys `hosting,functions`. To deploy just one later: `./deploy.sh functions` or `./deploy.sh hosting`.

---

## Step 4 — Turn the scanner ON for LaChona only

After the deploy succeeds:

```bash
cd ~/Claude/Bistro-Steward
node enable-upc-lachona.js                 # DRY RUN — prints what it will write
node enable-upc-lachona.js --execute       # actually enables it for LaChona
```

This writes `feature_flags/upcScanner` with `enabledTenants:['lachona']` and `defaultValue:false`, so the **Scan Barcode** button appears only for LaChona and stays hidden for every other tenant. LaChona sees it on their next app load (or after a refresh).

Manual alternative (no script): Firebase Console → Firestore → `feature_flags` → add a document with ID `upcScanner` and fields `name:"upcScanner"`, `defaultValue:false`, `enabledTenants:["lachona"]`.

---

## Step 5 — Smoke-test in the live app (as LaChona, on a phone)

1. Open the app, sign in, go to **Inventory**.
2. Confirm the amber **Scan Barcode** button shows in the toolbar (next to Scan Sheet / Print Sheet).
3. Tap it → pick an area → allow camera access → point at any packaged grocery barcode.
4. First time for a product: link it to one of your ingredients (saved for next time). Then set a count and **Add to count**.
5. Tap **Done** → confirm a "Applied N scanned item(s)" toast and that the item's quantity updated in Inventory.
6. Quick fallback check: if you deny camera or it can't read, confirm the **Type barcode** field still works.

---

## Step 6 — The Square "Recent charges" check (operator console)

**This does not affect the scanner or LaChona's inventory** — it's a separate display in *your* super-admin console.

While repairing the operator console, the tenant **Billing** tab's "Recent charges" section now pulls from Square's invoices API. That call couldn't be tested against your live Square account, so the charge **amounts** may need a formatting tweak (Square returns money in a nested shape). It's built to show nothing rather than break if the shape is off.

**What to do, once:** open the super-admin console → any tenant → **Billing** tab → glance at "Recent charges."
- If amounts look correct → done, nothing to do.
- If the section is empty or amounts look wrong → tell Claude "the Square charges amounts are off" (or off by 100×, etc.) and it's a one-line fix in `firebase/functions/square.js` (`listRecentCharges`).

---

## Rollback

- **Turn the scanner off (fastest):** edit `feature_flags/upcScanner` in the Firebase Console — remove `"lachona"` from `enabledTenants` (or add it to a `disabledTenants:["lachona"]` array, which overrides everything). Takes effect on next app load. No redeploy needed.
- **Full revert:** if you used Step 1's branch, `git checkout main` then redeploy (`firebase deploy --only firestore:rules` + `./deploy.sh`). Otherwise redeploy from your previous known-good commit.

---

## Later: enabling the PAID UPC lookup provider (optional, not now)

Today the scanner looks products up via the free Open Food Facts API + your cache. A paid fallback (eandata) exists in code but is **inert** until you configure it. When you want it:

1. Create the secret: `firebase functions:secrets:set UPC_PAID_API_KEY`
2. Add `'UPC_PAID_API_KEY'` to the `api` function's `runWith.secrets` array in `firebase/functions/index.js` (~line 2127) **in the same change** — otherwise the key won't be injected and the paid path stays silently off.
3. (Optional) Set a daily cap per tenant: `UPC_PAID_DAILY_CAP` (defaults to 1000).
4. Redeploy functions: `./deploy.sh functions`.

Paid spend is logged per tenant and rolls up into the operator cost dashboard ("UPC paid" column).

---

## Config reference

| Variable | Needed for | Status |
|---|---|---|
| `GEMINI_API_KEY` | OCR sheet scan (existing) | already set |
| `SQUARE_ACCESS_TOKEN` | Billing / charges (existing) | already set |
| `SQUARE_LOCATION_ID` | Operator "Recent charges" | already a declared secret; charges return empty if unset |
| `UPC_PAID_API_KEY` | Paid UPC fallback | optional, inert until set (see above) |
| `UPC_PAID_DAILY_CAP` | Paid-lookup cap/tenant/day | optional, defaults 1000 |

CSP already allows the barcode-reader library (`cdn.jsdelivr.net`) — no change needed.
