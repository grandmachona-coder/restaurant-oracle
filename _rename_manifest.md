# Rename Manifest: Restaurant Oracle → Bistro Steward

Generated: 2026-05-08 | Scope: `/Users/mulefamily/Claude/Restaurant-Oracle/`
Excluded: `node_modules/`, `.git/`, `dist/`, `build/`, `_archive/`, `package-lock.json`

---

## Hit Counts per Pattern

| # | Pattern | Hits | Flag |
|---|---------|------|------|
| P1 | `Restaurant Oracle` | 209 | >100 (MASTER.md dominates: ~50 hits) |
| P2 | `restaurant oracle` | 1 | — |
| P3 | `RestaurantOracle` | 6 | iOS/Xcode identifiers |
| P4 | `restaurant-oracle` | 111 | >100 — Firebase project IDs embedded |
| P5 | `restaurant_oracle` | 0 | — |
| P6 | `restaurantoracle` (all) | 188 | >100 — subsumed in P8b/P9b |
| P7 | `RESTAURANT_ORACLE` | 0 | — |
| P8a | `restaurantoracle.com` | 44 | — |
| P8b | `restaurantoracle.app` | 139 | >100 |
| P9a | `@restaurantoracle.com` | 29 | Email addresses |
| P9b | `@restaurantoracle.app` | 17 | Email addresses |

**Total unique lines touched (all patterns combined, deduped):** ~540
**Total files touched:** 46

---

## Category Definitions

- **A** = Code (.js, .ts, .html, .css, .py)
- **B** = Config (.json, .toml, .yaml, .yml, firebase.json, manifest.json)
- **C** = Docs/MD (.md, .txt, README)
- **D** = Assets (file/directory names)
- **E** = External-URL refs (need 301 redirect, not in-place rename)
- **F** = Email addresses (Cloudflare Email Routing migration)
- **G** = Firebase project IDs (DO NOT RENAME — preserve)

---

## Category A — Code

### `firebase/functions/emails.js` (30 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| emails.js:2 | `Restaurant Oracle — Transactional Email` | A | file-header comment |
| emails.js:20 | `Restaurant Oracle <noreply@restaurantoracle.com>` | A+F | FROM_BRANDED const — display name + email |
| emails.js:21 | `support@restaurantoracle.com` | F | REPLY_TO const |
| emails.js:22 | `https://restaurantoracle.app` | E | APP_BASE_URL const |
| emails.js:23 | `support@restaurantoracle.com` | F | SUPPORT_EMAIL const |
| emails.js:138 | `Restaurant Oracle` | A | email HTML footer brand name |
| emails.js:149 | (SUPPORT_EMAIL ref) | A | email footer support link |
| emails.js:183 | `Welcome to Restaurant Oracle` | A | subject line string |
| emails.js:188 | `Restaurant Oracle account is live` | A | body prose |
| emails.js:196 | `Open Restaurant Oracle` | A | CTA button label |
| emails.js:200 | `Welcome to Restaurant Oracle` | A | plain-text version |
| emails.js:217 | `Restaurant Oracle trial converts` | A | preheader |
| emails.js:220 | `Restaurant Oracle trial ends` | A | body |
| emails.js:227 | `Restaurant Oracle trial ends in 7 days` | A | plain-text |
| emails.js:239 | `Restaurant Oracle trial ends in 2 days` | A | preheader |
| emails.js:260 | `Restaurant Oracle trial ends today` | A | preheader |
| emails.js:279 | `Receipt from Restaurant Oracle` | A | subject |
| emails.js:284 | `subscribing to Restaurant Oracle` | A | body |
| emails.js:304 | `Receipt from Restaurant Oracle` | A | plain-text |
| emails.js:346 | `Restaurant Oracle subscription is cancelled` | A | preheader |
| emails.js:349 | `Restaurant Oracle subscription` | A | body |
| emails.js:355 | `Restaurant Oracle subscription is cancelled` | A | plain-text |
| emails.js:370 | `Restaurant Oracle subscription reactivated` | A | body |
| emails.js:372 | `Open Restaurant Oracle` | A | CTA |
| emails.js:376 | `Welcome back to Restaurant Oracle` | A | plain-text |
| emails.js:385 | `Restaurant Oracle` | A | subject fallback |
| emails.js:387 | `Restaurant Oracle account` | A | preheader |
| emails.js:388 | `Restaurant Oracle` | A | heading fallback |
| emails.js:390 | `account on Restaurant Oracle` | A | body |
| emails.js:397 | `Restaurant Oracle` | A | plain-text |

