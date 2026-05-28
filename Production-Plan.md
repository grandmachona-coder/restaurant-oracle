# Bistro Steward — Path to Production

Last updated: 2026-05-28. Covers what's shipped, what still has to ship, and how to ship a real iPhone app on top of the existing PWA without rewriting the product.

---

## 1. Where we are today (honest baseline)

**Shipped and live on `restaurant-oracle.web.app`:**

- Multi-tenant Firebase PWA. 16 per-tenant collections, JWT `tenantId`+`approved` claim isolation, Firestore rules enforced, all writes through one Cloud Function.
- Signup → Stripe/Square checkout → tenant provisioning → owner welcome flow.
- Owner billing console (`/billing`), super-admin operator console (`/super-admin` — drawer contract fully repaired this session).
- Inventory / Recipes / Prep / Shopping / Activity log / Admin tabs.
- OCR sheet scan (Gemini 2.5 Flash) for handwritten count sheets.
- UPC scanner — backend `upcLookup` (Open Food Facts + cache + optional paid fallback), v13 frontend force-WASM-on-iOS, working on LaChona iPhone PWA.
- Daily scheduled rollups: cost, usage, health, trial.
- PostHog analytics, Sentry hooked (placeholder DSN), in-app feedback capture.
- Terms, Privacy, Square error mapping, email-verification gate.
- 6-agent Claude framework (provisioning, onboarding, support, health, revenue, deployment).

**Implication:** the *product* is largely production-ready for LaChona-style single-tenant operation. What's still required to call it "in production" for a broader customer set is mostly the work *around* the product — legal, ops, support, distribution — plus a native iPhone app to remove install friction.

---

## 2. Pre-launch checklist — must complete before paying customer #2

### Legal & compliance

