# Bistro Steward — Brand + Size Integration Plan

**Target model:** Ingredient → Brands → Sizes. An *Ingredient* is a generic item ("Olive Oil"). A *Brand* is a specific product form of that ingredient ("Kirkland"). A *Size* is a purchase size within a brand (1L, 500ml), and **each Size carries its own UPC/barcode + cost**. Scanning a UPC must resolve **Ingredient + Brand + Size** in one step. Inventory is per-brand and per-size.

**Files:** `firebase/public/app.html` (11,730 lines) and `firebase/functions/index.js` (6,866 lines). All line numbers below are verified against the current source.

**Phase 1 (already shipped):** `ing.brands[]` + `inv.brandId` added to all four mappers; brand-management UI in `editIng` (`renderIngBrandList` 6120, `ingAddBrand` 6135, `ingRemoveBrand` 6148, `ingSetDefaultBrand` 6155). **Gap:** Phase 1 brands are FLAT (one size per brand) — `ing.brands.push({id,name,barcode,size,sizeUnit,cost,isDefault})` at app.html:6143. They must become `brand.sizes[]`.

---

## 1. Final Data Model

### 1.1 Brand record (the core reshape)

**Phase 1 (flat — current, app.html:6143):**
```js
brand = { id, name, barcode, size, sizeUnit, cost, isDefault }   // ONE size baked onto the brand
```

**Target (nested sizes):**
```js
ing.brands = [
  {
    id,            // brand id, unique within ingredient
    name,          // "Kirkland"
    vendorId,      // OPTIONAL — enables "buy Kirkland from Costco" (Phase 6); 0 = unspecified
    isDefault,     // 1 on exactly one brand per ingredient (the primary brand)
    sizes: [
      {
        id,        // size id, unique within brand
        size,      // numeric purchase amount, e.g. 1
        unit,      // purchase unit, e.g. "L"  (was brand.sizeUnit)
        barcode,   // this size's own UPC — authoritative for scan resolution
        cost,      // $ for this purchase size (e.g. $8.99 / 1L)
        isDefault  // 1 on exactly one size per brand (the primary purchase size)
      }
    ]
  }
]
```
- Exactly one `isDefault` brand per ingredient; within each brand exactly one `isDefault` size.
- `barcode` and `cost` move **off** the brand and **into** each size. The brand root keeps only `id/name/vendorId/isDefault/sizes[]`.

### 1.2 Inventory row (`inv`)

Current (mapInvFromDb 2192 / mapInvToDb 2212): carries `brandId` (round-trips as `brand_id`), **no size identifier**.

Target — add `sizeId`:
```js
inv = { id, areaId, subArea, ingId, recId, menuId, prepId, qty, unit,
        outOfStock, sortOrder,
        brandId,   // which Brand of the ingredient (0 = unspecified)
        sizeId }   // NEW — which Size within that brand (0 = unspecified)
```
- `mapInvFromDb`: add `sizeId: i.size_id||0`. `mapInvToDb`: add `size_id: i.sizeId||null`.
- An inv row identifies *which purchase size of which brand* is on hand. The existing-row dedup key in every scan/add path becomes `ingId + areaId + subArea + brandId + sizeId` so two brands/sizes of the same ingredient in one location stay distinct.

### 1.3 priceHistory & receipt lines

- `ing.priceHistory[]` entries currently carry `vendorId` and a hardcoded `brandId:null` (app.html:7406). Populate real `brandId` **and** add `sizeId` so price history is per-brand/per-size.
- Receipt line (server `sanitizeReceiptItems`, index.js): already emits `assignedBrandId:null` + `barcode`. Add `assignedSizeId`. Round-trip both in `mapReceiptToDb`/`FromDb` (app.html 2207/2222).
- Cloud Function `upc_cache` and `upcLookup` already return `{barcode,name,brand,size,unit}` — **no server change required**; the gap is purely client consumption.

### 1.4 Migration of existing data (all client-side, at load)

Persistence requires **no Cloud Function or Firestore change** — `sanitizeRecord` (index.js:333-350) preserves every key by type-recursion (verified), and writes flow through the existing `upsert`.

1. **Flat brand → nested (normalize-on-read in `mapIngFromDb`, app.html:2191):** for each brand that has a top-level `size`/`sizeUnit`/`cost`/`barcode` and no `sizes[]`, wrap it:
   `brand.sizes = [{ id:1, size:brand.size, unit:brand.sizeUnit, barcode:brand.barcode, cost:brand.cost, isDefault:1 }]`, then drop the flat fields. Idempotent (skip if `brand.sizes` already present). This single chokepoint guarantees the rest of the app only ever sees the nested shape.
