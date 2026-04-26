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
  console.log('email:', t + '@invoices.restaurantoracle.app');
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
  -F "to=${TOKEN}@invoices.restaurantoracle.app" \
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

### Step 2 — DNS MX record for `invoices.restaurantoracle.app`

Where the apex `restaurantoracle.app` is hosted, add:

```
Type:  MX
Name:  invoices
Value: mx.sendgrid.net.
Priority: 10
TTL: 3600
```

Verify after a few minutes:
```bash
dig MX invoices.restaurantoracle.app +short
# expected: 10 mx.sendgrid.net.
```

### Step 3 — SendGrid Inbound Parse setup

1. Create / sign in to SendGrid (free tier: 100 emails/day, plenty for inbound).
2. Settings → Inbound Parse → Add Host & URL.
3. Domain: `invoices.restaurantoracle.app`
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
