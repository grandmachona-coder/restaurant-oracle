# Email Infrastructure Setup — Bistro Steward

This is the production setup for outbound transactional email (Resend), inbound
invoice parsing (SendGrid Inbound Parse), and team mailboxes (`support@` and
`noreply@` on `bistrosteward.com`).

> **Status check (2026-05-08):** `bistrosteward.com` is **NXDOMAIN** — not yet
> registered. Step 0 must be done first.

Total time end-to-end: ~90 min (most of it waiting for DNS propagation).
Total cost: ~$15/yr (domain) + Resend free tier (3k emails/mo) + SendGrid free
tier (100 inbound parses/day) + Google Workspace optional (~$7.20/user/mo).

---

## Step 0 — Register the domain (10 min, ~$12-15/yr)

`bistrosteward.com` does not currently resolve. Buy it before anything else.

1. Open https://www.namecheap.com/domains/registration/results/?domain=bistrosteward.com
   (or Cloudflare Registrar at https://dash.cloudflare.com/?to=/:account/domains/register/bistrosteward.com — Cloudflare is at-cost, ~$10/yr).
2. Add `bistrosteward.com` to cart, complete purchase. Enable WHOIS privacy.
3. Once registered, you'll have a DNS panel (Namecheap → "Advanced DNS",
   Cloudflare → "DNS / Records"). All later steps add records here.
4. Verify with `dig bistrosteward.com NS +short` — should return your registrar's
   nameservers within ~5 min.

**If you already own the domain through a different registrar:** skip this step
and use your existing DNS panel.

---

## Step 1 — Resend account + domain verification (15 min)

Resend is the outbound transactional email provider (already wired in
[firebase/functions/emails.js](../firebase/functions/emails.js) — 9 templates:
owner welcome, trial reminders, payment receipts, payment failed,
subscription cancelled / reactivated, team invite).

### 1a. Create the account

1. Go to https://resend.com/signup
2. Sign up with `grandma.chona@gmail.com` (the operator account).
3. Verify the email link Resend sends.
4. You'll land on the dashboard at https://resend.com/overview.

### 1b. Add the domain

1. Click **Domains** in the left sidebar.
2. Click **Add Domain** (top right).
3. Type `bistrosteward.com` exactly. Region: leave default (Virginia).
4. Click **Add**.
5. Resend will display **a list of DNS records** (MX, TXT for SPF, TXT for DKIM,
   TXT for DMARC). Leave this tab open — you'll copy/paste each one.

### 1c. Add the Resend DNS records to your registrar

In your registrar's DNS panel (Namecheap "Advanced DNS" or Cloudflare "DNS /
Records"), add **each row** Resend showed you. They will look like this
(values shown are illustrative — use the ones Resend actually generates):

| Type  | Host (Name)                            | Value                                                    | Priority | TTL  |
|-------|----------------------------------------|----------------------------------------------------------|----------|------|
| MX    | `send`                                 | `feedback-smtp.us-east-1.amazonses.com`                  | 10       | Auto |
| TXT   | `send`                                 | `v=spf1 include:amazonses.com ~all`                      | —        | Auto |
| TXT   | `resend._domainkey`                    | `p=MIGfMA0GCS...` (very long, copy verbatim)             | —        | Auto |
| TXT   | `_dmarc`                               | `v=DMARC1; p=none;`                                      | —        | Auto |

**Important rules:**
- Cloudflare hides the suffix — type `send` not `send.bistrosteward.com`.
- Namecheap also hides the suffix — same rule.
- The DKIM TXT value is one continuous string with no line breaks. Some panels
  auto-split at 255 chars; if so, accept that and they'll re-join on lookup.
- **Do NOT proxy** any of these through Cloudflare (orange cloud OFF). Click
  the cloud icon to make it grey ("DNS only").

### 1d. Verify

1. Back on Resend, click **Verify DNS Records** at the bottom of the domain
   page.
2. First attempt may show "Pending" — DNS propagation takes 5-15 min.
3. Refresh after 10 min. All four rows should turn green ✓.
4. If a row stays red, run `dig TXT send.bistrosteward.com +short` — if blank,
   the record didn't save in your panel; re-enter it.

### 1e. Generate the API key

1. In Resend, click **API Keys** → **Create API Key**.
2. Name: `bistro-steward-prod`. Permission: **Full access** (we send only).
3. Copy the value (starts with `re_…`). **You will not see it again.**
4. Save it as a Firebase Cloud Functions secret — I'll do this for you in
   step 5, not you.

---

## Step 2 — SendGrid account + Inbound Parse (15 min)

SendGrid receives invoice emails forwarded by vendors and POSTs them to our
Cloud Function `inboundInvoice`, which extracts attachments and sends them to
Gemini Vision for OCR. Per-tenant routing happens via the local-part token:
`<token>@invoices.bistrosteward.com`.

### 2a. Create the account