2. **Legacy `ing.barcode`/`ing.cost`, no brands:** OPTIONAL — synthesize a default brand + default size carrying `ing.barcode`/`ing.cost` so legacy scans/costs keep working. Otherwise leave brands empty and fall back to `ing.cost`/`ing.barcode` everywhere (back-compat path is mandatory regardless).
3. **Existing inv rows:** `brandId:0`, no `sizeId` → treated as "unspecified" (valid). OPTIONAL backfill: set `brandId`/`sizeId` from the ingredient's default brand/size when the ingredient has exactly one brand with one size (unambiguous).
4. No SQL/CF migration job. The normalizer runs in-memory on every load; corrected shapes persist back the next time the ingredient is saved.

---

## 2. Integration Points — Every Location

Priority: **H** = high, **M** = medium, **L** = low. Effort: **S/M/L**.

### 2.1 Data model / mappers / persistence

| Subsystem | Location (fn ~line) | Change needed | Pri | Eff |
|---|---|---|---|---|
| Mappers | `mapIngFromDb` (2191) | Normalize-on-read: upconvert flat brand → `brand.sizes[]`; pass nested `brands[]` through (already opaque). | H | S |
| Mappers | `mapIngToDb` (2211) | No shape change (opaque `brands[]` passthrough already serializes nested sizes). | L | S |
| Mappers | `mapInvFromDb` (2192) | Add `sizeId: i.size_id||0`. | H | S |
| Mappers | `mapInvToDb` (2212) | Add `size_id: i.sizeId||null`. | H | S |
| Mappers | `mapShoppingFromDb` (2193) / `mapShoppingToDb` (2213) | Add `brandId`/`sizeId` ↔ `brand_id`/`size_id` (currently dropped → any brand set elsewhere is lost on save). | H | S |
| Mappers | `mapMenuFromDb` (2196) / `mapMenuToDb` (2216) | None — `ings/recs/preps` are opaque arrays; per-line `brandId/sizeId` persist automatically. | L | S |
| Mappers | `mapVendorFromDb` (2205) / `mapVendorToDb` (2220) | None — vendor↔brand link lives on `brand.vendorId`, not the vendor record. | L | S |
| Mappers | `mapReceiptToDb` (2222) / `mapReceiptFromDb` (2207) | Round-trip per-line `assignedBrandId`/`assignedSizeId` (items array is opaque; verify it survives). | M | S |
| Cloud Fn | `sanitizeRecord` (index.js:333-350) + `upsert` (index.js:2489-2511) | **VERIFY-NO-STRIP — confirmed no change needed.** Type-recursion preserves all keys; `tx.set(...,{merge:true})` replaces `brands[]` wholesale (client = source of truth). | L | S |
| Firestore | `firestore.rules` ings/inv blocks + `permissions.js` ALLOWED_COLLECTIONS/matrix | None — rules are schema-agnostic (`allow write:if false`, Admin SDK bypass); employee already has `ings`/`inv` upsert. | L | S |

### 2.2 Brand-manager UI + new size helpers (editIng)

| Subsystem | Location (fn ~line) | Change needed | Pri | Eff |
|---|---|---|---|---|
| Ingredients | brand form markup (6013-6024) | Split into (a) a brand-name add row (creates brand) and (b) a per-brand "+ Add size" row (`ibr-size/ibr-unit/ibr-cost/ibr-barcode` → `ingAddSize`). Update helper copy: explain default-brand AND default-size, and "scanning a UPC matches a specific size." | M | M |
| Ingredients | `renderIngBrandList` (6120-6134) | Render two levels: brand header (default-brand star) + indented list of `brand.sizes[]` (size·unit·$cost·UPC, per-size default star, per-size remove, "+ Add size"). Stop reading `b.size/b.sizeUnit/b.cost/b.barcode`. | H | M |
| Ingredients | `ingAddBrand` (6135-6147) | Create brand as `{id,name,vendorId:0,isDefault,sizes:[]}` (no inline size). First brand `isDefault:1`. | H | M |
| Ingredients | NEW `ingAddSize(brandId,id)` | Push a size into `brand.sizes[]` from the size inputs; first size in a brand `isDefault:1`; `markChanged('ings',id)` + `renderIngBrandList(id)`. | H | M |
| Ingredients | NEW `ingRemoveSize(brandId,sizeId,id)` | Remove a size; if it was default, promote `sizes[0]` (mirror `ingRemoveBrand` re-default at 6152). | H | M |
| Ingredients | NEW `ingSetDefaultSize(brandId,sizeId,id)` | Toggle `isDefault` across that brand's sizes (mirror `ingSetDefaultBrand` 6155). | H | M |
| Ingredients | `ingRemoveBrand` (6148) / `ingSetDefaultBrand` (6155) | Keep brand-level logic; guarantee the default brand always has a default size. | M | S |
| Ingredients | `saveIng` (6160+) | Persist nested `sizes[]`; make/remove the "default drives costing" tooltip claim real (see costing). | M | S |

