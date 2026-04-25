# Restaurant Oracle — Quality Audit & Fixes (Feb 2026)

Comprehensive evaluation against the FullStack-Agent reference framework (Steps 1-11).
All fixes applied to `index.html` and copied to `firebase/public/index.html`.

---

## 2026-04-25 — Operator Console gap-fill + live deploy

Closed five outstanding gaps in the existing super-admin / operator dashboard
and shipped the whole thing to `restaurantoracle.app` for the first time.

- **Per-tenant Gemini cost tracking** (`functions/index.js`). Added
  `logGeminiUsage` helper; wrapped both Gemini call sites (voice and inventory
  scan) so every call writes a doc to `tenants/{id}/geminiUsage` with input /
  output / total tokens and latency. The pre-existing
  `dailyTenantCostAggregation` rollup now reflects real Gemini cost instead of
  always-zero. Failed calls also log so error rate is observable.
- **Impersonation flow fixed end to end**:
  - Backend: `superOpImpersonateTenant` returns `customToken` (was `token`,
    silently broken in the frontend), adds `readOnly: true` and
    `impersonationExpiresAt` claims, drops session lifetime to 30 min per spec.
  - `secureApi` request gate now rejects writes when
    `impersonating === true && readOnly === true` and rejects any request after
    `impersonationExpiresAt`. Both paths land in `audit_log`.
  - `app.html`: redemption handler scrubs token + tenant + expiresAt from URL,
    stashes expiry in sessionStorage. Banner now shows tenant slug, operator
    email, READ-ONLY chip, and a live `mm:ss left` countdown. Auto-signs out
    and redirects to `/super-admin` at expiry.
  - `super-admin.html`: confirm-modal text mentions read-only + 30-min cap,
    and the link includes `expiresAt` for the banner countdown.
- **Feedback widget** verified end to end. Already wired to `secureApi.submitFeedback`
  with positive/negative thumbs + comment + per-feature attribution. Added a
  CSS rule that hides the widget while impersonating so operators don't pollute
  the tenant's feedback stream.
- **Firestore rules**: explicit allow-read-deny-write rule for
  `tenants/{id}/geminiUsage` (the new subcollection written by the helper).
- **Deploy fix**: `invoices.js` was calling `admin.firestore()` at module-load
  time, which failed because `admin.initializeApp()` runs in `index.js`. Moved
  to a deferred `db()` getter, mirroring `agents.js`. This unblocked the deploy.
- **Secret Manager**: created placeholder `SENTRY_DSN` and `RESEND_API_KEY`
  secrets so the deploy validates. Replace with real values when Sentry +
  Resend are wired (code degrades gracefully with empty values).

Deploy: `firestore:rules`, `functions`, `hosting`. 16 functions deployed (3 new:
`inboundInvoice`, `dailyTrialReminders`, `runTrialRemindersNow`,
`sendTestEmail`). Plan: `docs/plans/2026-04-24-operator-console-gap-fill.md`.

---

## Audit Grades (Steps 1-11)

| Step | Topic | Grade | Summary |
|------|-------|-------|---------|
| 1 | Architecture (Plan → Build → Test) | C- | No design doc, no tests, correct build order |
| 2 | Planning Principles | D | No type contracts, no data flow docs, implicit schemas only |
| 3 | Separation of Concerns | D+ | Backend properly separated; frontend is one 7,178-line file |
| 4 | Development-Oriented Testing | F | Zero tests of any kind — no unit, integration, or E2E |
| 5 | Debugging Practices | C | Console logging exists; no behavioral monitoring, weak error localization |
| 6 | Learning from Codebases | N/A | Migrated Supabase → Firebase (iterative improvement) |
| 7 | Comprehensive Evaluation | D | Untested across all layers; XSS, orphaned data, bypassable rate limiting |
| 8 | Key Metrics | — | 16 issues ranked by severity (see below) |
| 9 | Anti-Patterns | — | "Looks Right" syndrome, fire-and-forget async, local-first mutation |
| 10 | Full-Stack Workflow | — | Planning: not done. Build: partial. Evaluate: not done. Learn: partial |
| 11 | Technology-Agnostic Checklist | — | 7/22 items passing |

---

## Issues Found (Ranked by Severity)