### `firebase/functions/index.js` (23 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| index.js:3 | `Restaurant Oracle - Firebase Backend` | A | file-header comment |
| index.js:34 | `restaurant-oracle@%GIT_SHA%` | G | Sentry release tag — Firebase project prefix; **PRESERVE project part** |
| index.js:93 | `https://restaurant-oracle.web.app` | G | CORS allowlist — Firebase hosting URL; **PRESERVE** |
| index.js:94 | `https://restaurant-oracle.firebaseapp.com` | G | CORS allowlist — Firebase hosting URL; **PRESERVE** |
| index.js:100 | `https://restaurantoracle.app` | E | CORS allowlist — custom domain |
| index.js:101 | `https://admin.restaurantoracle.app` | E | CORS allowlist |
| index.js:104 | `restaurantoracle.app` | E | CORS regex comment |
| index.js:107 | `restaurantoracle\.app` | E | CORS regex pattern |
| index.js:121 | `projectId: 'restaurant-oracle'` | G | Firebase Admin init; **PRESERVE** |
| index.js:696 | `support@restaurantoracle.com` | F | suspended-account error message |
| index.js:753 | `https://restaurant-oracle.web.app` | G | welcome email URL; **PRESERVE** (until custom domain set) |
| index.js:852 | `Restaurant Oracle` | A | Gemini system-prompt voice assistant name |
| index.js:1268 | `slug.restaurantoracle.app` | E | provisioned app URL template |
| index.js:1352 | `invoices.restaurantoracle.app` | E | invoice email domain |
| index.js:1380 | `invoices.restaurantoracle.app` | E | invoice email domain |
| index.js:1687 | `restaurantoracle.app family` | A | comment |
| index.js:1893 | `Restaurant Oracle — {PLAN}` | A | Square invoice note |
| index.js:2041 | `restaurantoracle.app/user/${slug}` | E | provisioned URL in email |
| index.js:2260 | `restaurant-oracle.cloudfunctions.net/squareWebhook` | G | Square webhook URL; **PRESERVE** |
| index.js:2659 | `https://restaurantoracle.app/` | E | PostHog event URL |
| index.js:2671 | `Restaurant Oracle` | A | tenant name fallback |
| index.js:2795 | `support@restaurantoracle.com` | F | suspended-account error |
| index.js:5291 | `https://restaurantoracle.app/app/` | E | setup link |

### `firebase/functions/invoices.js` (6 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| invoices.js:8 | `invoices.restaurantoracle.app` | E | comment — SendGrid MX record subdomain |
| invoices.js:9 | `invoices.restaurantoracle.app` | E | comment |
| invoices.js:18 | `invoices.restaurantoracle.app` | E | comment |
| invoices.js:98 | `invoices.restaurantoracle.app` | E | comment |
| invoices.js:99 | `invoices.restaurantoracle.app` | E | comment |
| invoices.js:100 | `invoices\.restaurantoracle\.app` | E | regex pattern for parsing inbound email |

### `firebase/functions/agents.js` (1 hit)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| agents.js:2 | `Restaurant Oracle SaaS` | A | file-header comment |

### `firebase/functions/square.js` (1 hit)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| square.js:2 | `Restaurant Oracle` | A | file-header comment |

### `firebase/functions/_e2e_security.js` (7 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| _e2e_security.js:7 | `projectId: 'restaurant-oracle'` | G | Firebase Admin init; **PRESERVE** |
| _e2e_security.js:13 | `restaurant-oracle.cloudfunctions.net/adminBilling` | G | test URL; **PRESERVE** |
| _e2e_security.js:14 | `restaurant-oracle.cloudfunctions.net/superAdmin` | G | test URL; **PRESERVE** |
| _e2e_security.js:16 | `@restaurant-oracle.test` | A | fake test email domain — rename to `@bistrosteward.test` |
| _e2e_security.js:32 | `https://restaurant-oracle.web.app` | G | Origin header; **PRESERVE** |
| _e2e_security.js:54 | `@restaurant-oracle.test` | A | fake test email |
| _e2e_security.js:105 | `https://restaurant-oracle.web.app` | G | Origin header; **PRESERVE** |

### `firebase/functions/_e2e_super_admin.js` (5 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| _e2e_super_admin.js:9 | `projectId: 'restaurant-oracle'` | G | **PRESERVE** |
| _e2e_super_admin.js:15 | `restaurant-oracle.cloudfunctions.net/superAdmin` | G | **PRESERVE** |
| _e2e_super_admin.js:16 | `@restaurant-oracle.test` | A | fake test email |
| _e2e_super_admin.js:38 | `https://restaurant-oracle.web.app` | G | Origin header; **PRESERVE** |
| _e2e_super_admin.js:95 | `@restaurant-oracle.test` | A | fake test email |

### `firebase/functions/_e2e_agents.js` (1 hit)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| _e2e_agents.js:9 | `projectId: 'restaurant-oracle'` | G | **PRESERVE** |

### `firebase/functions/_grant_super_admin.js` (1 hit)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| _grant_super_admin.js:6 | `projectId: 'restaurant-oracle'` | G | **PRESERVE** |

### `firebase/functions/_inspect_tenant.js` (1 hit)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| _inspect_tenant.js:6 | `projectId: 'restaurant-oracle'` | G | **PRESERVE** |