- [ ] **Trademark** — USPTO TESS clearance + file Class 9 (software) + Class 42 (SaaS). Pre-existing task chip. Independent of code; do in parallel.
- [ ] **Privacy Policy legal review** — current doc is comprehensive but not lawyer-reviewed. Have a SaaS-experienced attorney review before commercial launch.
- [ ] **Terms of Service legal review** — same. Confirm the Oregon law + Multnomah County jurisdiction + $100/12-mo liability cap holds up.
- [ ] **DPA template** for B2B customers who ask (most won't, but enterprise prospects will).
- [ ] **Insurance** — general liability + cyber liability. Common starting line: $1M/$2M general, $1M cyber.

### Domain & email

- [ ] Set up `support@`, `noreply@`, `privacy@`, `owner@bistrosteward.com` (existing task chip — Cloudflare Email Routing inbound on `.com`, Resend outbound).
- [ ] Resend domain verification (DKIM, SPF, DMARC records).
- [ ] DMARC reporting endpoint (let an inbox or Postmark catch reports).
- [ ] Brand kit finalization — `/branding/` folder has work in progress.

### Transactional emails (queued — Resend wiring task chip)

Nine templates the system already expects to send but doesn't have wired:

- owner-welcome, team-invite, trial-ending-7d / 2d / today, first-charge-receipt, payment-failed, subscription-cancelled, subscription-reactivated.

`dailyTrialReminders` cron exists; the Square webhook needs branches for payment events. Estimate: one focused session.

### Monitoring & operations

- [ ] **Real Sentry DSN** — currently `FRONTEND_DSN_PLACEHOLDER` everywhere. Swap once a Sentry org is provisioned. Frontend + Cloud Function DSNs.
- [ ] **Uptime monitoring** — UptimeRobot or BetterStack pinging `/`, `/app`, `/super-admin`. 5-min intervals.
- [ ] **Status page** — public status.bistrosteward.com (BetterStack or Statuspage).
- [ ] **Backup strategy** — automated Firestore export to GCS bucket on a daily cron. Tested restore drill once before launch.
- [ ] **On-call / paging** — at least a SaaS alerting channel (PagerDuty / Opsgenie) wired to Sentry + uptime monitor. Even one-person on-call.
- [ ] **Audit log retention** — currently 7-year per retention policy. Confirm matches actual compliance needs; trim if over-retaining.

### Technical hardening

- [ ] **Square `listRecentCharges` money shape** — the operator console's Recent Charges section needs one-time live verification (UPC-Deploy.md Step 6, never validated). Small risk of formatting bug.
- [ ] **PAID UPC provider** when ready — `firebase functions:secrets:set UPC_PAID_API_KEY`, add to `runWith.secrets` array in the same change, then deploy. Inert until then.
- [ ] **UPC scanner GA** — `feature_flags/upcScanner` is currently LaChona-only via `enabledTenants:['lachona']`. To open to everyone: set `defaultValue:true`. Defense-in-depth follow-up: flag-gate the backend `upcLookup` op too.
- [ ] **Load test** — simulate 50 tenants × 1000 ingredients × 200 inventory items each, monitor CF latency + Firestore costs. Don't launch without numbers.
- [ ] **GDPR data export endpoint** — already partial via the operator `exportTenant` op (admin-side). Add a customer-facing self-serve "export my data" button.
- [ ] **Right-to-erasure flow** — currently operator can hard-delete a tenant; build a customer-initiated self-serve flow (confirmation + 30-day grace).
- [ ] **Quarterly security audit** schedule established.

### Customer success & support

- [ ] **Onboarding email sequence** — covered partially by the in-app onboarding wizard. Add a 7-day email drip.
- [ ] **In-app docs / knowledge base** — currently the onboarding wizard is the only guidance. Add a `?` help drawer linking to docs.
- [ ] **Tutorial videos** (queued task chip — YouTube series). 10 videos, 2-5 min each.
- [ ] **Public docs site** — `docs.bistrosteward.com` (Vercel + MDX or a hosted KB).
- [ ] **Support ticket SLA defined** — operator console has the ticket system; need a stated response-time commitment.

### Pre-launch beta

- [ ] **Recruit 3 design partners** (queued task chip). 6 months free in exchange for weekly feedback. Target signed by 2026-06-23 per prior plan. Independent of the iPhone-app work — they'll use the PWA first.

---

## 3. iPhone app plan

### Why an iPhone app at all (vs PWA forever)

The PWA works. But:

- **Discoverability** — restaurants search the App Store; "available on the App Store" is a trust signal for a tool that touches their inventory and billing.
- **iOS Safari quirks** — the v13 stub-bypass we just shipped is one example. Native ML Kit barcode + native camera permission flow eliminate a class of these.
- **Install friction** — "Open Safari, Share, Add to Home Screen, sign in" is a hard sell vs a tap in the App Store.
- **Native features** — push notifications, biometric login, background sync, native share sheet for invites.
- **No Apple billing pain** — Bistro Steward bills via Stripe/Square outside the app; B2B SaaS apps qualify for the "managed elsewhere" exemption, no IAP needed.

### Strategy: Capacitor wrapper, not a rewrite

Bistro Steward is one large PWA. The right move is **Capacitor** — a thin native shell that loads the existing webview, with native plugins for camera, barcodes, push, biometrics. ~99% of the codebase is reused; native bits are wired plugin-by-plugin.

Why not React Native? Full rewrite for marginal gain on a form-and-list product. Not worth it.
Why not Cordova? Capacitor is its modern successor and better maintained.
Why not Swift native? Same reason — too much for the value.

### Phases

#### Phase A — Capacitor scaffold (1-2 weeks)

1. Apple Developer Program enrollment ($99/yr — already in the 30-day plan budget).
2. Create the Capacitor project alongside the existing repo:
   ```
   npm install @capacitor/core @capacitor/cli @capacitor/ios
   npx cap init "Bistro Steward" com.bistrosteward.app
   npx cap add ios
   ```
3. Webview points at production (`https://bistrosteward.com` — or a staging URL for the first builds).
4. Xcode project setup: icons (1024×1024 + every required size), splash screens, app metadata, bundle ID, signing certificate.
5. First TestFlight build for internal testing on a real iPhone.

**Output of Phase A:** a build that launches, loads the production PWA in a webview, and works exactly as the PWA does today.

#### Phase B — Native plugin integration (2-3 weeks)

Each plugin is detected at runtime via `Capacitor.isNativePlatform()` so the existing web path stays untouched.

| Capability | Plugin | Why |
|---|---|---|
| Barcode scanning | `@capacitor-mlkit/barcode-scanning` | Native Google ML Kit — eliminates iOS Safari stub class of bugs entirely. Much faster and more accurate than WASM polyfill. The v13 web fix becomes the fallback; native users get the real thing. |
| Camera permission | `@capacitor/camera` | Better permission UX than browser prompt |
| Push notifications | `@capacitor/push-notifications` (APNs via Firebase Cloud Messaging) | Low-stock alerts, prep-ready notifications, billing events |
| Biometric auth | `@aparajita/capacitor-biometric-auth` | Face ID / Touch ID for app unlock |
| Safe area / status bar | `@capacitor/status-bar` | Native look, proper notch handling |
| App version / update prompt | `@capacitor-community/app-version` | Detect outdated app, prompt to update via App Store |

Code pattern (one example, the rest follow the same shape):

```js
// Inside _upcStartDecode, before the WASM polyfill path:
if (window.Capacitor && Capacitor.isNativePlatform()) {
  const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
  // Native ML Kit scan — no WASM polyfill needed at all on native iOS
  const { barcodes } = await BarcodeScanner.scan({ formats: ['EAN_13', 'UPC_A', ...] });
  _upcOnDetect(barcodes[0].rawValue);
  return;
}
// existing web path (v13 polyfill on iOS Safari) continues unchanged
```

#### Phase C — App Store submission (1-2 weeks calendar; ~2-3 days actual work)

App Review Guidelines compliance points to nail:

- **B2B billing exemption** — Bistro Steward bills via web (Stripe/Square). For B2B SaaS, Apple's guidelines permit external billing if the app is "for business use only" AND the in-app messaging doesn't link users out to a purchase flow. Position the app's billing area as account-management-only with "manage subscription in browser" copy. If reviewers push back, the **Reader app** clause (§3.1.3) is the backup justification.
- **Sign in with Apple** — required if any other social login is offered. We have Google. Add Sign in with Apple as a third option.
- **Privacy nutrition label** — disclose data collection per category (account info, audit logs, analytics, payment info collected by Square/Stripe).
- **App Store assets** — 1024×1024 icon (existing icon.png), iPhone + iPad screenshots (6 each minimum), description, keywords (target: "restaurant inventory", "kitchen management", "food cost"), privacy policy URL, support URL.

Submit for review. Typical turnaround: 24-72h. First submissions often get pushed back once on something minor — plan for one revision cycle.

#### Phase D — Post-launch maintenance

- In-app update prompts when web version advances (no resubmission needed for content; only Capacitor shell changes require resubmission).
- APNs certificates auto-renew via Firebase Cloud Messaging once configured.
- Apple Developer enrollment renewal annually.
- App Store screenshots / description updates as features ship.

### iPad — same build, real opportunity

Capacitor's iOS build runs on iPad with zero extra work. Position the iPad as the **kitchen-mounted scan station** — bigger screen, longer battery, dedicated workflow. This is a credible upsell over single-iPhone workflow and a strong sales angle for multi-station kitchens.

### Android — later, near-free

Same Capacitor codebase runs on Android via `npx cap add android`. Lower priority for restaurant target market but cheap to add post-iOS launch.

### Risks / things to plan for

- **Apple B2B billing review pushback** — have the "managed elsewhere" / "Reader app" justification ready. Worst case: comply by removing any in-app pricing copy.
- **App size** — ML Kit framework adds ~5MB. Acceptable.
- **APNs setup time** — push notifications require Apple cert + Firebase CM config; budget half a day.
- **Capacitor version drift vs the PWA** — minor; the webview is the source of truth. Plugin updates need to be tested before each App Store release.

---

## 4. Go-to-market

- **Pricing** already wired ($29 Starter / $49 Pro / $99 Scale).
- **Funnel measurement** already set up via PostHog (landing → signup → success).
- **Content** — YouTube tutorial series (queued chip), 10 videos.
- **Launch event** — ProductHunt launch mentioned in the 30-day plan; consider timing after the iPhone app is in TestFlight.
- **Trade shows** — Western Foodservice Expo, NRA Show. Year-out planning.
- **Partnerships** — POS vendors (Square has a marketplace), restaurant accounting (QuickBooks Online), food-service distributors.

---

## 5. Steady-state operations (post-launch)

- On-call rotation (even one-person at start).
- Weekly tenant health review using the operator console's at-risk-tenants list.
- Monthly cost review (operator console daily rollups → monthly).
- Quarterly security audit (external if budget allows).
- Customer success outreach to at-risk tenants flagged by the daily health score.
- Annual penetration test once meaningful customer base exists.

---

## 6. Suggested sequencing

If you treat the 2-3 week iPhone work as the long pole, a realistic order:

1. **Now**: legal review of Terms/Privacy + trademark filing (independent, parallel).
2. **Week 1**: real Sentry DSN, transactional emails, monitoring/status page, backup automation.
3. **Week 2**: domain emails finalized, brand kit done, knowledge base scaffolded, recruit design partners.
4. **Weeks 2-4**: iPhone app Phase A + B (Capacitor scaffold + native plugins).
5. **Week 5**: load test, security audit, App Store submission (Phase C).
6. **Week 6**: tutorial videos, ProductHunt launch.
7. **Beta starts whenever the 3 design partners sign** — they can use the PWA in parallel with iPhone-app development.

GA flip: `feature_flags/upcScanner.defaultValue=true` and remove the LaChona-only gate when broader pilot is comfortable.

---

## Open questions to resolve before this becomes a real plan

- Who are the 3 design partners — actual restaurants confirmed? (Pre-existing task chip, not yet started.)
- Is the trademark search clean? (Pre-existing task chip.)
- Apple Developer Program enrolled?
- Sentry org provisioned?
- Resend domain verified end-to-end?

Once these are answered, the sequence above becomes a concrete week-by-week plan rather than a sketch.