| # | Issue | Severity | Impact |
|---|-------|----------|--------|
| 1 | No loading indicator during data fetch — app appears frozen | CRITICAL | Every user, every session |
| 2 | Race condition: UI interactive before data loads | CRITICAL | Data loss on slow connections |
| 3 | No double-click prevention on save buttons — duplicates created | HIGH | Common user behavior |
| 4 | Silent API failures — user unaware operations failed | HIGH | Data inconsistency |
| 5 | Fire-and-forget deletes — no error handling on delete API calls | HIGH | Permanent data loss |
| 6 | Local delete before cloud confirmation — network failure = data loss | HIGH | Offline/flaky network |
| 7 | Division by zero in unit conversions (`convertToStorageUnits`) | HIGH | Corrupted shopping list |
| 8 | XSS vulnerabilities — unescaped `ingName` in innerHTML and onclick | HIGH | Security exploit |
| 9 | No referential integrity on cascading deletes | MEDIUM | Orphaned data over time |
| 10 | Offline reconnect overwrites cloud data (push without pull) | MEDIUM | Multi-user data loss |
| 11 | `syncQueue` created but never retried | MEDIUM | Failed syncs silently dropped |
| 12 | No optimistic locking — last write wins | MEDIUM | Multi-user conflicts |
| 13 | `syncNow()` race condition — multiple triggers can fire simultaneously | MEDIUM | Duplicate API calls |
| 14 | Recursive `loadFromFirebase()` on empty DB | LOW | Stack overflow risk (first-time only) |
| 15 | Bootstrap race condition — two first users both become owner | LOW | First-time setup only |
| 16 | `getUserRole()` does 3 Firestore reads per request | LOW | Billing impact at scale |

---

## Fixes Applied

### Tier 1 — Critical UX & Data Safety

#### 1. Loading Overlay (blocks interaction during data fetch)
- **Problem:** Users could click buttons and navigate tabs while `loadFromFirebase()` was still running, causing edits on empty/incomplete state.
- **Fix:** Added CSS loading overlay (`loading-overlay` class) with spinner that covers the entire screen during data load. Wrapped in `try/finally` so it always hides even on error.
- **Files:** `index.html` — new CSS (`.loading-overlay`, `.loading-spinner`, `.loading-text`), new HTML element, `showLoading()`/`hideLoading()` functions, wrapper in `onAuthStateChange()`.

#### 2. Double-Click Prevention (all action buttons)
- **Problem:** Rapidly clicking "Add", "Save", "Transfer", etc. could fire the handler twice, creating duplicate items.
- **Fix:** Global capture-phase click listener intercepts clicks within 600ms on `.btn-p`, `.btn-d`, `.login-btn`, `.google-btn`. Calls `stopImmediatePropagation()` and `preventDefault()` on the second click.
- **Files:** `index.html` — IIFE event listener added after variable declarations.

#### 3. Fire-and-Forget Deletes Fixed
- **Problem:** `deleteIngredient()` called `secureApi('delete', ...).then(console.log)` with no `.catch()`. If the API failed, the user was never notified and cloud/local data diverged permanently.
- **Fix:** Both `deleteIngredient()` and `deleteRecipe()` now use `async/await` with `try/catch`. Errors show a toast notification. On failure, local data is NOT deleted.
- **Files:** `index.html` — rewrote both `deleteIngredient()` and `deleteRecipe()` functions.

#### 4. Promise.all → Promise.allSettled (data loading)
- **Problem:** 11 parallel `secureApi('select', ...)` calls wrapped in `Promise.all()`. If ANY one failed (e.g., network hiccup on `log` table), ALL data was lost and the catch block ran with zero data loaded.
- **Fix:** Replaced with `Promise.allSettled()`. Each failed table falls back to `{data: []}`. A warning toast lists which tables failed so the user knows some data may be missing.
- **Files:** `index.html` — `loadFromFirebase()` main data fetch block.

#### 5. Division-by-Zero Guard (unit conversions)
- **Problem:** `convertToStorageUnits()` did `qty / conv.factor` with no check that `factor > 0`. A conversion with `factor=0` produced `Infinity`, corrupting the shopping list.
- **Fix:** Added guard: `if(!conv.factor || conv.factor <= 0) return {qty: qty, unit: fromUnit};`
- **Files:** `index.html` — `convertToStorageUnits()` function.

---

### Tier 2 — Security & Data Integrity

#### 6. XSS Vulnerabilities Fixed
- **Problem:** Two functions (`selectRecIng`, `selectMenuIng`) set `.innerHTML` with raw `ingName` parameter — no escaping. Additionally, 6 onclick attributes used `ing.name.replace(/'/g,"\\'")`  which only escaped single quotes, not HTML entities like `<`, `>`, `"`. Two inventory dropdown items also displayed `ing.name` without `escHtml()`.
- **Fix:**
  - `selectRecIng()` and `selectMenuIng()`: `ingName` → `escHtml(ingName)` in innerHTML.
  - All 6 onclick attribute injections: `ing.name.replace(...)` → `escHtml(ing.name).replace(...)`.
  - Inventory dropdown display text: `ing.name` → `escHtml(ing.name)`.