### 2.3 UPC scan pipeline (the headline capability)

| Subsystem | Location (fn ~line) | Change needed | Pri | Eff |
|---|---|---|---|---|
| Scan | `_upcOnDetect` (11327-11355, match 11345) | **Core resolver.** Replace `D.ings.find(i=>String(i.barcode)===code)` with a scan over every `ing.brands[].sizes[].barcode` (and legacy `brand.barcode`/`ing.barcode` fallback) returning `{ing,brand,size}`. Thread brand+size into `_upcPortion`. Single entry point — fixes native + web + manual paths at once. | H | L |
| Scan | `_UPC` state object (10788/10952/10989) | Add transient `_UPC._brandId`/`_UPC._sizeId` (or `_UPC._resolved={ing,brand,size}`) so resolution survives panel transitions. | M | S |
| Scan | `_upcPortion` (11632-11653) | Accept brandId+sizeId; default unit/step from the matched `size.unit`/`size`; show brand+size in header; pass brand/size into `_upcCommit`. | H | M |
| Scan | `_upcCommit` (11657-11670) | Add `brandId/sizeId` to the pushed `_UPC.items` entry and to the dedup key. | H | S |
| Scan | `_upcQueueScan` (11606-11613) | Add brandId+sizeId to signature, queued item, and dedup key (mirrors `_upcCommit`). | H | S |
| Scan | `_upcFinish` (11694-11726, write 11712) | Include `brandId/sizeId` when matching existing inv rows AND creating new ones. Currently creates `{id,areaId,subArea,ingId,recId,menuId,qty,unit}` with no brand/size — this is the write site that drops `inv.brandId` on the floor. | H | M |
| Scan | `_upcLinkPicker` (11470-11483) + `_upcRenderIngList` (11614-11630, write 11626) | On link, stop overwriting `ing.barcode`; instead create/attach a Brand (or a Size under an existing brand) carrying the scanned UPC, prefilled from `prod.brand`/`prod.size`. Offer "add as new size of <brand>" vs "new brand". Search rows should also match brand names/UPCs. | H | L |
| Scan | `_upcCreateNewIngForm` (11499-11539) + `_upcCreateNewIngSubmit` (11541-11603, writes 11564/11586) | Seed `newIng.brands=[{...,sizes:[{barcode:_UPC._code, size/unit/cost from prod, isDefault:1}]}]` instead of flat `ing.barcode`. Add Brand-name + Size + unit + cost fields (prefilled from `prod.brand`/`prod.size`). Duplicate-name branch: append a brand/size to the existing ingredient, not overwrite `dup.barcode`. | H | M |
| Scan | `_upcManualSubmit`/`_upcManualEntry`/`_upcAutoRepair` (11403-11459) | None beyond `_upcOnDetect` (funnels into it at 11458). Verify the repaired code matches size barcodes. | L | S |
| Scan | decoder read sites (10979, 11186, 11249, 11285) | None — all converge on `_upcOnDetect`; confirm there is exactly one resolver to update. | L | S |
| Cloud Fn | `upcLookup` + normalizers (index.js normalize* ~593-677, handler ~1733) | None required (already returns `{barcode,name,brand,size,unit}`). OPTIONAL: parse `size`/`unit` into numeric+unit so the client can populate `size`/`unit` cleanly. | L | S |
| Cloud Fn | `sanitizeReceiptItems` / receiptScan schema (index.js ~277-306, ~1532-1556) | Add `assignedSizeId` alongside the existing `assignedBrandId`; `barcode` already captured to drive auto-match. | M | M |

### 2.4 Inventory render + edit

