# Bistro Steward — iOS App Build Plan (Capacitor)

**Created:** 2026-05-28
**Strategy:** Capacitor wrapper (decision of record per `Production-Plan.md` §3, 2026-05-28).
**Supersedes:** the Native SwiftUI rewrite roadmap in `MASTER.md` (line 41+, generated 2026-03-03) — **stale, do not follow.**

> **Conflict resolution (evidence-based):** `MASTER.md` chose Native SwiftUI ("invest in architecture early", `MASTER.md:933`). `Production-Plan.md` (dated *today*) reversed to Capacitor: "full rewrite for marginal gain… not worth it" (`Production-Plan.md:100`). Cause: between March and May the PWA grew to **10,916 lines** (`firebase/public/app.html`) plus the full SaaS surface (operator console, billing, multi-tenant, UPC scanner) — a Swift rewrite would mean maintaining two codebases of that size forever. Capacitor reuses ~99% of it. Capacitor wins.

---

## 0. Build progress (live)

**Branch:** `ios-capacitor` (off `upc-scanner-go-live`, has the live scanner code).

**Phase A scaffold — DONE (2026-05-28):**
- ✓ Capacitor **8.3.4** installed (`@capacitor/core`,`/cli`,`/ios`). Note: Capacitor 8 uses **SPM** (`ios/App/CapApp-SPM/Package.swift`), **not** CocoaPods.
- ✓ `capacitor.config.json` — remote webview `server.url = https://restaurant-oracle.web.app`, bundle id `com.bistrosteward.app`, `webDir = firebase/public`.
- ✓ Xcode project created: `ios/App/App.xcodeproj` (AppDelegate.swift, Info.plist, web assets copied to `ios/App/App/public`).
- ✓ App icon + splash (light/dark, bg `#162d45`) generated from `icon.png` into `Assets.xcassets`.
- ✓ `package.json` + lockfile backed up to `_backups/`.

**Phase A VERIFIED on iOS Simulator (2026-05-28):**
- ✓ Xcode 26.5 active (`xcode-select -s` + license accepted via sudo).
- ✓ `xcodebuild` Debug build for iPhone 17 simulator (`CODE_SIGNING_ALLOWED=NO`) → **BUILD SUCCEEDED**.
- ✓ `xcrun simctl` boot/install/launch headless → app runs, loads the remote PWA over network, renders the real app login (LaChona tenant).
- ✓ **Fix applied:** `server.url` was hitting the marketing landing (`index.html` at root); changed to `https://restaurant-oracle.web.app/app` so the app opens straight to the login. Rebuilt + re-verified.

**Google sign-in (§7.1) — DONE & VERIFIED (2026-05-29):** logged into the app on the simulator via native Google auth, real data loaded. The saga (all proven):
- `signInWithPopup` → external Safari (dead); `signInWithRedirect` → SafariViewController sheet (stranded); `+allowNavigation` → Google **403 disallowed_useragent** (Google blocks ALL embedded-webview OAuth by policy).
- Fix: `@capacitor-firebase/authentication@8.2.0` (native `ASWebAuthenticationSession`). Registered iOS app in Firebase → `GoogleService-Info.plist` added to bundle; `FirebaseApp.configure()` in AppDelegate; Google URL scheme in Info.plist; `app.html` native branch calls the plugin → `signInWithCredential` into the JS SDK.
- Keychain: unsigned sim build had no `keychain-access-groups` → "keychain error". Set `DEVELOPMENT_TEAM=CT2U4HUZJ2` + `App.entitlements` (keychain group). Simulator uses `*-Simulated.xcent` (team-prefixed). Fixed.

**Branding — DONE (2026-05-29):** zero "Restaurant Oracle" references. GCP project display name → "Bistro Steward" (fixes OAuth consent brand); `CFBundleName` → "Bistro Steward" (auth dialog); removed stale `restaurantoracle.app` from CORS/CSP/sentry; cleaned 7 docs. KEPT: immutable infra id `restaurant-oracle` (project/URLs/CF) + `_rename_manifest.md` archive.

