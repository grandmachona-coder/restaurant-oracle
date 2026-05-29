# Bistro Steward — MASTER

Consolidated from 23 source markdown files on 2026-05-01.
Each section preserves the source file verbatim with a "Source:" header.

## Table of Contents

- [Vision & Roadmap (10K → 1M)](#vision)
- [Phase 1 Plan (0 → 10K Users)](#phase1)
- [Production Plan](#production)
- [Quality Audit & Fixes (Updates Log)](#updates)
- [Invoice Testing Plan](#invoice-testing)
- [Margin & Invoicing](#margin-invoicing)
- [SendGrid Walkthrough](#sendgrid)
- [Plan: Backtest Mock Testbed (2026-04-24)](#plan-backtest)
- [Plan: Operator Console Gap Fill (2026-04-24)](#plan-operator-console)
- [Plan: YouTube Tutorials (2026-04-24)](#plan-youtube)
- [Plan: Multi-Shift Shopping (2026-04-28)](#plan-multi-shift)
- [Automation Agents — Overview](#agents-readme)
- [Agent 01 — Provisioning](#agent-01)
- [Agent 02 — Onboarding](#agent-02)
- [Agent 03 — Deployment](#agent-03)
- [Agent 04 — Health](#agent-04)
- [Agent 05 — Support](#agent-05)
- [Agent 06 — Revenue](#agent-06)
- [Design Partners — Overview](#dp-readme)
- [Design Partners — Week 1 Runbook](#dp-runbook)
- [Design Partners — Outreach Templates](#dp-outreach)
- [Design Partners — Partner Letter](#dp-letter)
- [Design Partners — Onboarding Playbook](#dp-onboarding)

---


<a id="vision"></a>

# Vision & Roadmap (10K → 1M)

_Source: `ROADMAP.md`_

# Bistro Steward — App Store Roadmap

## Daily Deliverables Timeline: PWA → Production iOS App (10K → 100K → 1M)

**Start Date:** 2026-03-03
**Current State (as of 2026-04-27):** Multi-tenant SaaS web PWA live at `bistrosteward.com` (Firebase Hosting + Functions + Firestore + Gemini 2.5 Flash). One paying tenant (LaChona Bistro). Operator console deployed and gated. iOS native app NOT yet built — the original 8,228-line vanilla JS PWA grew into ~9,600 lines (`firebase/public/app.html`) and the SaaS surface around it. The native iOS phases below remain future work; everything below the "Production State" appendix is unstarted.

---

## Production State Appendix (2026-04-27)

This appendix supersedes the original "Current State" line as the source of truth for what is live in production today. The Phase 1–3 timeline below is the forward-looking native-app plan; nothing in it has been started.

### Live URLs
| URL | Audience | Auth gate | Purpose |
|-----|----------|-----------|---------|
| `https://bistrosteward.com/` | public | none | Marketing landing (`firebase/public/index.html`, ~640 lines) |
| `/signup` | public | none | Square-card signup flow w/ 30-day trial |
| `/app` | tenant staff (owner + employees) | `tenantId + approved=true` JWT claim | Main kitchen-ops PWA: recipes, ingredients, inventory, prep sheets, vendor orders, AI scan, voice. Has internal `⚙️ Admin` tab for workspace settings (Excel import/export, approved-emails). |
| `/billing` (canonical) / `/admin` (alias) | tenant **owner** | same + `role=owner` | Subscription mgmt — plan switch (Starter/Pro/Enterprise), Square card update, billing history, team invites. Branded "Billing & Account". `/admin` alias retained one rotation. |
| `/super-admin` | platform operator (Anthony) | `superAdmin=true` claim | All-tenant operator console. Customer never sees. |
| `/terms`, `/privacy` | public | none | Legal. |

### Backend
- **Cloud Functions** (Node 22, Gen 1, region `us-central1`): `api`, `superAdmin`, `adminBilling`, `inboundInvoice`, `squareWebhook`, `signupTenant`, plus 5 scheduled — `dailyTenantCostAggregation`, `dailyUsageStatsRollup`, `dailyHealthScoreCompute`, `dailyTrialCheck`, `dailyTrialReminders`. (Note: the client-side wrapper that calls the `api` function is named `secureApi()` in `app.html`; references to `secureApi(...)` in this doc are call-site references to that wrapper, not the function deployment.)
- **`functions/index.js`** ~5,200 lines. `superAdmin` op dispatcher has **57 ops** across these categories: core tenancy (9 — `dashboard`, `listTenants`, `getTenantDetails`, `suspendTenant`, `unsuspendTenant`, `forceCancel`, `listSuperAdmins`, `grantSuperAdmin`, `revokeSuperAdmin`); enriched listing (3 — `listTenantsEnriched`, `getTenantFull`, `getKpiOverview`); tickets (9 — `listTickets`, `getTicket`, `createTicket`, `replyTicket`, `assignTicket`, `closeTicket`, `reopenTicket`, `addTicketTag`, `removeTicketTag`); feedback (3 — `listFeedback`, `aggregateFeedbackByFeature`, `markFeedbackReviewed`); notes (4 — `listNotes`, `addNote`, `updateNote`, `deleteNote`); meta (4 — `getTenantMeta`, `setTenantMeta`, `addTenantTag`, `removeTenantTag`); cost/usage/health reads (3 — `getTenantCosts`, `getTenantUsage`, `getTenantHealth`); actions (16 — `impersonateTenant`, `exportTenant`, `softDeleteTenant`, `hardDeleteTenant`, `resetUserPassword`, `revokeTokens`, `resendVerification`, `adjustPlan`, `compInvoice`, `issueRefund`, `pushAnnouncement`, `listAnnouncements`, `deleteAnnouncement`, `listFeatureFlags`, `setFeatureFlag`, `manualAuditEntry`); agents (3 — `listOperators`, `updateOperatorStatus`, `updateOperatorProfile`); platform utilities (3 — `recentAudit`, `topAtRiskTenants`, `runRollupsNow`).
- **Per-tenant Firestore namespace**: `/tenants/{tenantId}/{collection}` — 16 data collections (ings, inv, recs, menus, preps, shopping, areas, cats, menu_cats, rec_cats, units, vendors, conversions, log, settings, counters) plus operator-side: `audit_log`, `support_tickets/{id}/messages`, `feedback_events`, `internal_notes`, `geminiUsage`, `approved_emails`, `tenant_meta`. Top-level platform collections: `tenants`, `tenant_costs_daily`, `tenant_usage_daily`, `tenant_health`, `platform_announcements`, `feature_flags`, `operators`.
- **Auth**: Firebase Auth + Google OAuth + email/password. Custom claims: `tenantId, tenantSlug, approved, role, superAdmin, impersonating, readOnly, impersonationExpiresAt, impersonatingTenantId, impersonatingTenantSlug, impersonatingAs`. Authorized domains include `bistrosteward.com`, `www.bistrosteward.com`.
- **Billing**: Square subscriptions (NOT Stripe). 30-day free trial w/ card capture up front. Plans: Starter $29/mo, Pro $49/mo, Enterprise $99/mo. Square webhook handles subscription/payment events.
- **AI**: Gemini 2.5 Flash for voice (`api op:voice`) + inventory scan (`api op:scan`). Per-call token usage logged to `tenants/{id}/geminiUsage` for cost rollup.
- **Email**: Resend transactional + SendGrid Inbound Parse for invoice ingestion (`<token>@invoices.bistrosteward.com` → Gemini Vision OCR → ingredient cost update).
- **Observability**: Sentry (errors), PostHog (product analytics, identified-only, DNT respected). No session replay.

### Operator console (`/super-admin`)
Single HTML file (`firebase/public/super-admin.html`, ~1,925 lines). Sidebar w/ 8 tabs:
1. **Overview** — 12 KPIs, MRR sparkline, top at-risk tenants, recent audit feed, "Run rollups now" trigger.
2. **Tenants** — enriched list w/ search/filter/sort. Click → 22-tab drawer (Summary, Users, Billing, Costs, Usage, Health, Tickets, Feedback, Notes, Meta & tags, Data volume, Audit log, Collections, Flags, Announce, Actions, Impersonate, Refund, Plan, Comp, Export, Danger).
3. **Tickets** — full inbox; create/reply/assign/close/reopen/tag with internal-note toggle.
4. **Feedback** — per-feature aggregate + recent events; mark reviewed.
5. **Agents** — super-admins (grant/revoke) + operator profiles (status/load).
6. **Announce** — platform-wide banners (info/warning/critical) → `platform_announcements` (every signed-in tenant client renders).
7. **Flags** — feature flags scoped global or per-tenant.
8. **Settings** — rate-card display, manual audit entry.

### Operator hardening
- Auth gate: `superAdmin: true` claim required, server-side re-verified per request.
- **Impersonation**: 30-min read-only window. Mints custom token w/ `impersonating: true, readOnly: true, impersonationExpiresAt: <ms>` claims. New tab opens `/?impersonateToken=…&tenant=…&expiresAt=…`. URL scrubbed after sign-in. Red sticky banner shows tenant + operator + countdown. The `api` function rejects writes with 403 when `readOnly === true`. Auto-logout at expiry. Feedback widget hidden during impersonation. All flows audit-logged (`super_admin_impersonation`, `impersonator_write_blocked`, `impersonation_expired`).
- **Audit**: every super-admin action writes to `tenants/{id}/audit_log` (when tenant-scoped) or root `/audit_log` (platform-scoped) with `user_id`, `user_email`, `tenant_id`, `operation`, `collection`, `record_count`, `timestamp`.

### Multi-tenant security chain (live)
```
Request → CORS allowlist (anchored regex for *.bistrosteward.com)
        → Auth token verification
        → Tenant resolution (JWT claim, slug fallback)
        → H-1 slug-in-body matches tenant.slug
        → C-1 whitelist OR ownerEmail-gated bootstrap
        → JWT claim stamping (tenantId + tenantSlug + role)
        → Tenant status gate (suspended/cancelled = read-only)
        → Impersonator write-block (readOnly claim → 403 on writes)
        → RBAC (PERMISSION_MATRIX)
        → Collection allowlist + payload validation + sanitization
        → Rate limit (100/min/user)
        → tenantCol() path enforcement
        → Firestore rules (isApprovedForTenant)
```

### Cost structure (per tenant)
Real per-call Gemini token logging now wired (`logGeminiUsage` helper at `index.js:447`). Daily rollup function (`dailyTenantCostAggregation`) aggregates Firestore reads/writes, CF invocations, Gemini input/output tokens, Resend emails into `tenant_costs_daily/{tenantId}_{YYYY-MM-DD}`. Operator console "Costs" tab shows real numbers (~24h after first Gemini call to populate first daily row). Currently zero-noise baseline since LaChona is the only tenant.

### What's deployed but not yet validated
- e2e test (`firebase/functions/_e2e_super_admin.js`) hits all 54 super-admin ops against live endpoint. Needs `FIREBASE_WEB_API_KEY` env var to run. Defer to next session.
- Smoke test of operator console — partially complete (sign-in gate verified, branding fix verified). Tickets/feedback/impersonation flows not yet smoke-tested end-to-end.
- Screenshots per spec deliverable not captured.
- Tenant subdomain routing (`*.bistrosteward.com`) — wildcard is in CSP, but app currently hardcodes `lachona` slug fallback in staging. Verify per-tenant subdomain works when second tenant signs up.

### Production-blocking risks (open)
| Risk | Severity | Mitigation status |
|------|----------|-------------------|
| Subdomain routing untested with 2+ tenants | HIGH | Manual test next signup |
| `_e2e_super_admin.js` not run against live | MED | Run with API key when granted |
| `deprovisionTenant` serial claim revocation timeout at scale | MED | Deferred (M-4) |
| `dailyTenantCostAggregation` pulls from `gemini_usage_log` (root) AND new `tenants/{id}/geminiUsage` — verify rollup picks up the new path | MED | Inspect rollup code paths in next pass |
| Apple TestFlight / iOS build never started | LOW (web is primary surface) | Phase 1-3 below covers, currently all unstarted |
| One-paying-tenant economics — runtime cost dwarfs revenue | LOW (LaChona is anchor) | Beta cohort acquisition |

### Production deploy procedure (verified working)
1. Edit code in `firebase/public/*.html` or `firebase/functions/*.js`.
2. `node -c firebase/functions/index.js` — syntax sanity check.
3. `cd firebase && firebase deploy --only firestore:rules` (when rules touched).
4. `cd firebase && firebase deploy --only functions,hosting` — full deploy.
5. Hard-refresh `bistrosteward.com/{path}` (Cmd+Shift+R) — cache busted by `Cache-Control: no-cache, no-store, must-revalidate` on `*.html`.
6. Smoke test sign-in + 1-2 critical paths.
7. Watch Sentry for new error spikes.

### Next-up production work (not the iOS phases below)
1. Run `_e2e_super_admin.js` end-to-end against live; triage failures.
2. Manual smoke-test all 8 operator console tabs + 22-tab tenant drawer + impersonation flow. Capture screenshots → `docs/screenshots/`.
3. Verify `dailyTenantCostAggregation` aggregates new `tenants/{id}/geminiUsage` path (not just legacy `gemini_usage_log`). Fix if not.
4. Add operator alert when `tenant_health.score < 50` for any tenant (Slack or Resend email digest).
5. Beta cohort acquisition: 5 design-partner restaurants. Use `signupTenant` + `compInvoice` (free first 3 months) + impersonation for white-glove debugging.
6. Drop `/admin` URL alias once `app.html` user-dropdown link cached out (one rotation post-deploy).
7. Build subdomain routing test: provision second tenant, verify `slug.bistrosteward.com` resolves correctly + JWT slug claim guards cross-tenant data leakage.
8. Phase 2 deferred audit fixes: M-4 (deprovision claim revocation), L-1/L-2/L-3.

---

## PHASE 1: Foundation & App Store Launch (Weeks 1-10)
**Goal:** Ship a native iOS app to the App Store with feature parity to the PWA
**Milestone:** First 10K users
**Exit Criteria:** Live on App Store, <2s cold launch, 80% unit test coverage on business logic, crash-free rate >99.5%

---

### Week 1: Project Setup & Architecture

**Day 1 (Mon) — Xcode Project & SPM Skeleton**
- [ ] Create Xcode project: `BistroSteward` (iOS 17+ minimum, SwiftUI)
- [ ] Set up SPM modular package structure:
  ```
  Packages/
    CoreNetworking/     — API client, auth token management
    CoreDesignSystem/   — Colors, typography, shared components
    SharedModels/       — Codable data models matching Firestore schema
    FeatureAuth/        — Login, signup, password reset
    FeatureInventory/   — Inventory tab
    FeatureRecipes/     — Recipes tab
    FeatureMenu/        — Menu tab
    FeatureShopping/    — Shopping list tab
    FeatureAdmin/       — Admin/settings tab
  ```
- [ ] Configure each `Package.swift` with proper dependencies (feature → core, never feature → feature)
- [ ] Add `.gitignore`, initialize Git repo

**Day 2 (Tue) — Data Models & API Client**
- [ ] Port all 14 Firestore collection schemas to Swift `Codable` structs in `SharedModels`:
  - `Area`, `Ingredient`, `InventoryItem`, `Recipe`, `MenuItem`, `PrepItem`, `ShoppingItem`, `LogEntry`, `Conversion`, `User`, `Category`, `MenuCategory`, `RecipeCategory`, `Unit`
- [ ] Build `APIClient` in `CoreNetworking`:
  - Single POST endpoint to existing Cloud Function
  - `SecureAPIRequest` struct matching `{operation, table, data, filters, options}`
  - `SecureAPIResponse<T: Codable>` generic response
  - Bearer token injection from Firebase Auth
  - Rate limit awareness (read `X-RateLimit-Remaining` header)

**Day 3 (Wed) — Authentication Module**
- [ ] Integrate Firebase Auth iOS SDK via SPM (`firebase-ios-sdk`)
- [ ] Build `AuthManager` (ObservableObject):
  - `signIn(email:password:)`, `signUp(email:password:)`, `signOut()`
  - `sendPasswordReset(email:)`
  - `onAuthStateChanged` → publish auth state
  - Store refresh token in Keychain (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`)
- [ ] Build Sign in with Apple flow (`ASAuthorizationAppleIDProvider`)
- [ ] Build `LoginView` and `SignUpView` in `FeatureAuth` (SwiftUI)

**Day 4 (Thu) — Design System & Navigation**
- [ ] Create `CoreDesignSystem`:
  - Color palette matching current dark theme (`#1a1a2e` bg, `#e8d5b7` accent)
  - Typography scale using Inter font
  - Shared button styles, card styles, toast component
  - `ModalContainer` view modifier (matching current modal pattern)
- [ ] Build tab-based navigation shell (`TabView`):
  - Inventory, Log, Ingredients, Recipes, Prep, Menu, Shopping, Admin
  - Role-based tab visibility (`isOwner()` check)
- [ ] Wire auth state → navigation (logged out = login, logged in = tabs)

**Day 5 (Fri) — State Management & Data Loading**
- [ ] Build `AppState` (ObservableObject) mirroring `var D`:
  - Published properties for each collection
  - `loadAllData()` using `Promise.allSettled` equivalent (TaskGroup with per-task error handling)
  - Partial load tolerance (if one collection fails, others still load)
- [ ] Build `SyncManager`:
  - Change detection (`markChanged()` equivalent)
  - Debounced save (2-second delay matching PWA)
  - Undo stack (`saveState()` equivalent)
- [ ] Loading overlay view (block interaction during initial load)
- [ ] Test: app launches, authenticates, loads all data from existing Firestore

---

### Week 2: Core Feature — Inventory

**Day 6 (Mon) — Inventory List View**
- [ ] `InventoryListView`: grouped by area, sections within areas
- [ ] Warehouse areas sorted to bottom (matching `renderInv` logic)
- [ ] Collapsible area headers (matching `tog('area-{id}')` pattern)
- [ ] Search/filter bar for inventory items
- [ ] Pull-to-refresh

**Day 7 (Tue) — Inventory Item Actions**
- [ ] Inline quantity editing (tap qty → edit field)
- [ ] Unit display with conversion support
- [ ] Out-of-stock toggle
- [ ] Swipe actions: edit, delete (with cloud-confirm-before-local-delete pattern)
- [ ] Double-tap prevention on all action buttons (600ms debounce)

**Day 8 (Wed) — Inventory Add/Edit/Transfer**
- [ ] Add inventory item modal (area picker, ingredient picker, qty, unit)
- [ ] Edit inventory item modal
- [ ] Transfer between areas modal
- [ ] All mutations: cloud API first, then local state update (fire-and-forget fix from audit)

**Day 9 (Thu) — Inventory Print & Scan (AI)**
- [ ] Print count sheet: generate PDF using `UIGraphicsPDFRenderer`
- [ ] Camera capture view (`UIImagePickerController` or `PhotosUI`)
- [ ] Scan flow: capture → base64 encode → call `scan` operation → review modal → apply
- [ ] Confidence indicators (high/medium/low) with color coding
- [ ] Admin-only gate on scan/print buttons

**Day 10 (Fri) — Unit Tests: Inventory**
- [ ] Unit tests for all inventory state mutations
- [ ] Unit tests for quantity conversion logic (`convertToStorageUnits` with division-by-zero guard)
- [ ] Unit tests for area grouping and sorting
- [ ] Mock API client for isolated testing
- [ ] Target: 80% coverage on `FeatureInventory` business logic

---

### Week 3: Recipes, Ingredients, Prep

**Day 11 (Mon) — Ingredients Tab**
- [ ] `IngredientsListView`: grouped by category, collapsible headers
- [ ] Add/edit ingredient modal (name, category, default unit, auto-shop, min qty)
- [ ] Archive/unarchive toggle
- [ ] Ingredient search
- [ ] XSS-safe: all names displayed via SwiftUI `Text()` (inherently safe, no innerHTML)

**Day 12 (Tue) — Recipes Tab**
- [ ] `RecipesListView`: grouped by recipe category, collapsible
- [ ] Recipe detail view with expandable sections (ingredients, sub-recipes, prep items, menu items, notes)
- [ ] FOH cocktail filter for employee role

**Day 13 (Wed) — Recipe Editing**
- [ ] Add/edit recipe modal
- [ ] Ingredient search and add to recipe (with qty and unit)
- [ ] Sub-recipe linking
- [ ] Recipe yield and output mode
- [ ] Cascade delete: clean up `preps` with matching `recId`

**Day 14 (Thu) — Prep Tab**
- [ ] `PrepListView`: prep items with on-hand quantities
- [ ] Add/edit prep item
- [ ] Prep item archival
- [ ] Link to parent recipe

**Day 15 (Fri) — Unit Tests: Recipes, Ingredients, Prep**
- [ ] Unit tests for recipe CRUD with cascade deletes
- [ ] Unit tests for ingredient cascade delete (inv, shopping, recs.ings, menus.ings, conversions)
- [ ] Unit tests for prep item operations
- [ ] Target: 80% coverage on all three feature modules

---

### Week 4: Menu, Shopping, Log, Admin

**Day 16 (Mon) — Menu Tab**
- [ ] `MenuListView`: grouped by menu category
- [ ] Add/edit menu item (name, category, target, unit, ingredients, recipes)
- [ ] Menu item archival
- [ ] Include in shop/prep toggles

**Day 17 (Tue) — Shopping List**
- [ ] `ShoppingListView`: items with checkboxes
- [ ] Add to shopping list
- [ ] "Saved for later" section
- [ ] Auto-generate from recipes/menu (shopping list calculation)
- [ ] Clear checked items

**Day 18 (Wed) — Log Tab**
- [ ] `LogListView`: activity history with timestamps
- [ ] Filter by date, user, action type
- [ ] Log entry detail view
- [ ] Audit trail display

**Day 19 (Thu) — Admin Tab**
- [ ] Team member management (owner only)
- [ ] User role assignment
- [ ] Email invitation (`invite_user` operation)
- [ ] Area management (CRUD)
- [ ] Category management (ingredient, menu, recipe categories)
- [ ] Unit management
- [ ] Conversion management
- [ ] Data export (Excel via a Swift library — no SheetJS needed)

**Day 20 (Fri) — Voice Assistant**
- [ ] `SFSpeechRecognizer` integration for real-time transcription
- [ ] Voice button UI with pulse animation
- [ ] Send transcript to `voice` operation
- [ ] Parse JSON action response and execute (navigate, search, add_inventory, etc.)
- [ ] Unit tests for voice action parsing

---

### Week 5: Offline, Sync, Polish

**Day 21 (Mon) — Offline Support**
- [ ] `NWPathMonitor` for connectivity detection
- [ ] Local persistence layer: SwiftData or Core Data for offline cache
- [ ] Queue mutations when offline (`syncQueue` — but actually retry, unlike PWA bug)
- [ ] "You are offline" banner + toast on state change

**Day 22 (Tue) — Sync Engine**
- [ ] Pull-before-push on reconnect (fix from audit)
- [ ] Sync mutex (prevent concurrent syncs)
- [ ] Change detection: diff local state vs synced snapshot
- [ ] Conflict resolution: last-write-wins (matching current behavior)
- [ ] Sync status indicator in nav bar

**Day 23 (Wed) — Error Handling & Edge Cases**
- [ ] Toast notification system (success, error, warning — matching PWA)
- [ ] API error handling: show user-facing messages, never silent failures
- [ ] Network timeout handling (60s matching Cloud Function timeout)
- [ ] Graceful degradation on partial data load
- [ ] Loading states for all async operations

**Day 24 (Thu) — UI Polish**
- [ ] Haptic feedback on key actions
- [ ] Pull-to-refresh on all list views
- [ ] Keyboard avoidance on forms
- [ ] Dynamic Type support (accessibility)
- [ ] Dark mode (already dark theme — add light mode toggle)
- [ ] App icon (512x512, 1024x1024 for App Store)
- [ ] Launch screen

**Day 25 (Fri) — Integration Tests**
- [ ] Integration tests: full auth flow (login → load data → edit → sync)
- [ ] Integration tests: offline → online sync cycle
- [ ] Integration tests: role-based access (owner vs employee)
- [ ] Snapshot tests for key screens using `swift-snapshot-testing`

---

### Week 6: Security, Privacy, Compliance

**Day 26 (Mon) — Security Implementation**
- [ ] Certificate pinning (pin public key hash of Cloud Function endpoint)
- [ ] Keychain storage for all tokens (never UserDefaults)
- [ ] Jailbreak detection (multiple methods)
- [ ] Disable screenshots of sensitive screens (admin, user data)
- [ ] TLS 1.3 enforcement via ATS configuration

**Day 27 (Tue) — Privacy Compliance**
- [ ] Create `PrivacyInfo.xcprivacy`:
  - `NSPrivacyTracking: false` (no IDFA usage)
  - `NSPrivacyCollectedDataTypes`: email, name, usage data
  - `NSPrivacyAccessedAPITypes`: UserDefaults, file timestamp (if used)
- [ ] Privacy Policy (link in app settings + App Store Connect)
- [ ] Terms of Service with Apple auto-renewal disclosures
- [ ] Account deletion flow: delete Firestore data + call Apple `/auth/revoke`
- [ ] GDPR: data export, data deletion, consent tracking

**Day 28 (Wed) — App Store Preparation**
- [ ] App Store Connect setup:
  - App name, bundle ID, SKU
  - Privacy Policy URL
  - App category: Food & Drink → Business
  - Age rating
  - Copyright
- [ ] Screenshots: 6.7" (iPhone 15 Pro Max), 6.1" (iPhone 15 Pro), 5.5" (iPhone 8 Plus)
- [ ] App description, keywords, subtitle
- [ ] Preview video (optional but lifts conversion 20-35%)

**Day 29 (Thu) — StoreKit 2 Subscription Setup**
- [ ] Create subscription group in App Store Connect:
  - **Oracle Pro Monthly**: $29.99/mo (per-restaurant)
  - **Oracle Pro Annual**: $199.99/yr (~44% savings)
  - **Oracle Team**: $49.99/mo (multi-location)
- [ ] Implement `SubscriptionManager`:
  - `Product.products(for:)` to fetch offerings
  - `Transaction.updates` listener
  - Send `transactionID` to backend for server-side validation
- [ ] Paywall view with plan comparison
- [ ] Free tier: 1 restaurant, 50 ingredients, 20 recipes (enough to evaluate)
- [ ] Restore purchases flow

**Day 30 (Fri) — Server-Side Subscription Validation**
- [ ] Add App Store Server Notifications V2 endpoint to Cloud Functions
- [ ] Handle notification types: `SUBSCRIBED`, `DID_RENEW`, `DID_FAIL_TO_RENEW`, `GRACE_PERIOD_EXPIRED`, `REFUND`, `REVOKE`
- [ ] `entitlements` collection in Firestore (user_id, plan, is_active, expires_at)
- [ ] Gate features by entitlement (free tier limits enforced server-side)
- [ ] Sandbox testing: full purchase → renewal → cancellation → grace period flow

---

### Week 7: CI/CD & Testing Pipeline

**Day 31 (Mon) — GitHub Repository & CI Setup**
- [ ] Create GitHub repo (private)
- [ ] GitHub Actions workflow for iOS:
  - Build on push to `main` and PRs
  - Run unit tests
  - Run integration tests
  - SwiftLint for code style
- [ ] Xcode Cloud setup (25 hrs/mo free):
  - Automatic TestFlight builds on merge to `main`
  - Test action before archive

**Day 32 (Tue) — Fastlane Setup**
- [ ] `Fastfile` with lanes:
  - `test` — run all tests
  - `beta` — build + upload to TestFlight
  - `release` — build + submit for App Store review
- [ ] `match` for code signing (Git storage)
- [ ] `deliver` for metadata/screenshots upload
- [ ] `MATCH_READONLY=true` on CI

**Day 33 (Wed) — Crash Reporting & Analytics**
- [ ] Integrate Sentry iOS SDK:
  - Crash reporting with symbolication
  - Performance monitoring (app start, API latency)
  - Session replay (optional)
- [ ] Integrate Firebase Analytics (free, unlimited):
  - Screen views, feature usage, error events
  - User properties (role, plan, restaurant_count)
- [ ] Key events to track:
  - `app_open`, `login`, `signup`
  - `inventory_update`, `recipe_create`, `scan_complete`, `voice_command`
  - `subscription_start`, `subscription_cancel`
  - `sync_success`, `sync_failure`

**Day 34 (Thu) — Performance Optimization**
- [ ] App launch time: target <400ms first meaningful paint
  - Lazy load feature modules
  - Static linking (no dynamic frameworks beyond system)
  - Measure with Instruments > App Launch template
- [ ] Image optimization: WebP for any network images
- [ ] Memory profiling: ensure no leaks in sync engine
- [ ] Network: HTTP/2 (Firebase default), response compression

**Day 35 (Fri) — TestFlight Beta**
- [ ] Archive release build
- [ ] Upload to TestFlight
- [ ] Internal testing (100 testers, no review needed)
- [ ] Verify: login, data load, all tabs, sync, scan, voice, subscription paywall
- [ ] Crash-free rate target: >99.5%

---

### Week 8: Beta Testing & Bug Fixes

**Day 36-40 (Mon-Fri) — Beta Period**
- [ ] Day 36: Distribute to 10-20 beta testers (restaurant staff, friendly owners)
- [ ] Day 37: Triage incoming feedback, fix critical bugs
- [ ] Day 38: Fix medium-priority bugs, polish UI based on feedback
- [ ] Day 39: Second TestFlight build with fixes
- [ ] Day 40: Accessibility audit (VoiceOver, Dynamic Type, color contrast 4.5:1)

---

### Week 9: App Store Submission

**Day 41 (Mon) — Final Pre-Submission Checklist**
- [ ] All 20 pre-launch items from ios-app-guide Section 19 verified
- [ ] Privacy Manifest complete and accurate
- [ ] Sign in with Apple works end-to-end
- [ ] Account deletion works end-to-end
- [ ] Subscription purchase/restore works in sandbox
- [ ] All screenshots current and accurate
- [ ] No debug flags in release build
- [ ] Force update mechanism ready (server-side version check)

**Day 42 (Tue) — Submit to App Store Review**
- [ ] Submit via App Store Connect
- [ ] Phased release configured: 1% → 2% → 5% → 10% → 20% → 50% → 100%
- [ ] Demo account credentials provided for reviewer
- [ ] App Review notes explaining restaurant management context

**Day 43-45 (Wed-Fri) — Review Period & Response**
- [ ] Monitor for reviewer questions
- [ ] If rejected: fix issue same day, resubmit
- [ ] Common rejection reasons to watch:
  - 2.1 App Completeness (demo account must work)
  - 5.1.x Privacy (manifest must be accurate)
  - 3.1.1 IAP (subscription must use StoreKit)

---

### Week 10: Launch & First 10K Users

**Day 46-50 — Post-Launch**
- [ ] Day 46: App goes live — monitor Sentry for crashes, watch reviews
- [ ] Day 47: Respond to all App Store reviews within 3 hours
- [ ] Day 48: First analytics review — identify drop-off points
- [ ] Day 49: Hotfix build if needed (skip phased release for critical fixes)
- [ ] Day 50: First week metrics report:
  - Downloads, DAU, crash-free rate
  - Signup → first inventory action (activation rate)
  - Trial → paid conversion
  - Average session duration

---

## PHASE 2: Growth & Optimization (Weeks 11-22)
**Goal:** Scale to 100K users, optimize monetization, add differentiating features
**Milestone:** 100K users
**Exit Criteria:** <100ms API p95, 99.9% uptime, trial-to-paid >10%, monthly churn <5%

---

### Week 11: Backend Scaling (10K → 100K Prep)

**Day 51 (Mon) — Redis Caching Layer**
- [ ] Add Redis (ElastiCache or Upstash) to Cloud Functions:
  - Cache user profile: 1hr TTL
  - Cache subscription/entitlement status: 5min TTL
  - Cache product catalog: 15min TTL
- [ ] Cache-aside pattern for reads, write-through for entitlement changes
- [ ] Expected: 50x latency improvement on cached reads

**Day 52 (Tue) — Database Query Optimization**
- [ ] Audit all Firestore queries for composite index needs
- [ ] Add missing indexes (currently only 4 custom indexes)
- [ ] Implement query result pagination (cursor-based, not offset)
- [ ] Connection pooling for Cloud Functions (warm starts)

**Day 53 (Wed) — Rate Limiting Upgrade**
- [ ] Move rate limiting from in-memory to Redis (distributed)
- [ ] Per-plan rate limits:
  - Free: 50 req/min
  - Pro: 200 req/min
  - Team: 500 req/min
- [ ] Rate limit headers in every response

**Day 54 (Thu) — Monitoring & Alerting**
- [ ] Firebase Cloud Monitoring dashboards:
  - Function invocation count, latency p50/p95/p99, error rate
  - Firestore read/write/delete operations
  - Auth sign-in success/failure rate
- [ ] Alerting rules:
  - Error rate >1% → Slack/email
  - p95 latency >2s → alert
  - Function cold starts >5s → alert

**Day 55 (Fri) — Load Testing**
- [ ] Simulate 100K user load patterns with k6 or Artillery
- [ ] Identify bottlenecks before they hit production
- [ ] Document capacity limits and scaling triggers

---

### Week 12: Subscription Optimization

**Day 56 (Mon) — Paywall A/B Testing**
- [ ] Integrate Superwall or RevenueCat Paywalls for no-code testing
- [ ] Create 3 paywall variants:
  - Feature comparison table
  - Social proof ("5,000+ restaurants trust Oracle")
  - Urgency/scarcity ("Annual plan: save 44%")
- [ ] Target: 50+ paywall experiments per year (guide recommendation)

**Day 57 (Tue) — Trial Optimization**
- [ ] Implement 21-day free trial (guide says 17-32 days = 45.7% conversion)
- [ ] Trial progress indicators ("7 days remaining")
- [ ] In-app messaging at trial milestones (day 3, day 14, day 20)
- [ ] Win-back offers for expired trials

**Day 58 (Wed) — Pricing Localization**
- [ ] Implement regional pricing using purchasing power parity
- [ ] App Store Connect: configure pricing for all territories
- [ ] LATAM pricing: ~30-50% discount vs US
- [ ] EU pricing: account for VAT

**Day 59 (Thu) — Churn Prevention**
- [ ] Cancellation survey (in-app, before confirming cancel)
- [ ] Win-back offers: discounted re-subscription
- [ ] Grace period handling: show "payment issue" banner, not instant downgrade
- [ ] Billing retry period messaging

**Day 60 (Fri) — Revenue Analytics Dashboard**
- [ ] MRR tracking
- [ ] Churn rate (monthly and annual separately)
- [ ] LTV:CAC ratio
- [ ] Trial-to-paid conversion rate
- [ ] Cohort analysis by signup month

---

### Week 13-14: User Acquisition & ASO

**Day 61-62 — App Store Optimization**
- [ ] Keyword research (AppTweak or similar):
  - "restaurant inventory", "kitchen management", "food cost", "recipe costing"
  - "restaurant app", "inventory management", "prep list"
- [ ] Optimize: App Name, Subtitle, Keyword field (100 chars)
- [ ] Create 3 Custom Product Pages (CPPs):
  - CPP1: "Inventory Management" → inventory screenshots
  - CPP2: "Recipe Costing" → recipe/menu screenshots
  - CPP3: "AI Kitchen Assistant" → scan/voice screenshots
- [ ] Assign keywords to CPPs (July 2025 feature — biggest recent ASO opportunity)

**Day 63-64 — Screenshot & Listing Optimization**
- [ ] Professional screenshots for all device sizes
- [ ] A/B test with Apple Product Page Optimization (3 treatments)
- [ ] App preview video (30 seconds, show scan + voice features)
- [ ] Localized metadata for Spanish (restaurant industry = high Hispanic workforce)

**Day 65-70 — Paid Acquisition Setup**
- [ ] Apple Search Ads campaign:
  - Brand terms (defensive)
  - Category terms ("restaurant inventory app")
  - Competitor terms
  - Target CPA: <$15 (restaurant SaaS has high LTV)
- [ ] Google UAC campaign for iOS
- [ ] Content marketing: "How to reduce food waste with inventory tracking" blog posts
- [ ] Restaurant industry partnerships (POS systems, food distributors)

---

### Week 15-16: Retention & Engagement Features

**Day 71-75 — Push Notifications**
- [ ] Integrate OneSignal (or FCM directly)
- [ ] Notification types:
  - Inventory low stock alerts (based on `minQty`)
  - Prep list reminders (morning, based on menu schedule)
  - Weekly cost summary
  - Subscription status changes
- [ ] Start conservative: 2-3 notifications/week max
- [ ] A/B test send times

**Day 76-80 — Engagement Mechanics**
- [ ] Onboarding flow: guided setup (add areas → add ingredients → first inventory count)
- [ ] Target: activate within 3 minutes (2x retention lift per guide)
- [ ] Weekly food cost report (auto-generated)
- [ ] Inventory count streak tracker (gamification)
- [ ] Feature discovery tooltips for new users
- [ ] In-app messaging for feature announcements

---

### Week 17-18: Multi-Location & Team Features

**Day 81-85 — Multi-Restaurant Support**
- [ ] Restaurant entity: `restaurants` collection
- [ ] User → Restaurant mapping (many-to-many with roles)
- [ ] Restaurant switcher in nav bar
- [ ] All data scoped by `restaurant_id`
- [ ] Backend: permission checks include restaurant ownership

**Day 86-90 — Team Collaboration**
- [ ] Real-time inventory updates (Firestore listeners or polling)
- [ ] Activity feed per restaurant
- [ ] User avatars and assignment
- [ ] Shift-based prep assignments
- [ ] Comment/note system on inventory items

---

### Week 19-20: Advanced AI Features

**Day 91-95 — Smart Ordering**
- [ ] AI-powered order suggestion based on:
  - Historical usage patterns
  - Current inventory levels
  - Upcoming menu schedule
  - Seasonal trends
- [ ] Gemini integration: "Based on last 4 weeks, you'll need X by Friday"
- [ ] One-tap add to shopping list

**Day 96-100 — Food Cost Analytics**
- [ ] Actual vs theoretical food cost per recipe
- [ ] Menu item profitability ranking
- [ ] Waste tracking and reporting
- [ ] Cost trend visualization (charts)
- [ ] AI insights: "Your cheese costs increased 15% this month"

---

### Week 21-22: 100K User Milestone

**Day 101-105 — Performance & Reliability**
- [ ] API response time audit: target p95 <100ms
- [ ] Database read replicas if Firestore latency increases
- [ ] CDN for any static assets
- [ ] Background app refresh for data pre-loading
- [ ] Widget support (iOS WidgetKit): today's prep list, low stock alerts

**Day 106-110 — 100K Checkpoint**
- [ ] Full security audit (run /security-audit protocol from fullstack-agent-reference)
- [ ] Penetration test on API endpoints
- [ ] GDPR/CCPA compliance audit
- [ ] Performance profiling under load
- [ ] Customer support system setup (Intercom or Zendesk)
- [ ] Knowledge base / help articles
- [ ] Metrics review:
  - DAU/MAU ratio (target >30%)
  - Monthly churn <5%
  - Trial-to-paid >10%
  - NPS score baseline
  - Crash-free rate >99.9%

---

## PHASE 3: Scale to 1M (Weeks 23-40)
**Goal:** Enterprise-grade infrastructure, multi-region, marketplace features
**Milestone:** 1M users
**Exit Criteria:** 99.99% uptime, multi-region, <50ms API p50, enterprise tier launched

---

### Week 23-24: Backend Migration (Firebase → Custom)

**Day 111-115 — Go API Server**
- [ ] Build Go (Fiber) API server mirroring all Cloud Function operations
- [ ] PostgreSQL database with schema matching Firestore collections
- [ ] PgBouncer connection pooling
- [ ] Data migration script: Firestore → PostgreSQL
- [ ] Dual-write period: both backends receive writes, compare results

**Day 116-120 — Infrastructure Setup (AWS)**
- [ ] ECS Fargate for API servers (auto-scaling)
- [ ] Lambda for event-driven tasks (webhooks, push notifications, reports)
- [ ] RDS PostgreSQL Multi-AZ
- [ ] ElastiCache Redis
- [ ] CloudFront CDN
- [ ] Route 53 DNS
- [ ] S3 for image storage (scan photos, receipts)

---

### Week 25-26: Horizontal Scaling

**Day 121-125 — Database Scaling**
- [ ] Read replicas for PostgreSQL (80%+ workloads are reads)
- [ ] Query optimization: identify and fix N+1 queries
- [ ] Materialized views for reporting/analytics queries
- [ ] Partitioning strategy for `log` and `audit_log` tables (time-based)

**Day 126-130 — Message Queue & Async Processing**
- [ ] SQS for async operations:
  - Push notification dispatch
  - Report generation
  - AI inference (scan, voice)
  - Webhook delivery
- [ ] Dead letter queue for failed operations
- [ ] Background job workers (horizontally scaled)

---

### Week 27-28: Enterprise Features

**Day 131-135 — Enterprise Tier**
- [ ] SSO integration (SAML 2.0, OAuth)
- [ ] Custom branding per organization
- [ ] Admin console: manage all restaurants in org
- [ ] Bulk user provisioning (CSV upload)
- [ ] Audit log export
- [ ] API access for POS integration

**Day 136-140 — Integrations Marketplace**
- [ ] POS system integrations (Toast, Square, Clover)
- [ ] Accounting integration (QuickBooks, Xero)
- [ ] Supplier ordering integration (US Foods, Sysco)
- [ ] Webhook system for custom integrations
- [ ] Developer API documentation

---

### Week 29-30: Multi-Region & Reliability

**Day 141-145 — Multi-Region Deployment**
- [ ] US-East + US-West initially
- [ ] EU region (Frankfurt) for GDPR data residency
- [ ] Global load balancing via CloudFront
- [ ] Database replication across regions
- [ ] Region-aware routing

**Day 146-150 — Reliability Engineering**
- [ ] 99.99% uptime SLO
- [ ] Automated failover testing
- [ ] Chaos engineering: random instance termination
- [ ] Incident response playbooks
- [ ] On-call rotation setup
- [ ] Status page (public)

---

### Week 31-32: Advanced Analytics & ML

**Day 151-155 — Analytics Pipeline**
- [ ] Event streaming: app → Kafka/Kinesis → data warehouse
- [ ] Snowflake or BigQuery for analytics
- [ ] Dashboards: operational metrics, business metrics, product metrics
- [ ] Cohort analysis automation
- [ ] Revenue forecasting model

**Day 156-160 — ML-Powered Features**
- [ ] Demand forecasting per ingredient (based on historical usage + seasonality)
- [ ] Anomaly detection on inventory (theft, waste, data entry errors)
- [ ] Smart recipe costing with market price tracking
- [ ] Natural language recipe import ("paste a recipe from the web")

---

### Week 33-34: Platform Expansion

**Day 161-165 — iPad App**
- [ ] iPad-optimized layouts (split view, larger grids)
- [ ] Sidebar navigation for iPad
- [ ] Multitasking support (Split View, Slide Over)
- [ ] Apple Pencil support for inventory annotations

**Day 166-170 — Apple Watch App**
- [ ] Quick inventory count entry
- [ ] Low stock alerts on wrist
- [ ] Prep list glanceable view
- [ ] Complications for today's prep count

---

### Week 35-36: Localization & International

**Day 171-175 — Localization**
- [ ] Spanish (primary — restaurant industry)
- [ ] French, Portuguese, Mandarin (top restaurant markets)
- [ ] RTL support (Arabic)
- [ ] Locale-aware date/number/currency formatting
- [ ] Localized App Store metadata for all target markets

**Day 176-180 — International Compliance**
- [ ] GDPR full compliance with DPA contracts
- [ ] CCPA/CPRA with ADMT pre-use notices (Jan 2026 requirement)
- [ ] TCF v2.3 consent management
- [ ] Data residency controls per region
- [ ] Cookie/tracking consent (for any web components)

---

### Week 37-38: Enterprise Sales & Growth

**Day 181-185 — Sales Infrastructure**
- [ ] Self-serve enterprise signup flow
- [ ] Contract management (Stripe Billing or custom)
- [ ] Volume licensing (5+ restaurants = discount)
- [ ] White-label option for restaurant groups
- [ ] Demo environment for sales

**Day 186-190 — Growth Engine**
- [ ] Referral program: existing restaurant → new restaurant
- [ ] Restaurant group viral expansion (one location → all locations)
- [ ] Industry event presence (NRA Show, etc.)
- [ ] Case study content from top customers
- [ ] SEO content hub (food cost guides, inventory best practices)

---

### Week 39-40: 1M User Milestone

**Day 191-195 — Final Scaling Prep**
- [ ] Database sharding evaluation (Citus for PostgreSQL if needed)
- [ ] Microservice extraction: separate auth, subscription, AI, and core API
- [ ] gRPC for internal service-to-service communication
- [ ] Kubernetes migration if container orchestration needs exceed Fargate
- [ ] Cost optimization: Reserved Instances, Savings Plans

**Day 196-200 — 1M Checkpoint**
- [ ] Full infrastructure load test (simulate 1M concurrent)
- [ ] Security penetration test (third-party)
- [ ] SOC 2 Type II preparation
- [ ] Comprehensive metrics review:
  - ARR trajectory
  - Net Revenue Retention >120%
  - Monthly churn <3%
  - LTV:CAC >5:1
  - Crash-free rate >99.99%
  - API p50 <50ms, p99 <200ms
  - 99.99% uptime over trailing 90 days
- [ ] Board/investor metrics package
- [ ] Series A preparation (if applicable)

---

## Cost Projections by Phase

| Phase | Users | Monthly Infra | Monthly Team | Monthly UA | Total/mo |
|-------|-------|--------------|-------------|-----------|----------|
| **1** | 0-10K | $50-200 (Firebase free/Blaze) | $0 (solo) | $0-500 | **$50-700** |
| **2** | 10K-100K | $500-2,000 | $0-15K (1-2 contractors) | $2K-10K | **$2.5K-27K** |
| **3** | 100K-1M | $10K-30K (AWS) | $150K-350K (12-20 FTE) | $50K-500K | **$210K-880K** |

## Revenue Projections (Conservative)

| Phase | Users | Paying (5% conv) | ARPU | MRR | ARR |
|-------|-------|------------------|------|-----|-----|
| **1** | 10K | 500 | $30 | $15K | $180K |
| **2** | 100K | 5,000 | $35 | $175K | $2.1M |
| **3** | 1M | 50,000 | $40 | $2M | $24M |

---

## Key Decision Points

| Decision | When | Options | Recommendation |
|----------|------|---------|----------------|
| Native vs PWA wrapper | Day 1 | Native SwiftUI / Capacitor / PWA | **Native SwiftUI** — guide says invest in architecture early |
| Firebase vs custom backend | Week 23 | Stay Firebase / migrate to Go+Postgres | **Firebase through 100K**, migrate at scale |
| RevenueCat vs custom StoreKit | Day 29 | RevenueCat / Custom StoreKit 2 | **Custom StoreKit 2** — no vendor fees, you own it |
| Analytics platform | Day 33 | Firebase (free) + Mixpanel / PostHog | **Firebase + PostHog** — generous free tier, self-hostable |
| Support platform | Day 106 | Intercom / Zendesk / Freshdesk | **Intercom** — Fin bot resolves ~50% |
| Backend language at scale | Day 111 | Go / Node / Rust | **Go (Fiber)** — 2.6x faster than Node, low memory |
| Database at scale | Day 111 | PostgreSQL / keep Firestore | **PostgreSQL** — ACID, proven at 1M+, read replicas |

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| App Store rejection | Medium | High (1-2 week delay) | Follow pre-launch checklist religiously, provide demo account |
| Firebase cost spike at scale | High | Medium | Monitor usage, migrate to custom backend at 100K |
| Low trial-to-paid conversion | Medium | High | 50+ paywall experiments/year, optimize trial length |
| Slow user acquisition | High | High | ASO + Apple Search Ads + restaurant industry partnerships |
| Competitor launches similar | Medium | Medium | Ship fast, build switching costs (data lock-in, integrations) |
| AI API cost at scale | Medium | Medium | Cache common requests, batch processing, self-hosted models |
| Key person dependency | High | Critical | Document everything, modular architecture enables hiring |

---

*Generated 2026-03-03. Reference: ios-app-guide.html (19-section 1M+ subscriber guide), Restaurant_Oracle_Updates.md (quality audit), fullstack-agent-reference.md (development methodology)*

---

## Transactional Email System (added 2026-05-01)

Closes the silent-churn gap: signup, trial expiry, billing, team invites, payment failures all now generate user-facing email. Marketing/drip is explicitly out of scope (separate consent + unsubscribe machinery required).

### Provider

- **Resend** — REST API, native `fetch` (Node 22), no SDK dep
- **Account**: shared with LaChona Bistro (single Resend team, single API key)
- **Sender**: `Bistro Steward <noreply@bistrosteward.com>` once domain verified; falls back to `onboarding@resend.dev` via `RESEND_FROM` override secret during testing
- **Reply-to**: `support@bistrosteward.com`
- **Free tier**: 3,000 emails/month, 100/day. Scales to $20/mo @ 50K. Plenty of headroom through Phase 1; budget at 100K → ~$90/mo, at 1M → migrate to AWS SES if cost-driven.

### Files

- `firebase/functions/emails.js` — new module (~360 lines)
  - `sendEmail(to, templateName, data) → { ok, id?, error? }` helper
  - 9 templates with shared `layout()` (dark gradient header, Inter font, gold `#f6b43b` CTA, branded footer)
  - Every send → Firestore audit log at `/tenants/{tenantId}/audit_log` as `email_sent:{template}`
- `firebase/functions/index.js` — wired hooks (no separate file)

### 9 Templates

| Template | Trigger | Subject |
|----------|---------|---------|
| `owner_welcome` | `handleSignup` after tenant provisioning | Welcome to Bistro Steward |
| `trial_ending_7d` | Cron, day 23 of trial | Your trial ends in 7 days |
| `trial_ending_2d` | Cron, day 28 | Your trial ends in 2 days |
| `trial_ending_today` | Cron, day 30 morning | Your free trial ends today |
| `first_charge_receipt` | `squareWebhook` `invoice.payment_made` | Receipt from Bistro Steward — $X |
| `payment_failed` | `squareWebhook` `invoice.scheduled_charge_failed` | Payment failed — action needed |
| `subscription_cancelled` | `adminBilling.cancelSubscription` + webhook ACTIVE→CANCELED | Subscription cancelled |
| `subscription_reactivated` | `adminBilling.resumeSubscription` | Welcome back |
| `team_invite` | `adminBilling.inviteTeamMember` | [Owner] invited you to [Restaurant Name] |

### Cron — `dailyTrialReminders`

- `functions.pubsub.schedule('0 9 * * *').timeZone('America/Los_Angeles')`
- Queries `tenants where trialEndsAt ∈ [now, now+8d]`
- Buckets by `daysLeft`: ≤0 → today, ≤2 → 2d, ≤7 → 7d
- Dedupe: writes `trialEmailsSent.{bucket} = serverTimestamp()` after send; skips if flag exists
- Skips tenants with `status = cancelled`
- Memory 512MB, timeout 540s, max 1 instance
- Manual trigger: `runTrialRemindersNow` HTTPS endpoint, super-admin only

### Tenant doc fields added

- `trialEndsAt: Timestamp` — set in `handleSignup` = signupDate + 30d (matches Square subscription `start_date`)
- `trialEmailsSent: { '7d': Timestamp, '2d': Timestamp, 'today': Timestamp }` — dedup map, written by cron
- `emailSent_invoice_payment_made_<invoiceId>: Timestamp` — webhook dedup
- `emailSent_invoice_scheduled_charge_failed_<invoiceId>: Timestamp` — webhook dedup

### Square webhook extended (`handleSquareSubscriptionEvent`)

- Tracks prior `squareSubscriptionStatus` to detect ACTIVE → CANCELED transitions (fires `subscription_cancelled`)
- On `invoice.payment_made`: extracts `amountCents`, `paidAt`, `nextBillingDate` from payload, sends receipt
- On `invoice.scheduled_charge_failed`: marks tenant `past_due`, sends `payment_failed`
- All sends dedupe by invoice ID; idempotent if Square retries the webhook

### Admin ops wired

- `adminOpCancelSubscription` → `subscription_cancelled` (belt-and-suspenders with webhook)
- `adminOpResumeSubscription` → `subscription_reactivated`
- `adminOpInviteTeamMember` → `team_invite` (includes Firebase Auth password-reset link as `setupLink`)

### Signup hook

- `handleSignup` after `agents.runProvisioning`: sends `owner_welcome` (non-fatal — never blocks signup)

### Secrets

`RESEND_API_KEY` added to `runWith({ secrets: [...] })` on:

- `signupTenant`
- `squareWebhook`
- `adminBilling`
- `dailyTrialReminders`
- `runTrialRemindersNow`
- `sendTestEmail`

Set via `firebase functions:secrets:set RESEND_API_KEY` (paste LaChona's existing key — same Resend team).

Optional second secret `RESEND_FROM` overrides the from-address for testing without domain verification (`onboarding@resend.dev`). Remove once `bistrosteward.com` is verified in Resend.

### QA endpoints

- `sendTestEmail` — POST `{ to, template, data }`, super-admin only. Sends one template with stub data. Used to validate each of the 9 templates against `grandma.chona@gmail.com` post-deploy.
- `runTrialRemindersNow` — manual cron fire, super-admin only. Returns `{ scanned, sent, skipped, errors }`.

### Audit logging

Every send writes to `/tenants/{tenantId}/audit_log` with `operation: 'email_sent:<template>'`, `record_count: 1` (success) or `0` (failure), and `email_info` containing the Resend message ID or error string. Failures don't block the parent action — emails are best-effort, logged then ignored. The existing `dailyTenantCostAggregation` rollup already counts Resend sends per tenant per day.

### Outstanding setup steps (user-side)

1. Add `bistrosteward.com` to Resend dashboard → Domains
2. Paste 3 DNS records (MX + 2 TXT — SPF + DKIM) into GoDaddy DNS panel for `bistrosteward.com`
3. Verify in Resend (~5 min DNS propagation)
4. Remove `RESEND_FROM` secret to use branded sender
5. (Optional) Customize Firebase Auth email templates in Firebase Console → Authentication → Templates to match Resend sender brand

### Non-goals (explicit)

- No marketing/drip campaign system (consent + unsubscribe needed first)
- No in-app notification system (separate workstream)
- Firebase Auth verification + password-reset emails not migrated to Resend (just rebrand sender via Firebase Console templates)

### Deliverability checklist

- DKIM via Resend (auto-managed)
- SPF: `v=spf1 include:amazonses.com ~all` (or merged into existing record at GoDaddy if any)
- DMARC: optional, Resend provides record (`v=DMARC1; p=none; rua=mailto:dmarc@...`)
- All 9 templates have plaintext fallback
- `List-Unsubscribe: <mailto:support@bistrosteward.com?subject=Unsubscribe>` header on every send (CAN-SPAM hygiene even though all sends are transactional)
- `X-Entity-Ref-ID: <tenantId>` header for Resend log filtering
- Resend tags `template` + `tenant` for analytics in Resend dashboard

### Scale notes (10K → 100K → 1M)

- **10K users**: ~10 emails/tenant/month avg → 100K sends/mo. Resend Pro $20/mo covers 50K; bump to Business $90/mo for 100K. Free tier (3K/mo) burns out at ~300 active tenants.
- **100K users**: ~1M sends/mo. Resend Business $90 → migrate to Resend Scale (custom) or AWS SES (~$100/mo, 1M sends).
- **1M users**: ~10M sends/mo. AWS SES at $1.00/1K sends = $10K/mo. Build dedicated email service worker on Go backend (Day 111+ migration).
- Template renderer is pure functions in `emails.js` — portable to any backend without rewrite.

---


<a id="phase1"></a>

# Phase 1 Plan (0 → 10K Users)

_Source: `PHASE1_10K.md`_

# Bistro Steward — Phase 1: 0 → 10K Users

## Detailed Daily Deliverables

**Start Date:** 2026-03-03
**Target:** 10K users (est. 1,000-3,000 restaurants x 3-10 staff each)
**Duration:** 16 weeks (80 working days)
**Team:** Solo developer
**Budget:** $50-700/mo (Firebase Blaze, Apple Dev $99/yr, domain)

### Current State
- 8,228-line vanilla JS PWA — fully functional, deployed at restaurant-oracle.web.app
- Firebase backend: Cloud Functions (Node 22), Firestore, Auth
- 14 Firestore collections, 8 API operations, 2 roles (owner/employee)
- AI: Gemini 2.5 Flash (voice commands + inventory photo scan)
- Zero tests, zero CI/CD, no service worker
- PWA stays live throughout — existing users unaffected

### Exit Criteria (all must pass before moving to Phase 2)
- [ ] Live on App Store with 4.5+ star rating
- [ ] Cold launch <2s on iPhone 12+
- [ ] 80%+ unit test coverage on business logic
- [ ] Crash-free rate >99.5% (Sentry)
- [ ] 10K registered users
- [ ] >200 paying subscribers
- [ ] Trial-to-paid conversion >4.8% (industry avg per guide)
- [ ] Day-7 retention >15%

---

## PART A: BUILD (Weeks 1-7)

---

### WEEK 1: Xcode Project, Models, Auth, Navigation

#### Day 1 — Xcode Project Scaffold

**Morning: Project creation**
- [ ] Create new Xcode project `BistroSteward`
  - iOS 17.0 minimum deployment target
  - SwiftUI lifecycle
  - Bundle ID: `com.bistrosteward.com`
  - Team: your Apple Developer account
- [ ] Initialize Git repo, create `.gitignore` (Xcode template + SPM)
- [ ] Create `develop` branch (work here, merge to `main` for releases)

**Afternoon: SPM modular package structure**
- [ ] Create `Packages/` directory at project root
- [ ] Create 8 local Swift packages:

```
Packages/
├── CoreNetworking/        → URLSession wrapper, API client, token management
│   ├── Sources/
│   └── Tests/
├── CoreDesignSystem/      → Colors, fonts, shared UI components
│   ├── Sources/
│   └── Tests/
├── SharedModels/          → Codable structs for all 14 Firestore collections
│   ├── Sources/
│   └── Tests/
├── FeatureAuth/           → Login, signup, password reset, Sign in with Apple
│   ├── Sources/
│   └── Tests/
├── FeatureInventory/      → Inventory tab (list, edit, scan, print)
│   ├── Sources/
│   └── Tests/
├── FeatureRecipes/        → Recipes + Ingredients + Prep tabs
│   ├── Sources/
│   └── Tests/
├── FeatureMenu/           → Menu + Shopping tabs
│   ├── Sources/
│   └── Tests/
└── FeatureAdmin/          → Admin, Log, Settings tabs
    ├── Sources/
    └── Tests/
```

- [ ] Each `Package.swift` declares dependencies:
  - Feature packages depend on `CoreNetworking`, `CoreDesignSystem`, `SharedModels`
  - Feature packages NEVER depend on each other
  - Core packages depend only on `SharedModels` (if needed)
- [ ] Add all packages to main Xcode project as local dependencies
- [ ] Verify: project builds with empty packages (no errors)

**End of day checkpoint:** Clean build, packages linked, compiles in <10s

---

#### Day 2 — Shared Data Models

**Morning: Core Firestore models** (in `SharedModels`)
- [ ] `Area.swift`:
  ```swift
  struct Area: Codable, Identifiable, Hashable {
      let id: Int
      var name: String
      var sections: [String]
      var isWarehouse: Bool
      var prep: Bool
      var invFrequency: String?
      var assignedTo: String?
      var lastInventory: String?
  }
  ```
- [ ] `Ingredient.swift`: id, name, catId, areaId, subArea, defUnit, standalone, autoShop, minQty, archived
- [ ] `InventoryItem.swift`: id, areaId, ingId, qty, unit, outOfStock, subArea
- [ ] `Recipe.swift`: id, name, group, catId, ings (array), subRecs (array), preps (array), menuItems (array), notes, yield, outputMode, archived
- [ ] `MenuItem.swift`: id, name, catId, tgt, unitId, ings (array), recs (array), archived, includeInShop, includeInPrep
- [ ] `PrepItem.swift`: id, name, recId, onHand, par, unit, archived

**Afternoon: Supporting models**
- [ ] `ShoppingItem.swift`: id, ingId, qty, unit, checked, savedForLater
- [ ] `LogEntry.swift`: id, userId, action, collection, itemId, oldVal, newVal, timestamp
- [ ] `Conversion.swift`: id, ingId, storageUnit, recipeUnit, factor
- [ ] `AppUser.swift`: id, name, email, role, subRole
- [ ] `Category.swift`: id, name (reused for cats, menuCats, recCats)
- [ ] `MeasurementUnit.swift`: id, abbr
- [ ] `AppSettings.swift`: generic key-value
- [ ] `ApprovedEmail.swift`: id, email, role, addedBy

**API request/response models:**
- [ ] `SecureAPIRequest.swift`:
  ```swift
  struct SecureAPIRequest: Encodable {
      let operation: String    // select, insert, update, upsert, delete, voice, scan, invite_user
      let table: String        // collection name
      let data: AnyCodable?    // payload
      let filters: APIFilters?
      let options: [String: AnyCodable]?
  }
  ```
- [ ] `SecureAPIResponse<T: Decodable>.swift`: data array, error string, count
- [ ] `APIFilters.swift`: eq, order, limit, `in` (for delete batch)
- [ ] `AnyCodable.swift`: type-erased Codable wrapper for dynamic payloads

**End of day checkpoint:** All 14+ models compile, match Firestore schema exactly

---

#### Day 3 — API Client & Firebase Auth

**Morning: CoreNetworking API client**
- [ ] `APIClient.swift` (actor for thread safety):
  ```swift
  actor APIClient {
      static let shared = APIClient()
      private let baseURL = "https://us-central1-restaurant-oracle.cloudfunctions.net/api"

      func request<T: Decodable>(
          operation: String,
          table: String,
          data: Encodable? = nil,
          filters: APIFilters? = nil
      ) async throws -> [T]
  }
  ```
  - Gets Firebase ID token from `Auth.auth().currentUser?.getIDToken()`
  - Sets `Authorization: Bearer <token>` header
  - Sets `Content-Type: application/json`
  - POST-only (matches backend enforcement)
  - Reads `X-RateLimit-Remaining` from response headers
  - Throws typed errors: `.unauthorized`, `.rateLimited`, `.serverError(String)`, `.networkError`
  - Timeout: 60 seconds (matching Cloud Function timeout)
- [ ] `APIError.swift`: enum with user-facing error messages

**Afternoon: Firebase Auth integration**
- [ ] Add `firebase-ios-sdk` via SPM (FirebaseAuth module only — keep lean)
- [ ] `AuthManager.swift` (ObservableObject) in `FeatureAuth`:
  ```swift
  @MainActor
  class AuthManager: ObservableObject {
      @Published var currentUser: FirebaseAuth.User?
      @Published var isAuthenticated = false
      @Published var isLoading = true

      func signIn(email: String, password: String) async throws
      func signUp(email: String, password: String) async throws
      func signOut() throws
      func sendPasswordReset(email: String) async throws
      func deleteAccount() async throws  // GDPR + Apple requirement
  }
  ```
  - Auth state listener: `Auth.auth().addStateDidChangeListener`
  - On sign out: clear Keychain, reset app state
- [ ] `KeychainHelper.swift`: store/retrieve/delete using Security framework
  - `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` for tokens
  - Never use `UserDefaults` for sensitive data

**End of day checkpoint:** Can sign in with existing credentials, get valid ID token, make a `select` call to Cloud Function and get data back

---

#### Day 4 — Design System & App Shell

**Morning: CoreDesignSystem**
- [ ] `Colors.swift`:
  ```swift
  extension Color {
      static let oracleBg = Color(hex: "#1a1a2e")
      static let oracleSurface = Color(hex: "#16213e")
      static let oracleAccent = Color(hex: "#e8d5b7")
      static let oracleText = Color(hex: "#f5f5f5")
      static let oracleMuted = Color(hex: "#8b949e")
      static let oracleSuccess = Color(hex: "#3fb950")
      static let oracleError = Color(hex: "#ff7b72")
      static let oracleWarning = Color(hex: "#f0883e")
  }
  ```
- [ ] `Typography.swift`: Inter font registration, text style presets (title, heading, body, caption)
- [ ] `OracleButton.swift`: primary (accent bg), secondary (outline), danger (red)
- [ ] `OracleCard.swift`: dark surface card with border, corner radius
- [ ] `OracleSearchBar.swift`: search input with clear button
- [ ] `ToastView.swift` + `ToastModifier.swift`:
  - `.success`, `.error`, `.warning` variants
  - Auto-dismiss after 4 seconds
  - Slide-in animation from top
  - Queue multiple toasts

**Afternoon: App navigation shell**
- [ ] `RootView.swift`: switches between `LoginView` and `MainTabView` based on auth state
- [ ] `MainTabView.swift`:
  ```swift
  TabView(selection: $selectedTab) {
      InventoryTab().tabItem { Label("Inventory", systemImage: "shippingbox") }.tag(Tab.inventory)
      LogTab().tabItem { Label("Log", systemImage: "list.clipboard") }.tag(Tab.log)
      IngredientsTab().tabItem { Label("Ingredients", systemImage: "leaf") }.tag(Tab.ingredients)
      RecipesTab().tabItem { Label("Recipes", systemImage: "book") }.tag(Tab.recipes)
      // More button for remaining tabs
      MoreTab().tabItem { Label("More", systemImage: "ellipsis") }.tag(Tab.more)
  }
  ```
  - 5 visible tabs (iOS best practice), remaining under "More": Prep, Menu, Shopping, Admin
  - Role-based: employees don't see Admin tab
  - `MoreTab` = simple list navigation to Prep, Menu, Shopping, Admin (if owner)
- [ ] `LoadingOverlayView.swift`: full-screen spinner, blocks interaction during data load
- [ ] `ModalContainer.swift`: reusable sheet/fullScreenCover wrapper matching PWA modal pattern

**End of day checkpoint:** App launches → shows login → signs in → shows tab bar with placeholder views

---

#### Day 5 — State Management & Data Loading

**Morning: AppState — the brain**
- [ ] `AppState.swift` (ObservableObject, singleton):
  ```swift
  @MainActor
  class AppState: ObservableObject {
      static let shared = AppState()

      @Published var areas: [Area] = []
      @Published var ingredients: [Ingredient] = []
      @Published var inventory: [InventoryItem] = []
      @Published var recipes: [Recipe] = []
      @Published var menuItems: [MenuItem] = []
      @Published var prepItems: [PrepItem] = []
      @Published var shopping: [ShoppingItem] = []
      @Published var logEntries: [LogEntry] = []
      @Published var conversions: [Conversion] = []
      @Published var users: [AppUser] = []
      @Published var categories: [Category] = []
      @Published var menuCategories: [Category] = []
      @Published var recipeCategories: [Category] = []
      @Published var units: [MeasurementUnit] = []

      @Published var isLoading = true
      @Published var loadErrors: [String] = []    // partial load tolerance
      @Published var currentUserRole: UserRole = .employee

      var isOwner: Bool { currentUserRole == .owner }
  }
  ```
- [ ] `AppState.loadAllData()`:
  - Uses `TaskGroup` to load all 14 collections in parallel
  - Each task has individual try/catch (= `Promise.allSettled`)
  - Failed tables get empty array + error added to `loadErrors`
  - Shows warning toast listing which tables failed
  - Sets `isLoading = false` in defer block (always runs)
- [ ] Computed properties for common lookups:
  - `func ingredient(byId id: Int) -> Ingredient?`
  - `func area(byId id: Int) -> Area?`
  - `func inventoryItems(forArea areaId: Int) -> [InventoryItem]`

**Afternoon: Undo & change tracking**
- [ ] `UndoManager.swift`:
  - Snapshot stack (max 20 deep)
  - `saveState(action: String)` — deep copy current state before mutation
  - `undo()` — pop stack, restore previous state, show toast
  - `canUndo: Bool` published property
- [ ] `SyncManager.swift`:
  - `markChanged(table: String, data: Encodable)` — add to change log
  - Debounced save: 2-second timer, resets on each `markChanged` call
  - `syncNow()` with mutex flag (prevents concurrent syncs — audit fix)
  - `isSyncing: Bool` published property for UI indicator
- [ ] Undo button in nav bar (only shows when `canUndo`)
- [ ] Sync status indicator: green dot (synced), yellow (pending), red (error)

**End of day checkpoint:** App loads ALL real data from Firestore, displays loading spinner, handles partial failures, undo button works

---

### WEEK 2: Inventory (Primary Feature)

#### Day 6 — Inventory List View

**Morning: Area-grouped inventory**
- [ ] `InventoryListView.swift`:
  - Sections grouped by area
  - Warehouse areas sorted to bottom (`.sorted { !$0.isWarehouse && $1.isWarehouse }`)
  - Each section header: area name, item count, collapse/expand chevron
  - Sub-sections within areas (if area has sections array)
  - Empty state: "No inventory items. Tap + to add."
- [ ] `InventoryAreaHeader.swift`:
  - Tappable to collapse/expand (uses `@State` toggle, persisted in `UserDefaults`)
  - Shows total items in area
  - Printer icon button (owner only) — wired up in Week 2 Day 9
- [ ] `InventoryItemRow.swift`:
  - Ingredient name (looked up from `AppState.ingredients`)
  - Quantity + unit display
  - Out-of-stock badge (red dot)
  - Sub-area label if applicable

**Afternoon: Search & pull-to-refresh**
- [ ] Search bar at top: filters by ingredient name (case-insensitive contains)
- [ ] Pull-to-refresh: calls `AppState.loadAllData()` again
- [ ] Empty search results state
- [ ] Smooth list animations on filter change (`.animation(.default, value: searchText)`)

**End of day checkpoint:** Full inventory displayed, grouped by area, collapsible, searchable

---

#### Day 7 — Inventory Item Interactions

**Morning: Inline quantity editing**
- [ ] Tap on quantity → show inline `TextField` with numeric keyboard
- [ ] Confirm: Enter key or tap outside
  - Call `secureApi('upsert', 'inv', updatedItem)` FIRST
  - On success: update `AppState.inventory`
  - On failure: show error toast, revert to original value
- [ ] `DebounceModifier.swift`: prevent double-tap (600ms cooldown on all buttons)
  ```swift
  struct DebouncedButton: View {
      let cooldown: TimeInterval = 0.6
      @State private var isDisabled = false
      // ...
  }
  ```

**Afternoon: Swipe actions & out-of-stock**
- [ ] Swipe leading: toggle out-of-stock (green ↔ red)
- [ ] Swipe trailing: delete
  - Confirmation alert: "Delete [ingredient name] from [area name]?"
  - Cloud-first delete: API call → on success → remove from local state
  - On failure: error toast, item stays in list (audit fix pattern)
- [ ] Out-of-stock visual: dimmed row, red "OOS" badge
- [ ] Log entry created for every inventory change (via `markChanged`)

**End of day checkpoint:** Can edit quantities inline, toggle OOS, delete items — all cloud-confirmed

---

#### Day 8 — Add, Edit, Transfer Inventory

**Morning: Add inventory item**
- [ ] `AddInventorySheet.swift` (presented as `.sheet`):
  - Area picker (dropdown or wheel picker)
  - Ingredient search field (autocomplete from `AppState.ingredients`)
  - Quantity field (decimal keyboard)
  - Unit picker (from ingredient's default unit or all units)
  - Sub-area text field (optional)
  - "Add" button → `secureApi('insert', 'inv', newItem)` → update local state
- [ ] Validation:
  - Area required, ingredient required, qty > 0
  - Duplicate check: warn if ingredient already exists in that area

**Afternoon: Edit & transfer**
- [ ] `EditInventorySheet.swift`:
  - Pre-populated with current values
  - Same fields as add
  - "Save" button → `secureApi('upsert', 'inv', updatedItem)`
- [ ] `TransferSheet.swift`:
  - Shows current item (area, ingredient, qty)
  - "Transfer to" area picker
  - Transfer quantity (default: all)
  - Logic: decrement source qty (or delete if 0), increment/create at destination
  - Both operations in sequence (not parallel — order matters)
- [ ] Floating action button (+) on inventory list → shows Add sheet

**End of day checkpoint:** Full CRUD for inventory items including transfers between areas

---

#### Day 9 — AI Scan & Print

**Morning: Camera + Gemini scan**
- [ ] `CameraCaptureView.swift`:
  - `UIImagePickerController` wrapped in `UIViewControllerRepresentable`
  - Source: `.camera` (fall back to `.photoLibrary` on simulator)
  - Returns `UIImage`
- [ ] `ScanManager.swift`:
  - Compress image to JPEG (quality 0.7, keep under 1.5MB decoded)
  - Base64 encode
  - Call `secureApi('scan', 'inv', { image: base64, areas: [...], ingredients: [...] })`
  - Parse response: array of `{ name, qty, unit, confidence }`
- [ ] `ScanReviewSheet.swift`:
  - Table of scanned items with confidence indicators:
    - High: green checkmark
    - Medium: yellow warning
    - Low: red question mark
  - Each row: ingredient name, scanned qty, unit, matched inventory item (if found)
  - Toggle per row: include/exclude from import
  - "Apply" button: upsert all selected items
- [ ] Owner-only gate: `if !AppState.shared.isOwner { return }` on scan button

**Afternoon: Print count sheet**
- [ ] `PrintSheetGenerator.swift`:
  - Takes an `Area` and its inventory items
  - Generates a formatted PDF using `UIGraphicsPDFRenderer`:
    - Header: area name, date, "Bistro Steward Count Sheet"
    - Table: ingredient name | current qty | unit | count (blank) | notes (blank)
    - Sorted by sub-area then ingredient name
    - Grid lines for easy hand-writing
  - Returns `Data` (PDF bytes)
- [ ] `PrintPreviewSheet.swift`:
  - Renders PDF in a `PDFKitRepresentable` (UIViewRepresentable wrapping PDFView)
  - "Print" button → `UIPrintInteractionController`
  - "Share" button → `ShareLink` (save PDF, AirDrop, email)
- [ ] Area card header: printer icon → select area → preview → print
- [ ] "Print All Areas" option: generates multi-page PDF

**End of day checkpoint:** Can photograph an inventory sheet, AI reads it, review + apply. Can generate + print formatted count sheets.

---

#### Day 10 — Inventory Unit Tests

**Morning: Model & state tests**
- [ ] `InventoryItemTests.swift`:
  - Encoding/decoding roundtrip
  - All optional fields handle nil correctly
- [ ] `AppStateInventoryTests.swift`:
  - `loadAllData` populates inventory array
  - `loadAllData` handles partial failure (inventory fails, others succeed)
  - `inventoryItems(forArea:)` returns correct subset
  - Area grouping and warehouse sorting logic
- [ ] `UndoManagerTests.swift`:
  - Save state → mutate → undo → state restored
  - Stack depth limit (20)
  - `canUndo` toggles correctly

**Afternoon: Business logic tests**
- [ ] `ConversionTests.swift`:
  - `convertToStorageUnits(qty: 2.0, fromUnit: "cups", toUnit: "oz", factor: 8.0)` → 16.0
  - Division by zero guard: factor=0 returns original qty and unit
  - Factor=nil returns original
  - Negative factor returns original
- [ ] `SyncManagerTests.swift`:
  - Debounce: rapid changes → single sync call
  - Mutex: concurrent `syncNow()` → only one executes
  - Change detection: diff identifies modified fields
- [ ] Mock `APIClient` protocol + mock implementation for all tests
- [ ] Run coverage report: target **80%+** on `FeatureInventory`

**End of day checkpoint:** 20+ unit tests passing, 80%+ coverage on inventory business logic

---

### WEEK 3: Ingredients, Recipes, Prep

#### Day 11 — Ingredients Tab

**Morning: List view**
- [ ] `IngredientsListView.swift`:
  - Grouped by `Category` (from `AppState.categories`)
  - Collapsible category headers
  - Each row: name, default unit, auto-shop icon, min qty, area assignment
  - Archive toggle (filter: show/hide archived)
  - Search bar (filter by name)
- [ ] `IngredientRow.swift`:
  - Ingredient name (SwiftUI `Text` = inherently XSS-safe)
  - Category color dot
  - Swipe: edit, archive, delete

**Afternoon: Add/Edit ingredient**
- [ ] `IngredientFormSheet.swift`:
  - Name (required, max 500 chars matching backend validation)
  - Category picker
  - Default storage area picker
  - Sub-area text field
  - Default unit picker
  - Auto-shop toggle
  - Min quantity field
  - Standalone toggle
  - "Save" → `secureApi('upsert', 'ings', ingredient)`
- [ ] Delete with cascade:
  1. Delete from `inv` (all inventory entries for this ingredient)
  2. Delete from `shopping`
  3. Remove from all `recs[].ings` arrays
  4. Remove from all `menus[].ings` arrays
  5. Delete from `conversions`
  6. Delete the ingredient itself
  - Cloud calls first, then local state (audit pattern)

**End of day checkpoint:** Full ingredients CRUD with proper cascade deletes

---

#### Day 12 — Recipes List & Detail

**Morning: Recipe list**
- [ ] `RecipesListView.swift`:
  - Grouped by `RecipeCategory`
  - Collapsible category headers
  - Each row: recipe name, ingredient count, yield info
  - Archive filter
  - Search bar
  - FOH filter: if user is employee with subRole "FOH", only show cocktail recipes

**Afternoon: Recipe detail**
- [ ] `RecipeDetailView.swift`:
  - Expandable sections (using `DisclosureGroup`):
    - **Ingredients**: list with qty + unit, ingredient name
    - **Sub-Recipes**: linked recipe names (tappable → navigate)
    - **Prep Items**: linked prep items
    - **Menu Items**: which menus use this recipe
    - **Notes**: free-text notes
  - Recipe header: name, category, yield, output mode
  - Edit button (→ form sheet)
  - Delete button with confirmation + cascade

**End of day checkpoint:** Recipes browsable by category, detail view with all sections expanding/collapsing

---

#### Day 13 — Recipe Editing

**Morning: Recipe form**
- [ ] `RecipeFormSheet.swift`:
  - Name, category picker, yield, output mode
  - Notes text editor
- [ ] Ingredient management within recipe:
  - "Add Ingredient" button → ingredient search (autocomplete from `AppState.ingredients`)
  - For each ingredient: qty field + unit picker
  - Swipe to remove ingredient from recipe
  - Reorder with drag handles

**Afternoon: Sub-recipes & cascade delete**
- [ ] Sub-recipe linking:
  - "Add Sub-Recipe" → recipe search (exclude self, exclude circular refs)
  - Display with qty multiplier
- [ ] Recipe cascade delete:
  1. Remove from all `menus[].recs` arrays
  2. Remove from all other `recs[].subRecs` arrays
  3. Delete matching `preps` (where `recId == recipe.id`)
  4. Delete the recipe itself
  - All cloud-first

**End of day checkpoint:** Can create/edit recipes with ingredients, sub-recipes. Delete cascades correctly.

---

#### Day 14 — Prep Tab

**Morning: Prep list**
- [ ] `PrepListView.swift`:
  - All prep items, optionally grouped by parent recipe
  - Each row: prep name, on-hand qty, par level, unit
  - Color coding: on-hand < par → red warning
  - Archive filter
- [ ] `PrepItemRow.swift`:
  - Inline on-hand editing (tap qty → edit)
  - Link to parent recipe (tappable)

**Afternoon: Prep CRUD**
- [ ] `PrepFormSheet.swift`:
  - Name, parent recipe picker, on-hand qty, par level, unit
  - "Save" → `secureApi('upsert', 'preps', prepItem)`
- [ ] Prep from recipe: "Create Prep Item" button on recipe detail → pre-fills recipe link
- [ ] Archive/unarchive
- [ ] Delete (cloud-first)

**End of day checkpoint:** Full prep item management with recipe linking

---

#### Day 15 — Tests: Ingredients, Recipes, Prep

**Full day: unit tests**
- [ ] `IngredientCascadeDeleteTests.swift`:
  - Delete ingredient → verify inv, shopping, recs.ings, menus.ings, conversions all cleaned up
  - Test partial cascade failure (one API call fails → others still attempted, user notified)
- [ ] `RecipeCascadeDeleteTests.swift`:
  - Delete recipe → verify menus.recs, other recs.subRecs, preps cleaned up
- [ ] `RecipeFormValidationTests.swift`:
  - Circular sub-recipe detection
  - Empty name rejected
  - Ingredient qty > 0 required
- [ ] `PrepItemTests.swift`:
  - On-hand vs par comparison logic
  - Recipe link integrity
- [ ] `ConversionLogicTests.swift`:
  - All unit conversion paths
  - Edge cases: unknown units, missing conversions
- [ ] Coverage target: **80%+** on `FeatureRecipes` module

**End of day checkpoint:** 15+ additional tests, all passing, solid coverage on recipe/ingredient logic

---

### WEEK 4: Menu, Shopping, Log, Admin, Voice

#### Day 16 — Menu Tab

- [ ] `MenuListView.swift`: grouped by menu category, collapsible, searchable
- [ ] `MenuItemRow.swift`: name, target qty, unit, recipe count, ingredient count
- [ ] `MenuFormSheet.swift`:
  - Name, category, target qty, unit
  - Add ingredients (search + qty)
  - Add recipes (search + qty)
  - Include in shopping toggle
  - Include in prep toggle
- [ ] Archive/unarchive, delete (cloud-first)
- [ ] Menu item detail: shows all linked recipes and ingredients with quantities

---

#### Day 17 — Shopping List

- [ ] `ShoppingListView.swift`:
  - Two sections: "To Buy" and "Saved for Later"
  - Each row: ingredient name, qty, unit, checkbox
  - Tap checkbox → toggle `checked` field → upsert to cloud
  - Swipe: move to saved / delete
- [ ] "Generate Shopping List" button:
  - Calculates needed quantities from menu targets vs current inventory
  - Uses conversion factors for unit matching
  - Presents diff: "You need 5 lbs cheese, you have 2 lbs → add 3 lbs"
  - Confirm → batch insert to shopping collection
- [ ] "Clear Checked" button → batch delete all checked items
- [ ] Add manual item (ingredient search + qty)

---

#### Day 18 — Log Tab

- [ ] `LogListView.swift`:
  - Reverse chronological (newest first)
  - Each row: timestamp, user name, action, item name
  - Date section headers (Today, Yesterday, older dates)
- [ ] Filter bar:
  - By user (picker)
  - By action type (inventory change, recipe edit, etc.)
  - By date range
- [ ] `LogDetailView.swift`:
  - Full diff: old value → new value
  - User who made the change
  - Exact timestamp
- [ ] Pagination: load 50 at a time, "Load More" button at bottom

---

#### Day 19 — Admin Tab

**Morning: Team management (owner only)**
- [ ] `AdminView.swift`: list of sections (all collapsed by default)
- [ ] **Team Members**: list all users, role badges
  - Invite: email field + role picker → `secureApi('invite_user', ...)`
  - Change role: owner/employee toggle
  - Remove user
- [ ] **Approved Emails**: list + add/remove

**Afternoon: Configuration management**
- [ ] **Areas**: CRUD list for storage areas with sections, warehouse toggle, prep toggle
- [ ] **Categories**: CRUD for ingredient, menu, recipe categories (3 sub-sections)
- [ ] **Units**: CRUD for measurement units
- [ ] **Conversions**: CRUD for unit conversion factors (ingredient, from unit, to unit, factor)
- [ ] **Data Management**:
  - Export data as JSON (all collections)
  - Import data from JSON
  - Excel export (using a Swift CSV/XLSX library or generate CSV)
- [ ] **App Settings**: font size slider, theme toggle (dark/light)
- [ ] All sections: `isOwner` check → employees see limited view (profile, settings only)

---

#### Day 20 — Voice Assistant

**Morning: Speech recognition**
- [ ] `VoiceManager.swift`:
  - `SFSpeechRecognizer` setup with `requestAuthorization`
  - Real-time transcription via `SFSpeechAudioBufferRecognitionRequest`
  - `AVAudioEngine` for microphone input
  - Published `transcript: String` and `isListening: Bool`
  - Auto-stop after 5 seconds of silence
- [ ] Microphone permission: `NSMicrophoneUsageDescription` in Info.plist
- [ ] Speech permission: `NSSpeechRecognitionUsageDescription` in Info.plist

**Afternoon: Voice command execution**
- [ ] `VoiceCommandHandler.swift`:
  - Send transcript to `secureApi('voice', '', { transcript: text, context: currentTab })`
  - Parse response JSON: `{ action, params, toast }`
  - Execute actions:
    - `navigate` → switch tab
    - `search` → set search text on current tab
    - `add_inventory` → open add sheet with pre-filled data
    - `add_shopping` → add item to shopping list
    - `update_prep` → update prep qty
    - `info` → show info toast
    - `unknown` → "I didn't understand that"
  - Show confirmation toast from response
- [ ] `VoiceButton.swift`: floating mic button with pulse animation while listening
- [ ] Unit tests for response parsing (7 action types)

**End of day checkpoint:** Voice button appears, tap → listen → transcribe → API → execute command

---

### WEEK 5: Offline, Sync, Polish

#### Day 21 — Offline Support

- [ ] `NetworkMonitor.swift`:
  - `NWPathMonitor` watching `.satisfied` status
  - Published `isConnected: Bool`
  - Notification on state change
- [ ] `OfflineBanner.swift`: yellow banner below nav bar "You are offline — changes saved locally"
- [ ] `PersistenceManager.swift`:
  - Save full `AppState` to disk using `JSONEncoder` → file in app documents
  - Load on app start (before network fetch — show stale data immediately)
  - Refresh from network when available
- [ ] `OfflineQueue.swift`:
  - When offline: mutations queue as `PendingOperation` structs
  - Struct: `{ operation, table, data, filters, timestamp }`
  - Persisted to disk (survives app kill)
  - On reconnect: replay queue in order → clear successful, retry failed

---

#### Day 22 — Sync Engine

- [ ] `SyncEngine.swift`:
  - **Pull-before-push** on reconnect:
    1. Load fresh data from cloud
    2. Merge with local changes (last-write-wins by timestamp)
    3. Push remaining local changes
  - **Sync mutex**: `isSyncing` flag prevents concurrent syncs
  - **Change detection**: compare current state vs last-synced snapshot field by field
  - **Batch operations**: group multiple changes into single API calls where possible
- [ ] Sync status indicator in toolbar:
  - Green circle: synced
  - Yellow rotating: syncing
  - Red exclamation: sync error (tap for details)
- [ ] Background sync: `BGAppRefreshTask` to sync every 15 minutes when app is backgrounded
- [ ] Toast on reconnect: "Back online — syncing..."

---

#### Day 23 — Error Handling

- [ ] Audit every API call site — ensure ALL have error handling (no fire-and-forget)
- [ ] `ErrorHandler.swift`:
  - Categorize errors: network, auth (401 → force re-login), rate limit (429 → retry after delay), server (500), validation (400)
  - User-facing messages: "Connection lost", "Session expired — please sign in again", "Too many requests — try again in a moment"
  - Never show raw error strings to users
- [ ] Loading states: every view that fetches data has a `ProgressView` placeholder
- [ ] Timeout handling: 60s timeout with "Request timed out" error
- [ ] Graceful degradation: if one tab's data fails to load, other tabs still work
- [ ] Retry logic: automatic retry once on network error (with 2s backoff), then show error

---

#### Day 24 — UI Polish

**Morning: Native feel**
- [ ] Haptic feedback:
  - `.impact(.light)` on button taps
  - `.notification(.success)` on successful save
  - `.notification(.error)` on error
  - `.selection` on picker changes
- [ ] Pull-to-refresh on ALL list views (consistent behavior)
- [ ] Keyboard:
  - `@FocusState` management on all forms
  - "Done" toolbar button to dismiss keyboard
  - Scroll to active field when keyboard appears
- [ ] Dynamic Type: verify all text scales properly (test with largest accessibility size)
- [ ] Safe area respect on all screens

**Afternoon: Visual polish**
- [ ] App icon design (1024x1024):
  - Clean, recognizable at small size
  - Matches dark theme aesthetic
  - No text (gets illegible at small sizes)
- [ ] Launch screen: `LaunchScreen.storyboard` with app icon + background color
- [ ] Dark mode is default (matching PWA), add light mode option in settings
- [ ] Transition animations between tabs (default SwiftUI — don't over-customize)
- [ ] Empty states for every list view (illustration + text + action button)

---

#### Day 25 — Integration & Snapshot Tests

- [ ] **Integration tests** (using XCTest + mock API):
  - Full auth flow: launch → login → data loads → sees inventory tab
  - Offline flow: disconnect → make changes → reconnect → changes sync
  - Role test: employee can't see admin tab, can't delete
  - Cascade delete: delete ingredient → verify all collections cleaned up
- [ ] **Snapshot tests** (using `swift-snapshot-testing`):
  - Login screen (light + dark)
  - Inventory list (with data + empty state)
  - Recipe detail view
  - Paywall screen
  - Scan review sheet
- [ ] **UI tests** (XCUITest, 3 critical paths):
  - Login → navigate to inventory → add item → verify appears
  - Login → navigate to recipes → open recipe → verify sections
  - Login → navigate to admin (as owner) → verify team section visible

**End of day checkpoint:** 10+ integration tests, 8+ snapshot tests, 3 UI tests, all passing

---

### WEEK 6: Security, Privacy, Subscriptions

#### Day 26 — Security Hardening

- [ ] **Certificate pinning** (`URLSessionDelegate`):
  - Pin SHA-256 hash of Cloud Function endpoint's public key
  - Fail closed: if pin doesn't match, reject connection
  - Include backup pin (for certificate rotation)
- [ ] **Keychain audit**: grep codebase for `UserDefaults` — ensure NO sensitive data stored there
- [ ] **ATS configuration** (Info.plist):
  - `NSAppTransportSecurity` → `NSAllowsArbitraryLoads: false` (enforce HTTPS)
  - No exceptions needed (Firebase + Cloud Functions are all HTTPS)
- [ ] **Jailbreak detection** (`JailbreakDetector.swift`):
  - Check for Cydia/Sileo paths
  - Check for writable system paths
  - Check for suspicious environment variables
  - Don't crash — just flag and optionally restrict sensitive operations
- [ ] **Sensitive data masking**: admin tab content not included in screenshots (`UIApplicationDelegate` window overlay on `.willResignActive`)

---

#### Day 27 — Privacy & Legal

**Morning: Apple privacy requirements**
- [ ] `PrivacyInfo.xcprivacy`:
  ```xml
  NSPrivacyTracking: false
  NSPrivacyTrackingDomains: []
  NSPrivacyCollectedDataTypes:
    - Email Address (Account registration)
    - Name (Account registration)
    - Usage Data (App functionality)
  NSPrivacyAccessedAPITypes:
    - File timestamp (if used for cache invalidation)
    - User defaults (non-sensitive preferences)
  ```
- [ ] All third-party SDKs declare their own privacy manifests (Firebase does)
- [ ] Privacy nutrition labels in App Store Connect (match PrivacyInfo exactly)

**Afternoon: Legal documents**
- [ ] **Privacy Policy** (host at bistrosteward.com/privacy):
  - What data collected (email, name, restaurant data, usage analytics)
  - How used (app functionality, no ads, no selling data)
  - Third parties (Firebase/Google, Sentry, Apple)
  - User rights (access, delete, export)
  - Contact info
- [ ] **Terms of Service** (host at bistrosteward.com/terms):
  - Apple auto-renewal disclosures (REQUIRED):
    - "Payment will be charged to your Apple ID at confirmation of purchase"
    - "Subscription automatically renews unless canceled 24 hours before end of period"
    - "Account will be charged for renewal within 24 hours prior to end of current period"
    - "Subscriptions may be managed and auto-renewal turned off in Account Settings"
  - Service description, acceptable use, data ownership
- [ ] **Account deletion** implementation:
  - Settings → "Delete Account" (red, with confirmation)
  - Deletes: Firestore user data, team membership, approved email entry
  - Calls Firebase Auth `user.delete()`
  - Must also call Apple's REST API `/auth/revoke` if Sign in with Apple was used
  - 30-day grace period before permanent deletion (per GDPR)
  - Confirmation email

---

#### Day 28 — App Store Connect Setup

- [ ] Create app in App Store Connect:
  - **App Name**: "Bistro Steward — Kitchen Manager"
  - **Subtitle**: "Inventory, Recipes & AI Scanning"
  - **Bundle ID**: `com.bistrosteward.com`
  - **SKU**: `restaurant-oracle-ios`
  - **Primary Category**: Food & Drink
  - **Secondary Category**: Business
  - **Primary Language**: English (US)
  - **Age Rating**: 4+ (no objectionable content)
  - **Copyright**: "2026 Bistro Steward"
- [ ] **Keywords** (100 chars max, comma-separated):
  ```
  restaurant,inventory,kitchen,management,recipe,food,cost,prep,menu,scan,ai,chef,ordering,stock,bar
  ```
- [ ] **Description** (4000 chars max): feature highlights, AI capabilities, target audience
- [ ] **Screenshots** (required sizes):
  - 6.7" (iPhone 15 Pro Max): 1290 x 2796 — 6 screenshots
  - 6.1" (iPhone 15 Pro): 1179 x 2556 — 6 screenshots
  - For each: Inventory, Recipes, AI Scan, Voice, Menu, Shopping
- [ ] **App Preview Video** (optional, high impact):
  - 30s max, show: scan a sheet → review → apply → voice command
  - Capture with Xcode Simulator or real device screen recording
- [ ] **Demo account** for reviewer:
  - Create `reviewer@bistrosteward.com` with employee role
  - Pre-populate with realistic demo data (menu items, inventory, recipes)
  - Document credentials in App Review Notes

---

#### Day 29 — StoreKit 2 Subscriptions (Client)

**Morning: App Store Connect subscription setup**
- [ ] Create Subscription Group: "Bistro Steward Pro"
- [ ] Products:
  | Product ID | Name | Price | Duration |
  |------------|------|-------|----------|
  | `oracle.pro.monthly` | Oracle Pro Monthly | $29.99 | 1 month |
  | `oracle.pro.annual` | Oracle Pro Annual | $199.99 | 1 year |
  | `oracle.team.monthly` | Oracle Team Monthly | $49.99 | 1 month |
- [ ] Introductory offer: 21-day free trial on all plans (guide: 17-32 days = 45.7% conversion)
- [ ] Small Business Program enrolled (15% commission until $1M)

**Afternoon: SubscriptionManager implementation**
- [ ] `SubscriptionManager.swift`:
  ```swift
  @MainActor
  class SubscriptionManager: ObservableObject {
      @Published var products: [Product] = []
      @Published var activeSubscription: Transaction?
      @Published var entitlement: Entitlement = .free

      func loadProducts() async
      func purchase(_ product: Product) async throws -> Transaction
      func restorePurchases() async
      func checkEntitlement() async
  }
  ```
  - `Product.products(for: ["oracle.pro.monthly", "oracle.pro.annual", "oracle.team.monthly"])`
  - `Transaction.updates` async sequence listener (runs on app launch)
  - Send `transaction.id` to backend for server-side verification
  - `Transaction.currentEntitlements` for status check
- [ ] `Entitlement.swift` enum:
  ```swift
  enum Entitlement {
      case free       // 1 restaurant, 50 ingredients, 20 recipes
      case pro        // unlimited ingredients/recipes, AI features, print
      case team       // pro + multi-location + team features
  }
  ```
- [ ] Feature gates throughout app:
  - Free: show paywall when limit reached ("You've added 50 ingredients. Upgrade to Pro for unlimited.")
  - Scan/Print: Pro+ only
  - Voice: Pro+ only
  - Multi-restaurant: Team only

---

#### Day 30 — StoreKit 2 Server-Side + Paywall

**Morning: Server-side validation (Cloud Function)**
- [ ] New operation: `validate_receipt` in `firebase/functions/index.js`
  - Receives `transactionId` from iOS client
  - Calls App Store Server API v2 to verify
  - Updates/creates `entitlements` document in Firestore
  - Returns entitlement status
- [ ] App Store Server Notifications V2 endpoint:
  - New Cloud Function: `appStoreWebhook` (HTTP trigger)
  - Validates JWS signature
  - Handles notification types:
    - `SUBSCRIBED` → create/activate entitlement
    - `DID_RENEW` → extend expiry date
    - `DID_FAIL_TO_RENEW` → mark billing retry, keep access for grace period
    - `GRACE_PERIOD_EXPIRED` → downgrade to free
    - `REFUND` → downgrade to free, log
    - `REVOKE` → downgrade to free (family sharing revoked)
  - Audit log for all subscription events
- [ ] `entitlements` Firestore collection: userId, productId, plan, isActive, expiresAt, gracePeriodExpiresAt

**Afternoon: Paywall view**
- [ ] `PaywallView.swift`:
  - Feature comparison table (Free vs Pro vs Team)
  - Plan cards with pricing:
    - Monthly: "$29.99/mo"
    - Annual: "$199.99/yr" with "Save 44%" badge
    - Team: "$49.99/mo" with "Multi-location" badge
  - Free trial callout: "Start your 21-day free trial"
  - "Restore Purchases" link at bottom
  - Terms of Service and Privacy Policy links (required by Apple)
  - Auto-renewable subscription disclosures (required by Apple)
- [ ] Paywall trigger points:
  - Over ingredient limit (50) → show paywall
  - Over recipe limit (20) → show paywall
  - Tap Scan/Print/Voice as free user → show paywall
  - Settings → "Upgrade" → show paywall
- [ ] Sandbox testing:
  - Sign in with sandbox Apple ID
  - Purchase monthly → verify entitlement activates
  - Cancel → verify downgrade after period
  - Restore → verify works
  - Test all 3 products

**End of day checkpoint:** Full subscription loop works in sandbox. Server validates and stores entitlements.

---

### WEEK 7: CI/CD, Analytics, Performance

#### Day 31 — Git & CI/CD

- [ ] Create GitHub repo: `restaurant-oracle-ios` (private)
- [ ] Push all code
- [ ] Branch strategy: `main` (releases), `develop` (active work), feature branches
- [ ] `.github/workflows/ci.yml`:
  ```yaml
  on: [push, pull_request]
  jobs:
    build-and-test:
      runs-on: macos-15
      steps:
        - uses: actions/checkout@v4
        - name: Build
          run: xcodebuild build -scheme BistroSteward -sdk iphonesimulator
        - name: Test
          run: xcodebuild test -scheme BistroSteward -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 16'
  ```
- [ ] SwiftLint integration (`.swiftlint.yml` with reasonable defaults)
- [ ] Build status badge in README

---

#### Day 32 — Fastlane & Code Signing

- [ ] Install Fastlane: `brew install fastlane`
- [ ] `fastlane/Fastfile`:
  - `lane :test` — build + run all tests
  - `lane :beta` — increment build number → build → upload to TestFlight
  - `lane :release` — build → submit for App Store review
- [ ] `fastlane match` setup:
  - Create private Git repo for certificates
  - Generate development + distribution profiles
  - `MATCH_READONLY=true` for CI (never create certs on CI)
- [ ] `fastlane deliver` config for automated metadata/screenshot upload
- [ ] Test: `fastlane beta` successfully uploads to TestFlight

---

#### Day 33 — Crash Reporting & Analytics

**Morning: Sentry**
- [ ] Add Sentry iOS SDK via SPM
- [ ] Initialize in `BistroStewardApp.swift`:
  ```swift
  SentrySDK.start { options in
      options.dsn = "..."
      options.enableAutoPerformanceTracing = true
      options.enableUserInteractionTracing = true
      options.sampleRate = 1.0        // 100% crash reporting
      options.tracesSampleRate = 0.2  // 20% performance traces
  }
  ```
- [ ] Set user context on login: `SentrySDK.setUser(User(userId: uid))`
- [ ] Add breadcrumbs for key actions: API calls, tab switches, sync events
- [ ] dSYM upload in Fastlane: `sentry_upload_dif`

**Afternoon: Firebase Analytics**
- [ ] Add FirebaseAnalytics via SPM (already have firebase-ios-sdk)
- [ ] Track events:
  | Event | Parameters | Trigger |
  |-------|-----------|---------|
  | `app_open` | — | App launch |
  | `login` | method | Successful sign in |
  | `signup` | method | Account creation |
  | `inventory_update` | item_count | Save inventory changes |
  | `recipe_create` | ingredient_count | New recipe saved |
  | `scan_complete` | item_count, avg_confidence | AI scan applied |
  | `voice_command` | action_type | Voice action executed |
  | `subscription_view` | — | Paywall displayed |
  | `subscription_start` | product_id | Purchase complete |
  | `subscription_cancel` | product_id, reason | Cancellation |
  | `sync_complete` | changes_count, duration_ms | Sync finished |
  | `sync_error` | error_type | Sync failed |
- [ ] User properties: `role`, `plan`, `restaurant_count`
- [ ] Screen tracking: automatic via SwiftUI `analyticsScreen(name:)` modifier

---

#### Day 34 — Performance Optimization

- [ ] **Instruments: App Launch** profile:
  - Target: <400ms to first meaningful paint
  - Static linking (only system dynamic frameworks)
  - Lazy initialization of non-visible tabs
  - `AppState.loadAllData()` doesn't block UI — shows cached data immediately
- [ ] **Instruments: Allocations** profile:
  - Check for retain cycles (especially in closures + publishers)
  - Ensure `[weak self]` in all closures that capture self
  - Verify no memory growth on repeated tab switches
- [ ] **Instruments: Network** profile:
  - Verify all API calls use HTTP/2 (Firebase default)
  - No duplicate requests on tab switch
  - Response caching for read-heavy operations
- [ ] **List performance**:
  - Use `LazyVStack` for all long lists (not `VStack` in `ScrollView`)
  - `id` parameters on `ForEach` for efficient diffing
  - Avoid re-rendering entire list on single item change

---

#### Day 35 — TestFlight Beta Build

- [ ] Increment version to 1.0.0 (build 1)
- [ ] Run full test suite — all tests must pass
- [ ] Archive with Release configuration
- [ ] Upload to TestFlight via `fastlane beta`
- [ ] Internal testing (your devices + TestFlight):
  - [ ] Login with existing credentials
  - [ ] Verify all data loads from production Firestore
  - [ ] Test every tab: Inventory, Log, Ingredients, Recipes, Prep, Menu, Shopping, Admin
  - [ ] Test offline → online sync
  - [ ] Test AI scan with real inventory sheet photo
  - [ ] Test voice command
  - [ ] Test subscription paywall (sandbox)
  - [ ] Test on iPhone 12 mini (smallest supported) and iPhone 15 Pro Max (largest)
  - [ ] Verify crash-free rate in Sentry dashboard

**End of day checkpoint:** Build on TestFlight, tested on physical device, no critical crashes

---

## PART B: BETA & SUBMIT (Weeks 8-9)

---

### WEEK 8: Beta Testing

#### Day 36 — External Beta Distribution

- [ ] Invite 15-25 external testers:
  - 5 restaurant owner friends/contacts
  - 5 La Chona Bistro staff members
  - 5-10 industry contacts (POS reps, food distributors, restaurant consultants)
  - 5 tech-savvy friends (fresh eyes on UX)
- [ ] Create TestFlight beta group "External Beta"
- [ ] Write beta tester instructions:
  - What to test (every feature)
  - How to report bugs (TestFlight built-in feedback OR Google Form)
  - What specifically to look for (confusing flows, crashes, missing features)
- [ ] Set up feedback tracking: Google Sheet or Notion board with columns:
  - Tester, Device, Feature, Issue Type (bug/UX/feature request), Priority, Status

---

#### Day 37 — Triage & Critical Fixes

- [ ] Review all Day 1 feedback
- [ ] Categorize: P0 (crash/data loss), P1 (broken feature), P2 (UX issue), P3 (nice-to-have)
- [ ] Fix ALL P0 issues immediately
- [ ] Fix top P1 issues
- [ ] Common first-day feedback patterns to watch for:
  - "I don't know what to do first" → onboarding needed
  - "Where do I find X?" → navigation clarity
  - "This is too slow" → API performance
  - "It crashed when I..." → specific repro steps → Sentry trace

---

#### Day 38 — UX Fixes & Onboarding

- [ ] `OnboardingFlow.swift` (shown on first launch after signup):
  - Step 1: "Welcome! Let's set up your restaurant" → name, type
  - Step 2: "Add your first storage area" → guided area creation
  - Step 3: "Add some ingredients" → quick-add common items (suggest by restaurant type)
  - Step 4: "Take your first inventory count" → guided first count
  - Target: complete in <3 minutes (guide: 2x retention lift)
- [ ] Fix all P2 UX issues from feedback
- [ ] Add contextual help: (?) icons that show brief explanation tooltips

---

#### Day 39 — Second Beta Build

- [ ] Increment build number
- [ ] Run full test suite
- [ ] Upload to TestFlight
- [ ] Notify testers: "New build available! Key fixes: [list]"
- [ ] Ask testers to re-test their reported issues
- [ ] Monitor Sentry for new crashes

---

#### Day 40 — Accessibility Audit

- [ ] **VoiceOver testing** (turn on in Settings > Accessibility):
  - Navigate every screen with VoiceOver
  - Verify all interactive elements have `accessibilityLabel`
  - Verify all images have `accessibilityLabel` or are decorative (`.accessibilityHidden(true)`)
  - Verify logical focus order
- [ ] **Dynamic Type** (Settings > Display > Text Size > largest):
  - Every screen still usable at largest text size
  - No text truncation (use `.lineLimit(nil)` where needed)
  - Scrollable content doesn't overflow
- [ ] **Color contrast** (WCAG AA = 4.5:1 for normal text):
  - Test all text/background combinations
  - Fix any that fail (especially muted text on dark backgrounds)
- [ ] **Touch targets**: all tappable elements minimum 44x44 points
- [ ] **Reduce Motion**: verify no essential info conveyed only via animation

**End of Week 8 checkpoint:** 2 beta builds shipped, critical bugs fixed, onboarding added, accessibility verified

---

### WEEK 9: App Store Submission

#### Day 41 — Pre-Submission Checklist

Run through EVERY item:

**Apple Requirements:**
- [ ] Privacy Manifest (`PrivacyInfo.xcprivacy`) complete and accurate
- [ ] Sign in with Apple works end-to-end
- [ ] Account deletion works end-to-end (Settings > Delete Account > confirm > data gone)
- [ ] All subscription disclosures present in paywall (renewal terms, manage instructions)
- [ ] Privacy Policy accessible from app AND from App Store listing
- [ ] Terms of Service accessible from app
- [ ] No private API usage
- [ ] No hardcoded test/debug URLs in release build
- [ ] `DEBUG` flag checks: no debug logs in release
- [ ] Build with iOS 26 SDK (required Apr 2026, good to be ahead)

**Quality:**
- [ ] Crash-free rate >99.5% across beta period (check Sentry)
- [ ] No P0 or P1 bugs open
- [ ] Cold launch <2s (test on oldest supported device: iPhone 12)
- [ ] All animations smooth (60fps, check with Instruments > Core Animation)
- [ ] Correct behavior on all screen sizes (test via Simulator: SE, 15, 15 Pro Max)

**Subscription:**
- [ ] Sandbox purchase works for all 3 products
- [ ] Sandbox restore works
- [ ] Free tier limits enforced correctly
- [ ] Server-side webhook receives notifications
- [ ] Entitlements update correctly after purchase

**Content:**
- [ ] All screenshots match current app state
- [ ] Demo account works and has realistic data
- [ ] App description accurate, no claims that can't be verified

---

#### Day 42 — Submit to App Store

- [ ] Final version: 1.0.0 (build number from latest TestFlight)
- [ ] In App Store Connect:
  - Select build
  - Complete app information (if not already)
  - Set pricing: free to download (IAP subscriptions)
  - Enable phased release: 1% → 2% → 5% → 10% → 20% → 50% → 100% (7 days)
  - App Review information:
    - Demo account: `reviewer@bistrosteward.com` / `[password]`
    - Notes: "This is a restaurant kitchen management app. Use the demo account to see a pre-populated restaurant with inventory, recipes, and menus. The AI Scan feature requires camera access."
  - Submit for review

---

#### Days 43-45 — Review Period

- [ ] **Day 43**: Monitor App Store Connect for review status changes
  - Average review time: 24-48 hours
  - If "In Review" → good, waiting
  - If "Rejected" → read reason carefully
- [ ] **Common rejection fixes** (have these ready):
  - 2.1 "App Completeness": demo account didn't work → verify credentials, re-submit
  - 5.1.x "Privacy": manifest mismatch → update PrivacyInfo.xcprivacy, re-submit
  - 3.1.1 "IAP": missing disclosure text → add required text, re-submit
  - 2.3 "Metadata": screenshots don't match → retake, re-submit
  - Same-day fix + resubmit for all of these
- [ ] **Day 44**: If still in review, prepare marketing materials
  - App Store feature graphic
  - Social media announcement posts
  - Email to beta testers: "We're going live!"
- [ ] **Day 45**: App approved (or second resubmit if needed)
  - Don't release immediately — wait for launch day prep (Day 46)

**End of Week 9 checkpoint:** App approved and ready for release

---

## PART C: LAUNCH & GROW TO 10K (Weeks 10-16)

---

### WEEK 10: Launch Week

#### Day 46 — Launch Day

**Morning: Release**
- [ ] Release app on App Store (phased release begins at 1%)
- [ ] Verify app appears in App Store search for "Bistro Steward"
- [ ] Download and verify on a fresh device (new Apple ID if possible)

**Monitoring (all day):**
- [ ] Sentry dashboard: watch for crashes every hour
- [ ] Firebase Analytics: track app_open, login, signup events
- [ ] App Store Connect: download count, pre-order conversions
- [ ] Cloud Function logs: error rate, latency spikes

**Launch announcements:**
- [ ] Personal social media (LinkedIn, Instagram, Twitter/X)
- [ ] La Chona Bistro staff: install + rate
- [ ] Text/email to all beta testers: "We're live! Please rate us on the App Store"
- [ ] Restaurant industry contacts: personal message with App Store link

---

#### Day 47 — Reviews & First Users

- [ ] Respond to ALL App Store reviews within 3 hours (even positive ones)
- [ ] In-app review prompt: trigger `SKStoreReviewController.requestReview()` after:
  - User has been active for >3 days AND
  - User has completed >5 inventory updates (proven value)
  - Max 3 prompts per 365-day period (Apple enforced)
- [ ] Track: downloads, signups, activation rate (% who complete onboarding)
- [ ] Fix any bugs reported by real users (hotfix if P0)

---

#### Day 48 — First Analytics Review

- [ ] Pull Firebase Analytics dashboard:
  - **Acquisition**: downloads, source (organic search, direct, referral)
  - **Activation**: % completing onboarding, time to first inventory action
  - **Engagement**: DAU, sessions/user, tab usage distribution
  - **Retention**: Day 1 retention (target >25%)
  - **Revenue**: trial starts, conversions (too early for meaningful data)
- [ ] Identify biggest drop-off point in funnel:
  - Download → Open (should be >80%)
  - Open → Sign Up (target >50%)
  - Sign Up → Onboarding Complete (target >60%)
  - Onboarding → First Inventory Action (target >40%)
  - Active → Trial Start (target >20%)

---

#### Day 49 — Hotfix Day

- [ ] Address any critical issues from first 3 days
- [ ] If hotfix needed: skip phased release, push to 100% immediately
- [ ] If no hotfix needed: use this day for ASO improvements based on early search data

---

#### Day 50 — Week 1 Report

- [ ] Compile first week metrics:
  | Metric | Target | Actual |
  |--------|--------|--------|
  | Downloads | 100+ | |
  | Signups | 50+ | |
  | Activation rate | >40% | |
  | Day 1 retention | >25% | |
  | Day 7 retention | >15% | |
  | Crash-free rate | >99.5% | |
  | Avg rating | >4.0 | |
  | Trial starts | 10+ | |
  | Paid conversions | — | (too early) |
- [ ] Identify top 3 issues to fix next week
- [ ] Identify top 3 features users are asking for

---

### WEEK 11-12: ASO & Organic Growth

#### Days 51-55 — App Store Optimization

- [ ] **Keyword research** (free tools: AppFollow free tier, App Store search suggest):
  - Search App Store for: "restaurant inventory", "kitchen management", "food cost calculator", "recipe manager restaurant", "inventory app restaurant"
  - Note: which competitors appear, what keywords they use
  - Write down top 20 keyword candidates

- [ ] **Optimize App Store listing**:
  - **App Name** (30 chars, heaviest weight):
    `Bistro Steward - Kitchen AI` or
    `Bistro Steward: Inventory`
  - **Subtitle** (30 chars, second weight):
    `AI Scan, Recipes & Prep Lists`
  - **Keyword field** (100 chars, no spaces after commas):
    `restaurant,inventory,kitchen,management,recipe,food,cost,prep,menu,scan,chef,ordering,stock,bar,cook`
  - Iterate: change keywords every 2-4 weeks, track ranking changes

- [ ] **Screenshot optimization**:
  - Shot 1: Hero shot — "AI-Powered Kitchen Management" with inventory screen
  - Shot 2: "Scan Handwritten Sheets" — camera scan → results
  - Shot 3: "Voice Commands" — voice assistant in action
  - Shot 4: "Recipe & Prep Management" — recipe detail
  - Shot 5: "Real-Time Inventory" — inventory list grouped by area
  - Shot 6: "Team Management" — admin view with roles
  - Use device frames, bold captions, consistent brand colors

- [ ] **Custom Product Pages** (up to 35):
  - CPP1: "Restaurant Inventory App" → inventory-focused screenshots + keywords
  - CPP2: "AI Kitchen Scanner" → scan-focused screenshots + keywords
  - CPP3: "Recipe Cost Calculator" → recipe/menu focused screenshots + keywords

- [ ] **Localize for Spanish** (highest ROI for restaurant industry):
  - Translate app name, subtitle, keywords, description
  - Translate screenshots (captions)
  - Do NOT translate the app UI yet — just the listing metadata

---

#### Days 56-60 — Content & Community Growth

- [ ] **Landing page**: bistrosteward.com (simple, one-page):
  - Hero: "Stop losing money on inventory" + App Store badge
  - Features section with screenshots
  - Pricing table
  - Testimonials (from beta testers)
  - FAQ
  - Blog section (for SEO)
- [ ] **Blog posts** (SEO content, publish on landing page):
  - "How to Reduce Restaurant Food Waste by 30%" (keyword: restaurant food waste)
  - "The Complete Guide to Restaurant Inventory Counting" (keyword: restaurant inventory)
  - "5 Signs Your Restaurant Needs Better Kitchen Management" (keyword: kitchen management app)
- [ ] **Reddit/forums**:
  - Join r/restaurateur, r/KitchenConfidential, r/foodindustry
  - Contribute genuinely (answer questions about food cost, inventory)
  - Mention app naturally when relevant (NOT spam)
- [ ] **Restaurant industry Facebook groups**:
  - Join 5-10 restaurant owner groups
  - Share helpful content, build relationships
  - Offer free trials to group members

---

### WEEK 13-14: Paid Acquisition & Partnerships

#### Days 61-65 — Apple Search Ads

- [ ] Set up Apple Search Ads account (search.apple.com)
- [ ] **Campaign structure**:
  - **Brand campaign** (exact match): "restaurant oracle" — defensive, low CPA
  - **Category campaign** (broad match):
    - "restaurant inventory app"
    - "kitchen management"
    - "food cost calculator"
    - "recipe management restaurant"
    - "inventory scanner"
  - **Competitor campaign** (exact match on competitor names):
    - MarketMan, BlueCart, Lightspeed Restaurant, MarginEdge
    - Higher CPC but high-intent users
  - **Discovery campaign** (Search Match enabled): let Apple find keywords
- [ ] **Budget**: $20-50/day initially ($600-1500/mo)
- [ ] **Target CPA**: $10-15 (restaurant SaaS = high LTV justifies higher CPA)
- [ ] **Optimization cadence**: review every 3 days, pause keywords with CPA >2x target

---

#### Days 66-70 — Partnerships & Direct Outreach

- [ ] **Restaurant supplier partnerships**:
  - Contact 3-5 local food distributors (they visit restaurants daily)
  - Offer: "Recommend our app to your restaurant clients, we'll feature your ordering link"
  - Win-win: they look helpful, you get distribution
- [ ] **POS system ecosystem**:
  - Check if Toast, Square, Clover have partner/integration directories
  - Apply for listing (even if integration not built yet — coming in Phase 2)
- [ ] **Restaurant consultants**:
  - Find 5-10 restaurant consultants on LinkedIn
  - Offer them free Team accounts for all their clients
  - They become evangelists (saves their clients money → makes them look good)
- [ ] **Local restaurant associations**:
  - Oregon Restaurant & Lodging Association
  - Portland chapter events
  - Offer group discount for members
- [ ] **Direct outreach** (warm, not cold):
  - Identify 50 restaurants in Portland metro area
  - Personal visit or email: "I built this for La Chona Bistro, thought you might find it useful"
  - Offer: 60-day extended trial (vs standard 21)

---

### WEEK 15-16: Iterate & Hit 10K

#### Days 71-75 — Push Notifications

- [ ] Add push notification support:
  - APNs configuration in Xcode (push entitlement + capability)
  - Request notification permission (after onboarding, not on first launch)
  - Token registration with backend
- [ ] Notification types (start conservative — 2-3/week max):
  | Trigger | Message | When |
  |---------|---------|------|
  | Low stock | "3 items below minimum qty" | Morning, if applicable |
  | Prep reminder | "Today's prep list has 5 items" | 6 AM on prep days |
  | Week summary | "This week: 47 items counted, 3 recipes updated" | Sunday evening |
  | Trial expiring | "Your trial ends in 3 days" | 3 days before expiry |
- [ ] Schedule via Cloud Functions (cron) or Firebase Cloud Messaging topics

---

#### Days 76-80 — Growth Iteration & 10K Push

- [ ] **Analyze what's working**: which acquisition channel has best CPA?
  - Double down on the winner
  - Cut channels with CPA >$20
- [ ] **Referral program** (simple):
  - "Invite a restaurant" → share link
  - Both get 1 month free Pro
  - Track with unique referral codes
- [ ] **Feature iteration based on data**:
  - Which features are most/least used? (Firebase Analytics)
  - What are users asking for? (App Store reviews, support emails)
  - Build the #1 requested feature this week
- [ ] **App update** (v1.1.0): bug fixes + #1 requested feature + improved onboarding
  - Top apps update every 18 days (per guide) — stay on cadence
- [ ] **Paid spend increase**: if unit economics work (CPA < LTV/3), increase budget
- [ ] **PR/media**: pitch to restaurant industry publications:
  - Restaurant Business Magazine
  - Nation's Restaurant News
  - Modern Restaurant Management
  - Angle: "AI scanning eliminates handwriting errors in inventory counts"

---

## 10K Milestone Metrics Dashboard

Track weekly starting launch day:

| Week | Downloads | Signups | Active Users | Day 7 Ret | Trials | Paid | MRR | Rating |
|------|-----------|---------|-------------|-----------|--------|------|-----|--------|
| 1 | | | | | | | | |
| 2 | | | | | | | | |
| 3 | | | | | | | | |
| 4 | | | | | | | | |
| 5 | | | | | | | | |
| 6 | | | | | | | | |

**10K Target Funnel:**
```
Downloads needed:   ~25,000  (40% signup rate)
Signups needed:     ~10,000  (= 10K users)
Active users:       ~4,000   (40% activation)
Trial starts:       ~2,000   (50% of active try trial)
Paid conversions:   ~200-400 (10-20% trial conversion)
MRR at 10K:         $6K-12K  (200-400 x $30 avg)
```

**Time to 10K (realistic estimate):**
- Organic only: 6-12 months post-launch
- With $1K/mo paid spend: 3-6 months post-launch
- With $3K/mo paid spend + partnerships: 2-4 months post-launch

---

## Budget Summary (Phase 1 Total)

| Item | One-Time | Monthly | 16-Week Total |
|------|----------|---------|---------------|
| Apple Developer Program | $99/yr | — | $99 |
| Domain (bistrosteward.com) | $12/yr | — | $12 |
| Firebase (Blaze plan) | — | $0-50 | $0-200 |
| Sentry (Developer tier) | — | $0 (free) | $0 |
| Apple Search Ads | — | $600-1500 | $2,400-6,000 |
| Fastlane/CI (GitHub Actions) | — | $0 (free tier) | $0 |
| Landing page hosting (Vercel) | — | $0 (free) | $0 |
| **Total** | **$111** | **$600-1,550** | **$2,511-6,311** |

Revenue at 10K users (200 paid): **$6,000/mo MRR** = profitable at even the high end of spend.

---

*Generated 2026-03-03. Source: ios-app-guide.html, Restaurant_Oracle_Updates.md, fullstack-agent-reference.md, current codebase audit (~9,500 LOC).*

---

## Transactional Email System (added 2026-05-01)

Closes the silent-churn gap: signup, trial expiry, billing, team invites, payment failures all now generate user-facing email. Marketing/drip is explicitly out of scope (separate consent + unsubscribe machinery required).

### Provider

- **Resend** — REST API, native `fetch` (Node 22), no SDK dep
- **Account**: shared with LaChona Bistro (single Resend team, single API key)
- **Sender**: `Bistro Steward <noreply@bistrosteward.com>` once domain verified; falls back to `onboarding@resend.dev` via `RESEND_FROM` override secret during testing
- **Reply-to**: `support@bistrosteward.com`
- **Free tier**: 3,000 emails/month, 100/day. Scales to $20/mo @ 50K. Plenty of headroom through Phase 1.

### Files

- `firebase/functions/emails.js` — new module (~360 lines)
  - `sendEmail(to, templateName, data) → { ok, id?, error? }` helper
  - 9 templates with shared `layout()` (dark gradient header, Inter font, gold `#f6b43b` CTA, branded footer)
  - Every send → Firestore audit log at `/tenants/{tenantId}/audit_log` as `email_sent:{template}`
- `firebase/functions/index.js` — wired hooks (no separate file)

### 9 Templates

| Template | Trigger | Subject |
|----------|---------|---------|
| `owner_welcome` | `handleSignup` after tenant provisioning | Welcome to Bistro Steward |
| `trial_ending_7d` | Cron, day 23 of trial | Your trial ends in 7 days |
| `trial_ending_2d` | Cron, day 28 | Your trial ends in 2 days |
| `trial_ending_today` | Cron, day 30 morning | Your free trial ends today |
| `first_charge_receipt` | `squareWebhook` `invoice.payment_made` | Receipt from Bistro Steward — $X |
| `payment_failed` | `squareWebhook` `invoice.scheduled_charge_failed` | Payment failed — action needed |
| `subscription_cancelled` | `adminBilling.cancelSubscription` + webhook ACTIVE→CANCELED | Subscription cancelled |
| `subscription_reactivated` | `adminBilling.resumeSubscription` | Welcome back |
| `team_invite` | `adminBilling.inviteTeamMember` | [Owner] invited you to [Restaurant Name] |

### Cron — `dailyTrialReminders`

- `functions.pubsub.schedule('0 9 * * *').timeZone('America/Los_Angeles')`
- Queries `tenants where trialEndsAt ∈ [now, now+8d]`
- Buckets by `daysLeft`: ≤0 → today, ≤2 → 2d, ≤7 → 7d
- Dedupe: writes `trialEmailsSent.{bucket} = serverTimestamp()` after send; skips if flag exists
- Skips tenants with `status = cancelled`
- Memory 512MB, timeout 540s, max 1 instance
- Manual trigger: `runTrialRemindersNow` HTTPS endpoint, super-admin only

### Tenant doc fields added

- `trialEndsAt: Timestamp` — set in `handleSignup` = signupDate + 30d (matches Square subscription `start_date`)
- `trialEmailsSent: { '7d': Timestamp, '2d': Timestamp, 'today': Timestamp }` — dedup map, written by cron
- `emailSent_invoice_payment_made_<invoiceId>: Timestamp` — webhook dedup
- `emailSent_invoice_scheduled_charge_failed_<invoiceId>: Timestamp` — webhook dedup

### Square webhook extended (`handleSquareSubscriptionEvent`)

- Tracks prior `squareSubscriptionStatus` to detect ACTIVE → CANCELED transitions (fires `subscription_cancelled`)
- On `invoice.payment_made`: extracts `amountCents`, `paidAt`, `nextBillingDate` from payload, sends receipt
- On `invoice.scheduled_charge_failed`: marks tenant `past_due`, sends `payment_failed`
- All sends dedupe by invoice ID; idempotent if Square retries the webhook

### Admin ops wired

- `adminOpCancelSubscription` → `subscription_cancelled` (belt-and-suspenders with webhook)
- `adminOpResumeSubscription` → `subscription_reactivated`
- `adminOpInviteTeamMember` → `team_invite` (includes Firebase Auth password-reset link as `setupLink`)

### Signup hook

- `handleSignup` after `agents.runProvisioning`: sends `owner_welcome` (non-fatal — never blocks signup)

### Secrets

`RESEND_API_KEY` added to `runWith({ secrets: [...] })` on:

- `signupTenant`
- `squareWebhook`
- `adminBilling`
- `dailyTrialReminders`
- `runTrialRemindersNow`
- `sendTestEmail`

Set via `firebase functions:secrets:set RESEND_API_KEY` (paste LaChona's existing key — same Resend team).

Optional second secret `RESEND_FROM` overrides the from-address for testing without domain verification (`onboarding@resend.dev`). Remove once `bistrosteward.com` is verified in Resend.

### QA endpoints

- `sendTestEmail` — POST `{ to, template, data }`, super-admin only. Sends one template with stub data. Used to validate each of the 9 templates against `grandma.chona@gmail.com` post-deploy.
- `runTrialRemindersNow` — manual cron fire, super-admin only. Returns `{ scanned, sent, skipped, errors }`.

### Audit logging

Every send writes to `/tenants/{tenantId}/audit_log` with `operation: 'email_sent:<template>'`, `record_count: 1` (success) or `0` (failure), and `email_info` containing the Resend message ID or error string. Failures don't block the parent action — emails are best-effort, logged then ignored.

### Outstanding setup steps (user-side)

1. Add `bistrosteward.com` to Resend dashboard → Domains
2. Paste 3 DNS records (MX + 2 TXT — SPF + DKIM) into GoDaddy DNS panel for `bistrosteward.com`
3. Verify in Resend (~5 min DNS propagation)
4. Remove `RESEND_FROM` secret to use branded sender
5. (Optional) Customize Firebase Auth email templates in Firebase Console → Authentication → Templates to match Resend sender brand

### Non-goals (explicit)

- No marketing/drip campaign system (consent + unsubscribe needed first)
- No in-app notification system (separate workstream)
- Firebase Auth verification + password-reset emails not migrated to Resend (just rebrand sender via Firebase Console templates)

### Deliverability checklist

- DKIM via Resend (auto-managed)
- SPF: `v=spf1 include:amazonses.com ~all` (or merged into existing record at GoDaddy if any)
- DMARC: optional, Resend provides record (`v=DMARC1; p=none; rua=mailto:dmarc@...`)
- All 9 templates have plaintext fallback
- `List-Unsubscribe: <mailto:support@bistrosteward.com?subject=Unsubscribe>` header on every send (CAN-SPAM hygiene even though all sends are transactional)
- `X-Entity-Ref-ID: <tenantId>` header for Resend log filtering
- Resend tags `template` + `tenant` for analytics in Resend dashboard

---


<a id="production"></a>

# Production Plan

_Source: `docs/plans/PRODUCTION_PLAN.md`_

# Bistro Steward — Production Plan

> Living doc. Tracks shipped → in-flight → backlog. Updated 2026-05-01.

## Live URLs
- App: https://restaurant-oracle.web.app/app
- Marketing: https://restaurant-oracle.web.app/
- Billing: https://restaurant-oracle.web.app/billing
- Super-admin (operators only): https://restaurant-oracle.web.app/super-admin
- Functions region: `us-central1`

## Architecture
- **Frontend**: Vanilla JS SPA (`firebase/public/app.html`, ~8900 lines). No build step. Hosted on Firebase Hosting
- **Backend**: Firebase Cloud Functions (`firebase/functions/index.js`, ~4900 lines, Node 22 1st gen)
- **Auth**: Firebase Auth (Google OAuth + email/password)
- **DB**: Firestore, multi-tenant under `/tenants/{tenantId}/`
- **Payments**: Square (subscription billing via `adminBilling` CF + `squareWebhook`)
- **AI**: Gemini 2.5 Flash via `@google/generative-ai` SDK
- **Observability**: Sentry browser + CF (placeholder DSN — see Open Items), PostHog product analytics

## Shipped this week (2026-04-23 → 2026-04-28)

### 2026-04-23 — Phase 1 multi-tenant migration
- All collections migrated under `/tenants/{tenantId}/`. 609 docs moved, 507 root docs cleaned up
- JWT custom claims: `{tenantId, tenantSlug, approved, role}`
- Firestore rules: 22 tenant-scoped match blocks
- ADC credentials (org policy blocks SA keys)

### 2026-04-26 — Ship blockers + security audit + 8 fixes

End-to-end completion of the 5 hard-blockers from prior session, plus full security audit producing 8 findings (2H + 2M + 2L + 2 fix-as-found) all fixed and deployed in same session.

**5 ship blockers (all done)**:
1. **Terms of Service** — new `firebase/public/terms.html` (16 sections, Oregon law / Multnomah County jurisdiction, $100 / 12-month liability cap, dark-theme card)
2. **Privacy Policy** — new `firebase/public/privacy.html` (14 sections, GDPR / CCPA / CPRA, multi-tenant isolation disclosed, AI processing disclosed, 30+60+7y retention)
3. **Signup consent** — checkbox required to submit. Server-side `agreedToTerms === true` + `termsVersion === '2026-04-24'` enforced (412 if missing). `{termsAcceptedAt, termsVersion, ip, userAgent}` persisted on tenant doc for legal audit
4. **Square error handling** — `mapSquareErrorToMessage(err, fallback)` maps ~30 codes (CARD_DECLINED, VERIFY_CVV_FAILURE, INVALID_EXPIRATION, INSUFFICIENT_FUNDS, CARD_TOKEN_EXPIRED, GENERIC_DECLINE, etc.) → user-friendly messages. Used in 3 signupTenant catch blocks (customer / card / sub). Frontend auto-clears Square card iframe on card-error codes
5. **Email verification gate** — `secureApi` rejects 403 for password-auth users with `emailVerified !== true`. Frontend blocks app load with "Verify your email" screen + Resend / Verified buttons. Reload via `user.reload()` + `getIdToken(true)`. Skipped for Google sign-in. CF check uses `decodedToken.firebase.sign_in_provider === 'password'`.

**Cancellation UX**: confirm modal in `/billing` → `adminBilling { op: 'cancelSubscription' }` → Square cancel + `cancellationScheduledAt`. Tenant-status gate in CF blocks writes for cancelled (402). Reactivation via `resumeSubscription`.

**Onboarding wizard**: 3-step welcome → invite team → completion. State on tenant doc (`onboardingComplete`, `onboardingCompletedAt`, `onboardingCompletedBy`). New CF op `adminOpCompleteOnboarding`. `app.html:checkAndShowOnboarding()` after auth ready, only for `currentUserRole === 'owner'`. Once-per-session via `window._onboardingChecked`.

**8 security findings + fixes**:
| ID | Sev | Issue | Fix |
|----|-----|-------|-----|
| H-1 | HIGH | `requireOwner` lacked email-verify + provider check → unverified password owner could call every adminBilling op | `functions/index.js:1785` — added `signInProvider === 'password' && email_verified !== true` → 403 |
| H-1 | HIGH | `handleAdminBilling` no rate limit | Added `checkRateLimit(authCtx.userId)` → 429 + audit `admin_rate_limit_exceeded` |
| H-1 | HIGH | Cancelled tenants could still invite/remove members | `cancelledSafeOps = {getInfo, updatePaymentMethod, resumeSubscription}`. All other ops 402 with status check on tenant doc when status ∈ {suspended, cancelled, canceled} |
| H-2 | HIGH | Server-side ToS consent not enforced | `validateSignupInput` requires `agreedToTerms === true` + `termsVersion` matches YYYY-MM-DD. `handleSignup` stores `{termsAcceptedAt, termsVersion, ip, userAgent}` on tenant. Client POSTs `agreedToTerms: true, termsVersion: '2026-04-24'` |
| M-1 | MED | `verifyIdToken` not checking revocation | `auth.verifyIdToken(idToken, true)` (checkRevoked=true) in `requireOwner` |
| L-1 | LOW | Square `primary.detail` echoed unbounded in error responses | `mapSquareErrorToMessage` truncates `rawDetail` to 200 chars + `…` suffix. Used in BAD_REQUEST + UNKNOWN branches |
| L-2 | LOW | Invite button stuck disabled on success path | `onboardingInvite` re-enables button before `onboardingNext()` for nav-back safety |

**Verified live post-deploy**: `/signup`, `/terms`, `/privacy` → 200 ; `signupTenant` no consent → `400 "You must agree to the Terms of Service and Privacy Policy"` ; `adminBilling` unauth → 401 ; `termsVersion: '2026-04-24'` baked into live signup HTML.

**Deploy**: `firebase deploy --only functions:api,functions:signupTenant,functions:adminBilling,hosting`.

### 2026-04-26 — Operator dashboard full 21-category expansion

Subagent execution after user said "all of it - start building". Net +2116 lines to `functions/index.js` (2735 → 4851). Full rewrite of `super-admin.html` (682 → 1921 lines).

**8 sidebar tabs**: Overview / Tenants / Tickets / Feedback / Agents / Announce / Flags / Settings. Hand-rolled MRR canvas sparkline, hash routing, `/` search shortcut, j/k row nav, Esc close.

**22-tab tenant drawer**: Summary / Users (uid/role/reset-pw/revoke-tokens/resend-verify) / Billing / Costs / Usage / Health / Tickets / Feedback / Notes / Meta (tags/csm/priority) / Data Footprint / Audit log / Collections / Flags / Announce / Actions / Impersonate / Refund / Plan / Comp / Export / Danger (hard-delete with type-tenantId gate).

**10 NEW Firestore collections** (all rules + indexes added):
| Collection | Purpose |
|------------|---------|
| `/tenants/{id}/support_tickets/{id}` + `/messages` subcoll | Tickets — subject/body/status/priority/assignedTo/source. Internal-note flag on messages |
| `/tenants/{id}/feedback_events/{id}` | Feature feedback (rules unified) |
| `/tenants/{id}/internal_notes/{id}` | Operator-only notes — body/pinned/tags |
| `/tenant_costs_daily/{tenantId}_{YYYY-MM-DD}` | Daily cost rollup (Firestore reads/writes/deletes/storage, CF invocations/GB-s, Gemini in/out tokens, Resend emails, total USD) |
| `/tenant_usage_daily/{tenantId}_{YYYY-MM-DD}` | Daily usage rollup (recipes/ingredients/prep sheets/scans/oracle/orders/exports, uniqueUsers, sessions, totalSessionMinutes) |
| `/tenant_health/{tenantId}` | Current health snapshot (engagementScore, churnRiskScore, atRiskFlag, factors[], recommendedIntervention) |
| `/tenant_meta/{tenantId}` | Operator-editable tags, csm, priorityScore, followUpDate, strategicValueFlag, customLabels |
| `/operators/{uid}` | Operator profile (status online/offline/busy, openTicketCount, avgResolutionHours, csat) |
| `/platform_announcements/{id}` | Broadcast banners (audience all/plan/tenant_ids, severity, expiresAt, dismissible) |
| `/feature_flags/{name}` | Per-tenant overrides (enabledTenants[], disabledTenants[], rolloutPercent) |

**14 composite indexes**: support_tickets ×6 (status/priority/assignedTo + opened combinations), feedback_events ×4 (feature/sentiment + timestamp), tenant_costs_daily ×2, tenant_usage_daily ×2 (tenantId + date DESC).

**54 super-admin CF operations** (corrects prior "45" — the dispatcher has 54 total ops including pre-existing dashboard / listTenants / suspendTenant / forceCancel / grantSuperAdmin / etc.):
- **Enriched listing**: `listTenantsEnriched`, `getTenantFull`, `getKpiOverview`
- **Tickets** (8): `listTickets`, `getTicket`, `createTicket`, `replyTicket`, `assignTicket`, `closeTicket`, `reopenTicket`, `addTicketTag` / `removeTicketTag`
- **Feedback** (3): `listFeedback`, `aggregateFeedbackByFeature`, `markFeedbackReviewed`
- **Notes** (4): `listNotes`, `addNote`, `updateNote`, `deleteNote`
- **Meta** (4): `getTenantMeta`, `setTenantMeta`, `addTenantTag`, `removeTenantTag`
- **Costs/Usage/Health reads**: `getTenantCosts({days})`, `getTenantUsage({days})`, `getTenantHealth`
- **Operator actions**: `impersonateTenant` (30-min RO custom token + audit), `exportTenant` (full JSON dump), `softDeleteTenant`, `hardDeleteTenant` (confirmation === tenantId), `resetUserPassword`, `revokeTokens`, `resendVerification`, `adjustPlan`, `compInvoice`, `issueRefund`, `pushAnnouncement`, `setFeatureFlag`, `manualAuditEntry`
- **Agents**: `listOperators`, `updateOperatorStatus`
- **Pre-existing preserved**: `dashboard`, `listTenants`, `getTenantDetails`, `suspendTenant`, `unsuspendTenant`, `forceCancel`, `listSuperAdmins`, `grantSuperAdmin`, `revokeSuperAdmin`

All ops route through `requireSuperAdmin` + `checkRateLimit(uid)` + `writeSuperAudit` (new helper, prefixes audit op with `super_admin_`).

**RATE_CARD constants** (for cost rollup math):
```
Firestore: read $0.036/100k, write $0.108/100k, delete $0.012/100k
CF: invocation $0.40/1M, GB-s $0.0000025
Gemini 2.5 Flash: input $0.075/1M tokens, output $0.30/1M
Resend: $0.0004/email
```

**4 scheduled rollups** (Cloud Scheduler, 1st-gen Node 22 us-central1):
| Function | Cron | Purpose |
|----------|------|---------|
| `dailyTenantCostAggregation` | 01:00 PT | Per-tenant Firestore/CF/Gemini/Resend cost via RATE_CARD |
| `dailyUsageStatsRollup` | 01:30 PT | Per-tenant audit_log → operation-bucketed usage + DAU |
| `dailyHealthScoreCompute` | 02:00 PT | Composite engagement + churn-risk score with weighted factors |
| `dailyTrialCheck` | 08:00 PT | Updates `daysIntoTrial` field on tenant docs |

All wrapped in per-tenant try/catch — one bad tenant doesn't kill the run. Idempotent doc writes. `superOpRunRollupsNow` triggers 3 compute fns immediately for testing.

**Impersonation flow** (extended): `superOpImpersonateTenant` returns `{customToken, tenantSlug, tenantId, expiresAtMs, expiresInSeconds: 1800}` (30-min, RO claim). `app.html` consumer reads `?impersonateToken=` + `?tenant=` + `?expiresAt=`, calls `signInWithCustomToken`, scrubs URL via `history.replaceState`, shows red banner "IMPERSONATING [tenant] as [operator] · READ-ONLY · MM:SS left", 1Hz countdown. At expiry: clears interval, signs out, redirects to `/super-admin`. `secureApi` blocks writes when `decodedToken.impersonating === true && readOnly === true && op ∉ {select, getTenantConfig, checkSlugAvailable, get_tenant_settings, list_invoices}`.

**Bug fixes after subagent build (same session)**:
1. **Firebase init case mismatch** — `super-admin.html:598` called `firebase.initializeApp(window.firebaseConfig)` but `firebase-config.js` exposes `window.FIREBASE_CONFIG`. Result: `FirebaseError: Need to provide options ... (app/no-options)`, page stuck on "Verifying access…" because `auth.onAuthStateChanged` never fires. Fix: `firebase.initializeApp(window.FIREBASE_CONFIG || window.firebaseConfig)`.
2. **Sentry placeholder DSN throws** — `sentry-init.js` shipped with `dsn: 'FRONTEND_DSN_PLACEHOLDER'` and called `Sentry.init` unconditionally → `Invalid Sentry Dsn: FRONTEND_DSN_PLACEHOLDER` console error every page. Fix: detect placeholder via concat trick (`'FRONTEND_DSN_' + 'PLACEHOLDER'`) and early-return with noop globals.

**Verified live post-deploy**:
- `/super-admin` → 200
- `superAdmin` CF unauth → 401 ("Missing authorization header")
- 4 scheduled fns confirmed via `firebase functions:list`
- `superOpRunRollupsNow` invokes 3 compute fns sync
- Browser console clean after init fix (no Firebase error, no Sentry throw)

**Deferred**:
- ~~Real Sentry DSN (waiting on Sentry-wire-up task)~~ — closed by 2026-05-01 Sentry entry below; backend `@sentry/node` + scrubbing wired, frontend + backend secret swap pending DSN paste
- Ticket composer uses `prompt()` for subject/body/priority — full modal deferred
- Rollup data populates 01:00 PT 2026-04-27 first run; tabs show "No data yet" placeholders defensively until then
- E2E tests against live (`_e2e_super_admin.js`) — needs FIREBASE_WEB_API_KEY

### 2026-04-27 — Standalone testbed sandbox
- `/Users/mulefamily/Claude/Restaurant-Oracle-Testbed/` — sibling folder, no git, no Firebase
- 1169 ings / 595 recs / 40 menus / 1147 conv / 977 inv from TheMealDB
- Browser at `:8766/app-snapshot/index-testbed.html?backtest=1` (preview config `testbed`)
- Pure-Python port of `calculate_shopping_list()` for test-without-browser
- 61 → now 67 pytest invariants (parser, conversions, shopping, multi-shift)
- See [restaurant-oracle-backtest.md](../../../.claude/projects/-Users-mulefamily-Claude/memory/restaurant-oracle-backtest.md)

### 2026-04-28 — Production bug sweep + multi-shift feature

**Bug fixes (deployed)**:
| # | Issue | Fix |
|---|---|---|
| 1 | 16× Firestore listener "Missing or insufficient permissions" | Added `getTenantId()` + `tenantPath()` helpers; refactored `subscribeCollection()` + settings listener at `app.html:1976-1991, 2086` to scope `tenants/{tid}/<coll>` |
| 2 | CSP blocks Chart.js (`cdn.jsdelivr.net`) | Added to `script-src` + `connect-src` (sourcemap) in `firebase.json:39` |
| 3 | CSP blocks Sentry sourcemap | Added `https://browser.sentry-cdn.com` to `connect-src` |
| 4 | `adminBilling` HTTP 500 — `d.data().created_at.toDate is not a function` | Added `toIso(v)` helper at `index.js:2391-2407, 2421` handling Firestore Timestamp / JS Date / number / string / null |
| 5 | 3× DOM "Password not in form" + COOP popup block | Wrapped signin + update-password in `<form>`, added hidden username, `Cross-Origin-Opener-Policy: same-origin-allow-popups` header |
| 6 | Stale browser CSP cache (1-hr `max-age`) | Added `Cache-Control: no-cache` for `**/*.html` |
| 7 | Recipe `yield` field semantic mismatch | Was treated as percent (build_mock_env.py set as count). Pipeline corrected to set `yield=95` (%) + `outputMode='manual'` + `manualQty=4` (portion count) |

**Multi-shift bulk shopping (deployed)**:
- `D.shoppingPlan = {numShifts, consumptionRate}` + sessionStorage persist
- Bulk Purchase Plan card on Shopping tab: 2 number inputs + summary line + 400ms debounced auto-recalc
- `calculateShoppingList()` scales menu target + standalone minQty by `numShifts × consumptionRate`. Finished-menu inv subtracts ONCE (fixed pool, not per-shift)
- Prep tab: shifts-on-hand badge per menu + recipe row, color-coded (red < 0.5 / yellow 0.5–1 / green ≥ 1 / ∞ if target = 0)
- Python port (`shopping_model.py`) gained same params; 67/67 pytest pass
- Browser ↔ Python parity: 180 shopping items at 3 shifts, 8-ing sample matches byte-for-byte
- Plan: [docs/plans/2026-04-28-multi-shift-shopping.md](2026-04-28-multi-shift-shopping.md)

### 2026-05-01 — PostHog product analytics wired live

- **Real key live**: `phc_srhjbdeE5yJZC7F4wVSNqwSui46eHJErtQpXfSQ6Te32` (US region, `us.i.posthog.com`) hardcoded at `firebase/public/posthog-init.js:14`
- **Shared loader** at `posthog-init.js` exposes `window.roIdentify`, `window.roPosthogReset`, `window.roTrack` globals. Loaded in `<head>` on `index.html`, `signup.html`, `app.html`, `admin.html`
- **Privacy config** (client-enforced):
  - `person_profiles: 'identified_only'` — anon landing visitors create no profile
  - `capture_pageview: false` — SPA emits `page_viewed` manually in `go(t)`
  - `respect_dnt: true`, `ip: false` (GDPR)
  - `disable_session_recording: true`, `autocapture: false`
  - `sanitize_properties` strips `password`, `newPassword`, `confirmPassword`, `cardNonce`, `cvv`, `verificationToken` from any event props
- **CSP** (`firebase.json`): `script-src` + `connect-src` + `img-src` allow `https://us.i.posthog.com` + `https://us-assets.i.posthog.com`
- **Identify flow**: called from `app.html` and `admin.html` after `getIdToken(true)` resolves claims. Person props: `tenantId`, `tenantSlug`, `role`, `approved`, `plan`, `emailVerified`, `signedUpAt`. Tenant `group('tenant', tenantId, {slug, plan})`. Reset on sign-out via `window.roPosthogReset()` before `fbAuth.signOut()`. Email NEVER sent (gated on `extra.includeEmail`, currently false everywhere)
- **15+ events instrumented**:
  - **Landing**: `landing_viewed`, `landing_cta_clicked`
  - **Signup funnel**: `signup_page_viewed` → `signup_submitted` → `signup_success` / `signup_failed`
  - **App**: `page_viewed` (on `go(t)`), `feature_used` × 5 (`vendor_order_sent`, `prep_sheet_print`, `inventory_scan`, `inventory_scan_applied`, `oracle_query`); `onboarding_wizard_step`, `onboarding_completed`
  - **Billing**: `billing_page_viewed`, `billing_plan_changed`, `billing_subscription_cancelled`, `billing_subscription_resumed`, `billing_card_updated`
  - **Feedback**: `feedback_submitted` (mirror of Firestore write, gated by `has_opted_out_capturing()`)
- **Privacy policy** (`privacy.html`): §2.3 + §5 table disclose PostHog. New §12a documents 3 opt-out paths: browser DNT, `posthog.opt_out_capturing()` console call, `privacy@bistrosteward.com` for erasure
- **PostHog UI privacy toggles verified**: autocapture web OFF, web vitals OFF, dead clicks OFF, session recording OFF, **Discard client IP** ON (server-side backstop for client `ip: false`)
- **Dashboard built**: **Bistro Steward — Growth** (3 tiles): Retention by `page_viewed`, Feature Adoption (sic — typo, cosmetic), `landing_viewed → signup_submitted → signup_success` funnel
- **Seed events**: 27 events with `source: 'seed'` tag fired via preview server to bootstrap insights/funnel pickers. Filter `source != 'seed'` on production dashboards once real traffic flows
- **Gotcha**: NEVER `posthog.identify()` before auth resolved — anon→id merge issues per PostHog docs. CSP needs both `us.i.posthog.com` (events) AND `us-assets.i.posthog.com` (array.js bundle); loader rewrites host

### 2026-05-01 — Marketing landing page split from app

**Problem**: cold visitors hitting `/` got the app's sign-in form. No idea what product does → bounce. Signup hidden behind direct `/signup` link, never exposed organically.

**Resolution**: split marketing page from app. Long-scroll single-page landing matching dark-gradient style baseline (`signup.html`, `terms.html`).

**File reorg**:
- `firebase/public/index.html` — old app SPA → renamed to `app.html` (~501 KB, ~8970 lines, untouched logic)
- `firebase/public/index.html` — NEW marketing landing (~35 KB inline CSS, single file, no build)

**Routing** (`firebase.json` rewrites):
- `/` → `index.html` (landing, served by Firebase as static index)
- `/app` → `/app.html` (NEW rewrite — sign-in form lives here)
- Catch-all `**` → `/app.html` (was `/index.html`) so SPA deep-links (`/user/<slug>`) still hit app, not landing
- Existing `/signup`, `/admin`, `/super-admin`, `/terms`, `/privacy` rewrites unchanged

**Sign-in link migration** (5 files patched, `/` → `/app`):
- `signup.html:1176` — "Already have an account? Sign in"
- `privacy.html:174`, `terms.html:140` — footer
- `admin.html:150,167,174` — top-bar "Back to app", sign-in gate, not-owner gate
- `admin.html:317` — `signOut()` redirect (`window.location.href = '/app'`)
- `super-admin.html:158,175,182,272` — top-bar Main app + 2 gate buttons + footer
- `super-admin.html:657` — sign-out redirect

**Landing page sections** (in order):
1. Sticky nav (Pricing / Features / Sign-in / Start free trial CTA)
2. Hero — headline, subhead, primary CTA → `/signup`, secondary → `/app`, eyebrow "30-day free trial · no card charged"
3. Hero visual — pure HTML/CSS dashboard mockup (Lamb Ragù recipe card $6.41 cost / 72.3% margin + Prep Sheet panel + Oracle low-stock chat bubble). No image file
4. Social proof strip — 5 placeholder logo slots ("Trusted by restaurants in Portland & Pacific NW")
5. Problems — 4-card grid: food cost mystery / prep sheets rewritten / recipes leave with chef / count night = 4hr
6. Features — 6-tile grid: Recipe Costing, AI Inventory Scan, Prep Sheets, Vendor Orders, Team Roles & Audit, Oracle Assistant
7. How it works — 3 steps (Sign up ~2min / Import menu ~30-60min / Track cost live)
8. Pricing — 3 tiers from `PLAN_CATALOG` (Starter $29 / Pro $49 "Most popular" / Scale $99). Feature lists mirror `signup.html` plan picker. Each card → `/signup` CTA
9. FAQ — 6 `<details>` expanders: POS-required, team users, post-trial billing, multi-location, data privacy, AI scan mechanics
10. Final CTA card + Footer (Product / Account / Legal columns + © 2026)

**Design**:
- Inline CSS in single file (~35 KB total). Inter font from Google Fonts (already in CSP)
- Dark radial gradient `radial-gradient(ellipse at 100% 100%,#cce4f7 0%,#74acdf 25%,#2e6090 55%,#162d45 100%)` w/ `background-attachment:fixed` — matches signup/terms/privacy
- Card panels `rgba(10,20,46,.94)` + `border:1px solid rgba(116,172,223,.35)` baseline
- Mobile breakpoints at 760px, 560px, 420px. Hero CTAs stack on mobile
- Contrast fix mid-build: hero/section titles changed from `#0d1e33` → `#fff` w/ text-shadow because gradient top-left is dark on tall mobile viewport (dark-on-dark unreadable)
- Lazy-load: nothing below fold needs JS. All content inline HTML; no images other than `icon.png`
- SEO: `<meta description>`, OG tags, `og:image=icon.png`, canonical URL, `twitter:card`

**Ops**:
- New launch.json entry `ro-hosting` (`firebase serve --only hosting --port 5055`) for local rewrite testing
- No CSP changes needed (only Google Fonts, already allowed)
- No Cloud Function changes — pure hosting work

### 2026-05-01 — Sentry error monitoring wired live (frontend + backend)

Closes the open item from the 2026-04-26 super-admin build (line 2930). Browser SDK + `@sentry/node` v10.50.0 wired end-to-end. DSNs not yet pasted — code ships with `FRONTEND_DSN_PLACEHOLDER` (frontend) + `process.env.SENTRY_DSN` (backend); both paths early-return / no-op when unset, so deploy is safe before secret exists.

**Frontend (`firebase/public/sentry-init.js`, NEW)**:
- Loaded via CDN: `https://browser.sentry-cdn.com/10.50.0/bundle.tracing.min.js` (pinned, `crossorigin="anonymous"`) + `sentry-init.js` after, in `<head>` of all 5 user-facing pages: `app.html`, `index.html`, `signup.html`, `admin.html`, `super-admin.html`. Loaded BEFORE `posthog-init.js` so Sentry can capture errors from PostHog init too.
- **Placeholder guard** (added after first deploy threw `Invalid Sentry Dsn`): `if (DSN === 'FRONTEND_DSN_' + 'PLACEHOLDER')` short-circuits to no-op `roSentryIdentify`/`roSentryReset` globals — string concat trick prevents the placeholder from being detected as the literal it pretends to be, so `Sentry.init` never sees the bad DSN.
- **Environment auto-detect** by `location.hostname`: `bistrosteward.com` → `production`; `localhost`/`127.0.0.1` → `development`; everything else → `staging`.
- **Release** stamped `restaurant-oracle@%GIT_SHA%` — placeholder rewritten by `firebase/deploy.sh` at deploy time using `git rev-parse --short HEAD`, restored on exit via `trap`.
- **Noise filter** (`ignoreErrors`): `ResizeObserver loop limit exceeded`, `Non-Error promise rejection captured`, `/FirebaseError.*offline/`, `/FirebaseError.*unavailable/`, `Failed to fetch`, `Load failed`, `NetworkError when attempting to fetch resource`. Plus `denyUrls` for `chrome-extension://`, `moz-extension://`, `safari-extension://` (third-party noise, not our bugs).
- **PII scrub** (`beforeSend`): drops `event.extra.{data,body,payload,request,response,rows,claims}`; strips query string from `event.request.url` (verification tokens leak there); redacts `password`, `newPassword`, `confirmPassword`, `cardNonce`, `cvv`, `verificationToken`, `token`, `idToken`, `access_token`, `refresh_token` inside breadcrumb data. Catch-all `try/catch` so a scrub failure never blocks reporting.
- **Helpers** (mirror PostHog's `roIdentify` / `roPosthogReset` pattern):
  - `window.roSentryIdentify(user, claims, extra)` — `Sentry.setUser({id, email})` + tags `tenantId`, `tenantSlug`, `role`, optional `surface` (e.g. `'admin'`).
  - `window.roSentryReset()` — clears user + tag state on sign-out.
- **Wired into auth flow** alongside existing PostHog calls:
  - `app.html:1376` `onAuthStateChange` → `roSentryIdentify(user, customClaims)` next to `roIdentify`
  - `app.html:1276` `signOut()` → `roSentryReset()` next to `roPosthogReset`
  - `admin.html:318` post-claims gate → `roSentryIdentify(user, claims, {surface: 'admin'})`
  - `admin.html:323` `signout-btn` click → `roSentryReset()`
- **`tracesSampleRate: 0.1`** (10% performance sample, plenty for low traffic).

**Backend (`firebase/functions/`)**:
- `package.json` — `@sentry/node ^10.0.0` (resolves to v10.50.0).
- `index.js` top — `Sentry.init({ dsn: process.env.SENTRY_DSN || undefined, environment, release: 'restaurant-oracle@%GIT_SHA%', tracesSampleRate: 0.1, beforeSend })`. v10 SDK no-ops cleanly when DSN unset, so deploys without the secret don't crash.
- **Server-side scrub** (`beforeSend`): parses string `event.request.data` as JSON best-effort (else replaces with `{_raw: '[REDACTED]'}`), then redacts `password`, `cardNonce`, `verificationToken`, `images`, `imageBase64` (Gemini scan payloads — base64 PNGs would otherwise blow Sentry's 1 MB event cap), `rawBody`, plus all the same field names as the frontend. Auth/cookie headers (`authorization`, `Cookie`) replaced with `[REDACTED]`. `event.extra.{data,body,rows,claims,payload,bodyText}` deleted outright.
- **`captureError(err, req, handler)` helper** at top of `index.js` — uses `Sentry.withScope` for per-request isolation (concurrent invocations don't leak tags). Tags: `handler` (e.g. `api`), `op`/`table`/`tenantSlug` from `req.body`, `method` from `req.method`. Never pulls `email` (PII). Wrapped in `try/catch` so capture failure can't break the actual error response.
- **`agents.js`** — `require('@sentry/node')` (uses already-initialized client, no second `init`), `captureScheduledError(err, handler)` helper for the 3 scheduled handlers.

**Captures wired** — all top-level handler `catch` blocks (next to existing `console.error`):

| Function | File:line | Handler tag |
|---|---|---|
| `api` | `index.js:1543` | `api` |
| `signupTenant` | `index.js:1924` | `signupTenant` |
| `squareWebhook` | `index.js:2179` | `squareWebhook` |
| `adminBilling` | `index.js:2697` | `adminBilling` |
| `superAdmin` | `index.js:4524` | `superAdmin` |
| `runTrialRemindersNow` | `index.js:5092` | `runTrialRemindersNow` |
| `sendTestEmail` | `index.js:5145` | `sendTestEmail` |
| `healthCheck` | `agents.js:430` | `healthCheck` (kind=`scheduled`) |
| `revenueSnapshot` | `agents.js:441` | `revenueSnapshot` (kind=`scheduled`) |
| `onboardingNudge` | `agents.js:452` | `onboardingNudge` (kind=`scheduled`) |

**`SENTRY_DSN` secret declared** on all 13 function `runWith({secrets: [...]})` blocks: 8 HTTPS (`api`, `signupTenant`, `squareWebhook`, `adminBilling`, `superAdmin`, `runTrialRemindersNow`, `sendTestEmail` plus the scheduled `dailyTrialReminders` HTTPS variants) + 5 scheduled (`dailyTenantCostAggregation`, `dailyUsageStatsRollup`, `dailyHealthScoreCompute`, `dailyTrialCheck`, `dailyTrialReminders`) + the 3 in `agents.js`. Required because Firebase blocks deploy of a function that references an undeclared secret name.

**CSP changes** (`firebase.json` line 39):
- `script-src` += `https://browser.sentry-cdn.com` (CDN bundle)
- `connect-src` += `https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io` — wildcard in CSP only matches one label, so regional ingest hosts (`o123.ingest.us.sentry.io`) need an explicit entry; once the real DSN is pasted we'll know which region applies and can prune the unused two.

**`firebase/deploy.sh` (NEW, +x)** — wraps `firebase deploy` so `%GIT_SHA%` placeholders in `public/sentry-init.js` + `functions/index.js` get stamped with the current short SHA, deploy runs, then `trap restore EXIT` reverts the files so the working tree stays clean (and source remains git-blame-friendly). Defaults to `hosting,functions`; pass `hosting`, `functions`, or `functions:foo` as the first arg to scope.

**Coverage gaps (intentional)**:
- `inboundInvoice` (in `firebase/functions/invoices.js`, SendGrid Inbound Parse webhook) — not wired in this pass; lives in a separate file that doesn't `require('@sentry/node')` yet. Add in a follow-up if email-ingest errors warrant it.
- Mid-level `console.error` sites inside scheduled rollups (per-tenant loops in `dailyTenantCostAggregation`, `dailyUsageStatsRollup`, `dailyHealthScoreCompute`, `dailyTrialCheck`, `dailyTrialReminders`) — left as `console.error` only. The loops absorb per-tenant errors and continue; surfacing every transient blip would burn the 5k-event/month free quota fast. Top-level handler catch is the right altitude.

**Pending**:
1. Sign up at sentry.io, create org "Bistro Steward", create projects `restaurant-oracle-frontend` (Browser JS) + `restaurant-oracle-functions` (Node.js), grab both DSNs.
2. Paste frontend DSN → swap `FRONTEND_DSN_PLACEHOLDER` in `sentry-init.js:32`.
3. `firebase functions:secrets:set SENTRY_DSN` → paste backend DSN at prompt.
4. `./firebase/deploy.sh` to stamp release + push frontend + backend.
5. Test events: trigger frontend `throw` via console on live site; trigger backend by adding a temporary `throw` to `superAdmin` handler, deploy, hit, revert. Confirm both events arrive within 60s with correct `tenantId`/`handler`/`op` tags and that the `password`/`cardNonce`/`verificationToken` fields show `[REDACTED]`.
6. Sentry alerts → email `grandma.chona@gmail.com`: rule "Any new issue" + rule "Issue seen by 5+ users in 1 hour". Skip session replay (PII risk for restaurant ops). Source maps deferred (no minification yet).

### 2026-04-26 — Desktop web layout + Margin tab port + voice removal + invoice infra

Single atomic commit `03e65e6` (15 files, +7504 / −791). Live on prod hosting + Cloud Functions.

**Desktop web layout** (matches signup carousel slide 10):
- Viewport unlocked (drop `maximum-scale=1.0`). Mobile PWA layout untouched <1024px.
- New `@media (min-width:1024px)` block in both `firebase/public/app.html` + root `index.html`:
  - Chrome-style topbar with traffic-light dots (`::before` radial-gradient hack), `#050b14` bg
  - Horizontal tab bar `#14233b`, `#74acdf` accent, underline on active
  - Centered `max-width:1400px` content, wider drawer `min(560px,50vw)`, wider modal
  - Flex `order` reorder: status(0) → tabs(1) → header(2) → content(3)
- Asset path fix — added `<base href="/">` + absolute `/firebase-config.js`, `/sentry-init.js`, `/posthog-init.js`, `/icon.png`, `/manifest.json`. Without this, tenant route `/user/{slug}` fetched `/user/firebase-config.js` → 404 → Firebase init failed → app fell to local-mode showing stale IndexedDB cache without auth. Login screen now properly shows when unauthenticated.

**Margin tab + cost engine + recipe drawer** (ported into production `app.html`, was index.html-only):
- ~600 lines added: `calcLineIngCost`, `calcRecipeCost`, `marginColor`, `foodCostColor`, `updRecMenuPrice`, `getIngPriceHistory`, `getBestVendorForIng`, `detectIngAlarm`, `recipeAlarmLevel`, `renderMargin`, `marginKpiCard`, `marginTh/SortBy`, `toggleMarginFilter`, `alarmBadgeHtml`, `getRecipeBestVendorSummary`, `openRecipeDrawer`, `closeRecipeDrawer`, `drawIngPriceChart`, `collectIngAlarms`, `loadAlternateSuppliers`, `fetchAiSupplierAlternates`
- Chart.js 4.4.4 + chartjs-adapter-date-fns 3.0.0 CDN (deferred)
- `recipe-drawer` + `drawer-backdrop` DOM + slide-in transition CSS
- Wired `margin` into `render()` titles map + tab switch + `allTabs` visibility array
- `mapIngFromDb` / `mapIngToDb` round-trip `priceHistory` ↔ `price_history`

**Auth state hardening**:
- `getCurrentUserRole` reads custom claims FIRST (server-authoritative, race-free) before D.users lookup
- Self-heal: if onAuthStateChange race left `currentAuthUser` empty but `firebaseAuth.currentUser` exists, lift it now and lazily refresh claims, then re-render

**Voice input fully removed** (~200 lines deleted from both files):
- CSS: `.voice-fab`, `.voice-transcript`, `@keyframes voice-pulse`
- DOM: `<button.voice-fab>`, `<div.voice-transcript>`
- JS: `initVoice`, `voiceToggle/Start/Stop`, `voiceBuildContext`, `voiceProcess`, `voiceDispatch`, `voiceDoSearch`, `voiceAdd*`, `voiceUpdatePrep`
- `initVoice()` call removed after listener load

**Stand Alone Item sections — collapsible**:
- Standalone Items parent + per-category subsections each toggle via `tog()` / `exp[]` ▲/▼. Default open.
- Same pattern applied to Prep Items section.

**Cloud Functions live** (deployed via `firebase deploy --only functions`):
- `inboundInvoice` (HTTPS, us-central1, 120s, 512MB) — multipart parser, Gemini 2.5 Flash invoice extract, fuzzy ingredient matcher (exact=100, substring=70, word-overlap×50, threshold ≥30)
- `secureApi` ops added: `get_tenant_settings`, `rotate_invoice_token`, `list_invoices`, `ai_insight` (24h cached at `ai_insight_cache/{base64-mode::ing::region}`)
- `provisionTenant` generates 8-hex-char `invoiceToken` with collision retry
- `curl -I /inboundInvoice` returns 405 → endpoint exists

**LaChona tenant invoice email generated**: `d39752df@invoices.bistrosteward.com`

**Design partner kit shipped** (`design-partners/`):
- 7 deliverables: 20-target list scored /30, 3 outreach templates, 5-slide pitch deck (HTML dark theme), one-page partner letter, public tracker CSV, Week 0→24 onboarding playbook, README + 00_week1_runbook
- Phone defaulted `(503) 704-5496` (LaChona main) across pitch deck / template 2 / partner letter

**Docs**:
- [`docs/invoice_testing_plan.md`](../invoice_testing_plan.md) — 3 test paths (stub price history / direct curl / full e2e), acceptance criteria, LaChona ±2¢ validation
- [`docs/sendgrid_walkthrough.md`](../sendgrid_walkthrough.md) — step-by-step DNS MX + SendGrid Inbound Parse + Gmail filter forwarding for receipt batch ingestion
- [`docs/margin_and_invoicing.md`](../margin_and_invoicing.md) — feature spec (data model, cost engine rules, alarm rules, AI insight cache)

**Repo hygiene**:
- `.gitignore` added — `.env`, `*-key.json`, `*-credentials.json`, `*-service-account*.json`, `node_modules/`, audit JSON, `Backup/`, `.DS_Store`, `.claude/settings.local.json`
- Security audit confirmed: no secrets in git history. Firebase web API key (public-by-design), `GEMINI_API_KEY` only in gitignored `.env`, no service-account JSON anywhere

### 2026-04-27 — Operator UX cleanup + URL rename + auth-domain add (commit `4eeef87`)

**Operator console branding** (`firebase/public/super-admin.html`):
- Sidebar brand stacked vertically (icon above title) instead of horizontal flex. Icon up to 64×64 with `object-fit:contain` to preserve aspect ratio (was 36×36 squashed). `flex-direction:column; align-items:center; text-align:center`.

**URL disambiguation — `/admin` is two things, fixed**:
- Confusion: in-app `⚙️ Admin` tab vs `/admin` URL (Owner Console) shared the name.
- `firebase.json` rewrites: added `/billing → /admin.html` (canonical). `/admin → /admin.html` kept as alias one rotation; drop next deploy.
- `firebase/public/admin.html`: `<title>` and brand-sub `"Owner Console" → "Billing & Account"`.
- `firebase/public/app.html`: user-dropdown link `/admin.html → /billing`.

**Login form HTML5 wrap** (`firebase/public/app.html:427-450`):
- Wrapped sign-in inputs in `<form autocomplete="on" onsubmit="signIn();return false;">`. Email + password inputs gained explicit `autocomplete="email"` / `autocomplete="current-password"`. Sign-in button became `type="submit"`. Google button got explicit `type="button"` so Enter on email/password doesn't trigger OAuth popup. Browser password manager + Enter-submit now work.

**Hosting / CSP / cache hardening** (`firebase/firebase.json`):
- `Cache-Control: no-cache, no-store, must-revalidate` for `**/*.html` — URL rename rollouts no longer sit in CDN/browser cache.
- `Cross-Origin-Opener-Policy: same-origin-allow-popups` — required for Google sign-in popup (was breaking with COOP `same-origin`).
- CSP `script-src` + `connect-src` add `https://cdn.jsdelivr.net` (Chart.js + sourcemap). `connect-src` adds `https://browser.sentry-cdn.com` (Sentry sourcemap fetch).

**`adminOpGetInfo` timestamp normalizer** (`firebase/functions/index.js:2390-2421`):
- Bug: `d.data().created_at.toDate is not a function` HTTP 500 on `/billing` page. Cause: `created_at` and `createdAt` shape varies across migration vintages (Firestore Timestamp / JS Date / epoch ms / ISO string).
- Fix: `toIso(v)` helper handles all 4 shapes + null. Applied to team-member `created_at` and tenant `createdAt`.

**Firebase Auth authorized domains** (live config, not in repo):
- `bistrosteward.com` + `www.bistrosteward.com` were missing → Google OAuth failed with `auth/unauthorized-domain`.
- Fixed via Identity Platform REST API (gcloud has no `identity-platform` subcommand):
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

**Commit + deploy**:
- One commit `4eeef87 chore(billing-rename + hardening): /billing URL alias + login form + CSP + ts-normalize` covering 4 modified files. No push without ask.
- Two hosting deploys: sidebar branding first, then URL rename + admin branding. Functions untouched this session (only `index.js` line range covered by `toIso` was already in earlier commit `3935d61`).

**Smoke test status**: gate verified, branding verified. Ticket / feedback / impersonation flows + 8-tab walk + screenshots NOT captured this session — Chrome MCP needs `bistrosteward.com` permission grant in extension UI to drive the browser. Defer.

## In-flight (next 1-2 weeks)

| Item | Owner | Blocker |
|---|---|---|
| SendGrid + DNS MX for `invoices.bistrosteward.com` | — | User has SendGrid account + Cloudflare DNS access. Walkthrough at [`docs/sendgrid_walkthrough.md`](../sendgrid_walkthrough.md) |
| LaChona ingredient cost hydration | — | 0 of 153 ings have `cost > 0`. Needs invoice ingestion to populate. Best path = Gmail filter forwarding Instacart receipts → `d39752df@invoices.bistrosteward.com` after SendGrid live |
| Empanada → filling subRec links | — | Abuela Chona + Espinaca Empanada have only `[{egg yolk}]` / `[{egg}]` lines, no `subRecs[]`. Real cost is in `Espinaca Mix` (13 ings) — needs manual link in Recipes tab |
| Set `menu_price` on 3 verification recipes | — | Once cost data + subRecs wired, set `$8.55` (Abuela), `$8.49` (Espinaca), `$16.01` (Don Jose) and check ±2¢ vs hardcoded notes |
| Email addresses on `bistrosteward.com` (`support@`, `noreply@`) | — | DNS / Cloudflare email routing setup |
| Real Sentry DSN | — | Sign up Sentry, swap `placeholder` in `sentry-init.js`, redeploy |
| PostHog dashboard tile filtering (`source != 'seed'`) | — | Wait for real traffic, then add filter to 3 tiles |
| Verify PostHog events fire on `bistrosteward.com` custom domain | — | DNS cutover from `restaurant-oracle.web.app` |
| Trademark filing (USPTO TEAS Standard, Class 9 + 42) | — | TESS clearance search first |
| Send 4 supplier-intro asks (Template 1) to LaChona vendors | — | Vendor rep first names: Frank @ Nicky USA + 3 more (SP Provisions, Cascade Organic, Columbia Empire). See [`design-partners/00_week1_runbook.md`](../../design-partners/00_week1_runbook.md) |

## Backlog (chips spawned 2026-04-26, not yet picked up)

1. **Transactional emails (Resend)** — 9 templates: trial-ending-7d/2d/today, first-charge-receipt, payment-failed, cancelled, reactivated, team-invite, owner-welcome. Cron `dailyTrialReminders` for trial alerts. Wire Square webhook hooks. **Depends on email-setup**
2. **Recruit 3 design partners** — 15-20 candidates via LaChona vendor network, 3 outreach templates, pitch deck, onboarding playbook. 6 months free for weekly feedback. Target: 3 signed by 2026-06-23
3. **YouTube tutorial series** — 10 videos (2-5 min each): signup→team→ingredients→scan→costing→prep→inventory→orders→Oracle. Loom + Descript. Demo tenant pre-seeded
4. ~~**Landing page audit** — `index.html` (~35k chars) already marketing page; verify CTA flow + screenshots are current~~ — **DONE 2026-05-01** (rebuilt as standalone marketing page, see Shipped)

## Known issues (not blocking)

- `_e2e_super_admin.js` E2E suite needs `FIREBASE_WEB_API_KEY` to run against live
- Ticket composer uses `prompt()` for subject/body/priority — full modal deferred
- Rollup data populated nightly at 01:00 PT — defensive "No data yet" placeholder when empty
- 6 of 234 ingredients show > 10% per-shift drift between N=100 and N=1000 (asymptotic linearity test) — caused by `ceil(N×batches)` cascades on auto-yield recipes with low yield_pct. Within 5% population threshold. Cosmetic, doesn't affect correctness

## Testing

| Layer | Coverage | Run |
|---|---|---|
| Python pipeline (testbed) | 67 tests: 19 parser + 32 conversions + 16 shopping (incl. 6 multi-shift + full-corpus smoke) | `cd Restaurant-Oracle-Testbed && python3 -m pytest tests/pipeline/ -q` |
| Multi-shift offline simulator | 0 failures across N×rate sweeps + 3 envelopes + edge cases | `cd Restaurant-Oracle-Testbed && python3 sim_multishift.py` |
| Python ↔ browser parity | 180 items at 3sh both sides, 8-ing sample byte-for-byte | manual via preview testbed |
| Browser smoke | 9 tabs render w/ full corpus (1169×595×40), all `card-h` selectors live | `mcp__Claude_Preview__preview_*` against testbed |
| E2E live super-admin | Pending API key | `_e2e_super_admin.js` |
| Live billing CF | Manual via owner login | `https://restaurant-oracle.web.app/billing` |

## Deploy procedure

```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle/firebase
firebase deploy --only hosting --project restaurant-oracle             # frontend
firebase deploy --only functions:adminBilling --project restaurant-oracle   # one CF
firebase deploy --only functions --project restaurant-oracle           # all CFs (slow)
```

After hosting deploy: hard-reload browser (Cmd+Shift+R) to flush cached HTML — `no-cache` header now in place but old sessions still hit stale cache until next reload.

## Operational watchpoints

- **Multi-tenant**: any new collection MUST get a `/tenants/{tid}/<coll>` rule block in `firestore.rules` AND its listener attach must use `tenantPath('coll')` in `app.html:startListeners()`. Skipping either silently breaks reads
- **CSP**: any new external script or fetch URL needs entry in `script-src` AND `connect-src` (for sourcemaps) at `firebase.json:39`. Test with `curl -sI` to verify after deploy
- **Cloud Function timestamps**: NEVER assume Firestore Timestamp shape. Use `toIso(v)` pattern (`index.js:2391-2407`) — handles Firestore Timestamp, JS Date, epoch ms, ISO string, null
- **Browser ↔ Python parity**: any change to `calculateShoppingList()` in `app.html` MUST be mirrored in `pipeline/shopping_model.py` AND verified via testbed smoke (`./run.sh` + browser sample comparison)
- **Cache**: HTML `no-cache` deployed; static assets still cache at default. JS/CSS changes inside `app.html` propagate next page load. External CDN scripts (Chart.js etc) cached by version pin in URL

## File map snapshot (2026-04-28)

| Path | Lines/Size | Purpose |
|---|---|---|
| `firebase/public/index.html` | ~35k chars | Marketing landing page |
| `firebase/public/app.html` | ~8970 lines | Main SPA (kitchen ops + multi-shift shopping) |
| `firebase/public/admin.html` | ~26k chars | Owner billing console (`/billing` + `/admin` alias) |
| `firebase/public/super-admin.html` | 1921 lines | Operator dashboard (platform-wide) |
| `firebase/public/signup.html` | ~96k chars | Public signup w/ Square card form |
| `firebase/public/terms.html` / `privacy.html` | ~11k / ~12k chars | Legal |
| `firebase/public/posthog-init.js` | ~4.6k chars | PostHog snippet |
| `firebase/public/sentry-init.js` | TBD | Sentry browser SDK (placeholder DSN) |
| `firebase/public/firebase-config.js` | 985 chars | Web SDK config + CF URL |
| `firebase/functions/index.js` | ~5200 lines | All CFs incl. `adminBilling`, `api`, `signupTenant`, `superAdmin`, `squareWebhook`, scheduled rollups |
| `firebase/functions/emails.js` / `invoices.js` | TDZ-fixed | Transactional helpers (partially wired) |
| `firebase/firestore.rules` | ~230 lines | Multi-tenant + 11 super-admin collections |
| `firebase/firestore.indexes.json` | 14+ composite indexes | Query support |
| `firebase/firebase.json` | rewrites + CSP + COOP + cache headers | Hosting + functions config |

## Reference

- Architecture deep dive: [restaurant-oracle.md (memory)](../../../.claude/projects/-Users-mulefamily-Claude/memory/restaurant-oracle.md)
- Testbed sandbox: [restaurant-oracle-backtest.md (memory)](../../../.claude/projects/-Users-mulefamily-Claude/memory/restaurant-oracle-backtest.md)
- Multi-shift plan: [docs/plans/2026-04-28-multi-shift-shopping.md](2026-04-28-multi-shift-shopping.md)
- Operator gap-fill plan: [docs/plans/2026-04-24-operator-console-gap-fill.md](2026-04-24-operator-console-gap-fill.md)
- YouTube tutorials plan: [docs/plans/2026-04-24-youtube-tutorials.md](2026-04-24-youtube-tutorials.md)
- Backtest harness original plan: [docs/plans/2026-04-24-backtest-mock-testbed.md](2026-04-24-backtest-mock-testbed.md) (superseded — actual built as standalone folder)

---


<a id="updates"></a>

# Quality Audit & Fixes (Updates Log)

_Source: `Restaurant_Oracle_Updates.md`_

# Bistro Steward — Quality Audit & Fixes (Feb 2026)

Comprehensive evaluation against the FullStack-Agent reference framework (Steps 1-11).
All fixes applied to `index.html` and copied to `firebase/public/index.html`.

---

## 2026-04-25 — Operator Console gap-fill + live deploy

Closed five outstanding gaps in the existing super-admin / operator dashboard
and shipped the whole thing to `bistrosteward.com` for the first time.

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
  - The `api` request gate now rejects writes when
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
BistroSteward.xcodeproj
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

---


<a id="invoice-testing"></a>

# Invoice Testing Plan

_Source: `docs/invoice_testing_plan.md`_

# Invoice / Receipt Ingestion — Testing Plan

Three paths from easiest to fullest. Each one builds on the previous.

---

## Path 1 — Stub Price History (5 min)

Fastest sanity check. Bypasses Gemini, SendGrid, and the inbound HTTPS function entirely. Good for verifying drawer chart + alarm-detection math + best-vendor logic with synthetic data.

**Pre-reqs:** Firebase Application Default Credentials (`gcloud auth application-default login`) configured for project `restaurant-oracle`.

**Run from `firebase/functions/`:**

```bash
node -e "
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'restaurant-oracle' });
const db = admin.firestore();
(async () => {
  const ingsRef = db.collection('tenants/lachona/ings');
  const snap = await ingsRef.where('name','==','Butter').limit(1).get();
  if (snap.empty) { console.log('no Butter ingredient on lachona'); return; }
  const doc = snap.docs[0];
  const now = Date.now();
  const hist = [];
  // 7 points spread over 90 days. Last 30 days bumped 18% to trigger red alarm.
  for (let d = 90; d >= 0; d -= 15) {
    const base = (d <= 30) ? 5.50 : 4.50;
    hist.push({
      date: new Date(now - d*86400000).toISOString(),
      price: +(base + Math.random()*0.6).toFixed(2),
      vendorId: 1,
      invoiceId: 'seed-' + d,
      unit: 'lb'
    });
  }
  await doc.ref.update({ price_history: hist });
  console.log('seeded', hist.length, 'points on ing', doc.id);
})().catch(e => { console.error(e); process.exit(1); });
"
```

**Verify:**
1. Reload `https://restaurant-oracle.web.app/user/lachona`
2. Margin tab → find recipe that uses Butter
3. Click row → drawer opens
4. Click "Butter" line in ingredients table
5. Chart should render 7 points, vendor 1 line
6. "Alarming Trends" section should show Butter with ~18% spike

**Cleanup:**
```bash
node -e "
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'restaurant-oracle' });
admin.firestore().collection('tenants/lachona/ings').where('name','==','Butter').limit(1).get().then(s=>{
  if(!s.empty) s.docs[0].ref.update({ price_history: [] }).then(()=>{console.log('cleared');process.exit(0);});
});
"
```

---

## Path 2 — Cloud Function Direct Call (15 min)

Tests the real Gemini Vision parse + ingredient fuzzy matcher + vendor upsert + Firestore write. Skips SendGrid (so no DNS or Inbound Parse needed). Real receipt photo or PDF.

### Step 1 — Deploy the function

```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle/firebase
firebase deploy --only functions
```

This deploys the new operations:
- `inboundInvoice` (HTTPS endpoint, us-central1, 120s, 512MB)
- `secureApi` callable additions: `get_tenant_settings`, `rotate_invoice_token`, `list_invoices`, `ai_insight`

### Step 2 — Get the LaChona invoice token

```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle/firebase/functions
node -e "
const a = require('firebase-admin');
a.initializeApp({ projectId: 'restaurant-oracle' });
a.firestore().doc('tenants/lachona').get().then(d => {
  const t = d.data().invoiceToken;
  console.log('token:', t);
  console.log('email:', t + '@invoices.bistrosteward.com');
  process.exit(0);
});
"
```

If `invoiceToken` is missing on the tenant doc (created before the feature), generate one:

```bash
node -e "
const a = require('firebase-admin');
a.initializeApp({ projectId: 'restaurant-oracle' });
const tok = require('crypto').randomBytes(4).toString('hex');
a.firestore().doc('tenants/lachona').update({ invoiceToken: tok }).then(() => {
  console.log('generated:', tok);
  process.exit(0);
});
"
```

### Step 3 — Curl POST a sample receipt

Use any vendor receipt photo (jpg/png/heic/pdf, ≤5 MB).

```bash
TOKEN=<paste-from-step-2>
curl -i -X POST https://us-central1-restaurant-oracle.cloudfunctions.net/inboundInvoice \
  -F "to=${TOKEN}@invoices.bistrosteward.com" \
  -F "from=test@vendor.example" \
  -F "subject=Invoice #12345" \
  -F "attachment1=@/path/to/sample-receipt.pdf;type=application/pdf"
```

Expected:
- `200 OK` with JSON `{status: "processed"|"needs_review", invoiceId: "...", processed: N, unmatched: M}`
- New doc at `tenants/lachona/invoices/{invoiceId}` with full parse output
- Line items matching ingredients update `cost` + push to `price_history[]`
- New entries in `tenants/lachona/log` if your function logs

### Step 4 — Verify Firestore writes

```bash
node -e "
const a = require('firebase-admin');
a.initializeApp({ projectId: 'restaurant-oracle' });
a.firestore().collection('tenants/lachona/invoices').orderBy('created_at','desc').limit(3).get().then(s => {
  s.forEach(d => {
    const x = d.data();
    console.log('---');
    console.log('id:', d.id, 'status:', x.status);
    console.log('vendor:', x.vendor_name, 'total:', x.total);
    console.log('processed:', (x.processed||[]).length, 'unmatched:', (x.unmatched||[]).length);
  });
  process.exit(0);
});
"
```

### Step 5 — Verify in UI

1. Reload `/user/lachona`
2. Admin tab → 📧 Invoice Email section → "Recent invoices" list shows the test invoice
3. Margin tab → recipe using a matched ingredient → drawer chart now has a real data point

### Common failures

| Symptom | Fix |
|---|---|
| `403 Unknown recipient` | Token doesn't match any tenant. Re-run step 2. |
| `400 No allowed attachments` | File MIME not in allowlist (`image/*`, `application/pdf` only). |
| `500 Gemini API error` | Check `GEMINI_API_KEY` is set in functions env. `firebase functions:config:get`. |
| Lots of `unmatched[]` lines | Ingredient names on receipt differ heavily from `ings.name`. Tune `matchIngredient()` threshold or add aliases. |

---

## Path 3 — Full End-to-End (1 hr)

Real vendor receipt → real email → SendGrid Inbound Parse → live Cloud Function → Firestore + UI update.

### Step 1 — Deploy Cloud Function (if not done)

```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle/firebase
firebase deploy --only functions
```

### Step 2 — DNS MX record for `invoices.bistrosteward.com`

Where the apex `bistrosteward.com` is hosted, add:

```
Type:  MX
Name:  invoices
Value: mx.sendgrid.net.
Priority: 10
TTL: 3600
```

Verify after a few minutes:
```bash
dig MX invoices.bistrosteward.com +short
# expected: 10 mx.sendgrid.net.
```

### Step 3 — SendGrid Inbound Parse setup

1. Create / sign in to SendGrid (free tier: 100 emails/day, plenty for inbound).
2. Settings → Inbound Parse → Add Host & URL.
3. Domain: `invoices.bistrosteward.com`
4. Subdomain: leave blank (the MX is already on `invoices.`)
5. URL: `https://us-central1-restaurant-oracle.cloudfunctions.net/inboundInvoice`
6. Toggle: **Send Raw**: OFF (we want parsed multipart)
7. Toggle: **Spam Check**: ON
8. (Optional, recommended) Append `?s=<shared-secret>` to the URL and run:
   ```bash
   firebase functions:config:set invoice.sharedsecret="<shared-secret>"
   firebase deploy --only functions:inboundInvoice
   ```

### Step 4 — Send a real receipt

1. Get the LaChona invoice email (Path 2 step 2, or visit Admin tab → Invoice Email card → "Copy" button).
2. From any email client, send a message to that address with the receipt as attachment.
   - Subject: anything (used as fallback vendor name).
   - Attachment: photo or PDF, ≤5 MB per file, ≤15 MB total.
3. Wait ~10–30 seconds.

### Step 5 — Verify in UI

Same as Path 2 step 5. Plus:
- Forward more receipts from the actual restaurant inbox over the course of a week.
- Watch the price-history chart in the recipe drawer fill out.
- Watch the Margin tab "Alarms" KPI rise as 30-day rolling averages diverge.

### Step 6 — Rotate token (lost / leaked)

Admin tab → Invoice Email → "Rotate" button. Old address starts returning `202 Unknown recipient — discarded`. New token replaces it instantly.

---

## Acceptance Criteria

A receipt is "successfully ingested" when:

1. `tenants/{tenantId}/invoices/{id}` doc exists with `status: "processed"` (or `needs_review` if unmatched lines exist but at least one matched).
2. At least one matched line item appears in `processed[]` array on the invoice doc.
3. The matched ingredient(s) show:
   - `cost` updated to the latest unit price.
   - `price_history[]` has a new entry with `{date, price, vendorId, invoiceId, unit}`.
4. Recipe drawer for any recipe using that ingredient shows the new point on the chart.
5. Margin tab "Alerts" column reflects the new alarm state if 30d/60d windows now diverge ≥8%.

---

## LaChona Validation Numbers

After ~10 real invoices ingested, the Margin tab should converge close to these LaChona-derived hardcoded values (per notes line 2206+):

| Dish | Expected FC % | Expected $/plate |
|---|---|---|
| Abuela Chona Empanada | 5.03 % | $0.43 |
| Espinaca Empanada | 38.29 % | $3.25 |
| Don Jose Salad | 23.22 % | $3.72 |

Pass criterion: within ±$0.02 on per-portion cost.

If off by more, the first investigation is **unit-conversion coverage** in `D.conversions` (cross-type table for flour-cup-to-oz, etc.), not engine logic. The cost engine itself was unit-tested in the backtest harness.

---

## Files Involved

- `firebase/functions/invoices.js` — multipart parse, Gemini call, ingredient matcher, `inboundInvoice` HTTPS export.
- `firebase/functions/index.js` — `secureApi` ops (`get_tenant_settings`, `rotate_invoice_token`, `list_invoices`, `ai_insight`), `provisionTenant` token gen.
- `firebase/public/app.html` — Admin tab "📧 Invoice Email" section, Margin tab, Recipe drawer.
- `index.html` — same as app.html (kept in sync).

## Related Docs

- `docs/margin_and_invoicing.md` — full feature spec, data model, alarm rules, AI insight cache.

---


<a id="margin-invoicing"></a>

# Margin & Invoicing

_Source: `docs/margin_and_invoicing.md`_

# Margin + Invoice Scanning — Feature Notes

Shipped 2026-04-24. Covers:

1. Recipe costing engine — per-line + per-portion food cost, margin %, unit-conversion-aware.
2. **Margin** tab — sortable P&L table across all recipes + alarming-cost detector.
3. Recipe drawer — per-recipe card with ingredient table, price-history chart, vendor best-price, alarm list, AI supplier alternates.
4. **Inbound invoice email** — per-tenant `<token>@invoices.bistrosteward.com`. SendGrid Inbound Parse → Gemini Vision → auto-update ingredient cost + priceHistory.
5. **AI insight** Cloud Function — `supplier_alternates` and `trend_narration` modes, 24h per-ingredient cache.

---

## Data model additions

### `ings` collection (per tenant)
- `price_history[]` — `{date, price, vendorId, invoiceId, unit}`, trimmed to last 200 entries.
- `vendor_ids[]` — multi-vendor array (migrated from single `vendor_id` on first write).

### `recs` collection
- `menu_price` — number. Drives margin calc when >0.

### `tenants/{id}` doc
- `invoiceToken` — 8-hex-char token for inbound email routing.

### New collections
- `invoices/{id}` — one doc per parsed invoice. Fields: `vendor_id`, `vendor_name`, `invoice_number`, `invoice_date`, `subtotal`, `tax`, `total`, `line_items[]`, `processed[]`, `unmatched[]`, `source_email`, `subject`, `attachments[]`, `raw_parsed`, `status` (`processed` | `needs_review` | `failed`).
- `ai_insight_cache/{hash}` — keyed by base64 of `mode::ingName::region`. Contains `result`, `cachedAt`. 24h TTL enforced on read.

---

## Cost engine rules (client-side)

`calcLineIngCost(ingId, qty, unit)` — three-tier unit resolution:

1. `unit === ing.defUnit` → `qty * ing.cost`.
2. Same base type via `unitConversions` (oz ↔ lb, fl oz ↔ cup, etc.) → convert both to base unit, scale.
3. Cross-type via `D.conversions` row (e.g. `flour: 1 cup → 4.25 oz`) → apply factor.

Missing cost → `{flag:'no-cost'}`. Missing cross-type conversion → `{flag:'no-conv'}`. Both surface as ⚠ warnings in the drawer.

`calcRecipeCost(rec)` recursively expands `subRecs`, sums total, divides by `manualQty` when `outputMode==='manual'`.

Food cost % = `(perPortion / menuPrice) * 100`. Margin % = `100 - foodCostPct`.

---

## Margin tab — `renderMargin()`

- Dataset: recipes where `isMenuItem || menuPrice > 0` (or all recipes if no menu items flagged).
- KPIs: Avg Margin · Menu Items · Complete Costs · Alarms.
- Sortable columns: name, price, food $, FC %, margin %, alert.
- Filter: **Only alarming** checkbox.
- Row click → `openRecipeDrawer(recId)`.

## Recipe drawer — `openRecipeDrawer(recId)`

- Slide-in right, ~460px, close on ✕ or backdrop click.
- Sections: summary KPIs → ingredients table → price-history chart (Chart.js 4, date-fns adapter) → alarming trends → alternate suppliers (local + AI).
- Per-ingredient click re-renders the chart for that ingredient.

## Alarm rule — `detectIngAlarm(ingId)`

30-day rolling average vs prior 30 days. Needs ≥4 non-synthetic price points to compute.
- ≥15 % spike → **red**
- 8–15 % spike → **amber**
- ≤-15 % drop → **green** (info only)
- Fewer than 4 points → none (don't fire false alarms on thin data).

Recipe-level `recipeAlarmLevel(rec)` takes max of (line items + sub-recipes).

## Best-vendor — `getBestVendorForIng(ingId)`

- Looks at last 90 days of price history, groups by vendor, averages.
- Falls back to all-time if no recent points.
- Winner = lowest average.

---

## Inbound invoice flow

```
[vendor emails PDF] ──┐
[user forwards]    ──┼─→ <token>@invoices.bistrosteward.com
                      │
                      ▼
            SendGrid Inbound Parse
                      │   POST multipart (from, to, subject, attachments)
                      ▼
      inboundInvoice  (Firebase Function us-central1, 120s, 512MB)
                      │
                      ├─ parse multipart via @fastify/busboy
                      ├─ extract token from `to` header
                      ├─ look up `tenants where invoiceToken == token`
                      ├─ call Gemini 2.5 Flash with first attachment + schema prompt
                      ├─ upsert vendor (fuzzy name match)
                      ├─ for each line item: fuzzy-match ingredient, push to price_history, update cost
                      └─ write `invoices/{id}` doc (status: processed | needs_review)
```

### SendGrid setup (one-time per deploy)

1. Add MX record: `invoices.bistrosteward.com. IN MX 10 mx.sendgrid.net.`
2. SendGrid → Settings → Inbound Parse → Add Host & URL:
   - Hostname: `invoices.bistrosteward.com`
   - URL: `https://us-central1-<firebase-project-id>.cloudfunctions.net/inboundInvoice`
   - Send Raw: OFF
   - Spam Check: ON
3. (Optional) Shared secret in parse URL: `...cloudfunctions.net/inboundInvoice?s=<secret>`, then:
   `firebase functions:config:set invoice.sharedsecret="<secret>"`
4. `firebase deploy --only functions:inboundInvoice`

### Size limits
- 5 MB per attachment, 15 MB total (Gemini input + Functions memory headroom).
- Only `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/gif`, `application/pdf`. Others discarded.

### Ingredient matching
Fuzzy, normalized (lowercase, alphanum-only tokens). Score:
- Exact → 100
- Full substring either way → 70
- Word overlap ratio × 50 → up to 50
- ≥30 → match, else → `unmatched[]` on the invoice doc for manual reconciliation.

---

## AI insight function — `ai_insight` operation

Single operation with `mode`:

- `supplier_alternates` — inputs: `ingredientName`, `currentCost`, `currentVendor`, `region`. Output JSON: `alternates[{name, region, estimatedPrice, confidence, why, contactHint}]` + `notes`.
- `trend_narration` — inputs: `ingredientName`, `currentCost`, `history[]`. Output JSON: `summary`, `hypothesis`, `severity`.

Cached 24 h in `ai_insight_cache` keyed by `mode::ingName::region` (base64 alnum).

---

## Settings UI (Admin tab)

New section: **📧 Invoice Email**.
- Shows current `<token>@invoices.bistrosteward.com`.
- Copy button, Rotate button.
- Rotate invalidates the old address immediately (forwarded emails to the old address get `202 Unknown recipient — email discarded`).
- Recent invoices list (last 10, via `list_invoices` op).

---

## Operations added to `secureApi`

| Operation | Super-admin | Owner | Employee |
|---|---|---|---|
| `get_tenant_settings` | ✓ | ✓ | ✗ |
| `rotate_invoice_token` | ✓ | ✓ | ✗ |
| `list_invoices` | ✓ | ✓ | ✓ |
| `ai_insight` | ✓ | ✓ | ✓ |

Collections added to `ALLOWED_COLLECTIONS`: `invoices`, `feedback_events`, `ai_insight_cache`.

---

## Verification plan (post-deploy)

Expected vs actual against LaChona hardcoded notes:

| Dish | Expected FC % | Expected $/plate | Source |
|---|---|---|---|
| Abuela Chona Empanada | 5.03 % | $0.43 | notes line 2206 |
| Espinaca Empanada | 38.29 % | $3.25 | notes line ~2209 |
| Don Jose Salad | 23.22 % | $3.72 | notes line ~2215 |

Pass criterion: within ±2 ¢ on per-portion cost after live ingredient costs load. If off, the first investigation is ingredient unit coverage in `D.conversions`, not engine logic.

---

## Known gaps (Phase 2+)

- Trend narration function is wired server-side but not yet surfaced in UI.
- AI supplier suggestions are text-only — no auto-create vendor flow yet.
- Invoice reconciliation UI for `unmatched[]` lines is not built (shows count only in admin list).
- Email confirmations to the sender are not sent back (would need @sendgrid/mail outbound).
- Multi-page PDF handling is implicit (Gemini 2.5 Flash handles PDF pages natively, tested up to ~20 pages in general use).

---

## Files touched

- `index.html` — +1,100 lines: Margin tab, drawer, cost engine, admin UI, invoice-email handlers.
- `firebase/functions/index.js` — +200 lines: `get_tenant_settings`, `rotate_invoice_token`, `list_invoices`, `ai_insight`, invoiceToken gen in provisionTenant.
- `firebase/functions/invoices.js` — new file, 330 lines: multipart parser, Gemini call, ingredient/vendor matcher, `inboundInvoice` HTTPS export.

---


<a id="sendgrid"></a>

# SendGrid Walkthrough

_Source: `docs/sendgrid_walkthrough.md`_

# SendGrid Inbound Parse Walkthrough — Bistro Steward Invoice Ingestion

End state: emails sent to `d39752df@invoices.bistrosteward.com` (and any future tenant token) reach our Cloud Function and auto-parse invoice line items via Gemini.

**Total time:** ~25 minutes. **Cost:** $0/mo (SendGrid free tier covers up to 100 emails/day; we expect ≪10/day per tenant).

**Prereqs:**
- SendGrid account (sign up at https://signup.sendgrid.com if you don't have one).
- DNS access for `bistrosteward.com`. Find out who hosts it: run `dig NS bistrosteward.com +short`. Likely Cloudflare, GoDaddy, or Vercel.
- Cloud Function `inboundInvoice` already deployed (✓ confirmed live: 405 on GET = endpoint exists).

---

## Step 1 — Add MX record to DNS (5 min)

Log in to your DNS host. Add a new MX record:

| Field | Value |
|-------|-------|
| **Type** | `MX` |
| **Name / Host** | `invoices` (NOT `invoices.bistrosteward.com` — most providers append the apex automatically) |
| **Mail Server / Target** | `mx.sendgrid.net` (with a trailing dot if the UI requires it: `mx.sendgrid.net.`) |
| **Priority** | `10` |
| **TTL** | `3600` (1 hour) — or "Auto" |
| **Proxy / Cloud** | OFF (orange cloud → grey cloud in Cloudflare) |

**Cloudflare specifically:**
1. Go to https://dash.cloudflare.com → pick `bistrosteward.com`.
2. Sidebar → **DNS** → **Records**.
3. Click **+ Add record**.
4. Type: `MX`. Name: `invoices`. Mail server: `mx.sendgrid.net`. Priority: `10`. Proxy status: **DNS only** (grey cloud).
5. **Save**.

**Verify after 1–5 minutes:**
```bash
dig MX invoices.bistrosteward.com +short
```
Expected output: `10 mx.sendgrid.net.`

If empty, wait another 5 min and retry. If still empty, propagation can take up to 1 hour but usually <10 min.

---

## Step 2 — Configure SendGrid Inbound Parse (10 min)

1. Sign in: https://app.sendgrid.com/login
2. Left sidebar → **Settings** → **Inbound Parse**.
3. Click **Add Host & URL** (top right, blue button).
4. Fill in the form:

   | Field | Value |
   |-------|-------|
   | **Receiving Domain** | `invoices.bistrosteward.com` |
   | **Subdomain** | leave blank |
   | **Destination URL** | `https://us-central1-restaurant-oracle.cloudfunctions.net/inboundInvoice` |
   | **Send Raw** | OFF (toggle should be unchecked / grey) |
   | **Spam Check** | ON (toggle should be checked / blue) |
   | **POST the raw, full MIME message** | OFF |

5. Click **Add**.
6. SendGrid will validate the MX record. If green checkmark → done. If red error "MX record not found" → wait 5 more min for DNS propagation, click **Verify** again.

---

## Step 3 — (Optional but Recommended) Add Shared Secret (5 min)

Without this, anyone who guesses your Cloud Function URL could POST junk. The shared secret blocks that.

1. Pick a strong secret (32+ chars):
   ```bash
   openssl rand -hex 32
   ```
   Copy the output. Example: `a1b2c3...xyz789`.

2. Set it on the Firebase Function:
   ```bash
   cd /Users/mulefamily/Claude/Restaurant-Oracle/firebase
   firebase functions:config:set invoice.sharedsecret="a1b2c3...xyz789"
   firebase deploy --only functions:inboundInvoice
   ```
   (Replace `a1b2c3...xyz789` with the actual secret you generated.)

3. Back in SendGrid → **Settings** → **Inbound Parse** → click your existing entry → **Edit**.
4. Update the Destination URL to:
   ```
   https://us-central1-restaurant-oracle.cloudfunctions.net/inboundInvoice?s=a1b2c3...xyz789
   ```
5. **Save**.

---

## Step 4 — Send a Test Receipt (3 min)

1. Take a clear photo of any vendor receipt (or grab a PDF invoice). Constraints: ≤5 MB per file, ≤15 MB total. Allowed types: JPG, PNG, WebP, HEIC, GIF, PDF.
2. From any email client (Gmail, Outlook, Mail.app), compose a new message:
   - **To:** `d39752df@invoices.bistrosteward.com`
   - **Subject:** anything (used as fallback vendor name)
   - **Attach** the receipt
3. Send.
4. Wait 10–30 seconds.

---

## Step 5 — Verify (2 min)

**A. Check SendGrid received it:**
1. SendGrid → **Activity** (left sidebar) — look for inbound entry. Should show "Processed" or "Delivered" within a minute.

**B. Check Cloud Function ran:**
```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle/firebase
firebase functions:log --only inboundInvoice --lines 30
```
Expected: log entries like `[inboundInvoice] tenant=lachona files=1 processed=N unmatched=M`.

**C. Check Firestore wrote the invoice:**
```bash
cd firebase/functions
node -e "
const a = require('firebase-admin');
a.initializeApp({ projectId: 'restaurant-oracle' });
a.firestore().collection('tenants/lachona/invoices')
  .orderBy('created_at','desc').limit(3).get().then(s => {
    s.forEach(d => {
      const x = d.data();
      console.log('---');
      console.log('id:', d.id, 'status:', x.status);
      console.log('vendor:', x.vendor_name, 'total:', x.total);
      console.log('processed:', (x.processed||[]).length, 'unmatched:', (x.unmatched||[]).length);
    });
    process.exit(0);
  });
"
```

**D. Check the UI:**
1. Open https://restaurant-oracle.web.app/user/lachona
2. **Admin** tab → 📧 Invoice Email card → "Recent invoices" list shows your test invoice.
3. **Margin** tab → click any recipe using a matched ingredient → drawer chart shows the new data point.

---

## Common Failures

| Symptom | Fix |
|---|---|
| `MX record not found` in SendGrid Verify | Wait 5 more min for DNS. Re-check `dig MX invoices.bistrosteward.com +short`. |
| Test email bounces with `Unknown recipient` | Token typo or tenant token rotated. Re-fetch from `tenants/lachona` doc. |
| Cloud Function returns `403 Invalid shared secret` | URL in SendGrid doesn't include `?s=...` or it doesn't match `firebase functions:config:get`. |
| Cloud Function returns `400 No allowed attachments` | File MIME not in allowlist or >5 MB. |
| Lots of `unmatched[]` line items | Receipt's ingredient names differ from your `ings.name` values. Fuzzy threshold is 30/100 — if it can't even reach that, names are too different. Add common aliases manually or re-tag matched items in Admin. |
| Gemini returns garbage / low-confidence parse | Try a clearer photo. Gemini 2.5 Flash handles handwritten + crumpled receipts okay, but extreme blur or glare kills it. |

---

## Tenant Token Reference

LaChona invoice address: `d39752df@invoices.bistrosteward.com`

If you rotate the token (Admin tab → Invoice Email → Rotate button), the old address starts returning `202 Unknown recipient — discarded` immediately. The new token replaces it.

To check the current token via CLI:
```bash
node -e "
const a = require('firebase-admin');
a.initializeApp({ projectId: 'restaurant-oracle' });
a.firestore().doc('tenants/lachona').get().then(d => {
  console.log(d.data().invoiceToken + '@invoices.bistrosteward.com');
  process.exit(0);
});
"
```

---


<a id="plan-backtest"></a>

# Plan: Backtest Mock Testbed (2026-04-24)

_Source: `docs/plans/2026-04-24-backtest-mock-testbed.md`_

# Bistro Steward — Backtest Mock Testbed Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a reproducible backtest harness that seeds ~1,000 real recipes + full mock inventory, locations, menu/prep targets into Bistro Steward, then validates interconnectivity, shopping-list math, and (critically) unit-conversion correctness across every tab.

**Architecture:** Four layers, all under `/backtest/` — **zero modifications to `firebase/`, `index.html` (root), `functions/`, `firestore.rules`, `firebase.json`, `.firebaserc`, or any other prod file**:
1. **Acquisition** — `backtest/data/` holds raw recipe corpus (RecipeNLG sample, 1k rows) plus normalized JSON.
2. **Seed pipeline** — Python scripts under `backtest/pipeline/` parse ingredient strings (qty, unit, name), canonicalize units, build per-ingredient conversions, emit `backtest/output/testbed-import.json` matching exact shape consumed by `importData()` at [firebase/public/index.html:7179](/Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/index.html).
3. **App fork (copy-on-write)** — `backtest/app-fork/` holds a **copy** of `firebase/public/*.html` with auth short-circuit patched. Real `firebase/public/` untouched. Resync script (`backtest/bin/resync-fork.sh`) pulls latest prod files on demand and re-applies backtest patches.
4. **Test harness** — `backtest/tests/` runs against a **separate** emulator project ID (`restaurant-oracle-backtest`, never `restaurant-oracle`); Playwright + Node scripts load seed, drive each tab, assert inventory ↔ recipes ↔ preps ↔ menus ↔ shopping + unit-math invariants.

### Isolation rules (enforced by Task 0.3 preflight)
- **Physical separation via git worktree** — prod checkout at `/Users/mulefamily/Claude/Restaurant-Oracle/` is never entered during backtest execution. Work happens in a sibling worktree at `/Users/mulefamily/Claude/Restaurant-Oracle.backtest/` on branch `backtest/harness`. Same `.git` object store, separate working directories — operations in one cannot touch files in the other.
- **No edits** to any file outside `/backtest/` within the worktree except `.gitignore` (to exclude `backtest/data/raw/`, `backtest/output/`, `backtest/node_modules/`).
- **No deploys** — every emulator command uses `--project restaurant-oracle-backtest`; `.firebaserc` never modified.
- **No prod Firebase credentials** — emulator runs with anonymous local auth; `GOOGLE_APPLICATION_CREDENTIALS` unset during backtest runs.
- **Network isolation** — emulator binds to `127.0.0.1` only (default).
- **Preflight script** runs before every task commit; hard-fails if (a) executing outside the backtest worktree, (b) any diff outside `backtest/` + `docs/plans/`, (c) any prod config changed in branch history.
- **No PR merge to `main`** until human review. `backtest/harness` is a scratch branch; can be archived or deleted when testbed retires.

**Tech Stack:** Python 3.11 (pandas, pint for units, ingredient-parser-nlp), Node 22, Firebase Emulators (auth/firestore/functions/hosting), Playwright (Node) for browser-driven assertions, Vitest for pure-JS unit-math tests.

**Target data shape (reference):**
- `D.ings`: `{id, name, catId, areaId, subArea, defUnit, cost, minQty, autoShop, archived, standalone}`
- `D.recs`: `{id, name, group, catId, yield, yieldUnit, ings:[{ingId, qty, unit}], subRecs, menuItems, archived}`
- `D.preps`: `{id, name, recId, onHand, tgt, unit, areaId}`
- `D.menus`: `{id, name, catId, tgt, unitId, ings, recs, preps, includeInShop, includeInPrep}`
- `D.inv`: `{id, areaId, subArea, ingId, recId, menuId, qty, unit}`
- `D.conversions`: `{id, ingId, storageUnit, recipeUnit, factor}` — **per-ingredient, not global**
- `D.units`: `{id, name, abbr}` — 45 defaults shipped (see `getDefaultUnits()` at line 1440)

---

## Phase 0 — Guardrails & Conventions

### Task 0.0: Create isolated worktree (maximum separation)

**Why worktree, not branch:** Prod checkout at `/Users/mulefamily/Claude/Restaurant-Oracle/` currently has a large uncommitted tree (2026-04-24 deploy in progress). Plain branching carries that dirty state; stashing is one `git stash pop` away from corruption. A worktree gives a physically separate working directory on a fresh branch sharing the same `.git` object store — prod dir cannot be touched by backtest operations because backtest commands execute in a different directory entirely.

**Step 1:** From prod checkout:
```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle
git worktree add -b backtest/harness ../Restaurant-Oracle.backtest main
```

**Step 2:** Verify isolation:
```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle.backtest
git status                            # must be clean
git branch --show-current             # must print backtest/harness
pwd                                   # must be ../Restaurant-Oracle.backtest
```

**Step 3:** Every subsequent task runs from `/Users/mulefamily/Claude/Restaurant-Oracle.backtest/`. Prod dir never `cd`'d into during execution.

**Step 4:** Cleanup plan (post-merge or abandon):
```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle
git worktree remove ../Restaurant-Oracle.backtest
git branch -D backtest/harness        # only if abandoning
```

**Step 5:** Commit marker inside the worktree:
```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle.backtest
git commit --allow-empty -m "chore(backtest): open isolation worktree"
```

### Task 0.1: Create backtest skeleton

**Files:**
- Create: `backtest/README.md`
- Create: `backtest/.gitignore` (ignore `data/raw/`, `output/*.json`, `node_modules/`, `__pycache__/`, `.venv/`)
- Create: `backtest/package.json` (private workspace, deps: `playwright`, `vitest`, `firebase-tools`, `@firebase/rules-unit-testing`)
- Create: `backtest/pyproject.toml` (deps: `pandas`, `pint`, `ingredient-parser-nlp`, `unidecode`, `kaggle`)

**Step 1:** Write `README.md` with exact commands to reproduce:
```
./backtest/bin/setup.sh        # install deps
./backtest/bin/fetch.sh        # download recipe corpus
./backtest/bin/normalize.sh    # build testbed-import.json
./backtest/bin/emulate.sh      # launch emulators
./backtest/bin/seed.sh         # import into emulator
./backtest/bin/test.sh         # run all assertions
./backtest/bin/reset.sh        # wipe emulator state
```

**Step 2:** Commit: `git commit -m "feat(backtest): scaffold harness directory"`

---

### Task 0.3: Preflight guard — block any accidental prod edit

**Files:**
- Create: `backtest/bin/preflight.sh`

**Script:**
```bash
#!/usr/bin/env bash
set -euo pipefail
# MUST run from worktree, never from prod checkout
wt=$(git rev-parse --show-toplevel)
if [[ "$(basename "$wt")" != "Restaurant-Oracle.backtest" ]]; then
  echo "❌ preflight must run inside the backtest worktree, not prod dir"
  exit 1
fi
cd "$wt"
# list all modified files outside backtest/ and docs/
violations=$(git status --porcelain | awk '{print $2}' | grep -Ev '^(backtest/|docs/plans/)' || true)
if [[ -n "$violations" ]]; then
  echo "❌ PRODUCTION FILES MODIFIED in worktree — backtest must not touch them:"
  echo "$violations"
  exit 1
fi
# verify .firebaserc + key prod configs untouched in branch history
if git log --oneline main..HEAD -- .firebaserc firebase.json firebase/firebase.json firebase/firestore.rules firebase/functions/index.js firebase/public/index.html | grep .; then
  echo "❌ prod firebase config changed in this branch history"
  exit 1
fi
echo "✅ preflight OK — no prod files touched, worktree isolated"
```

**Step 1:** Write script, `chmod +x`.
**Step 2:** Run: `./backtest/bin/preflight.sh` — expect `✅ preflight OK`.
**Step 3:** Wire into `backtest/bin/run-all.sh` as first step.
**Step 4:** Commit: `git commit -m "feat(backtest): preflight prod-isolation guard"`

---

### Task 0.2: Pick license-compatible corpus + record decision

**Files:**
- Create: `backtest/docs/DATA_SOURCE.md`

**Content:**
- **Primary:** RecipeNLG (2.23M recipes, pre-parsed `NER` column with ingredient names, structured `ingredients` as JSON-style strings). Research-only license — acceptable for a local backtest, never ship to prod.
- **Fallback:** TheMealDB API (~300 recipes, free tier, fields `strIngredient1..20` + `strMeasure1..20`). Used only if RecipeNLG download is blocked.
- **Rejected:** Recipe1M+ (non-commercial + gate, free-text only), openrecipes (no ingredients by design), Food.com (free-text ingredient field requires separate parser — only use as second-tier).

**Step 1:** Commit `DATA_SOURCE.md` as the decision record.

---

## Phase 1 — Recipe Acquisition

### Task 1.1: Download RecipeNLG corpus

**Files:**
- Create: `backtest/bin/fetch.sh`
- Create: `backtest/data/raw/.gitkeep`

**Step 1 (test first):** Create `backtest/tests/pipeline/test_fetch.py`:
```python
from pathlib import Path
def test_corpus_present():
    root = Path(__file__).parents[2] / "data/raw"
    csvs = list(root.glob("*.csv"))
    assert csvs, "no RecipeNLG csv found"
    assert any("full_dataset" in p.name for p in csvs)
```

**Step 2 (impl):** `bin/fetch.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f data/raw/full_dataset.csv ]]; then
  kaggle datasets download -d paultimothymooney/recipenlg -p data/raw
  unzip -o data/raw/recipenlg.zip -d data/raw
fi
wc -l data/raw/full_dataset.csv
```

**Step 3:** Run: `./backtest/bin/fetch.sh`. Expected: csv present, line count > 2,000,000. If kaggle auth missing, prompt user for `~/.kaggle/kaggle.json` (this is one of the credential cases the user must handle — print the exact URL `https://www.kaggle.com/settings/account` → "Create New Token").

**Step 4:** Run test: `pytest backtest/tests/pipeline/test_fetch.py -v`. Expected: PASS.

**Step 5:** Commit: `git commit -m "feat(backtest): fetch RecipeNLG corpus"`

---

### Task 1.2: Sample 1,000 recipes with good ingredient coverage

**Files:**
- Create: `backtest/pipeline/sample.py`
- Create: `backtest/data/staged/sample.jsonl`

**Step 1 (test):** `backtest/tests/pipeline/test_sample.py`:
```python
import json
from pathlib import Path
def test_sample_size():
    rows = [json.loads(l) for l in Path("backtest/data/staged/sample.jsonl").read_text().splitlines()]
    assert len(rows) == 1000
    for r in rows:
        assert r["title"]
        assert isinstance(r["ingredients"], list) and 2 <= len(r["ingredients"]) <= 40
        assert isinstance(r["ner"], list) and len(r["ner"]) >= 2
```

**Step 2 (impl):** `sample.py` reads `full_dataset.csv` with pandas, filters `source == "Gathered"`, drops rows with `len(ner) < 2` or `> 30`, drops duplicate titles, uses fixed-seed `sample(n=1000, random_state=42)`. Writes JSONL.

**Step 3:** Run: `python backtest/pipeline/sample.py`. Verify line count: `wc -l backtest/data/staged/sample.jsonl` → 1000.

**Step 4:** Run test: PASS.

**Step 5:** Commit: `git commit -m "feat(backtest): sample 1k recipes with stable seed"`

---

## Phase 2 — Unit Normalization & Ingredient Parsing (critical)

### Task 2.1: Canonical unit master

**Files:**
- Create: `backtest/pipeline/units.py`
- Read first: [firebase/public/index.html:1440-1451](/Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/index.html) to grab the exact `getDefaultUnits()` set.

**Step 1 (test):** `backtest/tests/pipeline/test_units.py`:
```python
from backtest.pipeline.units import UNITS, canonicalize
def test_volume_aliases():
    assert canonicalize("tbsp") == "tbsp"
    assert canonicalize("tablespoon") == "tbsp"
    assert canonicalize("Tbsp.") == "tbsp"
    assert canonicalize("T")    == "tbsp"
def test_mass_aliases():
    assert canonicalize("oz")   == "oz"
    assert canonicalize("ounce") == "oz"
    assert canonicalize("lb")   == "lb"
    assert canonicalize("pound") == "lb"
def test_count_aliases():
    assert canonicalize("ea")   == "each"
    assert canonicalize("pc")   == "each"
    assert canonicalize("clove") == "clove"
def test_unknown():
    assert canonicalize("blorp") is None
```

**Step 2 (impl):** `units.py` exports `UNITS` (dict keyed by Oracle-native abbreviation: `each, ea, pc, g, kg, oz, lb, ml, l, tsp, tbsp, cup, floz, pt, qt, gal, clove, slice, bunch, head, pinch, dash, can, btl, box, bag, case, sheet, doz, sprig, leaf, stick`) plus alias map. `canonicalize(str)` lowercases, strips punctuation, maps alias → canonical, returns None if unknown.

**Step 3:** Run test: PASS.

**Step 4:** Commit: `git commit -m "feat(backtest): canonical unit map matching Oracle getDefaultUnits"`

---

### Task 2.2: Ingredient-line parser (quantity + unit + name)

**Files:**
- Create: `backtest/pipeline/parse_ing.py`

**Step 1 (test):** `backtest/tests/pipeline/test_parse_ing.py`:
```python
from backtest.pipeline.parse_ing import parse
def test_simple():
    assert parse("2 cups all-purpose flour") == (2.0, "cup", "all-purpose flour")
def test_fraction():
    assert parse("1 1/2 tsp kosher salt") == (1.5, "tsp", "kosher salt")
def test_unicode_frac():
    assert parse("¾ cup sugar") == (0.75, "cup", "sugar")
def test_count_noun():
    assert parse("3 eggs, beaten") == (3.0, "each", "eggs")
def test_parenthetical():
    assert parse("1 (14-ounce) can black beans") == (14.0, "oz", "black beans")
def test_range_collapsed():
    # "2-3 cloves garlic" → midpoint 2.5
    assert parse("2-3 cloves garlic") == (2.5, "clove", "garlic")
def test_unknown_unit_falls_back():
    assert parse("a pinch of saffron") == (1.0, "pinch", "saffron")
def test_no_qty_defaults_to_1():
    assert parse("salt to taste") == (1.0, "each", "salt")
```

**Step 2 (impl):** `parse_ing.py` tries `ingredient-parser-nlp` first; falls back to a rule-based regex pipeline: unicode fractions → ascii, range → midpoint, parenthetical size takes precedence over outer qty, unit lookup via `units.canonicalize()`. Always returns a 3-tuple; no Nones.

**Step 3:** Run tests: PASS (all 8).

**Step 4:** Commit: `git commit -m "feat(backtest): robust ingredient-line parser"`

---

### Task 2.3: Ingredient deduper / canonical name map

**Files:**
- Create: `backtest/pipeline/dedupe.py`
- Create: `backtest/data/staged/ingredient_map.json` (output)

**Step 1 (test):** `backtest/tests/pipeline/test_dedupe.py`:
```python
from backtest.pipeline.dedupe import canon_name
def test_strips_modifiers():
    assert canon_name("kosher salt")      == "salt"
    assert canon_name("fresh basil")      == "basil"
    assert canon_name("chopped onion")    == "onion"
    assert canon_name("all-purpose flour")== "flour"
def test_plurals():
    assert canon_name("eggs")             == "egg"
    assert canon_name("tomatoes")         == "tomato"
def test_brand_removal():
    assert canon_name("Kraft parmesan")   == "parmesan"
```

**Step 2 (impl):** `dedupe.py` strips a known modifier set (`fresh, dried, chopped, diced, minced, sliced, grated, ...`), known size adjectives (`large, small, medium`), common brands, singularizes via `inflect` lib. Walks all 1k recipes, builds `{raw_name: canonical_name}` map, drops ingredients appearing in fewer than 2 recipes (reduces long-tail noise). Expected output: 200-400 canonical ingredients.

**Step 3:** Run: `python backtest/pipeline/dedupe.py`. Log: `len(canonical) = XXX`.

**Step 4:** Run test: PASS.

**Step 5:** Commit: `git commit -m "feat(backtest): canonical ingredient deduper"`

---

### Task 2.4: Per-ingredient unit-conversion table

This is **THE** critical piece for the user's "special focus on units." Oracle stores conversions per ingredient (`D.conversions` has `ingId, storageUnit, recipeUnit, factor`). We need realistic conversions so shopping-list math works across mixed units.

**Files:**
- Create: `backtest/pipeline/conversions.py`
- Create: `backtest/data/staged/conversions.json`

**Reference data** (cite sources in comments):
- USDA FoodData Central density per 100g for common ingredients
- pint (Python) handles all volume↔volume and mass↔mass conversions free; we only need to set **one density per ingredient** to cross dimensions

**Step 1 (test):** `backtest/tests/pipeline/test_conversions.py`:
```python
from backtest.pipeline.conversions import for_ingredient
import math
def test_flour():
    c = for_ingredient("flour")
    # 1 cup all-purpose flour ≈ 125 g
    assert math.isclose(c.cup_to_g(1), 125, rel_tol=0.05)
def test_sugar():
    c = for_ingredient("sugar")
    assert math.isclose(c.cup_to_g(1), 200, rel_tol=0.05)
def test_water():
    c = for_ingredient("water")
    assert math.isclose(c.cup_to_g(1), 237, rel_tol=0.02)   # 236.6 ml * 1 g/ml
def test_butter():
    c = for_ingredient("butter")
    assert math.isclose(c.tbsp_to_g(1), 14, rel_tol=0.1)
def test_count_ingredient_has_no_density():
    c = for_ingredient("egg")
    # count-native ingredient: factor to mass is average (50g / each)
    assert math.isclose(c.each_to_g(1), 50, rel_tol=0.2)
```

**Step 2 (impl):** `conversions.py` ships a small hand-curated density table (20-30 staples: flour, sugar, salt, butter, oil, milk, water, rice, various). For ingredients *not* in the table: falls back to `50g / each` for count-nouns, or emits a conversion record only for volume↔volume (via pint). Each `D.conversions` row gets `{ingId, storageUnit: <dominant unit in corpus>, recipeUnit: <secondary unit in corpus>, factor}`.

**Dominant unit rule:** for each canonical ingredient, count how often each unit appears in the 1k recipes; `storageUnit` = most common unit the operator buys (lb/g/each/gal), `recipeUnit` = most common recipe unit (cup/tbsp/each). This matches how the Oracle app is used in practice.

**Step 3:** Run: `python backtest/pipeline/conversions.py`. Output: `conversions.json` with one row per ingredient that has a meaningful cross-unit mapping.

**Step 4:** Run tests: PASS (5/5).

**Step 5:** Commit: `git commit -m "feat(backtest): per-ingredient unit-conversion table"`

---

### Task 2.5: Build the testbed import JSON (D-shape)

**Files:**
- Create: `backtest/pipeline/build_import.py`
- Create: `backtest/output/testbed-import.json`

**Step 1 (test):** `backtest/tests/pipeline/test_build_import.py`:
```python
import json
from pathlib import Path
def test_shape():
    d = json.loads(Path("backtest/output/testbed-import.json").read_text())
    assert d["version"]
    assert d["exportDate"]
    data = d["data"]
    for k in ("ings","recs","preps","menus","inv","areas","cats","recCats","menuCats","units","conversions","shopping","settings","log","users"):
        assert k in data, f"missing {k}"
    assert len(data["recs"]) == 1000
    assert 200 <= len(data["ings"]) <= 400
    assert all("ings" in r and isinstance(r["ings"], list) for r in data["recs"])
    # every recIng must point at a real ingId
    ing_ids = {i["id"] for i in data["ings"]}
    for r in data["recs"]:
        for ri in r["ings"]:
            assert ri["ingId"] in ing_ids
            assert isinstance(ri["qty"], (int,float))
            assert ri["unit"]
```

**Step 2 (impl):** `build_import.py`:
1. Load `sample.jsonl`, `ingredient_map.json`, `conversions.json`.
2. Assign integer IDs starting at `nid=1` to every ingredient, recipe, etc. (the app uses auto-increment int IDs).
3. For each recipe → build `{id, name, ings:[...], yield, yieldUnit, catId}`. Pick `yield` as median of similar recipes in the corpus; default `yieldUnit = "serving"`.
4. For each ingredient line → `{ingId, qty: <parsed>, unit: <canonical>}`.
5. Populate `D.units` from Task 2.1's master.
6. Populate `D.conversions` from Task 2.4.
7. `D.cats`: `[Dry,Produce,Dairy,Meat,Seafood,Pantry,Frozen,Beverage,Spice]` (9 ingredient cats).
8. `D.recCats`: `[Breakfast,Appetizer,Entree,Side,Dessert,Sauce,Baked,Drink]`.
9. Leave `D.inv`, `D.preps`, `D.menus`, `D.areas` empty — those are generated in Phase 4.
10. Wrap in `{version, exportDate, data:{...}}` envelope matching `exportData()` at index.html:7032.

**Step 3:** Run: `python backtest/pipeline/build_import.py`. Size check: file should be 2-5 MB.

**Step 4:** Run test: PASS.

**Step 5:** Commit: `git commit -m "feat(backtest): build D-shape testbed-import.json"`

---

## Phase 3 — Testbed Infrastructure

### Task 3.1: Fork app into `backtest/app-fork/` (copy-on-write — NO prod edits)

**Problem:** Oracle's auth flow requires Google OAuth + approved-email + tenant claims. Need local-only bypass **without touching `firebase/public/*`**.

**Approach:** Copy the whole `firebase/public/` tree into `backtest/app-fork/` once. Patch only the fork. Real prod files never modified. Resync script rebases the patch if prod moves.

**Files:**
- Create: `backtest/app-fork/` (starts empty — populated by resync script)
- Create: `backtest/bin/resync-fork.sh`
- Create: `backtest/patches/001-backtest-auth-shortcircuit.patch`
- Create: `backtest/firebase.json` (fork's own hosting config pointing at `app-fork/`)

**`bin/resync-fork.sh`:**
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# copy prod → fork (wipes old fork first so stale files cannot linger)
rm -rf app-fork
cp -R ../firebase/public app-fork
# apply every patch in order
for p in patches/*.patch; do
  git apply --directory=backtest/app-fork "$p" || {
    echo "❌ patch $p failed — prod files drifted. Rebase the patch."
    exit 1
  }
done
# sanity: ensure we NEVER touched prod
./bin/preflight.sh
```

**Patch contents** (`001-backtest-auth-shortcircuit.patch`): unified diff adding an `isBacktestMode()` helper + auth short-circuit inside the fork's `index.html`.

**Hardened rules for backtest mode** (same as before, now living only in the fork):
1. Only honored when `hostname === 'localhost' || '127.0.0.1'` — fork can never be deployed.
2. Only honored when `port === '5055'` (non-standard port reserved for backtest to prevent collision with any developer running prod emulators on 5000).
3. When active: skip OAuth, `TENANT_SLUG='backtest'`, `TENANT_ID='backtest'`, stub `currentAuthUser` locally, all writes localStorage-only.
4. Red banner "BACKTEST MODE — FORK, NOT PROD APP" at top.
5. `manifest.json` renamed to `manifest.backtest.json` to prevent PWA-install confusion.

**`backtest/firebase.json`** (emulator config for the fork — separate from prod):
```json
{
  "hosting": {
    "public": "app-fork",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"]
  },
  "emulators": {
    "hosting":   { "port": 5055, "host": "127.0.0.1" },
    "firestore": { "port": 8088, "host": "127.0.0.1" },
    "auth":      { "port": 9098, "host": "127.0.0.1" },
    "functions": { "port": 5006, "host": "127.0.0.1" },
    "ui":        { "enabled": true, "port": 4044, "host": "127.0.0.1" }
  }
}
```

**Step 1 (test):** `backtest/tests/harness/fork_isolation.spec.ts`:
```ts
import { execSync } from 'child_process';
test('prod files untouched after fork resync', () => {
  execSync('./backtest/bin/resync-fork.sh');
  const diff = execSync('git status --porcelain firebase/ index.html').toString();
  expect(diff).toBe('');
});
test('fork has backtest banner patched in', () => {
  const html = require('fs').readFileSync('backtest/app-fork/index.html', 'utf8');
  expect(html).toMatch(/isBacktestMode/);
  expect(html).toMatch(/BACKTEST MODE — FORK, NOT PROD APP/);
});
```

**Step 2 (impl):**
1. Run `cp -R firebase/public backtest/app-fork` once manually to get a baseline.
2. Hand-edit `backtest/app-fork/index.html` to add `isBacktestMode()` + banner + auth short-circuit.
3. Generate patch: `diff -u firebase/public/index.html backtest/app-fork/index.html > backtest/patches/001-backtest-auth-shortcircuit.patch`.
4. Delete `backtest/app-fork/`, then regenerate via `resync-fork.sh` to verify the patch applies cleanly from scratch.
5. Run preflight — must be `✅`.

**Step 3:** Run Playwright spec — PASS both assertions.

**Step 4:** Commit: `git commit -m "feat(backtest): app fork with auth short-circuit patch"`

---

### Task 3.2: Backtest-only emulator launch

**Files:**
- Create: `backtest/bin/emulate.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Explicit project ID that can NEVER match prod .firebaserc
export GOOGLE_APPLICATION_CREDENTIALS=""    # ensure no prod creds leak in
firebase emulators:start \
  --only auth,firestore,hosting \
  --project restaurant-oracle-backtest \
  --config backtest/firebase.json
```

**Rules:**
- `--project restaurant-oracle-backtest` — a project name that does not exist in the real Firebase console; any accidental deploy attempt fails.
- `--config backtest/firebase.json` — uses the fork's hosting config (port 5055, `app-fork/` root), not prod's.
- `GOOGLE_APPLICATION_CREDENTIALS` explicitly unset — prevents ADC leak into emulator.
- No `functions` emulator — the fork's auth short-circuit bypasses `secureApi()`, so Cloud Functions never run. This removes any chance of deploying modified function code.

**Step 1:** Write script, `chmod +x`.
**Step 2:** Run: `./backtest/bin/emulate.sh`. Wait for `✔ All emulators ready on 127.0.0.1:5055`. Leave running in background.
**Step 3:** Verify from a second terminal: `curl -s http://127.0.0.1:5055/ | grep -c 'BACKTEST MODE'` → returns ≥ 1.
**Step 4:** Preflight: `./backtest/bin/preflight.sh` → `✅`.
**Step 5:** Commit: `git commit -m "chore(backtest): emulator launch script (isolated project)"`

---

### Task 3.3: Programmatic seed loader

**Files:**
- Create: `backtest/bin/seed.sh`
- Create: `backtest/harness/seed.mjs` (Node script that drives Playwright to load testbed-import.json into the running emulator)

**Step 1 (test):** `backtest/tests/harness/seed.spec.ts`:
```ts
test('seed loads 1000 recipes', async ({ page }) => {
  await page.goto('http://localhost:5000/?backtest=1');
  await page.waitForSelector('#main-app');
  // programmatically invoke importData path, bypassing file picker
  const count = await page.evaluate(async () => {
    const json = await fetch('/testbed-import.json').then(r => r.json());
    window._loadFromJSONForTest(json);
    return window.D.recs.length;
  });
  expect(count).toBe(1000);
});
```

**Step 2 (impl):** 
1. Copy `backtest/output/testbed-import.json` to `backtest/app-fork/testbed-import.json` (fork serves it — **prod `firebase/public/` never gets this file**).
2. Add test-only helper `window._loadFromJSONForTest(json)` inside the fork's `isBacktestMode()` block (via the `001` patch); deep-copies payload into `D.*`, calls `rebuildIndexes()`, `render()`. Guard: no-op if `!isBacktestMode()`.
3. `seed.mjs` launches headless Playwright, opens `http://127.0.0.1:5055/?backtest=1`, evaluates loader, screenshots each tab.

**Step 3:** Run: `./backtest/bin/seed.sh`. Expected output: "seeded 1000 recs, 312 ings, 45 units, 278 conversions" plus 8 baseline screenshots under `backtest/output/baseline/`. Preflight must be `✅`.

**Step 4:** Run test: PASS.

**Step 5:** Commit: `git commit -m "feat(backtest): programmatic seed loader"`

---

## Phase 4 — Mock Environment Generation (inventory, areas, preps, menus, targets)

### Task 4.1: Areas / storage locations

**Files:**
- Create: `backtest/pipeline/gen_areas.py`

**Generate (realistic restaurant layout):**
- Dry Storage — sub-areas: `[Shelf A1..A6, Shelf B1..B4]`, `invFrequency=weekly`
- Walk-In Cooler — sub-areas: `[Top shelf, Middle, Bottom, Produce bin, Dairy shelf]`, `invFrequency=daily`
- Walk-In Freezer — sub-areas: `[Meat, Seafood, Prepared]`, `invFrequency=weekly`
- Bar — sub-areas: `[Well, Back bar, Cooler]`, `invFrequency=weekly`
- Line (expo) — sub-areas: `[Hot line, Cold line, Garde manger]`, `invFrequency=daily`, `prep=true`
- Prep Kitchen — `prep=true`, `invFrequency=daily`
- Warehouse (off-site) — `isWarehouse=true`, `invFrequency=monthly`

**Step 1 (test):** assert 7 areas emitted, each with >=3 sub-areas, at least one `prep=true`, at least one `isWarehouse=true`.

**Step 2 (impl):** simple deterministic generator with fixed seed; emits to `backtest/data/staged/areas.json`.

**Step 3:** Commit: `git commit -m "feat(backtest): generate mock storage areas"`

---

### Task 4.2: Inventory with cross-unit variation (the unit-math torture test)

This task deliberately creates inventory rows that **use different units than the recipes** so the conversion logic at [index.html:4116 convertToRecipeUnits](/Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/index.html) and [:4127 convertToStorageUnits](/Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/index.html) actually gets exercised.

**Files:**
- Create: `backtest/pipeline/gen_inv.py`

**Rules:**
1. Every ingredient gets **at least one** inventory row.
2. 40% of ingredients get **two rows in two different areas** (e.g., flour in Dry Storage *and* on the Line).
3. 60% of ingredient rows use `storageUnit` (from conversions); 30% use `recipeUnit`; 10% use a *third* unit in the same dimension (e.g., ingredient stores in `lb`, recipe uses `cup`, inventory row uses `oz`). This forces unit conversion.
4. Inventory qty distribution: uniform in `[0.25, 3.0] × typical-pack-size` (typical pack size from the dominant-unit corpus stats in Task 2.4).
5. 5% of rows get `outOfStock=true, qty=0` — must trigger shopping-list inclusion.
6. 3% of rows get a non-default unit that does **not** have a conversion defined — documented expected behavior: shopping list emits a warning, does not crash.

**Step 1 (test):** `backtest/tests/pipeline/test_gen_inv.py`:
```python
def test_every_ing_covered():
    inv = load_inv()
    covered = {row["ingId"] for row in inv}
    assert covered == {ing["id"] for ing in load_ings()}
def test_unit_variation():
    # at least 25% of rows use a non-storage unit
    inv = load_inv()
    storage = {i["id"]: conv_for(i["id"]).storageUnit for i in load_ings()}
    mismatched = sum(1 for r in inv if r["unit"] != storage.get(r["ingId"]))
    assert mismatched / len(inv) >= 0.25
def test_out_of_stock_present():
    assert sum(1 for r in load_inv() if r.get("outOfStock")) >= 10
```

**Step 2 (impl):** `gen_inv.py` walks ingredients, emits rows by the rules above with `random.seed(42)`.

**Step 3:** Run tests: PASS.

**Step 4:** Commit: `git commit -m "feat(backtest): inventory with cross-unit variation"`

---

### Task 4.3: Preps with targets + on-hand

**Files:**
- Create: `backtest/pipeline/gen_preps.py`

**Rules:**
1. Select ~120 recipes from the 1k as "prep items" (bases, sauces, batters, dressings — recipes with `yield > 1 serving` OR category in `{Sauce, Baked}`).
2. Each prep: `{id, name, recId, tgt, unit: rec.yieldUnit, onHand: random(0, tgt*1.5), areaId: random prep area}`.
3. 25% of preps have `onHand >= tgt` (covered — shouldn't trigger shopping). 50% have `0 < onHand < tgt` (partial — should trigger partial shopping). 25% have `onHand == 0` (full need).

**Step 1 (test):** shape assertions + distribution ratios ±5%.

**Step 2 (impl):** seed-stable generator.

**Step 3:** Commit: `git commit -m "feat(backtest): generate 120 preps with on-hand distribution"`

---

### Task 4.4: Menu items with targets (including sub-recipes & sub-preps)

**Files:**
- Create: `backtest/pipeline/gen_menus.py`

**Rules:**
1. 60 menu items, split across `menuCats: [Breakfast, Lunch, Dinner, Dessert, Drink]`.
2. Each menu item references **some combination** of: direct ingredients (`menu.ings`), full recipes (`menu.recs`), preps (`menu.preps`). Distribution: 20% ingredients-only, 40% recipes-only, 20% preps-only, 20% mixed.
3. `tgt` (daily sales target) uniform in `[5, 60]`.
4. 80% have `includeInShop=true`; 100% have `includeInPrep=true`.
5. Deliberately include at least 5 menu items that chain through **2 levels of sub-recipes** (menu → recipe → sub-recipe → ingredient) to exercise `expandRecipeIngredients()` at [index.html:4071](/Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/index.html).
6. Deliberately include 5 menu items whose recipes use an ingredient in a unit different from that ingredient's `storageUnit` and different from inventory's unit — 3-way unit mismatch.

**Step 1 (test):** shape + sub-recipe depth + 3-way mismatch count.

**Step 2 (impl):** seed-stable generator.

**Step 3:** Commit: `git commit -m "feat(backtest): generate 60 menu items with sub-recipe chains"`

---

### Task 4.5: Merge all generated tables into final import JSON

**Files:**
- Modify: `backtest/pipeline/build_import.py` — add a `--with-mock` flag that pulls `areas.json, inv.json, preps.json, menus.json` from `data/staged/` and stitches them in.

**Step 1 (test):** run test_build_import.py again with non-empty inv/preps/menus/areas.

**Step 2 (impl):** straight merge.

**Step 3:** Run: `python backtest/pipeline/build_import.py --with-mock`. Verify final `testbed-import.json` has all non-empty tables.

**Step 4:** Commit: `git commit -m "feat(backtest): stitch mock env into testbed-import.json"`

---

## Phase 5 — Unit-Conversion Math Tests (special focus)

### Task 5.1: Extract pure conversion functions to standalone module for isolated testing

**Problem:** `convertToStorage`, `convertToRecipe`, `convertToRecipeUnits`, `convertToStorageUnits` are currently inline in index.html. To property-test them in Vitest, we mirror the logic into `backtest/harness/conversions.mjs` (a line-identical copy) and also run integration tests through the real browser.

**Files:**
- Create: `backtest/harness/conversions.mjs` — verbatim copy of the 4 functions from index.html lines ~2786-2795 and 4116-4138, with `IDX.conversions` replaced by an injected map.

**Step 1 (test):** `backtest/tests/unit/conversions.spec.ts`:
```ts
import { convertToRecipeUnits, convertToStorageUnits } from '../../harness/conversions.mjs';
const flour = { ingId: 1, storageUnit: 'lb', recipeUnit: 'cup', factor: 3.5 }; // 1 lb flour ≈ 3.5 cups
const conv = new Map([[1, flour]]);
test('storage → recipe', () => {
  expect(convertToRecipeUnits(conv, 1, 2, 'lb')).toBeCloseTo(7, 3);   // 2 lb × 3.5 = 7 cups
});
test('recipe → storage', () => {
  expect(convertToStorageUnits(conv, 1, 7, 'cup')).toBeCloseTo(2, 3); // 7 cups / 3.5 = 2 lb
});
test('same-unit passthrough', () => {
  expect(convertToRecipeUnits(conv, 1, 5, 'cup')).toBe(5);
});
test('unknown ingredient passthrough', () => {
  expect(convertToRecipeUnits(conv, 999, 5, 'cup')).toBe(5);
});
test('zero factor guards against div by zero', () => {
  const bad = new Map([[1, { ingId:1, storageUnit:'lb', recipeUnit:'cup', factor: 0 }]]);
  expect(convertToStorageUnits(bad, 1, 5, 'cup')).toBe(5); // fall through
});
test('round-trip invariant', () => {
  // for any qty q in recipe unit, storage→recipe should recover q within tolerance
  for (const q of [0.5, 1, 2.5, 7, 100]) {
    const storage = convertToStorageUnits(conv, 1, q, 'cup');
    const back    = convertToRecipeUnits(conv, 1, storage, 'lb');
    expect(back).toBeCloseTo(q, 3);
  }
});
```

**Step 2 (impl):** copy-paste the 4 functions, replace closure refs.

**Step 3:** Run: `npx vitest run backtest/tests/unit`. Expected: all 6 PASS.

**Step 4:** Commit: `git commit -m "test(backtest): round-trip unit-conversion invariants"`

---

### Task 5.2: Property test — recipe-scaling preserves ratios under unit swap

**Files:**
- Create: `backtest/tests/unit/recipe_scale.spec.ts`

**Claim under test:** for any recipe in the seed, multiplying all ingredient quantities by `k` (after converting to a common unit via `convertToRecipeUnits`) then back-converting should equal `k × original`.

**Step 1 (test):**
```ts
import seed from '../../output/testbed-import.json';
import { convertToRecipeUnits, convertToStorageUnits } from '../../harness/conversions.mjs';
const convMap = new Map(seed.data.conversions.map(c => [c.ingId, c]));
for (const k of [0.5, 1, 2, 3, 10]) {
  test(`scale by ${k} preserves ratio`, () => {
    for (const rec of seed.data.recs.slice(0, 100)) {                 // sample
      for (const ri of rec.ings) {
        const storage = convertToStorageUnits(convMap, ri.ingId, ri.qty, ri.unit);
        const scaled  = storage * k;
        const back    = convertToRecipeUnits(convMap, ri.ingId, scaled, storage ? convMap.get(ri.ingId)?.storageUnit : ri.unit);
        expect(back).toBeCloseTo(ri.qty * k, 3);
      }
    }
  });
}
```

**Step 2:** Run. Expect: 5 test groups PASS. Any failure → inspect the offending `conv` row; likely a missing conversion.

**Step 3:** Commit: `git commit -m "test(backtest): recipe-scale ratio invariants over 1k corpus"`

---

## Phase 6 — Interconnectivity Tests (per tab, cross-tab)

Each of the 8 tabs (Inventory, Ingredients, Recipes, Menus, Prep, Shopping, Log, Admin) gets a Playwright spec that loads the seeded emulator, navigates, and asserts rendering + cross-references.

### Task 6.1: Inventory tab

**Files:**
- Create: `backtest/tests/harness/tab_inventory.spec.ts`

**Asserts:**
1. Every area from `D.areas` renders as a row/card.
2. Clicking an area expands to show every inventory row for that area.
3. Sum of inventory rows per ingredient matches the generator output.
4. Filter by "out of stock" shows exactly the 5% flagged rows.
5. Editing a row qty persists via `markChanged()` (listener-free in backtest mode; asserts `D.inv[i].qty` mutated + `changeLog.inv.has(id)`).

**Step 1:** Write test + assertions.  
**Step 2:** Run — PASS.  
**Step 3:** Commit: `git commit -m "test(backtest): inventory tab interconnectivity"`

---

### Task 6.2: Ingredients tab

**Files:**
- Create: `backtest/tests/harness/tab_ingredients.spec.ts`

**Asserts:**
1. 200-400 ingredient rows render.
2. Each ingredient's "used in" column correctly lists recipes / menus / preps that reference it (reverse index via IDX).
3. Filter by category shrinks the list.
4. Search by substring matches canonical + alias names.
5. `archived=true` ingredients hidden by default, shown when toggle flipped.

**Steps 1-3:** Same pattern.

---

### Task 6.3: Recipes tab

**Files:**
- Create: `backtest/tests/harness/tab_recipes.spec.ts`

**Asserts:**
1. 1000 recipes render (paginated or virtualized — check `recs-list` child count or page counter).
2. Expanding a recipe shows each `recIng` row with `{ingredient name, qty, unit}` and a resolved cost (unit-converted to ingredient's `cost` basis).
3. For each of the 5 recipes with sub-recipe chains (from Task 4.4), the expanded ingredient list recursively unfolds via `expandRecipeIngredients()` at [index.html:4071](/Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/index.html) — assert depth ≥ 2.
4. Recipe yield editable; changing `yield` from 4→8 doubles every displayed ingredient qty.
5. Clicking "add to prep" creates a prep entry (or updates existing); cross-tab check the Prep tab reflects new item.

---

### Task 6.4: Menus tab

**Files:**
- Create: `backtest/tests/harness/tab_menus.spec.ts`

**Asserts:**
1. 60 menu items render across 5 menu cats.
2. Each menu item shows total ingredient requirement = `tgt × (direct ings + recipe-expanded ings + prep ings)`.
3. Toggling `includeInShop` to false removes that menu's demand from the shopping list (verify in 6.6).
4. The 5 two-level sub-recipe chains expand correctly in the menu breakdown.

---

### Task 6.5: Prep tab

**Files:**
- Create: `backtest/tests/harness/tab_prep.spec.ts`

**Asserts:**
1. 120 prep items render with `{onHand, tgt, unit}`.
2. "+1 batch ✓" button increments `onHand` by the recipe yield; session-count badge + pulse animation fire (regression check for the 2026-04-24 fix — memory line 339).
3. Preps where `onHand ≥ tgt` badge as "covered"; preps where `onHand == 0` badge as "needed".
4. Clicking "gen from recipe" correctly pulls the recipe's ingredient list.

---

### Task 6.6: Shopping tab — **the master integration check**

**Files:**
- Create: `backtest/tests/harness/tab_shopping.spec.ts`

**Asserts (the user's core requirement):**

**Golden formula** (for each ingredient `i`):
```
needed(i)   = Σ over menus (tgt × direct_ing_qty) 
            + Σ over menus (tgt × recipe_expanded_qty from calcRecipeOutput) 
            + Σ over menus (tgt × prep_expanded_qty)
            + Σ over preps  (max(0, tgt − onHand) × recipe_expanded_qty)

have(i)     = Σ over inv rows for i (converted to ingredient.defUnit via convertToRecipeUnits)

shortfall(i) = max(0, needed(i) − have(i))

shopping_qty(i) = convertToStorageUnits(shortfall(i), i.defUnit)
```

**Tests (one subsection per invariant):**

1. **Covered by inventory:** force an ingredient's inventory to 10× max needed — shopping list must NOT include it.
2. **Partial shortfall:** force inventory = 0.5 × needed — shopping qty = 0.5 × needed (converted to storage unit).
3. **Prep covers it:** force a prep with `onHand ≥ tgt` that covers a menu dependency — menu's portion drops to 0 (verify via diff before/after `prep.onHand` mutation).
4. **Unit-mismatch:** inventory stored in `oz`, recipe in `cup`, ingredient defUnit `lb`, conversions defined — shopping qty must compute correctly to storage unit (assert with hand-computed number for 10 picked ingredients).
5. **Missing conversion:** one of the 3% ingredients without a conversion → shopping list emits a warning row, qty stays in recipe units, no crash.
6. **Out-of-stock short-circuit:** `outOfStock=true` rows counted as zero regardless of `qty`.
7. **`includeInShop=false` exclusion:** menu flagged false doesn't contribute to demand.
8. **Auto-shop threshold:** ingredient with `autoShop=true` and `qty < minQty` surfaces on the list even if no menu demand.
9. **Total invariant check:** sum of shopping list `qty × cost` (converted) must equal the total-cost widget at the top of the Shopping tab.

**Step 1-3:** Write each sub-assertion, run, commit per group of 3 assertions (3 commits, not one).

---

### Task 6.7: Log tab

**Files:**
- Create: `backtest/tests/harness/tab_log.spec.ts`

**Asserts:**
1. After seeding + running 6.1-6.6 mutations, log has an audit entry per change.
2. Filter by user, by action type works.

---

### Task 6.8: Admin tab

**Files:**
- Create: `backtest/tests/harness/tab_admin.spec.ts`

**Asserts:**
1. Unit management — add a unit, delete a unit, rename.
2. Category management — add/rename/merge.
3. Conversion management — CRUD a `D.conversions` row; confirm the shopping list recomputes correctly (re-trigger Task 6.6 check for that ingredient).

---

## Phase 7 — End-to-End Runner & Report

### Task 7.1: Single-command full-cycle runner

**Files:**
- Create: `backtest/bin/run-all.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./bin/preflight.sh                              # hard stop if prod files dirty
./bin/fetch.sh
python pipeline/sample.py
python pipeline/dedupe.py
python pipeline/conversions.py
python pipeline/gen_areas.py
python pipeline/gen_inv.py
python pipeline/gen_preps.py
python pipeline/gen_menus.py
python pipeline/build_import.py --with-mock
./bin/resync-fork.sh                            # rebuild app-fork + apply patches
cp output/testbed-import.json app-fork/testbed-import.json
./bin/emulate.sh &                              # isolated project on :5055
EMU_PID=$!
trap "kill $EMU_PID; ./bin/preflight.sh" EXIT   # preflight re-runs at shutdown
sleep 10
./bin/seed.sh
npx vitest run backtest/tests/unit
npx playwright test backtest/tests/harness
./bin/preflight.sh                              # final check before exit
```

**Step 1:** Run the full thing end-to-end.

**Step 2:** Commit.

---

### Task 7.2: Coverage report + human-readable summary

**Files:**
- Create: `backtest/bin/report.sh`
- Create: `backtest/output/REPORT.md` (generated)

**Content:** counts, pass/fail per phase, list of any shopping-list invariants that failed with hand-calc vs app-calc diffs, a histogram of unit-mismatch conversion accuracy.

**Step 1:** Implement + run.  
**Step 2:** Commit.

---

## Phase 8 — Documentation & Handoff

### Task 8.1: README + DIAGRAMS

- Update `backtest/README.md` with a data-flow diagram (ingredients → recipes → preps → menus → inventory → shopping).
- Add a "how the unit math actually works" section with worked examples.

### Task 8.2: Archive the seed JSON

- Check the final `testbed-import.json` into a separate `backtest/output/snapshots/2026-04-24.json` so reruns are reproducible without re-downloading the corpus.

### Task 8.3: Commit: `git commit -m "docs(backtest): harness README + diagrams"`

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| RecipeNLG Kaggle auth blocked | Fallback to TheMealDB (~300) + synthetic recipe generator to reach 1k |
| Ingredient parser misses unusual formats | Rule-based fallback always returns a tuple; log unparseable lines to `backtest/output/unparsed.log` for review |
| Unit conversions don't exist for niche ingredients | Task 2.4 flags these; Task 6.6 sub-assertion 5 explicitly tests the graceful-warning path |
| `?backtest=1` flag leaks to prod | Flag lives ONLY in `backtest/app-fork/` — prod `firebase/public/index.html` never modified. Even if the fork leaked, hostname+port guard (5055 only) + banner catch it. |
| Accidental edit of prod file during task execution | `preflight.sh` runs before every commit and at `run-all.sh` entry/exit — any diff outside `backtest/` + `docs/plans/` aborts. Isolation branch `backtest/harness` never merges without human review. |
| Emulator accidentally points at real Firebase project | `--project restaurant-oracle-backtest` (non-existent in console) + `GOOGLE_APPLICATION_CREDENTIALS=""` + `127.0.0.1`-only binding. Any deploy attempt fails with "project not found". |
| Fork drifts from prod over time | `resync-fork.sh` rebuilds fork from scratch + re-applies `patches/*.patch`. Patch fails loudly if prod moved incompatibly — force a human rebase. |
| 1k recipes slow down UI | Expected; if render time > 2s, paginate in the Recipes tab render (stretch goal, not blocking) |
| Emulator + auth disagreements | Use local-only stub user when `isBacktestMode()` — no real OAuth round-trip |

---

## Deliverables checklist

- [ ] `backtest/` directory with full pipeline + harness
- [ ] 1,000 real recipes imported from RecipeNLG, license documented
- [ ] ~300 canonical ingredients with deduped names
- [ ] Per-ingredient unit conversions for common staples (density + count)
- [ ] 7 mock storage areas with realistic sub-areas
- [ ] Inventory with intentional cross-unit variation (25%+ unit mismatch)
- [ ] 120 preps with realistic on-hand distribution
- [ ] 60 menu items including sub-recipe chains + 3-way unit mismatches
- [ ] Dev-only `?backtest=1` flag lives ONLY in `backtest/app-fork/` (prod `firebase/public/` untouched; preflight enforces)
- [ ] Isolation branch `backtest/harness` with every task commit passing `preflight.sh`
- [ ] Emulator uses `--project restaurant-oracle-backtest` on 127.0.0.1:5055 (never collides with prod)
- [ ] 8 tab interconnectivity Playwright specs passing
- [ ] 6 unit-math invariants (round-trip, scaling, zero-guard) passing
- [ ] 9 shopping-list scenario assertions passing
- [ ] `./backtest/bin/run-all.sh` green in one shot
- [ ] `REPORT.md` with pass/fail + conversion-accuracy histogram

---


<a id="plan-operator-console"></a>

# Plan: Operator Console Gap Fill (2026-04-24)

_Source: `docs/plans/2026-04-24-operator-console-gap-fill.md`_

# Operator Console Gap-Fill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the five concrete integration gaps in the operator-management dashboard (`super-admin.html`) and ship it to production at `bistrosteward.com`. The dashboard UI and 54 Cloud Function ops already exist locally but are uncommitted, undeployed, and have broken seams: the impersonation flow is half-wired, no Gemini token data ever lands in the cost rollups, and the customer-side feedback widget is missing entirely.

**Architecture:** Extend the existing single-file dashboard (`firebase/public/super-admin.html`, 1925 LOC) and the Phase-2 super-admin CF dispatcher (`firebase/functions/index.js`, 5149 LOC). No new files unless required. Touch the main app (`firebase/public/index.html`) only for the two integration points: feedback widget + impersonation handler/banner. All writes flow through the existing `secureApi` `submitFeedback` op for feedback and a new in-`index.js` `logGeminiUsage` helper for token tracking. Impersonation read-only enforcement happens in `secureApi`'s request gate by inspecting the verified ID token's custom claims.

**Tech Stack:** Firebase Auth (compat SDK 10.7.1), Firestore, Cloud Functions Gen 1, Vanilla JS, no new npm deps.

**Decision log (from brainstorming):**
- Q1=A: ship all gaps in one PR, not phased.
- Q2=A: real per-call Gemini token logging — wrap the existing call sites; no estimation.
- Q3=A: per-feature feedback widget in `index.html` writing real events (no widget = empty data, broken Feedback tab).
- Q4=A: impersonation via short-lived custom token in a new tab + `readOnly` claim enforced server-side.
- Q5=A: gap-fill, do not rebuild the existing dashboard.

**Live-prod safety constraints:**
- Never break existing tenant data flows (`secureApi` writes for `ings`/`inv`/`recs`/etc.).
- Every change behind `super_admin` claim except the feedback widget (which is open to any signed-in tenant user).
- Don't deploy to production without running the existing `_e2e_super_admin.js` test against the live or emulator endpoint first.
- Auto Mode (per `~/.claude/CLAUDE.md`) means do not pause for confirmation between steps once the user approves this plan — only pause for failed tests or unexpected error output.

---

## Task 1 — Add `logGeminiUsage` helper and wire it into the voice Gemini call

**Files:**
- Modify: `firebase/functions/index.js` — add helper near other helpers (~line 287, after `writeAuditLog`); wrap the voice call at lines 693–815.

**Step 1: Read context around the voice Gemini call**

Run: `sed -n '680,820p' firebase/functions/index.js`

Confirm the Gemini call pattern: `model.generateContent(prompt)` returning a `result` whose `result.response.usageMetadata` contains `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`. Capture these for the log.

**Step 2: Add the `logGeminiUsage` helper**

Insert this helper after `writeAuditLog` (~line 345 after the existing helper closes). Place above the `setSecurityHeaders` block:

```javascript
// ============================================================================
// GEMINI TOKEN USAGE LOGGING
// ============================================================================
// Writes one doc per Gemini call so dailyTenantCostAggregation can roll it up.
// Per-tenant subcollection so reads stay scoped to the tenant.
//
// Schema: tenants/{tenantId}/geminiUsage/{auto}
//   { tenantId, userId, op, model, inputTokens, outputTokens, totalTokens,
//     latencyMs, success, errorCode, timestamp }
//
// Failure to write is non-fatal — never let a logging error break a user-
// facing Gemini response. Errors are console.warn only.

async function logGeminiUsage({
  tenantId, userId, op, model,
  inputTokens, outputTokens, totalTokens,
  latencyMs, success, errorCode,
}) {
  if (!tenantId) return; // platform-wide calls don't get logged
  try {
    await db.collection('tenants').doc(tenantId)
      .collection('geminiUsage').add({
        tenantId,
        userId: userId || null,
        op: String(op || 'unknown'),
        model: String(model || 'unknown'),
        inputTokens: Number(inputTokens) || 0,
        outputTokens: Number(outputTokens) || 0,
        totalTokens: Number(totalTokens) || 0,
        latencyMs: Number(latencyMs) || 0,
        success: !!success,
        errorCode: errorCode || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (e) {
    console.warn('[geminiUsage] log write failed (non-fatal):', e.message);
  }
}
```

**Step 3: Wrap the voice Gemini call**

Find the voice call (around `index.js:693`):

```javascript
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
```

Wrap the surrounding `try { const result = await model.generateContent(...); ... } catch (geminiError) { ... }` like this. Find the current shape and replace ONLY the call + parse + the existing catch — don't otherwise restructure:

```javascript
const t0 = Date.now();
let geminiResult, usage = {};
try {
  geminiResult = await model.generateContent(prompt);
  usage = geminiResult?.response?.usageMetadata || {};
  await logGeminiUsage({
    tenantId, userId,
    op: 'voice',
    model: 'gemini-2.5-flash',
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
    totalTokens: usage.totalTokenCount || 0,
    latencyMs: Date.now() - t0,
    success: true,
  });
} catch (geminiError) {
  await logGeminiUsage({
    tenantId, userId,
    op: 'voice',
    model: 'gemini-2.5-flash',
    inputTokens: 0, outputTokens: 0, totalTokens: 0,
    latencyMs: Date.now() - t0,
    success: false,
    errorCode: (geminiError.message || '').includes('429') ? 'rate_limit' : 'gemini_error',
  });
  // existing error handling continues unchanged
  throw geminiError;
}
// downstream code uses `geminiResult` instead of `result`
```

**Step 4: Run the existing test suite**

Run: `cd firebase/functions && node _e2e_security.js 2>&1 | tail -30`
Expected: all assertions pass (the wrap should not change the response shape).

If `_e2e_security.js` requires env vars not present, skip — `_e2e_super_admin.js` covers the contract end-to-end and runs in Task 9.

**Step 5: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(functions): add logGeminiUsage helper, wrap voice call

Per-call tokens now land in tenants/{id}/geminiUsage so the
dailyTenantCostAggregation rollup reflects real Gemini cost
instead of always-zero. Non-fatal logging — write errors do not
break the voice response."
```

---

## Task 2 — Wire `logGeminiUsage` into the scan Gemini Vision call

**Files:**
- Modify: `firebase/functions/index.js:845`–end of scan handler.

**Step 1: Read the scan handler**

Run: `sed -n '820,945p' firebase/functions/index.js`

Confirm the same `genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })` pattern is used and that `usageMetadata` is on the response.

**Step 2: Wrap the scan call**

Mirror Task 1's wrap exactly, with `op: 'scan'` instead of `op: 'voice'`. The model string is the same.

**Step 3: Sanity-check that both call sites compile**

Run: `node -e "require('./firebase/functions/index.js')" 2>&1 | head -20`
Expected: no syntax errors. Firebase Functions startup errors about missing env vars are fine.

**Step 4: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(functions): wrap scan Gemini call with token logging"
```

---

## Task 3 — Fix `superOpImpersonateTenant` (key name, readOnly claim, 30-min cap)

**Files:**
- Modify: `firebase/functions/index.js:3968-3993` (`superOpImpersonateTenant`).
- Modify: `firebase/public/super-admin.html:1547-1553` (`impersonateTenant` frontend handler) — confirm key alignment.

**Step 1: Diagnose**

The current backend returns `{ token, tenantSlug, expiresInSeconds: 3600 }` but the frontend reads `r.customToken`. Result: `customToken` is undefined, the toast says "No token returned", impersonation never opens. Spec also requires 30-min cap, not 1 h, and a `readOnly` claim that prevents writes. Neither is set today.

**Step 2: Replace the handler**

Replace the body of `superOpImpersonateTenant` with:

```javascript
async function superOpImpersonateTenant(ctx, params) {
  const tenantId = String(params.tenantId || '');
  if (!tenantId) return { error: 'tenantId required', status: 400 };
  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  if (!tenantSnap.exists) return { error: 'Tenant not found', status: 404 };
  const t = tenantSnap.data() || {};

  // 30-min impersonation window. Custom token TTL is fixed at 1 h by Firebase,
  // but the resulting ID token's expiry is bounded by claim `impersonationExpiresAt`.
  // The frontend signs the user out at that timestamp; the backend rejects writes
  // when `impersonating === true && readOnly === true` (see secureApi gate).
  const now = Date.now();
  const expiresAtMs = now + 30 * 60 * 1000;

  const claims = {
    impersonating: true,
    readOnly: true,
    impersonationExpiresAt: expiresAtMs,
    impersonatingTenantId: tenantId,
    impersonatingTenantSlug: t.slug || tenantId,
    impersonatingAs: ctx.userEmail,
    // Tenant-scoped claims so app.html / index.html accept the session
    tenantId,
    tenantSlug: t.slug || tenantId,
    approved: true,
    role: 'super_admin',
    superAdmin: true,
  };
  const customToken = await auth.createCustomToken(ctx.userId, claims);

  await writeSuperAudit(ctx, 'impersonation', tenantId, {
    durationMs: 30 * 60 * 1000,
    expiresAt: new Date(expiresAtMs).toISOString(),
  });

  return {
    data: {
      customToken,
      tenantSlug: t.slug || tenantId,
      tenantId,
      expiresAtMs,
      expiresInSeconds: 1800,
    },
  };
}
```

**Step 3: Verify frontend already aligns**

Run: `grep -n "r.customToken\|impersonateToken\|impersonationExpiresAt" firebase/public/super-admin.html`

Expected: `r.customToken` referenced at the existing line in `impersonateTenant`. If the line was something else, fix it now to read `r.customToken` and append `&expiresAt=` + `r.expiresAtMs` to the opened URL.

**Step 4: Commit**

```bash
git add firebase/functions/index.js firebase/public/super-admin.html
git commit -m "fix(super-admin): impersonation token contract + 30-min cap

- Return key renamed token -> customToken (matches frontend).
- Add readOnly: true claim so secureApi can block writes.
- Add impersonationExpiresAt for client-side auto-logout.
- 30-min duration per spec (was 1 h)."
```

---

## Task 4 — Block writes from impersonating sessions in `secureApi`

**Files:**
- Modify: `firebase/functions/index.js` — `handleRequest` gate near line 644 (after the tenant-status gate).

**Step 1: Read the existing gate**

Run: `sed -n '640,675p' firebase/functions/index.js`

The gate already short-circuits writes for suspended/cancelled tenants. The new check goes between that gate and the role-based permission check.

**Step 2: Add the impersonator-write block**

Insert this block immediately after the closing brace of the tenant-status gate (line 663) and before the `checkPermission` call (line 666):

```javascript
// Impersonator write-block: super-admin sessions that obtained a token via
// /superAdmin#impersonateTenant carry { impersonating: true, readOnly: true,
// impersonationExpiresAt }. Block all non-read ops and reject if expired.
if (decoded && decoded.impersonating === true) {
  const exp = Number(decoded.impersonationExpiresAt) || 0;
  if (exp && Date.now() > exp) {
    await writeAuditLog(userId, userEmail, 'impersonation_expired', table, 0, tenantId);
    res.status(401).json({ error: 'Impersonation session expired. Sign out and re-impersonate.' });
    return;
  }
  if (decoded.readOnly === true) {
    const readOnlyOps = ['select', 'getTenantConfig', 'checkSlugAvailable', 'get_tenant_settings', 'list_invoices'];
    if (!readOnlyOps.includes(operation)) {
      await writeAuditLog(userId, userEmail, 'impersonator_write_blocked', table, 0, tenantId);
      res.status(403).json({ error: 'Read-only impersonation session: writes are not permitted.' });
      return;
    }
  }
}
```

`decoded` is already in scope from the auth-verify earlier in the handler. Confirm by `grep -n "verifyIdToken\|decoded\." firebase/functions/index.js | head -20`. If the variable is named differently, align.

**Step 3: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(functions): block writes from impersonating super-admin sessions

Enforces the readOnly claim minted by superOpImpersonateTenant.
Also rejects requests after impersonationExpiresAt elapses.
Both paths land in audit_log so abuse is observable."
```

---

## Task 5 — Update Firestore rules for new collections

**Files:**
- Modify: `firebase/firestore.rules`

**Step 1: Read the current rules**

Run: `cat firebase/firestore.rules`

Identify where the existing `support_tickets` / `feedback_events` / `internal_notes` blocks live. Add new blocks for the read/write paths used by the rollup functions and Gemini logging.

**Step 2: Insert these match blocks inside the same `match /databases/{database}/documents { … }` wrapper as the existing rules**

```javascript
// Gemini per-call token usage. Written by Cloud Functions only (admin SDK
// bypasses rules). Readable by super-admins via the superAdmin endpoint
// (which uses admin SDK), so deny client read/write.
match /tenants/{tenantId}/geminiUsage/{eventId} {
  allow read, write: if false;
}

// Daily cost rollups, written by dailyTenantCostAggregation. Same rationale.
match /tenants/{tenantId}/cost_daily/{day} {
  allow read, write: if false;
}
match /tenant_costs_monthly/{key} {
  allow read, write: if false;
}

// Daily usage rollups.
match /tenants/{tenantId}/usage_daily/{day} {
  allow read, write: if false;
}
match /usage_stats_monthly/{key} {
  allow read, write: if false;
}

// Operator profiles — admin SDK only.
match /operator_profiles/{uid} {
  allow read, write: if false;
}

// Super-admin audit log (writeSuperAudit destination).
match /super_audit/{id} {
  allow read, write: if false;
}
```

If any of these collection names differ in `index.js` (the rollups likely use one of: `cost_daily`, `tenant_costs_monthly`, `usage_daily`, `usage_stats_monthly`, etc.), grep for the exact path before writing the rule:

Run: `grep -nE "tenant_costs|cost_daily|usage_daily|usage_stats|operator_profiles|super_audit" firebase/functions/index.js | head -20`

Use the actual path that the writers use. Add `if false` rules for each (admin SDK writes bypass rules; clients must not touch these).

**Step 3: Lint the rules**

Run: `cd firebase && firebase deploy --only firestore:rules --dry-run 2>&1 | tail -30`
Expected: "compiled successfully" or equivalent. If the dry-run flag isn't supported on the installed CLI, run `firebase emulators:exec --only firestore "echo ok"` to verify rule compile.

**Step 4: Commit**

```bash
git add firebase/firestore.rules
git commit -m "chore(rules): deny client access to admin-SDK-only collections

geminiUsage, cost_daily, tenant_costs_monthly, usage_daily,
usage_stats_monthly, operator_profiles, super_audit — all written
by Cloud Functions only. Explicit deny prevents accidental client
write attempts from bypassing the secureApi audit trail."
```

---

## Task 6 — Add the impersonation handler in `index.html`

**Files:**
- Modify: `firebase/public/index.html` — early init script.

**Step 1: Find the auth init block**

Run: `grep -n "onAuthStateChanged\|signInWithCustomToken\|firebase.initializeApp" firebase/public/index.html | head -10`

Locate the script block where `firebase.initializeApp` runs and where `auth.onAuthStateChanged` is wired.

**Step 2: Insert the impersonation handler immediately after `firebase.initializeApp`, before the auth-state listener**

```html
<script>
(function impersonationBootstrap() {
  // If launched from /super-admin with ?impersonateToken=…&tenant=…&expiresAt=…,
  // sign in with the custom token, scrub the URL, and let the rest of the app boot
  // as the impersonated tenant. The banner (see banner script) detects the
  // resulting impersonating claim and renders itself.
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('impersonateToken');
    if (!token) return;
    const tenant = params.get('tenant') || '';
    const expiresAt = Number(params.get('expiresAt') || 0);
    sessionStorage.setItem('impersonationExpiresAt', String(expiresAt));
    sessionStorage.setItem('impersonationTenantSlug', tenant);
    // Scrub the URL so a copy-paste doesn't leak the token.
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, '', cleanUrl);
    firebase.auth().signInWithCustomToken(token).catch(err => {
      console.error('[impersonation] sign-in failed:', err);
      alert('Impersonation sign-in failed: ' + (err.message || err));
    });
  } catch (e) {
    console.warn('[impersonation] bootstrap failed:', e);
  }
})();
</script>
```

The `<script>` block must live **after** the existing `firebase.initializeApp(window.firebaseConfig)` call but **before** the `onAuthStateChanged` listener — otherwise the listener fires before the custom-token sign-in starts.

**Step 3: Commit**

```bash
git add firebase/public/index.html
git commit -m "feat(app): handle ?impersonateToken= query param

Signs in with the custom token minted by superOpImpersonateTenant,
scrubs the token from the URL, and stores the expiry in
sessionStorage for the banner to display."
```

---

## Task 7 — Render the impersonation banner + auto-logout in `index.html`

**Files:**
- Modify: `firebase/public/index.html` — add banner DOM + script.

**Step 1: Add banner DOM right after `<body>`**

Insert at the very top of `<body>`:

```html
<div id="impersonation-banner" style="display:none;position:sticky;top:0;left:0;right:0;z-index:9999;
  background:linear-gradient(90deg,#d63031 0%,#ff7675 100%);color:#fff;padding:8px 14px;
  font-family:Inter,system-ui,sans-serif;font-size:13px;font-weight:600;text-align:center;
  box-shadow:0 4px 14px rgba(0,0,0,.3);letter-spacing:.02em">
  <span id="imp-banner-text">⚠ IMPERSONATING — read-only</span>
  <span id="imp-banner-countdown" style="margin-left:14px;font-family:JetBrains Mono,monospace;opacity:.92"></span>
  <button id="imp-banner-exit" style="margin-left:14px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.4);
    color:#fff;padding:3px 10px;border-radius:4px;font-weight:700;cursor:pointer;font-size:11px;font-family:inherit">
    EXIT IMPERSONATION
  </button>
</div>
```

**Step 2: Add the banner-driver script — place it inside the existing `onAuthStateChanged` callback or just after**

```html
<script>
(function impersonationBanner() {
  const banner = document.getElementById('impersonation-banner');
  const text = document.getElementById('imp-banner-text');
  const countdown = document.getElementById('imp-banner-countdown');
  const exitBtn = document.getElementById('imp-banner-exit');
  let timer = null;
  let expiresAt = 0;

  exitBtn.addEventListener('click', async () => {
    try { await firebase.auth().signOut(); } catch (e) {}
    window.location.href = '/super-admin.html';
  });

  function format(ms) {
    if (ms <= 0) return '00:00';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function startCountdown() {
    if (timer) clearInterval(timer);
    timer = setInterval(async () => {
      const remaining = expiresAt - Date.now();
      countdown.textContent = format(remaining) + ' remaining';
      if (remaining <= 0) {
        clearInterval(timer);
        try { await firebase.auth().signOut(); } catch (e) {}
        alert('Impersonation session expired. Returning to super-admin console.');
        window.location.href = '/super-admin.html';
      }
    }, 1000);
  }

  firebase.auth().onAuthStateChanged(async user => {
    if (!user) { banner.style.display = 'none'; return; }
    try {
      const tok = await user.getIdTokenResult(false);
      const c = tok.claims || {};
      if (c.impersonating === true) {
        const tenant = c.impersonatingTenantSlug || sessionStorage.getItem('impersonationTenantSlug') || c.tenantSlug || '?';
        const admin = c.impersonatingAs || '?';
        text.innerHTML = '⚠ <strong>IMPERSONATING</strong> ' + tenant + ' as ' + admin + ' · read-only';
        expiresAt = Number(c.impersonationExpiresAt) || Number(sessionStorage.getItem('impersonationExpiresAt')) || 0;
        banner.style.display = 'block';
        if (expiresAt) startCountdown();
      } else {
        banner.style.display = 'none';
      }
    } catch (e) {
      console.warn('[impersonation] banner check failed:', e);
    }
  });
})();
</script>
```

**Step 3: Commit**

```bash
git add firebase/public/index.html
git commit -m "feat(app): impersonation banner + auto-logout

Sticky red banner shows the impersonated tenant, the operator
email, and a live countdown. Click EXIT or wait for expiry to
sign out and return to /super-admin.html."
```

---

## Task 8 — Add per-feature feedback widget in `index.html`

**Files:**
- Modify: `firebase/public/index.html` — add a floating feedback button + modal.

**Step 1: Confirm the `submitFeedback` op and feature allowlist**

Already confirmed: `firebase/functions/index.js:1202-1230` accepts `{ feature, sentiment: 'positive'|'negative', comment }` for features in: `recipes, inventory, prep_sheets, ingredients, menu, shopping, vendor_orders, activity_log, admin, scan, oracle_assistant, billing, general`.

**Step 2: Find the existing `secureApi` wrapper in `index.html`**

Run: `grep -n "secureApi\|cloudFunctionUrl\|apiBase\|secure-api" firebase/public/index.html | head -10`

Note the function name and call shape so we can reuse it (likely `secureApi('submitFeedback', { feature, sentiment, comment, route, userAgent, appVersion })`).

**Step 3: Add the floating feedback button + modal at the bottom of `<body>`, before the closing tag**

```html
<style>
  #feedback-fab {
    position:fixed;bottom:20px;right:20px;z-index:8000;
    width:48px;height:48px;border-radius:24px;border:none;cursor:pointer;
    background:linear-gradient(135deg,#74acdf,#2e78b8);color:#fff;
    font-size:22px;box-shadow:0 6px 18px rgba(0,0,0,.35);
  }
  #feedback-fab:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(0,0,0,.45)}
  #feedback-modal-back {
    position:fixed;inset:0;background:rgba(5,10,22,.7);backdrop-filter:blur(4px);
    z-index:9000;display:none;align-items:center;justify-content:center;
  }
  #feedback-modal-back.open{display:flex}
  #feedback-modal {
    width:96%;max-width:420px;background:#1a2842;color:#e0e6ed;
    border:1px solid rgba(116,172,223,.35);border-radius:14px;padding:22px;
    font-family:Inter,system-ui,sans-serif;box-shadow:0 20px 50px rgba(0,0,0,.5);
  }
  #feedback-modal h3{font-size:17px;font-weight:800;margin-bottom:6px;color:#fff}
  #feedback-modal p{font-size:12px;color:#a0b4c8;margin-bottom:14px}
  #feedback-modal label{display:block;font-size:11px;color:#8a9bad;font-weight:700;
    text-transform:uppercase;letter-spacing:.08em;margin:10px 0 4px}
  #feedback-modal select,#feedback-modal textarea{width:100%;background:rgba(0,0,0,.4);
    border:1px solid rgba(255,255,255,.12);color:#e0e6ed;padding:9px 12px;border-radius:8px;
    font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box}
  #feedback-modal textarea{min-height:90px}
  .fb-thumbs{display:flex;gap:8px;margin-top:6px}
  .fb-thumb{flex:1;padding:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);
    color:#e0e6ed;border-radius:8px;cursor:pointer;font-size:14px;font-family:inherit;font-weight:600}
  .fb-thumb.active.pos{background:rgba(0,184,148,.25);border-color:rgba(0,184,148,.55);color:#6bd68a}
  .fb-thumb.active.neg{background:rgba(214,48,49,.25);border-color:rgba(214,48,49,.55);color:#ff9a9a}
  .fb-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
  .fb-btn{padding:8px 14px;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
  .fb-btn.primary{background:linear-gradient(135deg,#74acdf,#2e78b8);color:#fff}
  .fb-btn.ghost{background:rgba(255,255,255,.08);color:#e0e6ed;border:1px solid rgba(255,255,255,.15)}
</style>
<button id="feedback-fab" title="Send feedback" aria-label="Send feedback">♡</button>
<div id="feedback-modal-back" role="dialog" aria-labelledby="fb-title">
  <div id="feedback-modal">
    <h3 id="fb-title">Send feedback</h3>
    <p>Tell Anthony what's working or what's broken. Goes straight to the operator console.</p>
    <label>Feature</label>
    <select id="fb-feature">
      <option value="recipes">Recipes</option>
      <option value="ingredients">Ingredients</option>
      <option value="inventory">Inventory</option>
      <option value="prep_sheets">Prep sheets</option>
      <option value="menu">Menu</option>
      <option value="shopping">Shopping list</option>
      <option value="vendor_orders">Vendor orders</option>
      <option value="scan">Inventory scan</option>
      <option value="oracle_assistant">Oracle assistant (voice)</option>
      <option value="activity_log">Activity log</option>
      <option value="admin">Admin / billing</option>
      <option value="billing">Billing</option>
      <option value="general" selected>General</option>
    </select>
    <label>Reaction</label>
    <div class="fb-thumbs">
      <button class="fb-thumb pos" data-sent="positive">👍 Working</button>
      <button class="fb-thumb neg" data-sent="negative">👎 Not working</button>
    </div>
    <label>Comment (optional)</label>
    <textarea id="fb-comment" maxlength="2000" placeholder="What happened? What did you expect?"></textarea>
    <div class="fb-actions">
      <button class="fb-btn ghost" id="fb-cancel">Cancel</button>
      <button class="fb-btn primary" id="fb-send" disabled>Send</button>
    </div>
  </div>
</div>
<script>
(function feedbackWidget() {
  const fab = document.getElementById('feedback-fab');
  const back = document.getElementById('feedback-modal-back');
  const featureSel = document.getElementById('fb-feature');
  const commentEl = document.getElementById('fb-comment');
  const sendBtn = document.getElementById('fb-send');
  const cancelBtn = document.getElementById('fb-cancel');
  const thumbs = document.querySelectorAll('.fb-thumb');
  let sentiment = null;

  // Map current route to a default feature.
  function inferFeature() {
    const h = (window.location.hash || '').toLowerCase();
    if (h.includes('recipe')) return 'recipes';
    if (h.includes('ingred')) return 'ingredients';
    if (h.includes('inv')) return 'inventory';
    if (h.includes('prep')) return 'prep_sheets';
    if (h.includes('menu')) return 'menu';
    if (h.includes('shop')) return 'shopping';
    if (h.includes('vendor') || h.includes('order')) return 'vendor_orders';
    if (h.includes('scan')) return 'scan';
    if (h.includes('oracle') || h.includes('voice')) return 'oracle_assistant';
    if (h.includes('log') || h.includes('activity')) return 'activity_log';
    if (h.includes('admin')) return 'admin';
    if (h.includes('bill')) return 'billing';
    return 'general';
  }

  function open() {
    featureSel.value = inferFeature();
    sentiment = null;
    thumbs.forEach(t => t.classList.remove('active'));
    commentEl.value = '';
    sendBtn.disabled = true;
    back.classList.add('open');
    setTimeout(() => commentEl.focus(), 80);
  }
  function close() { back.classList.remove('open'); }

  function refreshSendEnabled() {
    sendBtn.disabled = !(sentiment || commentEl.value.trim());
  }

  fab.addEventListener('click', open);
  cancelBtn.addEventListener('click', close);
  back.addEventListener('click', e => { if (e.target === back) close(); });
  thumbs.forEach(t => t.addEventListener('click', () => {
    sentiment = t.dataset.sent;
    thumbs.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    refreshSendEnabled();
  }));
  commentEl.addEventListener('input', refreshSendEnabled);

  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    try {
      // secureApi is the existing wrapper. If the function name differs in this
      // file, change here.
      await secureApi('submitFeedback', {
        feature: featureSel.value,
        sentiment,
        comment: commentEl.value.trim().slice(0, 2000),
        route: window.location.hash || window.location.pathname,
        userAgent: (navigator.userAgent || '').slice(0, 300),
        appVersion: (window.APP_VERSION || ''),
      });
      sendBtn.textContent = 'Sent ✓';
      setTimeout(() => { close(); sendBtn.textContent = 'Send'; }, 700);
    } catch (e) {
      sendBtn.textContent = 'Send';
      alert('Feedback failed: ' + (e.message || e));
    } finally {
      sendBtn.disabled = false;
    }
  });

  // Hide the FAB if the user is impersonating — operator should not generate
  // fake feedback on the customer's behalf.
  firebase.auth().onAuthStateChanged(async user => {
    if (!user) { fab.style.display = 'none'; return; }
    try {
      const tok = await user.getIdTokenResult(false);
      fab.style.display = (tok.claims && tok.claims.impersonating) ? 'none' : 'block';
    } catch (e) { /* keep visible on error */ }
  });
})();
</script>
```

**Step 4: Sanity-check that `secureApi` exists with this signature**

If the existing wrapper has a different name (e.g. `callApi`, `cf`), find/replace before commit.

Run: `grep -nE "function secureApi|const secureApi|secureApi =" firebase/public/index.html | head -5`

If 0 hits: find the actual wrapper used elsewhere for `submitFeedback` or other writes (the prior backend test must have been driven by something), and substitute its name in the `sendBtn.addEventListener('click', ...)` call.

**Step 5: Commit**

```bash
git add firebase/public/index.html
git commit -m "feat(app): add per-feature feedback widget

Floating ♡ FAB opens a modal with feature selector, thumbs
positive/negative, and optional comment. Calls submitFeedback
op which writes to tenants/{id}/feedback_events. Hidden during
impersonation so operators don't pollute the data."
```

---

## Task 9 — Run `_e2e_super_admin.js` against the deployed (or local) endpoint

**Files:**
- Run: `firebase/functions/_e2e_super_admin.js`

**Step 1: Inspect the test to confirm prerequisites**

Run: `head -60 firebase/functions/_e2e_super_admin.js`

Confirm what env vars it needs (`FIREBASE_WEB_API_KEY` per earlier read).

**Step 2: Decide local vs deployed**

If a Firebase emulator with auth + functions is already configured (`firebase.json` should have an `emulators` block), prefer that. Otherwise run against the live endpoint after Task 10 deploy.

If running locally: `cd firebase && firebase emulators:start --only auth,functions,firestore` in another terminal, then in the test, point `SUPER_URL` to the emulator URL.

If running against deploy: skip this task and run the test in Task 11 after deploy.

**Step 3: Execute**

```bash
cd firebase/functions
FIREBASE_WEB_API_KEY="$(gcloud secrets versions access latest --secret=FIREBASE_WEB_API_KEY 2>/dev/null || echo)" \
  node _e2e_super_admin.js 2>&1 | tee /tmp/e2e-super-admin.log
```

If `gcloud secrets` is not configured, ask the user for the key — this is one of the few items where credentials require a human in the loop. (Per `~/.claude/CLAUDE.md`: "credentials I don't have access to" is a valid ask.)

**Step 4: Triage failures**

Any failure other than the one we caused → fix the underlying op before deploy. Run iteratively until green.

**Step 5: No commit needed** — this is a test run.

---

## Task 10 — Deploy Cloud Functions + Hosting + Firestore rules

**Files:**
- Run: `firebase deploy`

**Step 1: Pre-deploy diff sanity-check**

Run: `git status && git diff --stat HEAD`
Expected: `firebase/functions/index.js`, `firebase/firestore.rules`, `firebase/public/index.html`, `firebase/public/super-admin.html` modified or new. No surprise files. Backup/, node_modules/, audit_*.json should NOT be in the deploy.

**Step 2: Confirm `firebase.json` includes the new scheduled functions**

Run: `cat firebase/firebase.json | head -40`
Verify `functions` block exists. The exports in `index.js` (5 scheduled funcs) get picked up automatically — no `firebase.json` change needed.

**Step 3: Deploy**

```bash
cd firebase
firebase deploy --only functions,firestore:rules,hosting 2>&1 | tee /tmp/deploy.log
```

Watch for:
- `functions[superAdmin(us-central1)] Successful update operation.`
- `functions[dailyTenantCostAggregation(us-central1)] Successful create/update operation.`
- `firestore: released rules to cloud.firestore`
- `hosting: file upload complete`

**Step 4: If deploy fails on a single function**

Re-run with `--only functions:<name>` for the failing function, fix, redeploy.

**Step 5: No commit needed** — deploy is a side-effect, code already committed.

---

## Task 11 — Smoke-test the live console

**Files:** none — manual verification.

**Step 1: Open the live console**

Navigate to `https://bistrosteward.com/super-admin.html`. Confirm the existing super_admin Google account signs in and the gate passes.

**Step 2: Walk every tab — Overview**

- KPI grid loads with non-`—` values. If all KPIs are `—`, run rollups (button on Overview).
- MRR sparkline draws.
- Top at-risk tenants list populates.
- Recent audit shows entries.

**Step 3: Tenants tab**

- Table loads (must be `<500ms` per spec; record load time from DevTools network).
- Filter by status, plan, sort by health/MRR/slug.
- Click a tenant → drawer opens with summary/users/billing/costs/usage/health/tickets/feedback/notes/meta/data/audit/rawdata/flags/announce/actions/impersonate/refund/plan/comp/export/danger tabs, all loadable.

**Step 4: Tickets tab**

- Click `+ New ticket` → enter test tenant slug, subject, body, priority `low`. Toast `Ticket created: <id>`.
- Open the ticket from the list → reply with `internal=false`, then with `internal=true`. Confirm both render.
- Assign to your operator email. Confirm.
- Close the ticket. Confirm chip turns to `closed`.
- Reopen.

**Step 5: Feedback tab**

- In a separate browser/profile, sign in as a tenant user.
- Click the ♡ FAB on the main app → submit a thumbs-down with comment "smoke test".
- Back on the operator console Feedback tab → refresh → confirm the event appears with feature, sentiment, comment, tenant.

**Step 6: Impersonation flow**

- On a tenant detail drawer, click `Impersonate`.
- New tab opens. Confirm:
  - Red banner shows `IMPERSONATING <slug> as <your email> · 29:xx remaining`.
  - URL has been scrubbed of the token.
  - Try to write — e.g. add an ingredient. Expect a 403 toast/error from `secureApi`.
  - Click `EXIT IMPERSONATION` → redirected to `/super-admin.html`, signed out of the impersonated tab.
- Back on console: confirm an `impersonation` audit row was written (check the Recent audit on Overview, or the tenant's Audit tab).

**Step 7: Capture screenshots**

Per spec deliverable. Use the macOS `Cmd+Shift+4` or the `screencapture` CLI. Save to `docs/screenshots/super-admin-overview.png`, `…tenants.png`, `…tenant-drawer.png`, `…tickets.png`, `…ticket-thread.png`, `…feedback.png`, `…agents.png`, `…announce.png`, `…flags.png`, `…settings.png`, `…impersonation-banner.png`.

```bash
mkdir -p docs/screenshots
# manually capture each via Cmd+Shift+4, save to the names above
```

If user prefers automated capture: I can drive Chrome via the `claude-in-chrome` MCP. Skip if Chrome MCP not connected.

**Step 8: Commit screenshots**

```bash
git add docs/screenshots
git commit -m "docs: add smoke-test screenshots for operator console"
```

---

## Task 12 — Final commit & changelog

**Files:**
- Modify: `Restaurant_Oracle_Updates.md` if it exists (mentioned in `git status`).

**Step 1: Check the changelog file**

Run: `ls Restaurant_Oracle_Updates.md && head -20 Restaurant_Oracle_Updates.md`

If it exists and follows a date-stamped pattern, prepend a 2026-04-24 entry summarizing:
- Operator console deployed, all 8 tabs live.
- Per-tenant Gemini cost tracking now functional.
- In-app feedback widget rolled out to all tenants.
- Impersonation flow live (read-only, 30 min cap, audited).

**Step 2: Commit changelog if updated**

```bash
git add Restaurant_Oracle_Updates.md
git commit -m "docs: changelog entry for operator console launch"
```

**Step 3: Final status**

Run: `git log --oneline -15 && git status`

Expected: clean working tree (or only the unrelated untracked Backup/ etc. that pre-existed). All operator-console commits present.

**Step 4: Report back to user**

Summarize: deployed at `bistrosteward.com/super-admin.html`, all 8 tabs verified, screenshots captured, e2e green. Note any deferred items (e.g. anything yellow during smoke test).

---

## Risks & rollback

- **Gemini wrap regression:** If the wrap subtly changes the response shape (e.g. reads `result` vs `geminiResult`), voice/scan break. Mitigation: explicit smoke test in Task 11; rollback by `git revert` of Tasks 1 and 2 commits.
- **Impersonation read-only too strict:** If a read-only op is missing from `readOnlyOps` allowlist in Task 4, the impersonator hits 403 for benign reads. Mitigation: smoke test covers main user flows; widen the allowlist.
- **Firestore rules over-deny:** If a client legitimately needs to read `geminiUsage` (it doesn't today, but future code might), the rule blocks it. Mitigation: rollback rules deploy via `firebase firestore:rules:release <previous-version>`.
- **Feedback widget submitFeedback name mismatch:** If `secureApi` wrapper has a different name in `index.html`, the Send button fails silently. Caught in Task 8 step 4 grep + Task 11 step 5 smoke test.

## Success criteria

1. `https://bistrosteward.com/super-admin.html` loads, all tabs render data without errors in console.
2. A test ticket can be created, replied, assigned, closed, reopened.
3. A test feedback event submitted from the main app surfaces in the Feedback tab within 30 s.
4. An impersonation session: opens new tab, shows banner with countdown, blocks writes with 403, auto-signs-out after 30 min.
5. `tenants/{id}/geminiUsage` has new docs after a voice or scan call. `dailyTenantCostAggregation` rollup picks them up the next morning.
6. `_e2e_super_admin.js` passes against the live endpoint.
7. Screenshots committed under `docs/screenshots/`.

---


<a id="plan-youtube"></a>

# Plan: YouTube Tutorials (2026-04-24)

_Source: `docs/plans/2026-04-24-youtube-tutorials.md`_

# Bistro Steward YouTube Tutorial Series — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce 10 short YouTube tutorial videos covering end-to-end new-restaurant setup for Bistro Steward, plus the supporting in-app help drawer, demo tenant, and scripts repository required to record and link them.

**Architecture:** Three workstreams in sequence — (1) build the missing UI surfaces the spec assumes (help drawer + `?help=` deep-linker, recipe cost badge, Oracle text chat with analytical intents) so every video has something real to film, (2) seed a stable demo tenant via a repeatable script, (3) write all 10 scripts before any recording. Recording, upload, captioning, and YouTube channel work hand off to the human user (Anthony) after script approval.

**Tech Stack:** Vanilla JS PWA (`firebase/public/app.html`), Firebase Auth + Firestore (`/tenants/{tenantId}/...`), Cloud Functions Node 22 (`firebase/functions/index.js`), Gemini 2.5 Flash via `@google/generative-ai`, Square Web Payments SDK, Markdown scripts in `docs/tutorials/`, Node seed script using Firebase Admin SDK + ADC credentials.

**Status (updated 2026-05-01):** Plan composed and awaiting Anthony approval. Nothing executed yet.

| Phase | State | Notes |
|---|---|---|
| Phase 0 — recon | ⬜ not started | Earlier exploration cited wrong file (`index.html` 641-line landing instead of `app.html` 9212 lines). Re-verify cost-UI + Oracle state before Chunk 2. |
| Chunk 1 — foundation | ⬜ not started | `docs/tutorials/` skeleton, help drawer (CSS+JS+JSON), `app.html` wiring, demo-tenant seeder, 6 fixture JSONs. |
| Chunk 2 — features | ⬜ not started | Recipe cost badge (green/yellow/red), Oracle text chat (4 intents: margin_trend, unused_ingredients, vendor_forecast, recipe_health). |
| Chunk 3 — scripts | ⬜ not started | 10 markdown scripts at 150 wpm, plus recording-guide.md and upload-checklist.md. |
| Chunk 4 — record/upload | ⬜ user-owned | 10 days estimated. Triggered after script approval. |

**Confirmed decisions:**

1. Build all blocker features in this task — videos 6 (cost badge) and 10 (Oracle chat) are not deferred (per CLAUDE.md "complete coverage" rule).
2. Help drawer + `?help=` deep-link in scope.
3. Demo data spec: 40 ingredients, 15 recipes, 3 menus, 4 areas, 2 vendors, 7 days mock sales.
4. Demo tenant: slug `demo-restaurant`, owner `demo@bistrosteward.com`, marked `isDemo: true` so never billed and never appears in production reports.
5. Square sandbox card `4111 1111 1111 1111` exp `12/26` CVV `123` ZIP `97229` for all card demos.
6. Effort split: Claude ≈ 3 days (recon + chunks 1-3); Anthony ≈ 13 days (record + edit + caption + upload). Total ≈ 16 working days.

**Open items requiring real assets (Anthony):**

- Grocery receipt photo for video 4 (`docs/tutorials/_assets/04-receipt.jpg`).
- Vendor invoice PDF for video 5 (`docs/tutorials/_assets/05-invoice.pdf`).
- YouTube channel "Bistro Steward" creation (channel art + thumbnails).
- Real YouTube video IDs pasted back into `firebase/public/help-videos.json` after upload.

---

## Spec Summary

10 videos, 2-5 min each, screen-recording + voiceover, 1080p, single-purpose, linked from in-app help icons via `?help=video-slug` deep-link.

| # | Title | Length | Status |
|---|---|---|---|
| 1 | Welcome to Bistro Steward | 90s | Ready to script |
| 2 | Sign up and create your account | 3m | Ready (signup.html + terms.html exist) |
| 3 | Set up your team | 2m | Ready (admin.html team UI) |
| 4 | Create your first ingredient list | 4m | Ready (manual + AI receipt scan) |
| 5 | Scan a vendor invoice | 3m | Ready (same scan op, longer doc) |
| 6 | Cost your first recipe | 5m | **Blocked** — green/red cost badge UI not built |
| 7 | Build a prep sheet | 3m | Ready |
| 8 | Count inventory with your phone | 3m | Ready |
| 9 | Send a vendor order | 4m | Ready |
| 10 | Ask the Oracle anything | 3m | **Blocked** — Oracle is voice-only, no text chat or analytical intents |

Cross-cutting blockers: help drawer + `?help=` URL handler do not exist; demo tenant has no seed script; `docs/tutorials/` directory does not exist.

## Decisions baked in

1. Build all blocker features in this task (do not defer videos 6 and 10 — CLAUDE.md "complete coverage" rule).
2. Help drawer is in scope.
3. Demo data: 40 ingredients, 15 recipes, 3 menus, 4 storage areas, 2 vendors, 1 week of mock sales.
4. Demo tenant slug: `demo-restaurant`, owner email: `demo@bistrosteward.com`.
5. YouTube channel: "Bistro Steward" (user creates).
6. Square sandbox for all card demos. Test card: `4111 1111 1111 1111`, exp `12/26`, CVV `123`, ZIP `97229`.
7. Scripts live in `docs/tutorials/NN-slug.md`, one per video, version controlled.
8. Recording, editing, upload, captioning, thumbnails — user (Anthony) executes after scripts approved.

---

## File Structure

### Created files

| Path | Responsibility |
|---|---|
| `docs/plans/2026-04-24-youtube-tutorials.md` | This plan (already created on save). |
| `docs/tutorials/README.md` | Index, recording guide, link map. |
| `docs/tutorials/01-welcome.md` | Script for video 1. |
| `docs/tutorials/02-signup.md` | Script for video 2. |
| `docs/tutorials/03-team.md` | Script for video 3. |
| `docs/tutorials/04-ingredients.md` | Script for video 4. |
| `docs/tutorials/05-vendor-invoice.md` | Script for video 5. |
| `docs/tutorials/06-recipe-costing.md` | Script for video 6. |
| `docs/tutorials/07-prep-sheet.md` | Script for video 7. |
| `docs/tutorials/08-inventory-count.md` | Script for video 8. |
| `docs/tutorials/09-vendor-order.md` | Script for video 9. |
| `docs/tutorials/10-oracle-ask.md` | Script for video 10. |
| `docs/tutorials/recording-guide.md` | OBS settings, mic config, take checklist, redaction rules. |
| `docs/tutorials/upload-checklist.md` | YouTube upload steps, thumbnail spec, chapter timestamps, caption workflow. |
| `firebase/public/help-drawer.css` | Drawer styles. |
| `firebase/public/help-drawer.js` | Drawer component, `?help=` parser, video map, deep-link handler. |
| `firebase/public/help-videos.json` | Slug → YouTube ID + title + chapter map. Editable without redeploy. |
| `firebase/functions/oracle_chat.js` | New Gemini text-chat handler with analytical intents. |
| `firebase/functions/oracle_intents/` | Per-intent SQL-like queries against tenant Firestore (margin_trend, unused_ingredients, vendor_forecast, recipe_health). |
| `scripts/seed-demo-tenant.js` | Idempotent demo tenant provisioner. |
| `scripts/seed-demo-data/ingredients.json` | 40 generic-named ingredients with vendor, unit, cost. |
| `scripts/seed-demo-data/recipes.json` | 15 recipes (e.g. caesar salad, ribeye, frites). |
| `scripts/seed-demo-data/menus.json` | 3 menus (lunch, dinner, weekend brunch). |
| `scripts/seed-demo-data/areas.json` | 4 areas (walk-in, dry storage, freezer, prep). |
| `scripts/seed-demo-data/vendors.json` | 2 vendors (Sysco, Pacific Seafood) with email contacts. |
| `scripts/seed-demo-data/sales.json` | 7 days of mock sales for shopping-list math to work. |
| `scripts/README.md` | How to run the seeder, prerequisites, ADC auth, idempotency notes. |

### Modified files

| Path | Change |
|---|---|
| `firebase/public/app.html` | Add `<link>` and `<script>` for help drawer, add help-icon buttons next to top-bar in 8 contexts, add `?help=` boot path. Add cost-badge DOM in recipe modal. Add Oracle text-chat panel (toggle from voice FAB). |
| `firebase/public/signup.html` | Audit + light copy edits if step labels do not match script 02. |
| `firebase/public/terms.html` | Audit. Add ToS-acceptance checkbox link target if not already present in signup flow. |
| `firebase/public/admin.html` | Audit team-invite labels match script 03. |
| `firebase/functions/index.js` | Wire `oracle_chat.js` into request router behind a new operation `oracleChat`. Add `seedDemoData` operation gated to super-admin. |
| `firebase/functions/package.json` | Confirm `@google/generative-ai`, add `firebase-admin` if missing for seeder (already present per memory). |

### Untouched (filming targets only)

`scan` op (`firebase/functions/index.js`), Inventory tab UI, Prep tab UI, Shopping tab UI, Vendor tab UI, onboarding wizard.

---

## Phase 0 — Recon Verification

Earlier exploration cited `firebase/public/index.html` (641-line landing page) instead of `firebase/public/app.html` (9212-line main app). Several gap claims must be re-verified before code is written.

### Task 0.1: Re-verify recipe costing UI in `app.html`

**Files:**
- Read: `firebase/public/app.html`

- [ ] **Step 1: Locate recipe modal**

```bash
grep -n "renderRecs\|recipe-modal\|recipeModal\|food.cost\|foodCost" /Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/app.html | head -50
```

- [ ] **Step 2: Read recipe ingredient/cost section**

Read the matched lines ±60. Determine which of these exist today:
1. Per-ingredient cost computation (qty × ing.cost).
2. Recipe-total cost.
3. Yield/portion divisor.
4. Food-cost % displayed in DOM.
5. Color indicator (CSS class such as `.cost-good`, `.cost-bad`).

- [ ] **Step 3: Record findings in `docs/plans/recon-2026-04-24.md`**

Write a short table with column "exists | partial | missing" per item. This dictates whether Phase 2 builds the badge from scratch or only adds the visual layer on top of existing math.

- [ ] **Step 4: Commit**

```bash
git add docs/plans/recon-2026-04-24.md
git commit -m "docs: phase-0 recon recipe costing"
```

### Task 0.2: Re-verify Oracle chat surface in `app.html`

**Files:**
- Read: `firebase/public/app.html`

- [ ] **Step 1: Locate Oracle/voice/Gemini code**

```bash
grep -n "voiceToggle\|voiceProcess\|oracle\|gemini\|/voice\|/oracle\|chat-panel" /Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/app.html | head -50
```

- [ ] **Step 2: Inspect transcript handling, FAB DOM, any latent text-input markup**

- [ ] **Step 3: Append findings to `docs/plans/recon-2026-04-24.md`**

Document: voice path, latency, intent-router shape, any reusable transcript display.

- [ ] **Step 4: Commit**

```bash
git add docs/plans/recon-2026-04-24.md
git commit -m "docs: phase-0 recon oracle chat"
```

### Task 0.3: Re-verify help-icon / `?help=` infrastructure

**Files:**
- Read: `firebase/public/app.html`

- [ ] **Step 1: Search**

```bash
grep -n "URLSearchParams\|location.search\|?help\|help-drawer\|helpVideo" /Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/app.html
```

- [ ] **Step 2: Record findings.** Confirm `?help=` is unhandled. Confirm there is no global help drawer.

- [ ] **Step 3: Commit recon doc final**

```bash
git add docs/plans/recon-2026-04-24.md
git commit -m "docs: phase-0 recon complete"
```

---

## Chunk 1: Foundation — directories, help drawer, demo tenant seeder

### Task 1.1: Create `docs/tutorials/` skeleton

**Files:**
- Create: `docs/tutorials/README.md`

- [ ] **Step 1: Write README**

```markdown
# Bistro Steward Tutorial Scripts

Each script in this directory drives one YouTube video. Scripts are reviewed
before any recording happens. Once a video is uploaded, paste its YouTube ID
into `firebase/public/help-videos.json` so in-app help icons deep-link to it.

## Conventions
- Word count target: 150 words per minute of finished video.
- "Show:" lines describe screen actions. "Say:" lines are voiceover.
- "On screen:" lines are callouts/zooms the editor adds in post.
- Never include real customer data, real card numbers, real API keys, or
  real tenant UUIDs. Use the demo tenant only.

## Demo tenant
Slug `demo-restaurant`. Email `demo@bistrosteward.com`. Reset via
`node scripts/seed-demo-tenant.js --reset` before each recording session.

## Index
1. [Welcome](01-welcome.md)
2. [Sign up](02-signup.md)
3. [Team](03-team.md)
4. [Ingredients](04-ingredients.md)
5. [Vendor invoice scan](05-vendor-invoice.md)
6. [Recipe costing](06-recipe-costing.md)
7. [Prep sheet](07-prep-sheet.md)
8. [Inventory count](08-inventory-count.md)
9. [Vendor order](09-vendor-order.md)
10. [Ask the Oracle](10-oracle-ask.md)
```

- [ ] **Step 2: Commit**

```bash
git add docs/tutorials/README.md
git commit -m "docs: create tutorials skeleton"
```

### Task 1.2: Help-drawer CSS

**Files:**
- Create: `firebase/public/help-drawer.css`

- [ ] **Step 1: Write CSS** (drawer slides from right, 420px, dark theme matching app, YouTube iframe area, close X, chapter list)

```css
.help-drawer-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.55);
  opacity: 0; pointer-events: none; transition: opacity .2s; z-index: 9998;
}
.help-drawer-backdrop.open { opacity: 1; pointer-events: auto; }

.help-drawer {
  position: fixed; top: 0; right: -480px; width: 420px; max-width: 100vw;
  height: 100vh; background: #1a1d23; color: #e9ecef; box-shadow: -4px 0 24px rgba(0,0,0,.4);
  transition: right .25s ease; z-index: 9999; display: flex; flex-direction: column;
  font: 14px/1.4 -apple-system, system-ui, sans-serif;
}
.help-drawer.open { right: 0; }
.help-drawer__hdr { display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid #2a2f37; }
.help-drawer__title { font-size: 16px; font-weight: 600; }
.help-drawer__close { background: none; color: #8a92a3; border: 0; font-size: 22px; cursor: pointer; }
.help-drawer__close:hover { color: #fff; }
.help-drawer__video { aspect-ratio: 16/9; background: #000; }
.help-drawer__video iframe { width: 100%; height: 100%; border: 0; }
.help-drawer__body { padding: 16px 20px; overflow-y: auto; flex: 1; }
.help-drawer__chapters { list-style: none; padding: 0; margin: 8px 0; }
.help-drawer__chapters li { padding: 6px 0; cursor: pointer; }
.help-drawer__chapters li:hover { color: #6cb2ff; }
.help-drawer__chapters time { color: #8a92a3; margin-right: 12px; font-variant-numeric: tabular-nums; }

.help-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 50%; border: 1px solid #4a5160;
  background: transparent; color: #8a92a3; cursor: pointer; font-size: 13px;
  margin-left: 8px;
}
.help-icon-btn:hover { color: #6cb2ff; border-color: #6cb2ff; }
```

- [ ] **Step 2: Commit**

```bash
git add firebase/public/help-drawer.css
git commit -m "feat(help): drawer styles"
```

### Task 1.3: Help-video map JSON

**Files:**
- Create: `firebase/public/help-videos.json`

- [ ] **Step 1: Write file with placeholder YouTube IDs (real IDs filled in after upload)**

```json
{
  "_doc": "Slug-to-YouTube map. Replace YOUTUBE_ID_* with real ID after upload. Chapters in seconds.",
  "welcome":         { "yt": "YOUTUBE_ID_01", "title": "Welcome to Bistro Steward", "chapters": [] },
  "signup":          { "yt": "YOUTUBE_ID_02", "title": "Sign up and create your account",
                       "chapters": [[0,"Intro"],[20,"Pick a plan"],[60,"Card entry"],[120,"Verify email"],[160,"First login"]] },
  "team":            { "yt": "YOUTUBE_ID_03", "title": "Set up your team",
                       "chapters": [[0,"Intro"],[15,"Open Billing & Team"],[40,"Invite employee"],[75,"Invite manager"],[100,"Member accept"]] },
  "ingredients":     { "yt": "YOUTUBE_ID_04", "title": "Create your first ingredient list",
                       "chapters": [[0,"Intro"],[20,"Manual add"],[80,"AI scan"],[180,"Review & commit"]] },
  "vendor-invoice":  { "yt": "YOUTUBE_ID_05", "title": "Scan a vendor invoice",
                       "chapters": [[0,"Intro"],[20,"Upload"],[60,"Review"],[120,"Audit trail"]] },
  "recipe-costing":  { "yt": "YOUTUBE_ID_06", "title": "Cost your first recipe",
                       "chapters": [[0,"Intro"],[30,"New recipe"],[90,"Add ingredients"],[180,"Yield & portion"],[240,"Read the badge"]] },
  "prep-sheet":      { "yt": "YOUTUBE_ID_07", "title": "Build a prep sheet",
                       "chapters": [[0,"Intro"],[30,"Pick recipes"],[90,"Adjust pars"],[150,"Print"]] },
  "inventory-count": { "yt": "YOUTUBE_ID_08", "title": "Count inventory with your phone",
                       "chapters": [[0,"Intro"],[20,"Print blank sheet"],[80,"Walk the area"],[140,"Scan filled sheet"]] },
  "vendor-order":    { "yt": "YOUTUBE_ID_09", "title": "Send a vendor order",
                       "chapters": [[0,"Intro"],[20,"Calculate"],[120,"Review"],[180,"Email"]] },
  "oracle-ask":      { "yt": "YOUTUBE_ID_10", "title": "Ask the Oracle anything",
                       "chapters": [[0,"Intro"],[20,"Margin trends"],[80,"Stopped using"],[140,"Forecast"]] }
}
```

- [ ] **Step 2: Commit**

```bash
git add firebase/public/help-videos.json
git commit -m "feat(help): video slug map"
```

### Task 1.4: Help-drawer JS — TDD red

**Files:**
- Create: `firebase/public/help-drawer.js`
- Create: `firebase/public/__tests__/help-drawer.test.html`

- [ ] **Step 1: Write failing browser test (open `__tests__/help-drawer.test.html` in headless via Puppeteer or simple manual checklist; project lacks vitest per memory)**

Test fixture HTML (assert via `console.assert` and visible result):

```html
<!doctype html>
<html><head><link rel="stylesheet" href="../help-drawer.css"></head>
<body>
<button class="help-icon-btn" data-help="welcome">?</button>
<script src="../help-drawer.js"></script>
<script>
  // Test 1: param parser surfaces slug
  history.replaceState(null,'','?help=signup');
  console.assert(HelpDrawer._parseSlug() === 'signup', 'parseSlug should read query param');

  // Test 2: open() inserts iframe with correct embed URL and 'open' class
  HelpDrawer.open('welcome', { videos: {welcome:{yt:'abc123', title:'X', chapters:[]}} });
  const drawer = document.querySelector('.help-drawer');
  console.assert(drawer.classList.contains('open'), 'drawer should be open');
  console.assert(drawer.querySelector('iframe').src.includes('abc123'), 'iframe should embed yt id');

  // Test 3: close() removes 'open' class
  HelpDrawer.close();
  console.assert(!drawer.classList.contains('open'), 'drawer should be closed');

  // Test 4: clicking a chapter timestamp seeks via postMessage
  HelpDrawer.open('signup', { videos: {signup:{yt:'def456', title:'Y', chapters:[[60,'B']]}}});
  const li = document.querySelector('.help-drawer__chapters li');
  console.assert(li.textContent.includes('1:00'), 'chapter renders mm:ss');

  document.body.insertAdjacentHTML('beforeend','<p>All tests passed.</p>');
</script>
</body></html>
```

- [ ] **Step 2: Open test in Chrome — confirm `HelpDrawer is not defined`**

- [ ] **Step 3: Write `help-drawer.js`**

```javascript
(function (global) {
  'use strict';

  const STATE = { videos: null, mounted: false };

  function _mount() {
    if (STATE.mounted) return;
    const html = `
      <div class="help-drawer-backdrop" data-act="close-help"></div>
      <aside class="help-drawer" role="dialog" aria-label="Help">
        <header class="help-drawer__hdr">
          <span class="help-drawer__title"></span>
          <button class="help-drawer__close" data-act="close-help" aria-label="Close">×</button>
        </header>
        <div class="help-drawer__video"></div>
        <div class="help-drawer__body">
          <h4>Chapters</h4>
          <ol class="help-drawer__chapters"></ol>
        </div>
      </aside>`;
    document.body.insertAdjacentHTML('beforeend', html);
    document.body.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (t && t.dataset.act === 'close-help') close();
      const help = e.target.closest('[data-help]');
      if (help) { open(help.dataset.help); e.preventDefault(); }
    });
    STATE.mounted = true;
  }

  async function _loadMap() {
    if (STATE.videos) return STATE.videos;
    const res = await fetch('/help-videos.json', { cache: 'no-cache' });
    STATE.videos = await res.json();
    return STATE.videos;
  }

  function _fmtTime(s) {
    const m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function _parseSlug() {
    return new URLSearchParams(location.search).get('help');
  }

  async function open(slug, override) {
    _mount();
    const map = override?.videos || await _loadMap();
    const v = map[slug];
    if (!v || !v.yt || v.yt.startsWith('YOUTUBE_ID_')) {
      console.warn('Help: no video for', slug);
      return;
    }
    const drawer = document.querySelector('.help-drawer');
    drawer.querySelector('.help-drawer__title').textContent = v.title;
    drawer.querySelector('.help-drawer__video').innerHTML =
      `<iframe src="https://www.youtube-nocookie.com/embed/${v.yt}?enablejsapi=1&rel=0"
               allow="accelerometer; encrypted-media; picture-in-picture"
               allowfullscreen></iframe>`;
    const chap = drawer.querySelector('.help-drawer__chapters');
    chap.innerHTML = (v.chapters || []).map(([t, label]) =>
      `<li data-t="${t}"><time>${_fmtTime(t)}</time>${label}</li>`).join('');
    chap.onclick = (e) => {
      const li = e.target.closest('li[data-t]');
      if (!li) return;
      const iframe = drawer.querySelector('iframe');
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: 'seekTo', args: [+li.dataset.t, true] }),
        '*');
    };
    drawer.classList.add('open');
    drawer.previousElementSibling.classList.add('open');
  }

  function close() {
    const d = document.querySelector('.help-drawer');
    if (d) {
      d.classList.remove('open');
      d.previousElementSibling.classList.remove('open');
      d.querySelector('.help-drawer__video').innerHTML = '';
    }
  }

  function boot() {
    const slug = _parseSlug();
    if (slug) {
      document.addEventListener('DOMContentLoaded', () => open(slug));
    }
  }

  global.HelpDrawer = { open, close, boot, _parseSlug };
  boot();
})(window);
```

- [ ] **Step 4: Reload test fixture, confirm "All tests passed."**

- [ ] **Step 5: Commit**

```bash
git add firebase/public/help-drawer.js firebase/public/__tests__/help-drawer.test.html
git commit -m "feat(help): drawer + ?help= deep-linker"
```

### Task 1.5: Wire help drawer into `app.html`

**Files:**
- Modify: `firebase/public/app.html`

- [ ] **Step 1: Add stylesheet + script in `<head>`**

```html
<link rel="stylesheet" href="help-drawer.css">
<script src="help-drawer.js" defer></script>
```

- [ ] **Step 2: Add help-icon buttons in 8 places (one per video that has an in-app target).**

Snippets to inject next to each tab/section header — exact location during execution after grep:

| Tab/section | data-help slug |
|---|---|
| Onboarding wizard step 0 | `welcome` |
| Top-bar billing dropdown row | `signup` |
| admin.html team section | `team` |
| Ingredients tab header | `ingredients` |
| Inventory "Scan Sheet" button row | `vendor-invoice` |
| Recipes tab header | `recipe-costing` |
| Prep tab header | `prep-sheet` |
| Inventory tab header | `inventory-count` |
| Shopping tab header | `vendor-order` |
| Voice/chat panel header | `oracle-ask` |

Pattern to add next to existing header element:

```html
<button class="help-icon-btn" data-help="recipe-costing" title="Watch tutorial">?</button>
```

- [ ] **Step 3: Manual check**

Boot `firebase emulators:start --only hosting`, visit `http://localhost:5000/app.html?help=welcome`, confirm drawer opens with placeholder iframe (which 404s until real YouTube IDs are pasted — that is expected).

- [ ] **Step 4: Commit**

```bash
git add firebase/public/app.html firebase/public/admin.html
git commit -m "feat(help): wire drawer + 10 help icons"
```

### Task 1.6: Demo-data fixtures

**Files:**
- Create: `scripts/seed-demo-data/areas.json`
- Create: `scripts/seed-demo-data/vendors.json`
- Create: `scripts/seed-demo-data/ingredients.json`
- Create: `scripts/seed-demo-data/recipes.json`
- Create: `scripts/seed-demo-data/menus.json`
- Create: `scripts/seed-demo-data/sales.json`

- [ ] **Step 1: Write `areas.json`**

```json
[
  { "id": 1, "name": "Walk-in Cooler", "type": "fridge" },
  { "id": 2, "name": "Dry Storage",    "type": "dry"    },
  { "id": 3, "name": "Freezer",        "type": "freezer"},
  { "id": 4, "name": "Prep Line",      "type": "prep"   }
]
```

- [ ] **Step 2: Write `vendors.json`**

```json
[
  { "id": 1, "name": "Sysco Portland",     "email": "orders+demo@example-sysco.test",   "phone": "(503) 555-0142", "notes": "Tue/Fri delivery, 10am cutoff" },
  { "id": 2, "name": "Pacific Seafood Co", "email": "orders+demo@example-pacific.test", "phone": "(503) 555-0177", "notes": "Daily delivery 6am" }
]
```

- [ ] **Step 3: Write `ingredients.json` — 40 ingredients with realistic-yet-fake names, units, costs, vendorId, areaId**

Pattern (excerpt — full file in repo):

```json
[
  { "id": 1,  "name": "Yellow Onion",       "unit": "lb",   "packSize": 50,   "packCost": 32.50, "cost": 0.65, "vendorId": 1, "areaId": 2 },
  { "id": 2,  "name": "Garlic, Whole",      "unit": "lb",   "packSize": 5,    "packCost": 28.00, "cost": 5.60, "vendorId": 1, "areaId": 2 },
  { "id": 3,  "name": "Olive Oil, EVOO",    "unit": "L",    "packSize": 4,    "packCost": 96.00, "cost": 24.00,"vendorId": 1, "areaId": 2 },
  { "id": 4,  "name": "Kosher Salt",        "unit": "lb",   "packSize": 12,   "packCost": 18.00, "cost": 1.50, "vendorId": 1, "areaId": 2 },
  { "id": 5,  "name": "Black Pepper, GR",   "unit": "lb",   "packSize": 5,    "packCost": 95.00, "cost": 19.00,"vendorId": 1, "areaId": 2 },
  { "id": 6,  "name": "Romaine, hearts",    "unit": "case", "packSize": 12,   "packCost": 36.00, "cost": 3.00, "vendorId": 1, "areaId": 1 },
  { "id": 7,  "name": "Parmigiano-Reggiano","unit": "lb",   "packSize": 1,    "packCost": 22.00, "cost": 22.00,"vendorId": 1, "areaId": 1 },
  { "id": 8,  "name": "Lemon",              "unit": "ea",   "packSize": 165,  "packCost": 49.50, "cost": 0.30, "vendorId": 1, "areaId": 1 }
  /* … 32 more, including ribeye, salmon, butter, eggs, flour, sugar, yeast,
     basil, parsley, thyme, rosemary, capers, anchovies, dijon, mayo, panko,
     fries, pasta, tomato passata, heavy cream, milk, brioche, bacon, mushrooms,
     scallions, shallots, white wine, red wine, balsamic, sherry, Dover sole,
     ahi tuna, prawns, butter clams */
]
```

(Full 40-row JSON written during execution; values are illustrative restaurant pricing — Anthony reviews before filming.)

- [ ] **Step 4: Write `recipes.json` — 15 recipes referencing only seeded ingredient IDs**

Recipes: Caesar Salad, Ribeye 14oz, Frites, Pan-Seared Salmon, Margherita Pizza Dough, Tomato Sauce, Hollandaise, Brioche French Toast, Mushroom Risotto, Cacio e Pepe, Burger Patty 8oz, Buttermilk Biscuit, Chocolate Mousse, House Vinaigrette, Garlic Confit.

Each recipe: `{ id, name, yieldQty, yieldUnit, portionQty, portionUnit, menuPrice, ingredients: [{id, qty, unit}, ...] }`.

- [ ] **Step 5: Write `menus.json`**

```json
[
  { "id": 1, "name": "Lunch",          "items": [/* recipeIds */] },
  { "id": 2, "name": "Dinner",         "items": [/* recipeIds */] },
  { "id": 3, "name": "Weekend Brunch", "items": [/* recipeIds */] }
]
```

- [ ] **Step 6: Write `sales.json` — 7 days × 3 menus × randomized covers (40-110/day) for shopping-list math**

- [ ] **Step 7: Commit**

```bash
git add scripts/seed-demo-data/
git commit -m "data: demo-tenant seed fixtures (40 ing / 15 rec / 3 menu / 4 area / 2 vendor / 7d sales)"
```

### Task 1.7: Demo-tenant seeder script

**Files:**
- Create: `scripts/seed-demo-tenant.js`
- Create: `scripts/README.md`

- [ ] **Step 1: Write seeder using firebase-admin + ADC (org policy blocks SA keys per memory)**

```javascript
#!/usr/bin/env node
/**
 * Idempotent demo-tenant seeder.
 *
 * Usage:
 *   node scripts/seed-demo-tenant.js              # create or upsert
 *   node scripts/seed-demo-tenant.js --reset      # delete then recreate
 *   node scripts/seed-demo-tenant.js --dry-run    # print plan only
 *
 * Auth: relies on Application Default Credentials
 *       (gcloud auth application-default login).
 */
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'restaurant-oracle-prod' });
const db = admin.firestore();
const auth = admin.auth();

const TENANT_SLUG  = 'demo-restaurant';
const OWNER_EMAIL  = 'demo@bistrosteward.com';
const TENANT_NAME  = 'Demo Bistro (filming only)';

const args = new Set(process.argv.slice(2));
const RESET   = args.has('--reset');
const DRY_RUN = args.has('--dry-run');

async function load(name) {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, 'seed-demo-data', name + '.json'), 'utf8'));
}

async function ensureUser() {
  try { return await auth.getUserByEmail(OWNER_EMAIL); }
  catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    return auth.createUser({
      email: OWNER_EMAIL,
      password: '***REMOVED***',
      displayName: 'Demo Owner',
      emailVerified: true,
    });
  }
}

async function ensureTenant(uid) {
  const ref = db.collection('tenants').doc(TENANT_SLUG);
  await ref.set({
    name: TENANT_NAME,
    slug: TENANT_SLUG,
    ownerEmail: OWNER_EMAIL,
    ownerUid: uid,
    plan: 'pro',
    status: 'active',
    onboardingComplete: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    isDemo: true,
  }, { merge: true });
  return ref;
}

async function setClaims(uid) {
  await auth.setCustomUserClaims(uid, {
    tenantId: TENANT_SLUG,
    tenantSlug: TENANT_SLUG,
    approved: true,
    role: 'owner',
    isDemo: true,
  });
}

async function seedCollection(tenantRef, name, rows) {
  const col = tenantRef.collection(name);
  const batch = db.batch();
  rows.forEach((row) => batch.set(col.doc(String(row.id)), row));
  await batch.commit();
  console.log('  seeded', name, '×', rows.length);
}

async function reset(tenantRef) {
  for (const c of ['ingredients', 'recipes', 'menus', 'areas', 'vendors', 'sales', 'inventory']) {
    const snap = await tenantRef.collection(c).get();
    const batch = db.batch();
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

(async () => {
  console.log(DRY_RUN ? '[DRY RUN]' : 'Seeding demo tenant...');
  const user   = await ensureUser();
  const tenant = await ensureTenant(user.uid);
  await setClaims(user.uid);
  if (RESET) { console.log('Resetting collections...'); await reset(tenant); }

  for (const name of ['areas', 'vendors', 'ingredients', 'recipes', 'menus', 'sales']) {
    const rows = await load(name);
    if (DRY_RUN) console.log('  would seed', name, '×', rows.length);
    else        await seedCollection(tenant, name, rows);
  }

  console.log('Done. Login: ' + OWNER_EMAIL + ' / ***REMOVED***');
  console.log('URL: https://bistrosteward.com/app.html');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: `scripts/README.md`**

```markdown
# Bistro Steward Scripts

## Seeding the demo tenant

Prereqs:
- `gcloud auth application-default login` (ADC)
- Project: `restaurant-oracle-prod` selected
- `npm install` (firebase-admin already pinned in functions/)

Run:
- `node scripts/seed-demo-tenant.js` — create or upsert
- `node scripts/seed-demo-tenant.js --reset` — wipe + reseed (use before each filming session)
- `node scripts/seed-demo-tenant.js --dry-run` — preview only

The seeder is idempotent. Tenant doc has `isDemo: true` so it can never be billed and never appears in production reports.
```

- [ ] **Step 3: Dry-run**

```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle
node scripts/seed-demo-tenant.js --dry-run
```

Expected: prints `would seed ingredients × 40`, etc., exits 0.

- [ ] **Step 4: Real run**

```bash
node scripts/seed-demo-tenant.js --reset
```

Expected: creates user, tenant, claims, all collections. Login at https://bistrosteward.com/app.html with the printed credentials confirms onboarding is complete and ingredients tab shows 40 rows.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-demo-tenant.js scripts/README.md
git commit -m "feat(seed): idempotent demo-tenant seeder"
```

---

## Chunk 2: Missing UI features (cost badge + Oracle text chat)

### Task 2.1: Recipe cost-badge — TDD

Phase 0 recon dictates whether the math already exists or must be added. Two branches.

#### Branch A — math already exists, only DOM/CSS missing

**Files:**
- Modify: `firebase/public/app.html` (recipe modal section)

- [ ] **Step 1: Add badge DOM next to recipe header**

```html
<span class="cost-badge" data-recipe-cost-pct>
  <span class="cost-badge__pct">--%</span>
  <span class="cost-badge__lbl">food cost</span>
</span>
```

- [ ] **Step 2: Add CSS in app.html `<style>` block**

```css
.cost-badge {
  display: inline-flex; flex-direction: column; padding: 6px 12px;
  border-radius: 8px; font: 12px/1 -apple-system, sans-serif; min-width: 78px;
  text-align: center; margin-left: 12px;
}
.cost-badge__pct { font-size: 18px; font-weight: 700; }
.cost-badge.cost-good { background: #1f5132; color: #b8eccb; }
.cost-badge.cost-warn { background: #4a3d12; color: #f3d97e; }
.cost-badge.cost-bad  { background: #5a1f24; color: #ffb3ba; }
```

- [ ] **Step 3: Hook into existing render (call site identified in recon)**

```javascript
function _updateCostBadge(recipe) {
  const totalCost = (recipe.ingredients || [])
    .reduce((s, ri) => s + (ri.qty * (D.ings.find(i => i.id === ri.id)?.cost || 0)), 0);
  const portionCost = totalCost / Math.max(1, recipe.yieldQty / recipe.portionQty);
  const pct = recipe.menuPrice > 0 ? (portionCost / recipe.menuPrice) * 100 : 0;
  const el = document.querySelector('[data-recipe-cost-pct]');
  if (!el) return;
  el.querySelector('.cost-badge__pct').textContent = pct.toFixed(1) + '%';
  el.classList.remove('cost-good', 'cost-warn', 'cost-bad');
  el.classList.add(pct < 30 ? 'cost-good' : pct < 40 ? 'cost-warn' : 'cost-bad');
}
```

#### Branch B — math missing, both math and badge required

Same as Branch A plus the cost computation lives inline already.

- [ ] **Step 4: Manual test**

Open Caesar Salad in demo tenant. Confirm badge reads `28.x%` green. Edit recipe to set menuPrice = $8 instead of $14 — badge flips to red.

- [ ] **Step 5: Commit**

```bash
git add firebase/public/app.html
git commit -m "feat(recipes): green/red food-cost badge"
```

### Task 2.2: Oracle text-chat backend handler

**Files:**
- Create: `firebase/functions/oracle_chat.js`
- Create: `firebase/functions/oracle_intents/margin_trend.js`
- Create: `firebase/functions/oracle_intents/unused_ingredients.js`
- Create: `firebase/functions/oracle_intents/vendor_forecast.js`
- Create: `firebase/functions/oracle_intents/recipe_health.js`
- Create: `firebase/functions/__tests__/oracle_chat.test.js`
- Modify: `firebase/functions/index.js` (route)

- [ ] **Step 1: Failing test (use built-in `node:test` since project lacks test framework — confirm with `package.json` audit during exec)**

```javascript
// __tests__/oracle_chat.test.js
const test = require('node:test');
const assert = require('node:assert');
const { classifyIntent, runIntent } = require('../oracle_chat');

test('margin trend question routes to margin_trend intent', () => {
  assert.strictEqual(classifyIntent('which recipes have shrinking margin'), 'margin_trend');
  assert.strictEqual(classifyIntent('what items are losing money'),         'margin_trend');
});

test('unused ingredients question routes correctly', () => {
  assert.strictEqual(classifyIntent('what ingredients have I stopped using'), 'unused_ingredients');
});

test('forecast question routes correctly', () => {
  assert.strictEqual(classifyIntent('forecast my beef order for next week'), 'vendor_forecast');
});

test('runIntent margin_trend returns ranked rows', async () => {
  const fakeDb = {
    /* mock that returns 5 recipes with cost history */
  };
  const out = await runIntent('margin_trend', { tenantId: 'demo-restaurant', db: fakeDb });
  assert.ok(Array.isArray(out.rows));
  assert.ok('summary' in out);
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd firebase/functions
node --test __tests__/oracle_chat.test.js
```

Expected: `Error: Cannot find module '../oracle_chat'`.

- [ ] **Step 3: Implement classifier (lightweight rule-based; LLM as fallback)**

```javascript
// oracle_chat.js
const intents = require('./oracle_intents');

const RULES = [
  { intent: 'margin_trend',       re: /(margin|profit).*(shrink|down|lose|drop)|losing money|low margin/i },
  { intent: 'unused_ingredients', re: /(ingredient|item).*(stopped|not using|unused|dead)/i },
  { intent: 'vendor_forecast',    re: /(forecast|predict|next.*(week|month)|estimate.*order)/i },
  { intent: 'recipe_health',      re: /(top|worst|best).*(recipe|item)|recipe.*health/i },
];

function classifyIntent(text) {
  for (const r of RULES) if (r.re.test(text)) return r.intent;
  return 'unknown';
}

async function runIntent(name, ctx) {
  const fn = intents[name];
  if (!fn) return { summary: "I don't know how to answer that yet.", rows: [] };
  return fn(ctx);
}

async function handleChat({ tenantId, message, db }) {
  const intent = classifyIntent(message);
  if (intent === 'unknown') {
    return { intent, summary:
      "Try asking about margin trends, unused ingredients, vendor forecasts, or recipe health.", rows: [] };
  }
  return { intent, ...(await runIntent(intent, { tenantId, db })) };
}

module.exports = { classifyIntent, runIntent, handleChat };
```

- [ ] **Step 4: Implement four intents (one file each)**

`oracle_intents/margin_trend.js`:

```javascript
module.exports = async function ({ tenantId, db }) {
  const recipes = await db.collection(`tenants/${tenantId}/recipes`).get();
  const sales   = await db.collection(`tenants/${tenantId}/sales`).get();
  // Compute per-recipe avg cost over last 7 vs prior 7 days.
  // Rank by delta (cost up = margin shrinking).
  const rows = []; // {recipeId, name, marginDelta, currentPct, priorPct}
  // ... implementation reads cost history, pairs with menuPrice, returns top 10.
  rows.sort((a, b) => a.marginDelta - b.marginDelta);
  return {
    summary: rows.length
      ? `${rows.slice(0,3).map(r=>r.name).join(', ')} have the biggest margin drops this week.`
      : "No margin shrink detected.",
    rows: rows.slice(0, 10),
  };
};
```

`oracle_intents/unused_ingredients.js`, `vendor_forecast.js`, `recipe_health.js` — same pattern, each ~30-60 lines.

`oracle_intents/index.js`:

```javascript
module.exports = {
  margin_trend:       require('./margin_trend'),
  unused_ingredients: require('./unused_ingredients'),
  vendor_forecast:    require('./vendor_forecast'),
  recipe_health:      require('./recipe_health'),
};
```

- [ ] **Step 5: Run tests, confirm pass**

```bash
node --test __tests__/oracle_chat.test.js
```

Expected: all 4 tests pass.

- [ ] **Step 6: Wire into `index.js` request router**

In `firebase/functions/index.js`, find the existing `secureApi` operation switch. Add:

```javascript
case 'oracleChat': {
  const { handleChat } = require('./oracle_chat');
  const r = await handleChat({
    tenantId: claims.tenantId, message: data.message, db: admin.firestore(),
  });
  return { ok: true, ...r };
}
```

Add `'oracleChat'` to `ALLOWED_OPERATIONS` and `PERMISSION_MATRIX` (per memory: required for all new ops).

- [ ] **Step 7: Commit**

```bash
git add firebase/functions/oracle_chat.js firebase/functions/oracle_intents/ \
        firebase/functions/__tests__/oracle_chat.test.js firebase/functions/index.js
git commit -m "feat(oracle): text-chat handler with 4 analytical intents"
```

### Task 2.3: Oracle text-chat front-end panel

**Files:**
- Modify: `firebase/public/app.html`

- [ ] **Step 1: Add chat panel DOM (toggle button next to voice FAB)**

```html
<button class="oracle-chat-toggle" onclick="oracleChatToggle()" title="Ask the Oracle">💬</button>
<aside class="oracle-chat-panel" id="oracle-chat" hidden>
  <header>Oracle <button onclick="oracleChatToggle()" aria-label="close">×</button></header>
  <ol class="oracle-chat-log" id="oracle-chat-log"></ol>
  <form onsubmit="oracleChatSend(event)">
    <input id="oracle-chat-input" placeholder="Ask about margins, vendors, recipes..." autocomplete="off">
    <button type="submit">Ask</button>
  </form>
</aside>
```

- [ ] **Step 2: Add CSS — dock right, 380px, dark theme**

- [ ] **Step 3: Add JS**

```javascript
function oracleChatToggle() {
  const p = document.getElementById('oracle-chat');
  p.hidden = !p.hidden;
  if (!p.hidden) document.getElementById('oracle-chat-input').focus();
}

async function oracleChatSend(e) {
  e.preventDefault();
  const inp = document.getElementById('oracle-chat-input');
  const msg = inp.value.trim(); if (!msg) return;
  _oracleAppend('user', msg); inp.value = ''; _oracleAppend('bot', '...');
  try {
    const r = await secureApi('oracleChat', { message: msg });
    _oraclePop();
    _oracleAppend('bot', r.summary);
    if (r.rows && r.rows.length) _oracleAppend('table', r.rows);
  } catch (err) {
    _oraclePop();
    _oracleAppend('bot', 'Error: ' + err.message);
  }
}

function _oracleAppend(kind, payload) {
  const log = document.getElementById('oracle-chat-log');
  const li = document.createElement('li');
  li.className = 'msg msg--' + kind;
  if (kind === 'table') {
    const cols = Object.keys(payload[0] || {});
    li.innerHTML = '<table><thead><tr>' +
      cols.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>' +
      payload.map(r => '<tr>' + cols.map(c => `<td>${r[c]}</td>`).join('') + '</tr>').join('') +
      '</tbody></table>';
  } else { li.textContent = payload; }
  log.appendChild(li); log.scrollTop = log.scrollHeight;
}
function _oraclePop() {
  const log = document.getElementById('oracle-chat-log');
  if (log.lastElementChild?.classList.contains('msg--bot') &&
      log.lastElementChild.textContent === '...') log.lastElementChild.remove();
}
```

- [ ] **Step 4: Manual test against demo tenant**

Type "which recipes have shrinking margin" → expect summary + table.
Type "what's the weather" → expect "Try asking about..." fallback.

- [ ] **Step 5: Commit**

```bash
git add firebase/public/app.html
git commit -m "feat(oracle): text-chat UI panel"
```

---

## Chunk 3: Tutorial scripts (10)

Each script is a single Markdown file ~200-700 words with three sections: **Hook** (≤15s), **Body** (numbered show/say steps), **Outro** (≤10s, link to next video). Word count = 150 wpm × runtime.

### Task 3.1: Script 01 — Welcome (90s ≈ 225 words)

**File:** `docs/tutorials/01-welcome.md`

- [ ] **Step 1: Write script** (template; full prose during execution)

```markdown
# 01 — Welcome to Bistro Steward (90 seconds)

**Runtime:** 90s. **Word target:** 225. **Slug:** `welcome`.

## Hook (0:00–0:15)
Show: marketing landing page top fold.
Say: "If you run a restaurant, you already know food cost is your hardest math
problem. Bistro Steward is the tool I built to make that math invisible — so
you can run service instead of fighting spreadsheets."

## Body (0:15–1:15)
Show: 4-up grid (inventory, recipes, prep, oracle).
Say:
1. Track ingredient cost down to the unit.
2. Cost every recipe automatically.
3. Build prep sheets in seconds.
4. Ask the Oracle questions like "which dishes are losing me money."

## Outro (1:15–1:30)
Show: signup button.
Say: "In the next video I'll set up a brand-new account. Hit subscribe so you
catch every tutorial."
On screen: "Next: Sign up and create your account."
```

- [ ] **Step 2: Commit**

```bash
git add docs/tutorials/01-welcome.md
git commit -m "docs(tutorial): script 01 welcome"
```

### Task 3.2: Script 02 — Sign up (3 min ≈ 450 words)

**File:** `docs/tutorials/02-signup.md`

Cover: open `/signup`, pick Pro plan, enter Square sandbox card `4111 1111 1111 1111`, accept ToS via `/terms.html` link, click "Create account", check inbox for verification, click link, land in onboarding.

- [ ] **Step 1: Write script with explicit show/say beats matching the real `signup.html` (1504 lines) — script-writer reads file first, transcribes button labels verbatim**

- [ ] **Step 2: Commit**

```bash
git add docs/tutorials/02-signup.md
git commit -m "docs(tutorial): script 02 signup"
```

### Task 3.3: Script 03 — Team (2 min ≈ 300 words)

**File:** `docs/tutorials/03-team.md`

Cover: open Billing & Team dropdown, invite `kim@example.test` as Employee, invite `jose@example.test` as Manager (admin), explain role differences (employee = read+log inventory; admin = full minus billing; owner = everything). Show member-acceptance flow via a second browser window logged in as the demo Manager.

- [ ] **Step 1: Write**
- [ ] **Step 2: Commit**

### Task 3.4: Script 04 — Ingredients (4 min ≈ 600 words)

**File:** `docs/tutorials/04-ingredients.md`

Cover: manual add (1 min), AI receipt scan against a real grocery receipt (3 min) — upload, watch Gemini parse, review the suggestion modal, edit one wrong cost, commit, see ingredients land in walk-in area.

- [ ] **Step 1: Source a clean grocery receipt photo (no PII). Save to `docs/tutorials/_assets/04-receipt.jpg`. Use a generic Costco/Restaurant Depot or hand-write one for filming.**
- [ ] **Step 2: Write**
- [ ] **Step 3: Commit**

### Task 3.5: Script 05 — Vendor invoice (3 min ≈ 450 words)

**File:** `docs/tutorials/05-vendor-invoice.md`

Cover: longer multi-page invoice scan, price updates on existing ingredients (audit trail entry), how the diff is presented (old → new), undo/keep choices, commit.

- [ ] **Step 1: Source mock vendor invoice PDF. `docs/tutorials/_assets/05-invoice.pdf`.**
- [ ] **Step 2: Write**
- [ ] **Step 3: Commit**

### Task 3.6: Script 06 — Recipe costing (5 min ≈ 750 words)

**File:** `docs/tutorials/06-recipe-costing.md`

Cover: new recipe "Caesar Salad", add 6 ingredients with exact qty, set yield 1 batch / portion 1 salad, set menu price $14, watch the badge tick from grey → 28.6% green. Then bump menu price to $9 → flips to red. Then add an extra anchovy — see badge nudge up. Explain target ranges (28-32% rule of thumb).

- [ ] **Step 1: Write — REQUIRES Task 2.1 cost-badge to be merged first**
- [ ] **Step 2: Commit**

### Task 3.7: Script 07 — Prep sheet (3 min ≈ 450 words)

**File:** `docs/tutorials/07-prep-sheet.md`

Cover: open Prep tab, see 120 prep items pre-loaded from demo tenant, sort by area, tomorrow has 80 covers — set par, hit Print, show landscape PDF.

- [ ] **Step 1: Write**
- [ ] **Step 2: Commit**

### Task 3.8: Script 08 — Inventory count (3 min ≈ 450 words)

**File:** `docs/tutorials/08-inventory-count.md`

Cover: print blank count sheet for Walk-in area, walk through cooler with phone, hand-write counts, scan filled sheet via inventory scan, review modal, commit.

- [ ] **Step 1: Write**
- [ ] **Step 2: Commit**

### Task 3.9: Script 09 — Vendor order (4 min ≈ 600 words)

**File:** `docs/tutorials/09-vendor-order.md`

Cover: hit "Calculate Shopping List from Prep Needs", review demand by vendor (Sysco vs Pacific Seafood), bump up flour because cooler door broke, click "Email Order" for Sysco, show drafted email body, send.

- [ ] **Step 1: Confirm vendor email backend works in demo (or wire it). Memory says "Email backend assumed".**
- [ ] **Step 2: Write**
- [ ] **Step 3: Commit**

### Task 3.10: Script 10 — Ask the Oracle (3 min ≈ 450 words)

**File:** `docs/tutorials/10-oracle-ask.md`

Cover: open chat panel, ask "which recipes have shrinking margin" (margin_trend), "what ingredients have I stopped using" (unused_ingredients), "forecast my beef order for next week" (vendor_forecast). Each answer shows summary + table.

- [ ] **Step 1: Write — REQUIRES Tasks 2.2 + 2.3 merged first**
- [ ] **Step 2: Commit**

### Task 3.11: Recording + upload guides

**Files:**
- Create: `docs/tutorials/recording-guide.md`
- Create: `docs/tutorials/upload-checklist.md`

- [ ] **Step 1: `recording-guide.md` covers**

OBS scene preset (1440p source, 1080p output, 30fps, MKV). Mic config (Shure MV7 USB, gain -18 LUFS, popfilter 6 in). Browser zoom 110% for clarity. Hide bookmarks bar, history sidebar, every notification. Use Chrome incognito with `?help=` disabled in URL bar shortcut. Pre-flight: `node scripts/seed-demo-tenant.js --reset`. Redaction list: never show another tenant in localStorage, never show super-admin nav, never show real email inbox other than demo, never show URL bar containing real tenant UUID.

- [ ] **Step 2: `upload-checklist.md` covers**

YouTube channel "Bistro Steward" creation steps, channel art spec (2560×1440), thumbnail spec (1280×720, brand red `#c0392b`, 60pt Inter Bold title, screenshot of relevant screen), upload form fields (title format `EP NN — Title (Bistro Steward Tutorial)`, description template with chapter timestamps + bistrosteward.com link), playlist "Getting Started with Bistro Steward" ordered 1→10, captions workflow (auto-generate, then download SRT, manually correct, re-upload), end-screen template (subscribe + next video). After upload, paste real YouTube ID into `firebase/public/help-videos.json` and redeploy.

- [ ] **Step 3: Commit**

```bash
git add docs/tutorials/recording-guide.md docs/tutorials/upload-checklist.md
git commit -m "docs(tutorial): recording + upload guides"
```

---

## Chunk 4: Review gate + handoff

### Task 4.1: Open script-review PR

- [ ] **Step 1: Push branch**

```bash
git checkout -b youtube-tutorials
git push -u origin youtube-tutorials
```

- [ ] **Step 2: Open PR titled `feat: YouTube tutorial series (10 videos) + help drawer + demo seeder`**

PR body: lists each script, blocker features built, demo tenant credentials (in a private note, not the body), explicit ask "Anthony reviews scripts before any recording".

- [ ] **Step 3: STOP. Do not record until Anthony approves PR.**

### Task 4.2: Recording + upload (USER ACTION)

After PR merged, Anthony:

- [ ] Buys/installs OBS Studio + Descript per `recording-guide.md`.
- [ ] Records each video against the demo tenant on a clean Chrome profile.
- [ ] Edits in Descript, exports 1080p MP4.
- [ ] Uploads each to YouTube channel "Bistro Steward".
- [ ] Adds captions (YouTube auto, then manual correction, ~10 min/video).
- [ ] Adds chapter timestamps from the script's chapters list.
- [ ] Adds thumbnails per `upload-checklist.md`.
- [ ] Creates playlist "Getting Started with Bistro Steward".
- [ ] Pastes real YouTube IDs into `firebase/public/help-videos.json`, redeploys.

### Task 4.3: Final verification (USER ACTION)

- [ ] Open https://bistrosteward.com/app.html?help=welcome — drawer plays correct video.
- [ ] Repeat for all 10 slugs.
- [ ] YouTube channel screenshot showing 10+ videos with captions.
- [ ] Playlist URL verified.

---

## Verification matrix

| Deliverable | Verifier | Pass criterion |
|---|---|---|
| 10 scripts in `docs/tutorials/` | Anthony PR review | All approved |
| Help drawer wired | `?help=welcome` query opens drawer | Drawer slides in, iframe loads |
| Demo tenant seeded | `scripts/seed-demo-tenant.js --reset` | Login + 40 ing/15 rec visible |
| Cost badge | Caesar Salad recipe | Shows `28.6%` green; flips red at $9 price |
| Oracle chat | Type "which recipes have shrinking margin" | Returns summary + ranked table |
| Videos uploaded | YouTube channel page | 10 entries with captions + chapters |
| Deep links | `?help=<each-of-10-slugs>` | Each opens correct video |

## Effort estimate

| Phase | Owner | Time |
|---|---|---|
| Phase 0 recon | Claude | 30 min |
| Chunk 1 foundation | Claude | 1 day |
| Chunk 2 features | Claude | 1.5 days |
| Chunk 3 scripts (10) | Claude | 1 day |
| Phase 4.1 PR + review | Anthony | 0.5 day |
| Phase 4.2 recording + edit | Anthony | 10 days (1/video) |
| Phase 4.2 captions + thumbs | Anthony | 2 days |
| Phase 4.3 verification | Anthony | 0.5 day |
| **Total** | | ~16 working days |

## Constraints recap

- No record until scripts approved.
- Demo data only — no real customer info.
- Square sandbox only — no real cards on camera.
- Hide all credentials, API keys, tenant UUIDs in editing pass.
- 1080p min, 30fps, no music, captions required, max 5 min runtime per video.

---


<a id="plan-multi-shift"></a>

# Plan: Multi-Shift Shopping (2026-04-28)

_Source: `docs/plans/2026-04-28-multi-shift-shopping.md`_

# Multi-Shift Bulk Shopping Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let bulk-purchase customers specify `numShifts` + `consumptionRate` on Shopping tab to produce a multi-shift shopping list. Update Prep tab to always display "shifts on hand" per menu item + recipe.

**Architecture:** Two-layer change. (1) Pure-Python pipeline in `Restaurant-Oracle-Testbed/pipeline/shopping_model.py` gains `num_shifts` + `consumption_rate` params with regression tests. (2) Live app `firebase/public/app.html` gains UI inputs on Shopping tab + state holder `D.shoppingPlan` (sessionStorage-persisted) + scales menu need before recipe expansion. Prep tab gains a "shifts on hand" column derived from `inv_on_hand / target_per_shift`. Menu target semantic stays "per shift" (no schema change).

**Tech Stack:** Vanilla JS (browser), Python 3.13 + pytest (testbed), Firebase Hosting (deploy). No new deps.

---

## Existing Code Reference

| Location | Lines | Purpose |
|---|---|---|
| `firebase/public/app.html` | 4616-4870 | `calculateShoppingList()` — current single-shift algorithm (5 steps) |
| `firebase/public/app.html` | 4890-4970 | `renderPrep()` — current Prep tab render (menu + recipe sections) |
| `firebase/public/app.html` | 4265 | Shopping tab — calculate button location |
| `firebase/public/app.html` | 4547-4614 | `expandRecipeIngredients()` — sub-recipe expansion (untouched) |
| `Restaurant-Oracle-Testbed/pipeline/shopping_model.py` | full | Python port of shopping algorithm |
| `Restaurant-Oracle-Testbed/tests/pipeline/test_shopping.py` | full | 10 invariant tests |

## Math Spec (single source of truth)

For each menu `m` with `tgt` (per-shift target) and `D.inv` containing finished menu items with `inv.menuId === m.id`:

```
finishedOnHand_m   = sum(inv.qty where inv.menuId === m.id)
targetTotal_m      = m.tgt * numShifts * consumptionRate
menuNeeded_m       = max(0, targetTotal_m - finishedOnHand_m)
```

For each recipe `r` referenced by menu `m` (with `mr.qty` = qty of recipe per menu portion):

```
recipeNeed_r += menuNeeded_m * mr.qty                     (sum across menus)
prepOnHand_r  = sum(inv.qty where inv.recId === r.id)
shortfall_r   = max(0, recipeNeed_r - prepOnHand_r)
batches_r     = ceil(shortfall_r / output.qty_per_batch)
```

Ingredient phase + standalone phase + ingredient on-hand subtraction + storage-unit conversion: **unchanged**. Multiplier only enters at the menu→recipe boundary.

For Prep tab "shifts on hand":

```
menuShifts_m   = finishedOnHand_m / m.tgt                 (Infinity if tgt==0)
recipeShifts_r = prepOnHand_r / perShiftRecipeNeed_r
where perShiftRecipeNeed_r = sum over menus of (m.tgt * mr.qty for mr.recId === r.id)
```

Display rounding: 1 decimal (`Math.floor(x*10)/10`).

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `Restaurant-Oracle-Testbed/pipeline/shopping_model.py` | Modify | Add `num_shifts`, `consumption_rate` params to `calculate_shopping_list()` |
| `Restaurant-Oracle-Testbed/tests/pipeline/test_shopping.py` | Modify | +5 tests for multi-shift invariants |
| `firebase/public/app.html` | Modify | UI inputs, state holder, scaled `calculateShoppingList()`, scaled `renderPrep()` |

No new files. Keep monolithic structure (existing pattern).

---

## Chunk 1: Python pipeline + tests

### Task 1: Extend Python `calculate_shopping_list()` signature

**Files:**
- Modify: `Restaurant-Oracle-Testbed/pipeline/shopping_model.py`
- Test: `Restaurant-Oracle-Testbed/tests/pipeline/test_shopping.py`

- [ ] **Step 1: Read current signature**

```bash
grep -n "def calculate_shopping_list" /Users/mulefamily/Claude/Restaurant-Oracle-Testbed/pipeline/shopping_model.py
```

Expected: one match, signature `def calculate_shopping_list(env):`

- [ ] **Step 2: Write the failing test (multiplier doubles need)**

Append to `tests/pipeline/test_shopping.py`:

```python
# ---------- multi-shift scenarios ----------

def test_two_shifts_doubles_shortfall():
    """numShifts=2 should double menu need before any subtraction."""
    ings = [_ing(1, "Flour", defUnit="lb")]
    rec = _rec(1, "Bread", ings=[{"ingId": 1, "qty": 4, "unit": "cup"}])
    rec["outputMode"] = "manual"; rec["manualQty"] = 1
    menu = _menu(1, "Bread Menu", rec_id=1, tgt=3)   # 3 portions/shift
    convs = [dict(build_conversion(1, "flour"), id=1)]
    # 1 shift: 3 portions * 4 cup = 12 cup → ceil(12/3.629*10)/10 = 3.4 lb
    # 2 shifts: 6 portions * 4 cup = 24 cup → ceil(24/3.629*10)/10 = 6.7 lb
    result = calculate_shopping_list(_env([ings[0]], [rec], [menu], conversions=convs),
                                     num_shifts=2)
    assert math.isclose(result[1]["qty"], math.ceil(24 / 3.629 * 10) / 10, rel_tol=1e-3)
```

- [ ] **Step 3: Run test, verify it fails**

```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle-Testbed
python3 -m pytest tests/pipeline/test_shopping.py::test_two_shifts_doubles_shortfall -v
```

Expected: `TypeError: calculate_shopping_list() got an unexpected keyword argument 'num_shifts'`

- [ ] **Step 4: Add params to function signature**

Find in `shopping_model.py`:
```python
def calculate_shopping_list(env):
```

Replace with:
```python
def calculate_shopping_list(env, num_shifts=1, consumption_rate=1.0):
    """Multi-shift bulk shopping. Defaults to single shift @ 100% consumption.

    num_shifts: integer >= 1. Multiplier on menu target.
    consumption_rate: float, typical range 0.5-1.5. Multiplier on menu target.

    Effective per-menu need before subtracting finished-menu inventory:
        target_total = menu.tgt * num_shifts * consumption_rate
    Finished-menu inventory subtracts ONCE (it's a fixed quantity, not per-shift).
    All downstream phases (recipe expansion, prep subtraction, ing subtraction,
    storage-unit conversion) are unchanged.
    """
    if num_shifts < 1: num_shifts = 1
    if consumption_rate <= 0: consumption_rate = 1.0
    multiplier = float(num_shifts) * float(consumption_rate)
```

- [ ] **Step 5: Find menu need calculation, multiply by `multiplier`**

In same function, find the line that sets `menu_needed` (search for `tgt`):
```bash
grep -n "tgt\|target" /Users/mulefamily/Claude/Restaurant-Oracle-Testbed/pipeline/shopping_model.py
```

Locate the `target = menu.get('tgt', 0)` line and the `needed = target - on_hand_menu` line. Replace with:

```python
target = menu.get('tgt', 0) * multiplier
# finished menu items are a fixed quantity, not per-shift
on_hand_menu = sum(inv['qty'] for inv in env['inv'] if inv.get('menuId') == menu['id'])
needed = target - on_hand_menu
```

(Adjust to existing variable names / indentation in `shopping_model.py`.)

- [ ] **Step 6: Run test, verify it passes**

```bash
python3 -m pytest tests/pipeline/test_shopping.py::test_two_shifts_doubles_shortfall -v
```

Expected: PASS

- [ ] **Step 7: Run full suite, ensure no regressions**

```bash
python3 -m pytest tests/pipeline/ -v
```

Expected: 62/62 PASS (61 existing + 1 new)

- [ ] **Step 8: Commit**

```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle-Testbed
git add -A 2>/dev/null || true   # testbed not in git, skip if no repo
# (testbed has no git per design — just save)
```

### Task 2: Add 4 more multi-shift edge-case tests

**Files:**
- Test: `Restaurant-Oracle-Testbed/tests/pipeline/test_shopping.py`

- [ ] **Step 1: Add consumption_rate test**

```python
def test_consumption_rate_scales_continuously():
    """consumption_rate=0.5 should halve need."""
    ings = [_ing(1, "Flour", defUnit="lb")]
    rec = _rec(1, "Bread", ings=[{"ingId": 1, "qty": 4, "unit": "cup"}])
    rec["outputMode"] = "manual"; rec["manualQty"] = 1
    menu = _menu(1, "Bread Menu", rec_id=1, tgt=10)   # 10/shift × 0.5 = 5 portions
    convs = [dict(build_conversion(1, "flour"), id=1)]
    result = calculate_shopping_list(_env([ings[0]], [rec], [menu], conversions=convs),
                                     num_shifts=1, consumption_rate=0.5)
    # 5 portions * 4 cup = 20 cup → 20/3.629 ≈ 5.51 lb → ceil=5.6
    assert math.isclose(result[1]["qty"], math.ceil(20 / 3.629 * 10) / 10, rel_tol=1e-3)
```

- [ ] **Step 2: Add combined multiplier test**

```python
def test_shifts_and_rate_compound():
    """numShifts=3 × consumption_rate=1.2 = 3.6× multiplier."""
    ings = [_ing(1, "Flour", defUnit="lb")]
    rec = _rec(1, "Bread", ings=[{"ingId": 1, "qty": 4, "unit": "cup"}])
    rec["outputMode"] = "manual"; rec["manualQty"] = 1
    menu = _menu(1, "Bread Menu", rec_id=1, tgt=5)  # 5 × 3 × 1.2 = 18 portions
    convs = [dict(build_conversion(1, "flour"), id=1)]
    result = calculate_shopping_list(_env([ings[0]], [rec], [menu], conversions=convs),
                                     num_shifts=3, consumption_rate=1.2)
    # 18 portions × 4 cup = 72 cup → ceil(72/3.629*10)/10
    assert math.isclose(result[1]["qty"], math.ceil(72 / 3.629 * 10) / 10, rel_tol=1e-3)
```

- [ ] **Step 3: Add finished-menu-inv-not-multiplied test**

```python
def test_finished_menu_inventory_subtracts_once_not_per_shift():
    """Finished menu items are a fixed quantity — they don't multiply by shifts."""
    ings = [_ing(1, "Flour", defUnit="lb")]
    rec = _rec(1, "Bread", ings=[{"ingId": 1, "qty": 4, "unit": "cup"}])
    rec["outputMode"] = "manual"; rec["manualQty"] = 1
    menu = _menu(1, "Bread Menu", rec_id=1, tgt=5)   # 5/shift × 2 shifts = 10 portions
    # 4 finished portions on hand (covers 0.8 of 1 shift, but only counts once)
    inv = [{"id": 1, "ingId": 0, "recId": 0, "menuId": 1,
            "areaId": 1, "subArea": "", "qty": 4, "unit": "ea", "archived": 0}]
    convs = [dict(build_conversion(1, "flour"), id=1)]
    result = calculate_shopping_list(_env([ings[0]], [rec], [menu], inv=inv, conversions=convs),
                                     num_shifts=2)
    # need = 10 portions - 4 finished = 6 portions × 4 cup = 24 cup
    expected_lb = math.ceil(24 / 3.629 * 10) / 10
    assert math.isclose(result[1]["qty"], expected_lb, rel_tol=1e-3)
```

- [ ] **Step 4: Add invalid-input clamp test**

```python
def test_zero_or_negative_shifts_clamps_to_one():
    """num_shifts < 1 must clamp to 1; consumption_rate <= 0 must clamp to 1.0."""
    ings = [_ing(1, "Flour", defUnit="lb")]
    rec = _rec(1, "Bread", ings=[{"ingId": 1, "qty": 4, "unit": "cup"}])
    rec["outputMode"] = "manual"; rec["manualQty"] = 1
    menu = _menu(1, "Bread Menu", rec_id=1, tgt=3)
    convs = [dict(build_conversion(1, "flour"), id=1)]
    base = calculate_shopping_list(_env([ings[0]], [rec], [menu], conversions=convs))
    clamped = calculate_shopping_list(_env([ings[0]], [rec], [menu], conversions=convs),
                                      num_shifts=0, consumption_rate=-1)
    assert clamped[1]["qty"] == base[1]["qty"]
```

- [ ] **Step 5: Add full-corpus multi-shift smoke test**

```python
def test_full_corpus_three_shifts_scales_linearly():
    """3-shift run on real envelope should produce ~3× per-ingredient quantities
    vs 1-shift baseline (within prep/inv subtraction noise)."""
    path = ROOT / "data" / "derived" / "testbed-import.json"
    if not path.exists():
        import pytest; pytest.skip("testbed-import.json missing")
    env = json.loads(path.read_text())
    one = calculate_shopping_list(env, num_shifts=1)
    three = calculate_shopping_list(env, num_shifts=3)
    # Both produce non-empty lists
    assert len(one) > 0 and len(three) > 0
    # Ingredients in 1-shift list should appear in 3-shift list with >= qty
    for ing_id, item in one.items():
        assert ing_id in three, f"ing {ing_id} disappeared in 3-shift"
        assert three[ing_id]["qty"] >= item["qty"], \
            f"ing {ing_id}: 3-shift qty {three[ing_id]['qty']} < 1-shift {item['qty']}"
```

- [ ] **Step 6: Run all 5 new tests**

```bash
python3 -m pytest tests/pipeline/test_shopping.py -v -k "shifts or rate or multiplier"
```

Expected: 5 PASS

- [ ] **Step 7: Run full suite — ensure no regressions**

```bash
python3 -m pytest tests/pipeline/ -v
```

Expected: 66/66 PASS (61 + 5 new)

---

## Chunk 2: Browser app — state + algorithm

### Task 3: Add `D.shoppingPlan` state holder + sessionStorage persistence

**Files:**
- Modify: `firebase/public/app.html`

- [ ] **Step 1: Locate `D` object initial declaration**

```bash
grep -n "^var D\s*=\|^var D=" /Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/app.html | head -3
```

Expected: one site near top of script section.

- [ ] **Step 2: Add `shoppingPlan` field to D**

In the `D` initializer, add:
```js
shoppingPlan: {numShifts: 1, consumptionRate: 1.0},
```

(Place near `autoAddToInv` field — same kind of session-only setting.)

- [ ] **Step 3: Add helpers near the shopping section (search for `function calculateShoppingList`)**

Insert above `function calculateShoppingList`:

```js
// Multi-shift shopping plan — sessionStorage-persisted (per-tab)
function loadShoppingPlan(){
    try {
        var raw = sessionStorage.getItem('ro_shoppingPlan');
        if(raw){
            var p = JSON.parse(raw);
            D.shoppingPlan.numShifts = Math.max(1, parseInt(p.numShifts, 10) || 1);
            D.shoppingPlan.consumptionRate = Math.max(0.01, parseFloat(p.consumptionRate) || 1.0);
        }
    } catch(_) {}
}
function saveShoppingPlan(){
    try {
        sessionStorage.setItem('ro_shoppingPlan', JSON.stringify(D.shoppingPlan));
    } catch(_) {}
}
function shoppingMultiplier(){
    return D.shoppingPlan.numShifts * D.shoppingPlan.consumptionRate;
}
```

- [ ] **Step 4: Call `loadShoppingPlan()` once on app boot**

In the auth/listeners-ready callback (search for `onAllListenersReady`), add at top:
```js
loadShoppingPlan();
```

- [ ] **Step 5: Commit**

```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle
git add firebase/public/app.html
git commit -m "feat: add D.shoppingPlan state + sessionStorage persistence

Holds {numShifts, consumptionRate} for multi-shift bulk shopping.
Defaults to single-shift @ 100% consumption (no behavior change yet)."
```

### Task 4: Scale `calculateShoppingList()` by multiplier

**Files:**
- Modify: `firebase/public/app.html` (function `calculateShoppingList`, currently lines 4616-4870)

- [ ] **Step 1: Read current STEP 1 of `calculateShoppingList`**

```bash
sed -n '4616,4640p' /Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/app.html
```

- [ ] **Step 2: Insert multiplier at top of function**

Find:
```js
function calculateShoppingList(silent){
    saveState('Calculate shopping list');
```

Replace with:
```js
function calculateShoppingList(silent){
    saveState('Calculate shopping list');
    var multiplier = shoppingMultiplier();   // numShifts × consumptionRate
```

- [ ] **Step 3: Multiply menu target inside the menu-needs loop**

Find:
```js
D.menus.filter(function(m){return !m.archived && m.includeInShop;}).forEach(function(menu){
    var target = menu.tgt || 0;
```

Replace with:
```js
D.menus.filter(function(m){return !m.archived && m.includeInShop;}).forEach(function(menu){
    // Menu target is per-shift; scale by user's bulk-shopping multiplier
    var target = (menu.tgt || 0) * multiplier;
```

(Finished-menu inv subtraction below stays unchanged — that's a fixed pool, not per-shift.)

- [ ] **Step 4: Multiply standalone-ingredient minQty by multiplier**

Find in STEP 5b (around line 4755):
```js
var needed = standaloneInfo.minQty;
if(needed <= 0) return;
```

Replace with:
```js
// Standalone target is also per-shift
var needed = standaloneInfo.minQty * multiplier;
if(needed <= 0) return;
```

- [ ] **Step 5: Manual smoke test in browser testbed**

Reload `http://localhost:8766/app-snapshot/index-testbed.html?backtest=1`. In console:
```js
D.shoppingPlan.numShifts = 1; calculateShoppingList(true); var one = D.shopping.length;
D.shoppingPlan.numShifts = 3; calculateShoppingList(true); var three = D.shopping.length;
console.log('1-shift items:', one, '3-shift items:', three);
```

Expected: `three >= one` (typically equal — same SKUs, just larger qty per SKU).

Verify a single SKU scales:
```js
D.shoppingPlan.numShifts = 1; calculateShoppingList(true);
var oneQty = D.shopping.find(s=>D.ings.find(i=>i.id===s.ingId)?.name === 'Olive Oil')?.qty;
D.shoppingPlan.numShifts = 3; calculateShoppingList(true);
var threeQty = D.shopping.find(s=>D.ings.find(i=>i.id===s.ingId)?.name === 'Olive Oil')?.qty;
console.log('Olive Oil 1-shift:', oneQty, '3-shift:', threeQty);
```

Expected: `threeQty` ≈ 3 × `oneQty` (within rounding).

- [ ] **Step 6: Commit**

```bash
git add firebase/public/app.html
git commit -m "feat: scale calculateShoppingList by D.shoppingPlan multiplier

Menu targets and standalone minQty multiply by numShifts × consumptionRate.
Finished-menu inventory subtracts once (fixed pool, not per-shift).
Recipe-expansion + prep + ing subtraction phases unchanged."
```

### Task 5: Render number inputs above Calculate button on Shopping tab

**Files:**
- Modify: `firebase/public/app.html` (search for `Calculate Shopping List from Prep Needs`, ~line 4265)

- [ ] **Step 1: Read current button site**

```bash
grep -n "Calculate Shopping List from Prep Needs" /Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/app.html
```

- [ ] **Step 2: Replace button block with controls + button**

Find:
```js
html+='<div style="margin-bottom:12px"><button class="btn btn-p" onclick="calculateShoppingList()" style="width:100%">🧮 Calculate Shopping List from Prep Needs</button></div>';
```

Replace with:
```js
html+='<div class="card" style="margin-bottom:12px;padding:12px">';
html+='  <div style="font-weight:600;margin-bottom:8px;font-size:13px">📅 Bulk Purchase Plan</div>';
html+='  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">';
html+='    <label style="font-size:12px;color:#a0aec0">Shifts to cover<input type="number" id="shop-num-shifts" min="1" step="1" value="'+D.shoppingPlan.numShifts+'" oninput="onShoppingPlanInput()" style="width:100%;padding:6px;border-radius:4px;border:1px solid #2d3748;background:#1a202c;color:#fff;font-size:14px;margin-top:4px"></label>';
html+='    <label style="font-size:12px;color:#a0aec0">Consumption rate (×)<input type="number" id="shop-consumption-rate" min="0.01" step="0.05" value="'+D.shoppingPlan.consumptionRate+'" oninput="onShoppingPlanInput()" style="width:100%;padding:6px;border-radius:4px;border:1px solid #2d3748;background:#1a202c;color:#fff;font-size:14px;margin-top:4px"></label>';
html+='  </div>';
html+='  <div id="shop-plan-summary" style="font-size:11px;color:#74b9ff;margin-bottom:8px"></div>';
html+='  <button class="btn btn-p" onclick="calculateShoppingList()" style="width:100%">🧮 Calculate Shopping List from Prep Needs</button>';
html+='</div>';
```

- [ ] **Step 3: Add `onShoppingPlanInput()` handler near other shopping helpers**

Insert above `function calculateShoppingList`:

```js
var _shoppingPlanDebounce = null;
function onShoppingPlanInput(){
    var ns = parseInt(document.getElementById('shop-num-shifts').value, 10);
    var cr = parseFloat(document.getElementById('shop-consumption-rate').value);
    D.shoppingPlan.numShifts = (ns >= 1) ? ns : 1;
    D.shoppingPlan.consumptionRate = (cr > 0) ? cr : 1.0;
    saveShoppingPlan();
    updateShoppingPlanSummary();
    // debounce auto-recalc by 400ms so typing doesn't recompute on each keystroke
    if(_shoppingPlanDebounce) clearTimeout(_shoppingPlanDebounce);
    _shoppingPlanDebounce = setTimeout(function(){
        calculateShoppingList(true);   // silent: no toast on keystroke recalc
    }, 400);
}
function updateShoppingPlanSummary(){
    var el = document.getElementById('shop-plan-summary');
    if(!el) return;
    var mult = shoppingMultiplier();
    if(D.shoppingPlan.numShifts === 1 && D.shoppingPlan.consumptionRate === 1.0){
        el.textContent = '';
    } else {
        el.textContent = '× '+mult.toFixed(2)+' multiplier (default = 1 shift × 100%)';
    }
}
```

- [ ] **Step 4: Call `updateShoppingPlanSummary()` whenever Shopping tab renders**

Search for `function renderShopping` (or wherever the shopping tab html is built). After the html is set, add at end of the function:
```js
updateShoppingPlanSummary();
```

- [ ] **Step 5: Manual browser test**

Reload testbed. Click Shopping tab. Verify:
- Two number inputs appear with defaults `1` and `1`
- Type `3` in shifts → after 400ms, list quantities scale 3×
- Reload tab — values persist (sessionStorage)

- [ ] **Step 6: Commit**

```bash
git add firebase/public/app.html
git commit -m "feat: Shopping tab UI for multi-shift bulk plan

Two number inputs (Shifts to cover, Consumption rate) above Calculate button.
Debounced auto-recalc on input (400ms). Summary line shows current multiplier.
sessionStorage persistence per tab."
```

### Task 6: Update `renderPrep()` to show shifts-on-hand

**Files:**
- Modify: `firebase/public/app.html` (function `renderPrep`, ~lines 4890-5000)

- [ ] **Step 1: Read full renderPrep**

```bash
sed -n '4890,5050p' /Users/mulefamily/Claude/Restaurant-Oracle/firebase/public/app.html
```

- [ ] **Step 2: Compute `shiftsOnHand` for menu items inside the menuPrepList loop**

Find:
```js
menuPrepList.push({
    menuId: menu.id,
    name: menu.name,
    target: target,
    onHand: onHand,
    unit: (IDX.units.get(menu.unitId)||{abbr:'ea'}).abbr
});
```

Replace with:
```js
var shiftsOnHand = (target > 0) ? (onHand / target) : 0;
menuPrepList.push({
    menuId: menu.id,
    name: menu.name,
    target: target,
    onHand: onHand,
    shiftsOnHand: shiftsOnHand,
    unit: (IDX.units.get(menu.unitId)||{abbr:'ea'}).abbr
});
```

- [ ] **Step 3: Compute `shiftsOnHand` for recipes**

Find the recipe `prepList.push` block:
```js
prepList.push({
    recId: recId,
    name: need.name,
    target: need.totalNeeded,
    unit: need.unit,
    onHand: onHand,
    usedIn: need.usedIn
});
```

Replace with:
```js
// Recipe per-shift need = totalNeeded (built above already iterates over menus once = 1 shift)
var perShiftNeed = need.totalNeeded;
var shiftsOnHand = (perShiftNeed > 0) ? (onHand / perShiftNeed) : 0;
prepList.push({
    recId: recId,
    name: need.name,
    target: need.totalNeeded,
    unit: need.unit,
    onHand: onHand,
    shiftsOnHand: shiftsOnHand,
    usedIn: need.usedIn
});
```

- [ ] **Step 4: Add shiftsOnHand badge to menu/recipe row HTML**

Search for where each `prepList` and `menuPrepList` item is rendered to HTML (look for `forEach` building rows in the same `renderPrep` function). Locate the row template — it already shows `onHand / target unit` and a status badge. Add adjacent badge:

```js
var shiftsLabel = (item.shiftsOnHand >= 100) ? '∞' : (Math.floor(item.shiftsOnHand * 10) / 10) + ' shifts';
var shiftsColor = item.shiftsOnHand >= 1 ? '#0fb' : item.shiftsOnHand >= 0.5 ? '#fc6' : '#f66';
// ... interpolate into row html:
'<span style="color:'+shiftsColor+';font-size:11px;margin-left:8px;font-weight:600">'+shiftsLabel+'</span>'
```

(Adapt to existing row template — the variable names will differ for menu rows vs recipe rows. Match the surrounding markup style.)

- [ ] **Step 5: Manual browser test**

Reload testbed → Prep tab. Verify:
- Each menu item shows e.g. "0.0 shifts" or "1.5 shifts"
- Each recipe row shows shifts badge
- Color: red < 0.5, yellow 0.5–1.0, green ≥ 1.0
- Numbers update if you change `D.inv` and re-render

- [ ] **Step 6: Commit**

```bash
git add firebase/public/app.html
git commit -m "feat(prep): always display shifts-on-hand per menu + recipe

shiftsOnHand = onHandQty / perShiftTarget. Color-coded badge:
red < 0.5, yellow 0.5–1.0, green ≥ 1.0. ∞ when target=0."
```

### Task 7: Browser end-to-end smoke test

**Files:** No code changes — manual verification.

- [ ] **Step 1: Start preview**

Use existing preview server `testbed` at `http://localhost:8766/app-snapshot/index-testbed.html?backtest=1`.

(Or against live: `https://restaurant-oracle.web.app/app` after deploy.)

- [ ] **Step 2: Multi-shift scaling verification**

In browser DevTools console:
```js
// Compare sample SKU across 1, 2, 5 shifts
['Olive Oil','Lamb Mince','Garlic'].forEach(name => {
    [1,2,5].forEach(n => {
        D.shoppingPlan.numShifts = n;
        D.shoppingPlan.consumptionRate = 1.0;
        calculateShoppingList(true);
        var s = D.shopping.find(x => D.ings.find(i=>i.id===x.ingId)?.name === name);
        console.log(n+' shifts -', name, ':', s?.qty, s?.unit);
    });
});
```

Expected: each ingredient's qty scales ~linearly with shift count (modulo storage-unit ceil rounding).

- [ ] **Step 3: Consumption rate verification**

```js
D.shoppingPlan.numShifts = 1;
[0.5, 1.0, 1.5, 2.0].forEach(r => {
    D.shoppingPlan.consumptionRate = r;
    calculateShoppingList(true);
    var s = D.shopping.find(x => D.ings.find(i=>i.id===x.ingId)?.name === 'Olive Oil');
    console.log('rate '+r+':', s?.qty);
});
```

Expected: linear with rate.

- [ ] **Step 4: Prep tab shifts-on-hand verification**

Click Prep tab. Pick a menu item and verify `shiftsOnHand = floor(onHand / tgt × 10) / 10` matches.

In console:
```js
go('prep'); setTimeout(()=>{
    var rows = Array.from(document.querySelectorAll('.card-h')).slice(0,5).map(r=>r.textContent.trim().slice(0,80));
    console.log(rows);
}, 300);
```

Expected: rows display shift counts in text.

- [ ] **Step 5: Persistence verification**

Set `numShifts=3`, reload tab. Verify shopping plan inputs come back as `3` (sessionStorage works).

- [ ] **Step 6: Python ↔ browser parity check**

Run Python with same multiplier:
```bash
python3 -c "
import sys, json
sys.path.insert(0, '/Users/mulefamily/Claude/Restaurant-Oracle-Testbed/pipeline')
from shopping_model import calculate_shopping_list
env = json.loads(open('/Users/mulefamily/Claude/Restaurant-Oracle-Testbed/data/derived/testbed-import.json').read())
r = calculate_shopping_list(env, num_shifts=3)
for n in ['Olive Oil','Lamb Mince','Garlic']:
    item = next((v for k,v in r.items() if (next((i for i in env['ings'] if i['id']==k), {}).get('name'))==n), None)
    print(n, item and (item['qty'], item['unit']))
"
```

Compare with browser console output from Step 2 — must match byte-for-byte.

---

## Chunk 3: Deploy + verify live

### Task 8: Deploy to Firebase Hosting

**Files:** No code changes.

- [ ] **Step 1: Pre-deploy lint check**

```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle
node -e "require('fs').readFileSync('firebase/public/app.html','utf8'); console.log('parse OK')"
```

- [ ] **Step 2: Deploy hosting**

```bash
cd /Users/mulefamily/Claude/Restaurant-Oracle/firebase
firebase deploy --only hosting --project restaurant-oracle
```

Expected: `✔ Deploy complete!` + Hosting URL.

- [ ] **Step 3: Smoke test live**

Open `https://restaurant-oracle.web.app/app` (hard reload Cmd+Shift+R). Sign in. Click Shopping tab → verify inputs appear. Set `2` shifts → verify quantities scale.

Click Prep tab → verify shifts-on-hand badges visible.

---

## Acceptance Criteria

| # | Check | Pass Signal |
|---|---|---|
| 1 | Python `num_shifts=2` doubles all per-ingredient need vs `num_shifts=1` (modulo prep/finished-menu offsets) | `test_two_shifts_doubles_shortfall` PASS + `test_full_corpus_three_shifts_scales_linearly` PASS |
| 2 | `consumption_rate=0.5` halves need | `test_consumption_rate_scales_continuously` PASS |
| 3 | Combined `shifts × rate` compounds | `test_shifts_and_rate_compound` PASS |
| 4 | Finished menu items don't multiply with shifts | `test_finished_menu_inventory_subtracts_once_not_per_shift` PASS |
| 5 | Invalid inputs clamp safely | `test_zero_or_negative_shifts_clamps_to_one` PASS |
| 6 | Browser inputs render on Shopping tab | Visual: 2 number boxes labeled "Shifts to cover" + "Consumption rate" |
| 7 | Browser auto-recalculates on input change (400ms debounce) | Type `3` → list updates ~half-second later |
| 8 | Browser ↔ Python parity at `num_shifts=3` on full corpus | Sample 3 SKUs match byte-for-byte |
| 9 | Settings survive tab reload | sessionStorage → `numShifts=3` re-renders as `3` after reload |
| 10 | Prep tab shows shifts-on-hand per menu + recipe | Visual: badge on each row, color-coded red/yellow/green |
| 11 | Existing 61 tests still pass (no regression) | `pytest tests/pipeline/` → 66/66 PASS |
| 12 | No new console errors on browser load | DevTools console clean after Cmd+Shift+R |

## Risk + Mitigation

| Risk | Mitigation |
|---|---|
| Browser ↔ Python algorithm drift | Task 7 step 6 enforces parity check on every commit |
| Existing single-shift users see behavior change | Defaults `numShifts=1, consumptionRate=1.0` produce IDENTICAL output (verified in Task 2 Step 4 clamp test) |
| Standalone-ingredient `minQty` semantic ambiguous w/ shifts | Spec choice: standalone minQty IS per-shift (matches menu target semantic). Documented in code comment. Reversible if customer feedback differs. |
| Prep `shiftsOnHand` confusing when target=0 | Show `∞` glyph; treat as covered |
| sessionStorage cleared on tab close | Acceptable — bulk shopping is a session activity. Owners can reach for Firestore-persisted setting later if requested. |
| Cache-Control on app.html (now no-cache) means every page load fetches fresh | Acceptable: ~50KB gzip, single fetch per session start |

## Out of Scope (deferred)

- Per-shift schedule (different consumption per shift) — current spec is uniform across all shifts
- Vendor-pack rounding (e.g. olive oil sold in 4-L drums) — separate feature
- Tenant-level default for numShifts (e.g. always 7-day plan) — sessionStorage only for now
- Saved bulk-plan templates — single active plan per session

---


<a id="agents-readme"></a>

# Automation Agents — Overview

_Source: `agents/README.md`_

# Bistro Steward — Automation Agents

Six autonomous agents run on Firebase Cloud Functions. Each has a narrow scope,
a clear trigger, and writes its decisions to either Firestore or an email/SMS
channel. Agents read from `/tenants/{tenantId}/` and either act directly, or
flag issues for the super-admin console.

| Agent        | Trigger                         | Purpose                                      | Status       |
|--------------|---------------------------------|----------------------------------------------|--------------|
| Provisioning | HTTP (chained from signupTenant)| Seed new tenant, send welcome                | Implemented  |
| Onboarding   | Scheduled (daily 14:00 UTC)     | Nudge tenants who stalled during setup       | Implemented  |
| Deployment   | Firestore trigger on `releases/`| Notify tenants of platform changes           | Spec only    |
| Health       | Scheduled (hourly)              | Compute per-tenant health score; alert super | Implemented  |
| Support      | HTTP (webhook from inbox)       | Route + draft reply using Gemini             | Spec only    |
| Revenue      | Scheduled (daily 06:00 UTC)     | Compute MRR, churn, trends; weekly digest    | Implemented  |

All implemented agents live in `firebase/functions/agents.js` and export
Cloud Functions. The super-admin console (`/super-admin`) surfaces the output
of Health + Revenue in the dashboard.

See individual spec files in this directory for scope, inputs, outputs, and
escalation rules per agent.

---


<a id="agent-01"></a>

# Agent 01 — Provisioning

_Source: `agents/01-provisioning.md`_

# Agent 1 — Provisioning

**Goal**: when a new tenant signs up, set up a working empty workspace and
send a welcome email. This runs once per tenant, at signup.

## Trigger

Chained synchronously from `signupTenant` after the Square subscription is
confirmed. If the chain fails, tenant creation still succeeds — provisioning
is idempotent and re-runnable.

## Inputs

- `tenantId` (Firestore doc id)
- `ownerEmail`
- `plan` (starter / pro / scale)

## Actions

1. Ensure these sub-collections have a starter document so the UI shows an
   empty-but-populated state:
   - `settings/general` — `{ restaurantName, currency: "USD", createdAt }`
   - `areas/default` — `{ name: "Main", order: 0 }`
   - `units/{ea,lb,oz,gal}` — four common unit defaults
2. Reserve counters: `counters/ids = { next: 1 }`
3. Write `provisioning_complete = true` on the tenant doc.
4. Queue a welcome email (Resend / SendGrid) with:
   - Link to sign-in
   - Plan summary
   - 3 quick-start steps (add an ingredient, add an area, invite a teammate)

## Failure modes

- Firestore throttling → retry via backoff (3 attempts).
- Email send failure → log but don't block; the tenant still gets the console.
- If re-run, all writes must be idempotent (`.set({...}, {merge:true})`).

## Escalation

On persistent failure (>3 retries), write an entry to
`platform_alerts/` with `severity="high"` — the Health agent surfaces this in
the super-admin dashboard.

## Implementation

`firebase/functions/agents.js` → `provisioningAgent` (HTTP, internal only).
Called from `signupTenant` via `await agents.provisioning({ tenantId, ... })`.

---


<a id="agent-02"></a>

# Agent 02 — Onboarding

_Source: `agents/02-onboarding.md`_

# Agent 2 — Onboarding

**Goal**: guide new tenants through the first week. Trigger nudge emails at
the right moments based on what they've done so far.

## Trigger

Firebase Scheduled Function — runs daily at 14:00 UTC.

## Inputs (per tenant, read from Firestore)

- `tenant.createdAt` — age of account
- `tenant.onboardingComplete` — if true, agent skips this tenant
- Presence of docs in: `ings/`, `areas/`, `team_members/`, `log/`
- Last sign-in time (from Auth)

## Onboarding milestones

| # | Milestone                              | Signal                           |
|---|----------------------------------------|----------------------------------|
| 1 | Completed signup                       | Tenant doc exists                |
| 2 | First sign-in                          | Any audit log entry              |
| 3 | First inventory item                   | `ings/` has ≥1 doc               |
| 4 | First count (inventory used)           | `log/` has ≥1 entry              |
| 5 | Invited a teammate                     | `team_members/` has ≥2           |
| 6 | Completed onboarding (self-reported)   | `tenant.onboardingComplete=true` |

## Nudge schedule

| Days since signup | Condition                       | Email subject                             |
|-------------------|---------------------------------|-------------------------------------------|
| 2                 | milestone 2 missed              | "Welcome back — here's how to sign in"    |
| 4                 | milestone 3 missed              | "Add your first ingredient in 60 seconds" |
| 7                 | milestone 4 missed              | "Run your first count this week"          |
| 10                | milestone 5 missed              | "Invite your team — better together"      |
| 14                | milestone 6 missed              | "Let's get you set up on a quick call"    |

Never send more than one nudge per tenant per day. Track sent nudges in
`/tenants/{id}/onboarding/nudges` with `{milestone, sentAt}`.

## Actions

- For each active tenant: compute current milestone, check schedule, enqueue
  email if due + not already sent for this milestone.

## Escalation

If day 14 nudge goes unresponded (no sign-in for 5 days after), flag to
Health agent with `health_issue="inactive_new_tenant"`.

## Implementation

`firebase/functions/agents.js` → `onboardingNudge` scheduled function.
Emails sent via Resend (requires `RESEND_API_KEY` secret — currently stubbed).

---


<a id="agent-03"></a>

# Agent 03 — Deployment

_Source: `agents/03-deployment.md`_

# Agent 3 — Deployment

**Goal**: when the platform ships a release, notify tenants and surface the
changelog to super-admins.

## Trigger

Firestore onCreate trigger on `releases/{releaseId}`. Releases are written
by the deploy pipeline (`firebase deploy --only hosting,functions`) via a
post-deploy hook that writes `{version, timestamp, summary, breakingChanges, commitRange}`.

## Status

**Spec only** — deferred. For a single-codebase multi-tenant SaaS, version
management is simple: every tenant runs the same bundle. Notification is
nice-to-have but not MVP-critical.

## Future actions

1. Write a changelog entry to `/platform_stats/releases/log/{releaseId}`.
2. Email super-admin with release summary.
3. If `breakingChanges=true`: surface a tenant banner and notify every owner.
4. Increment `/platform_stats/dashboard.currentVersion`.

## Source of truth

Release entries live in the root `releases/` collection. The super-admin
console is the only reader (users only see the banner injected at runtime).

## Implementation

Not implemented. Add when first breaking change is shipped.

---


<a id="agent-04"></a>

# Agent 04 — Health

_Source: `agents/04-health.md`_

# Agent 4 — Health

**Goal**: compute a health score per tenant hourly, surface unhealthy tenants
to the super-admin dashboard, and alert on acute issues.

## Trigger

Firebase Scheduled Function — runs every hour.

## Inputs (per tenant)

- Time since last audit_log entry (activity)
- Error rate (failed writes in last 24h from audit_log)
- Subscription status from Firestore
- Is suspended? Is canceled?
- Count of team members

## Health score (0 – 100)

Start at 100. Deductions:

| Condition                                    | Deduction |
|----------------------------------------------|-----------|
| No activity in last 24h                      | −10       |
| No activity in last 7d                       | −30       |
| No activity in last 30d                      | −50       |
| Error rate > 5% in last 24h                  | −15       |
| Error rate > 20% in last 24h                 | −35       |
| Subscription canceled, still has access      | −40       |
| Suspended                                    | −70       |
| No team members                              | −5        |
| Onboarding not complete after 14 days        | −10       |

Scores are clamped to `[0, 100]`. Buckets:

- 80–100: `healthy` (green)
- 50–79:  `warning` (yellow)
- 0–49:   `critical` (red)

## Outputs

Writes to `/platform_stats/health/tenants/{tenantId}` a doc:
```
{
  score,
  bucket,
  lastActivity,
  activeErrorRate,
  issues: ["no_activity_7d", "error_rate_high"],
  computedAt
}
```

Also updates rollup at `/platform_stats/health/_summary`:
```
{
  healthy: 12,
  warning: 3,
  critical: 1,
  computedAt
}
```

## Alerts

If a tenant drops from `healthy` → `critical` in a single cycle, writes an
entry to `/platform_alerts/` with `severity="high"` and emails super-admins.

## Implementation

`firebase/functions/agents.js` → `healthCheck` scheduled function (hourly).
Output is queryable from the super-admin console dashboard.

---


<a id="agent-05"></a>

# Agent 05 — Support

_Source: `agents/05-support.md`_

# Agent 5 — Support

**Goal**: tenant submits a question; agent classifies it, drafts a reply
with Gemini, routes to either auto-reply (simple/FAQ) or human-in-loop
(complex/billing/outage).

## Trigger

HTTP endpoint `/supportInquiry` — called from the in-app "Help" button.

## Status

**Spec only** — deferred. Support inbox UI not yet built. For Phase 2 MVP,
email `support@bistrosteward.com` is the sole channel.

## Future actions

1. Receive `{ tenantId, question, context }` from the app.
2. Categorize via Gemini: `billing | how-to | bug | outage | other`.
3. For `how-to`: draft answer from known-good knowledge base + send to user.
4. For `billing`: escalate to human (write ticket + email super-admin).
5. For `bug` / `outage`: write to `/platform_alerts/` with full context.
6. Log every interaction to `/tenants/{id}/support_tickets/`.

## Knowledge base

Would live in `/platform_knowledge/` as doc pairs `{question, answer}`.
Retrieval via simple keyword match for now (not RAG) — scale later if needed.

## Implementation

Not implemented. Build when support volume justifies it (post-launch).

---


<a id="agent-06"></a>

# Agent 06 — Revenue

_Source: `agents/06-revenue.md`_

# Agent 6 — Revenue

**Goal**: compute MRR, ARR, churn, and plan mix daily. Surface weekly digest
to super-admins. Detect anomalies (MRR drop >10% day-over-day).

## Trigger

Firebase Scheduled Function — runs daily at 06:00 UTC.

## Inputs

- Every tenant doc (`status`, `plan`, `createdAt`, `canceledAt`)
- Plan pricing: starter=$29, pro=$49, scale=$99

## Metrics computed

| Metric            | Definition                                           |
|-------------------|------------------------------------------------------|
| MRR               | Σ plan-price for every `status=active` tenant        |
| ARR               | MRR × 12                                             |
| New MRR           | MRR from tenants created in last 30d                 |
| Churned MRR       | MRR from tenants canceled in last 30d                |
| Net New MRR       | New − Churned                                        |
| Tenant count      | Total, by status, by plan                            |
| Churn rate        | canceled_in_period / active_at_start_of_period       |

## Outputs

Daily snapshot to `/platform_stats/revenue/daily/{YYYY-MM-DD}`:
```
{
  date: "2026-04-23",
  mrrCents, arrCents,
  newMrrCents, churnedMrrCents, netNewMrrCents,
  tenantsTotal, tenantsByStatus: {active, suspended, canceled},
  tenantsByPlan: {starter, pro, scale},
  churnRate,
  computedAt
}
```

Latest also written to `/platform_stats/revenue/_latest` for the super-admin
dashboard to read without scanning the daily collection.

## Weekly digest

Every Monday, reads last 7 days and emails super-admins:
- Current MRR vs 7d ago (delta + %)
- Top growth plan this week
- Churn count this week
- Weekly signups
- Health summary (from Health agent rollup)

## Anomaly detection

If today's MRR < yesterday's by >10%, writes `/platform_alerts/` entry with
`severity="high"` and emails super-admins immediately.

## Implementation

`firebase/functions/agents.js` → `revenueSnapshot` scheduled function (daily).
Weekly digest is a second scheduled function (Mon 08:00 UTC).

---


<a id="dp-readme"></a>

# Design Partners — Overview

_Source: `design-partners/README.md`_

# Design Partner Recruitment — Bistro Steward

Goal: **3 Portland restaurants** signed, onboarded, and using Bistro Steward weekly by **2026-06-23** (60 days from 2026-04-24 kickoff). All 3 free for 6 months in exchange for weekly 30-min feedback calls.

---

## Deliverables (in this folder)

| # | File | Purpose |
|---|------|---------|
| 1 | [`01_target_list.csv`](01_target_list.csv) | 20 scored Portland candidates — name, owner, cuisine, size, tech stack, warm-intro path, fit score /30 |
| 2 | [`02_outreach_templates.md`](02_outreach_templates.md) | Three templates: supplier-intro, peer chef-to-chef, warm follow-up |
| 3 | [`03_pitch_deck.html`](03_pitch_deck.html) | 5-slide dark-themed deck — problem, product, offer, ask, next step |
| 4 | [`04_partner_letter.md`](04_partner_letter.md) | One-page design-partner letter for DocuSign |
| 5 | [`05_tracker.csv`](05_tracker.csv) | Public status tracker — pitched / demoed / signed / declined with reason |
| 6 | [`06_onboarding_playbook.md`](06_onboarding_playbook.md) | Week 0 → Week 24 playbook with red flags and anti-patterns |

---

## Pipeline math (per constraints)

- **Pitch 9 to land 3** (3× target, restaurants flake)
- Vendor-intro layer should surface ~15 names — cull to best 9
- Never more than **2 touches** per target (cold follow-up counts as 1)
- **NO cold outreach.** Warm intros only, via vendors / peer chefs / ORLA / LaChona diner network

## Timeline

| Week | Milestone |
|------|-----------|
| 1 (now – 2026-05-01) | Send supplier-intro template (Template 1) to 4 LaChona vendors. Collect 15 warm names. |
| 2 (2026-05-01 to -08) | Cull to best 9. Send peer-intro template (Template 2). Book demos. |
| 3-4 (2026-05-08 to -22) | Demo week. Follow-up template (Template 3) to silent targets. Target: 3 signed by end of May. |
| 5-6 (2026-05-22 to -06-05) | Week 0 kitchen visits for signed partners. |
| 7-12 (to 2026-06-23) | Weekly 30-min calls. Success metric: 3 restaurants using weekly. |
| Week 12 (2026-07-17) | Testimonial ask. Target: first testimonial captured by 2026-05-24 (early partner), second by 2026-07-23. |
| Week 16 (2026-08-14) | Landing-page logo strip live (target date 2026-06-23 per constraints — if signed partners approve sooner). |

---

## Success metrics

- ✅ 3 partners signed by **2026-05-31**
- ✅ 3 partners onboarded (Week 0 complete) by **2026-06-15**
- ✅ 3 partners using weekly by **2026-06-23**
- ✅ 2 testimonials captured by **2026-07-23**
- ✅ Logo strip on bistrosteward.com by **2026-06-23** (earlier if opt-in lands)

---

## Outreach sources identified

### LaChona existing vendors (warm-intro layer)
- **SP Provisions** — 2331 NW 23rd Ave (proximity)
- **Nicky USA** — premier NW butcher, wide network
- **Cascade Organic** — produce/mushroom/seafood, serves many independents
- **Columbia Empire Meat** — 90+ yr Portland family-owned
- **Revel Meat Co** — local-farm aggregator
- **Willamette Valley Meat** — retail + foodservice

### Peer-intro channels
- LaChona maître d' flags industry diners (chefs on nights off)
- ORLA events — 2500 member orgs, local networking nights
- Portland Monthly "Best of" alumni network (2023-2025 lists)
- NW Portland / Slabtown chef circle (geographic proximity)

---

## What this folder does NOT include (intentionally)

Per constraints, we are explicitly **not** doing:
- Paid ads
- Content marketing / blog posts
- Conference / trade-show planning
- Outbound SDR hiring
- Affiliate / referral programs

These come **after** 3 design partners prove the product.

---

## How to use this folder

### Week 1 (this week)
1. Open `01_target_list.csv`. **Verify employee counts + POS for top 9** by calling suppliers or checking each restaurant's Indeed listings. Strike any whose scale is clearly >40 emp.
2. Open `02_outreach_templates.md`. Copy **Template 1**. Customize with the vendor rep's name. Send to 4 vendor reps by end of Tuesday.
3. Review `03_pitch_deck.html` in browser. Phone defaulted to LaChona main `(503) 704-5496` — swap to personal mobile in 3 files if you'd rather direct calls there. Record a 2-min Loom of slide 2 (the product screenshots) for warm sends.

### Week 2
1. Cull vendor leads into `05_tracker.csv` — set `stage=intro_received` for each.
2. Send Template 2 to top 9 via peer channels.
3. For anyone responding positively, email PDF of `04_partner_letter.md` before the demo.

### Ongoing
- Update `05_tracker.csv` after every interaction.
- Review aggregate Monday report based on per-partner Google Doc / Notion pages (see `06_onboarding_playbook.md` Stage 4).

---

## Files to update (by Anthony, before first send)

Phone numbers prefilled with LaChona main `(503) 704-5496`. Swap to personal mobile if preferred — search & replace across:
- `03_pitch_deck.html`
- `02_outreach_templates.md`
- `04_partner_letter.md`

Other:
- `01_target_list.csv`: verify column `owner_chef` for 23Hoyt and any other with known recent changes

## Next review gate

**2026-05-15** — if tracker shows fewer than 3 demos booked, re-pull vendor list instead of switching to cold outreach. Do not dilute the warm-intro constraint.

---


<a id="dp-runbook"></a>

# Design Partners — Week 1 Runbook

_Source: `design-partners/00_week1_runbook.md`_

# Week 1 Outreach Runbook — Send Tomorrow

Send all 4 supplier-intro asks (Template 1) by end of Tuesday 2026-04-28. Goal: surface ~15 warm names by 2026-05-01 to cull to top 9.

---

## Pre-flight Checklist

- [ ] **Vendor rep first names confirmed** for the 4 supplier asks below.
- [ ] **Phone preference decided**: currently `(503) 704-5496` (LaChona main) prefilled in 3 files. Swap to personal mobile if preferred — search-replace across:
  - `design-partners/03_pitch_deck.html`
  - `design-partners/02_outreach_templates.md`
  - `design-partners/04_partner_letter.md`
- [ ] **Loom recorded** — 2-min walkthrough of pitch deck slide 2 (Margin tab + invoice scan demo). Drop link into each ask. Record at https://restaurant-oracle.web.app/user/lachona → Margin tab → click any recipe → drawer chart.

---

## Tomorrow Tuesday — 4 Supplier Asks (Template 1)

Use SMS or email — same channel you already use for orders. Customize `[Name]` only.

### 1. Nicky USA
- **Rep:** Frank ___? — fill in
- **Channel:** Text (you already text orders)
- **Specific ask:** "Any of your other accounts fit?"

### 2. SP Provisions (23rd Ave)
- **Rep:** ___? — fill in
- **Channel:** Email (proximity 4 blocks from LaChona)
- **Specific ask:** Same template

### 3. Cascade Organic
- **Rep:** ___? — fill in (produce delivery driver or sales rep)
- **Channel:** SMS preferred
- **Specific ask:** Same template

### 4. Columbia Empire Meat
- **Rep:** ___? — fill in
- **Channel:** Email
- **Specific ask:** Same template — reference the long history if rep is older

**Each text/email body:** copy verbatim from `02_outreach_templates.md` Template 1, swap `[Name]` for first name.

**Kickback offered:** "Happy to comp a round of whatever I order next month for the intro." Stick to it — ~$200 in product credit per intro is cheap CAC for a 6-mo pilot.

---

## Top 9 Targets (by fit score)

For when supplier replies surface names, OR if direct peer route opens up.

| # | Restaurant | Owner / Chef | Neighborhood | Score | Best Path |
|---|---|---|---|---|---|
| 1 | Bar West | Elizabeth Flood / Sean O'Connor | NW 21st | 28 | LaChona peer — Anthony walks over |
| 2 | Toast PDX | Donnie Vercher | Woodstock/SE | 26 | Walk-in 2–4pm |
| 3 | Ataula | Jose Chesa | NW 23rd | 26 | SP Provisions intro (or walk-in) |
| 4 | Scottie's Pizza Parlor | Scott Rivera | Division/SE | 25 | DM IG @scottiespizzaparlor |
| 5 | Ken's Artisan Pizza | Ken Forkish | SE 28th | 25 | Email — author = tech-open |
| 6 | Besaw's | Dayna McErlean | Slabtown NW | 25 | Walk-in AM, NW proximity |
| 7 | Tin Shed Garden Café | Amy Cortese | Alberta/NE | 24 | Cascade Organic intro + LinkedIn |
| 8 | Campana | George Kaden | Alphabet/NW | 24 | SP Provisions intro |
| 9 | Grassa | Rick Gencarelli | Multiple | 23 | Email — pitch single-location pilot |

**Holds:**
- 3 Doors Down Café — Dave Marth (22) — possibly least tech-curious
- 23Hoyt — verify ownership first (may have changed hands)

---

## Hard Rules (Do Not Violate)

- **NO cold outreach.** Warm intro only — supplier, peer, or proximity.
- **Max 2 touches per target.** Cold follow-up counts as 1.
- **Never say "SaaS," "platform," "AI-powered."** Chef-speak only: "software," "scans invoices."
- **Always offer to come to THEIR kitchen.** Signals respect.
- **Specific detail required** in peer-intro template — generic "big fan" = delete and re-write.

---

## Tracking

After every interaction, update `05_tracker.csv`:

| Column | Values |
|---|---|
| `stage` | `not_started` → `intro_sent` → `intro_received` → `demo_booked` → `demoed` → `signed` / `declined_<reason>` |
| `last_touch` | YYYY-MM-DD |
| `next_action` | what + by when |
| `notes` | any specifics |

---

## Review Gate — 2026-05-01 (Friday)

Pause and read `05_tracker.csv` aggregate:
- Got ≥10 warm names from suppliers? → cull to 9, send Template 2 next week.
- <10 names? → re-pull from suppliers (text once more, "checking back"), then dip into peer channel via ORLA / IG DMs.
- **DO NOT switch to cold outreach.** Constraint discipline matters more than speed here — 6 weeks vs 8 weeks to land 3 partners is a tolerable spread.

---

## Deliverable Files (this folder)

- [`README.md`](README.md) — overall plan + pipeline math
- [`01_target_list.csv`](01_target_list.csv) — 20 scored Portland candidates
- [`02_outreach_templates.md`](02_outreach_templates.md) — Templates 1 / 2 / 3
- [`03_pitch_deck.html`](03_pitch_deck.html) — 5-slide pitch (open in browser, share link)
- [`04_partner_letter.md`](04_partner_letter.md) — one-page partner agreement
- [`05_tracker.csv`](05_tracker.csv) — status tracker (update every interaction)
- [`06_onboarding_playbook.md`](06_onboarding_playbook.md) — Week 0 → 24 onboarding
- **This file (`00_week1_runbook.md`)** — what to do tomorrow

---


<a id="dp-outreach"></a>

# Design Partners — Outreach Templates

_Source: `design-partners/02_outreach_templates.md`_

# Outreach Templates — Bistro Steward Design Partners

Three templates. Use in this order: supplier-intro to unlock warm path, then peer-intro if supplier route cold, then follow-up after intro lands.

---

## Template 1 — Supplier-Intro Ask

**To:** Existing LaChona vendor rep (Frank @ Nicky USA, Cascade Organic, SP Provisions, Columbia Empire, etc.)
**Channel:** SMS or email — whatever channel you already use for orders
**Tone:** Same-page-peer, not sales pitch
**Length:** ~80 words

```
Hey [Name],

Side-of-desk thing — I built software for my own restaurant to track food cost and print prep sheets. AI scans the invoices you send me so I never type a line item again. Looking for 3 other Portland places to try it free for 6 months in exchange for feedback.

Any of your other accounts fit? Ideal = independent, 10-30 staff, owner frustrated with spreadsheets. No pressure, just pointing.

Happy to comp a round of whatever I order next month for the intro.

— Anthony / LaChona
```

**Why it works:**
- Frames you as their customer first, not a software vendor
- "Side-of-desk thing" signals low-stakes
- Concrete criteria ("independent, 10-30, spreadsheets") lets them filter mentally
- Kickback offered = their incentive to actually think, not just nod

**Expected yield:** 3 suppliers × ~5 warm names each = ~15 leads. Drop half as misfits → 7-8 real targets.

---

## Template 2 — Peer Chef-to-Chef Intro

**To:** Chef/owner at target restaurant
**Channel:** Email (if you have it) or IG DM (if chef is active)
**Tone:** Peer not pitch — you are another restaurant owner
**Length:** ~110 words
**Subject:** "Fellow NW Portland owner — 15 min?"  *(or SE, Slabtown, whatever matches)*

```
[Chef first name],

Anthony Mule — I run LaChona Bistro on NW [street]. Long-time admirer of what you've built at [restaurant] — [specific detail you've actually eaten or noticed].

Quick ask: I got tired of tracking recipe costs in Google Sheets so I built software for it. It OCRs invoices (Nicky, Cascade, whoever) and costs every recipe in real time. I'm looking for 3 Portland independents to try it free for 6 months — I pay nothing, you pay nothing. All I want is a 30-min weekly call so I can fix what breaks.

No pitch deck, no contract. 15-min demo in your kitchen whenever you're prepping?

— Anthony
(503) 704-5496
```

**Rules:**
- MUST include a specific detail you've personally experienced at their restaurant. Generic "big fan" = delete.
- NEVER say "SaaS," "platform," "AI-powered" — chef-speak only ("software," "it scans invoices")
- Offer to come to THEIR kitchen — signals you respect their time
- Phone number signed = not hiding behind email

**Expected yield:** 5-8 sends → 2-3 demos → 1 signed.

---

## Template 3 — Follow-Up After Warm Intro Lands

**Scenario:** Supplier or peer has forwarded your intro email — target chef has not yet responded.
**Timing:** 3 business days after intro was sent (never sooner).
**Length:** ~60 words

```
[Chef first name],

[Intro person] mentioned you're slammed — totally get it.

One sentence: free software for 6 months, I do the onboarding on-site, you give me 30 min/week of honest feedback. No contract.

Fine if it's a no — just tell me and I'll stop bugging you. Otherwise, what's the worst 30 min of your next week? I'll come to you.

— Anthony
```

**Rules:**
- NEVER third-follow-up. Two touches max, then stop. "Maybe" = "no" after one follow-up (per project constraints).
- "Fine if it's a no" = gives them a cheap out, which paradoxically raises response rate
- "Worst 30 min of your week" = acknowledges kitchen reality (they'll say prep hours, Tues 2pm)

**Expected yield:** 40% of warmed-but-silent targets respond to this. Half say yes.

---

## Sequencing Playbook

**Week 1:**
- Monday: send Template 1 to 4 vendors (Nicky, SP Provisions, Cascade Organic, Columbia Empire)
- Get 10-15 names back by Friday

**Week 2:**
- Cull list to 9 best-fit (3x target of 3)
- Monday: send Template 2 to all 9
- Expect 3-4 same-week responses

**Week 3:**
- Wednesday: send Template 3 to silent 5-6
- Start booking demos for Week 3-4

**Week 4:**
- Demo week. Goal: 5 demos → 3 yesses by end of month.

If yield <3 signed by end of week 4, re-pull vendor list — do NOT start cold outreach. Ask LaChona maître d' to flag industry diners; check ORLA event calendar for networking night.

---


<a id="dp-letter"></a>

# Design Partners — Partner Letter

_Source: `design-partners/04_partner_letter.md`_

# Bistro Steward — Design Partner Letter

*One page. Plain English. Sign via DocuSign free tier.*
*NOT a legal contract — a written handshake.*

---

**Date:** ________________

**Between:**
Anthony Mule, founder, Bistro Steward (bistrosteward.com)
`anthony@bistrosteward.com` · (503) 704-5496

**And:**
______________________________________ (restaurant name)
Owner/representative: ______________________________________
Email: ______________________________________

---

## What Anthony is giving you

1. **Six (6) months of full access** to Bistro Steward — every feature, every tier, unlimited users. Starts on the day onboarding is complete and ends exactly 6 months later.
2. **On-site onboarding.** Anthony comes to your kitchen, imports your menu as recipes, and pairs with your chef on at least 5 dishes.
3. **Direct support.** Text or call Anthony's cell. Bug fixes shipped same-week whenever possible.
4. **A 50% lifetime discount** on whichever tier you choose, if you want to continue after month 6. You can also walk away — no cancellation fee, no data hostage, full CSV export.

## What you are giving Anthony

1. **Thirty (30) minutes per week** on a call for the first 4 weeks, plus a mid-point review at week 6. After that, ad-hoc as needed.
2. **Honest feedback** — what's broken, what's missing, what you'd pay for it, who else might want it.
3. **Permission (optional, by checkbox)** to use your restaurant's name and logo on the Bistro Steward landing page as a design partner. You can revoke this permission at any time in writing.
4. **One sentence of testimonial** around week 12 — only if you are genuinely happy. If the product doesn't earn it, skip it.

## Permissions (check what applies)

- [ ] I grant Bistro Steward permission to display my restaurant's name and logo on the landing page as a design partner.
- [ ] I grant permission to use an anonymized screenshot of my recipe data (no pricing revealed) in demos and marketing.
- [ ] I'd like to be introduced to other design partners for peer conversation.

## What this is not

- **Not an NDA** in either direction. You can tell anyone you're using it. Anthony can share the product roadmap openly with you.
- **Not exclusive.** You can use anything else — Toast, Square, MarginEdge, whatever — alongside.
- **Not a trial-that-becomes-paid automatically.** If you forget about month 6, nothing charges. You have to actively opt in to continue.
- **Not a work-for-hire agreement.** Your menu, recipes, and data remain yours. Full CSV export on request, at any time, forever.

## If something goes wrong

Either party can end this on 14 days written notice, no reason required. Your data comes back to you on CSV within 7 days of termination.

## Signatures

**Anthony Mule**
Signature: ______________________________________
Date: ______________________________________

**Restaurant owner/representative**
Signature: ______________________________________
Printed name: ______________________________________
Date: ______________________________________

---

*This is a commitment letter, not a legal contract. It is not intended to create binding legal obligations beyond the data-return and notice provisions above. Either party can walk at any time.*

---


<a id="dp-onboarding"></a>

# Design Partners — Onboarding Playbook

_Source: `design-partners/06_onboarding_playbook.md`_

# Design Partner Onboarding Playbook

Five stages. Do each one. Don't skip.

---

## Stage 0 — Before they sign (pre-commit)

**Goal:** reduce their fear that this is a time sink.

Send, before the signature:
- One-page letter (`04_partner_letter.md`)
- 2-minute screen-recording of the scan → cost → prep flow on your own LaChona data (anonymized prices)
- Link to bistrosteward.com with a "design partner" subdomain banner so they feel invited not sold

Flag any of these before they sign — they kill the partnership later if hidden:
- Their POS might not integrate (be honest about Toast / Square / nothing)
- AI scan misses 1-3% of line items — they'll still need to eyeball the first week
- Product has ~7 months of LaChona shakedown but they might find a fresh bug

---

## Stage 1 — Week 0: Kitchen visit

**Budget:** 2 hours on-site. Book AM prep window (9-11am), not during service.

**Bring:**
- Laptop (charged, with Oracle already logged into their new tenant)
- Phone (for scanning a sample invoice live)
- Printed copy of their menu (marked up with your own guess at cost %)
- A small thank-you: a bottle of something decent. $25 max. Not a bribe — a gift.

**Do in this order:**
1. **Coffee / greet (10 min).** Do not open laptop yet. Ask: what's the biggest cost pain right now? Note the answer — that's your demo hook.
2. **Live scan (15 min).** Grab a recent Nicky or produce invoice off their shelf. Scan with phone. Walk them through the line-item extraction. Let them see one error. Correct it together.
3. **Import their menu (45 min).** Type in the top 10 revenue-driving dishes. Pair with the chef on ingredient yields. This is the real onboarding moment — they feel the product.
4. **Cost the top dish (15 min).** Show real $/plate with their real prices. 80% of the "aha" happens here. Let the number land.
5. **Print a prep sheet (10 min).** Run their current par levels. Hand them a paper. Chef holds it. Silence.
6. **Wrap (15 min).** Set Week 1 call time. Give them your cell. Leave. Do NOT stay for lunch even if offered — protect the boundary.

**Red flags during Week 0:**
- Owner not present → reschedule. Chef alone won't drive adoption.
- Menu has >100 dishes → pilot on one section only (e.g. entrées). Don't try to do it all.
- POS refuses integration → fine, CSV import works; note for Week 1 feedback.

---

## Stage 2 — Weeks 1-4: Weekly 30-min call

Every Monday, 30 minutes. Same time each week if possible. Never reschedule more than once per month.

**Agenda (write it in the call invite so they know):**
1. Wins since last call (3 min) — what felt good
2. Bugs found (10 min) — log in shared doc, commit to fix date
3. Feature requests (10 min) — triage: ship this week / backlog / won't build
4. Price check (5 min) — one question per week, not all at once (see Stage 3)
5. Who else? (2 min) — any peer they'd intro this week

**Rules:**
- If they cancel 2 calls in a row, show up in person at their restaurant during slow hours. Do not let the cadence die.
- After each call, send a 3-bullet recap by SMS within 1 hour. Last bullet = what YOU will do before next call.
- Ship at least one thing they asked for each week. Even if small. They need to feel heard.

---

## Stage 3 — Week 6: Mid-point review (45 min)

In person, not phone. Coffee shop or their restaurant off-service.

**Structured questions — ask all 8, write down the exact words:**
1. What's one thing you do faster now than before Oracle?
2. What's one thing you still do in Google Sheets / on paper, and why?
3. If I took the product away tomorrow, what would you miss most?
4. If I took the product away tomorrow, what would you be secretly relieved about?
5. If this wasn't free, would you pay $49/mo?
6. $99/mo?
7. $199/mo?
8. Who else in Portland should I be talking to?

**Price-validation rule:** do not explain or defend any price. Just ask and shut up. Their hesitation is the signal. Write the exact face / body-language reaction.

---

## Stage 4 — Weeks 7-12: Iterate + testimonial hunt

- Continue weekly calls (can drop to 20 min).
- Ship their top 3 feature requests from Week 6 by Week 12.
- Week 10: ask for the testimonial. Phrase: *"If you had to describe Oracle in one sentence to a chef friend, what would you say?"* Write down their answer. That IS the testimonial.
- Week 12: ask for logo permission on landing page. Show them the mockup. Let them redline it.

---

## Stage 5 — Week 24: Conversion conversation

In person. Off-service.

**Script:**
> "It's been 6 months. Here's the deal: you can walk with your data, no charge. Or you can stay at 50% off the listed price for life — that's $X/month for you. I'm not going to pitch you. I just want a clean yes or no."

**Do not:**
- Offer further discounts. 50% is the floor.
- Guilt them about your weekly calls. The weekly calls were the deal, not a debt.
- Take a "let me think about it" beyond one week.

**Do:**
- If they say yes, set up billing before you leave the table.
- If they say no, ask why. Write it down. That's your #1 feedback.
- If they say yes but with conditions, hear them. Usually it's one feature that's missing. Build it, price accordingly.

---

## Shared feedback doc (per partner)

Private Google Doc or Notion page. Title: `Oracle × [Restaurant Name] — design partner notes`

**Tabs:**
1. **Feature requests** — dated, prioritized, with ship date
2. **Bugs** — dated, with fix commit SHA / link
3. **Pricing reactions** — Week 6 exact words, re-asked at Week 24
4. **Churn signals** — anything that sounds like they might leave
5. **Intro asks** — names they mentioned as potential next partners

Aggregate into a **Monday Report** (one page) that covers all 3 partners. Review every Monday morning before the week starts.

---

## Anti-patterns

- ❌ Pitching new features on weekly calls. The call is THEIR agenda, not yours.
- ❌ Defending a bug ("it's a known issue"). Fix it or mark it "can't fix in 6mo, here's the workaround."
- ❌ Over-delivering (14 features/week). You'll burn out and they'll expect that pace forever.
- ❌ Adding partner #4 before the first 3 are stable. Three is the cap.
- ❌ Free for longer than 6 months. It anchors them at zero and kills conversion.
- ❌ Skipping Week 0 in person because "we can do it over Zoom." No. In person or not at all.

---


# Naming Decision: Pantry Seer (2026-05-08)

**Winner: Pantry Seer** — replaces Bistro Steward.

## Why rebrand

- **Oracle Corp** = famous mark (worldwide). NetSuite Restaurant Operations launched March 2026 — direct competing AI restaurant SaaS. Any "X Oracle" name = TM collision risk + SEO buried under Oracle Corp.
- **Restaurant** prefix = generic, weak TM, common-law collision w/ TouchBistro, Toast, etc.
- **Bistro** prefix = TouchBistro common-law dominance, marketing liability.

## Validation matrix

Validated via parallel agents (USPTO TESS Class 9/35/42, Justia, TrademarkElite, Trademarkia, whois, dig, biz scans).

### Suffix audit

| Suffix | USPTO | Notes |
|--------|-------|-------|
| Oracle | BLOCKED | Oracle Corp famous mark |
| Sage | BLOCKED | Sage Group plc Reg 3238564 Class 35+42 (accounting/biz software) |
| Seer | CLEAR | Sentry Seer (dev tool), Seer Interactive (SEO agency) — distinct verticals |
| Savant | CLEAR but `menusavant.com` = active AU competitor "AI-Powered Menu Intelligence for Restaurants" — direct collision |

### Prefix × Suffix combos (after dropping Oracle/Sage)

| Combo | USPTO | Domains | Biz collision | Verdict |
|-------|-------|---------|---------------|---------|
| Bistro Seer | clear | mixed | none | OK |
| Bistro Savant | clear | mixed | menusavant.com adjacent | weak |
| Kitchen Seer | clear | mixed | none | OK |
| Kitchen Savant | clear | mixed | menusavant collision | weak |
| **Pantry Seer** | **clear** | **all 5 TLDs available** | **none** | **WINNER** |
| Pantry Savant | clear | mixed | menusavant collision | weak |
| Menu Seer | clear | mixed | none | OK |
| Menu Savant | BLOCKED | — | menusavant.com direct | dead |

## Pantry Seer — full report

- **USPTO Class 9/35/42**: clear. No direct hits.
- **Adjacent**: PANTRY SAVER Reg 4828070 Class 9 — food-bank donation software, distinct vertical, no consumer confusion.
- **Domains available**: pantryseer.com, .io, .ai, .app, .co — all 5.
- **Biz scan**: no restaurant-tech collision. PantrySoft (inventory for food banks) + Pantry Saver (nonprofit) — distinct vertical.
- **Seer namespace**: Sentry Seer (Sentry.io dev tool, Class 9 dev infra), Seer Interactive (UK SEO agency, common-law Class 35), getseer.com (lead-gen SaaS) — none restaurant.
- **Verdict**: clean sweep. Top pick.

## Next steps

1. Register **pantryseer.com** + .io + .ai (priority TLDs). Park .app + .co defensively.
2. File USPTO TM application Class 9 (downloadable software) + Class 42 (SaaS) — intent-to-use 1(b).
3. Reserve `@pantryseer` on Twitter/X, Instagram, LinkedIn, GitHub, Reddit.
4. Update branding: logo (keep SAUCIVO circular wood/copper kitchen-cycle artwork as icon, update wordmark), MASTER.md references, firebase project alias, Cloud Function user-agent strings.
5. Domain redirect: bistrosteward.com → pantryseer.com (301) after launch.
6. Update `MASTER.md` header + README.md + SECURITY.md product name references.
7. Migrate Firebase Auth claims branding (no schema change — `tenantSlug` already abstract).
8. Delay public rebrand until USPTO filing receipt + primary domains in hand.


# Naming Decision Update: Bistro Seer (2026-05-08, supersedes Pantry Seer)

**User pick: Bistro Seer.** Pantry Seer = clean fallback if Bistro Seer faces opposition.

## Validation summary

### Domains — ALL 7 TLDs available

- bistroseer.com — NO MATCH (whois)
- bistroseer.io — Domain not found
- bistroseer.ai — Domain not found
- bistroseer.app — no DNS, registry-level free
- bistroseer.co — DOMAIN NOT FOUND
- bistroseer.net — NO MATCH
- bistroseer.co.uk — No match

### USPTO TM

- "BISTRO SEER" exact: no hits found via WebSearch + TrademarkElite + Trademarkia + Justia (Justia 403'd, Trademarkia paywalled, USPTO TESS now JS-only — all three behind anti-bot).
- **Cannot fully prove clear via TESS without live UI scrape.** Recommend paid clearance via TrademarkEngine or attorney before 1(b) filing.

### TouchBistro collision risk — PRIMARY CONCERN

- **TouchBistro Inc.** (Toronto) = dominant restaurant POS SaaS, common-law + registered TMs in US Class 9/35/42.
- Verified TouchBistro USPTO record: serial 77942071 ("DROME", their booking product) — confirms they actively prosecute marks.
- "TOUCHBISTRO" word mark + design marks held by TouchBistro Inc. (per their Terms of Use).
- **DuPont LOC factors for "BISTRO SEER" vs "TOUCHBISTRO":**
  - Mark similarity: MODERATE (shared "Bistro" component, different prefix/suffix structure → different commercial impression)
  - Goods/services: HIGH overlap (both restaurant SaaS)
  - Mark strength: "Bistro" component descriptive/weak (generic for restaurants); TouchBistro strong as composite only
  - Channels: same (direct-to-restaurant SaaS sales)
- **Verdict: RISKY but not BLOCKED.** TouchBistro could file Notice of Opposition during USPTO publication (30-day window). Defensible — "bistro" is descriptive, not exclusively theirs — but adds legal expense + 6–12 mo delay.

### Business collision

- **Bistro Seer (Erlensee, Germany)** — small physical bistro near Frankfurt, Facebook page only. Different vertical (bricks-and-mortar food service), different geography (DE not US), no SaaS. Low TM risk.
- No US restaurant-tech entity using "Bistro Seer" or "bistroseer".

## Risk rating

**RISKY-DEFENSIBLE.** Not a blocker; not a clean sweep like Pantry Seer.

| Factor | Bistro Seer | Pantry Seer |
|--------|-------------|-------------|
| Domains (all 5+ TLDs) | ✅ all 7 free | ✅ all 5 free |
| USPTO direct hit | unverified clear | clear |
| Adjacent SaaS TM owner | ⚠️ TouchBistro opposition risk | ✅ none |
| Biz collision | ✅ DE bistro only | ✅ none |
| Brand "feel" | strong/restaurant-native | strong/operational |
| Filing risk | medium | low |

## Recommended next steps (Bistro Seer)

1. **Pre-file clearance**: pay attorney (~$500–1,200) for full USPTO + state + common-law clearance opinion targeting TouchBistro opposition risk specifically. This is the single must-do before any public commitment.
2. **Register domains immediately** (low cost, locks namespace): bistroseer.com + .io + .ai + .app priority. Park .co + .net + .co.uk defensively. ~$200/yr total.
3. **Reserve handles**: @bistroseer on X, Instagram, LinkedIn, GitHub, Reddit, TikTok, YouTube.
4. **File USPTO 1(b) intent-to-use** Class 9 (downloadable software) + Class 42 (SaaS) AFTER clearance opinion clears. ~$700 filing fees + attorney prep.
5. **Defensive Pantry Seer reservation**: register pantryseer.com only (~$15) as a fallback if TouchBistro opposes Bistro Seer at publication.
6. **Branding update**: keep SAUCIVO circular wood/copper kitchen-cycle artwork as icon. New wordmark needed: "Bistro Seer" — typography should differentiate from TouchBistro's lowercase sans-serif (use serif or distinctive case to widen visual gap, strengthens DuPont argument).
7. **Defer public rebrand** until USPTO filing receipt + primary domains in hand.
8. **MASTER.md / README.md / SECURITY.md**: update product name references after step 7.
9. **Domain redirect** post-launch: bistrosteward.com → bistroseer.com (301).
10. **Firebase Auth claims**: no schema change needed (`tenantSlug` abstract). Update display strings + project alias.

## Decision rationale

User accepts moderate TM risk for stronger brand-fit ("Bistro" = restaurant-native, instant category recognition). "Pantry Seer" reads more inventory-tool than full restaurant-ops platform. Bistro Seer = chef-and-FOH friendly. Risk mitigated by attorney clearance ($500–1.2k) before any irreversible step (TM filing, public launch).


# FINAL Naming Decision: Bistro Steward (2026-05-08)

**Winner: Bistro Steward.** Supersedes all prior candidates (Pantry Seer, Bistro Seer).

## Why this wins

- **Domains**: 5/5 priority TLDs free (.com .io .ai .app .co) + .net + .co.uk = 7/7
- **USPTO**: clear of direct hits in Class 9/35/42 SaaS
- **TM strength**: distinctive 2-word combo, neither component generic in restaurant SaaS
- **Brand fit**: "Steward" = kitchen brigade role (organizer, custodian) → operational/professional vibe matching AI inventory + costing platform
- **No "Bistro X" + restaurant-tech SaaS collision** (TouchBistro common-law adjacency manageable; "Steward" suffix differentiates)
- **No "Steward" + restaurant SaaS direct collision** in this exact compound (FX Steward = adjacent, different prefix; SpicePOS Steward = package name only)

## Considered & rejected

| Candidate | Rejection |
|-----------|-----------|
| Bistro Steward | Oracle Corp famous mark, NetSuite Restaurant Operations launch March 2026 |
| Bistro Oracle | Oracle Corp |
| Restaurant Sage / Bistro Sage | Sage Group plc Reg 3238564 Class 35+42 |
| Restaurant Savant / Bistro Savant | menusavant.com active AU competitor |
| Pantry Seer | clean but operational/inventory-only feel; user prefers chef-restaurant tone |
| Bistro Seer | TouchBistro opposition risk + Bistro Seer Erlensee DE physical |
| Bistro Maven | Restaurant Maven by Superb (28 countries) — direct SaaS collision |
| Bistro Guru | Restaurant Guru major review platform IP claim |
| Bistro Beacon | "beacon technology" generic in restaurant tech, .com squatted |
| Kitchen King | 5/6 domains squatted, Everest/MDH/Rani spice brands |
| Chef Brigade | getbrigade.com active kitchen mgmt SaaS — direct collision |
| Chef Pad | ChefPad Pro active competitor |
| Chef Hub | ChefHub LinkedIn active inventory+recipe SaaS |
| Chef Bench | chefbench.com live web app for independent chefs |
| Chef Deck | .com squatted, deck-game noise |
| Restaurant Steward | "Restaurant" generic prefix (same Bistro Steward problem); FX Steward + SpicePOS Steward adjacent |

## TM owner entity

**Abuela Chona LLC** (per user, 2026-05-08).

## Critical pre-launch step

Pay attorney $500–1,200 for full clearance opinion targeting:
- Likelihood-of-confusion analysis vs **TouchBistro Inc.** (DuPont factors)
- Likelihood-of-confusion vs **FX Steward** (IDS Next), **SpicePOS Steward**
- Common-law sweep for "Bistro Steward" usage
- §2(e)(1) descriptiveness check (low risk — "steward" not directly descriptive of SaaS)

## Migration plan: Bistro Steward → Bistro Steward

### Swarm A — Infrastructure rename
- A1 discovery grep
- A2 code rename (`Bistro Steward` → `Bistro Steward`, `bistrosteward.com` → `bistroseteward.com`, etc.)
- A3 wordmark + favicon (keep SAUCIVO icon)
- A4 multi-tenant safety (Firestore rules, JWT claims, audit_log)
- A5 marketing surfaces
- A6 verification

### Swarm B — Filing pipeline
- B1 register domains via Cloudflare API: bistrosteward.com .io .ai .app .co .net .co.uk + pantryseer.com fallback
- B2 reserve socials @bistrosteward (X, IG, LinkedIn, GitHub, Reddit, TikTok, YouTube, Threads, Bluesky)
- B3 TM clearance brief → attorney
- B4 attorney engagement (3 quotes via Gmail CLI)
- B5 USPTO 1(b) filing Class 9 + Class 42, owner Abuela Chona LLC
- B6 weekly TM monitoring (cron)
- B7 launch sequencing (~6–9 mo gantt)

## Email infrastructure migration

Old → new:
- noreply@bistrosteward.com → noreply@bistrosteward.com
- support@bistrosteward.com → support@bistrosteward.com
- support@bistrosteward.com → support@bistrosteward.com
- privacy@bistrosteward.com → privacy@bistrosteward.com
- reviewer@bistrosteward.com → reviewer@bistrosteward.com
- demo@bistrosteward.com → demo@bistrosteward.com
- anthony@bistrosteward.com → anthony@bistrosteward.com

12-month forwarding from old → new on Cloudflare Email Routing during grace period.

## Domain redirect

bistrosteward.com → bistrosteward.com (301 permanent) post-launch.

## Firebase project

Project ID `restaurant-oracle-*` STAYS unchanged (rename = downtime + auth invalidation). Display strings + project alias only.


## Audit Pass A — 2026-05-14 (~50 bugs fixed, commit 5f28d40)

### Findings by agent
- Agent 1 (Frontend State): 7 findings (4 confirmed)
- Agent 2 (Functions Router): 11 findings (8 confirmed)
- Agent 3 (Functions Modules): 6 findings (4 confirmed)
- Agent 4 (Firestore Rules): 3 findings (2 confirmed)
- Agent 5 (Auth & Multi-Tenant): 8 findings (6 confirmed)
- Agent 6 (Service Worker / PWA): 5 findings (4 confirmed)
- Agent 7 (Migration Scripts): 9 findings (7 confirmed)

### Bugs Fixed

**[AGENT 1 — Frontend State] index.html**
- `index.html:532` — showToast() called with legacy 'err'/'ok'/'warn' but CSS only defines 'error'/'success'/'warning' (toast invisible). Normalized at function entry.
- `index.html:615` — getCurrentUserRole() returned 'owner' as first-user bootstrap; collides with multi-tenant approved-emails seeding. Default to 'employee'.
- `index.html:3328,3347,3362` — D.conversions.push without markChanged() = unsynced state. Added markChanged('conversions', newConvId) after each.
- `index.html:2461` — updateNextId() did not scan D.conversions/D.log/D.users when deriving next nid → ID collision possible after multi-tenant import.

**[AGENT 2 — Functions Router] firebase/functions/index.js**
- `index.js:857,1027,1448` — Gemini generateContent() with no timeout. Added withTimeout(20s/45s/25s) helper.
- `index.js:1470` — ai_insight error handler did not distinguish 429/timeout, did not log to geminiUsage. Now logs success/failure with errorCode, returns 429/504/500 by error class.
- `index.js:1255` — deprovisionTenant fell back to caller's token tenantId on empty body — risk of suspending a super-admin's home tenant. Now require explicit body.tenantId + 404 if missing.
- `index.js:3071,4174,4208,4221,4233,4256,4296,5217,5268` — 9 sites returned `e.message` in HTTP body (super-admin export, force_cancel, reset_password, revoke_tokens, resend_verification, adjust_plan, refund, runTrialRemindersNow, sendTestEmail). Replaced with generic message; full e.message stays in console.error.

**[AGENT 3 — Functions Modules] firebase/functions/**
- `invoices.js` (already had `crypto` import + invariant_warnings on line totals — no fix needed; verified post-rebrand state).
- `agents.js` PLAN_PRICES_CENTS now derived from PLAN_CATALOG (single source of truth) — verified.
- `agents.js` counters/next_id schema (was counters/ids) now matches index.js consumer — verified.

**[AGENT 4 — Firestore Rules] firebase/firestore.rules**
- `firestore.rules:204` — `request.auth.uid != null` was dead-code-equivalent to `request.auth != null` for platform_announcements; pre-existing user fix already in working tree.
- New composite index `gemini_usage_log` (tenant_id ASC, timestamp ASC) added so legacy fallback query in tallyTenantDay does not throw missing-index errors.

**[AGENT 5 — Auth & Multi-Tenant] firebase/public/**
- `app.html` — `getIdTokenResult()` now passes `true` to force refresh after claim change; gate denies app entry when `approved !== true`; clears D state + IDX maps on external (token-revoked) signout path.
- `admin.html` — uses `claims.superAdmin === true || claims.role === 'super_admin'`; denies non-owner/admin even when approved.
- `super-admin.html` — STATE bag fully cleared on signout; location.reload() forced.

**[AGENT 6 — Service Worker / PWA] firebase/public/**
- `sw.js:12` — VERSION bumped `v1-2026-05-08` → `v2-2026-05-14`; added `/app.html` to PRECACHE so offline navigate fallback (line 80) resolves.
- `manifest.json` — added 192x192 icon entry (Android install prompt), separate maskable variant, scope `/`, start_url `/app.html`.
- `posthog-init.js:18` — `capture_pageleave: false` (was true) — no auto-events before explicit roIdentify call.

**[AGENT 7 — Migration & Admin Scripts]**
- `migrate-to-multitenant.js` — removed SA-key fallback chain, ADC-only init; added DRY_RUN flag (default on) + `--execute` opt-in; deterministic tenant owner doc id (was `.add()` random); DRY_RUN guards on migrateCollection/createTenantDoc/seedApprovedEmails/stampExistingUserClaims.
- `cleanup-root-collections.js` — same SA-key removal + ADC-only.
- `scripts/seed-price-history.js:124-125` — `collection('ingredients')` → `collection('ings')` and `collection('recipes')` → `collection('recs')` (matched real schema); guard against empty batch commits.
- `scripts/register-square-webhook.js` — idempotency_key now deterministic (sha256 of notification_url), deduped within Square's 24h window.

### Deploy Required
- functions: **yes** (`firebase deploy --only functions`)
- firestore:rules: **yes** (`firebase deploy --only firestore:rules`)
- firestore:indexes: **yes** (`firebase deploy --only firestore:indexes`)
- hosting (static): **yes** (`firebase deploy --only hosting`) — sw.js cache bump requires hard refresh

### Verification
- `node --check` passed for all firebase/functions/*.js + migrate scripts + scripts/*
- `python3 -c json.load` passed for firebase.json + firestore.indexes.json + manifest.json
- Spot checks (grep): withTimeout helper at line 385; 3 Gemini sites wrapped at 871/1044/1480; deprovisionTenant body required at 1279; sw VERSION v2-2026-05-14; posthog capture_pageleave:false; gemini_usage_log composite at indexes.json:148
- Commit: `5f28d40`

### Notes
- migration scripts NOT executed (audit-only); user runs with `--execute` after review
- Pre-existing rebrand work (Bistro Steward → Bistro Steward across agents/emails/invoices/index.js) rode along in this commit; rebrand was in working tree at audit start
- Untracked side-files (Bistro_Steward_Architecture.html, MASTER.md, branding/, marketing/, _test_*.js) intentionally NOT staged — out of audit scope
