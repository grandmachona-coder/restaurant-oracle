# Bistro Steward — Wordmark Concepts

Brand pivot: **Restaurant Oracle → Bistro Steward**. Existing SAUCIVO icon stays; only the wordmark changes. Three typographic directions are explored as standalone HTML mockups.

Open any file in a browser to view at full scale.

---

## Variant 1 — Serif (Heritage)

**File:** `wordmark_serif.html`
**Primary face:** Cormorant Garamond 500 @ 128px
**Alternates:** Playfair Display Bold; Cormorant Italic with brass accent
**Palette:** Ink / Linen / Brass `#C9A961` / Burgundy `#8B3A3A` / Sage / Stone

**Rationale.** Cormorant Garamond carries restaurant-menu DNA — readable as a chalkboard headline, dignified as a letterhead. The thin brass hairline and italic accent invoke fine-dining heritage without going precious. Pairs naturally with linen-on-ink in marketing collateral, printed cost reports, and chef-facing screens. Best when the audience is owner-operators and chefs who associate typography with hospitality craft.

**Risks.** Reads "fine dining only" — bistros, cafes, and fast-casual customers may feel it's not for them. Thin serifs lose detail at small UI sizes (<14px), so a sans secondary face is required for app body copy.

---

## Variant 2 — Modern Condensed Sans (SaaS)

**File:** `wordmark_sans.html`
**Primary face:** Inter Tight 800 @ 112px, tight tracking, mint accent dot
**Alternates:** Bebas Neue all-caps; Archivo Narrow stacked
**Palette:** Ink / White / Mint `#00D4A3` / Electric Blue `#5B8DEF` / Alert / Muted

**Rationale.** Tight-tracked Inter Tight is the contemporary SaaS dialect — Linear, Vercel, Stripe, Cursor all live in this neighborhood. The terminating dot and mono caption signal "tool, not menu," which is honest about what Bistro Steward actually is: an inventory and costing engine. Translates cleanly to favicons, CLI banners, dashboard headers, and dense data UI down to 11px.

**Risks.** Reads cold. Restaurant operators may bounce off it as "another tech tool" if marketed without warmth in photography and copy.

---

## Variant 3 — Handdrawn (Artisanal)

**File:** `wordmark_handdrawn.html`
**Primary face:** Caveat 700 @ 144px, slight tilt, hand-drawn underline
**Alternates:** Kalam Marker; Homemade Apple stacked
**Palette:** Ink / Cream `#F4EAD5` / Amber `#E8A04A` / Herb / Tomato / Parchment

**Rationale.** A chef's hand on a recipe card — warm, tactile, authored. Caveat with the SVG underline says "this came from a kitchen, not a board meeting." Strongest on social, packaging, and onboarding screens where tone matters more than density. Pairs beautifully with food photography.

**Risks.** Hand fonts age fast and can feel craft-cute. Poor at small sizes and in dense data tables. Cannot carry the full UI alone — must be paired with a neutral sans for app chrome.

---

## Recommendation

**Lead with Variant 2 (Modern Condensed Sans) as the system wordmark; deploy Variant 3 (Handdrawn) as a secondary marketing voice.**

Bistro Steward is, mechanically, an inventory and cost-of-goods-sold engine. The product surface is dense tables, multi-tenant dashboards, recipe builders, and Cloud Functions — the SaaS direction matches that reality and scales to favicons, status bars, and dashboard chrome without compromise. The mint accent also harmonizes with status semantics already used in the app (good/warn/alert).

To avoid the "cold tech tool" failure mode, the handdrawn voice (Variant 3) is reserved for marketing surfaces — landing-page hero, onboarding empty states, social, packaging, partner outreach. This dual system gives the product a tool-grade core with hospitality-grade edges.

Variant 1 (Serif) is held in reserve for print collateral and high-touch enterprise outreach where heritage cues earn trust, but is not recommended as the primary system mark.

### Next steps

1. Lock Variant 2 typography and tracking; export SVG wordmarks at 1x/2x for app header and favicon.
2. Define lockup with existing SAUCIVO icon: icon-left horizontal, icon-above stacked, and icon-only (favicon) variants.
3. Validate at 11px (table header), 14px (nav), 24px (page title), 96px (marketing hero).
4. Adopt Variant 3 as marketing-only voice; document where it may and may not appear.
