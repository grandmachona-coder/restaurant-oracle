# Bistro Steward YouTube Tutorial Series — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce 10 short YouTube tutorial videos covering end-to-end new-restaurant setup for Bistro Steward, plus the supporting in-app help drawer, demo tenant, and scripts repository required to record and link them.

**Architecture:** Three workstreams in sequence — (1) build the missing UI surfaces the spec assumes (help drawer + `?help=` deep-linker, recipe cost badge, Oracle text chat with analytical intents) so every video has something real to film, (2) seed a stable demo tenant via a repeatable script, (3) write all 10 scripts before any recording. Recording, upload, captioning, and YouTube channel work hand off to the human user (Anthony) after script approval.

**Tech Stack:** Vanilla JS PWA (`firebase/public/app.html`), Firebase Auth + Firestore (`/tenants/{tenantId}/...`), Cloud Functions Node 22 (`firebase/functions/index.js`), Gemini 2.5 Flash via `@google/generative-ai`, Square Web Payments SDK, Markdown scripts in `docs/tutorials/`, Node seed script using Firebase Admin SDK + ADC credentials.

**Status (updated 2026-05-01):** Plan composed and awaiting Anthony approval. Nothing executed yet.

| Phase | State | Notes |
|---|---|---|
| Phase 0 — recon | ⬜ not started | Earlier exploration cited wrong file (`index.html` 641-line landing instead of `app.html` 9212 lines). Re-verify cost-UI + Oracle state before Chunk 2. |
| Chunk 1 — foundation | ⬜ not started | `docs/tutorials/` skeleton, help drawer (CSS+JS+JSON), `app.html` wiring, demo-tenant seeder, 6 fixture JSONs. |
| Chunk 2 — features | ⬜ not started | Recipe cost badge (green/yellow/red), Oracle text chat (4 intents: margin_trend, unused_ingredients, vendor_forecast, recipe_health). |
| Chunk 3 — scripts | ⬜ not started | 10 markdown scripts at 150 wpm, plus recording-guide.md and upload-checklist.md. |
| Chunk 4 — record/upload | ⬜ user-owned | 10 days estimated. Triggered after script approval. |

**Confirmed decisions:**

1. Build all blocker features in this task — videos 6 (cost badge) and 10 (Oracle chat) are not deferred (per CLAUDE.md "complete coverage" rule).
2. Help drawer + `?help=` deep-link in scope.
3. Demo data spec: 40 ingredients, 15 recipes, 3 menus, 4 areas, 2 vendors, 7 days mock sales.
4. Demo tenant: slug `demo-restaurant`, owner `demo@bistrosteward.com`, marked `isDemo: true` so never billed and never appears in production reports.
5. Square sandbox card `4111 1111 1111 1111` exp `12/26` CVV `123` ZIP `97229` for all card demos.
6. Effort split: Claude ≈ 3 days (recon + chunks 1-3); Anthony ≈ 13 days (record + edit + caption + upload). Total ≈ 16 working days.

**Open items requiring real assets (Anthony):**

- Grocery receipt photo for video 4 (`docs/tutorials/_assets/04-receipt.jpg`).
- Vendor invoice PDF for video 5 (`docs/tutorials/_assets/05-invoice.pdf`).
- YouTube channel "Bistro Steward" creation (channel art + thumbnails).
- Real YouTube video IDs pasted back into `firebase/public/help-videos.json` after upload.

---

## Spec Summary

10 videos, 2-5 min each, screen-recording + voiceover, 1080p, single-purpose, linked from in-app help icons via `?help=video-slug` deep-link.

| # | Title | Length | Status |
|---|---|---|---|
| 1 | Welcome to Bistro Steward | 90s | Ready to script |
| 2 | Sign up and create your account | 3m | Ready (signup.html + terms.html exist) |
| 3 | Set up your team | 2m | Ready (admin.html team UI) |
| 4 | Create your first ingredient list | 4m | Ready (manual + AI receipt scan) |
| 5 | Scan a vendor invoice | 3m | Ready (same scan op, longer doc) |
| 6 | Cost your first recipe | 5m | **Blocked** — green/red cost badge UI not built |
| 7 | Build a prep sheet | 3m | Ready |
| 8 | Count inventory with your phone | 3m | Ready |
| 9 | Send a vendor order | 4m | Ready |
| 10 | Ask the Oracle anything | 3m | **Blocked** — Oracle is voice-only, no text chat or analytical intents |

Cross-cutting blockers: help drawer + `?help=` URL handler do not exist; demo tenant has no seed script; `docs/tutorials/` directory does not exist.

## Decisions baked in

1. Build all blocker features in this task (do not defer videos 6 and 10 — CLAUDE.md "complete coverage" rule).
2. Help drawer is in scope.
3. Demo data: 40 ingredients, 15 recipes, 3 menus, 4 storage areas, 2 vendors, 1 week of mock sales.
4. Demo tenant slug: `demo-restaurant`, owner email: `demo@bistrosteward.com`.
5. YouTube channel: "Bistro Steward" (user creates).
6. Square sandbox for all card demos. Test card: `4111 1111 1111 1111`, exp `12/26`, CVV `123`, ZIP `97229`.
7. Scripts live in `docs/tutorials/NN-slug.md`, one per video, version controlled.
8. Recording, editing, upload, captioning, thumbnails — user (Anthony) executes after scripts approved.

---

## File Structure

### Created files

| Path | Responsibility |
|---|---|
| `docs/plans/2026-04-24-youtube-tutorials.md` | This plan (already created on save). |
| `docs/tutorials/README.md` | Index, recording guide, link map. |
| `docs/tutorials/01-welcome.md` | Script for video 1. |
| `docs/tutorials/02-signup.md` | Script for video 2. |
| `docs/tutorials/03-team.md` | Script for video 3. |
| `docs/tutorials/04-ingredients.md` | Script for video 4. |
| `docs/tutorials/05-vendor-invoice.md` | Script for video 5. |
| `docs/tutorials/06-recipe-costing.md` | Script for video 6. |
| `docs/tutorials/07-prep-sheet.md` | Script for video 7. |
| `docs/tutorials/08-inventory-count.md` | Script for video 8. |
| `docs/tutorials/09-vendor-order.md` | Script for video 9. |
| `docs/tutorials/10-oracle-ask.md` | Script for video 10. |
| `docs/tutorials/recording-guide.md` | OBS settings, mic config, take checklist, redaction rules. |
| `docs/tutorials/upload-checklist.md` | YouTube upload steps, thumbnail spec, chapter timestamps, caption workflow. |
| `firebase/public/help-drawer.css` | Drawer styles. |
| `firebase/public/help-drawer.js` | Drawer component, `?help=` parser, video map, deep-link handler. |
| `firebase/public/help-videos.json` | Slug → YouTube ID + title + chapter map. Editable without redeploy. |
| `firebase/functions/oracle_chat.js` | New Gemini text-chat handler with analytical intents. |
| `firebase/functions/oracle_intents/` | Per-intent SQL-like queries against tenant Firestore (margin_trend, unused_ingredients, vendor_forecast, recipe_health). |
| `scripts/seed-demo-tenant.js` | Idempotent demo tenant provisioner. |
| `scripts/seed-demo-data/ingredients.json` | 40 generic-named ingredients with vendor, unit, cost. |
| `scripts/seed-demo-data/recipes.json` | 15 recipes (e.g. caesar salad, ribeye, frites). |
| `scripts/seed-demo-data/menus.json` | 3 menus (lunch, dinner, weekend brunch). |
| `scripts/seed-demo-data/areas.json` | 4 areas (walk-in, dry storage, freezer, prep). |
| `scripts/seed-demo-data/vendors.json` | 2 vendors (Sysco, Pacific Seafood) with email contacts. |
| `scripts/seed-demo-data/sales.json` | 7 days of mock sales for shopping-list math to work. |
| `scripts/README.md` | How to run the seeder, prerequisites, ADC auth, idempotency notes. |