### `firebase/functions/_find_super_admins.js` (1 hit)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| _find_super_admins.js:6 | `projectId: 'restaurant-oracle'` | G | **PRESERVE** |

### `firebase/functions/_mint_token.js` (1 hit)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| _mint_token.js:9 | `projectId: 'restaurant-oracle'` | G | **PRESERVE** |

### `firebase/functions/_cleanup_test_tenant.js` (1 hit)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| _cleanup_test_tenant.js:16 | `projectId: 'restaurant-oracle'` | G | **PRESERVE** |

### `firebase/public/index.html` (15 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| index.html:6 | `Restaurant Oracle — Kitchen management...` | A | `<title>` |
| index.html:10 | `Restaurant Oracle is the kitchen operating system` | A | meta description |
| index.html:13 | `Restaurant Oracle — Kitchen management for modern restaurants` | A | og:title |
| index.html:16 | `https://restaurantoracle.app/` | E | og:url |
| index.html:17 | `https://restaurantoracle.app/icon.png` | E | og:image |
| index.html:20 | `https://restaurantoracle.app/` | E | canonical |
| index.html:245 | `Restaurant Oracle` | A | nav logo text |
| index.html:261 | `Restaurant Oracle is the kitchen operating system` | A | hero subtitle |
| index.html:275 | `restaurantoracle.app / recipes` | E | mock URL in screenshot |
| index.html:509 | `Restaurant Oracle` | A | FAQ prose |
| index.html:511 | `Restaurant Oracle` | A | FAQ answer |
| index.html:535 | `support@restaurantoracle.com` | F | support email link |
| index.html:577 | `Restaurant Oracle` | A | footer logo |
| index.html:592 | `support@restaurantoracle.com` | F | footer link |
| index.html:601 | `© 2026 Restaurant Oracle` | A | copyright |

### `firebase/public/app.html` (10 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| app.html:6 | `<title>Restaurant Oracle</title>` | A | page title |
| app.html:33 | `Restaurant Oracle` | A | apple-mobile-web-app-title meta |
| app.html:35 | `Restaurant Oracle` | A | application-name meta |
| app.html:406 | `Restaurant Oracle` | A | login logo alt text |
| app.html:407 | `Restaurant Oracle` | A | login title div |
| app.html:480 | `Restaurant Oracle` | A | top status bar text |
| app.html:1106 | `restaurant-oracle.cloudfunctions.net/adminBilling` | G | ADMIN_BILLING_ENDPOINT; **PRESERVE** |
| app.html:1166 | `Welcome to Restaurant Oracle` | A | onboarding modal title |
| app.html:8213 | `restaurant-oracle-backup-` | G | backup filename — contains proj ID; consider renaming to `bistrosteward-backup-` |
| app.html:9552 | `Restaurant Oracle - Inventory Count Sheet` | A | print footer |

### `firebase/public/signup.html` (21 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| signup.html:6 | `Sign up — Restaurant Oracle` | A | `<title>` |
| signup.html:14 | `Restaurant Oracle — smart kitchen management` | A | meta description |
| signup.html:547 | `Restaurant Oracle` | A | hero title |
| signup.html:559 | `The Restaurant Oracle Loop` | A | section label |
| signup.html:562 | `Restaurant Oracle connects` | A | hero body |
| signup.html:571 | `Restaurant Oracle` | A | oracle-hub-img alt |
| signup.html:698 | `Restaurant Oracle` (×9 mock-topbar instances) | A | mock-topbar title in feature slides |
| signup.html:991 | `Restaurant Oracle · restaurantoracle.app` | A+E | mock-topbar |
| signup.html:1022 | `Restaurant Oracle` | A | slide body prose |
| signup.html:1187 | `Welcome to Restaurant Oracle` | A | done-title |
| signup.html:1194 | `Restaurant Oracle — Public Signup` | A | file-header comment |
| signup.html:1212 | `restaurant-oracle.cloudfunctions.net/signupTenant` | G | SIGNUP_ENDPOINT; **PRESERVE** |
| signup.html:1431 | `Restaurant Oracle workspace for ...` | A | success message string |

### `firebase/public/admin.html` (5 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| admin.html:6 | `Billing & Account — Restaurant Oracle` | A | `<title>` |
| admin.html:148 | `Restaurant Oracle` | A | brand-title default (overwritten by JS) |
| admin.html:239 | `Restaurant Oracle · Owner Console` | A | footer |
| admin.html:260 | `restaurant-oracle.cloudfunctions.net/adminBilling` | G | ADMIN_ENDPOINT; **PRESERVE** |
| admin.html:351 | `'Restaurant Oracle'` | A | JS fallback for brand name |

### `firebase/public/super-admin.html` (5 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| super-admin.html:6 | `Operator Console — Restaurant Oracle` | A | `<title>` |
| super-admin.html:216 | `Restaurant Oracle` | A | img alt |
| super-admin.html:410 | `email@restaurantoracle.com` | A | input placeholder |
| super-admin.html:594 | `Operator Console — Restaurant Oracle` | A | comment |
| super-admin.html:602 | `restaurant-oracle.cloudfunctions.net/superAdmin` | G | SUPER_ENDPOINT; **PRESERVE** |

