# Design Partner Onboarding Playbook

Five stages. Do each one. Don't skip.

---

## Stage 0 — Before they sign (pre-commit)

**Goal:** reduce their fear that this is a time sink.

Send, before the signature:
- One-page letter (`04_partner_letter.md`)
- 2-minute screen-recording of the scan → cost → prep flow on your own LaChona data (anonymized prices)
- Link to restaurantoracle.app with a "design partner" subdomain banner so they feel invited not sold

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
