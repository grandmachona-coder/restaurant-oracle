# B5 — USPTO TEAS Plus Filing Walkthrough (Step-by-Step)

**Estimated time:** 30-45 minutes (assumes ID.me already done; 60-90 min if first time)
**Estimated cost:** $500 USPTO fees (paid at end via credit card)

> Read every step. Filing is irreversible once you click Submit. Sworn statement is signed under penalty of perjury.

---

## PRE-FLIGHT (do once, before opening TEAS)

### Step 0a: Get a MyUSPTO account
1. Go to https://my.uspto.gov/
2. Click **"Sign in"** → **"Don't have an account? Create one"**
3. Use email **grandma.chona@gmail.com**
4. Verify email link, set password.

### Step 0b: ID.me verification (required for filing)
1. From MyUSPTO, you will be prompted to **"Verify your identity"** via ID.me.
2. Click **"Verify with ID.me"**.
3. Steps:
   - Upload front + back of driver license OR passport
   - Selfie biometric match
   - May trigger live video call if biometric fails — keep webcam ready
4. Verification typically completes in 5-15 min. Save your ID.me login.

### Step 0c: Have these open in tabs
- USPTO Trademark ID Manual: https://idm-tmng.uspto.gov/
- B5_application_package.md (this folder)
- Credit card ready

---

## TEAS PLUS FORM — Section by Section

### Step 1: Open the form
1. Go to **https://teas.uspto.gov/forms/initial/initial.jsp**
2. Sign in with MyUSPTO credentials.
3. On the form selector page, click **"TEAS Plus (Reduced Fee)"** under Initial Application.
4. Click **"START NEW APPLICATION"**.
5. You'll see "TEAS Plus Application Wizard". Read eligibility checklist. Click **"Continue"**.

### Step 2: Filing Type
1. Select **"Section 1(b) - Intent to Use"**.
2. Do NOT select 1(a), 44, or 66.
3. Click **"Continue"**.

### Step 3: Mark Information
1. **Mark format:** select **"Standard Character Mark"** radio.
2. **Mark text field:** type exactly `BISTRO STEWARD` (uppercase, single space, no punctuation).
3. Leave color claim, design code, translation, transliteration BLANK.
4. Disclaimer: leave blank.
5. Click **"Continue"**.

### Step 4: Owner Information
| Field | Enter |
|---|---|
| Owner type | Limited Liability Company |
| Owner name | Abuela Chona LLC |
| State of organization | Oregon |
| Country of organization | United States |
| Internal address | (leave blank) |
| Street address | 5350 NW Rubicon Ln |
| City | Portland |
| State | Oregon |
| Zip | 97229 |
| Country | United States |
| Phone | (your cell) |
| Fax | (leave blank) |
| Email address | grandma.chona@gmail.com |
| Authorize email for correspondence? | **YES** (check the box) |

Click **"Continue"**.

### Step 5: Goods & Services — Class 009
1. Click **"Add Goods/Services"** → enter Class **009**.
2. Click **"Search ID Manual"** button beside the recitation field.
3. Search for **"downloadable software restaurant inventory"** in ID Manual popup.
4. Click acceptable entries to copy them in. If you don't find exact phrasing:
   - Try **"downloadable software for inventory management"** — pick that.
   - Then add a comma + the qualifier from your package.
5. Paste / verify final Class 9 text matches the recitations in your B5_application_package.md.
6. Confirm **"Filing basis"** for this class is **1(b) intent to use** (radio).
7. Save class 9.

### Step 6: Goods & Services — Class 042
1. Click **"Add Class"** → **042**.
2. Click **"Search ID Manual"** → search **"software as a service restaurant inventory"**.
3. Confirm at least one ID Manual entry shows status **A** or **M** with matching text.
4. Paste the recitation block from B5_application_package.md, verifying each semicolon-separated phrase is ID-Manual-approved.
5. Filing basis: **1(b)**.
6. Save class 42.