### `firebase/public/terms.html` (13 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| terms.html:6 | `Terms of Service — Restaurant Oracle` | A | `<title>` |
| terms.html:10 | `Terms of Service for Restaurant Oracle` | A | meta description |
| terms.html:54 | `Restaurant Oracle` | A | hero-logo alt |
| terms.html:56 | `Restaurant Oracle` | A | hero-sub div |
| terms.html:62 | `Restaurant Oracle` (×2) | A | legal prose — service name |
| terms.html:65 | `Restaurant Oracle` | A | legal prose |
| terms.html:73 | `support@restaurantoracle.com` | F | legal contact email |
| terms.html:86 | `support@restaurantoracle.com` | F | cancellation email |
| terms.html:105 | `support@restaurantoracle.com` | F | deletion request email |
| terms.html:110 | `Restaurant Oracle` | A | IP ownership clause |
| terms.html:119 | `Restaurant Oracle` | A | liability clause |
| terms.html:122 | `Restaurant Oracle` | A | indemnification clause |
| terms.html:137 | `support@restaurantoracle.com` | F | contact section |

### `firebase/public/privacy.html` (10 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| privacy.html:6 | `Privacy Policy — Restaurant Oracle` | A | `<title>` |
| privacy.html:10 | `Privacy Policy for Restaurant Oracle` | A | meta description |
| privacy.html:58 | `Restaurant Oracle` | A | hero-logo alt |
| privacy.html:60 | `Restaurant Oracle` | A | hero-sub div |
| privacy.html:66 | `Restaurant Oracle` (×2) | A | legal prose |
| privacy.html:145 | `privacy@restaurantoracle.com` | F | rights-request email |
| privacy.html:169 | `Restaurant Oracle page` | A | opt-out prose |
| privacy.html:170 | `privacy@restaurantoracle.com` | F | PostHog erasure email |
| privacy.html:180 | `privacy@restaurantoracle.com` | F | contact section |
| privacy.html:181 | `support@restaurantoracle.com` | F | contact section |

### `firebase/public/sentry-init.js` (2 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| sentry-init.js:28 | `restaurantoracle.app` | E | env-detect hostname check |
| sentry-init.js:43 | `restaurant-oracle@%GIT_SHA%` | G | Sentry release tag — project prefix; **PRESERVE project part** |

### `firebase/public/firebase-config.js` (4 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| firebase-config.js:15 | `authDomain: "restaurant-oracle.firebaseapp.com"` | G | **PRESERVE** |
| firebase-config.js:16 | `projectId: "restaurant-oracle"` | G | **PRESERVE** |
| firebase-config.js:17 | `storageBucket: "restaurant-oracle.firebasestorage.app"` | G | **PRESERVE** |
| firebase-config.js:24 | `CLOUD_FUNCTION_URL = "https://us-central1-restaurant-oracle.cloudfunctions.net/api"` | G | **PRESERVE** |

### `firebase-config.js` (root) (4 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| firebase-config.js:15–17,24 | same as above | G | **PRESERVE** |

### `index.html` (root / Backup copy) (10 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| index.html:6 | `<title>Restaurant Oracle</title>` | A | page title |
| index.html:24 | `Restaurant Oracle` | A | apple-mobile-web-app-title |
| index.html:26 | `Restaurant Oracle` | A | application-name |
| index.html:332 | `Restaurant Oracle` | A | login-logo alt |
| index.html:333 | `Restaurant Oracle` | A | login-title div |
| index.html:404 | `Restaurant Oracle` | A | status bar text |
| index.html:828 | `restaurant-oracle.cloudfunctions.net/adminBilling` | G | ADMIN_BILLING_ENDPOINT; **PRESERVE** |
| index.html:877 | `Welcome to Restaurant Oracle` | A | onboarding modal |
| index.html:7889 | `restaurant-oracle-backup-` | G | backup filename; consider rename |
| index.html:9224 | `Restaurant Oracle - Inventory Count Sheet` | A | print footer |

### `cleanup-root-collections.js` (2 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| cleanup-root-collections.js:77 | `projectId: 'restaurant-oracle'` | G | **PRESERVE** |
| cleanup-root-collections.js:133 | `Restaurant Oracle — Root Collection Cleanup` | A | console log |

### `migrate-to-multitenant.js` (3 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| migrate-to-multitenant.js:88 | `projectId: 'restaurant-oracle'` | G | **PRESERVE** |
| migrate-to-multitenant.js:236 | `Restaurant Oracle — Multi-Tenant Migration` | A | console log |
| migrate-to-multitenant.js:262 | `lachona.restaurantoracle.app` | E | verification instructions |