### Modified files

| Path | Change |
|---|---|
| `firebase/public/app.html` | Add `<link>` and `<script>` for help drawer, add help-icon buttons next to top-bar in 8 contexts, add `?help=` boot path. Add cost-badge DOM in recipe modal. Add Oracle text-chat panel (toggle from voice FAB). |
| `firebase/public/signup.html` | Audit + light copy edits if step labels do not match script 02. |
| `firebase/public/terms.html` | Audit. Add ToS-acceptance checkbox link target if not already present in signup flow. |
| `firebase/public/admin.html` | Audit team-invite labels match script 03. |
| `firebase/functions/index.js` | Wire `oracle_chat.js` into request router behind a new operation `oracleChat`. Add `seedDemoData` operation gated to super-admin. |
| `firebase/functions/package.json` | Confirm `@google/generative-ai`, add `firebase-admin` if missing for seeder (already present per memory). |

### Untouched (filming targets only)

`scan` op (`firebase/functions/index.js`), Inventory tab UI, Prep tab UI, Shopping tab UI, Vendor tab UI, onboarding wizard.

---

## Phase 0 — Recon Verification

Earlier exploration cited `firebase/public/index.html` (641-line landing page) instead of `firebase/public/app.html` (9212-line main app). Several gap claims must be re-verified before code is written.

### Task 0.1: Re-verify recipe costing UI in `app.html`

**Files:**
- Read: `firebase/public/app.html`

- [ ] **Step 1: Locate recipe modal**

```bash
grep -n "renderRecs\|recipe-modal\|recipeModal\|food.cost\|foodCost" /Users/mulefamily/Claude/Bistro-Steward/firebase/public/app.html | head -50
```

- [ ] **Step 2: Read recipe ingredient/cost section**

Read the matched lines ±60. Determine which of these exist today:
1. Per-ingredient cost computation (qty × ing.cost).
2. Recipe-total cost.
3. Yield/portion divisor.
4. Food-cost % displayed in DOM.
5. Color indicator (CSS class such as `.cost-good`, `.cost-bad`).

- [ ] **Step 3: Record findings in `docs/plans/recon-2026-04-24.md`**

Write a short table with column "exists | partial | missing" per item. This dictates whether Phase 2 builds the badge from scratch or only adds the visual layer on top of existing math.

- [ ] **Step 4: Commit**

```bash
git add docs/plans/recon-2026-04-24.md
git commit -m "docs: phase-0 recon recipe costing"
```

### Task 0.2: Re-verify Oracle chat surface in `app.html`

**Files:**
- Read: `firebase/public/app.html`

- [ ] **Step 1: Locate Oracle/voice/Gemini code**

```bash
grep -n "voiceToggle\|voiceProcess\|oracle\|gemini\|/voice\|/oracle\|chat-panel" /Users/mulefamily/Claude/Bistro-Steward/firebase/public/app.html | head -50
```

- [ ] **Step 2: Inspect transcript handling, FAB DOM, any latent text-input markup**

- [ ] **Step 3: Append findings to `docs/plans/recon-2026-04-24.md`**

Document: voice path, latency, intent-router shape, any reusable transcript display.

- [ ] **Step 4: Commit**

```bash
git add docs/plans/recon-2026-04-24.md
git commit -m "docs: phase-0 recon oracle chat"
```

### Task 0.3: Re-verify help-icon / `?help=` infrastructure

**Files:**
- Read: `firebase/public/app.html`

- [ ] **Step 1: Search**

```bash
grep -n "URLSearchParams\|location.search\|?help\|help-drawer\|helpVideo" /Users/mulefamily/Claude/Bistro-Steward/firebase/public/app.html
```

- [ ] **Step 2: Record findings.** Confirm `?help=` is unhandled. Confirm there is no global help drawer.

- [ ] **Step 3: Commit recon doc final**

```bash
git add docs/plans/recon-2026-04-24.md
git commit -m "docs: phase-0 recon complete"
```

---

## Chunk 1: Foundation — directories, help drawer, demo tenant seeder

### Task 1.1: Create `docs/tutorials/` skeleton

**Files:**
- Create: `docs/tutorials/README.md`

- [ ] **Step 1: Write README**

```markdown
# Bistro Steward Tutorial Scripts

Each script in this directory drives one YouTube video. Scripts are reviewed
before any recording happens. Once a video is uploaded, paste its YouTube ID
into `firebase/public/help-videos.json` so in-app help icons deep-link to it.

## Conventions
- Word count target: 150 words per minute of finished video.
- "Show:" lines describe screen actions. "Say:" lines are voiceover.
- "On screen:" lines are callouts/zooms the editor adds in post.
- Never include real customer data, real card numbers, real API keys, or
  real tenant UUIDs. Use the demo tenant only.

## Demo tenant
Slug `demo-restaurant`. Email `demo@bistrosteward.com`. Reset via
`node scripts/seed-demo-tenant.js --reset` before each recording session.

## Index
1. [Welcome](01-welcome.md)
2. [Sign up](02-signup.md)
3. [Team](03-team.md)
4. [Ingredients](04-ingredients.md)
5. [Vendor invoice scan](05-vendor-invoice.md)
6. [Recipe costing](06-recipe-costing.md)
7. [Prep sheet](07-prep-sheet.md)
8. [Inventory count](08-inventory-count.md)
9. [Vendor order](09-vendor-order.md)
10. [Ask the Oracle](10-oracle-ask.md)
```

- [ ] **Step 2: Commit**

```bash
git add docs/tutorials/README.md
git commit -m "docs: create tutorials skeleton"
```

### Task 1.2: Help-drawer CSS

**Files:**
- Create: `firebase/public/help-drawer.css`

- [ ] **Step 1: Write CSS** (drawer slides from right, 420px, dark theme matching app, YouTube iframe area, close X, chapter list)