| Subsystem | Location (fn ~line) | Change needed | Pri | Eff |
|---|---|---|---|---|
| Inventory | `renderInvItem` (3602-3700) | Show resolved brand+size on each row (`inv.brandId`/`inv.sizeId` → ingredient default when unset, e.g. "Olive Oil — Kirkland 1L"). Add inline brand selector (when brands>1) + size selector (when that brand has >1 size) wired to `updInvBrand`/`updInvSize`. Unit select reflects the chosen size's unit. | H | L |
| Inventory | NEW `updInvBrand(id,brandId)` / `updInvSize(id,sizeId)` | Mirror `updInvUnit` (4326): saveState → set field → `markChanged('inv',id)` → render. Changing size reconciles the row's unit to the size's unit. | H | S |
| Inventory | `addToArea` (3997-4095, push 4090) | Set `invItem.brandId`/`sizeId` (default brand/size) when `itemType==='ing'`; unit from the chosen size. Optional brand/size picker in the Add-Item form. | H | L |
| Inventory | area/section loop (3861-3995) | Decide brand/size grouping inside an area: sub-group rows under brand/size or show a per-brand subtotal so "total Olive Oil" rolls up across brands while each line stays distinct. | H | L |
| Inventory | `buildInvDropdownItems` (4098-4184) + `selectInvItem`/`onInvItemSelect` (4197/4210) | After ingredient pick, surface a brand+size chooser that sets `brandId/sizeId`; seed unit from default size. | M | M |
| Inventory | `editInvItem`/`moveInvItem` (4639-4661/4678-4689) | Add brand+size selectors to the Move modal (display current, allow reassign of `inv.brandId/sizeId`); reseed unit from chosen size. | M | M |
| Inventory | `ingAddLocation` (6097-6111, push 6107) | Default `brandId/sizeId` to ingredient's default brand/size; seed unit from size. Extend dup-guard (keys on area+subArea at 6103) to include `brandId+sizeId` so a 2nd brand in the same location isn't blocked. | H | M |
| Inventory | `renderIngLocList` (6082-6096) | Show which brand/size each location row holds. | H | M |
| Inventory | `markAsOut` (4482+) / `showTransferModal` (4543+) / `updInvUnit` (4326+) | Audit to **preserve** `brandId/sizeId` when creating/splitting rows (esp. transfer destination rows). `updInvUnit` stays consistent with the selected size's unit. | L | S |
| Inventory | `filterInvSearch` (4358-4392) | Also match brand names + size barcodes; show brand/size on result cards; allow scanning a UPC into the bar to jump to the row. | H | M |

### 2.5 Costing / margin / receipts / price history

| Subsystem | Location (fn ~line) | Change needed | Pri | Eff |
|---|---|---|---|---|
| Costing | NEW `getDefaultBrandSize(ing, brandId?)` → `{brand,size,cost,unit}` | The linchpin resolver: chosen brand → its default size → first size → legacy `ing.cost`/`ing.defUnit`. Build first; every cost surface calls one tested path. | H | M |
| Costing | `calcLineIngCost` (6944-6971) | Route through the resolver: cost basis = `size.cost` against `size.unit` (not `ing.cost`/`ing.defUnit`). Add optional `brandId` param for recipe-line override. Fall back to `ing.cost` when no brands/sizes. This propagates correct cost to every recipe/margin surface. | H | L |
| Costing | `calcRecipeCost` (6973-7022) | Pull `unitCost`/`unitCostUnit` (and `brandId/sizeId`) from the resolved size, not `ing.cost`/`ing.defUnit`; `missingCost` keys off the default size's cost. | H | S |
| Receipts | `_receiptApplyLineInMemory` (7398-7412, push 7406) | Add Brand+Size resolution; write cost onto the matched `brand.sizes[].cost` (not blanket `ing.cost`); set real `brandId`+`sizeId` on the priceHistory entry (replace hardcoded `null`). Auto-resolve from the line's `barcode` when present. | H | L |
| Receipts | `renderReceiptDetail` (7361-7395) + `_ingSelectHtml`/`_areaSelectHtml` (7311-7320) | Add dependent Brand + Size dropdown columns (ingredient→brands→sizes), each with "+ new" to create inline. | H | L |
| Receipts | `receiptGuessIngId` (7302-7310) | Try `line.barcode` against `brands[].sizes[].barcode` for an exact Ing+Brand+Size hit before name-text fallback. | M | M |
| Receipts | `applyReceiptLine`/`applyReceipt` (7413-7436) | Read new `rl-brand-`/`rl-size-` selects; store `assignedBrandId`/`assignedSizeId`; persist the brand-size cost write. | H | M |
| Costing | `getIngPriceHistory` (7047-7056) + `drawIngPriceChart` (7723-7783) | Optional group-by/filter so the chart can split price trends by Brand+Size, not just vendor. Synthetic seed from default brand-size cost. | M | M |
| Costing | `getBestVendorForIng`/`detectIngAlarm`/`collectIngAlarms` (7058-7099, 7785-7806) | Normalize price to a common unit via `size.unit` and segment best-price/spike detection by Brand+Size so comparisons are like-for-like. | M | M |
| Costing | `loadAlternateSuppliers`/`fetchAiSupplierAlternates` (7808-7899) | Compare current default brand-size cost (per-unit) vs alternatives; include brand+size+unit in the AI payload. | L | M |
| Inventory | `mapInvFromDb/ToDb` + all `D.inv.push` sites (4090,4429,4472,4627,4883,4940,4964,5007,6107,10767,11712) | Add `sizeId` to mappers; audit every push to set `brandId/sizeId` where a brand context exists. Without this, per-brand/per-size inventory is never recorded even though the field exists. | H | M |
| Costing | `receiptsToPurchaseRows` / QuickBooks export (7476-7513) | OPTIONAL brand+size columns in `purchases.csv`. | L | S |
| Cloud Fn | `resolveUnconfirmedItem` + invoice cost-write (index.js ~4997-5028) | Mirror receipt change server-side: invoice price lands on `ing.brands[].sizes[].cost`; `price_history` carries `brandId/sizeId`. Requires invoice line→brand/size resolution first; keep `ing.cost` as fallback. | M | L |

