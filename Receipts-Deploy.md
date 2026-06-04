# Receipts + Brands + QuickBooks Export — Deploy Runbook

Code-complete & verified: **15/15 test suites**, `index.js` + `app.html` parse clean, no duplicate
symbols. Covers: receipt scanner (capture → Gemini → Margin ▸ Receipts dashboard), Cloud Storage
photo retention, QuickBooks export, brands+sizes model, recipe-line brand picker.

> Run everything on your Mac. Commands assume the project root:
> `cd ~/Claude/Bistro-Steward`

---

## 0 · Commit first (recommended)

Two sessions' work is uncommitted, and `deploy.sh` stamps the git SHA into Sentry release tags —
deploying uncommitted code makes release tags point at the wrong commit.

```bash
git add -A
git commit -m "feat(receipts+brands): receipt scanner, Storage photos, Margin receipts dashboard, QuickBooks export, brands/sizes + recipe-line brand picker"
```

## 1 · One-time console setup

**a. Enable Cloud Storage** (needed for photo retention; receipts scan fine without it)
1. console.firebase.google.com → project **restaurant-oracle** → Build → **Storage** → **Get started** (defaults are fine).
2. Note the bucket address shown (e.g. `gs://restaurant-oracle.appspot.com`).
   - Ends in `.appspot.com` → nothing to do (code default).
   - Ends in `.firebasestorage.app` → add to `firebase/functions/.env`:
     `STORAGE_BUCKET=restaurant-oracle.firebasestorage.app`

**b. Allow signed photo URLs** (needed to VIEW/EXPORT photos; everything else works without it)
1. console.cloud.google.com → IAM & Admin → IAM (project restaurant-oracle).
2. Find the functions runtime service account (default: `restaurant-oracle@appspot.gserviceaccount.com`).
3. Add role **Service Account Token Creator**.

## 2 · Deploy (order matters: rules → storage → functions+hosting)

```bash
cd ~/Claude/Bistro-Steward/firebase

firebase deploy --only firestore:rules     # receipts collection rules
firebase deploy --only storage             # storage.rules — AFTER step 1a, else this errors
./deploy.sh                                # functions + hosting, with Sentry SHA stamping
```

If you skip Storage for now: skip the `--only storage` line — but ALSO remove the
`"storage"` block from `firebase.json` temporarily, or a full `firebase deploy` will error.

## 3 · Turn it on for EVERYONE (Tony's call, 2026-06-03)

```bash
cd ~/Claude/Bistro-Steward
node enable-receipts-everyone.js            # dry run — shows what it writes
node enable-receipts-everyone.js --execute  # receiptScanner defaultValue:true → all tenants
```

Brands UI also goes live for all tenants with the hosting deploy (intentional — no gate).
**Kill-switch if anything misbehaves:** add a tenant id to `disabledTenants` on
`feature_flags/receiptScanner` (beats everything), or set `defaultValue:false` to pause all.
(`enable-receipts-lachona.js` still exists if you ever want the LaChona-only posture back.)

## 4 · Verify (5 minutes)

1. **Phone (LaChona iPhone PWA):** Inventory → **🧾 Scan Receipt** → photo a supplier receipt →
   vendor → Extract. Expect a toast with the line-item count.
2. **Desktop:** Margin → **Receipts** toggle → open the receipt → best-guess ingredients
   pre-selected → assign a line → ✓, status moves to Partial/Done.
3. **Photo:** receipt detail → **🖼 View photo** (tests Storage + IAM signed URL).
4. **QuickBooks:** Receipts list → **⬇ Export for QuickBooks** → zip downloads with
   purchases.csv + bank CSV + photos.
5. **Brands:** open a recipe → ingredient rows show the brand dropdown (★ default) when the
   ingredient has brands; switching brands changes the Margin cost.

## Rollback

- Receipts: remove `lachona` from `feature_flags/receiptScanner` (UI disappears next load).
- Rules/functions are additive — old clients unaffected (half-deploys non-breaking).
- Hosting: `firebase hosting:rollback` if needed.