**Sign in with Apple (§4.8) — IMPLEMENTED (2026-05-29), device-verify pending:** Apple provider enabled in Firebase (`enabled:true`, native iOS needs no Services ID); `com.apple.developer.applesignin` entitlement in `App.entitlements` (in the build); black Apple button on the login row (native-only, `app.html`); `signInWithApple()` → plugin → `OAuthProvider('apple.com').credential` → `signInWithCredential`. Verified on sim: button fires the native Apple authorization flow. Full login blocked ONLY by the simulator's documented SiwA unreliability (`AuthorizationError 1000`) — same pipeline as the working Google path. **Verify on a real device.**

**Full-bleed layout fix (2026-05-29):** `.phone` was a fixed 390×844 phone-mockup frame; changed to `position:fixed; inset:0` + safe-area padding. Edge-to-edge now.

**NEXT priorities:**
1. **Phase B barcode (capture deliverable):** `@capacitor-mlkit/barcode-scanning`, native branch at `app.html:10196` → `_upcOnDetect()` (`:10535`). Testable on sim.
2. **Commit** the `ios-capacitor` checkpoint (large uncommitted surface).
3. **Device build + TestFlight:** signing team set (`CT2U4HUZJ2`); verifies Apple sign-in for real.

**Uncommitted:** all on branch `ios-capacitor`.

**Build/run commands (reproducible):**
```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath /tmp/bs-dd CODE_SIGNING_ALLOWED=NO build
xcrun simctl boot "iPhone 17"; xcrun simctl install booted /tmp/bs-dd/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted com.bistrosteward.app
xcrun simctl io booted screenshot /tmp/shot.png
```

---

## 0.1 🎉 DEVICE-VERIFIED — WORKING ON iPhone (2026-05-29)

On Tony's iPhone 16 Pro Max, all confirmed working:
- ✅ Native **Google** sign-in
- ✅ Native **Sign in with Apple**
- ✅ Native **VisionKit barcode scanner**
- ✅ Full-bleed layout; zero "Restaurant Oracle"

**The architecture that worked (hard-won):**
- **Capacitor 8 + SPM, NOT CocoaPods.** CocoaPods + `static_framework` does **not** register pure-Swift `CAPBridgedPlugin` plugins in a **remote-loaded** webview (only ObjC `.m` `CAP_PLUGIN` ones self-register; the remote page has no bundled `@capacitor/core`, so no `registerPlugin`). SPM auto-registers package plugins. This is why Firebase auth broke under CocoaPods and works under SPM.
- **MLKit barcode is CocoaPods-only** → replaced with a custom **VisionKit `DataScannerViewController`** plugin shipped as a **local SPM package** (`local-plugins/bistro-scanner`, jsName `BistroScanner`, one-shot `scan()`). Auto-registers like Firebase. App-target Swift classes are NOT auto-discovered — must be a package.
- **Sign in with Apple gotchas (3):** (1) `skipNativeAuth: true` in capacitor.config so the JS SDK consumes the single-use Apple credential once (false → double-sign → `auth/missing-or-invalid-nonce`). (2) Apple omits the email claim from the ID token → CF falls back to `admin.auth().getUser(uid).email`. (3) The app gates on the `approved` JWT claim (`app.html:~1637`); a direct `approved_emails` Firestore add does NOT stamp it — the in-app **invite** flow does, or stamp via `setCustomUserClaims`.
- **Signing:** team `CT2U4HUZJ2`, Apple ID added in Xcode → Settings → Accounts, Developer Mode enabled on the device.

**Remaining = App Store submission** (§10): icon set ✓, screenshots (iPhone+iPad), privacy nutrition label, B2B-billing copy (§3.1.3), description/keywords, submit. Plus §2 production items (real Sentry DSN, monitoring, legal review).

---

## 0.2 — Post-device session (2026-05-30 → 06-01): features + infra shipped