### 2.6 Recipes

| Subsystem | Location (fn ~line) | Change needed | Pri | Eff |
|---|---|---|---|---|
| Recipes | recipe line model: `saveRecIng` (6518-6531), `addRecIng` (6444-6462), `selectRecIng` (6500-6516), `updRecIng`/`updRecIngUnit`/`delRecIng` (6393/6403/6413) | OPTIONAL brand pin: add `brandId` to the line + a brand `<select>` in `addRecIng` (default = ingredient default brand). When set, cost against that brand's default size; when unset, fall back. Keep optional so existing lines still cost. | M | M |
| Recipes | recipe drawer line render (7650-7663, call 7654) | Pass `line.brandId` into `calcLineIngCost`; display resolved brand+size (e.g. "Kirkland · 1 L") next to the ingredient name. | M | S |
| Recipes | `expandRecipeIngredients` (5018-5049) | If brand pin adopted, carry `brandId` through the flattened objects (push 5031) so sub-recipe costing keeps the pin. | M | S |
| Recipes | `calcRecipeOutput` (3334-3398) | None — verify output math stays unit-driven, not brand/size-driven. | L | S |
| Recipes | `recipeAlarmLevel` (7101-7118) | OPTIONAL — once price history is per-brand, detect against the recipe's default/pinned brand history instead of merged. | L | M |
| Recipes | filter `filterRecIngSearch` (6464-6498) | Match brand name/UPC in the picker; keep stored reference as the generic `ingId` (recipes stay brand-agnostic). | L | S |

### 2.7 Shopping list + add-to-inventory

| Subsystem | Location (fn ~line) | Change needed | Pri | Eff |
|---|---|---|---|---|
| Shopping | `mapShoppingFromDb`/`ToDb` (2193/2213) | Add `brandId`/`sizeId` (foundational — see 2.1; without it any brand set on a line is dropped on save/sync). | H | S |
| Shopping | `addShopItem` (9812-9822) + add-modal (9717-9739) | Add Brand dropdown (from `ing.brands[]`, default isDefault) + dependent Size dropdown; store `brandId/sizeId`; default unit from `size.unit`. Empty `brands[]` keeps today's behavior. | H | M |
| Shopping | `addToInv` (4931-4951, push 4940) | Carry `s.brandId/sizeId` onto the inv push (fallback to default brand); pass brand into the location-picker branch via `pendingPurchase`. | H | S |
| Shopping | `addAllPurchasedToInv` (4953-4983, push 4964) | Same brand-carry as `addToInv` on each pushed row. | H | S |
| Shopping | `confirmAddToInv` (4999-5015, push 5007) + `openLocationPicker` (4985-4997) | Pull `s.brandId/sizeId` from the pending item onto the inv push (fallback to default brand). | H | S |
| Shopping | `togShop` auto-add branch (4878-4889, push 4883) | 5th inventory-write path — also set `brandId/sizeId` (easy to miss; bypasses `addToInv`). | H | S |
| Shopping | `calculateShoppingList` STEP 7 (5362-5416) + needs build (5296-5360) | Decide brand-targeting: if auto-lines target a specific brand/size (default), set `brandId/sizeId` and include them in the existing-match (5381) and stale-removal (5413) keys so per-brand lines aren't merged/culled. | M | M |
| Shopping | `renderShop` rows + vendor/category grouping (4715-4869) | Display chosen Brand+Size on each row (To Buy / Purchased / Saved). Vendor grouping stays on `ing.vendorId` unless brand-level vendor adopted (Phase 6). | M | M |
| Shopping | `emailVendorOrder` (4695-4713) | Include line's Brand+Size (and size barcode) in the order text so the vendor gets the exact SKU. | L | S |