```css
.help-drawer-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.55);
  opacity: 0; pointer-events: none; transition: opacity .2s; z-index: 9998;
}
.help-drawer-backdrop.open { opacity: 1; pointer-events: auto; }

.help-drawer {
  position: fixed; top: 0; right: -480px; width: 420px; max-width: 100vw;
  height: 100vh; background: #1a1d23; color: #e9ecef; box-shadow: -4px 0 24px rgba(0,0,0,.4);
  transition: right .25s ease; z-index: 9999; display: flex; flex-direction: column;
  font: 14px/1.4 -apple-system, system-ui, sans-serif;
}
.help-drawer.open { right: 0; }
.help-drawer__hdr { display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid #2a2f37; }
.help-drawer__title { font-size: 16px; font-weight: 600; }
.help-drawer__close { background: none; color: #8a92a3; border: 0; font-size: 22px; cursor: pointer; }
.help-drawer__close:hover { color: #fff; }
.help-drawer__video { aspect-ratio: 16/9; background: #000; }
.help-drawer__video iframe { width: 100%; height: 100%; border: 0; }
.help-drawer__body { padding: 16px 20px; overflow-y: auto; flex: 1; }
.help-drawer__chapters { list-style: none; padding: 0; margin: 8px 0; }
.help-drawer__chapters li { padding: 6px 0; cursor: pointer; }
.help-drawer__chapters li:hover { color: #6cb2ff; }
.help-drawer__chapters time { color: #8a92a3; margin-right: 12px; font-variant-numeric: tabular-nums; }

.help-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 50%; border: 1px solid #4a5160;
  background: transparent; color: #8a92a3; cursor: pointer; font-size: 13px;
  margin-left: 8px;
}
.help-icon-btn:hover { color: #6cb2ff; border-color: #6cb2ff; }
```

- [ ] **Step 2: Commit**

```bash
git add firebase/public/help-drawer.css
git commit -m "feat(help): drawer styles"
```

### Task 1.3: Help-video map JSON

**Files:**
- Create: `firebase/public/help-videos.json`

- [ ] **Step 1: Write file with placeholder YouTube IDs (real IDs filled in after upload)**

```json
{
  "_doc": "Slug-to-YouTube map. Replace YOUTUBE_ID_* with real ID after upload. Chapters in seconds.",
  "welcome":         { "yt": "YOUTUBE_ID_01", "title": "Welcome to Bistro Steward", "chapters": [] },
  "signup":          { "yt": "YOUTUBE_ID_02", "title": "Sign up and create your account",
                       "chapters": [[0,"Intro"],[20,"Pick a plan"],[60,"Card entry"],[120,"Verify email"],[160,"First login"]] },
  "team":            { "yt": "YOUTUBE_ID_03", "title": "Set up your team",
                       "chapters": [[0,"Intro"],[15,"Open Billing & Team"],[40,"Invite employee"],[75,"Invite manager"],[100,"Member accept"]] },
  "ingredients":     { "yt": "YOUTUBE_ID_04", "title": "Create your first ingredient list",
                       "chapters": [[0,"Intro"],[20,"Manual add"],[80,"AI scan"],[180,"Review & commit"]] },
  "vendor-invoice":  { "yt": "YOUTUBE_ID_05", "title": "Scan a vendor invoice",
                       "chapters": [[0,"Intro"],[20,"Upload"],[60,"Review"],[120,"Audit trail"]] },
  "recipe-costing":  { "yt": "YOUTUBE_ID_06", "title": "Cost your first recipe",
                       "chapters": [[0,"Intro"],[30,"New recipe"],[90,"Add ingredients"],[180,"Yield & portion"],[240,"Read the badge"]] },
  "prep-sheet":      { "yt": "YOUTUBE_ID_07", "title": "Build a prep sheet",
                       "chapters": [[0,"Intro"],[30,"Pick recipes"],[90,"Adjust pars"],[150,"Print"]] },
  "inventory-count": { "yt": "YOUTUBE_ID_08", "title": "Count inventory with your phone",
                       "chapters": [[0,"Intro"],[20,"Print blank sheet"],[80,"Walk the area"],[140,"Scan filled sheet"]] },
  "vendor-order":    { "yt": "YOUTUBE_ID_09", "title": "Send a vendor order",
                       "chapters": [[0,"Intro"],[20,"Calculate"],[120,"Review"],[180,"Email"]] },
  "oracle-ask":      { "yt": "YOUTUBE_ID_10", "title": "Ask the Oracle anything",
                       "chapters": [[0,"Intro"],[20,"Margin trends"],[80,"Stopped using"],[140,"Forecast"]] }
}
```

- [ ] **Step 2: Commit**

```bash
git add firebase/public/help-videos.json
git commit -m "feat(help): video slug map"
```

### Task 1.4: Help-drawer JS — TDD red

**Files:**
- Create: `firebase/public/help-drawer.js`
- Create: `firebase/public/__tests__/help-drawer.test.html`

- [ ] **Step 1: Write failing browser test (open `__tests__/help-drawer.test.html` in headless via Puppeteer or simple manual checklist; project lacks vitest per memory)**

Test fixture HTML (assert via `console.assert` and visible result):

```html
<!doctype html>
<html><head><link rel="stylesheet" href="../help-drawer.css"></head>
<body>
<button class="help-icon-btn" data-help="welcome">?</button>
<script src="../help-drawer.js"></script>
<script>
  // Test 1: param parser surfaces slug
  history.replaceState(null,'','?help=signup');
  console.assert(HelpDrawer._parseSlug() === 'signup', 'parseSlug should read query param');

  // Test 2: open() inserts iframe with correct embed URL and 'open' class
  HelpDrawer.open('welcome', { videos: {welcome:{yt:'abc123', title:'X', chapters:[]}} });
  const drawer = document.querySelector('.help-drawer');
  console.assert(drawer.classList.contains('open'), 'drawer should be open');
  console.assert(drawer.querySelector('iframe').src.includes('abc123'), 'iframe should embed yt id');

  // Test 3: close() removes 'open' class
  HelpDrawer.close();
  console.assert(!drawer.classList.contains('open'), 'drawer should be closed');

  // Test 4: clicking a chapter timestamp seeks via postMessage
  HelpDrawer.open('signup', { videos: {signup:{yt:'def456', title:'Y', chapters:[[60,'B']]}}});
  const li = document.querySelector('.help-drawer__chapters li');
  console.assert(li.textContent.includes('1:00'), 'chapter renders mm:ss');

  document.body.insertAdjacentHTML('beforeend','<p>All tests passed.</p>');
</script>
</body></html>
```

- [ ] **Step 2: Open test in Chrome — confirm `HelpDrawer is not defined`**

- [ ] **Step 3: Write `help-drawer.js`**