### `scripts/create-square-plans.js` (5 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| create-square-plans.js:5 | `Restaurant Oracle subscription plans` | A | comment |
| create-square-plans.js:46 | `Restaurant Oracle — Starter` | A | Square plan name |
| create-square-plans.js:53 | `Restaurant Oracle — Pro` | A | Square plan name |
| create-square-plans.js:60 | `Restaurant Oracle — Scale` | A | Square plan name |
| create-square-plans.js:141 | `Restaurant Oracle — Square Plan Bootstrap` | A | console log |

### `scripts/register-square-webhook.js` (6 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| register-square-webhook.js:16 | `--project=restaurant-oracle` | G | shell comment example; **PRESERVE** |
| register-square-webhook.js:20 | `--project=restaurant-oracle` | G | shell comment example; **PRESERVE** |
| register-square-webhook.js:31 | `restaurant-oracle.cloudfunctions.net/squareWebhook` | G | webhook URL; **PRESERVE** |
| register-square-webhook.js:81 | `Restaurant Oracle — Subscription Lifecycle` | A | Square webhook name |
| register-square-webhook.js:98 | `Restaurant Oracle — Square Webhook Registration` | A | console log |
| register-square-webhook.js:138 | `--project=restaurant-oracle` | G | printed output; **PRESERVE** |

### `scripts/seed-price-history.js` (2 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| seed-price-history.js:3 | `Restaurant Oracle` | A | file-header comment |
| seed-price-history.js:71 | `projectId: 'restaurant-oracle'` | G | **PRESERVE** |

### `Restaurant_Oracle_Architecture.html` (6 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| *.html:6 | `Restaurant Oracle — Technical Architecture` | A | `<title>` |
| *.html:871 | `Restaurant Oracle` | A | h1 |
| *.html:894 | `Restaurant Oracle platform` | A | prose |
| *.html:938 | `Restaurant Oracle is a vanilla JS PWA` | A | prose |
| *.html:1024 | `Restaurant Oracle PWA` | A | prose |
| *.html:1986 | `Restaurant Oracle Architecture & Optimization Report` | A | footer |

### `SaaS-Build-Timeline.html` (40 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| *.html:6 | `Restaurant Oracle — 30-Day Build Timeline` | A | `<title>` |
| *.html:353 | `Restaurant Oracle SaaS` | A | eyebrow |
| *.html:498–504 | `restaurantoracle.app` (×5) | E | DNS/hosting setup steps |
| *.html:509 | `test.restaurantoracle.app` | E | deliverable text |
| *.html:529 | `restaurantoracle` bare slug check | A | code snippet |
| *.html:530,534,543 | `restaurantoracle.app` | E | subdomain URLs |
| *.html:606 | `Restaurant Oracle kitchen is ready` + `slug.restaurantoracle.app` | A+E | email subject + URL |
| *.html:613 | `restaurantoracle.app` | E | deliverable |
| *.html:627–656 | `restaurantoracle.app` (×5) | E | signup/setup/landing URLs |
| *.html:660 | `restaurantoracle.app` | E | deliverable |
| *.html:738–749 | `admin.restaurantoracle.app` (×3) | E | admin subdomain |
| *.html:766 | `restaurantoracle.app?support_token` | E | impersonate URL |
| *.html:947 | `noreply@restaurantoracle.app` | F | churn-risk email |
| *.html:1008 | `Restaurant Oracle` | A | goal-box prose |
| *.html:1012 | `Restaurant Oracle logo` | A | asset instructions |
| *.html:1015 | `Restaurant Oracle` | A | iOS test step |
| *.html:1081 | `restaurant-oracle-mobile` + `app.restaurantoracle` + `Restaurant Oracle` | A+G | Capacitor CLI + appId + appName |
| *.html:1084 | `restaurantoracle://login` | E | deep link URL scheme |
| *.html:1122–1131 | `demo.restaurantoracle.app` (×3) | E | demo subdomain |
| *.html:1191 | `help.restaurantoracle.app` | E | help subdomain |
| *.html:1215 | `restaurantoracle.app` | E | DNS audit |
| *.html:1219 | `Restaurant Oracle` | A | ProductHunt title |
| *.html:1252 | `Restaurant Oracle SaaS is live` | A | milestone text |
| *.html:1299 | `restaurantoracle.app domain` | E | cost table |

### `Phase2_Plan_Summary.html` (15 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| *.html:6 | `Restaurant Oracle — Phase 2 Plan` | A | `<title>` |
| *.html:510 | `Restaurant Oracle` | A | nav-logo |
| *.html:531 | `Restaurant Oracle` | A | h1 |
| *.html:570 | `restaurantoracle.app · auto-provisioning` | E | sub |
| *.html:593 | `restaurantoracle.app/user/{slug}` | E | URL |
| *.html:696 | `restaurantoracle.app/` | E | marketing page URL |
| *.html:793 | `Restaurant Oracle` | A | prose |
| *.html:851 | `restaurantoracle.app/user/luigi` | E | example URL |
| *.html:1037 | `restaurantoracle.app domain` | E | cost line |
| *.html:1245 | `Restaurant Oracle` | A | comparison table |
| *.html:1392 | `support@restaurantoracle.app` | F | agent trigger email |
| *.html:1573 | `restaurantoracle.app` | E | SSL row |
| *.html:1639 | `restaurantoracle.app/` | E | waitlist |
| *.html:1749–1750 | `restaurantoracle.app` (×2) | E | SSL wait |

