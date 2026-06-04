# Bistro Steward — Launch Kit Setup (domain, email, website)

**Generated 2026-06-01.** What you need to turn Bistro Steward into a real branded product, what already exists, and exact steps. Tags: **[YOU]** = needs your account/payment (I can't do it); **[I DO]** = I'll handle it once the prerequisite is met.

---

## A. What you ALREADY have ✅
- **Live app + backend** on Firebase: `https://restaurant-oracle.web.app` (app, signup, billing, super-admin, privacy, terms).
- **Apple Developer account** (team `CT2U4HUZJ2`) — paid, app already ran on your iPhone.
- **Square** (billing), **PostHog** (analytics), **Sentry** (crashes), **Gemini** (AI) — all wired.
- **Apple demo account** for App Review — done this session.
- Marketing landing, `/privacy`, `/terms`, `/signup` — all live (on the `web.app` URL).

## B. What's MISSING (the "kit") ❌
1. **Domain** — `bistrosteward.com` is **unregistered** (confirmed). The name only exists hardcoded in the app.
2. **Website on your own domain** — site only lives at `restaurant-oracle.web.app`; no custom domain attached.
3. **Email** — `support@ / privacy@ / hello@bistrosteward.com` don't exist (domain unregistered → mail bounces).
4. **App wired to the new domain** — Firebase `authorizedDomains` still points at the OLD brand (`restaurantoracle.app`), not Bistro Steward.
5. **App Store Connect record + screenshots + submit** (separate ship-list items #2/#3/#6).

---

## C. CHOICES LOCKED (2026-06-01)
- **Registrar + DNS:** **Cloudflare — your EXISTING account** (skip account creation).
- **Domain:** **`bistrosteward.com`** only.
- **Email:** **Google Workspace** ($6/mo) — real send + receive mailbox. (Cloudflare Email Routing NOT used — Workspace owns the MX.)
- **Website host:** **Firebase Hosting** (free) — attach the domain.

**Total new cost:** ~$12/yr (domain) + $6/mo (Workspace) ≈ $84/yr.

> **✅ Already done by me:** `bistrosteward.com` + `www.bistrosteward.com` added to Firebase **authorizedDomains** (OAuth will work the moment the domain is live). CSP uses `default-src 'self'`, which adapts to the new host — no CSP change needed.

---

## D. Step-by-step

### STEP 1 — Register the domain  **[YOU — payment, I can't]** · ~3 min · ~$10.44
1. Log into your existing account at **https://dash.cloudflare.com**.
2. Left sidebar → **"Domain Registration" → "Register Domains"**.
3. Search `bistrosteward.com` → **Purchase** (~$10.44/yr at-cost). **Turn ON auto-renew.**
4. ✅ It appears under **Websites**, on Cloudflare nameservers automatically.

> This is the only payment step for the domain. Tell me when it's done and I take it from there.

### STEP 2 — Point the domain at the website (Firebase Hosting)  **[YOU click + I DO records]** · ~15 min + propagation
1. **[I DO]** I add `bistrosteward.com` + `www.bistrosteward.com` to the Firebase Hosting site `restaurant-oracle` (via CLI/API). Firebase then issues **a TXT verification record + two A records** unique to your domain.
2. **[YOU]** In Cloudflare → your domain → **DNS → Records**, add exactly the records I give you:
   - TXT record (domain ownership verification)
   - Two A records on `@` (root) → the Firebase IPs shown
   - CNAME `www` → as Firebase specifies
   - **Set these DNS records to "DNS only" (grey cloud), NOT proxied (orange)** while Firebase provisions the SSL cert — proxying breaks the cert challenge. You can re-enable proxy after it's "Connected."
3. **[I DO]** Verify propagation + confirm Firebase shows the domain **"Connected"** with a valid SSL cert (auto, free; can take 15 min–24 h).
4. ✅ `https://bistrosteward.com` and `https://bistrosteward.com/app` now serve the same site.

### STEP 3 — Email: Google Workspace  **[YOU create+pay, I give records]** · ~20 min · $6/mo
1. Go to **https://workspace.google.com** → **Start free trial** (14-day trial, then $6/user/mo Business Starter).
2. Enter business name **Bistro Steward**, region, team size **1**.
3. When asked about a domain, choose **"Yes, I have one"** and enter **`bistrosteward.com`**.
4. Create your admin user, e.g. **`anthony@bistrosteward.com`** (or `admin@`), set a password. This is your real mailbox.
5. Google shows a **TXT verification record** + **MX records**. **[YOU paste in Cloudflare DNS]** (Cloudflare → bistrosteward.com → DNS → Records):
   - **TXT** `@` → the `google-site-verification=...` value Google shows (verifies ownership)
   - **MX** `@` → `smtp.google.com` priority `1` (modern single-MX Google setup). *If Google's wizard shows the 5 legacy MX (ASPMX.L.GOOGLE.COM pri 1, ALT1/ALT2 pri 5, ALT3/ALT4 pri 10), use exactly those instead.*
   - **TXT (SPF)** `@` → `v=spf1 include:_spf.google.com ~all`
   - **DKIM**: after setup, Admin console → Apps → Google Workspace → Gmail → **Authenticate email** → generate key → add the **TXT** `google._domainkey` it gives.
   - Set these DNS records to **"DNS only" (grey cloud)** in Cloudflare.
6. Back in Workspace setup, click **Verify / Activate Gmail**.
7. In the Workspace Admin console (admin.google.com) → **Users / Groups**, add the role addresses (free as aliases or groups):
   - `support@bistrosteward.com`, `privacy@bistrosteward.com`, `hello@bistrosteward.com` → as **aliases** of your admin user, or as **Groups** pointing to you.
8. ✅ You can now send AND receive as `support@bistrosteward.com` etc.

> ⚠️ Don't also enable Cloudflare Email Routing — two MX setups conflict. Workspace owns the MX.

### STEP 4 — Wire the app to the new domain  **[I DO]** · after Step 2 is "Connected"
- ✅ **Done already:** `bistrosteward.com` + `www` added to Firebase **authorizedDomains** (kept the live `restaurantoracle.app`). CSP is `default-src 'self'` → adapts to the new host, no change needed.
- Once live I'll also: confirm `manifest.json`, `og:image`, signup/billing redirects resolve on the new host; switch the **App Store listing URLs** in `App-Store-Submission.md` to `bistrosteward.com`.
- (Optional, needs a native rebuild) repoint the **iOS app** `server.url` → `bistrosteward.com/app`. Not required — `web.app` keeps working.

### STEP 5 — Finish the App Store  (ship-list #2/#3/#6)
- **[I DO]** Capture screenshots (6.9" + 6.7") from the demo login.
- **[YOU]** Create the App Store Connect record (`com.bistrosteward.app`), paste the copy/privacy/review-notes from `App-Store-Submission.md`.
- **[YOU + I]** Archive Release build, upload via Xcode/Transporter, submit. I prep the build commands; you click submit in Xcode/ASC.

---

## E. Do-it order (fastest path to submittable)
**YOUR moves (payment/accounts — only you can):**
1. **Step 1** — register `bistrosteward.com` in your Cloudflare account (~3 min, ~$10).
2. **Step 3** — start Google Workspace, paste the Workspace TXT+MX into Cloudflare DNS (~20 min).

**Then ping me — I do the rest:**
3. **Step 2** — attach the domain to Firebase Hosting, hand you the exact A+TXT records to paste (or, if you make me a Cloudflare API token, I paste them).
4. **Step 4** — verify SSL "Connected", switch listing URLs (authorizedDomains already done ✅).
5. **Step 5** — screenshots + you create the ASC record + submit.

> Want me to skip handing you DNS records and do it directly? Create a **Cloudflare API token** (dash → My Profile → API Tokens → Edit zone DNS for bistrosteward.com) and give it to me — then I add every DNS record (Firebase + Workspace) via API myself.