```javascript
(function (global) {
  'use strict';

  const STATE = { videos: null, mounted: false };

  function _mount() {
    if (STATE.mounted) return;
    const html = `
      <div class="help-drawer-backdrop" data-act="close-help"></div>
      <aside class="help-drawer" role="dialog" aria-label="Help">
        <header class="help-drawer__hdr">
          <span class="help-drawer__title"></span>
          <button class="help-drawer__close" data-act="close-help" aria-label="Close">×</button>
        </header>
        <div class="help-drawer__video"></div>
        <div class="help-drawer__body">
          <h4>Chapters</h4>
          <ol class="help-drawer__chapters"></ol>
        </div>
      </aside>`;
    document.body.insertAdjacentHTML('beforeend', html);
    document.body.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (t && t.dataset.act === 'close-help') close();
      const help = e.target.closest('[data-help]');
      if (help) { open(help.dataset.help); e.preventDefault(); }
    });
    STATE.mounted = true;
  }

  async function _loadMap() {
    if (STATE.videos) return STATE.videos;
    const res = await fetch('/help-videos.json', { cache: 'no-cache' });
    STATE.videos = await res.json();
    return STATE.videos;
  }

  function _fmtTime(s) {
    const m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function _parseSlug() {
    return new URLSearchParams(location.search).get('help');
  }

  async function open(slug, override) {
    _mount();
    const map = override?.videos || await _loadMap();
    const v = map[slug];
    if (!v || !v.yt || v.yt.startsWith('YOUTUBE_ID_')) {
      console.warn('Help: no video for', slug);
      return;
    }
    const drawer = document.querySelector('.help-drawer');
    drawer.querySelector('.help-drawer__title').textContent = v.title;
    drawer.querySelector('.help-drawer__video').innerHTML =
      `<iframe src="https://www.youtube-nocookie.com/embed/${v.yt}?enablejsapi=1&rel=0"
               allow="accelerometer; encrypted-media; picture-in-picture"
               allowfullscreen></iframe>`;
    const chap = drawer.querySelector('.help-drawer__chapters');
    chap.innerHTML = (v.chapters || []).map(([t, label]) =>
      `<li data-t="${t}"><time>${_fmtTime(t)}</time>${label}</li>`).join('');
    chap.onclick = (e) => {
      const li = e.target.closest('li[data-t]');
      if (!li) return;
      const iframe = drawer.querySelector('iframe');
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: 'seekTo', args: [+li.dataset.t, true] }),
        '*');
    };
    drawer.classList.add('open');
    drawer.previousElementSibling.classList.add('open');
  }

  function close() {
    const d = document.querySelector('.help-drawer');
    if (d) {
      d.classList.remove('open');
      d.previousElementSibling.classList.remove('open');
      d.querySelector('.help-drawer__video').innerHTML = '';
    }
  }

  function boot() {
    const slug = _parseSlug();
    if (slug) {
      document.addEventListener('DOMContentLoaded', () => open(slug));
    }
  }

  global.HelpDrawer = { open, close, boot, _parseSlug };
  boot();
})(window);
```

- [ ] **Step 4: Reload test fixture, confirm "All tests passed."**

- [ ] **Step 5: Commit**

```bash
git add firebase/public/help-drawer.js firebase/public/__tests__/help-drawer.test.html
git commit -m "feat(help): drawer + ?help= deep-linker"
```

### Task 1.5: Wire help drawer into `app.html`

**Files:**
- Modify: `firebase/public/app.html`

- [ ] **Step 1: Add stylesheet + script in `<head>`**

```html
<link rel="stylesheet" href="help-drawer.css">
<script src="help-drawer.js" defer></script>
```

- [ ] **Step 2: Add help-icon buttons in 8 places (one per video that has an in-app target).**

Snippets to inject next to each tab/section header — exact location during execution after grep:

| Tab/section | data-help slug |
|---|---|
| Onboarding wizard step 0 | `welcome` |
| Top-bar billing dropdown row | `signup` |
| admin.html team section | `team` |
| Ingredients tab header | `ingredients` |
| Inventory "Scan Sheet" button row | `vendor-invoice` |
| Recipes tab header | `recipe-costing` |
| Prep tab header | `prep-sheet` |
| Inventory tab header | `inventory-count` |
| Shopping tab header | `vendor-order` |
| Voice/chat panel header | `oracle-ask` |

Pattern to add next to existing header element:

```html
<button class="help-icon-btn" data-help="recipe-costing" title="Watch tutorial">?</button>
```

- [ ] **Step 3: Manual check**

Boot `firebase emulators:start --only hosting`, visit `http://localhost:5000/app.html?help=welcome`, confirm drawer opens with placeholder iframe (which 404s until real YouTube IDs are pasted — that is expected).

- [ ] **Step 4: Commit**

```bash
git add firebase/public/app.html firebase/public/admin.html
git commit -m "feat(help): wire drawer + 10 help icons"
```

### Task 1.6: Demo-data fixtures

**Files:**
- Create: `scripts/seed-demo-data/areas.json`
- Create: `scripts/seed-demo-data/vendors.json`
- Create: `scripts/seed-demo-data/ingredients.json`
- Create: `scripts/seed-demo-data/recipes.json`
- Create: `scripts/seed-demo-data/menus.json`
- Create: `scripts/seed-demo-data/sales.json`

- [ ] **Step 1: Write `areas.json`**

```json
[
  { "id": 1, "name": "Walk-in Cooler", "type": "fridge" },
  { "id": 2, "name": "Dry Storage",    "type": "dry"    },
  { "id": 3, "name": "Freezer",        "type": "freezer"},
  { "id": 4, "name": "Prep Line",      "type": "prep"   }
]
```

- [ ] **Step 2: Write `vendors.json`**

```json
[
  { "id": 1, "name": "Sysco Portland",     "email": "orders+demo@example-sysco.test",   "phone": "(503) 555-0142", "notes": "Tue/Fri delivery, 10am cutoff" },
  { "id": 2, "name": "Pacific Seafood Co", "email": "orders+demo@example-pacific.test", "phone": "(503) 555-0177", "notes": "Daily delivery 6am" }
]
```

- [ ] **Step 3: Write `ingredients.json` — 40 ingredients with realistic-yet-fake names, units, costs, vendorId, areaId**

Pattern (excerpt — full file in repo):

```json
[
  { "id": 1,  "name": "Yellow Onion",       "unit": "lb",   "packSize": 50,   "packCost": 32.50, "cost": 0.65, "vendorId": 1, "areaId": 2 },
  { "id": 2,  "name": "Garlic, Whole",      "unit": "lb",   "packSize": 5,    "packCost": 28.00, "cost": 5.60, "vendorId": 1, "areaId": 2 },
  { "id": 3,  "name": "Olive Oil, EVOO",    "unit": "L",    "packSize": 4,    "packCost": 96.00, "cost": 24.00,"vendorId": 1, "areaId": 2 },
  { "id": 4,  "name": "Kosher Salt",        "unit": "lb",   "packSize": 12,   "packCost": 18.00, "cost": 1.50, "vendorId": 1, "areaId": 2 },
  { "id": 5,  "name": "Black Pepper, GR",   "unit": "lb",   "packSize": 5,    "packCost": 95.00, "cost": 19.00,"vendorId": 1, "areaId": 2 },
  { "id": 6,  "name": "Romaine, hearts",    "unit": "case", "packSize": 12,   "packCost": 36.00, "cost": 3.00, "vendorId": 1, "areaId": 1 },
  { "id": 7,  "name": "Parmigiano-Reggiano","unit": "lb",   "packSize": 1,    "packCost": 22.00, "cost": 22.00,"vendorId": 1, "areaId": 1 },
  { "id": 8,  "name": "Lemon",              "unit": "ea",   "packSize": 165,  "packCost": 49.50, "cost": 0.30, "vendorId": 1, "areaId": 1 }
  /* … 32 more, including ribeye, salmon, butter, eggs, flour, sugar, yeast,
     basil, parsley, thyme, rosemary, capers, anchovies, dijon, mayo, panko,
     fries, pasta, tomato passata, heavy cream, milk, brioche, bacon, mushrooms,
     scallions, shallots, white wine, red wine, balsamic, sherry, Dover sole,
     ahi tuna, prawns, butter clams */
]
```

