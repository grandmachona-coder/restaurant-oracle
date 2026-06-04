# Bistro Steward — App Store Submission Kit

**Generated 2026-06-01.** Paste-ready content for App Store Connect. Covers ship-list items #4 (privacy label) + #5 (listing copy) + review notes for #2 (the ASC record) and #6 (submit). Demo account (#1) is done; screenshots (#3) tracked separately.

> ⚠️ **Two blockers found — fix before you submit:**
> 1. **`bistrosteward.com` is not live** (DNS/hosting returns no response). All public URLs below use `restaurant-oracle.web.app`, which IS live. Either point `bistrosteward.com` at the Firebase site or keep the `web.app` URLs in the listing.
> 2. **Support email must actually receive mail.** `support@bistrosteward.com` is referenced in code, but the domain isn't resolving, so mail likely bounces. Apple emails the support address. Use a working inbox (e.g. forward to `grandma.chona@gmail.com`) or fix the domain first.

---

## 1. App information (static)

| Field | Value |
|---|---|
| **App Name** (max 30) | `Bistro Steward` (14) |
| **Subtitle** (max 30) | `Smart Restaurant Management` (27) |
| **Bundle ID** | `com.bistrosteward.app` |
| **Primary category** | Business |
| **Secondary category** | Food & Drink |
| **Age rating** | 4+ (no objectionable content) |
| **Primary language** | English (U.S.) |
| **Price** | Free (subscription billed on the web — see §4) |

---

## 2. Listing copy

### Keywords (max 100 chars, comma-separated, no spaces after commas)
```
restaurant inventory,kitchen,food cost,prep,par level,stock count,recipe,vendor order,barcode,scan
```
(98 chars. Don't repeat words already in the name/subtitle — Apple indexes those separately.)

### Promotional text (max 170 chars — editable any time without review)
```
Scan, count, and cost your kitchen in minutes. Real-time inventory, recipes, prep lists, and food-cost margins built for restaurant teams.
```

### Description (max 4000 chars)
```
Bistro Steward is the kitchen-management app for restaurant owners, chefs, and prep teams. Count inventory with your camera, build recipes and menus, run prep lists, and see food cost the moment a price changes — all in one place.

SCAN & COUNT
• Scan product barcodes with the camera to add and update inventory fast
• Count by storage location (walk-in, dry storage, line, freezer, and your own areas)
• Snap a photo of a count sheet and let the app read the numbers for you
• Flag low and out-of-stock items automatically

RECIPES & MENUS
• Build recipes with ingredients, sub-recipes, yields, and notes
• Link recipes into menus and see food cost and margin per dish
• Update one ingredient price and watch every recipe and menu recost instantly

PREP & ORDERING
• Daily prep lists with batch tracking and on-hand counts
• Auto-built shopping lists from par levels and on-hand stock
• Organize vendors and ordering in one view

BUILT FOR TEAMS
• Owner, manager, and staff roles
• Real-time sync across phones and the back-office web app
• Activity log so you always know who changed what

Bistro Steward keeps your kitchen organized, your counts honest, and your food cost under control — whether you run one location or several.

Subscriptions are managed on the web. Download the app free and sign in with your account.
```

### What's New (version notes — for the first release)
```
First release of Bistro Steward for iPhone: native barcode scanning, camera count-sheet capture, real-time inventory, recipes, menus, prep, and food-cost tools.
```

### URLs
| Field | Value | Note |
|---|---|---|
| Marketing URL | `https://restaurant-oracle.web.app` | landing page (live) |
| Support URL | `https://restaurant-oracle.web.app` | ⚠️ ideally a dedicated `/support` page — none exists yet |
| Privacy Policy URL | `https://restaurant-oracle.web.app/privacy` | live (200) |
| (Terms, if asked) | `https://restaurant-oracle.web.app/terms` | live (200) |

---

## 3. App Review Information (the notes Apple reads)

**Sign-in required:** Yes.
```
Demo account (email/password — Google & Apple SSO are also offered but reviewers should use this):
  Username: demo@bistrosteward.com
  Password: <in App Store Connect → App Review Information; not committed to the repo>
```

**Notes for the reviewer:**
```
Bistro Steward is a B2B restaurant kitchen-management tool. The demo account above opens a fully seeded sample restaurant ("Demo Bistro") so you can explore inventory, recipes, menus, and prep.

To test the headline native feature — barcode scanning:
  Inventory tab → "Scan Barcode" → point the camera at any product barcode. The app looks up the item and lets you add/update inventory.

Billing: subscriptions are sold and managed on our website, not in the app. There is no in-app purchase. The in-app billing area only shows plan/status and links out to the browser, consistent with App Store Review Guideline 3.1.3 (B2B "reader"/business-app billing managed outside the app).
```

---

## 4. App Privacy ("nutrition label")

**Do you collect data?** Yes. **Used to track you across apps/sites?** No (no ad SDKs, no IDFA; PostHog runs in `identified_only` with DNT respected and IP dropped).

Declare these data types (all **linked to the user's identity**, **not** used for tracking):

| Category | Data type | Purpose | Notes |
|---|---|---|---|
| Contact Info | Email address | App Functionality, Account | Firebase Auth |
| Contact Info | Name | App Functionality | display name from sign-in |
| Identifiers | User ID | App Functionality | Firebase UID + tenant ID |
| User Content | Other user content | App Functionality | inventory, recipes, menus, photos of count sheets |
| Usage Data | Product interaction | Analytics | PostHog (product analytics) |
| Diagnostics | Crash data | App Functionality / Analytics | Sentry |

**Camera:** used for barcode scanning and count-sheet OCR. Count-sheet images are sent to Google (Gemini) for text extraction and are **not** stored for advertising/tracking. `NSCameraUsageDescription` is set in Info.plist. (Camera itself isn't a "data type" in the label — declare the resulting data only if stored; here it maps to "Other user content".)

**Payment:** card/billing data is handled by **Square** on the web — the app does not collect or process payment info. Do **not** declare Financial Info for the app.

**Do NOT declare:** Location, Contacts, Health, Browsing History, Search History, Sensitive Info, Advertising Data, Push tokens (push notifications are not implemented in this build).

---

## 5. Pre-submit checklist

- [ ] Fix `bistrosteward.com` (or accept `restaurant-oracle.web.app` URLs in the listing)
- [ ] Confirm the **support email inbox actually receives mail**
- [ ] Demo account verified (✅ done — logs in, data loads, scanner enabled)
- [ ] Screenshots uploaded — 6.9" (1320×2868) + 6.7" (1290×2796); iPad if you enable iPad support (#3, pending)
- [ ] Privacy label entered per §4
- [ ] Listing copy entered per §2
- [ ] Review notes + demo creds entered per §3
- [ ] Build uploaded via Xcode/Transporter, attached to the version
- [ ] Export compliance: app uses standard HTTPS encryption only → answer "uses encryption: yes, exempt (standard)"
```