> **If ANY recitation phrase doesn't match a pre-approved ID Manual entry, the form will warn you and you'll be auto-bumped to TEAS Standard ($350/class = +$100/class). To stay TEAS Plus, edit the recitation to use only ID Manual exact text.**

Click **"Continue"**.

### Step 7: Attorney Information
1. **"Are you represented by a U.S.-licensed attorney?"** → select **"NO"**.
2. Confirm warning popup ("USPTO recommends representation"). Click **"Continue without attorney"**.

### Step 8: Correspondence
1. Confirm the email shown is **grandma.chona@gmail.com**.
2. Confirm phone is yours.
3. Authorize email correspondence: **YES**.
4. Click **"Continue"**.

### Step 9: Fee Information
1. You should see:
   - Class 009 — $250
   - Class 042 — $250
   - **Total: $500**
2. If you see anything other than $500, STOP and review — you may have been bumped off TEAS Plus.
3. Click **"Continue"**.

### Step 10: Validation Page
1. The form runs an auto-validate. Read every error/warning.
2. Common warnings:
   - "ID Manual recitation modified" — usually fine, just confirm.
   - "Owner state must match entity formation state" — should already be Oregon.
3. Fix any errors. Re-validate.

### Step 11: Signature Block
1. **Signatory name:** `Anthony Mulé`
2. **Signatory title:** `Manager`
3. **Signature:** type `/Anthony Mulé/` (forward slashes are required — they're the USPTO e-signature format)
4. **Date:** auto-fills.
5. **Read the declaration text above the signature.** It states under penalty of perjury that:
   - Applicant believes it is entitled to use the mark
   - To the best of signatory's knowledge, no other entity has the right to use the mark in a confusingly similar way
   - All statements are true
6. If any of those is false or you're unsure, **STOP** and contact an attorney before signing.
7. Check the **"I declare..."** acknowledgement box.

### Step 12: Payment
1. Click **"Pay/Submit"**.
2. Payment options:
   - **Credit card** — enter card details, billing address.
   - **USPTO deposit account** — only if you have one.
3. Confirm $500 charge.
4. Click **"Submit"**.

### Step 13: Confirmation
1. You will receive a **Serial Number** like `97/123,456` — write it down immediately.
2. Filing receipt PDF emailed to grandma.chona@gmail.com within minutes.
3. Save the PDF to `/Users/mulefamily/Claude/Bistro-Steward/trademark/filing_receipt.pdf` — I'll auto-pick it up for the B6 monitor.

---

## POST-FILING (immediate)

1. **Forward the filing receipt email to me** (or save to disk path above) so I can:
   - Set up the B6 USPTO TSDR daily-poll cron
   - Add the serial number to all internal trackers
   - Calendar the key deadlines (~6-8 mo for examining attorney, etc.)
2. **Do NOT use the TM ® symbol** until registration. You may use ™ from Day 1 (already legal as common-law claim).
3. **Save 5350 NW Rubicon Ln mailbox alert** — USPTO official correspondence may arrive by mail.

## TROUBLESHOOTING

| Symptom | Fix |
|---|---|
| Form auto-converts to TEAS Standard | A recitation isn't ID-Manual-approved. Edit it to exact ID Manual text. |
| ID.me upload fails | Use Chrome (not Safari). Try passport instead of license. |
| Owner type "LLC" not in dropdown | Pick **"Limited Liability Company"** (full phrase). |
| Form asks for state ID number | That's the Oregon Registry # → **105139398** |
| "Email already on file" | You're using the right email — proceed. |
| Card declined | Try a different card. USPTO does not store cards between sessions. |

## DO NOT do these things

- Do not file under your personal name. Owner = Abuela Chona LLC only.
- Do not click 1(a) — you have not used the mark in interstate commerce yet.
- Do not check "Color claimed as a feature of the mark."
- Do not submit a logo/design — that's a separate filing.
- Do not skip ID Manual verification — TEAS Plus rejects custom text.

---

When you're done, ping me with the serial number and I'll spin up B6 monitoring.
