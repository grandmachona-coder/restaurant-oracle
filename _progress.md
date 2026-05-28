# Bistro Steward — Full Architecture Reference

## Overview
- **Location**: `/Users/mulefamily/Claude/Bistro-Steward/`
- **Live**: Firebase Hosting (restaurant-oracle.web.app)
- **Stack**: Vanilla JS PWA + Firebase (Auth, Firestore, Cloud Functions) + Gemini 2.5 Flash
- **Purpose**: LaChona Bistro kitchen management — inventory, ingredients, recipes, menus, prep, shopping, activity log

## File Structure
| File | Lines | Purpose |
|------|-------|---------|
| `index.html` | ~8,300 | Entire SPA (HTML + CSS + JS) |
| `firebase-config.js` | 29 | Firebase project config + Cloud Function URL |
| `firebase/functions/index.js` | ~784 | Cloud Function: CRUD, RBAC, voice, scan |
| `firebase/firestore.rules` | 103 | Deny-all writes, auth-read for listeners |
| `firebase/firebase.json` | ~68 | Hosting config, CSP headers, emulators |
| `Bistro_Steward_Architecture.html` | ~1,990 | Architecture & optimization presentation |

### Deleted Files
- `firebase-adapter.js` — 477 lines of dead code, never loaded (deleted March 2026)

## Architecture

### Frontend State
- **Global object `D`**: `D.ings`, `D.inv`, `D.areas`, `D.recs`, `D.menus`, `D.preps`, `D.shopping`, `D.cats`, `D.menuCats`, `D.recCats`, `D.units`, `D.users`, `D.conversions`, `D.log`, `D.settings`
- **IDX Maps**: `IDX.ings`, `IDX.recs`, `IDX.menus`, etc. — O(1) lookup indexes rebuilt at top of `render()`
- **Change tracking**: `changeLog` (per-table Set of changed IDs), `deleteLog` (per-table Set of deleted IDs)
- **ID generation**: `nid++` (auto-incrementing integer)

### Render & Persistence (Post-Optimization)
- `render()` is **pure UI** — calls `rebuildIndexes()` then dispatches to tab render functions
- `scheduleSync()` triggers persistence — called by `markChanged()` and `markDeleted()`
- `_syncSuppressed` flag prevents re-entrant sync during `detectAllChanges()`
- `saveAllDataLocal()` → localStorage; `queueFirebaseSave()` → debounced Firestore batch via Cloud Function
- No monkey-patch — the old `origRender = render; render = function(){...}` pattern was removed

### Authentication Flow
1. Google OAuth via `onAuthStateChanged()`
2. `await user.getIdToken(true)` — force token refresh before listeners
3. Email whitelist check via Cloud Function (`checkApproval`)
4. `startListeners()` — 15 Firestore `onSnapshot` listeners
5. Fallback: if ALL listeners fail (auth token race), loads data via `loadFromFirebase()` Cloud Function

### Data Sync
- **15 Firestore listeners** with debounced render (300ms)
- **Conflict resolution**: listener updates preserve local pending changes via changeLog/deleteLog
- **Differential sync**: only modified records sent to cloud via batched Cloud Function calls
- **Mutex**: `isSaving` flag prevents concurrent save operations

### Cloud Function (`secureApi`)
- 10-layer validation pipeline: auth, email whitelist, RBAC, operation check, permissions, payload validation, data validation, rate limiting, mutation, audit log
- **Operations**: `ALLOWED_OPERATIONS` array, `PERMISSION_MATRIX` for role-based access
- **AI Operations**: `voice` (Gemini text), `scan` (Gemini vision for inventory photos)
- All writes bypass Firestore rules (Admin SDK)

### UI Patterns
- **Modals**: `document.getElementById('modal').innerHTML = html; document.getElementById('modal-o').classList.add('open');`
- **Toast**: `showToast(msg, type, duration)` — types: success, error, warning, info
- **Tabs**: 8 modules — Inventory, Ingredients, Recipes, Menus, Prep, Shopping, Log, Admin
- **Undo**: `saveState(action)` → deep-copy 13 tables → `undoHistory` stack (max 5)

### Security (April 2026 — fully hardened)
- **Firestore rules**: ALL 15 data collections require `isApproved()` custom claim (`request.auth.token.approved == true`) — not just `request.auth != null`. Direct SDK reads by un-approved authenticated users are blocked at DB layer.
- **Custom claim stamping**: Cloud Function stamps `approved: true` on Auth JWT after whitelist check passes; `approved: false` on denial. Token refresh required for claim to take effect.
- **`approved_emails` and `audit_log`**: deny all client access (server-side only)
- CSP headers in firebase.json with specific domain allowlist
- No direct Firestore writes from client
- **XSS fixes (index.html)**:
  - `buildInvDropdownItems`: removed user data from `onclick`; uses `data-*` + event delegation
  - `filterRecIngSearch`, `filterMenuIngSearch`: same data-* + event delegation pattern
  - Menu linker button: `_menuLinkerParams` storage + getElementById listener
  - `document.write()` / `document.open()` replaced with `frame.srcdoc`
  - `menuName.name`, `rm.unit`: wrapped in `escHtml()`
  - `usedFor` string: `escHtml()` applied at construction site (recipe/menu source names)
  - `item.unit`, `recipeUnit`: wrapped in `escHtml()` in shopping list renders
- **Cloud Function hardening**:
  - Whitelist check uses `.where('email','==').limit(1)` (was full collection scan)
  - Bootstrap email stored lowercase
  - Voice context arrays capped to 200 items and sanitized (prompt injection defense)
  - `inviteError` messages sanitized — no raw Firebase error codes exposed

## Optimizations Applied (March 2026)

### 1. Dead Code Removal
- Deleted `firebase-adapter.js` (477 lines, both root and deploy copies)

### 2. Lazy-Load SheetJS
- Removed eager `<script>` tag (~500KB blocking)
- Added `loadXLSX()` — dynamic script injection, cached promise
- `handleExcelImport()` → async with `await loadXLSX()`

### 3. Render Decoupled from Persistence
- Deleted monkey-patch (`origRender = render; render = function(){...}`)
- Created `scheduleSync()` — called by `markChanged()` and `markDeleted()`
- `_syncSuppressed` flag wraps `detectAllChanges()` to prevent re-entrancy
- Converted 7 direct `deleteLog.add()` and 5 direct `changeLog.add()` to use `markDeleted()`/`markChanged()`
- `undoAction()` explicitly calls `scheduleSync()`

### 4. O(1) Map Indexes
- `IDX` object with 11 Maps: ings, recs, menus, areas, preps, cats, menuCats, recCats, units, users, conversions
- `rebuildIndexes()` called at top of `render()`
- Updated 5 helper functions: `getIngName()`, `getRecName()`, `getPrepName()`, `getAreaName()`, `getConversionForIng()`
- Updated 15+ hot-path `.find()` calls in render loops

### 5. Auth Race Condition Fix
- Added `await user.getIdToken(true)` before `startListeners()`
- Listener failure counter with fallback to `loadFromFirebase()` Cloud Function
- CSP updated: added `https://www.gstatic.com` to `connect-src`

### Deferred
- **DOM patching**: innerHTML rebuild adequate at current data volumes (100-200 items)
- **ES Modules**: Monolithic file split deferred — can extract incrementally per tab

## Audit Fixes (23 Original + 4 Optimizations + 8 Security = 35 Total)
- XSS: `escHtml()` applied to all user-generated content in innerHTML (initial pass)
- XSS: data-* + event delegation for all remaining onclick-with-user-data patterns (April 2026)
- XSS: `usedFor`, `menuName.name`, `rm.unit`, `item.unit` — final escaping pass (April 2026)
- XSS: `document.write` → `srcdoc` (April 2026)
- Auth bypass: Firestore custom claim enforcement (April 2026)
- Auth bypass: Cloud Function stamps/revokes `approved` JWT claim (April 2026)
- Type coercion: `===` replaced `==` in 15+ comparisons
- Null guards: defensive checks for D.recCats, D.conversions
- Permission checks: all operations covered in RBAC matrix
- Rate limiting: per-operation limits in Cloud Function
- Edge cases: empty arrays, missing IDs, boundary conditions
- Info leak: invite errors return safe strings, not raw Firebase codes
- Prompt injection: voice context arrays capped + sanitized

## SaaS Marketplace Plan

### Overview
- **Plan doc**: `Bistro-Steward/SaaS-Marketplace-Plan.html` — full architecture, hosting, cost breakdown, competitive landscape, pricing tiers, 6-agent operating plan
- **Timeline doc**: `Bistro-Steward/SaaS-Build-Timeline.html` — 30-day day-by-day build plan
- **Domain target**: `bistrosteward.com` (wildcard `*.bistrosteward.com` per tenant)
- **Billing**: Stripe (Starter $29/mo, Pro $49/mo, Scale $99/mo) — web-only to avoid Apple 30% cut
- **Gross margin target**: ~87% (Firebase + Gemini + Claude agents = ~$7/customer/month at $49)

### Multi-Tenant Architecture
- **Firestore path**: `/tenants/{tenantId}/` prefix on all 15 existing collections
- **Tenant isolation**: JWT custom claim `tenantId` + Firestore rules `request.auth.token.tenantId == tenantId`
- **Subdomain routing**: `slug.bistrosteward.com` → `getTenantSlug()` reads `hostname.split('.')[0]`
- **Provisioning**: `provisionTenant(restaurantName, ownerEmail, plan)` — creates namespace, Auth user, stamps claims, seeds default data, sends welcome email
- **Admin console**: `admin.bistrosteward.com` — super-admin JWT claim, full tenant lifecycle management

### Claude Agent Layer (6 agents)
| Agent | Model | Trigger | Cost/mo @ 1K customers |
|-------|-------|---------|----------------------|
| Provisioning | Haiku | Each new signup | ~$0.10 |
| Onboarding | Sonnet | New tenant + 24h abandonment cron | ~$10 |
| Support | Sonnet | Help widget in-app | ~$27 |
| Health Monitor | Haiku | Every 4h cron, batched 100 tenants/call | ~$13 |
| Revenue Intelligence | Sonnet | Sunday 6am PT, staggered 50/hr | ~$34 |
| Deployment | Haiku | GitHub Actions pre/post deploy | ~$0.02 |

- **Total Claude agent cost**: ~$0.08/customer/month — adds <1% to infra cost, margin stays at 87%
- **Agent framework**: `firebase/functions/agents/` — `AgentClient.js`, `AgentLogger.js`, `AgentScheduler.js`
- **Cost cap**: any single invocation >$0.50 → abort + log warning

### 30-Day Build Timeline (Compressed)
| Days | Phase | Key Deliverable |
|------|-------|----------------|
| 1–5 | Foundation | Multi-tenant Firestore + Cloud Function refactor + wildcard subdomain + Stripe skeleton |
| 6–10 | Signup | Full signup flow + provisioning engine + landing page + billing portal + onboarding wizard |
| 11–13 | Admin Console | Tenant list, revenue charts, ops tools (suspend/impersonate/manual provision) |
| 14–20 | 6 Claude Agents | Framework + all 6 agents wired and integrated |
| 21–24 | PWA/Mobile | Per-tenant branded install, offline mode, mobile polish, iOS TestFlight |
| 25–30 | Beta + Launch | Demo tenant, 5 beta restaurants, load test, docs, Stripe live, ProductHunt |

**Critical path**: Day 1 rules → Day 2 CF → Day 3 domain → Day 4 tenant detection → Day 6 provisioning → Day 7 signup → Day 14 agent framework → Day 29 Stripe live
**Upfront cost**: $140 (domain $12 + Apple Developer $99 + Anthropic API $20 + Plausible $9)