(Full 40-row JSON written during execution; values are illustrative restaurant pricing — Anthony reviews before filming.)

- [ ] **Step 4: Write `recipes.json` — 15 recipes referencing only seeded ingredient IDs**

Recipes: Caesar Salad, Ribeye 14oz, Frites, Pan-Seared Salmon, Margherita Pizza Dough, Tomato Sauce, Hollandaise, Brioche French Toast, Mushroom Risotto, Cacio e Pepe, Burger Patty 8oz, Buttermilk Biscuit, Chocolate Mousse, House Vinaigrette, Garlic Confit.

Each recipe: `{ id, name, yieldQty, yieldUnit, portionQty, portionUnit, menuPrice, ingredients: [{id, qty, unit}, ...] }`.

- [ ] **Step 5: Write `menus.json`**

```json
[
  { "id": 1, "name": "Lunch",          "items": [/* recipeIds */] },
  { "id": 2, "name": "Dinner",         "items": [/* recipeIds */] },
  { "id": 3, "name": "Weekend Brunch", "items": [/* recipeIds */] }
]
```

- [ ] **Step 6: Write `sales.json` — 7 days × 3 menus × randomized covers (40-110/day) for shopping-list math**

- [ ] **Step 7: Commit**

```bash
git add scripts/seed-demo-data/
git commit -m "data: demo-tenant seed fixtures (40 ing / 15 rec / 3 menu / 4 area / 2 vendor / 7d sales)"
```

### Task 1.7: Demo-tenant seeder script

**Files:**
- Create: `scripts/seed-demo-tenant.js`
- Create: `scripts/README.md`

- [ ] **Step 1: Write seeder using firebase-admin + ADC (org policy blocks SA keys per memory)**

```javascript
#!/usr/bin/env node
/**
 * Idempotent demo-tenant seeder.
 *
 * Usage:
 *   node scripts/seed-demo-tenant.js              # create or upsert
 *   node scripts/seed-demo-tenant.js --reset      # delete then recreate
 *   node scripts/seed-demo-tenant.js --dry-run    # print plan only
 *
 * Auth: relies on Application Default Credentials
 *       (gcloud auth application-default login).
 */
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'restaurant-oracle-prod' });
const db = admin.firestore();
const auth = admin.auth();

const TENANT_SLUG  = 'demo-restaurant';
const OWNER_EMAIL  = 'demo@bistrosteward.com';
const TENANT_NAME  = 'Demo Bistro (filming only)';

const args = new Set(process.argv.slice(2));
const RESET   = args.has('--reset');
const DRY_RUN = args.has('--dry-run');

async function load(name) {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, 'seed-demo-data', name + '.json'), 'utf8'));
}

async function ensureUser() {
  try { return await auth.getUserByEmail(OWNER_EMAIL); }
  catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    return auth.createUser({
      email: OWNER_EMAIL,
      password: '***REMOVED***',
      displayName: 'Demo Owner',
      emailVerified: true,
    });
  }
}

async function ensureTenant(uid) {
  const ref = db.collection('tenants').doc(TENANT_SLUG);
  await ref.set({
    name: TENANT_NAME,
    slug: TENANT_SLUG,
    ownerEmail: OWNER_EMAIL,
    ownerUid: uid,
    plan: 'pro',
    status: 'active',
    onboardingComplete: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    isDemo: true,
  }, { merge: true });
  return ref;
}

async function setClaims(uid) {
  await auth.setCustomUserClaims(uid, {
    tenantId: TENANT_SLUG,
    tenantSlug: TENANT_SLUG,
    approved: true,
    role: 'owner',
    isDemo: true,
  });
}

async function seedCollection(tenantRef, name, rows) {
  const col = tenantRef.collection(name);
  const batch = db.batch();
  rows.forEach((row) => batch.set(col.doc(String(row.id)), row));
  await batch.commit();
  console.log('  seeded', name, '×', rows.length);
}

async function reset(tenantRef) {
  for (const c of ['ingredients', 'recipes', 'menus', 'areas', 'vendors', 'sales', 'inventory']) {
    const snap = await tenantRef.collection(c).get();
    const batch = db.batch();
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

(async () => {
  console.log(DRY_RUN ? '[DRY RUN]' : 'Seeding demo tenant...');
  const user   = await ensureUser();
  const tenant = await ensureTenant(user.uid);
  await setClaims(user.uid);
  if (RESET) { console.log('Resetting collections...'); await reset(tenant); }

  for (const name of ['areas', 'vendors', 'ingredients', 'recipes', 'menus', 'sales']) {
    const rows = await load(name);
    if (DRY_RUN) console.log('  would seed', name, '×', rows.length);
    else        await seedCollection(tenant, name, rows);
  }

  console.log('Done. Login: ' + OWNER_EMAIL + ' / ***REMOVED***');
  console.log('URL: https://bistrosteward.com/app.html');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: `scripts/README.md`**

```markdown
# Bistro Steward Scripts

## Seeding the demo tenant

Prereqs:
- `gcloud auth application-default login` (ADC)
- Project: `restaurant-oracle-prod` selected
- `npm install` (firebase-admin already pinned in functions/)

Run:
- `node scripts/seed-demo-tenant.js` — create or upsert
- `node scripts/seed-demo-tenant.js --reset` — wipe + reseed (use before each filming session)
- `node scripts/seed-demo-tenant.js --dry-run` — preview only

The seeder is idempotent. Tenant doc has `isDemo: true` so it can never be billed and never appears in production reports.
```

- [ ] **Step 3: Dry-run**

```bash
cd /Users/mulefamily/Claude/Bistro-Steward
node scripts/seed-demo-tenant.js --dry-run
```

Expected: prints `would seed ingredients × 40`, etc., exits 0.

- [ ] **Step 4: Real run**

```bash
node scripts/seed-demo-tenant.js --reset
```

Expected: creates user, tenant, claims, all collections. Login at https://bistrosteward.com/app.html with the printed credentials confirms onboarding is complete and ingredients tab shows 40 rows.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-demo-tenant.js scripts/README.md
git commit -m "feat(seed): idempotent demo-tenant seeder"
```

---

## Chunk 2: Missing UI features (cost badge + Oracle text chat)

### Task 2.1: Recipe cost-badge — TDD

Phase 0 recon dictates whether the math already exists or must be added. Two branches.

#### Branch A — math already exists, only DOM/CSS missing

**Files:**
- Modify: `firebase/public/app.html` (recipe modal section)

- [ ] **Step 1: Add badge DOM next to recipe header**

```html
<span class="cost-badge" data-recipe-cost-pct>
  <span class="cost-badge__pct">--%</span>
  <span class="cost-badge__lbl">food cost</span>
</span>
```

