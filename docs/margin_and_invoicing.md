# Margin + Invoice Scanning — Feature Notes

Shipped 2026-04-24. Covers:

1. Recipe costing engine — per-line + per-portion food cost, margin %, unit-conversion-aware.
2. **Margin** tab — sortable P&L table across all recipes + alarming-cost detector.
3. Recipe drawer — per-recipe card with ingredient table, price-history chart, vendor best-price, alarm list, AI supplier alternates.
4. **Inbound invoice email** — per-tenant `<token>@invoices.restaurantoracle.app`. SendGrid Inbound Parse → Gemini Vision → auto-update ingredient cost + priceHistory.
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
[user forwards]    ──┼─→ <token>@invoices.restaurantoracle.app
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

1. Add MX record: `invoices.restaurantoracle.app. IN MX 10 mx.sendgrid.net.`
2. SendGrid → Settings → Inbound Parse → Add Host & URL:
   - Hostname: `invoices.restaurantoracle.app`
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
- Shows current `<token>@invoices.restaurantoracle.app`.
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