### Key New Cloud Function Operations
- `provisionTenant` / `deprovisionTenant` — super-admin only in PERMISSION_MATRIX
- `getTenantConfig` — reads tenant doc for logged-in user's tenantId
- `createCheckoutSession(plan)` — creates Stripe Checkout Session
- `checkSlugAvailable(slug)` — real-time slug validation in signup form
- `createPortalSession()` — Stripe Customer Portal redirect
- `stripeWebhook` — handles subscription.created/deleted/updated + invoice.payment_failed
- `manifestEndpoint` — dynamic per-tenant PWA manifest.json
- `adminGetTenantStats(tenantId)` — super-admin only, collection sizes + error counts
- `onboardingChat(tenantId, cuisineType, step, message)` — onboarding AI concierge

## Phase 1 Multi-Tenant Refactor (2026-04-23 — ✅ DEPLOYED & VERIFIED LIVE)

### What changed
All 16 data collections moved under `/tenants/{tenantId}/` path. Tenant isolation enforced at 3 layers: Firestore rules, Cloud Function `tenantCol()` helper, and client-side path construction.

### Files touched
| File | Changes |
|------|---------|
| `firebase/firestore.rules` | Full rewrite (133 lines). `isApprovedForTenant(tenantId)` requires `approved==true` AND `tenantId` claim match. All 16 collections re-matched under `/tenants/{tenantId}/`. All writes denied (CF via Admin SDK bypasses). |
| `firebase/functions/index.js` | ~1127 lines (was ~784). New: `tenantCol()`, `toSlug()`, `getDefaultSeedData()`, `isAllowedOrigin()` with wildcard regex, `super_admin` role in PERMISSION_MATRIX, `provisionTenant`, `deprovisionTenant`, `getTenantConfig`, `checkSlugAvailable`. `writeAuditLog` signature gained `tenantId` param. `handleRequest` resolves tenantId from JWT or `tenantSlug` body fallback. |
| `firebase/firebase.json` | CSP `connect-src` and `frame-src` gained `https://*.bistrosteward.com`. |
| `firebase/public/index.html` | `getTenantSlug()` top-level — staging (`restaurant-oracle.web.app`, `firebaseapp.com`) defaults to `'lachona'`, localhost reads `?tenant=xxx`. `TENANT_SLUG`/`TENANT_ID` globals. `secureApi()` body includes `tenantSlug`. `subscribeCollection()` uses `tenants/${TENANT_ID}/...`. Auth flow serialized: refresh → CF call (if no claims) → refresh → validate slug → start listeners. |
| `migrate-to-multitenant.js` | One-time script: creates `tenants/lachona` doc, migrates 16 collections, seeds `approved_emails`, stamps JWT `{tenantId, tenantSlug, approved, role}` on all Auth users. Uses `merge: true` — re-runnable. Does NOT delete root collections. |

### Security sweep (2026-04-23)
Full review before deploy found and fixed **6 issues** (2 CRITICAL, 2 HIGH, 2 MEDIUM):

| ID | Severity | Issue | Fix location |
|----|----------|-------|--------------|
| C-1 | CRITICAL | Bootstrap hijack: empty `approved_emails` + any user sending the slug = auto-owner | `functions/index.js:280-317` — gate bootstrap on `tenants/{tenantId}.ownerEmail === caller.email` |
| C-2 | CRITICAL | Listener race: first-login users start listeners before CF stamps claims → all 15 listeners denied, stuck in fallback | `public/index.html:896-985` — serialize: refresh → CF call (if no claims) → refresh → listeners. Removed dead root-path fallback in `subscribeCollection` and settings listener (`:1303-1313, :1455-1462`) |
| H-1 | HIGH | Cross-tenant URL hijack: JWT tenantId=foo + URL=bar → silently loads foo's data | CF stamps `tenantSlug` claim (`functions/index.js:454-476`); CF rejects mismatch with `correctSlug` field (`:478-499`); client redirects to correct subdomain on prod (`public/index.html:972-984, secureApi:669-675`) |
| H-2 | HIGH | Stale JWT after migration → listeners fail silently | On `permission-denied` after initial success, force `location.reload()` (`public/index.html:1388-1401`) |
| M-2 | MED | Empty slug from bad input (e.g. `"!!!"`) creates empty-slug tenant | `functions/index.js:904-908` — reject if `slug.length < 2` |
| M-3 | MED | `provisionTenant` didn't validate email format or restaurantName length | `functions/index.js:891-902` — email regex + 2-100 char name cap |

### Defense-in-depth chain (post-fix)
```
Request → CORS allowlist (anchored regex for *.bistrosteward.com)
        → Auth token verification
        → Tenant resolution (JWT claim, slug fallback)
        → H-1: slug-in-body matches tenant.slug
        → C-1: whitelist OR ownerEmail-gated bootstrap
        → JWT claim stamping (tenantId + tenantSlug + role)
        → RBAC (PERMISSION_MATRIX)
        → Collection allowlist + payload validation + sanitization
        → Rate limit (100/min/user)
        → tenantCol() path enforcement
        → Firestore rules (isApprovedForTenant)
```

### Deferred to Phase 2
- M-4: `deprovisionTenant` serial claim revocation (timeout risk at scale)
- L-1/L-2/L-3: scan base64 partial validation, prompt injection self-inflicted, dead-code cleanup

### Additional fixes found and shipped during deployment (2026-04-23)

| ID | Severity | Issue | Fix location |
|----|----------|-------|--------------|
| M-1 | MED | `writeAuditLog` always wrote to root `/audit_log` — commingles cross-tenant audit entries | `functions/index.js:260-280` — path now `tenants/{tenantId}/audit_log` when tenantId known; root only for pre-auth events (auth_failure, tenant_not_found). Explicit deny rule added in `firestore.rules:127-129` for defense-in-depth. |
| UX-1 | BUG | `isSyncing` mutex leak: early-exit "no changes" path set mutex=true but returned without reset; combined with recursive call when mutex held, caused infinite loop with "unsaved" stuck on | `public/index.html:7683-7881` — reset `isSyncing=false` before early-exit return; removed recursive `queueFirebaseSave()`; added retry-via-finally pattern; `showSyncStatus('unsaved')` guarded by `if(!isSyncing)` to prevent flicker |
| UX-2 | ENH | No visible save button — users confused by bottom-right indicator | `public/index.html` ~line 65-77 (CSS) + ~line 289 (header button) — top-bar circular `#sync-btn` mirrors sync state (✓ green idle / ⟳ yellow syncing / ● red unsaved / ! red offline), click forces `syncNow()` |

### Deployment — how it actually went (2026-04-23)

**Pivot: service account keys blocked by GCP org policy** — Firebase Console showed red banner "Service account key creation is disabled". Solution: Application Default Credentials via gcloud.