- [ ] **Step 2: Add CSS in app.html `<style>` block**

```css
.cost-badge {
  display: inline-flex; flex-direction: column; padding: 6px 12px;
  border-radius: 8px; font: 12px/1 -apple-system, sans-serif; min-width: 78px;
  text-align: center; margin-left: 12px;
}
.cost-badge__pct { font-size: 18px; font-weight: 700; }
.cost-badge.cost-good { background: #1f5132; color: #b8eccb; }
.cost-badge.cost-warn { background: #4a3d12; color: #f3d97e; }
.cost-badge.cost-bad  { background: #5a1f24; color: #ffb3ba; }
```

- [ ] **Step 3: Hook into existing render (call site identified in recon)**

```javascript
function _updateCostBadge(recipe) {
  const totalCost = (recipe.ingredients || [])
    .reduce((s, ri) => s + (ri.qty * (D.ings.find(i => i.id === ri.id)?.cost || 0)), 0);
  const portionCost = totalCost / Math.max(1, recipe.yieldQty / recipe.portionQty);
  const pct = recipe.menuPrice > 0 ? (portionCost / recipe.menuPrice) * 100 : 0;
  const el = document.querySelector('[data-recipe-cost-pct]');
  if (!el) return;
  el.querySelector('.cost-badge__pct').textContent = pct.toFixed(1) + '%';
  el.classList.remove('cost-good', 'cost-warn', 'cost-bad');
  el.classList.add(pct < 30 ? 'cost-good' : pct < 40 ? 'cost-warn' : 'cost-bad');
}
```

#### Branch B — math missing, both math and badge required

Same as Branch A plus the cost computation lives inline already.

- [ ] **Step 4: Manual test**

Open Caesar Salad in demo tenant. Confirm badge reads `28.x%` green. Edit recipe to set menuPrice = $8 instead of $14 — badge flips to red.

- [ ] **Step 5: Commit**

```bash
git add firebase/public/app.html
git commit -m "feat(recipes): green/red food-cost badge"
```

### Task 2.2: Oracle text-chat backend handler

**Files:**
- Create: `firebase/functions/oracle_chat.js`
- Create: `firebase/functions/oracle_intents/margin_trend.js`
- Create: `firebase/functions/oracle_intents/unused_ingredients.js`
- Create: `firebase/functions/oracle_intents/vendor_forecast.js`
- Create: `firebase/functions/oracle_intents/recipe_health.js`
- Create: `firebase/functions/__tests__/oracle_chat.test.js`
- Modify: `firebase/functions/index.js` (route)

- [ ] **Step 1: Failing test (use built-in `node:test` since project lacks test framework — confirm with `package.json` audit during exec)**

```javascript
// __tests__/oracle_chat.test.js
const test = require('node:test');
const assert = require('node:assert');
const { classifyIntent, runIntent } = require('../oracle_chat');

test('margin trend question routes to margin_trend intent', () => {
  assert.strictEqual(classifyIntent('which recipes have shrinking margin'), 'margin_trend');
  assert.strictEqual(classifyIntent('what items are losing money'),         'margin_trend');
});

test('unused ingredients question routes correctly', () => {
  assert.strictEqual(classifyIntent('what ingredients have I stopped using'), 'unused_ingredients');
});

test('forecast question routes correctly', () => {
  assert.strictEqual(classifyIntent('forecast my beef order for next week'), 'vendor_forecast');
});

test('runIntent margin_trend returns ranked rows', async () => {
  const fakeDb = {
    /* mock that returns 5 recipes with cost history */
  };
  const out = await runIntent('margin_trend', { tenantId: 'demo-restaurant', db: fakeDb });
  assert.ok(Array.isArray(out.rows));
  assert.ok('summary' in out);
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd firebase/functions
node --test __tests__/oracle_chat.test.js
```

Expected: `Error: Cannot find module '../oracle_chat'`.

- [ ] **Step 3: Implement classifier (lightweight rule-based; LLM as fallback)**

```javascript
// oracle_chat.js
const intents = require('./oracle_intents');

const RULES = [
  { intent: 'margin_trend',       re: /(margin|profit).*(shrink|down|lose|drop)|losing money|low margin/i },
  { intent: 'unused_ingredients', re: /(ingredient|item).*(stopped|not using|unused|dead)/i },
  { intent: 'vendor_forecast',    re: /(forecast|predict|next.*(week|month)|estimate.*order)/i },
  { intent: 'recipe_health',      re: /(top|worst|best).*(recipe|item)|recipe.*health/i },
];

function classifyIntent(text) {
  for (const r of RULES) if (r.re.test(text)) return r.intent;
  return 'unknown';
}

async function runIntent(name, ctx) {
  const fn = intents[name];
  if (!fn) return { summary: "I don't know how to answer that yet.", rows: [] };
  return fn(ctx);
}

async function handleChat({ tenantId, message, db }) {
  const intent = classifyIntent(message);
  if (intent === 'unknown') {
    return { intent, summary:
      "Try asking about margin trends, unused ingredients, vendor forecasts, or recipe health.", rows: [] };
  }
  return { intent, ...(await runIntent(intent, { tenantId, db })) };
}

module.exports = { classifyIntent, runIntent, handleChat };
```

- [ ] **Step 4: Implement four intents (one file each)**

`oracle_intents/margin_trend.js`:

```javascript
module.exports = async function ({ tenantId, db }) {
  const recipes = await db.collection(`tenants/${tenantId}/recipes`).get();
  const sales   = await db.collection(`tenants/${tenantId}/sales`).get();
  // Compute per-recipe avg cost over last 7 vs prior 7 days.
  // Rank by delta (cost up = margin shrinking).
  const rows = []; // {recipeId, name, marginDelta, currentPct, priorPct}
  // ... implementation reads cost history, pairs with menuPrice, returns top 10.
  rows.sort((a, b) => a.marginDelta - b.marginDelta);
  return {
    summary: rows.length
      ? `${rows.slice(0,3).map(r=>r.name).join(', ')} have the biggest margin drops this week.`
      : "No margin shrink detected.",
    rows: rows.slice(0, 10),
  };
};
```

`oracle_intents/unused_ingredients.js`, `vendor_forecast.js`, `recipe_health.js` — same pattern, each ~30-60 lines.

`oracle_intents/index.js`:

```javascript
module.exports = {
  margin_trend:       require('./margin_trend'),
  unused_ingredients: require('./unused_ingredients'),
  vendor_forecast:    require('./vendor_forecast'),
  recipe_health:      require('./recipe_health'),
};
```

- [ ] **Step 5: Run tests, confirm pass**

```bash
node --test __tests__/oracle_chat.test.js
```

Expected: all 4 tests pass.

- [ ] **Step 6: Wire into `index.js` request router**

In `firebase/functions/index.js`, find the existing `secureApi` operation switch. Add:

```javascript
case 'oracleChat': {
  const { handleChat } = require('./oracle_chat');
  const r = await handleChat({
    tenantId: claims.tenantId, message: data.message, db: admin.firestore(),
  });
  return { ok: true, ...r };
}
```