- **Files:** `index.html` — lines in `selectRecIng()`, `selectMenuIng()`, `searchRecIngs()`, `searchMenuIngs()`, and inventory rendering.

#### 7. Cascade Delete for Ingredients
- **Problem:** Deleting an ingredient cleaned up `D.inv`, `D.shopping`, `D.recs[].ings`, and `D.menus[].ings` — but did NOT clean up `D.conversions` (unit conversion entries). Orphaned conversions accumulated over time.
- **Fix:** Added `D.conversions` cleanup in `deleteIngredient()`, plus matching `secureApi('delete', 'conversions', ...)` cloud call.
- **Files:** `index.html` — `deleteIngredient()` function.

#### 8. Cascade Delete for Recipes
- **Problem:** Deleting a recipe cleaned up `D.menus[].recs` and `D.recs[].subRecs` — but did NOT clean up `D.preps` (prep items with `recId` pointing to the deleted recipe). Orphaned prep items accumulated.
- **Fix:** Added `D.preps` cleanup: `D.preps = D.preps.filter(function(p){return Number(p.recId) !== id;})`.
- **Files:** `index.html` — `deleteRecipe()` function.

#### 9. Cloud-Confirm Before Local Delete
- **Problem:** Both delete functions modified local state (`D.ings`, `D.recs`, etc.) BEFORE calling the cloud API. If the cloud call failed (network error, permission denied), local data was already gone. Next load from cloud would restore it, creating confusion; or if user was offline, data was permanently lost.
- **Fix:** Reversed the order — cloud API delete runs FIRST with `await`. Only on success does local state get modified. On failure, an error toast is shown and local data is preserved.
- **Files:** `index.html` — `deleteIngredient()` and `deleteRecipe()` rewritten with cloud-first pattern.

---

### Tier 3 — Sync & Multi-User Reliability

#### 10. Sync Mutex
- **Problem:** `syncNow()` could be called simultaneously from: auto-sync timer (every 30s), hourly sync, manual "Sync Now" button, and online event handler. Multiple concurrent syncs could send duplicate upserts or race on `changeLog` clearing.
- **Fix:** Added `isSyncing` boolean flag. `syncNow()` checks the flag and returns immediately if already syncing. Implementation extracted to `_syncNowImpl()` wrapped in `try/finally` to guarantee flag reset.
- **Files:** `index.html` — `syncNow()` split into guard + `_syncNowImpl()`.

#### 11. Pull Before Push on Reconnect
- **Problem:** When coming back online, the app immediately called `syncNow()` to push local changes — WITHOUT first pulling the latest cloud data. This overwrote any changes made by other users while this device was offline.
- **Fix:** `online` event handler now calls `loadFromFirebase()` first to get latest cloud data, then re-renders, THEN pushes local changes via `syncNow()`.
- **Files:** `index.html` — `window.addEventListener('online', ...)` handler rewritten as async.

#### 12. Reconnect & Offline Feedback
- **Problem:** When going offline or coming back online, there was no visible feedback beyond the small sync status badge. Users didn't know if their changes were safe.
- **Fix:** Toast notifications for both transitions: "Back online — syncing..." (success) and "You are offline. Changes saved locally." (warning).
- **Files:** `index.html` — online/offline event handlers.

#### 13. Error Toasts for All Sync Failures
- **Problem:** Sync failures used `alert()` which is blocking and jarring, or silently logged to console with no user feedback at all.
- **Fix:** All `alert('Sync failed: ...')` replaced with `showToast(msg, 'error')`. New toast notification system added: CSS-animated slide-in toasts that auto-dismiss after 4 seconds. Three variants: error (red), success (green), warning (yellow).
- **Files:** `index.html` — new CSS (`.toast-container`, `.toast`, animations), new HTML container, `showToast()` function. Applied in `syncNow()`, `_syncNowImpl()`, `queueFirebaseSave()`, `forceSync()`, `deleteIngredient()`, `deleteRecipe()`.

---

## Remaining Issues (Not Fixed — Future Work)

### Tier 4 — Testing & Documentation
- Add unit tests for shopping list calculation and unit conversion logic
- Add API integration tests for Cloud Functions permission matrix
- Document Firestore schema and API contracts
- Add E2E smoke tests for critical flows