### `SaaS-Marketplace-Plan.html` (12 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| *.html:6 | `Restaurant Oracle — SaaS Marketplace Plan` | A | `<title>` |
| *.html:399 | `Restaurant Oracle` | A | nav-logo |
| *.html:415 | `Restaurant Oracle` | A | h1 |
| *.html:475 | `Restaurant Oracle` | A | prose |
| *.html:534–535 | `restaurantoracle.app` (×2) | E | example URL |
| *.html:717 | `restaurantoracle.app domain` | E | cost row |
| *.html:935 | `Restaurant Oracle` | A | comparison table |
| *.html:1094 | `restaurantoracle.app` | E | agent step |
| *.html:1189 | `support@restaurantoracle.app` | F | agent trigger |
| *.html:1423 | `restaurantoracle.app` | E | waitlist |
| *.html:1432 | `Restaurant Oracle SaaS Plan` | A | footer |

### `design-partners/03_pitch_deck.html` (4 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| pitch_deck.html:5 | `Restaurant Oracle — Design Partner Pitch` | A | `<title>` |
| pitch_deck.html:100 | `Restaurant Oracle` | A | h1 |
| pitch_deck.html:199 | `restaurantoracle.app` | E | contact line |
| pitch_deck.html:202 | `anthony@restaurantoracle.app` | F | contact email |

---

## Category B — Config

### `firebase/.firebaserc` (1 hit)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| .firebaserc:3 | `"default": "restaurant-oracle"` | G | Firebase project alias; **PRESERVE** |

### `firebase/firebase.json` (1 hit — CSP header)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| firebase.json:52 | `restaurant-oracle.cloudfunctions.net` (in CSP connect-src) | G | **PRESERVE** |
| firebase.json:52 | `restaurant-oracle.firebaseapp.com` (in CSP frame-src) | G | **PRESERVE** |
| firebase.json:52 | `*.restaurantoracle.app` (in CSP connect-src + frame-src) | E | Update to `*.bistrosteward.com` (or new domain) |

### `firebase/functions/package.json` (2 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| package.json:2 | `"name": "restaurant-oracle-functions"` | B | npm package name |
| package.json:4 | `Firebase Cloud Functions for Restaurant Oracle` | B | description |

### `manifest.json` (root) (2 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| manifest.json:2 | `"name": "Restaurant Oracle"` | B | PWA display name |
| manifest.json:5 | `"start_url": "/restaurant-oracle/"` | B | PWA start URL path |

### `firebase/public/manifest.json` (2 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| manifest.json:2 | `"name": "Restaurant Oracle"` | B | PWA display name |
| manifest.json:5 | `"start_url": "/restaurant-oracle/"` | B | PWA start URL path |

### `package.json` (root) (2 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| package.json:2 | `"name": "restaurant-oracle-migrations"` | B | npm package name |
| package.json:5 | `description: "...Restaurant Oracle"` | B | description |

### `scripts/square-plans.json` (3 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| square-plans.json:8 | `Restaurant Oracle — Starter` | B | Square plan name |
| square-plans.json:15 | `Restaurant Oracle — Pro` | B | Square plan name |
| square-plans.json:22 | `Restaurant Oracle — Scale` | B | Square plan name |

---

## Category C — Docs / MD

### `MASTER.md` (~187 hits — HIGH VOLUME)

Selected structural hits (all lines confirmed above). Categories within MASTER.md:

| type | count | examples |
|------|-------|---------|
| G (Firebase project IDs) | ~30 | `projectId: 'restaurant-oracle'`, `restaurant-oracle.web.app`, `cloudfunctions.net`, `.firebaseapp.com`, `--project restaurant-oracle` |
| E (external URLs) | ~40 | `restaurantoracle.app`, `restaurant-oracle.web.app` URLs |
| F (emails) | ~15 | `noreply@restaurantoracle.com`, `support@restaurantoracle.com`, `privacy@restaurantoracle.com`, `anthony@restaurantoracle.app`, `demo@restaurantoracle.app` |
| A (display name prose) | ~100 | `Restaurant Oracle`, `Welcome to Restaurant Oracle`, etc. |
| special | 1 | `MASTER.md:9480` — rename migration plan already drafted in MASTER.md |
| special | 1 | `MASTER.md:9518` — explicit note: "Project ID `restaurant-oracle-*` STAYS unchanged" |

> **Note:** MASTER.md is a documentation archive. Replace display-name prose (A) and external URLs (E/F). Leave all G references per MASTER.md:9518 instruction.