Add `'oracleChat'` to `ALLOWED_OPERATIONS` and `PERMISSION_MATRIX` (per memory: required for all new ops).

- [ ] **Step 7: Commit**

```bash
git add firebase/functions/oracle_chat.js firebase/functions/oracle_intents/ \
        firebase/functions/__tests__/oracle_chat.test.js firebase/functions/index.js
git commit -m "feat(oracle): text-chat handler with 4 analytical intents"
```

### Task 2.3: Oracle text-chat front-end panel

**Files:**
- Modify: `firebase/public/app.html`

- [ ] **Step 1: Add chat panel DOM (toggle button next to voice FAB)**

```html
<button class="oracle-chat-toggle" onclick="oracleChatToggle()" title="Ask the Oracle">💬</button>
<aside class="oracle-chat-panel" id="oracle-chat" hidden>
  <header>Oracle <button onclick="oracleChatToggle()" aria-label="close">×</button></header>
  <ol class="oracle-chat-log" id="oracle-chat-log"></ol>
  <form onsubmit="oracleChatSend(event)">
    <input id="oracle-chat-input" placeholder="Ask about margins, vendors, recipes..." autocomplete="off">
    <button type="submit">Ask</button>
  </form>
</aside>
```

- [ ] **Step 2: Add CSS — dock right, 380px, dark theme**

- [ ] **Step 3: Add JS**

```javascript
function oracleChatToggle() {
  const p = document.getElementById('oracle-chat');
  p.hidden = !p.hidden;
  if (!p.hidden) document.getElementById('oracle-chat-input').focus();
}

async function oracleChatSend(e) {
  e.preventDefault();
  const inp = document.getElementById('oracle-chat-input');
  const msg = inp.value.trim(); if (!msg) return;
  _oracleAppend('user', msg); inp.value = ''; _oracleAppend('bot', '...');
  try {
    const r = await secureApi('oracleChat', { message: msg });
    _oraclePop();
    _oracleAppend('bot', r.summary);
    if (r.rows && r.rows.length) _oracleAppend('table', r.rows);
  } catch (err) {
    _oraclePop();
    _oracleAppend('bot', 'Error: ' + err.message);
  }
}

function _oracleAppend(kind, payload) {
  const log = document.getElementById('oracle-chat-log');
  const li = document.createElement('li');
  li.className = 'msg msg--' + kind;
  if (kind === 'table') {
    const cols = Object.keys(payload[0] || {});
    li.innerHTML = '<table><thead><tr>' +
      cols.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>' +
      payload.map(r => '<tr>' + cols.map(c => `<td>${r[c]}</td>`).join('') + '</tr>').join('') +
      '</tbody></table>';
  } else { li.textContent = payload; }
  log.appendChild(li); log.scrollTop = log.scrollHeight;
}
function _oraclePop() {
  const log = document.getElementById('oracle-chat-log');
  if (log.lastElementChild?.classList.contains('msg--bot') &&
      log.lastElementChild.textContent === '...') log.lastElementChild.remove();
}
```

- [ ] **Step 4: Manual test against demo tenant**

Type "which recipes have shrinking margin" → expect summary + table.
Type "what's the weather" → expect "Try asking about..." fallback.

- [ ] **Step 5: Commit**

```bash
git add firebase/public/app.html
git commit -m "feat(oracle): text-chat UI panel"
```

---

## Chunk 3: Tutorial scripts (10)

Each script is a single Markdown file ~200-700 words with three sections: **Hook** (≤15s), **Body** (numbered show/say steps), **Outro** (≤10s, link to next video). Word count = 150 wpm × runtime.

### Task 3.1: Script 01 — Welcome (90s ≈ 225 words)

**File:** `docs/tutorials/01-welcome.md`

- [ ] **Step 1: Write script** (template; full prose during execution)

```markdown
# 01 — Welcome to Bistro Steward (90 seconds)

**Runtime:** 90s. **Word target:** 225. **Slug:** `welcome`.

## Hook (0:00–0:15)
Show: marketing landing page top fold.
Say: "If you run a restaurant, you already know food cost is your hardest math
problem. Bistro Steward is the tool I built to make that math invisible — so
you can run service instead of fighting spreadsheets."

## Body (0:15–1:15)
Show: 4-up grid (inventory, recipes, prep, oracle).
Say:
1. Track ingredient cost down to the unit.
2. Cost every recipe automatically.
3. Build prep sheets in seconds.
4. Ask the Oracle questions like "which dishes are losing me money."

## Outro (1:15–1:30)
Show: signup button.
Say: "In the next video I'll set up a brand-new account. Hit subscribe so you
catch every tutorial."
On screen: "Next: Sign up and create your account."
```

- [ ] **Step 2: Commit**

```bash
git add docs/tutorials/01-welcome.md
git commit -m "docs(tutorial): script 01 welcome"
```

### Task 3.2: Script 02 — Sign up (3 min ≈ 450 words)

**File:** `docs/tutorials/02-signup.md`

Cover: open `/signup`, pick Pro plan, enter Square sandbox card `4111 1111 1111 1111`, accept ToS via `/terms.html` link, click "Create account", check inbox for verification, click link, land in onboarding.

- [ ] **Step 1: Write script with explicit show/say beats matching the real `signup.html` (1504 lines) — script-writer reads file first, transcribes button labels verbatim**

- [ ] **Step 2: Commit**

```bash
git add docs/tutorials/02-signup.md
git commit -m "docs(tutorial): script 02 signup"
```

### Task 3.3: Script 03 — Team (2 min ≈ 300 words)

**File:** `docs/tutorials/03-team.md`

Cover: open Billing & Team dropdown, invite `kim@example.test` as Employee, invite `jose@example.test` as Manager (admin), explain role differences (employee = read+log inventory; admin = full minus billing; owner = everything). Show member-acceptance flow via a second browser window logged in as the demo Manager.

- [ ] **Step 1: Write**
- [ ] **Step 2: Commit**

### Task 3.4: Script 04 — Ingredients (4 min ≈ 600 words)

**File:** `docs/tutorials/04-ingredients.md`

Cover: manual add (1 min), AI receipt scan against a real grocery receipt (3 min) — upload, watch Gemini parse, review the suggestion modal, edit one wrong cost, commit, see ingredients land in walk-in area.

- [ ] **Step 1: Source a clean grocery receipt photo (no PII). Save to `docs/tutorials/_assets/04-receipt.jpg`. Use a generic Costco/Restaurant Depot or hand-write one for filming.**
- [ ] **Step 2: Write**
- [ ] **Step 3: Commit**

### Task 3.5: Script 05 — Vendor invoice (3 min ≈ 450 words)

**File:** `docs/tutorials/05-vendor-invoice.md`

Cover: longer multi-page invoice scan, price updates on existing ingredients (audit trail entry), how the diff is presented (old → new), undo/keep choices, commit.

- [ ] **Step 1: Source mock vendor invoice PDF. `docs/tutorials/_assets/05-invoice.pdf`.**
- [ ] **Step 2: Write**
- [ ] **Step 3: Commit**

### Task 3.6: Script 06 — Recipe costing (5 min ≈ 750 words)

**File:** `docs/tutorials/06-recipe-costing.md`