### Tier 5 — Architecture Improvements
- Split monolithic `index.html` (7,300+ lines) into modular JS files
- Add optimistic locking (version field on Firestore documents) for multi-user edits
- Implement distributed rate limiting (Firestore-based instead of per-instance in-memory)
- Add service worker for true offline PWA support (currently no SW = no asset caching)
- Fix `syncQueue` to actually persist and retry failed operations (currently pushes but never pops)
- Fix recursive `loadFromFirebase()` call on empty DB (add max depth guard)
- Cache `getUserRole()` result to avoid 3 Firestore reads per API request

---

## Verification Checklist

After deploying:

- [ ] **Loading overlay:** Login and watch for spinner before app renders. On slow connection, verify you cannot click tabs during load.
- [ ] **Double-click:** Rapidly click any "Add" or "Save" button in a modal. Verify only one item is created.
- [ ] **Delete error handling:** Disconnect network, then try to delete an ingredient. Verify error toast appears and ingredient is NOT removed from the list.
- [ ] **Partial load:** If one API table fails, verify app still loads with a warning toast listing the failed table.
- [ ] **Division by zero:** Create a conversion with factor=0. Generate shopping list. Verify no Infinity/NaN in quantities.
- [ ] **XSS:** Create an ingredient named `<img src=x onerror=alert(1)>`. Select it in a recipe ingredient search. Verify no script execution — name should display as plain text.
- [ ] **Cascade delete:** Delete an ingredient that has a conversion entry. Verify conversion is also removed.
- [ ] **Sync mutex:** Click "Sync Now" rapidly 5 times. Verify console shows only one sync operation.
- [ ] **Reconnect pull:** Open app on two devices. Go offline on device A. Make changes on device B. Bring device A back online. Verify device A picks up device B's changes.
- [ ] **Toast notifications:** Trigger an offline state. Verify warning toast appears. Come back online. Verify success toast appears.

---

## iOS App Store Roadmap (Mar 2026)

### Overview
Native iOS app to replace PWA, targeting 10K → 100K → 1M users across three phases. Full plan in `PHASE1_10K.md` (10K detail) and `ROADMAP.md` (all phases).

### Phase 1: 0 → 10K Users (16 weeks)

**Part A — Build (Weeks 1-7)**

| Week | Focus | Deliverables |
|------|-------|-------------|
| 1 | Project scaffold | Xcode + SPM packages, 14 Codable models, API client, Firebase Auth, design system, AppState + sync |
| 2 | Inventory | List (area-grouped, collapsible, searchable), inline qty edit, add/edit/transfer, AI scan + print, unit tests 80% |
| 3 | Recipes & Ingredients | Ingredients CRUD + cascade delete, recipes with sub-recipes, prep items, unit tests 80% |
| 4 | Remaining tabs | Menu, shopping list (auto-generate), log, admin (team/areas/categories/conversions), voice assistant |
| 5 | Offline & polish | NWPathMonitor + offline queue (with retry), sync engine (pull-before-push, mutex), error handling, haptics, Dynamic Type, app icon, integration + snapshot tests |
| 6 | Security & subscriptions | Cert pinning, Keychain, jailbreak detection, PrivacyInfo.xcprivacy, legal docs, App Store Connect, StoreKit 2 (3 tiers: $29.99/$199.99/$49.99), server-side webhook |
| 7 | CI/CD & ship | GitHub Actions, Fastlane (match + deliver), Sentry + Firebase Analytics, performance (<400ms launch), TestFlight build |

**Part B — Beta & Submit (Weeks 8-9)**

| Week | Focus | Deliverables |
|------|-------|-------------|
| 8 | Beta testing | 15-25 external testers, triage + fix P0/P1 bugs, onboarding flow (<3 min activation), accessibility audit (VoiceOver, Dynamic Type, 4.5:1 contrast) |
| 9 | App Store | Pre-submission checklist (20 items), submit with phased release, respond to review (same-day fixes if rejected) |

**Part C — Launch & Grow (Weeks 10-16)**

| Week | Focus | Deliverables |
|------|-------|-------------|
| 10 | Launch | Release, Sentry monitoring, respond to all reviews <3hrs, analytics review, hotfix if needed, Week 1 metrics report |
| 11-12 | ASO & organic | Keyword optimization, 3 Custom Product Pages, Spanish metadata, screenshots A/B test, landing page + SEO blog posts, Reddit/Facebook community |
| 13-14 | Paid acquisition | Apple Search Ads ($600-1500/mo, target CPA <$15), restaurant supplier partnerships, POS ecosystem listings, direct outreach to 50 Portland restaurants |
| 15-16 | Iterate & scale | Push notifications (low stock, prep reminders, trial expiry), referral program (1 month free for both), build #1 requested feature, v1.1.0 update, increase paid spend if unit economics work |