### `README.md` (1 hit)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| README.md:1 | `# restaurant-oracle` | C | repo title heading |

### `SECURITY.md` (1 hit)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| SECURITY.md:1 | `# Security Architecture - Restaurant Oracle` | C | doc title |

### `docs/plans/2026-04-24-youtube-tutorials.md` (22 hits)
| file:line | exact match | cat | notes |
|-----------|-------------|-----|-------|
| *.md:1 | `Restaurant Oracle YouTube Tutorial Series` | C | title |
| *.md:5 | `Restaurant Oracle` | C | prose |
| multiple | `Restaurant Oracle` (display name) | C | tutorial script text |
| multiple | `restaurantoracle.app` | E | URLs in instructions |
| multiple | `demo@restaurantoracle.app` | F | demo tenant email |
| *.md:640 | `projectId: 'restaurant-oracle-prod'` | G | code snippet; **PRESERVE** |
| *.md:741 | `restaurant-oracle-prod` | G | gcloud project ref; **PRESERVE** |

---

## Category D — Assets (filenames)

| path | match | notes |
|------|-------|-------|
| `./Restaurant_Oracle_Template.xlsx` | `Restaurant_Oracle` | Rename file to `Bistro_Steward_Template.xlsx` |
| `./Backup/Restaurant_Oracle_Template.xlsx` | `Restaurant_Oracle` | Rename file |
| `./Restaurant-Oracle-Last/` | `Restaurant-Oracle` | Directory name — rename to `Bistro-Steward-Last/` |
| `./Backup/Restaurant-Oracle-Last/` | `Restaurant-Oracle` | Directory name |
| `./Restaurant_Oracle_Architecture.html` | `Restaurant_Oracle` | Rename file to `Bistro_Steward_Architecture.html` |

---

## Category E — External-URL Refs (need 301 redirect, not in-place rename)

All `restaurantoracle.app` and `restaurant-oracle.web.app` URLs in code are replaced with new domain in code, **AND** require DNS/Cloudflare redirect setup:

| current domain | new domain | redirect type |
|----------------|------------|---------------|
| `restaurantoracle.app` | `bistrosteward.com` (or chosen domain) | 301 permanent |
| `*.restaurantoracle.app` | `*.bistrosteward.com` | wildcard 301 |
| `invoices.restaurantoracle.app` | `invoices.bistrosteward.com` | MX + 301 |
| `restaurant-oracle.web.app` | Firebase fallback — keep as-is | **PRESERVE** (Firebase cannot redirect) |
| `restaurant-oracle.firebaseapp.com` | Firebase fallback — keep as-is | **PRESERVE** |

> `restaurant-oracle.web.app` and `restaurant-oracle.firebaseapp.com` are Firebase-generated; cannot be renamed. They stay as fallback/legacy-auth authorized domains. No redirect needed — they silently continue to work.

---

## Category F — Email Addresses (Cloudflare Email Routing migration)

| old address | new address | files containing it |
|-------------|-------------|---------------------|
| `noreply@restaurantoracle.com` | `noreply@bistrosteward.com` | emails.js:20, MASTER.md:969,2686 |
| `support@restaurantoracle.com` | `support@bistrosteward.com` | emails.js:21,23, index.js:696,2795, index.html:535,592, terms.html:73,86,105,137, privacy.html:181, super-admin.html:410 |
| `privacy@restaurantoracle.com` | `privacy@bistrosteward.com` | privacy.html:145,170,180, MASTER.md:2983 |
| `reviewer@restaurantoracle.com` | `reviewer@bistrosteward.com` | MASTER.md:2005,2361 |
| `support@restaurantoracle.app` | `support@bistrosteward.com` | Phase2_Plan_Summary.html:1392, SaaS-Marketplace-Plan.html:1189 |
| `noreply@restaurantoracle.app` | `noreply@bistrosteward.com` | SaaS-Build-Timeline.html:947 |
| `anthony@restaurantoracle.app` | `anthony@bistrosteward.com` | design-partners/03_pitch_deck.html:202, MASTER.md:9106 |
| `demo@restaurantoracle.app` | `demo@bistrosteward.com` | MASTER.md:6259,6296,6460,6878, docs/plans/2026-04-24-youtube-tutorials.md:26,63,227,645 |
| `<token>@invoices.restaurantoracle.app` | `<token>@invoices.bistrosteward.com` | invoices.js (regex), index.js:1352,1380, MASTER.md multiple |

> Migration: Set up Cloudflare Email Routing for `bistrosteward.com` to receive all aliases above → forward to `grandma.chona@gmail.com`. Keep `restaurantoracle.com` and `restaurantoracle.app` routing active for ≥90 days as catch-all forwarding.

---

## Category G — Firebase Project IDs (PRESERVE — DO NOT RENAME)

Per `MASTER.md:9518`: "Project ID `restaurant-oracle-*` STAYS unchanged (rename = downtime + auth invalidation). Display strings + project alias only."