1. `brew install --cask google-cloud-sdk` (installed gcloud)
2. `gcloud auth application-default login` — OAuth flow, required consenting to `cloud-platform` scope (first attempt failed when consent box wasn't checked)
3. `gcloud auth application-default set-quota-project restaurant-oracle` (resolves quota warning)
4. `migrate-to-multitenant.js` updated with credential resolution chain: env `GOOGLE_APPLICATION_CREDENTIALS` → `firebase/serviceAccountKey.json` → ADC (`admin.credential.applicationDefault()`)
5. `npm install firebase-admin` (added to `package.json` at repo root — script not deployed)
6. Pre-deploy code review found the `writeAuditLog` bug (M-1 above) — fixed immediately, not deferred (per "Complete Coverage on Identified Issues" rule)
7. `node migrate-to-multitenant.js` — migrated **609 docs** across 17 collections (16 data + `audit_log`), stamped **6 Auth users** with `{tenantId: 'lachona', tenantSlug: 'lachona', approved: true, role}` claims
8. `cd firebase && firebase deploy --only firestore:rules,functions` — clean
9. `firebase deploy --only hosting` — clean
10. User verified end-to-end: sync button works, no linger, all data loads from `/tenants/lachona/`
11. `node cleanup-root-collections.js` (dry run → execute) — deleted **507 docs across 17 root collections** (`team_members, areas, cats, menu_cats, rec_cats, units, ings, inv, shopping, preps, recs, menus, log, conversions, settings, counters, approved_emails`). Root `/audit_log` intentionally preserved for pre-auth fallback. Verification dry-run confirms all empty.

### Migration tooling (repo root, not deployed)
- `migrate-to-multitenant.js` — one-time, idempotent (uses `merge: true`). Auto-detects credentials (env key → local key → ADC).
- `cleanup-root-collections.js` — dry-run by default, `--execute` for live. Same credential chain. Preserves root `/audit_log`.
- `package.json` — `bistro-steward-migrations` workspace, private, not deployed. `npm run migrate:multitenant`.

## Development Patterns
- **Adding new operations**: add to `ALLOWED_OPERATIONS`, `PERMISSION_MATRIX`, `checkPermission()`
- **New data collection**: add listener in `startListeners()`, mapper pair (`mapXxxFromDb`/`mapXxxToDb`), D.xxx array, IDX.xxx Map, changeLog/deleteLog entries, Firestore rules — **all under `/tenants/{tenantId}/` now**
- **Deploy**: `cd firebase && firebase deploy` (or `firebase deploy --only hosting`)
- **Emulators**: `firebase emulators:start` (auth:9099, functions:5001, firestore:8080, hosting:5000)

## Visual Changes (April 2026)
- Login background: orange → Argentine blue radial gradient (`#cce4f7 → #74acdf → #2e6090 → #162d45`), bright spot anchored lower-right (`ellipse at 100% 100%`)
- Login box border, active tabs, and primary buttons changed from orange to blue

## Key Line References (approximate, shifts with edits)
### index.html (8,400+ lines)
- `getTenantSlug()` + `TENANT_SLUG`/`TENANT_ID` globals: line ~381-414
- `secureApi()` (tenantSlug in body + correctSlug passthrough): line ~632-680
- Multi-tenant auth flow (C-2 serialized): line ~858-985
- `subscribeCollection()` (no root fallback): line ~1303-1360
- `startListeners()` (settings listener guarded): line ~1420-1470
- Global state `D`: ~line 1700
- `IDX` Maps + `rebuildIndexes()`: ~line 1710
- `render()`: ~line 1750
- `markChanged()` / `markDeleted()`: ~line 7410
- `scheduleSync()`: ~line 7430
- `loadXLSX()`: ~line 6500
- `getRecName()` / `getPrepName()` already use `escHtml()`: ~line 2426
- `buildInvDropdownItems()` (data-* pattern): ~line 2950
- `filterRecIngSearch()` (data-* + event delegation): ~line 4980
- `filterMenuIngSearch()` (data-* + event delegation): ~line 5410
- `usedFor` construction (escHtml applied): ~line 4036
- Shopping list unit escaping: ~line 3541

### functions/index.js (1,127 lines)
- `ALLOWED_ORIGINS` + `isAllowedOrigin()` wildcard regex: line 23-40
- `ALLOWED_OPERATIONS` + `PERMISSION_MATRIX` (with super_admin): line 62-143
- `tenantCol()` + `toSlug()` + `getDefaultSeedData()`: line 145-193
- `writeAuditLog(userId, email, op, collection, count, tenantId)`: line 260-275
- `checkEmailWhitelist()` (C-1 ownerEmail-gated bootstrap): line 280-317
- `handleRequest`: line 361+
  - Tenant resolution (JWT claim or slug fallback): line 386-405
  - JWT claim stamping (tenantId + tenantSlug + role): line 454-476
  - H-1 slug-mismatch guard: line 478-499
- `provisionTenant` (M-2/M-3 validations): line 891-970
- `deprovisionTenant`: line 978-1002
- Standard CRUD (insert/update/upsert/delete) using `tenantCol()`: line 1020-1107

### firestore.rules (143 lines)
- `isApprovedForTenant(tenantId)`: line 22-27
- Tenant registry read: line 31-34
- 16 data collection matches: line 38-116
- `approved_emails` (server-only): line 120-122
- `tenants/{tenantId}/audit_log` explicit deny (defense-in-depth): line 127-129
- Root `/audit_log` (pre-auth fallback, server-only): line 133-135
- Catch-all deny: line 138-140

### Top-bar sync button (index.html)
- CSS `.sync-btn` + state classes: ~line 65-77
- Header button `#sync-btn` with `onclick="syncNow()"`: ~line 289
- `showSyncStatus()` mirrors to button states: ✓ idle / ⟳ syncing / ● unsaved / ! offline

- Cloud Function URL: firebase-config.js

## Phase 1 Follow-Up Fixes (2026-04-24 — ✅ DEPLOYED)

Mobile smoke test of the `+1 batch ✓` button on the Prep tab surfaced three interrelated issues. All three fixed and deployed to production in one hosting release.

### Regression #1 — Listeners were still using ROOT Firestore paths
Despite the 2026-04-23 docs claiming `subscribeCollection` was fixed, the actual code at `public/index.html:1277` still had:
```js
var ref = _fs.collection(firebaseDb, collectionName);
```
and `:1369` for settings. Every `onSnapshot` denied with "Missing or insufficient permissions" (16 errors on every login). The app *appeared* to work because `startListeners`'s all-fail fallback called `loadFromFirebase()` via Cloud Function (Admin SDK bypasses rules), but **real-time sync was completely broken** — writes landed in Firestore, but listeners never re-fed state, so mutations only showed after a full page reload.

**Fix**: build paths as `tenants/{tenantId}/{collection}` using `currentAuthUser.customClaims.tenantId`. Guarded at three levels:
- Top of `startListeners`: no-claim fallback to `loadFromFirebase()` with warning toast (line ~1342-1360)
- `subscribeCollection`: per-call tenantId check, increments `listenerFailCount` if missing (line ~1285-1300)
- Settings listener: same guard before subscribing (line ~1404-1410)

### Regression #2 — Success toast rendered RED
`showToast(msg, type, duration)` default was `type = type || 'error'`. Two calls in `logBatchComplete` (prep branch + menu/rec branch) omitted the type arg, so "✓ +1 batch → Abuela Chona Mix" rendered in the error-red background — user read it as a failure.

**Fix** (two-part):
- Changed `showToast` default to `'info'` (line ~411) and added matching `.toast.info` CSS (neutral dark-blue)
- Both `logBatchComplete` calls now explicitly pass `'success'` + 2.5s duration

### Regression #3 — On-hand count had no visible refresh on prep card
User reported "it is incrementing... but that doesn't show in this view, only viewable when you hit edit." The mutation + render pipeline was actually correct — `D.preps[n].onHand` was being bumped and `renderPrep` was re-running. But users had no confidence their tap registered: the card always showed a static "On hand: N batch" and looked identical pre/post-click.

**Fix** — dual feedback mechanism:
- **Session counter badge**: `prepSessionCounts[prep.id]` increments on every `+1 ✓`; renderPrep adds a green "+N this session" pill next to the on-hand value. Also wired for `recSessionCounts` on the Recipe Prep section.
- **Pulse animation**: on-hand `<span>` now has a stable ID (`prep-onhand-{id}` / `rec-onhand-{id}`); `logBatchComplete` sets a `flashPrepId` / `flashRecId`; end of `renderPrep` queryselects the element and adds `.onhand-pulse` (1s green-glow keyframe). Force-reflow trick (`void el.offsetWidth`) lets the animation re-trigger on consecutive clicks.

### Files touched (2026-04-24)
| File | Changes |
|------|---------|
| `public/index.html` | `subscribeCollection` tenant-scoped path + tenantId guard (:1285-1300); `startListeners` no-claim fallback (:1342-1360); settings listener tenant-scoped (:1404-1410); session counter + flash state vars (:411-412); `showToast` default → `'info'` (:416); `.toast.info` CSS (:83); `@keyframes onhandPulse` + `.session-count-badge` CSS (:86-89); `logBatchComplete` prep branch sets `flashPrepId` + `prepSessionCounts` + green toast (:3235-3243); `logBatchComplete` menu/rec branch sets `flashRecId`/`flashMenuId` + session counters + green toast (:3298-3308); `renderPrep` renders session badges + stable IDs (:4438-4441, :4478-4483); `renderPrep` post-render pulse trigger (:4512-4524) |
| `public/signup.html` | Mobile-responsive: enhanced viewport meta with `viewport-fit=cover` + apple-mobile-web-app + format-detection (:5); body CSS — safe-area env() padding, text-size-adjust, tap-highlight-color (~:24); 4 cascading breakpoints appended at end of `<style>`: @768 (stack hexagon), @640 (phone), @480 (small phone — `mock-row4 .mock-par{display:none}`), @360 (Android minimum) |

### Deploy
Single `firebase deploy --only hosting` — 7 files, clean release. Hard-refresh at restaurant-oracle.web.app to pick up the new bundle.

### Debugging lessons
- **Listener fallback masked the real bug for a full day.** The `loadFromFirebase()` Cloud Function fallback in `startListeners` error handler made the app appear functional while real-time sync was silently broken. For any future multi-tenant path migrations, validate that listeners report 0 errors in the console — not just that data loads.
- **Toast default of `'error'` was a long-standing trap.** Fixed globally to `'info'` so callers who forget the type arg don't accidentally scream red at users.
- **Visible feedback ≠ correct data flow.** The render pipeline was fine; the user just couldn't tell. A pulse + session counter was cheaper than deeper instrumentation.

## App file location
Main SPA lives at `firebase/public/app.html` (~8,838 lines). Root `firebase/public/index.html` is marketing landing (637 lines). Firebase hosting rewrite: `** → /app.html`. Do NOT edit `index.html` for app features.

## Subtle Feedback Capture (2026-04-24 — ✅ DEPLOYED & VERIFIED LIVE)

Non-interruptive in-app feedback. No surveys, no NPS, no "rate us" prompts. 3 entry points all auto-tag current feature.

### Schema
`tenants/{tenantId}/feedback_events/{auto-id}`:
```
userId, userEmail, feature, sentiment ('positive'|'negative'|null),
comment (sanitized, max 2000), route, userAgent, appVersion, timestamp
```
Reject if sentiment null AND comment empty.

### Backend — `functions/index.js`
- `'submitFeedback'` added to `ALLOWED_OPERATIONS`, `boolOps`, all 3 roles in `PERMISSION_MATRIX`
- Handler after `deprovisionTenant` (pre-CRUD switch): validates feature against allowlist (13 tags), writes via `tenantCol(tenantId, 'feedback_events')`, calls `writeAuditLog(..., 'feedback_submit', ...)`, returns `{id}`
- Reuses `sanitizeString()` (HTML strip) + existing rate limit bucket

### Rules — `firestore.rules`
```
match /tenants/{tenantId}/feedback_events/{eventId} {
  allow read: if isSuperAdmin() || belongsToTenant(tenantId);
  allow create: if belongsToTenant(tenantId);
  allow update, delete: if isSuperAdmin();
}
```
Tenant-gated create (CF is primary path; direct-client create fallback).

### Frontend — `public/app.html`
- **3 entry points**: (1) inline `👍👎` thumbs on `#hdr-t`, fade-in on hover at ~30% opacity; (2) `?` keyboard shortcut (guards INPUT/TEXTAREA/contenteditable); (3) "💬 Send Feedback" item in account dropdown before Sign Out
- **Drawer**: bottom-right fixed, 340px × 300px, matches `.card` dark theme. Escape closes. Cmd/Ctrl+Enter submits.
- **Feature resolver**: `currentFeatureTag()` maps global `tab` → feature tag. Scan modal detected via `modal-o.open` + title contains "scan" (precedence over tab).
- **Submit state**: enabled if sentiment set OR comment ≥ 1 char
- **No post-submit chrome**: drawer fades, period. No "thanks" toast.
- **PostHog mirror**: `roTrack('feedback_submitted', {feature, sentiment, hasComment})` gated by `has_opted_out_capturing()`
- **App version**: hardcoded `'v2026.04.24'` (build-id pipeline deferred)

### Emails.js TDZ deploy-blocker (pre-existing, unrelated — fixed during this task)
`functions/emails.js` had `const TEMPLATES = {...}` at line 29 calling `require_template()` which dereferenced `BUILTIN_TEMPLATES` const declared at line 196. Node evaluates top-to-bottom → TDZ error. This was silently blocking ALL CF deploys.
**Fix**: removed eager `TEMPLATES` const + `require_template` helper; use `BUILTIN_TEMPLATES` directly at lookup sites.

### Deploy path (2026-04-24)
1. Fix emails.js TDZ first (unblocks deploys)
2. `firebase deploy --only functions:api,firestore:rules,hosting`
3. Grant `roles/iam.serviceAccountTokenCreator` on `firebase-adminsdk-fbsvc@...` to user (needed for custom-token minting via ADC)
4. Enable `iamcredentials.googleapis.com`
5. Verify end-to-end by minting ID token via manual JWT + IAM signBlob REST (firebase-admin SDK's internal signer still fails with ADC; manual signing works)
6. POST 3 test events, verify landed in Firestore with correct feature tags, confirm 3 `feedback_submit` audit entries

### Custom token minting with ADC (no SA keys — org policy blocked)
Firebase Admin SDK's `auth.createCustomToken()` fails under ADC even with `serviceAccountId` set (SDK internal issue). Workaround: build JWT manually, sign via `iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/{SA}:signBlob` REST. Requires user has `roles/iam.serviceAccountTokenCreator` on target SA.
```
header: {alg:'RS256', typ:'JWT'}
payload: {iss: SA_EMAIL, sub: SA_EMAIL, aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit', iat, exp, uid}
signingInput = b64url(header) + '.' + b64url(payload)
signature = signBlob(b64(signingInput))
customToken = signingInput + '.' + b64url(signature)
```
Then exchange via `identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key={WEB_API_KEY}`.

### Audit log field names (gotcha)
`writeAuditLog()` writes snake_case: `user_id`, `user_email`, `tenant_id`, `operation`, `collection`, `record_count`. NOT camelCase. Scripts querying audit log must use `.where('operation', '==', ...)` — composite index with `timestamp` may not exist.

### Out of scope
- V2 power-user prompts (30-day contextual banner)
- Operator dashboard consumption (sibling task, reads `feedback_events` via CF)
- 14-day anti-fatigue cooldown (only for contextual prompts)

## PostHog Product Analytics (2026-04-24 — ✅ DEPLOYED & VERIFIED LIVE)

Client-only product analytics. No server-side tracking, no session replay, no A/B testing, no heatmaps. GDPR-friendly (DNT, IP-drop, `identified_only`).

### API key (public, safe to embed)
`phc_srhjbdeE5yJZC7F4wVSNqwSui46eHJErtQpXfSQ6Te32` — hardcoded in `firebase/public/posthog-init.js:14`. US region (`us.i.posthog.com`).

### Files
| File | Role |
|------|------|
| `firebase/public/posthog-init.js` | Shared loader + config + `roIdentify`, `roPosthogReset`, `roTrack` globals. `sanitize_properties` strips `password`, `cardNonce`, `cvv`, `verificationToken`, etc. |
| `firebase/public/index.html` (landing) | `<script src="posthog-init.js">` in `<head>`; `landing_viewed` + CTA events |
| `firebase/public/signup.html` | Snippet + signup funnel: `signup_page_viewed`, `signup_submitted`, `signup_success`, `signup_failed` |
| `firebase/public/app.html` | Snippet + `roIdentify(user, claims)` on auth + `roPosthogReset()` on sign-out + 7 feature_used events + onboarding + `page_viewed` on `go(t)` |
| `firebase/public/admin.html` | Snippet + identify (`surface: 'admin'`) + 5 billing events |
| `firebase/public/privacy.html` | PostHog disclosure (§2.3, §5 table) + `12a. Product Analytics Opt-Out` (DNT, `posthog.opt_out_capturing()`, email erasure) |
| `firebase/firebase.json` | CSP: `script-src` + `connect-src` + `img-src` allow `https://us.i.posthog.com` + `https://us-assets.i.posthog.com` |

### Config (posthog-init.js:14-33)
- `person_profiles: 'identified_only'` — anon landing visitors create no profile
- `capture_pageview: false` — SPA emits `page_viewed` manually in `go(t)`
- `respect_dnt: true`, `ip: false` (GDPR)
- `disable_session_recording: true`, `autocapture: false` — explicit events only
- `persistence: 'localStorage+cookie'`
- `sanitize_properties` drops PII fields before send

### Instrumented events
- **Landing**: `landing_viewed`, `landing_cta_clicked`
- **Signup funnel**: `signup_page_viewed` → `signup_submitted` → `signup_success` / `signup_failed`
- **App**: `page_viewed` (on `go(t)`), `feature_used` (7 variants: `vendor_order_sent`, `prep_sheet_print`, `inventory_scan`, `inventory_scan_applied`, `oracle_query`, plus tab-scoped); `onboarding_wizard_step`, `onboarding_completed`
- **Billing**: `billing_page_viewed`, `billing_plan_changed`, `billing_subscription_cancelled`, `billing_subscription_resumed`, `billing_card_updated`
- **Feedback**: `feedback_submitted` (mirror of Firestore write, gated by `has_opted_out_capturing()`)

### Identify flow
Called from `app.html` and `admin.html` after `getIdToken(true)` resolves claims. Person props: `tenantId`, `tenantSlug`, `role`, `approved`, `plan`, `emailVerified`, `signedUpAt`. Tenant `group('tenant', claims.tenantId, {slug, plan})`. Email sent only if `extra.includeEmail === true` (currently never). Reset on sign-out via `window.roPosthogReset()` before `fbAuth.signOut()`.

### Seed events
Production dashboards bootstrapped with 27 seed events fired via `preview_eval` in the preview server, each tagged `source: 'seed'` so they can be filtered out of production dashboards later. When real traffic arrives, either add `source != 'seed'` filter to each insight or delete seed events via PostHog API.

### Dashboards built
**Bistro Steward — Growth** (3 tiles, all added from "Add insight to dashboard" modal):
1. Retention — `page_viewed` cohort return
2. Feature Adaption *(user typo — cosmetic, rename via 3-dot menu if desired)* — `feature_used` breakdown by feature
3. `landing_viewed → signup_submitted → signup_success` funnel

### Opt-out paths (documented in privacy.html §12a)
- Browser DNT → respected by `respect_dnt: true`
- User console: `posthog.opt_out_capturing()` / `posthog.opt_in_capturing()`
- Email `privacy@bistrosteward.com` for data erasure

### Gotchas
- NEVER call `posthog.identify()` before auth is known → anon-to-id merge issues per PostHog docs
- Funnel editor shows "No results for X" until at least one event with that name has been captured — seed or wait for real traffic
- `phc_YOUR_KEY` placeholder left in a file = `config.js → 404` + `/flags/ → 401` in network log; verify with `preview_network` after init
- CSP must include both `us.i.posthog.com` (events) AND `us-assets.i.posthog.com` (array.js bundle) — loader rewrites host

## Operator Console Gap-Fill + Rename (2026-04-25 — ✅ DEPLOYED & LIVE)

Single-PR sweep filling 5 integration seams that were left half-wired in the pre-existing operator console buildout, plus a URL/branding rename to disambiguate "admin" from "billing".

### URL surface (post-rename)

| URL | Audience | Auth gate | Purpose |
|-----|----------|-----------|---------|
| `/app` | All tenant staff | `tenantId + approved=true` | Kitchen ops (recipes, inventory, prep, scan, voice). Has internal `⚙️ Admin` tab for workspace settings (data import/export, approved-emails). |
| `/billing` | Tenant **owner** | same + `role=owner` | Subscription mgmt (plan switch, Square card update, team invites). New canonical URL. |
| `/admin` | (alias) | same as `/billing` | Kept as alias in `firebase.json` rewrites for backward compat. Drop after one rotation. |
| `/super-admin` | Platform operator (Anthony) | `superAdmin=true` claim | All-tenant ops. Customer never sees. |
| `/signup`, `/`, `/terms`, `/privacy` | public | none | Marketing/onboarding. |

`firebase.json` rewrites: `/billing → /admin.html` (new), `/admin → /admin.html` (alias kept). File-level rename deferred — only public URL changed. `app.html` user dropdown link updated `/admin.html → /billing`. `admin.html` `<title>` and brand-sub: "Owner Console" → "Billing & Account".

### Operator console (`super-admin.html`, ~1925 lines)

Single-file dashboard — sidebar nav, 8 top-level tabs, 22-tab tenant drawer, 3-tab ticket drawer, modal/toast system. 54 super-admin CF ops dispatched via `superAdmin` endpoint. Sidebar tabs:

- **Overview** — KPI grid (12 stats: total tenants, active subs, trialing, trial-ending-7d, MRR, MRR-change-MoM, platform cost/day, open tickets, critical tickets, avg health, churn 30d, signups 7d, DAU, super-admin count, feedback 7d). MRR sparkline (canvas, gradient fill). Top-at-risk tenants. Recent audit feed. "Run rollups now" button.
- **Tenants** — `listTenantsEnriched` table with search, filter (status/plan), sort (recent/health/slug/MRR). Click row → drawer with 22 sub-tabs.
- **Tickets** — `listTickets` table; create/reply/assign/close/reopen/tag flow. Internal-note checkbox toggle on reply. Composite hash deeplink `#/tickets/{ticketId}__{tenantId}`.
- **Feedback** — `aggregateFeedbackByFeature` summary table + recent events list with sentiment chip + `markFeedbackReviewed` action.
- **Agents** — `listSuperAdmins` (grant/revoke) + `listOperators` (status/load).
- **Announce** — `pushAnnouncement` form (title, severity info|warning|critical, body, link, expires) + active list. Targets `platform_announcements` collection (any signed-in tenant client renders).
- **Flags** — `setFeatureFlag` (name, true/false, scope global|tenant) + flags table.
- **Settings** — rate-card display (Firestore/CF/Gemini/Resend pricing) + `manualAuditEntry` form.

### 22-tab tenant drawer (`getTenantFull`)

Summary, Users (uid/role/reset-password/revoke-tokens/resend-verify), Billing (Square sub + charges), **Costs** (now real — cost_daily series with reads/writes/CF/Gemini/emails breakdown), **Usage** (usage_daily series, top ops), Health (score, signals JSON), Tickets, Feedback, Notes (internal_notes — pin/delete), Meta & tags (priority/assignee/notes + tag CRUD), Data volume, Audit log, Collections (raw subcollection counts), Flags (per-tenant overrides), Announce (push tenant-scoped banner), Actions (suspend/export/softdelete/force-cancel/resend-welcome), **Impersonate** (mint 30-min RO token, opens `/?impersonateToken=…&tenant=…&expiresAt=…` in new tab), Refund (Square refund), Plan (adjust + prorate toggle), Comp (free months + reason), Export (full JSON dump, may take 20-40s for big tenants), Danger (hard-delete with type-tenantId confirmation).

### 5 scheduled functions (already exported pre-PR)

`dailyTenantCostAggregation`, `dailyUsageStatsRollup`, `dailyHealthScoreCompute`, `dailyTrialCheck`, `dailyTrialReminders`. All Gen 1, region us-central1.

### 5 gaps fixed in this PR

| Gap | File | Fix |
|-----|------|-----|
| Voice Gemini calls had no token tracking → `tenant_costs_daily.geminiInputTokens` always 0 | `functions/index.js:447` (helper) + `:825-934` (voice handler wrap) | New `logGeminiUsage({tenantId, userId, op, model, inputTokens, outputTokens, totalTokens, latencyMs, success, errorCode, timestamp})` writes to `tenants/{id}/geminiUsage/{auto}`. Voice wrap captures `result.response.usageMetadata.{promptTokenCount, candidatesTokenCount, totalTokenCount}` on success + zeros on failure. Latency from `Date.now()` delta. Non-fatal — write errors `console.warn` only, never break voice response. |
| Scan Gemini Vision same gap | `:998-1108` | Same wrap, `op: 'scan'`. |
| `superOpImpersonateTenant` returned `{token}` but frontend reads `r.customToken` → "No token returned" toast every time | `:3989-4035` | Renamed return key to `customToken`. Added `readOnly: true` claim. Added `impersonationExpiresAt` (now+30min ms). Duration shortened from 1h to 30min per spec. Returns `{customToken, tenantSlug, tenantId, expiresAtMs, expiresInSeconds: 1800}`. |
| `secureApi` had no enforcement of `readOnly` claim — impersonating super-admin could still write | `:702-722` (gate added between tenant-status gate and `checkPermission`) | If `decodedToken.impersonating === true`: reject with 401 if `Date.now() > impersonationExpiresAt` (audit `impersonation_expired`); if `readOnly === true` and op not in `['select','getTenantConfig','checkSlugAvailable','get_tenant_settings','list_invoices']`, reject with 403 (audit `impersonator_write_blocked`). |
| `firestore.rules` missing rule for new per-tenant `geminiUsage` subcollection — catch-all denied (defense-in-depth, but explicit is better) | `firestore.rules:222-228` | `match /tenants/{tenantId}/geminiUsage/{eventId}` — `read: isSuperAdmin() OR belongsToTenant(tenantId)`, `write: false` (admin SDK only). |

### Frontend impersonation flow (`app.html`)

Already had bootstrap at `:975-1001` and banner DOM at `:387-396` + handler at `:1462-1530`. This PR extended:

1. **Bootstrap**: now also captures `expiresAt` query param into `sessionStorage.impersonationExpiresAt`. URL scrubs all 3 params (`impersonateToken`, `tenant`, `expiresAt`).
2. **Banner DOM**: added `READ-ONLY` chip + `<span id="imp-countdown">` after operator email.
3. **Handler**: reads `claims.impersonationExpiresAt` (authoritative) with `sessionStorage` fallback. Sets up 1Hz `setInterval` rendering `MM:SS left`. At expiry: clears interval, shows `EXPIRED`, signs out, alerts user, redirects to `/super-admin`. Stored as `window._impCountdownTimer` so re-fires (sign out / claim change) clear cleanly. Exit button also clears sessionStorage.
4. **Feedback widget hide**: `body.impersonating .fb-inline, body.impersonating #fb-drawer, body.impersonating .user-dropdown-item[onclick*="openFeedbackDrawer"] { display:none !important }` — operator can't pollute customer feedback during debug.

### Auth domain hardening

After deploy, Google sign-in failed at `bistrosteward.com` with `auth/unauthorized-domain`. Default Firebase allowlist had only `localhost`, `restaurant-oracle.firebaseapp.com`, `restaurant-oracle.web.app`. Fixed via Identity Toolkit REST API (no Firebase Console clicks):

```bash
gcloud auth application-default set-quota-project restaurant-oracle
TOKEN=$(gcloud auth print-access-token)
curl -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: restaurant-oracle" \
  -H "Content-Type: application/json" \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/restaurant-oracle/config?updateMask=authorizedDomains" \
  -d '{"authorizedDomains":["localhost","restaurant-oracle.firebaseapp.com","restaurant-oracle.web.app","bistrosteward.com","www.bistrosteward.com"]}'
```

Per CLAUDE.md "do not ask user to click" — gcloud REST is the answer for Identity Platform admin (gcloud has no `identity-platform` subcommand).

### Sidebar branding (super-admin.html `:42-45`)

Stacked layout: icon 64×64 above title. `flex-direction:column; align-items:center; text-align:center; gap:8px`. Icon `object-fit:contain` to preserve aspect ratio (was 36×36 horizontal w/ squashed proportions).

### Pre-existing deploy blocker — invoices.js TDZ

`functions/invoices.js:26` had `const db = admin.firestore();` at module load — fails because `index.js` calls `admin.initializeApp()` after `require('./invoices')`. Same pattern as the `agents.js` deferral fix. Replaced with `function db() { return admin.firestore(); }` and sed-replaced all 11 call sites `db.collection|runTransaction → db().collection|runTransaction`. Unblocks `firebase deploy --only functions`.

### What stayed deferred

- Per-task git commits — abandoned. Pre-existing dashboard was all untracked, so any per-task commit baselines the entire 5000+ line backend. Plan revised to single logical commit at end of session (still pending — user has not asked yet).
- Screenshots per spec deliverable — manual capture not done.
- e2e test (`_e2e_super_admin.js`) against live — needs `FIREBASE_WEB_API_KEY` env var. Defer to next session.
- Bistro_Steward_Updates.md changelog entry — defer. (NOTE 2026-05-01: file consolidated into Bistro-Steward/MASTER.md "Quality Audit & Fixes (Updates Log)" section.)

### Files touched (2026-04-25)

| File | Lines changed |
|------|---------------|
| `firebase/functions/index.js` | +63 (logGeminiUsage helper) +20 (voice wrap) +24 (scan wrap) +16 (superOpImpersonateTenant rewrite) +17 (impersonator-write block) ≈ 140 net additions |
| `firebase/functions/invoices.js` | `const db = ...` → `function db() {...}` + 11 call-site rewrites |
| `firebase/firestore.rules` | +9 (geminiUsage match block) |
| `firebase/firebase.json` | +4 (`/billing` rewrite) |
| `firebase/public/super-admin.html` | impersonateTenant URL builder rewrite (sends customToken+tenant+expiresAt to `/`); brand stacked layout (4 CSS lines) |
| `firebase/public/app.html` | bootstrap captures expiresAt + sessionStorage stash; banner adds READ-ONLY chip + countdown span; handler adds 1Hz countdown w/ auto-logout; CSS hides feedback widget when impersonating; user dropdown link `/admin.html → /billing` |
| `firebase/public/admin.html` | title + brand-sub "Owner Console" → "Billing & Account" |

### Deploy order (this session)

1. `firebase deploy --only firestore:rules` — clean.
2. `firebase deploy --only functions,hosting` — first attempt failed on invoices.js TDZ. Patched, retried, clean.
3. Identity Toolkit REST PATCH for authorizedDomains.
4. `firebase deploy --only hosting` (sidebar branding) — clean.
5. `firebase deploy --only hosting` (URL rename + admin branding) — clean.

### Operator console URL

`https://bistrosteward.com/super-admin` (or `https://restaurant-oracle.web.app/super-admin`). Gated, no link from public surfaces.

## Ship Blockers + Security Sweep (2026-04-26 — ✅ DEPLOYED & VERIFIED LIVE)

End-to-end completion of the 5 ship blockers from prior session, plus full security audit with 8 findings (2 H + 2 M + 2 L + 2 fix-as-found) all fixed and deployed.

### Ship blockers (all 5 — DONE)
1. **Terms of Service** — new `firebase/public/terms.html` (16 sections, Oregon law, Multnomah County jurisdiction, $100/12-month liability cap, dark-theme card matching signup)
2. **Privacy Policy** — new `firebase/public/privacy.html` (14 sections, GDPR/CCPA/CPRA, multi-tenant isolation disclosed, AI processing disclosure, 30+60+7y retention)
3. **Signup consent** — `signup.html` consent checkbox required to submit, server-side `agreedToTerms === true` + `termsVersion === '2026-04-24'` enforced (412 if missing). Persisted to tenant doc as `{termsAcceptedAt, termsVersion, ip, userAgent}` for legal audit trail
4. **Square error handling** — `mapSquareErrorToMessage(err, fallback)` maps ~30 codes (CARD_DECLINED, VERIFY_CVV_FAILURE, INVALID_EXPIRATION, INSUFFICIENT_FUNDS, CARD_TOKEN_EXPIRED, GENERIC_DECLINE, etc.) to user-friendly messages. Used in 3 signupTenant catch blocks (customer/card/sub). Frontend auto-clears Square card iframe on card-error codes
5. **Email verification gate** — `secureApi` rejects 403 if password-auth user with `emailVerified !== true`. Frontend blocks app load with "Verify your email" screen + Resend/Verified buttons. Reload via `user.reload()` + `getIdToken(true)`. Skipped for Google sign-in

`firebase.json` rewrites: added `/terms`, `/privacy`.

### Cancellation UX
"Cancel subscription" in `/billing` → confirm modal → `adminBilling { op: 'cancelSubscription' }` → Square cancel + `cancellationScheduledAt` set. End-of-period grace via tenant-status gate in CF. Reactivation via `resumeSubscription` op.

### Onboarding wizard
First-login owner sees 3-step wizard (welcome → invite team → completion). State stored on tenant doc (`onboardingComplete`, `onboardingCompletedAt`, `onboardingCompletedBy`). `adminOpCompleteOnboarding` CF op writes flag. `app.html` checks via `checkAndShowOnboarding()` after auth ready, only for `currentUserRole === 'owner'`. Once-per-session via `window._onboardingChecked` flag.

### Security audit findings + fixes (all 8 — DONE)

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| H-1 | HIGH | `requireOwner` lacked email-verify + provider check → unverified password owner could call every adminBilling op | `functions/index.js:1785` — added `signInProvider === 'password' && email_verified !== true` → 403 |
| H-1 | HIGH | `handleAdminBilling` no rate limit | Added `checkRateLimit(authCtx.userId)` → 429 with audit `admin_rate_limit_exceeded` |
| H-1 | HIGH | Cancelled tenants could still invite/remove members | New `cancelledSafeOps = {getInfo, updatePaymentMethod, resumeSubscription}`. All others 402 with status check on tenant doc when status ∈ {suspended, cancelled, canceled} |
| H-2 | HIGH | Server-side ToS consent not enforced | `validateSignupInput` requires `agreedToTerms === true` + `termsVersion` matches YYYY-MM-DD pattern. `handleSignup` stores `{termsAcceptedAt, termsVersion, ip, userAgent}` on tenant. Client POSTs `agreedToTerms: true, termsVersion: '2026-04-24'` |
| M-1 | MED | `verifyIdToken` not checking revocation | Changed `auth.verifyIdToken(idToken)` → `auth.verifyIdToken(idToken, true)` in requireOwner (checkRevoked=true) |
| L-1 | LOW | Square `primary.detail` echoed unbounded in error responses | `mapSquareErrorToMessage` truncates to 200 chars + `…` suffix. Used in BAD_REQUEST + UNKNOWN branches |
| L-2 | LOW | Invite button stuck disabled on success | `onboardingInvite` re-enables button before `onboardingNext()` for nav-back safety |

### Email verification gate placement (secureApi)
```
auth.verifyIdToken → check signInProvider === 'password' && email_verified !== true
  → audit 'email_not_verified' + 403 with explanatory message
```

### Tenant-status gate (secureApi)
```
const readOnlyOps = ['select', 'getTenantConfig', 'checkSlugAvailable']
if status ∈ {suspended,cancelled,canceled} && !readOnlyOps.includes(op)
  → 402 with reactivation guidance
```

### Verified live post-deploy
- `/signup`, `/terms`, `/privacy` → 200
- `signupTenant` no consent → `400 "You must agree to the Terms of Service and Privacy Policy"`
- `adminBilling` unauth → `401 Missing authorization header`
- `termsVersion: '2026-04-24'` baked into live signup HTML

### Deploy
```
firebase deploy --only functions:api,functions:signupTenant,functions:adminBilling,hosting
```
Single command. Clean.

## Operator Dashboard — Full 21-Category Expansion (2026-04-26 — ✅ DEPLOYED & VERIFIED LIVE)

User asked for "every detail of interest" — delivered exhaustive 21-category data inventory then built it. Subagent execution: +2116 lines net to `functions/index.js` (2735 → 4851), full rewrite of `super-admin.html` (682 → 1921 lines), 8 top-level tabs, 22-tab tenant drawer, 54 super-admin CF operations.

### 10 new Firestore collections (all rules + indexes added)

| Collection | Purpose |
|------------|---------|
| `/tenants/{id}/support_tickets/{id}` + `/messages` subcoll | Ticket tracking — subject/body/status/priority/assignedTo/source. Internal-note flag on messages |
| `/tenants/{id}/feedback_events/{id}` | Feature feedback (already existed pre-PR; rules unified) |
| `/tenants/{id}/internal_notes/{id}` | Operator-only notes — body/pinned/tags |
| `/tenant_costs_daily/{tenantId}_{YYYY-MM-DD}` | Daily cost rollup — Firestore reads/writes/deletes/storage, CF invocations/GB-s, Gemini in/out tokens, Resend emails, total USD |
| `/tenant_usage_daily/{tenantId}_{YYYY-MM-DD}` | Daily usage rollup — recipes/ingredients/prep sheets/scans/oracle queries/orders/exports, uniqueUsers, sessions, totalSessionMinutes |
| `/tenant_health/{tenantId}` | Current health snapshot — engagementScore, churnRiskScore, atRiskFlag, factors[], recommendedIntervention |
| `/tenant_meta/{tenantId}` | Operator-editable — tags, csm, priorityScore, followUpDate, strategicValueFlag, customLabels |
| `/operators/{uid}` | Operator profile — status (online/offline/busy), openTicketCount, avgResolutionHours, csat |
| `/platform_announcements/{id}` | Broadcast banners — audience (all/plan/tenant_ids), severity, expiresAt, dismissible |
| `/feature_flags/{name}` | Per-tenant overrides — enabledTenants[], disabledTenants[], rolloutPercent |

### 14 composite indexes added
- support_tickets × 6 (status/priority/assignedTo + opened combinations)
- feedback_events × 4 (feature/sentiment + timestamp)
- tenant_costs_daily × 2, tenant_usage_daily × 2 (tenantId + date DESC)

### 54 CF operations on `superAdmin` endpoint

Categories:
- **Enriched listing**: `listTenantsEnriched`, `getTenantFull`, `getKpiOverview`
- **Tickets** (8 ops): `listTickets`, `getTicket`, `createTicket`, `replyTicket`, `assignTicket`, `closeTicket`, `reopenTicket`, `addTicketTag`/`removeTicketTag`
- **Feedback** (3): `listFeedback`, `aggregateFeedbackByFeature`, `markFeedbackReviewed`
- **Notes** (4): `listNotes`, `addNote`, `updateNote`, `deleteNote`
- **Meta** (4): `getTenantMeta`, `setTenantMeta`, `addTenantTag`, `removeTenantTag`
- **Costs/Usage/Health reads**: `getTenantCosts({days})`, `getTenantUsage({days})`, `getTenantHealth`
- **Operator actions**: `impersonateTenant` (mints 30-min RO custom token + audit), `exportTenant` (full JSON dump), `softDeleteTenant`, `hardDeleteTenant` (requires confirmation === tenantId), `resetUserPassword`, `revokeTokens`, `resendVerification`, `adjustPlan`, `compInvoice`, `issueRefund`, `pushAnnouncement`, `setFeatureFlag`, `manualAuditEntry`
- **Agents**: `listOperators`, `updateOperatorStatus`
- **Pre-existing preserved**: `dashboard`, `listTenants`, `getTenantDetails`, `suspendTenant`, `unsuspendTenant`, `forceCancel`, `listSuperAdmins`, `grantSuperAdmin`, `revokeSuperAdmin`

All ops route through `requireSuperAdmin` + `checkRateLimit(uid)` + `writeSuperAudit` (new helper, prefixes audit op with `super_admin_`).

### 4 new scheduled rollup functions (Cloud Scheduler)

| Function | Cron | Purpose |
|----------|------|---------|
| `dailyTenantCostAggregation` | 01:00 PT | Per-tenant Firestore/CF/Gemini/Resend cost rollup. Rate card constants in `RATE_CARD` |
| `dailyUsageStatsRollup` | 01:30 PT | Per-tenant audit_log → operation-bucketed usage counts + DAU |
| `dailyHealthScoreCompute` | 02:00 PT | Composite engagement + churn-risk score with weighted factors |
| `dailyTrialCheck` | 08:00 PT | Updates `daysIntoTrial` field on tenant docs |

All wrapped in per-tenant try/catch — one bad tenant doesn't kill the run. Idempotent doc writes. `superOpRunRollupsNow` triggers all 3 compute fns immediately for testing.

### Rate card (constants for cost computation)

```
Firestore: read $0.036/100k, write $0.108/100k, delete $0.012/100k
CF: invocation $0.40/1M, GB-s $0.0000025
Gemini 2.5 Flash: input $0.075/1M tokens, output $0.30/1M
Resend: $0.0004/email
```

### Super-admin UI (`super-admin.html` — full rewrite, 1921 lines)

**Top-level tabs** (sidebar nav, hash routing): Overview / Tenants / Tickets / Feedback / Agents / Announce / Flags / Settings.

**Overview**: 12 KPI cards + 30-day MRR canvas sparkline + top-at-risk tenants list + recent audit feed + "Run rollups now" button.

**Tenants**: Enriched table — slug/name/owner/plan/status/trial-end/onboard%/last-active/tickets/MRR/health/tags. Click row → 22-tab drawer slides in from right.

**22-tab tenant drawer**: Summary, Users (uid/role/reset-pw/revoke-tokens/resend-verify), Billing, Costs, Usage, Health, Tickets, Feedback, Notes, Meta (tags/csm/priority), Data Footprint, Audit log, Collections, Flags, Announce, Actions, Impersonate, Refund, Plan, Comp, Export, Danger (hard-delete with type-tenantId gate).

**Tickets**: Global list, 3-tab drawer (thread/reply/tenant snapshot). Reply has internal-note checkbox.

**Feedback**: Per-feature aggregate + event stream + mark-reviewed.

**Agents**: Super-admin grant/revoke + operator status.

**Announce**: Compose form + active list. Targets `platform_announcements` (any signed-in tenant client renders).

**Flags**: Global + tenant-scoped toggles.

**Settings**: Rate card display + manual audit entry form.

**UX**: Hand-rolled canvas sparkline (no chart lib), `/` focus search, `j/k` row nav, `Enter` open, `Esc` close. Toast stack bottom-right. Type-tenantId confirmation modal for destructive ops.

### Bug fixes after subagent build (2026-04-26 same session)

1. **Firebase init case mismatch** — `super-admin.html:598` called `firebase.initializeApp(window.firebaseConfig)` but `firebase-config.js` exposes `window.FIREBASE_CONFIG`. Result: `FirebaseError: Need to provide options ... (app/no-options)`, page stuck on "Verifying access…" because `auth.onAuthStateChanged` never fires. Fix: `firebase.initializeApp(window.FIREBASE_CONFIG || window.firebaseConfig)`.

2. **Sentry placeholder DSN throws** — `sentry-init.js` shipped with `dsn: 'FRONTEND_DSN_PLACEHOLDER'` and called `Sentry.init({dsn:...})` unconditionally → `Invalid Sentry Dsn: FRONTEND_DSN_PLACEHOLDER` console error on every page. Fix: detect placeholder via concat trick (`'FRONTEND_DSN_' + 'PLACEHOLDER'`) and early-return with noop globals. Real DSN swap deferred to Sentry-wire-up task.

### Verified live post-deploy
- `/super-admin` → 200
- `superAdmin` CF unauth → 401 ("Missing authorization header")
- 4 scheduled fns confirmed deployed via `firebase functions:list`: `dailyTenantCostAggregation`, `dailyUsageStatsRollup`, `dailyHealthScoreCompute`, `dailyTrialCheck`
- `superOpRunRollupsNow` invokes 3 compute fns sync (testing path)

### Files touched (2026-04-26)

| File | Change |
|------|--------|
| `firebase/functions/index.js` | 2735 → 4851 lines (+2116). RATE_CARD + writeSuperAudit + ymdUtc helpers. 45 new superOp* handlers. SUPER_OPS dispatcher updated to 54 ops. handleSuperAdmin gains rate limit. 4 scheduled fns added |
| `firebase/public/super-admin.html` | 682 → 1921 lines (full rewrite). 8 sidebar tabs, 22-tab drawer, 3-tab ticket drawer, hand-rolled MRR sparkline, hash routing, keyboard shortcuts |
| `firebase/public/app.html` | Red impersonation banner + `?impersonateToken=` consumer (calls `signInWithCustomToken`, scrubs URL via `history.replaceState`) |
| `firebase/firestore.rules` | +11 rule blocks (10 new collections + helper alignment) |
| `firebase/firestore.indexes.json` | +14 composite indexes |
| `firebase/public/sentry-init.js` | Placeholder-DSN graceful skip |
| `firebase/public/super-admin.html:598` | FIREBASE_CONFIG case fix |

### Deferred (subagent notes)

- Real Sentry DSN swap (waiting on Sentry-wire-up task)
- Real PostHog key in `posthog-init.js` if placeholder shipped
- Ticket composer uses `prompt()` for subject/body/priority — full modal deferred
- Rollup data populates 01:00 PT tonight first run; tabs show "No data yet" placeholders defensively until then
- E2E tests against live (`_e2e_super_admin.js`) — needs FIREBASE_WEB_API_KEY

## Open Task Chips (2026-04-26)

7 task chips spawned via `mcp__ccd_session__spawn_task` for follow-up work. Each is self-contained — user clicks chip to spawn fresh worktree session. Order they were created:

1. **Set up email addresses** — `support@`, `privacy@`, `noreply@` etc on bistrosteward.com via Cloudflare Email Routing (free) or Google Workspace ($7/mo). Wire Firebase Auth custom sender. Diagnose domain state first (.com vs .app TLD mismatch in policies)
2. **File trademark** — USPTO TESS clearance search → recommend filing path → walk through TEAS Standard if user picks self-file. Class 9 + 42. Don't pay anything without user OK
3. **Build landing page** — replace sign-in-only root with marketing page (hero/features/pricing/screenshots/CTA). Move app to `/app`. NOTE: subsequent file inspection showed `index.html` (35k) is already a marketing landing page, `app.html` is the SPA — task may already be done. Verify before re-doing
4. **Wire transactional emails** — Resend integration. 9 templates: trial-ending-7d/2d/today, first-charge-receipt, payment-failed, cancelled, reactivated, team-invite, owner-welcome. Cron `dailyTrialReminders` for trial alerts. Wire Square webhook hooks. Depends on email setup task
5. **Wire Sentry monitoring** — frontend + CF DSNs, source maps optional, alert rules. CSP already whitelists `*.ingest.sentry.io`. Just need real DSN and init enable
6. **Wire PostHog analytics** — NOTE: `posthog-init.js` already exists with key `phc_srhjbdeE5yJZC7F4wVSNqwSui46eHJErtQpXfSQ6Te32`. Task may be already done — verify CSP + dashboard creation status
7. **Recruit 3 design partners** — 15-20 candidate list via LaChona vendor network, 3 outreach templates, pitch deck, onboarding playbook, 6 months free in exchange for weekly feedback. Target: 3 signed by 2026-06-23

3 more chips spawned in same session (after recommendation request):
8. **YouTube tutorial series** — 10 videos (2-5 min each) covering signup→team→ingredients→scan→costing→prep→inventory→orders→Oracle. Loom + Descript. Demo tenant pre-seeded
9. **Operator management dashboard** — superseded by direct build this session. Chip can be dismissed
10. **Subtle in-app feedback** — superseded by 2026-04-24 deploy. Chip can be dismissed

### Status
All chips queued (none auto-running). User clicks to spawn each in fresh worktree session. Recommendations: email-setup unlocks transactional emails chain; design-partners unblocks any product-feedback work; trademark independent.

## App File Map (Updated 2026-04-26)

| Path | Lines | Purpose |
|------|-------|---------|
| `firebase/public/index.html` | ~35k chars | Marketing landing page (Stop guessing your food cost…) |
| `firebase/public/app.html` | ~501k chars (~8838 lines) | Main SPA (kitchen ops). Routes: catch-all `**` |
| `firebase/public/admin.html` | ~26k chars | Owner billing console — `/billing` (canonical) + `/admin` (alias) |
| `firebase/public/super-admin.html` | 1921 lines | Operator dashboard — platform-wide |
| `firebase/public/signup.html` | ~96k chars | Public signup flow w/ Square card form |
| `firebase/public/terms.html` | ~11k chars | Terms of Service (16 sections) |
| `firebase/public/privacy.html` | ~12k chars | Privacy Policy (14 sections + PostHog disclosure §2.3/§5/§12a) |
| `firebase/public/posthog-init.js` | ~4.6k chars | PostHog snippet + roIdentify/roTrack/roPosthogReset globals |
| `firebase/public/sentry-init.js` | ? | Sentry browser SDK init (placeholder DSN — disabled until real DSN swapped) |
| `firebase/public/firebase-config.js` | 985 chars | `window.FIREBASE_CONFIG` + `window.CLOUD_FUNCTION_URL` |
| `firebase/functions/index.js` | 4851 lines | All CF: secureApi, signupTenant, adminBilling, superAdmin, squareWebhook, agents, 4 scheduled rollups, dailyTrialReminders |
| `firebase/functions/emails.js` | (TDZ-fixed) | Transactional email pipeline (Resend) — partially wired |
| `firebase/functions/invoices.js` | (TDZ-fixed) | Invoice helpers — db() lazy getter |
| `firebase/firestore.rules` | ~230 lines | Multi-tenant rules + 11 super-admin collections |
| `firebase/firestore.indexes.json` | 14+ composite indexes | Query support |
| `firebase/firebase.json` | rewrites + CSP | `/`, `/app`, `/billing`, `/admin`, `/signup`, `/terms`, `/privacy`, `/super-admin` |

## Testbed Sandbox — LIVE (2026-04-27)

Standalone in-memory testbed. **Zero impact on prod app** — separate folder, no git, no Firebase calls.

- **Location**: `/Users/mulefamily/Claude/Bistro-Steward-Testbed/` (sibling, not subdirectory)
- Original plan target was a worktree at `Bistro-Steward.backtest/`; user picked clean-folder approach instead → built from scratch in fresh dir, no `git` involvement
- **Browser**: `http://localhost:8766/app-snapshot/index-testbed.html?backtest=1` (preview config `testbed` in `/Users/mulefamily/Claude/.claude/launch.json`)
- **Pipeline**: `./run.sh` → fetch (cached) → build_dataset → build_mock_env → pytest → launch hint
- **See**: [bistro-steward-backtest.md](bistro-steward-backtest.md) for full details

### What's loaded
| Object | Count | Source |
|---|---|---|
| Ingredients | 1169 | TheMealDB 595 meals, deduped via canon_name |
| Recipes | 595 | TheMealDB API (free key "1") |
| Conversions | 1147 | per-ingredient `{storageUnit, recipeUnit, factor}` from USDA densities + family math |
| Menus | 40 | seeded across 10 menu cats (Starters 4, Mains 7, Sides 2, Desserts 1, Breakfast 2, Beverages 2, Seafood 5, Vegetarian 5, Specials 4, Pasta 8) |
| Inventory | 977 rows | 4 stock distributions (full / partial / zero / warehouse-only) across 14 areas (12 storage + 2 warehouse) |
| Preps | 8 | seeded for first prep recipes |
| Areas | 14 | matches LaChona-style storage layout incl. `isWarehouse:1` |

### Test results — 61/61 pass in 0.14s
- `tests/pipeline/test_parse_ing.py` — 19 tests (canonicalize + parse + dedupe)
- `tests/pipeline/test_conversions.py` — 32 tests (volume/mass/density/cross-family + Oracle round-trips)
- `tests/pipeline/test_shopping.py` — 10 tests (9 invariants + full-corpus smoke). Smoke = 192-item shopping list against 1169×595×40 envelope; every item asserted to have qty>0, valid unit, sources, ceil-to-0.1

### Browser parity proven
Python `calculate_shopping_list()` (port of Oracle `index.html:4142-4380`) matches browser byte-for-byte on the full envelope:
- 192 items both sides
- Sample (browser ↔ Python): Romano Pepper 3.4 ea, Lamb Mince 2390 g, Pul Biber 3 tbsp, **Sunflower Oil 62 tbsp recipe → 1 L storage**, **Olive Oil 989 tbsp → 14.7 L**, Garlic 244.5 clove, Ginger 29 tsp, Carrot 4995 g

### Key files

| File | Purpose |
|---|---|
| `pipeline/units.py` | Canonical unit map matching Oracle `getDefaultUnits()`. Single-letter `T`/`t` aliases removed (case-insensitive lookup made them ambiguous) |
| `pipeline/parse_ing.py` | `parse(measure, name)` → `(qty, unit_abbr, name)`. Handles ints/decimals/mixed/fractions/unicode/ranges/parentheticals/size+prep modifiers. Dual-unit splitter (`"175g/6oz"` → trust left half, but only when slash side has letters — preserves `"3/4"` fractions) |
| `pipeline/conversions.py` | `build_conversion(ingId, name)` → Oracle-shape record. `default_pairing()` picks storage+recipe unit from keyword class. `cross_unit_factor()` routes via volume/mass family or density |
| `pipeline/build_dataset.py` | Reads `data/raw/mealdb.jsonl`, emits `data/derived/{ingredients,recipes,conversions}.json` |
| `pipeline/build_mock_env.py` | Assembles full D-envelope. Seeded `random(42, 99, 7)` for repeatability. Writes `data/derived/testbed-import.json` |
| `pipeline/shopping_model.py` | Pure-Python port of Oracle's `calculate_shopping_list()` for test-without-browser. Mirrors UNIT_CONVERSIONS (2482-2504), convert_to_recipe_units/convert_to_storage_units (4118-4140), calc_recipe_output (2506-2570), expand_recipe_ingredients (4072-4104), calculate_shopping_list (4142-4380) |
| `app-snapshot/index-testbed.html` | Copy of live `app.html` with bootstrap injected at `DOMContentLoaded`. `?backtest=1` flag → fetch envelope, populate `D`, fake owner user (`testbed@local`, `role:'owner'`) so FOH cocktail-only filter doesn't hide 595 recipes, skip Firebase init entirely |
| `run.sh` | End-to-end runner. Idempotent. Skips fetch if `mealdb.jsonl` present |

### Bugs caught + fixed during testbed dev (proves harness works)
1. **`canonicalize("T") → "tsp"`** instead of `"tbsp"` — `_strip_punct()` lowercases first. Fix: removed both single-letter `t`/`T` aliases
2. **`"Ml 12fl Milk"` ingredient names** — TheMealDB dual-unit measures like `"350ml/12fl"` parsed qty=350, unit failed, rest folded into name. Fix: `parse_ing.py` splits measure on `/` only when left side contains letters
3. **Identity conversions (flour: 1 cup = 1.000 cup)** — `defUnit` was picked as most-used recipe unit, not storage unit. Fix: use `default_pairing()` for `defUnit`
4. **FOH filter hid all 595 recipes in browser** — no auth context made `getCurrentSubRole()` default to `'foh'` → "Showing Cocktail recipes only" banner. Fix: testbed bootstrap injects fake owner into `D.users` + `currentAuthUser`

## DNS / Domain Hosts (verified 2026-05-01 via `dig NS`)

| Domain | Host | NS records |
|---|---|---|
| `bistrosteward.com` | **Cloudflare** | `christian.ns.cloudflare.com`, `maisie.ns.cloudflare.com` |
| `bistrosteward.com` | **GoDaddy** | `ns01.domaincontrol.com`, `ns02.domaincontrol.com` |

**For SendGrid Inbound Parse setup**: edit `bistrosteward.com` zone in Cloudflare (`dash.cloudflare.com` → `bistrosteward.com` → DNS → Records). Add MX record: name `invoices`, target `mx.sendgrid.net`, priority 10, proxy OFF (grey cloud).

**For Resend domain verification**: edit `bistrosteward.com` zone in GoDaddy (`dcc.godaddy.com/manage/BISTROSTEWARD.COM/dns`). Add 3 records from Resend dashboard: 1 MX + 2 TXT (SPF + DKIM).

## UPC Scanner — Progress Log (2026-05-27 → 2026-05-28)

### Status
- **Live**: `v13-2026-05-28-force-polyfill-ios` deployed to Firebase Hosting (restaurant-oracle.web.app). **Decode confirmed working on LaChona iPhone PWA.** ✅
- **Feature flag**: `feature_flags/upcScanner` `{ defaultValue:false, enabledTenants:['lachona'] }` — LaChona only.
- **Root cause (finally pinned down)**: iOS Safari ships a stub `BarcodeDetector` where `getSupportedFormats()` returns a non-empty formats list (the v12 probe trusted it) but `detect()` throws `DOMException: "Barcode detection service unavailable"`. v12's 3-fail auto-fallback fired but pure-JS ZXing also missed every code (the v6 "missed every barcode" result), so the scanner sat alive but never decoded.
- **The fix that worked**: skip the native probe entirely on iOS / iPadOS and force-install the WASM polyfill (`barcode-detector@2` → `zxing-wasm`) instead. Android Chrome's native `BarcodeDetector` is genuine and stays on the probe path. UA check: `/iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1)`.

### Phase 1 — backend (shipped, no regression)
- `upcLookup` Cloud Function (`firebase/functions/index.js`): Open Food Facts free path + cache via `upc_cache` collection + optional eandata paid fallback (inert until `UPC_PAID_API_KEY` secret + `runWith.secrets` entry added).
- `upcUsage` daily counter doc per tenant for paid-cap (1000/day default).
- Firestore rules added for `upc_cache` (read auth, write Admin) + `upcUsage` (server-only).
- `_test_upc_lookup.js` test suite passes (12/12 in `_test_all.js`).
- Cost rollup column "UPC paid" added to operator super-admin dashboard.

### Phase 2 — frontend (LaChona toolbar button, current state)
- `_UPC` state object in `app.html` ~10151: `{area, items, stream, reader, det, iv, scanning, last, lastT, manual, _unit, zoomCap, zoomCur, torchCap, torchOn, _bdpDone, det_fails, det_busy, det_frames}`.
- Scan modal: video preview + zoom +/- + torch toggle (capability-gated via `track.getCapabilities()`).
- New-ingredient form (when scan UPC not in DB): name + category + **inventory area** + **sub-area datalist** + **qty + unit** — writes ing + creates inventory row in one shot. (Added per user request 2026-05-27.)
- Per-item `areaId` + `subArea` stored on `_UPC.items[]` so multi-area scan run commits to correct locations; `_upcFinish` accumulates `touchedAreas` for `lastInventory` stamping.
- Photo-capture path **removed** in v11 — user requirement: "i do not want to use photos or take photos. i want instant recognition."

### Decode engine evolution — every fix attempt

#### v6 (initial Phase 2 ship) — pure-JS ZXing only
- Engine: `@zxing/browser` `BrowserMultiFormatReader.decodeFromVideoElement(video, cb)`.
- Hints: `TRY_HARDER=true`, `POSSIBLE_FORMATS=[EAN_13, EAN_8, UPC_A, UPC_E, CODE_128]`.
- Camera: `getUserMedia({ video: { facingMode: 'environment' } })` (no size hint).
- UI: scan area selector → camera preview → on-detect dispatches to lookup → portion screen / new-ing form → Done.
- Result: technically functional in Chrome desktop test. On iOS Safari PWA: missed every barcode in user-side test ("does not recognize barcode still").

#### v7 (2026-05-27) — camera tune + native BarcodeDetector path
- Bumped resolution: `width:{ideal:1920}, height:{ideal:1080}`.
- `track.getCapabilities()` introspection added — probed `focusMode`, `whiteBalanceMode`, `zoom`, `torch`.
- `applyConstraints({ advanced: [{ focusMode:'continuous' }, { whiteBalanceMode:'continuous' }] })` — iOS silently rejects `focusMode`, applies `whiteBalanceMode` only.
- Native `'BarcodeDetector' in window` branch added with 80 ms `setInterval` poll calling `det.detect(video)`.
- Debug pane added inside scan modal (`_upcDbg(msg)` → appends to `<pre id=upc-dbg>`), surfacing: native flag, secureCtx flag, applied constraints, camera dims, frame counter heartbeat, detect errors.
- Result (proven from user screenshot): debug pane reported `BarcodeDetector: no | secureCtx: true`, only `whiteBalanceMode` applied. Preview blurry — foreground was inside iOS minimum focus distance, AF locked on red car background. No code captured.

#### v7.5 — UX fixes alongside scanner
- Toast z-index lifted above scan modal (task #8).
- UPC-A 11-digit codes auto-padded to 12 (leading-zero recovery for hand-typed shorts).
- ZXing heartbeat log every 40 frames so silent-fail vs. busy-loop is distinguishable in debug pane.

#### v8 — inventory location + qty in new-ing scan form
- User request verbatim: "ensure inventory location assignment, quantity are alllowed as part of scanning a new ingredient".
- `_upcCreateNewIngForm`: added Inventory-location row (area `<select>` + sub-area `<input list>` with `<datalist>` of existing subAreas for the chosen area) and Quantity row (numeric + unit `<select>` defaulting to area's typical or `_UPC._unit`).
- `_upcSubAreasForArea(areaId)`: dedupes subAreas from `D.inv` rows in that area.
- `_upcRenderSubAreaList()`: re-renders datalist when area `<select>` changes.
- `_upcCreateNewIngSubmit`: reads name/area/sub/qty/unit/cat, dupe-guards by canonical name, creates ing via `secureApi('save')`, then `_upcQueueScan(ing, qty, unit, areaId, subArea)` — bypasses portion screen since qty already entered.
- `_UPC.items[]` schema extended: `{ ingId, qty, unit, areaId, subArea }`.
- `_upcCommit` writes per-item `areaId+subArea`; `_upcFinish` accumulates `touchedAreas` for `lastInventory` stamping (was previously single sessionArea).

#### v9 — still-photo capture path (rejected by user)
- Added `<input type=file accept=image/* capture=environment id=upc-file>` to scan modal. Tap → iOS native camera UI → photo → `_upcDecodeFile(file)` → FileReader → `decodeFromImageUrl(dataURL)` via ZXing.
- `_upcPhotoMiss(msg)` toast on decode failure.
- Rationale at the time: 12MP frame has more pixels for ZXing to find symbology than a 640×480 video frame.
- User verdict verbatim: **"message decoding photo for 30s, not acceptable. needs to be near instant. replace the engine used to recognize UPC code."** Pure-JS ZXing on a 12MP iPhone photo blocks the main thread that long. Path abandoned.

#### v10 (2026-05-27) — WASM engine swap (`barcode-detector@2` polyfill wrapping `zxing-wasm`)
- User constraint verbatim: **"i do not want to use photos or take photos. i want instant recognition."**
- Picked `barcode-detector@2` (npm pkg by Sec-ant, wraps `zxing-wasm`) because it exposes the same `BarcodeDetector` Web API surface — drop-in polyfill.
- Loader `_upcLoadBarcodeDetectorPolyfill(cb)` v10 logic: if `'BarcodeDetector' in window` then skip polyfill (trust native), else dynamic-import.
- Polyfill installer `_upcInstallPolyfill(cb)`:
  ```js
  import('https://cdn.jsdelivr.net/npm/barcode-detector@2/dist/es/pure.min.js')
    .then(mod => {
      const Ctor = mod.BarcodeDetector || mod.default;
      window.BarcodeDetector = Ctor;
      return Ctor.getSupportedFormats(); // warm WASM so first detect() isn't slow
    })
    .then(fmts => _upcDbg('WASM polyfill ready: ' + fmts.length + ' formats'))
    .catch(e => _upcDbg('polyfill load failed: ' + e.message));
  ```
- `_upcStartDecode` reused — `new window.BarcodeDetector({formats:[…]})` then `setInterval(()=>det.detect(video).then(…), 80)`.
- `det_busy` mutex added — skip enqueueing next detect if previous Promise still pending (WASM async — naive interval queues calls under load).
- `video.videoWidth===0` guard with logged heartbeat every 10 polls so "waiting on stream" is distinguishable from "scanning".
- **CSP changes** (`firebase/firebase.json`):
  - `script-src`: added `'wasm-unsafe-eval'` (required for WebAssembly compile in Chrome 91+, Safari 16.4+).
  - `script-src`: confirmed `https://cdn.jsdelivr.net` already allowlisted (used for SheetJS).
  - `connect-src`: confirmed `https://cdn.jsdelivr.net` already allowlisted (WASM fetch follows JS).
- Result: user reported **"it all looks the same, same message sitting there, still see photo button"** — proof PWA was running stale v9 cache. iOS Home Screen PWAs require force-quit + reinstall to pick up new SW VERSION when backgrounded.
- Force-reload instructions delivered (3 options, recommended: delete Website Data + reinstall via Share → Add to Home Screen).

#### v11 (2026-05-27) — strip all photo UI per user instruction
- Removed: `<input id=upc-file>`, "Photo" button in `_upcDefaultPanel`, `_upcTakePhoto`, `_upcDecodeFile`, `_upcPhotoMiss` functions.
- `_upcDefaultPanel` simplified to: status text + capture count + (if capabilities exist) Zoom −/+ + Torch toggle + Type-barcode + Done.
- Zoom controls: `_upcZoom(dir)` → `applyConstraints({ advanced: [{ zoom: clamp(cur + dir*step) }] })`, updates `_UPC.zoomCur` and DOM span.
- Torch: `_upcToggleTorch()` → `applyConstraints({ advanced: [{ torch: !_UPC.torchOn }] })`.
- Result: user reported **"barcode detection service unavailable"** — iOS Safari ships a *stub* `window.BarcodeDetector` (it exists in the global, ctor succeeds, `getSupportedFormats()` returns formats list, but `detect()` throws DOMException with that exact message). v11 loader saw native present → skipped polyfill → native stub threw.

#### v12 (2026-05-27, current) — stub bypass + auto-fallback
- `_upcLoadBarcodeDetectorPolyfill` rewritten to *probe* native rather than trust the presence flag:
  ```js
  if ('BarcodeDetector' in window) {
    var probe = window.BarcodeDetector.getSupportedFormats(); // returns Promise per spec
    probe.then(formats => {
      if (formats && formats.length) { _upcDbg('native OK: '+formats.length+' formats'); done(); }
      else { _upcDbg('stub (0 formats) — installing WASM polyfill'); _upcInstallPolyfill(done); }
    }).catch(e => { _upcDbg('probe threw: '+e.message+' — installing polyfill'); _upcInstallPolyfill(done); });
    return;
  }
  _upcInstallPolyfill(done);
  ```
- `_upcStartDecode` got fail counter:
  ```js
  _UPC.det_fails = 0;
  // inside .catch():
  _UPC.det_fails++;
  if (_UPC.det_fails === 3) {
    clearInterval(_UPC.iv);
    _UPC.det = null;
    _upcStartZxing(video); // pure-JS fallback
  }
  ```
- `_upcStartZxing(video)` extracted from previously-inline ZXing branch in `_upcStartDecode` so it's reachable both ways (no native + fallback).
- Verified deploy live via curl: `VERSION = 'v12-2026-05-27-wasm-stub-bypass'`, `getSupportedFormats` appears 7x, `_upcInstallPolyfill` 4x, "BarcodeDetector unusable" string 1x, `function _upcStartZxing` 1x.
- User reported same error persists after v12 deploy + redeploy 2026-05-28. **Hypothesis (UNPROVEN — needs debug-pane log)**: on this iOS version, `getSupportedFormats()` returns a non-empty array (stub looks legit) so probe passes, but `detect()` still throws — relying on 3-fail fallback path. Cannot confirm without `_upcDbg` output from phone.

#### v13 (2026-05-28) — force WASM polyfill on iOS — ✅ WORKING
- Hypothesis from v12 was correct: iOS Safari's stub `BarcodeDetector` passes `getSupportedFormats()` (returns `qr_code`, `aztec`, etc.) so v12's probe trusted it, but `detect()` throws every call. The v12 3-fail counter did fall back to pure-JS ZXing, which is too slow on iPhone to keep up (~matches the v6 "missed every barcode" result). WASM (`zxing-wasm` via `barcode-detector@2`) processes many times more frames per second on the same hardware.
- `_upcLoadBarcodeDetectorPolyfill` (`app.html` ~10240) gained an iOS/iPadOS UA short-circuit before the existing native probe:
  ```js
  var ua=navigator.userAgent||'';
  var isIOS=/iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && (navigator.maxTouchPoints||0)>1);
  if(isIOS){
      _upcDbg('iOS detected — bypassing native BarcodeDetector, installing WASM polyfill');
      _upcInstallPolyfill(done);
      return;
  }
  ```
- Added `var UPC_SCANNER_VERSION='v13-2026-05-28-force-polyfill-ios';` at the top of the scanner module (`app.html` ~10102) so live builds are identifiable via `curl … | grep UPC_SCANNER_VERSION` and the value is logged into the in-modal `_upcDbg` strip on every scanner open.
- Deploy: `cd firebase && ./deploy.sh hosting` (hosting-only — no rules/functions changes). PWA force-reload on iPhone via Settings → Safari → Advanced → Website Data → delete `restaurant-oracle` → Share → Add to Home Screen.
- Verified live: debug strip shows `iOS detected — bypassing native BarcodeDetector` → `WASM polyfill ctor installed in <N>ms` → `WASM polyfill ready: <N> formats` → `BarcodeDetector instantiated; polling 80ms` → `detected: <code>`. Real packaged-goods barcodes decode.
- Android / desktop unaffected — UA gate only short-circuits on iOS. Android Chrome continues using native `BarcodeDetector`; desktop probe path unchanged.

### Key code locations (app.html, current tree)
| Function | Line | Purpose |
|---|---|---|
| `_UPC = {…}` init | ~10151 | Per-session scan state |
| getUserMedia success | ~10202 | Capture zoom/torch caps, load polyfill, then `_upcStartDecode` |
| `_upcLoadBarcodeDetectorPolyfill` | ~10228 | Native probe via `getSupportedFormats()`, fallback to WASM |
| `_upcInstallPolyfill` | ~10259 | Dynamic ESM import of `barcode-detector@2`, replace `window.BarcodeDetector`, warm WASM |
| `_upcStartDecode` | ~10288 | `BarcodeDetector` poll every 80ms, 3-fail auto-fallback |
| `_upcStartZxing(video)` | ~10329 | ZXing pure-JS `BrowserMultiFormatReader` fallback |
| `_upcDefaultPanel` | (search) | Zoom +/-, torch button, Type-barcode + Done buttons — no photo button |
| `_upcCreateNewIngForm` / `_upcCreateNewIngSubmit` | (search) | Inline ing+inv create form on cache miss |
| `_upcSubAreasForArea` / `_upcRenderSubAreaList` | (search) | Datalist refresh on area change |
| `_upcQueueScan(ing, qty, unit, areaId, subArea)` | (search) | Bypass portion screen when qty already entered |
| `_upcCommit` / `_upcFinish` | (search) | Per-item area+subArea commit, `touchedAreas` for `lastInventory` |

### CSP / config changes
- `firebase/firebase.json` → `script-src` includes `'wasm-unsafe-eval'` + `https://cdn.jsdelivr.net` for ESM import of polyfill. `connect-src` already covers jsdelivr.

### What's NOT been tried (rejected paths)
- **Bluetooth scanners** — user rejected ("no bluetoogth bullshit").
- **Hardware HID-keyboard scanners (BT or wired)** — user rejected.
- **Strich commercial SDK** — not attempted; tabled.
- **`@undecaf/zbar-wasm`** — alt WASM engine, not attempted yet.

### Resolved (2026-05-28)
The three v12 diagnostic branches are moot — v13 doesn't trust the iOS native probe at all and force-installs the WASM polyfill, which made the scanner work without needing to know precisely which of the three was firing. (Branch #1 — "probe passed → trusted iOS stub → stub threw at `detect()`" — was the operative one, confirmed by the working build's `_upcDbg` strip.) Native iOS `BarcodeDetector` is presumed unusable until Apple ships a real implementation; until then, every iOS device gets the WASM polyfill on first scan.

### Next steps (post-v13)
- **Document the iOS UA gate in `_upcLoadBarcodeDetectorPolyfill`** — future readers should understand why iOS short-circuits the probe (the v13 comment already explains it inline).
- **Watch the polyfill load latency** in production — `_upcDbg` reports `WASM polyfill ctor installed in <N>ms`. If real-world iPhone load times start exceeding ~2s, consider self-hosting `barcode-detector@2/dist/es/pure.min.js` under `firebase/public/` to remove the jsdelivr round-trip.
- **Optional WASM alternative if scan accuracy drops** in production: `@undecaf/zbar-wasm` is a different engine (zbar, not zxing) known to be strong on 1D codes — keep in mind as a swap target, no work needed today.

### Sticky operational issues
- **iOS Home Screen PWA cache**: requires Settings → Safari → Advanced → Website Data → "restaurant-oracle.web.app" → delete + reinstall via Share → Add to Home Screen. SW VERSION bumps alone insufficient when PWA is backgrounded.
- **`./deploy.sh hosting`** restores `%GIT_SHA%` placeholders after upload — confirmed clean in 2026-05-28 redeploy.

### Untouched UPC-Deploy.md follow-up
Step 6 — Square "Recent charges" amount-format smoke test in super-admin → Billing tab — never validated. Out of scope for scanner work.

**For platform email** (`support@`, `noreply@`): use Cloudflare Email Routing on `.app` (free, forwarding only) OR GoDaddy on `.com` (existing MX would conflict with Resend; pick one). Recommendation: Cloudflare Email Routing on `.app` for inbound forwarding, Resend on `.com` for outbound transactional.
