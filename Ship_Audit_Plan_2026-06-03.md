# Bistro Steward — Ship-Readiness Audit & Remediation Plan
**Date:** 2026-06-03
**Method:** Multi-agent workflow — 9 scoped finders (read-only, Sonnet) over the working tree, every CRITICAL/HIGH finding adversarially re-verified by an independent agent. 23 agents, 1.38M tokens, 896 tool-uses.
**Scope audited:** all 10 app tabs + functionality, cross-tab source-of-truth/interconnection, RBAC (tab security), OAuth setup+security, tenant management+isolation+billing, signup flow+abuse, Firestore/storage rules + CSP + secrets.

**Result:** 47 findings. 13 HIGH confirmed real (1 HIGH refuted as already-guarded). **15 ship-blockers.** No CRITICAL (no unauthenticated breach / no cross-tenant data read found). Architecture is fundamentally sound; defects are localized.

---

## 1. Ship-readiness verdict by concern

| Concern | Verdict | Headline issues |
|---|---|---|
| **Basic functionality (all tabs)** | 🟡 Solid w/ bugs | 2 stored-XSS (HIGH), shopping unit-math wrong when conversion missing (HIGH), recipe line `ingId:0` corruption, sub-recipe batch size = 0, receipt overwrites `ing.cost` |
| **Tab interconnection / unified source-of-truth** | 🟡 Sound design, integrity gaps | SoT graph is correctly wired (ing→rec→menu→prep/shop/inv via IDX maps). Gaps: **delete-cascade leaks orphan refs** (recipe & menu deletes don't clean inv/preps), listener-count bug fires init early, shopping calc skips `markChanged`, cross-device `nid` collisions |
| **Tab security (RBAC)** | 🟠 Escalation paths | **Employee `upsert`-as-create bypass** (HIGH), **admin can invite→promote to owner** (HIGH), admin role can't see tabs in UI. (admin→approved_emails self-promo: **checked, already blocked** at index.js:2382) |
| **OAuth setup & security** | 🟢 Strong | 30 controls verified working. No HIGH. Only polish: no token-revocation check on main API, reject-path skips reset, impersonation-token-in-URL hygiene |
| **Tenant management & isolation** | 🟠 Isolation OK, billing/ops gaps | `tenantCol()` isolation verified. **`past_due` tenants still writable** (HIGH), **refund accepts cross-tenant paymentId** (HIGH), **super-admin user actions silently fail** (uid vs email, HIGH), suspend doesn't revoke sessions, orphan subcollections |
| **Signups** | 🟠 Works, abuse-prone | End-to-end flow works. **TOCTOU slug race** (HIGH), terms-version not enforced, rate-limit per-instance only, no email verification before billing |
| **Rules / secrets / CSP** | 🟠 One key exposure | **`GEMINI_API_KEY` plaintext in deployed `.env`** (HIGH), CSP `unsafe-inline`, feedback rule no size cap, Sentry DSN placeholder |

---

## 2. What is proven solid (do not touch)

- **XSS baseline:** `escHtml()` correct (app.html:1613); applied across most innerHTML sites.
- **Mappers lossless:** `mapIng/Inv/RecFromDb`↔`ToDb` round-trip verified symmetric incl. `brandId/sizeId`, `outputMode/manualQty` (app.html:2200-2224).
- **Brand/size model:** `_normBrands` idempotent (app.html:2195); per-ingredient brand IDs collision-free (app.html:6217).
- **`deleteIngredient` cascade correct** (app.html:5956) — the pattern recipe/menu deletes should copy.
- **Tenant isolation:** `tenantCol()` path enforcement + Firestore rules deny-all-writes on every data collection; storage receipts tenant-scoped.
- **OAuth:** Google+Apple via Firebase Auth, serialized claim flow, impersonation read-only write-block + 30-min expiry, anchored CORS regex — 30 controls verified.
- **RBAC core:** `checkPermission` logic correct; employee `delete:[]` enforced server-side; approved_emails write already guarded for non-owners.
- **Refuted finding (transparency):** F5-2 "admin self-promotion via approved_emails" — **false positive**, guard exists at index.js:2382-2387.

---

## 3. Remediation plan

> Execution rules: back up `app.html`/`index.js`/`permissions.js`/`firestore.rules` to `_backups/` before first edit (no edits go straight to disk unbacked). `app.html` is edited directly (no generator). After backend edits: `cd firebase && firebase deploy --only functions:api,firestore:rules`. After client edits: `firebase deploy --only hosting`. Every item below is a discrete fix step — none deferred.

### PHASE 1 — Ship blockers (15) — gate charging real customers

| # | ID | Sev | File:line | Fix | Size |
|---|----|-----|-----------|-----|------|
| 1 | F1-1 ✓ | HIGH | app.html:6585,6594 | Wrap `ing.defUnit` → `escHtml(ing.defUnit).replace(/'/g,"\\'")` in `filterRecIngSearch` onclick (both branches) — closes stored-XSS | S |
| 2 | F1-2 ✓ | HIGH | app.html:4159 | Uncategorized branch: `escHtml(conv.storageUnit)`/`escHtml(conv.recipeUnit)` (categorized branch at :4142 already does) | S |
| 3 | F2-1 ✓ | HIGH | app.html:5390 | Shopping on-hand: when `convertToRecipeUnits` returns unchanged + no custom conversion, convert via `unitConversions[].toBase` ratio for same-type units; only fall back to raw add when types differ. Stops adding cups+tbsp raw → wrong order qtys | M |
| 4 | F3-1 ✓ | HIGH | permissions.js:53 | `admin: { invite_user: false }` (or owner/super_admin guard in handler) — closes admin→invite→promote-to-owner escalation | S |
| 5 | F4-1 ✓ | HIGH | app.html:668 | `TOTAL_LISTENERS = 17` (17 registered, was 15) + add `if(isDataLoaded) return;` re-entry guard in `onAllListenersReady`. Stops init firing on incomplete data. **(dup: F9-4)** | S |
| 6 | F4-2 ✓ | HIGH | app.html:6828 | `deleteRecipe`: cascade-delete inv rows where `prepId∈deletedPreps` or `recId===id` (local `markDeleted` + CF delete) — stops orphan inv refs | M |
| 7 | F5-1 ✓ | HIGH | index.js:2499 | Upsert handler: block create (`!cur.exists`) for non-owner/admin on catalog collections. `EMPLOYEE_CAN_CREATE=Set(['inv','log','shopping','receipts'])`. Closes employee upsert-as-create bypass of catalog | M |
| 8 | F7-1 ✓ | HIGH | index.js:1004 | Add `'past_due'` to `blockedStatuses` + message map; mirror in billing-state.js. Stops unpaid tenants writing indefinitely | S |
| 9 | F7-2 ✓ | HIGH | index.js:5581 | `superOpIssueRefund`: verify `payment.customer_id === tenant.squareCustomerId` before refund — stops cross-tenant refund | M |
| 10 | F7-3 ✓ | HIGH | super-admin.html:1259 | User-action buttons send `uid`, CF wants `userEmail` → reset-password/revoke/resend all silently no-op. Add `data-email`, pass `{userEmail}`. Restores broken super-admin ops | S |
| 11 | F8-1 ✓ | HIGH | index.js:2770 | Slug check+write in a transaction (or `/slugReservations/{slug}` atomic create) before any Square charge — stops two signups grabbing same slug → cross-tenant routing collision | M |
| 12 | F9-1 ✓ | HIGH | functions/.env:1 | Move `GEMINI_API_KEY`+`UPC_USDA_API_KEY` to Secret Manager (`firebase functions:secrets:set`), add to `runWith.secrets[]` (index.js:2570), add `.env` to `.gcloudignore`. Removes live key from deploy bundle | M |
| 13 | F1-3 | MED→block | app.html:6625 | `saveRecIng`: guard `if(!ingId){showToast('Select an ingredient first','warning');return;}` — stops `ingId:0` recipe-line corruption | S |
| 14 | F3-3 | MED→block | app.html:7587 | `_csvCell`: prefix `'` when value starts `=+-@` — disarms QuickBooks/Excel CSV formula injection | S |
| 15 | F8-2 | MED→block | billing-state.js:49 | `validateSignupInput`: assert `termsVersion === CURRENT_TERMS_VERSION` — stops stale/forged terms acceptance | S |

✓ = adversarially verified real (independent agent re-read the code).

### PHASE 2 — High-value correctness & ops integrity (16)

| ID | Sev | File:line | Fix |
|----|-----|-----------|-----|
| F4-3 ✓ | HIGH | app.html:8379 | `delMenuItem` cascade to inv (`menuId`) + preps (`menuId`), local + CF — matches deleteIngredient pattern |
| F4-6 | MED | app.html:6785 | `deleteRecipe`: add CF `delete preps where rec_id=id` (+ inv cascade from F4-2) so orphans don't resurrect on next login |
| F5-3 | MED | app.html:943 | `isTabVisible`: add `if(isAdmin()||role==='super_admin') return true;` — admin role currently can't reach Vendors/Ingredients/Recipes/Prep/Margin/Shopping/Menu in UI |
| F2-2 | MED | app.html:7533 | Receipt apply: only set `ing.cost` when `!brandId`; don't clobber container cost onto per-recipe-unit `ing.cost` |
| F2-4 | MED | app.html:3352 | `calcRecipeOutput`: walk `subRecs` recursively so sub-recipe-only recipes don't return batch qty 0 |
| F4-4 | MED | app.html:5199 | `calculateShoppingList`: add `markChanged/markDeleted` (or `scheduleSync()`) so results persist to Firestore, not just localStorage |
| F4-5 | MED | app.html:3116 | `nid` cross-device collision: call `updateNextId()` in `debouncedListenerRender()` (min), or move to `reserve_ids`/UUID |
| F7-4 | MED | index.js:4109 | `superOpSuspendTenant`: call `revokeAllTenantUserTokens(tenantId)` so suspended sessions die within the hour, not after |
| F7-5 | MED | index.js:5441 | Add `vendor_keys` + `upcUsage` to hard-delete `subs[]` and `retention.js` PURGE list — stop orphan subcollections |
| F7-6 | MED | invoices.js:432 | Inbound invoice webhook: require shared secret unconditionally (500 if unset) + rate-limit by token/IP |
| F8-3 | MED | index.js:2594 | Signup rate limit: move `signupRateMap` to Firestore-backed limiter + add GC sweep — closes cross-instance mass-signup |
| F8-5 | MED | index.js:2912 | Send email-verification link in `handleSignup` before activating Square subscription (typo'd email gets billed today) |
| F3-2 | MED | index.js:1184 | `sanitizeString`+truncate `context.currentTab`, `existingItems`, `allIngredients`, `knownIngredients` before Gemini prompt |
| F3-4 | MED | index.js:1313 | mimeType allowlist for scan/receiptScan → fallback `image/jpeg` for Gemini + Storage contentType |
| F6-1 | MED | index.js:832 | Main `api`: `verifyIdToken(idToken, true)` (checkRevoked) so revoked sessions reject immediately |
| F6-3 | MED | app.html:1661 | Unapproved-reject path: call `signOut()` helper (clears timer, PostHog/Sentry reset, localStorage) instead of bare `firebase.signOut()` |

### PHASE 3 — Hardening & polish (12)

| ID | Sev | File:line | Fix |
|----|-----|-----------|-----|
| F1-4 | MED | app.html:5880 | Permission-gate delete button in "Not Used in Any Recipe" (`if(permissions.ingredients.delete())`) |
| F1-5 | LOW | app.html:5810,5831,5890,6066 | `escHtml(ing.defUnit)` at 4 text-position sites |
| F2-3 | LOW | app.html:5447 | `calculateShoppingList`: carry `getDefaultBrandSize` `brandId/sizeId` onto generated items so auto-add keeps preferred brand |
| F3-5 | LOW | index.js:1905 | `upcContribute`: `sanitizeString` name/brand/size/unit before writing shared `upc_cache` |
| F5-4 | LOW | _test_permissions.js:40 | Add `admin` role test group (CRUD wildcard + correct false BOOL_OPs) |
| F5-5 | LOW | index.js:754 | Call `clearUserRoleCache` in `adminOpUpdateMemberRole` after `setCustomUserClaims` — kills 30s stale-role window |
| F6-2 | LOW | index.js:1027 | Impersonation gate: reject when `impersonationExpiresAt` absent (`if(!exp||now>exp)`) |
| F6-4 | LOW | super-admin.html:1656 | Pass impersonation token via hash fragment / postMessage, not URL query (keeps it out of hosting logs) |
| F6-5 / F9-6 | LOW | index.js:104 | Remove `lachona-dashboard.vercel.app` from `ALLOWED_ORIGINS` (cross-project) or document + server-proxy. **(single fix)** |
| F8-4 | LOW | index.js:2971 | Drop `ownerUid`/`tenantId` from signup response (unauth caller, unused by client) |
| F9-3 | LOW | firestore.rules:191 | `feedback_events` create rule: require keys + `request.resource.size()<10240` (or route only via CF) |
| F9-5 | LOW | sentry-init.js:33 | Provision Sentry project, replace `FRONTEND_DSN_PLACEHOLDER`, wire `$SENTRY_FRONTEND_DSN` substitution in deploy.sh |
| F9-2 | MED | firebase.json:64 | CSP `unsafe-inline`: long-term nonce-based CSP (inline scripts → external). Tracked as known risk; mitigated today by escHtml discipline (Phase 1 closes the live XSS holes) |

### PHASE 4 — Verify & deploy

1. Run existing suites: `cd firebase/functions && node _test_all.js`, `node _test_permissions.js`, `node _test_signup_rollback.js`, `node _test_billing_state.js`, `_e2e_security.js`, `_e2e_super_admin.js`.
2. Add regression tests: employee upsert-create block (F5-1), past_due write-block (F7-1), refund tenant-ownership (F7-2), slug-race transaction (F8-1), cascade-delete leaves no orphan inv/preps (F4-2/F4-3).
3. Manual smoke (preview server): each tab loads, recipe/menu delete leaves no "Unknown" rows, shopping qty correct across unit mismatch, super-admin reset-password works, signup end-to-end.
4. Deploy: `firebase deploy --only functions:api,firestore:rules` then `--only hosting`. Hard-refresh prod.
5. Confirm 0 listener permission-errors in console (regression-#1 guard).

---

## 4. Effort summary
- **Phase 1 (15 blockers):** ~1 focused day. Mostly single-site edits; F2-1/F7-2/F8-1/F9-1 need care.
- **Phase 2 (16):** ~1.5 days.
- **Phase 3 (12):** ~1 day.
- **Phase 4:** ~0.5 day.
- **Total to robust shipping state: ~4 days.** No architectural rewrite required.

**Coverage note:** all 47 findings accounted for (45 unique after 2 dedups: F4-1≡F9-4, F6-5≡F9-6). 1 refuted (F5-2) documented as already-guarded. Nothing deferred to "future work."