| identifier | where | preserve reason |
|-----------|-------|-----------------|
| `restaurant-oracle` (projectId) | firebase-config.js, firebase/public/firebase-config.js, firebase/.firebaserc, all admin scripts | Firebase project cannot be renamed |
| `restaurant-oracle.firebaseapp.com` | firebase-config.js, CSP, CORS | Firebase-generated auth domain |
| `restaurant-oracle.web.app` | CORS allowlist, e2e tests | Firebase-generated hosting fallback |
| `restaurant-oracle.firebasestorage.app` | firebase-config.js | Firebase-generated storage URL |
| `us-central1-restaurant-oracle.cloudfunctions.net` | all CF endpoint vars | Firebase-generated CF URL |
| `restaurant-oracle@%GIT_SHA%` | Sentry release tag | prefix = project name; update display-name portion only when Sentry org is renamed |
| `restaurant-oracle-functions` (npm name) | firebase/functions/package.json | Internal; rename is low-risk but not required |
| `restaurant-oracle-prod`, `restaurant-oracle-backtest` | docs + scripts | Fictional/test project IDs; rename in docs prose only |

---

## Top 10 Files by Hit Count

| rank | file | hits (all patterns) |
|------|------|---------------------|
| 1 | `MASTER.md` | 187 |
| 2 | `SaaS-Build-Timeline.html` | 40 |
| 3 | `firebase/functions/emails.js` | 30 |
| 4 | `firebase/functions/index.js` | 23 |
| 5 | `docs/plans/2026-04-24-youtube-tutorials.md` | 22 |
| 6 | `firebase/public/signup.html` | 21 |
| 7 | `firebase/public/index.html` | 15 |
| 8 | `Phase2_Plan_Summary.html` | 15 |
| 9 | `firebase/public/terms.html` | 13 |
| 10 | `SaaS-Marketplace-Plan.html` | 12 |

---

## Complete File List (46 files touched)

```
cleanup-root-collections.js
design-partners/03_pitch_deck.html
docs/plans/2026-04-24-youtube-tutorials.md
firebase-config.js
firebase/.firebaserc
firebase/firebase.json
firebase/functions/_cleanup_test_tenant.js
firebase/functions/_e2e_agents.js
firebase/functions/_e2e_security.js
firebase/functions/_e2e_super_admin.js
firebase/functions/_find_super_admins.js
firebase/functions/_grant_super_admin.js
firebase/functions/_inspect_tenant.js
firebase/functions/_mint_token.js
firebase/functions/agents.js
firebase/functions/emails.js
firebase/functions/index.js
firebase/functions/invoices.js
firebase/functions/package.json
firebase/functions/package-lock.json      ← excluded from search but will be regenerated
firebase/functions/square.js
firebase/public/admin.html
firebase/public/app.html
firebase/public/firebase-config.js
firebase/public/index.html
firebase/public/manifest.json
firebase/public/privacy.html
firebase/public/sentry-init.js
firebase/public/signup.html
firebase/public/super-admin.html
firebase/public/terms.html
index.html                                ← root (old monolith / Backup copy)
manifest.json                             ← root
MASTER.md
migrate-to-multitenant.js
package.json
package-lock.json                         ← excluded from search; regenerate after package.json rename
Phase2_Plan_Summary.html
README.md
Restaurant_Oracle_Architecture.html      ← also needs file rename
SECURITY.md
SaaS-Build-Timeline.html
SaaS-Marketplace-Plan.html
scripts/create-square-plans.js
scripts/register-square-webhook.js
scripts/seed-price-history.js
scripts/square-plans.json
```
**Asset renames (files/dirs):**
```
./Restaurant_Oracle_Template.xlsx         → Bistro_Steward_Template.xlsx
./Backup/Restaurant_Oracle_Template.xlsx  → Bistro_Steward_Template.xlsx
./Restaurant-Oracle-Last/                 → Bistro-Steward-Last/
./Backup/Restaurant-Oracle-Last/          → Bistro-Steward-Last/
./Restaurant_Oracle_Architecture.html     → Bistro_Steward_Architecture.html
```

---

## Summary

| metric | value |
|--------|-------|
| Total files with ≥1 hit | 46 |
| Total hit lines (all patterns, incl. package-lock) | ~560 |
| Patterns with 0 hits | P5 (`restaurant_oracle`), P7 (`RESTAURANT_ORACLE`) |
| High-volume files (>100 hits) | MASTER.md (187), SaaS-Build-Timeline.html (40 — pattern-level ×3) |
| Firebase project ID refs (G — preserve) | ~55 lines across 20+ files |
| Email addresses to migrate (F) | 9 distinct addresses |
| External URL refs needing 301 (E) | ~90 lines; 3 distinct domains |
| Asset file/dir renames (D) | 5 |
| Code display-name replacements (A) | ~300 lines |
| Config replacements (B) | ~11 lines |
| Doc replacements (C) | ~200 lines (MASTER.md bulk) |