### 2.8 Menus

| Subsystem | Location (fn ~line) | Change needed | Pri | Eff |
|---|---|---|---|---|
| Menus | `mapMenuFromDb`/`ToDb` (2196/2216) | None — opaque arrays already round-trip per-line `brandId/sizeId`. | L | S |
| Menus | `addMenuIng` (7981-7999) / `selectMenuIng` (8036-8051) / `saveMenuIng` (8053-8066) | OPTIONAL: on direct-ingredient lines, capture `brandId/sizeId` (Brand+Size selects defaulting to isDefault). Low priority — menu shows no cost today. | L | M |
| Menus | `renderMenu` ings loop (7928-7936) | OPTIONAL: append brand+size when a line has `brandId`. Cosmetic. | L | S |
| Menus | `addMenuRec`/`saveMenuRec` (8110-8208) | None — menu **recipes** stay brand-agnostic; brand resolution belongs on the recipe's own ingredient lines. | L | S |
| Menus | shopping expansion Step 5/5b (5240-5293) | OPTIONAL: propagate `brandId/sizeId` from a menu.ings line into the need. | L | M |
| Menus | `migrateMenuData` (3413-3448) / AI-CSV import (9560-9590) | None required (falsy defaults handled). | L | S |

### 2.9 Vendors (brand↔vendor)

| Subsystem | Location (fn ~line) | Change needed | Pri | Eff |
|---|---|---|---|---|
| Vendors | brand `<select>` in `renderIngBrandList`/`ingAddBrand` (6120-6147) | Add a Vendor select per brand (`brand.vendorId` from `D.vendors`) so "Kirkland→Costco / Bertolli→Sysco" is expressible. | M | M |
| Vendors | `emailVendorOrder` (4695-4713) | If vendor moves to brand level, group order lines by brand→vendor; print brand name + purchase size. | M | M |
| Vendors | `renderShop` grouping (4746-4790) + `setShopGroupBy` (4693) | If brand-level vendor adopted, group-by key comes from the chosen brand's `vendorId`, not `ing.vendorId`. | M | M |
| Vendors | `getBestVendorForIng` + recipe summary + swap UI + price-history-by-vendor (7058-7079, 7606+, 7817-7868, 7750-7760) | Make best-price brand/size-aware: normalize per-unit via size; group by (vendorId, brandId). Depends on populated `priceHistory.brandId/sizeId`. | M | L |
| Vendors | `deleteVendor` (8394-8426) | Also null any `brand.vendorId===id` across all ingredients' brands; count brand-level assignments in the confirm. | M | S |
| Vendors | `renderVendors` assigned-count (8289-8338) | Count ingredients with ANY brand `vendorId===v.id`, not just `ing.vendorId`. | L | S |
| Vendors | `mapVendorFromDb`/`ToDb` (2205/2220) | None — vendor stays a dumb contact card; link lives on `brand.vendorId`. | L | S |

### 2.10 Global search

| Subsystem | Location (fn ~line) | Change needed | Pri | Eff |
|---|---|---|---|---|
| Search | `filterInvSearch` (4358-4392) | Primary Inventory→Ingredient→Brand search: match brand name/UPC/size barcode for the row's `inv.brandId`; show matched brand+size on the card. | H | M |
| Search | `renderIngs` filter (5725-5741) + `filterIngredients` (5962-5973) | Match any `ing.brands[].name`, `brand.sizes[].barcode`; optionally surface matched brand on the card. | M | S |
| Search | `renderIngs` cards (regular 5750, standalone 5767, unused 5822, archived 5834) | Show default brand+size+cost on the card (e.g. "Kirkland · 1L · $8.99"); optional per-brand on-hand rollup grouped by `brandId`. | M | M |
| Search | `buildInvDropdownItems` (4098-4171) + `selectInvItem`/`onInvItemSelect` (4197/4210) | Match brand names/UPCs; emit ing+brand+size; capture `brandId/sizeId`; unit from chosen size. (Same row as 2.4 — do once.) | M | M |
| Search | `filterRecIngSearch` (6464-6498) / `filterMenuIngSearch` (8001-8034) | Add brand-name/UPC matching to the filter only; keep stored ref as generic `ingId`. | L | S |