1. Go to https://signup.sendgrid.com/
2. Sign up with `grandma.chona@gmail.com`. Pick the **Free** plan
   (100 emails/day outbound, unlimited Inbound Parse hostnames at the lowest
   tier — we won't use outbound through SendGrid).
3. SendGrid requires a "sender identity" check. Fill the form with:
   - From name: `Bistro Steward`
   - From email: `noreply@bistrosteward.com`
   - Reply-to: `support@bistrosteward.com`
   - Address: your business address.
   - Country: United States.
4. Verify the confirmation email SendGrid sends.

### 2b. Add the inbound MX record

In your registrar's DNS panel, add **one** row:

| Type | Host (Name) | Value             | Priority | TTL  |
|------|-------------|-------------------|----------|------|
| MX   | `invoices`  | `mx.sendgrid.net` | 10       | Auto |

Same rules as above — type `invoices` not `invoices.bistrosteward.com`, and
do NOT proxy through Cloudflare.

Verify after 5-10 min:
```
dig MX invoices.bistrosteward.com +short
# Expected: 10 mx.sendgrid.net.
```

### 2c. Configure Inbound Parse

1. In SendGrid, navigate to **Settings → Inbound Parse** (left sidebar:
   gear icon → Inbound Parse). URL:
   https://app.sendgrid.com/settings/parse
2. Click **Add Host & URL**.
3. Fill in:
   - **Receiving Domain:** `invoices.bistrosteward.com`
   - **Destination URL:** `https://us-central1-restaurant-oracle.cloudfunctions.net/inboundInvoice?s=<SHARED_SECRET>` — leave the `<SHARED_SECRET>` part for now; I'll fill in the actual value in step 5.
   - **Spam Check:** ✓ checked
   - **POST the raw, full MIME message:** ✗ unchecked (we want parsed multipart)
4. Click **Add**. Done.

The integration is dormant until step 5 secrets are deployed.

---

## Step 3 — Mailboxes for `support@` and `noreply@` (20 min)

Outbound Resend sends *from* `noreply@bistrosteward.com` and uses
`support@bistrosteward.com` as the reply-to. Both addresses must be **real
mailboxes** so customer replies don't bounce.

You have three options. I recommend **Option A** — easiest, runs on Google
Workspace which you already use for `grandma.chona@gmail.com`.

### Option A — Google Workspace (recommended) — ~$7.20/user/mo, 15 min

1. Go to https://workspace.google.com/business/signup/welcome
2. Enter business name: `Bistro Steward`. Number of employees: 1 (just you).
3. Region: United States.
4. Use your existing `grandma.chona@gmail.com` as the recovery account.
5. **Domain step:** choose **"I have a domain"** → enter `bistrosteward.com`.
6. Pick the **Business Starter** plan ($7.20/user/month — 30GB storage, custom
   email).
7. Create your admin user: `support@bistrosteward.com` (this is the primary
   mailbox you'll log into).
8. Pay with a card. Trial includes 14 days free.
9. **Verify domain ownership:** Google will give you a TXT record like
   `google-site-verification=…`. Add it to your DNS panel:

   | Type | Host (Name) | Value                                | TTL  |
   |------|-------------|--------------------------------------|------|
   | TXT  | `@`         | `google-site-verification=abc123...` | Auto |

   Click **Verify** in Google Workspace setup. Should pass within 5 min.
10. **Set MX records** for `bistrosteward.com` apex (these handle inbound mail
    to `support@` and `noreply@`):

    | Type | Host (Name) | Value                  | Priority | TTL  |
    |------|-------------|------------------------|----------|------|
    | MX   | `@`         | `smtp.google.com`      | 1        | Auto |

    (Google's modern setup uses just one MX target instead of the legacy
    five — confirm with the value Google's admin console actually displays;
    use that.)
11. Add `noreply@bistrosteward.com` as an **alias** of `support@`:
    - Admin console → Directory → Users → click `support@bistrosteward.com`
      → User information → "Alternate emails" → Add → `noreply@bistrosteward.com`.
    - This means replies to `noreply@` land in the same inbox; no extra cost.
12. Wait ~10 min for MX propagation. Test by sending an email to
    `support@bistrosteward.com` from your phone — it should arrive in Gmail
    within a minute.

### Option B — Forwarding only (free, 5 min)

If $7.20/mo is too much during pre-revenue trials:

1. Cloudflare Email Routing (free) at https://dash.cloudflare.com/?to=/:account/:zone/email/routing
2. Add destination address: `grandma.chona@gmail.com` (verify via emailed
   click-through).
3. Add catch-all rule: `*@bistrosteward.com` → `grandma.chona@gmail.com`.
4. Cloudflare auto-adds the right MX records (unless you already added Google's
   in Option A — they conflict; pick one).
5. Replies will land in your Gmail; you'll just have to manually pick a from
   address when replying. Less professional, free.

### Option C — Skip both and use no-reply for real

Risky — sending from an unmonitored mailbox triggers spam filters and breaks
DMARC alignment. **Don't do this.** Pick A or B.

---

## Step 4 — DMARC tightening (after Steps 1-3 verify) — 5 min

Your initial DMARC record (`v=DMARC1; p=none;`) was permissive so DKIM/SPF
could break in without rejecting mail. After 1 week of clean sends, tighten to
quarantine, then to reject:

1. Wait 7 days after Step 1 completes. Check Resend dashboard "Logs" — confirm
   no SPF/DKIM failures.
2. In your DNS panel, edit the `_dmarc` TXT to:
   `v=DMARC1; p=quarantine; rua=mailto:support@bistrosteward.com; pct=100;`
3. Wait another 7 days. If still clean:
   `v=DMARC1; p=reject; rua=mailto:support@bistrosteward.com; pct=100;`

`p=reject` blocks anyone forging your domain in the From header.

---

## Step 5 — Firebase secrets + deploy (5 min)

This is the part **I do for you**, not you. After you've completed steps 0-3
and given me the Resend API key + the SendGrid shared secret you want to use,
I'll run:

```bash
# Set the secrets (you give me the values, I paste)
firebase functions:secrets:set RESEND_API_KEY \
  --project restaurant-oracle
firebase functions:secrets:set INVOICE_SHARED_SECRET \
  --project restaurant-oracle

# Deploy the functions that consume them
firebase deploy --only functions:inboundInvoice,functions:secureApi,functions:dailyTrialReminders \
  --project restaurant-oracle

# Update the SendGrid Inbound Parse URL with the secret
# (I'll give you the new URL to paste — only step left for you)
```

I cannot do the SendGrid URL update for you — SendGrid's Inbound Parse panel
has no public API for hostname URLs. After I generate the secret, paste the
new URL into the **Destination URL** field at
https://app.sendgrid.com/settings/parse and click Save.

---

## Step 6 — End-to-end smoke (15 min)

Once everything is deployed, run these four checks. Tell me the results — I
can debug any failure.

1. **Outbound:** trigger a trial-end-soon email by setting your test tenant's
   `trialEndsAt` to 2 days from now in Firestore.
   - Expected: Email arrives at the tenant owner's address from
     `noreply@bistrosteward.com`, reply-to `support@bistrosteward.com`.
   - Verify: clicking Reply → To: shows `support@bistrosteward.com`.

2. **Inbound:** from your phone Gmail, send a photo of a (real or printed)
   invoice as an attachment to `<your-tenant-token>@invoices.bistrosteward.com`.
   The token is on the tenant page in Settings.
   - Expected within 30s: Function logs at
     https://console.cloud.google.com/run/detail/us-central1/inboundInvoice/logs?project=restaurant-oracle
     show "parsed N attachments, dispatched to Gemini".
   - Within 90s: Firestore `tenants/<id>/invoices` collection has a new doc
     with the OCR'd JSON.

3. **DMARC:** send yourself an email from `noreply@bistrosteward.com` (you can
   trigger via Resend dashboard "Send test"). Check Gmail "Show original" →
   confirm SPF=PASS, DKIM=PASS, DMARC=PASS.

4. **Reply path:** reply to that test email. Confirm it lands in
   `support@bistrosteward.com` inbox (Google Workspace) or
   `grandma.chona@gmail.com` (Cloudflare forwarding).

---

## Gotchas

- **DNS panels swallow underscores or treat them weirdly.** `_dmarc` and
  `resend._domainkey` records are case-sensitive in some panels (Namecheap is
  fine; older cPanel installs are not). Always copy verbatim from the source
  page.
- **TXT records over 255 chars** must be split into quoted segments by some
  panels: `"v=DKIM1; k=rsa; p=ABCD..." "EFGH..."`. Cloudflare and Namecheap
  handle this automatically.
- **Email reputation cold-start:** Resend's free tier shares IP space with
  other senders. First 50 emails per day may have lower deliverability. After
  ~1 week and 200+ clean sends, reputation stabilizes.
- **SendGrid Inbound Parse 30-day idle:** if no email arrives at
  `invoices.bistrosteward.com` for 30 consecutive days, SendGrid disables the
  hostname. To prevent this, set up a self-test cron (I can wire one).
- **Firestore secrets vs `.env`:** the codebase uses `firebase functions:secrets:set`
  (Secret Manager), NOT a `.env` file. Don't ever commit secrets to git.

---

## Quick reference — final DNS state

After all steps, `bistrosteward.com` should have:

| Type  | Host                       | Value                                       | Priority | Source     |
|-------|----------------------------|---------------------------------------------|----------|------------|
| MX    | `@`                        | `smtp.google.com`                           | 1        | Workspace  |
| MX    | `invoices`                 | `mx.sendgrid.net`                           | 10       | SendGrid   |
| MX    | `send`                     | `feedback-smtp.us-east-1.amazonses.com`     | 10       | Resend     |
| TXT   | `@`                        | `google-site-verification=…`                | —        | Workspace  |
| TXT   | `send`                     | `v=spf1 include:amazonses.com ~all`         | —        | Resend SPF |
| TXT   | `resend._domainkey`        | `p=MIGfMA0…`                                | —        | Resend DKIM|
| TXT   | `_dmarc`                   | `v=DMARC1; p=reject; rua=…`                 | —        | DMARC      |