### Architecture: iOS App

```
RestaurantOracle.xcodeproj
├── Packages/
│   ├── CoreNetworking/     — APIClient (POST to existing Cloud Function), token mgmt
│   ├── CoreDesignSystem/   — Dark theme (#1a1a2e), Inter font, toast, buttons, cards
│   ├── SharedModels/       — 14 Codable structs matching Firestore schema
│   ├── FeatureAuth/        — Firebase Auth + Sign in with Apple + Keychain
│   ├── FeatureInventory/   — List, edit, scan (Gemini Vision), print (PDF)
│   ├── FeatureRecipes/     — Recipes + Ingredients + Prep (with cascade deletes)
│   ├── FeatureMenu/        — Menu + Shopping (auto-generate from recipes)
│   └── FeatureAdmin/       — Team mgmt, areas, categories, log, settings, voice
```

- **Pattern**: Clean Architecture + MVVM per module
- **UI**: SwiftUI (iOS 17+), hybrid UIKit bridges where needed
- **State**: `AppState` (ObservableObject) mirroring `var D` from PWA
- **Sync**: cloud-first mutations, pull-before-push reconnect, mutex, offline queue with retry
- **Backend**: existing Firebase Cloud Functions (no backend changes in Phase 1)
- **AI**: existing Gemini 2.5 Flash endpoints (voice + scan) called from native

### Subscription Tiers

| Tier | Price | Limits |
|------|-------|--------|
| **Free** | $0 | 1 restaurant, 50 ingredients, 20 recipes |
| **Pro Monthly** | $29.99/mo | Unlimited, AI scan + print + voice |
| **Pro Annual** | $199.99/yr | Same as Pro (44% savings) |
| **Team Monthly** | $49.99/mo | Pro + multi-location + team features |

- 21-day free trial (guide: 17-32 days = 45.7% conversion)
- StoreKit 2 + App Store Server Notifications V2
- Server-side entitlement validation via Cloud Functions
- Small Business Program (15% commission until $1M)

### Budget (Phase 1 Total: 16 weeks)

| Item | Cost |
|------|------|
| Apple Developer Program | $99/yr |
| Firebase (Blaze) | $0-200 |
| Apple Search Ads | $2,400-6,000 |
| Domain + hosting | $12 |
| **Total** | **$2,511-6,311** |

### Revenue at 10K Users

| Metric | Target |
|--------|--------|
| Registered users | 10,000 |
| Paying subscribers | 200-400 (5-10% conversion) |
| ARPU | $30/mo |
| MRR | $6,000-12,000 |
| ARR | $72K-144K |

### 10K Exit Criteria

- [ ] Live on App Store, 4.5+ star rating
- [ ] Cold launch <2s on iPhone 12+
- [ ] 80%+ unit test coverage on business logic
- [ ] Crash-free rate >99.5%
- [ ] 10K registered users
- [ ] >200 paying subscribers
- [ ] Trial-to-paid conversion >4.8%
- [ ] Day-7 retention >15%

### Phase 2 → 100K (Weeks 17-28)
Redis caching, query optimization, distributed rate limiting, paywall A/B testing (50+/yr), pricing localization, multi-restaurant support, team collaboration, push notifications, smart ordering AI, food cost analytics.

### Phase 3 → 1M (Weeks 29-40)
Backend migration (Go + PostgreSQL + AWS), horizontal scaling, enterprise tier (SSO, integrations marketplace), iPad + Apple Watch, localization (5 languages), multi-region, analytics pipeline, ML features.

Full details: `ROADMAP.md` (all phases), `PHASE1_10K.md` (daily deliverables for 10K)

### Features Added (Mar 2026)

#### Inventory Scan & Print (2026-03-02)
- Photo scanning via Gemini Vision + printable count sheets
- `scan` operation in Cloud Function with multimodal Gemini API
- Base64 image approach (no Firebase Storage needed)
- MAX_SCAN_PAYLOAD_SIZE = 2MB for image payloads
- Print generates iframe with @media print CSS
- Review modal before applying scanned items
- Admin-only access (owner role gate)
- Preview step before printing (full-screen modal with iframe)