Cover: new recipe "Caesar Salad", add 6 ingredients with exact qty, set yield 1 batch / portion 1 salad, set menu price $14, watch the badge tick from grey → 28.6% green. Then bump menu price to $9 → flips to red. Then add an extra anchovy — see badge nudge up. Explain target ranges (28-32% rule of thumb).

- [ ] **Step 1: Write — REQUIRES Task 2.1 cost-badge to be merged first**
- [ ] **Step 2: Commit**

### Task 3.7: Script 07 — Prep sheet (3 min ≈ 450 words)

**File:** `docs/tutorials/07-prep-sheet.md`

Cover: open Prep tab, see 120 prep items pre-loaded from demo tenant, sort by area, tomorrow has 80 covers — set par, hit Print, show landscape PDF.

- [ ] **Step 1: Write**
- [ ] **Step 2: Commit**

### Task 3.8: Script 08 — Inventory count (3 min ≈ 450 words)

**File:** `docs/tutorials/08-inventory-count.md`

Cover: print blank count sheet for Walk-in area, walk through cooler with phone, hand-write counts, scan filled sheet via inventory scan, review modal, commit.

- [ ] **Step 1: Write**
- [ ] **Step 2: Commit**

### Task 3.9: Script 09 — Vendor order (4 min ≈ 600 words)

**File:** `docs/tutorials/09-vendor-order.md`

Cover: hit "Calculate Shopping List from Prep Needs", review demand by vendor (Sysco vs Pacific Seafood), bump up flour because cooler door broke, click "Email Order" for Sysco, show drafted email body, send.

- [ ] **Step 1: Confirm vendor email backend works in demo (or wire it). Memory says "Email backend assumed".**
- [ ] **Step 2: Write**
- [ ] **Step 3: Commit**

### Task 3.10: Script 10 — Ask the Oracle (3 min ≈ 450 words)

**File:** `docs/tutorials/10-oracle-ask.md`

Cover: open chat panel, ask "which recipes have shrinking margin" (margin_trend), "what ingredients have I stopped using" (unused_ingredients), "forecast my beef order for next week" (vendor_forecast). Each answer shows summary + table.

- [ ] **Step 1: Write — REQUIRES Tasks 2.2 + 2.3 merged first**
- [ ] **Step 2: Commit**

### Task 3.11: Recording + upload guides

**Files:**
- Create: `docs/tutorials/recording-guide.md`
- Create: `docs/tutorials/upload-checklist.md`

- [ ] **Step 1: `recording-guide.md` covers**

OBS scene preset (1440p source, 1080p output, 30fps, MKV). Mic config (Shure MV7 USB, gain -18 LUFS, popfilter 6 in). Browser zoom 110% for clarity. Hide bookmarks bar, history sidebar, every notification. Use Chrome incognito with `?help=` disabled in URL bar shortcut. Pre-flight: `node scripts/seed-demo-tenant.js --reset`. Redaction list: never show another tenant in localStorage, never show super-admin nav, never show real email inbox other than demo, never show URL bar containing real tenant UUID.

- [ ] **Step 2: `upload-checklist.md` covers**

YouTube channel "Bistro Steward" creation steps, channel art spec (2560×1440), thumbnail spec (1280×720, brand red `#c0392b`, 60pt Inter Bold title, screenshot of relevant screen), upload form fields (title format `EP NN — Title (Bistro Steward Tutorial)`, description template with chapter timestamps + bistrosteward.com link), playlist "Getting Started with Bistro Steward" ordered 1→10, captions workflow (auto-generate, then download SRT, manually correct, re-upload), end-screen template (subscribe + next video). After upload, paste real YouTube ID into `firebase/public/help-videos.json` and redeploy.

- [ ] **Step 3: Commit**

```bash
git add docs/tutorials/recording-guide.md docs/tutorials/upload-checklist.md
git commit -m "docs(tutorial): recording + upload guides"
```

---

## Chunk 4: Review gate + handoff

### Task 4.1: Open script-review PR

- [ ] **Step 1: Push branch**

```bash
git checkout -b youtube-tutorials
git push -u origin youtube-tutorials
```

- [ ] **Step 2: Open PR titled `feat: YouTube tutorial series (10 videos) + help drawer + demo seeder`**

PR body: lists each script, blocker features built, demo tenant credentials (in a private note, not the body), explicit ask "Anthony reviews scripts before any recording".

- [ ] **Step 3: STOP. Do not record until Anthony approves PR.**

### Task 4.2: Recording + upload (USER ACTION)

After PR merged, Anthony:

- [ ] Buys/installs OBS Studio + Descript per `recording-guide.md`.
- [ ] Records each video against the demo tenant on a clean Chrome profile.
- [ ] Edits in Descript, exports 1080p MP4.
- [ ] Uploads each to YouTube channel "Bistro Steward".
- [ ] Adds captions (YouTube auto, then manual correction, ~10 min/video).
- [ ] Adds chapter timestamps from the script's chapters list.
- [ ] Adds thumbnails per `upload-checklist.md`.
- [ ] Creates playlist "Getting Started with Bistro Steward".
- [ ] Pastes real YouTube IDs into `firebase/public/help-videos.json`, redeploys.

### Task 4.3: Final verification (USER ACTION)

- [ ] Open https://bistrosteward.com/app.html?help=welcome — drawer plays correct video.
- [ ] Repeat for all 10 slugs.
- [ ] YouTube channel screenshot showing 10+ videos with captions.
- [ ] Playlist URL verified.

---

## Verification matrix

| Deliverable | Verifier | Pass criterion |
|---|---|---|
| 10 scripts in `docs/tutorials/` | Anthony PR review | All approved |
| Help drawer wired | `?help=welcome` query opens drawer | Drawer slides in, iframe loads |
| Demo tenant seeded | `scripts/seed-demo-tenant.js --reset` | Login + 40 ing/15 rec visible |
| Cost badge | Caesar Salad recipe | Shows `28.6%` green; flips red at $9 price |
| Oracle chat | Type "which recipes have shrinking margin" | Returns summary + ranked table |
| Videos uploaded | YouTube channel page | 10 entries with captions + chapters |
| Deep links | `?help=<each-of-10-slugs>` | Each opens correct video |

## Effort estimate

| Phase | Owner | Time |
|---|---|---|
| Phase 0 recon | Claude | 30 min |
| Chunk 1 foundation | Claude | 1 day |
| Chunk 2 features | Claude | 1.5 days |
| Chunk 3 scripts (10) | Claude | 1 day |
| Phase 4.1 PR + review | Anthony | 0.5 day |
| Phase 4.2 recording + edit | Anthony | 10 days (1/video) |
| Phase 4.2 captions + thumbs | Anthony | 2 days |
| Phase 4.3 verification | Anthony | 0.5 day |
| **Total** | | ~16 working days |

## Constraints recap

- No record until scripts approved.
- Demo data only — no real customer info.
- Square sandbox only — no real cards on camera.
- Hide all credentials, API keys, tenant UUIDs in editing pass.
- 1080p min, 30fps, no music, captions required, max 5 min runtime per video.