All on `ios-capacitor`, deployed live (hosting + functions), verified. Native shell unchanged except the **app icon** (rebuilt + reinstalled to Tony's device).

**Update pipeline (CRITICAL — the multi-tenant OTA mechanism).** Web/JS/CSS ships to ALL tenants via `firebase deploy --only hosting`; no App Store resubmit. **Bug found + fixed (`71e1d02`):** the app loads `/app` (a clean-URL *rewrite*), which the `**/*.html` no-cache rule didn't match → served `max-age=3600` → WKWebView cached the app ~1h and deploys silently didn't land. Fix: `firebase.json` no-cache for `/@(app|signup|admin|billing|super-admin|terms|privacy)` + `sw.js` v13 HTML fetch `{cache:'no-store'}`. **Verify after any deploy:** `curl -sI https://restaurant-oracle.web.app/app | grep cache-control` → must be `no-cache`. Only NATIVE changes (plugins, icon, Info.plist) need a rebuild.

**iOS input-zoom fix (`71e1d02`):** WKWebView auto-zooms a focused input <16px and ignores `user-scalable=no` → `@media(pointer:coarse){ inputs … 16px !important }` (app.html); viewport got `viewport-fit=cover`.

**App icon (`71e1d02`):** cropped to the center serving-plate + steam (was the full cycle). `AppIcon.appiconset/AppIcon-512@2x.png` (1024² universal). Rebuild+install via `xcodebuild … -destination 'id=<UDID>'` then `xcrun devicectl device install app`. Login/PWA logo stays full `icon.png`; login bg now seamless linen.

**Inventory features (admin/owner, deployed):**
- **Prep → Menu-category groups (`11dafac`):** batches grouped under collapsible menuCat headers (recCat→menuCat by name+alias). Verified vs live data.
- **Drag-reorder (`4f91d30`):** items within a location + locations. `sortOrder` field (+ CF `sort_order`), delegated pointer-events drag, owner-only ☰ handle.
- **Location groups (`30f329a`):** assign locations to named groups (collapsible 📁 headers). `groupName` on area — no new collection.

**UPC scanner — free lookup cascade (`34eb03b` + this session):** `upc_cache (shared root) → USDA FoodData Central → Open Food Facts → UPCitemdb (free trial) → eandata (paid, OFF)`. USDA key in `functions/.env` (`UPC_USDA_API_KEY`, gitignored). Dropped Open Product Facts (SSL-broken) + Datakick (dead). **User-built shared catalog:** on total miss, the typed product is written to the root `upc_cache` (`source:'user'`, CF op `upcContribute`, all scan roles) → every tenant resolves it next scan. Paid tier OFF (eandata stale; if needed: Go-UPC live API, or UPC Data 4 Beverage Alcohol file for liquor).

### Outstanding to ship (current — supersedes §0.1 "Remaining")
**App Store (critical path → TestFlight):**
1. **Apple demo account** — login-wall app, reviewers can't do Google/Apple SSO → need an email/pass demo tenant (Claude can create). **Hard gate.**
2. App Store Connect record (bundle `com.bistrosteward.app`, category, age rating, pricing).
3. Screenshots (6.9" + 6.7"; iPad if supported).
4. App Privacy nutrition label (email/auth, PostHog usage, Sentry crash, camera).
5. Listing copy (name, subtitle, description, keywords; support/marketing URLs; `/privacy` + `/terms` live).
6. **Release build → TestFlight → submit** (archive Release, `npx cap sync ios`, bump build, upload).

**Production-readiness:** 7. Square env = **production** (CSP has sandbox+prod — confirm live keys before billing). 8. Firebase **App Check** (none found — add/confirm). 9. Firestore rules audit (tenant isolation). 10. Cost caps (Gemini cap exists; add Functions budget alert).

**Go-to-market:** signup→provisioning E2E; Square billing live (plan vars exist); onboarding/approval; support email + docs.

## 1. Scope

- **In scope:** ship a native iPhone app to the App Store that wraps the existing PWA, with **native barcode capture** (the deciding criterion) and the native plugins that remove web friction.
- **Out of scope:** the desktop owner/office web view — **frozen, unchanged.** It stays a web surface.
- **Two surfaces of the product:** (1) phone = inventory execution (barcode + count-sheet photo + compact status); (2) desktop = owner office (web only, untouched). This plan is about (1).

---

## 2. Capture-tech verdict (the deciding question)

**Recommendation: Capacitor + native Google ML Kit barcode (`@capacitor-mlkit/barcode-scanning`).**

Why this is the right capture choice for a *mixed* capture style (some one-at-a-time, some batch, plus count-sheet photos):

- The barcode scan runs in a **native camera session**, not the webview. The webview only renders the surrounding list/forms (not performance-critical). So capture performance is native-grade for the part that matters.
- It **eliminates the iOS Safari `BarcodeDetector` stub bug** you already fought (the v13 force-WASM hack at `app.html:10288`). Native users get real ML Kit; the v13 WASM polyfill stays as the web fallback, untouched.
- ML Kit handles continuous/batch scanning, torch, zoom, and low-light well for UPC/EAN on packaging — the actual kitchen use case.

**The only condition that would flip to native SwiftUI/VisionKit:** if the dominant workflow becomes *rapid batch shelf-sweeping* where you need Apple VisionKit `DataScannerViewController`'s live multi-barcode AR overlay (highlight many codes on-screen at once, tap to grab). That is best-in-class for high-volume batch, but it is **not** worth a full Swift rewrite + dual-codebase maintenance for a mixed workflow. Revisit only if batch-sweep becomes the primary mode and ML Kit continuous-scan proves too slow in practice.

> `[VERIFY]` Plugin API specifics below are from prior knowledge of `@capacitor-mlkit/barcode-scanning` (Capawesome). Confirm against the current plugin docs at build time — the package version in 2026 may differ.

---

## 3. Architecture decision — remote vs bundled webview

The Capacitor shell can either **load the live PWA over the network** (`server.url`) or **bundle a copy** of `public/` into the app (`webDir`).

**Recommendation: remote `server.url`** pointing at production.

| | Remote `server.url` (recommended) | Bundled `webDir` |
|---|---|---|
| Web updates | Instant, no resubmit | Resubmit per change |
| Offline | Needs network | Works offline |
| Code reuse | Trivial (~99%) | Needs sync step |
| Apple §4.2 "minimum functionality" risk | Higher (thin wrapper) — **mitigated by the native plugins** (ML Kit barcode, camera, push, biometric provide real native function) | Lower |

The app is already inherently online (Firestore + Cloud Functions need network), so offline is not a hard requirement today. The native plugins satisfy Apple §4.2.

**Fallback:** if App Review rejects on §4.2 "this is just a website," switch to bundled `webDir` + `npx cap copy` in the release step. Keep this option documented; do not pre-optimize for it.

---

## 4. Prerequisites

| Item | Owner | Notes |
|---|---|---|
| Apple Developer Program enrollment ($99/yr) | **[USER ACTION]** | Required for signing + TestFlight + App Store. Open question in `Production-Plan.md:225`. Enroll at https://developer.apple.com/programs/enroll/ |
| Install Xcode (latest stable) | **[USER ACTION / install]** | `xcodebuild` confirmed **absent** on this Mac. Install from Mac App Store, then run `xcode-select --install` for CLT. |
| Install CocoaPods | **[DEV]** | `pod` confirmed **absent**. `sudo gem install cocoapods` (or via Homebrew: `brew install cocoapods`). `[VERIFY]` current Capacitor may use SPM instead of CocoaPods — confirm in docs. |
| node + npm | ✓ present | node v23.5.0, npm 10.9.2 |
| 1024×1024 master icon | ✓ present | `icon.png` confirmed 1024×1024 |
| Decide build branch | **[DEV]** | Currently on `upc-scanner-go-live`. Scaffold on a fresh `ios-capacitor` branch off `main` after the UPC branch merges. |

---

## 5. Phase A — Capacitor scaffold (1–2 weeks)

**Goal:** an iPhone build that launches and loads the production PWA, indistinguishable from the PWA today.

```bash
# from repo root /Users/mulefamily/Claude/Bistro-Steward
npm install @capacitor/core @capacitor/cli @capacitor/ios   # [VERIFY] pin to current stable major
npx cap init "Bistro Steward" com.bistrosteward.app --web-dir=firebase/public
npx cap add ios
```

**`capacitor.config.ts`** (remote mode):

```ts
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bistrosteward.app',
  appName: 'Bistro Steward',
  webDir: 'firebase/public',              // used only for bundled fallback
  server: {
    url: 'https://bistrosteward.com',     // or restaurant-oracle.web.app for first builds
    cleartext: false,
  },
  ios: { contentInset: 'always' },
};
export default config;
```

Then:

```bash
npx cap sync ios
npx cap open ios          # opens Xcode (requires Xcode installed)
```

**In Xcode:**
1. Set the signing team (needs Apple Developer enrollment). `[USER ACTION]` for first signing.
2. Set bundle id `com.bistrosteward.app`, version, build number.
3. Add the app icon set (see §9).
4. Build to a physical iPhone, confirm the PWA loads and works.
5. Archive → upload to TestFlight for internal testing.

**Exit criteria:** TestFlight build installs on a real iPhone and behaves exactly like the PWA.

---

## 6. Phase B — native plugins (2–3 weeks)

Every native capability is gated by `Capacitor.isNativePlatform()` so the existing web path is never touched on the web.

### 6.1 Barcode scanning (ML Kit) — the capture deliverable

```bash
npm install @capacitor-mlkit/barcode-scanning   # [VERIFY] current version + API
npx cap sync ios
```

**Info.plist:** add `NSCameraUsageDescription` = "Scan product barcodes to update inventory."

**Exact insertion point** — the web scanner's start function in `app.html` sets `_UPC = {area:areaId,…}` at **`app.html:10197`** and calls `getUserMedia` at **`app.html:10216`**. Insert the native branch at the **top of that start function, before `getUserMedia`**:

```js
// at the top of the scan-start function (app.html ~10196, before the getUserMedia guard)
if (window.Capacitor && Capacitor.isNativePlatform()) {
    return _upcStartNativeMLKit(areaId);   // native path; funnels into the SAME detect handler
}
// ── existing web path (getUserMedia + WASM polyfill + detect loop) continues unchanged ──
```

New function (continuous mode preserves the existing zoom/torch/item-list overlay — `[VERIFY]` API):

```js
async function _upcStartNativeMLKit(areaId){
    const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
    const perm = await BarcodeScanner.requestPermissions();
    if (perm.camera !== 'granted') { showToast('Camera permission needed','warning'); return; }
    _UPC = { area: areaId, items: [], scanning: true, last: '', lastT: 0, manual: false, _unit: 'ea' };
    await BarcodeScanner.addListener('barcodeScanned', ev => {
        const v = ev.barcode && ev.barcode.rawValue;
        if (v) _upcOnDetect(v);            // ← reuse the EXISTING downstream handler (debounce, lookup, apply)
    });
    await BarcodeScanner.startScan({ formats: ['Ean13','Ean8','UpcA','UpcE','Code128'] });  // [VERIFY] format enum names
}
```

> **Critical (confirmed):** the native path must funnel decoded values into **`_upcOnDetect(code)`** — defined at **`app.html:10535`** — the same handler both web paths already call (BarcodeDetector path `app.html:10394`, ZXing fallback `app.html:10528`). It runs the dedupe/debounce, Open-Food-Facts `upcLookup`, and inventory apply. The native path is **tier-0** of the existing 3-tier fallback chain (BarcodeDetector/polyfill → ZXing CDN `_upcStartZxing:10426` → manual `_upcManualOnly:10668`). Do **not** duplicate the inventory-apply logic — just call `_upcOnDetect`.

Two implementation options:
- **v1 (fastest): `BarcodeScanner.scan()`** — one-shot native scanner UI (handles torch/zoom/multi natively). Replaces the web overlay during scan. Ship this first.
- **v2 (polish): `startScan()` + transparent webview** — keeps the existing custom overlay (zoom slider `app.html:10578`, torch button `:10580`, running item list). Requires making the webview background transparent. Upgrade to this after v1 proves out.

### 6.2 Camera (count-sheet OCR photo)

```bash
npm install @capacitor/camera && npx cap sync ios
```
- Native capture for the Gemini-Vision count-sheet scan → cleaner images; backend `scan` op unchanged.
- Gate behind `isNativePlatform()`; web `getUserMedia`/file-input path stays as fallback.
- Info.plist: `NSCameraUsageDescription` (shared with barcode), `NSPhotoLibraryUsageDescription` if picking from library.

### 6.3 Push notifications (low-stock / prep-ready / billing)

```bash
npm install @capacitor/push-notifications && npx cap sync ios
```
- iOS path = **APNs via Firebase Cloud Messaging**.
- `[USER ACTION]` Create an **APNs Auth Key** in the Apple Developer portal; upload it to the Firebase project (restaurant-oracle) Cloud Messaging settings.
- ✓ Confirmed: `messagingSenderId: 638911364090` + `appId` present in `firebase-config.js:18-19` (project `restaurant-oracle`). FCM project foundation is in place — only the APNs key + enabling remote push remains.
- `[DEV]` Server-side send from existing Cloud Functions (`firebase/functions/index.js`) on low-stock/prep/billing events. Register device token on the tenant/user doc.
- Info.plist + Xcode: enable Push Notifications + Background Modes (remote notifications) capabilities.

### 6.4 Biometric unlock (Face ID)

```bash
npm install @aparajita/capacitor-biometric-auth && npx cap sync ios   # [VERIFY] plugin choice/version
```
- Info.plist: `NSFaceIDUsageDescription` = "Unlock Bistro Steward with Face ID."
- Gate behind `isNativePlatform()`; optional app-lock setting.

### 6.5 Status bar / safe area

```bash
npm install @capacitor/status-bar && npx cap sync ios
```
- Proper notch/Dynamic-Island handling. The PWA already uses `viewport-fit=cover` + `env()` safe-area padding (per `Production-Plan.md` mobile work) — verify it carries into the webview.

---

## 7. Auth — Sign in with Apple + WKWebView fix

**Two distinct issues, both mandatory:**

### 7.1 `signInWithPopup` breaks in WKWebView — must fix

The web app uses `signInWithPopup` (**`app.html:1464`**, provider at `:1463`). Popup-based OAuth is unreliable inside Capacitor's WKWebView. Options:
- **Best:** use a native Google sign-in flow via a Capacitor plugin (e.g. `@codetrix-studio/capacitor-google-auth` or the official Firebase native auth) gated by `isNativePlatform()`, feeding the credential into Firebase Auth.
- **Minimum:** switch the native path to `signInWithRedirect`. `[VERIFY]` redirect flow in WKWebView with Firebase — historically also fragile; prefer the native plugin.

Keep the existing `signInWithPopup` for the web surface unchanged.

### 7.2 Sign in with Apple — App Store requirement (§4.8)

Apple **requires** "Sign in with Apple" whenever a third-party social login (Google, here) is offered.
- `[DEV]` Add `OAuthProvider('apple.com')` to Firebase Auth; enable Apple as a provider in the Firebase console / via API.
- Add the "Sign in with Apple" button to the login UI next to the Google button (login screen in `app.html`, near `:1463`).
- Xcode: add the "Sign in with Apple" capability.
- `[USER ACTION]` Configure the Service ID + key in the Apple Developer portal.

---

## 8. CSP / config changes

Current CSP is `default-src 'self'` with a remote allowlist (**`firebase.json:52`**). For the Capacitor WKWebView (origin `capacitor://localhost` on iOS):

- If **remote `server.url`**: the page is served by Firebase Hosting, so its CSP header applies. Add the Capacitor origin where needed so the webview shell can bootstrap. At minimum confirm `connect-src` still reaches Firestore/CF/Square/Sentry/PostHog from inside the webview.
- Add to the served CSP (or a meta-tag CSP if bundled): allow `capacitor://localhost` and `https://localhost` in `default-src`/`connect-src` as required by the plugins. `[VERIFY]` exact directives against current Capacitor iOS docs.
- `X-Frame-Options: DENY` (`firebase.json:35`) and COOP `same-origin-allow-popups` (`:48`) are fine for the app load; no change needed for the webview itself.

> Do not loosen CSP beyond what the webview needs. Add origins narrowly.

---

## 9. Assets

- **App icon:** generate the full iOS icon set from the existing **1024×1024 `icon.png`** (confirmed). Use `@capacitor/assets`:
  ```bash
  npm install -D @capacitor/assets
  npx capacitor-assets generate --ios   # reads icon.png + splash; emits all sizes
  ```
- **Splash screen:** provide a splash source (or reuse branding). `branding/` folder has work-in-progress assets.
- **Screenshots:** iPhone + iPad sets for App Store Connect (`[VERIFY]` current required sizes/counts in 2026). Capture from the TestFlight build.

---

## 10. Phase C — App Store submission (1–2 weeks calendar; ~2–3 days work)

**B2B billing-elsewhere (Guideline §3.1.3):** Bistro Steward bills via Stripe/Square on the web — **no IAP.**
- Position the in-app billing area as **account-management-only**: show plan/status, link out with copy like "Manage your subscription in your browser." Do **not** present in-app purchase flows or pricing-to-buy inside the app.
- Justification for reviewers: B2B SaaS, subscription managed externally; §3.1.3 "free stand-alone apps for business" / reader-app clause as backup. `[VERIFY]` current 2026 §3.1.3 wording.

**Privacy nutrition label — declare:**
- Account info (email, name, role), kitchen inventory data (linked to user), audit logs, PostHog analytics (usage), camera (barcode/OCR — used, not stored for tracking), payment handled by Square/Stripe (not by the app). `[VERIFY]` exact category mapping in App Store Connect.

**Submission checklist:**
- [ ] Sign in with Apple present (§7.2)
- [ ] Privacy policy URL (`/privacy`) + support URL/email
- [ ] Icon set + screenshots
- [ ] Description + keywords: target "restaurant inventory", "kitchen management", "food cost"
- [ ] Demo account for reviewers (a seeded tenant login)
- [ ] Submit. Expect **one revision cycle** on something minor (24–72h turnaround).

---

## 11. Phase D — maintenance + reach

- **Content updates:** with remote `server.url`, web changes ship instantly — no resubmit. Only shell/plugin changes need a new build.
- **iPad:** the same iOS build runs on iPad **free**. Position as the kitchen-mounted scan station (bigger screen, longer battery) — a multi-station upsell.
- **Android:** `npx cap add android` — same codebase, near-free. Lower priority; add post-iOS.
- APNs key + plugin versions: test before each App Store release.

---

## 12. Open questions / blockers

| Question | Owner |
|---|---|
| Apple Developer Program enrolled? | **[USER ACTION]** |
| Install Xcode + CocoaPods (both absent on this Mac) | **[USER ACTION / DEV]** |
| ~~FCM `messagingSenderId` present?~~ ✓ Resolved: `638911364090` (firebase-config.js:18) | — |
| Native Google sign-in plugin choice (vs redirect) for WKWebView | **[DEV]** |
| Current Capacitor major version + plugin APIs/format enums | **[DEV VERIFY]** — confirm in docs at build time |
| Remote vs bundled — confirm remote survives App Review §4.2 | **[DEV]** — bundled fallback documented (§3) |
| Merge `upc-scanner-go-live` → `main` before scaffolding | **[DEV]** |

---

## 13. Sequenced timeline

1. **Now (parallel, independent):** Apple Developer enrollment `[USER ACTION]`; install Xcode + CocoaPods.
2. **Week 1:** Phase A — scaffold, remote `server.url`, first TestFlight build on a real iPhone.
3. **Week 2:** Phase B.1 barcode (ML Kit, v1 `scan()`) wired at `app.html:10196` → funneled to the existing detect handler. Confirm native capture beats the WASM path on-device.
4. **Week 3:** Phase B.2–B.5 (camera, push, biometric, status-bar) + §7 auth (Sign in with Apple + WKWebView Google fix).
5. **Week 4:** §8 CSP, §9 assets, §10 App Store prep (billing copy, privacy label, screenshots, demo account).
6. **Week 5:** submit; handle the likely one revision cycle.
7. **Post-launch:** iPad positioning, then Android.

**Critical path:** Apple Dev enrollment → signing → TestFlight (Phase A) → barcode native swap (Phase B.1) → Sign in with Apple (§7.2) → submission (Phase C).