---

## 3. Phased Build Order

Each phase is independently shippable and verifiable. **Phase 2 is the user's headline ask (scan → Brand+Size).** Phase 2 cannot resolve a *size* barcode until brands hold `sizes[]`, so the data-model reshape (Phase 2a) and the scan rewrite (Phase 2b) ship together as one release.

### Phase 2 — Brand+Size data model + scan resolution *(headline)*

**2a. Data spine + brand-manager reshape**
- `mapIngFromDb` (2191): normalize-on-read flat→nested. `mapInvFromDb/ToDb` (2192/2212): add `sizeId`/`size_id`. `mapShoppingFromDb/ToDb` (2193/2213): add `brandId/sizeId`.
- `ingAddBrand` (6135) → brand `{id,name,vendorId:0,isDefault,sizes:[]}`. New `ingAddSize`/`ingRemoveSize`/`ingSetDefaultSize`. `renderIngBrandList` (6120) → two-level render. Brand form markup (6013-6024) split into brand-row + size-row.

**2b. Scan → Ingredient+Brand+Size + per-brand/size inventory**
- `_upcOnDetect` (11345): resolver over `brands[].sizes[].barcode` returning `{ing,brand,size}`; legacy fallback.
- `_UPC` state: add `_brandId/_sizeId`. `_upcPortion` (11632), `_upcCommit` (11657), `_upcQueueScan` (11606): thread brand+size + dedup keys. `_upcFinish` (11694, write 11712): write `brandId/sizeId`, match key includes them.
- `_upcLinkPicker`/`_upcRenderIngList` (11470/11614): link creates a brand/size (from `prod.brand`/`prod.size`), not `ing.barcode`. `_upcCreateNewIng*` (11499/11541): seed `brands[0].sizes[0]` with the scanned UPC.
- New `updInvBrand`/`updInvSize`; `renderInvItem` (3602) shows + lets you change brand/size.

**Verify:** Edit an ingredient → add brand "Kirkland" → add two sizes (1L w/ UPC-A, 500ml w/ UPC-B) → save → reload (normalizer + sizeId persist). Scan UPC-A → portion header shows "Kirkland · 1L" → commit → inv row carries the right `brandId/sizeId`, distinct from a UPC-B row in the same location. Scan an unknown UPC → "new brand/size of X" path writes a size, not `ing.barcode`. Migration: a Phase-1 flat brand loads as one default size; legacy `ing.barcode` still scans.

### Phase 3 — Costing on default brand/size

- New `getDefaultBrandSize(ing, brandId?)`. Route `calcLineIngCost` (6944) and `calcRecipeCost` (6973) through it; fall back to `ing.cost`. Make the editIng "default drives costing" tooltip real.
- **Verify:** an ingredient with a default brand-size cost prices recipes/margin off `size.cost`/`size.unit`; one with no brands still prices off `ing.cost`; recipe drawer shows the brand+size that priced each line.

### Phase 4 — Receipts & price history per brand/size

- `renderReceiptDetail` (7361) + Brand/Size columns; `receiptGuessIngId` (7302) barcode-first; `_receiptApplyLineInMemory` (7398) writes `brand.sizes[].cost` + real `brandId/sizeId` on priceHistory; `applyReceiptLine`/`applyReceipt` (7413) persist `assignedBrandId/SizeId`; server `sanitizeReceiptItems` + invoice cost-write (index.js ~277, ~4997) add `assignedSizeId`.
- **Verify:** a receipt line resolves to Ing+Brand+Size (auto from barcode when present); the price lands on that size's cost; the price chart can split by brand+size; best-vendor compares like-for-like per unit.

### Phase 5 — Inventory display/grouping + search

- `renderInvItem` brand/size labels + selectors (finish from Phase 2b); `addToArea` (3997)/`ingAddLocation` (6097) default brand/size + extend dup-guard; area grouping/subtotals (3861); `editInvItem` (4639) brand/size reassignment; `renderIngLocList` (6082) per-row brand/size.
- `filterInvSearch` (4358), `renderIngs` filter (5725) + cards (5750), recipe/menu pickers (6464/8001): brand-name/UPC matching.
- **Verify:** searching "Kirkland" or typing/scanning a UPC finds the ingredient and the inv row; cards show default brand+size+cost; a location can hold two brands as distinct rows; totals roll up across brands.

### Phase 6 — Vendor↔Brand + shopping/orders by brand

- `brand.vendorId` select in brand-manager (6120-6147); `deleteVendor` (8394) + `renderVendors` count (8289) walk brands; `emailVendorOrder` (4695) + `renderShop` grouping (4746) key off brand vendor; best-vendor (7058) brand-aware.
- Shopping brand-carry: `addShopItem` (9812), `addToInv` (4931), `addAllPurchasedToInv` (4953), `confirmAddToInv` (4999), `togShop` auto-add (4878) all set/carry `brandId/sizeId`; `calculateShoppingList` (5362) brand-targeting.
- **Verify:** assign Kirkland→Costco, Bertolli→Sysco; a vendor order email groups by brand→vendor with exact size/SKU; a purchased shopping line lands in inventory tagged with its brand+size.

### Phase 7 — Optional polish (recipes pin, menus, AI alternates, QB export)

- Recipe brand pin (`saveRecIng` 6518, drawer 7650, `expandRecipeIngredients` 5018); menu direct-ingredient brand capture (7981-8066) + display (7928); `loadAlternateSuppliers`/AI payload (7808) per-unit; price alarms per brand (7101); `purchasesToPurchaseRows` brand columns (7476).
- **Verify:** each is independently togglable; absence of a brand pin always falls back to the ingredient default.

---

## 4. Risks

1. **Cloud Function stripping nested `brands[]`/`sizes[]` on save — VERIFIED NOT A RISK.** `sanitizeRecord` (index.js:333-350) recurses by type (string→sanitize, array→map-recurse, object→recurse) and **preserves every key** — there is no field allowlist anywhere in the CF, and no test asserts one. `upsert` (index.js:2489-2511) maps through `sanitizeRecord` then `tx.set(docRef, merged, {merge:true})`. So nested `brands[]` (with `sizes[]` inside) and `brand_id`/`size_id` round-trip untouched with **zero CF change**. firestore.rules also need no change (ings/inv use `{document=**}` + `allow write:if false`; all writes go through Admin SDK which bypasses rules; `permissions.js` already grants employee `ings`/`inv` upsert).

2. **Firestore `{merge:true}` is field-granular — `brands[]` is replaced wholesale.** Saving an ingredient overwrites the **entire** `brands[]` array (not per-element merge). This is correct (client is source of truth), but means a stale client that drops a brand before saving will wipe it. Mitigation: brand/size edits go through the normal `markChanged('ings',id)` → realtime-sync path; never hand-build a partial `brands[]` for upsert.

3. **Live-data migration on read.** The flat→nested normalizer runs in `mapIngFromDb` on **every** load and must be strictly idempotent (skip if `brand.sizes` already present) so a half-migrated tenant (some flat, some nested) is handled, and so re-running never double-wraps. Corrected shapes only persist when the ingredient is next saved — until then they live in memory, which is fine because every read re-normalizes. Risk if the normalizer is buggy: cost/scan read the wrong shape app-wide (single chokepoint = single point of failure). Mitigation: unit-test the normalizer against (a) flat brand, (b) already-nested brand, (c) brand with neither, (d) `ing.barcode`-only no brands.

4. **`inv.brandId`/`sizeId` populated late — historical inv rows stay `0` (unspecified).** Acceptable, but until the optional backfill runs, "total Olive Oil" rollups mix unspecified-brand rows with branded ones. Mitigation: treat `brandId:0` as a valid "any/unspecified" bucket in grouping; only backfill when a single brand+size is unambiguous.

5. **Costing source-of-truth split (ing.cost vs brand.sizes[].cost).** Once `calcLineIngCost` reads `size.cost`, receipt/invoice flows that still write only `ing.cost` (until Phase 4) make recipe costs ignore receipt-driven price updates. Mitigation: keep `ing.cost` as the mandatory fallback through Phase 3; ship Phase 4 (write cost onto the size) before relying on per-brand pricing. Until Phase 4, default-brand-size cost should *seed from* `ing.cost` when the size has no cost.

6. **Dedup-key change can split or merge inv/shopping rows unexpectedly.** Adding `brandId/sizeId` to existing-row match keys in `_upcFinish` (11712), `_upcCommit` (11667), shopping auto-add, and `calculateShoppingList` (5381/5413) changes which rows collide. A row created pre-migration (brandId 0) won't match a newly scanned branded row → two rows for what looks like the same item. Mitigation: when one side has `brandId:0`, treat it as a wildcard that matches (merge into the branded row) during a transition window, or expose a one-click "merge duplicate" in the inv UI.

7. **`MAX_ARRAY_LENGTH = 1000` (index.js:231).** Applies to the top-level upsert array, not nested `brands[]`. An ingredient with brands×sizes far below 1000 is safe; no realistic risk, noted for completeness.
