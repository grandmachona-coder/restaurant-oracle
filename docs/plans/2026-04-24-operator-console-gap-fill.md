# Operator Console Gap-Fill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the five concrete integration gaps in the operator-management dashboard (`super-admin.html`) and ship it to production at `restaurantoracle.app`. The dashboard UI and 54 Cloud Function ops already exist locally but are uncommitted, undeployed, and have broken seams: the impersonation flow is half-wired, no Gemini token data ever lands in the cost rollups, and the customer-side feedback widget is missing entirely.

**Architecture:** Extend the existing single-file dashboard (`firebase/public/super-admin.html`, 1925 LOC) and the Phase-2 super-admin CF dispatcher (`firebase/functions/index.js`, 5149 LOC). No new files unless required. Touch the main app (`firebase/public/index.html`) only for the two integration points: feedback widget + impersonation handler/banner. All writes flow through the existing `secureApi` `submitFeedback` op for feedback and a new in-`index.js` `logGeminiUsage` helper for token tracking. Impersonation read-only enforcement happens in `secureApi`'s request gate by inspecting the verified ID token's custom claims.

**Tech Stack:** Firebase Auth (compat SDK 10.7.1), Firestore, Cloud Functions Gen 1, Vanilla JS, no new npm deps.

**Decision log (from brainstorming):**
- Q1=A: ship all gaps in one PR, not phased.
- Q2=A: real per-call Gemini token logging — wrap the existing call sites; no estimation.
- Q3=A: per-feature feedback widget in `index.html` writing real events (no widget = empty data, broken Feedback tab).
- Q4=A: impersonation via short-lived custom token in a new tab + `readOnly` claim enforced server-side.
- Q5=A: gap-fill, do not rebuild the existing dashboard.

**Live-prod safety constraints:**
- Never break existing tenant data flows (`secureApi` writes for `ings`/`inv`/`recs`/etc.).
- Every change behind `super_admin` claim except the feedback widget (which is open to any signed-in tenant user).
- Don't deploy to production without running the existing `_e2e_super_admin.js` test against the live or emulator endpoint first.
- Auto Mode (per `~/.claude/CLAUDE.md`) means do not pause for confirmation between steps once the user approves this plan — only pause for failed tests or unexpected error output.

---

## Task 1 — Add `logGeminiUsage` helper and wire it into the voice Gemini call

**Files:**
- Modify: `firebase/functions/index.js` — add helper near other helpers (~line 287, after `writeAuditLog`); wrap the voice call at lines 693–815.

**Step 1: Read context around the voice Gemini call**

Run: `sed -n '680,820p' firebase/functions/index.js`

Confirm the Gemini call pattern: `model.generateContent(prompt)` returning a `result` whose `result.response.usageMetadata` contains `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`. Capture these for the log.

**Step 2: Add the `logGeminiUsage` helper**

Insert this helper after `writeAuditLog` (~line 345 after the existing helper closes). Place above the `setSecurityHeaders` block:

```javascript
// ============================================================================
// GEMINI TOKEN USAGE LOGGING
// ============================================================================
// Writes one doc per Gemini call so dailyTenantCostAggregation can roll it up.
// Per-tenant subcollection so reads stay scoped to the tenant.
//
// Schema: tenants/{tenantId}/geminiUsage/{auto}
//   { tenantId, userId, op, model, inputTokens, outputTokens, totalTokens,
//     latencyMs, success, errorCode, timestamp }
//
// Failure to write is non-fatal — never let a logging error break a user-
// facing Gemini response. Errors are console.warn only.

async function logGeminiUsage({
  tenantId, userId, op, model,
  inputTokens, outputTokens, totalTokens,
  latencyMs, success, errorCode,
}) {
  if (!tenantId) return; // platform-wide calls don't get logged
  try {
    await db.collection('tenants').doc(tenantId)
      .collection('geminiUsage').add({
        tenantId,
        userId: userId || null,
        op: String(op || 'unknown'),
        model: String(model || 'unknown'),
        inputTokens: Number(inputTokens) || 0,
        outputTokens: Number(outputTokens) || 0,
        totalTokens: Number(totalTokens) || 0,
        latencyMs: Number(latencyMs) || 0,
        success: !!success,
        errorCode: errorCode || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (e) {
    console.warn('[geminiUsage] log write failed (non-fatal):', e.message);
  }
}
```

**Step 3: Wrap the voice Gemini call**

Find the voice call (around `index.js:693`):

```javascript
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
```

Wrap the surrounding `try { const result = await model.generateContent(...); ... } catch (geminiError) { ... }` like this. Find the current shape and replace ONLY the call + parse + the existing catch — don't otherwise restructure:

```javascript
const t0 = Date.now();
let geminiResult, usage = {};
try {
  geminiResult = await model.generateContent(prompt);
  usage = geminiResult?.response?.usageMetadata || {};
  await logGeminiUsage({
    tenantId, userId,
    op: 'voice',
    model: 'gemini-2.5-flash',
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
    totalTokens: usage.totalTokenCount || 0,
    latencyMs: Date.now() - t0,
    success: true,
  });
} catch (geminiError) {
  await logGeminiUsage({
    tenantId, userId,
    op: 'voice',
    model: 'gemini-2.5-flash',
    inputTokens: 0, outputTokens: 0, totalTokens: 0,
    latencyMs: Date.now() - t0,
    success: false,
    errorCode: (geminiError.message || '').includes('429') ? 'rate_limit' : 'gemini_error',
  });
  // existing error handling continues unchanged
  throw geminiError;
}
// downstream code uses `geminiResult` instead of `result`
```

**Step 4: Run the existing test suite**

Run: `cd firebase/functions && node _e2e_security.js 2>&1 | tail -30`
Expected: all assertions pass (the wrap should not change the response shape).

If `_e2e_security.js` requires env vars not present, skip — `_e2e_super_admin.js` covers the contract end-to-end and runs in Task 9.

**Step 5: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(functions): add logGeminiUsage helper, wrap voice call

Per-call tokens now land in tenants/{id}/geminiUsage so the
dailyTenantCostAggregation rollup reflects real Gemini cost
instead of always-zero. Non-fatal logging — write errors do not
break the voice response."
```

---

## Task 2 — Wire `logGeminiUsage` into the scan Gemini Vision call

**Files:**
- Modify: `firebase/functions/index.js:845`–end of scan handler.

**Step 1: Read the scan handler**

Run: `sed -n '820,945p' firebase/functions/index.js`

Confirm the same `genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })` pattern is used and that `usageMetadata` is on the response.

**Step 2: Wrap the scan call**

Mirror Task 1's wrap exactly, with `op: 'scan'` instead of `op: 'voice'`. The model string is the same.

**Step 3: Sanity-check that both call sites compile**

Run: `node -e "require('./firebase/functions/index.js')" 2>&1 | head -20`
Expected: no syntax errors. Firebase Functions startup errors about missing env vars are fine.

**Step 4: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(functions): wrap scan Gemini call with token logging"
```

---

## Task 3 — Fix `superOpImpersonateTenant` (key name, readOnly claim, 30-min cap)

**Files:**
- Modify: `firebase/functions/index.js:3968-3993` (`superOpImpersonateTenant`).
- Modify: `firebase/public/super-admin.html:1547-1553` (`impersonateTenant` frontend handler) — confirm key alignment.

**Step 1: Diagnose**

The current backend returns `{ token, tenantSlug, expiresInSeconds: 3600 }` but the frontend reads `r.customToken`. Result: `customToken` is undefined, the toast says "No token returned", impersonation never opens. Spec also requires 30-min cap, not 1 h, and a `readOnly` claim that prevents writes. Neither is set today.

**Step 2: Replace the handler**

Replace the body of `superOpImpersonateTenant` with:

```javascript
async function superOpImpersonateTenant(ctx, params) {
  const tenantId = String(params.tenantId || '');
  if (!tenantId) return { error: 'tenantId required', status: 400 };
  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  if (!tenantSnap.exists) return { error: 'Tenant not found', status: 404 };
  const t = tenantSnap.data() || {};

  // 30-min impersonation window. Custom token TTL is fixed at 1 h by Firebase,
  // but the resulting ID token's expiry is bounded by claim `impersonationExpiresAt`.
  // The frontend signs the user out at that timestamp; the backend rejects writes
  // when `impersonating === true && readOnly === true` (see secureApi gate).
  const now = Date.now();
  const expiresAtMs = now + 30 * 60 * 1000;

  const claims = {
    impersonating: true,
    readOnly: true,
    impersonationExpiresAt: expiresAtMs,
    impersonatingTenantId: tenantId,
    impersonatingTenantSlug: t.slug || tenantId,
    impersonatingAs: ctx.userEmail,
    // Tenant-scoped claims so app.html / index.html accept the session
    tenantId,
    tenantSlug: t.slug || tenantId,
    approved: true,
    role: 'super_admin',
    superAdmin: true,
  };
  const customToken = await auth.createCustomToken(ctx.userId, claims);

  await writeSuperAudit(ctx, 'impersonation', tenantId, {
    durationMs: 30 * 60 * 1000,
    expiresAt: new Date(expiresAtMs).toISOString(),
  });

  return {
    data: {
      customToken,
      tenantSlug: t.slug || tenantId,
      tenantId,
      expiresAtMs,
      expiresInSeconds: 1800,
    },
  };
}
```

**Step 3: Verify frontend already aligns**

Run: `grep -n "r.customToken\|impersonateToken\|impersonationExpiresAt" firebase/public/super-admin.html`

Expected: `r.customToken` referenced at the existing line in `impersonateTenant`. If the line was something else, fix it now to read `r.customToken` and append `&expiresAt=` + `r.expiresAtMs` to the opened URL.

**Step 4: Commit**

```bash
git add firebase/functions/index.js firebase/public/super-admin.html
git commit -m "fix(super-admin): impersonation token contract + 30-min cap

- Return key renamed token -> customToken (matches frontend).
- Add readOnly: true claim so secureApi can block writes.
- Add impersonationExpiresAt for client-side auto-logout.
- 30-min duration per spec (was 1 h)."
```

---

## Task 4 — Block writes from impersonating sessions in `secureApi`

**Files:**
- Modify: `firebase/functions/index.js` — `handleRequest` gate near line 644 (after the tenant-status gate).

**Step 1: Read the existing gate**

Run: `sed -n '640,675p' firebase/functions/index.js`

The gate already short-circuits writes for suspended/cancelled tenants. The new check goes between that gate and the role-based permission check.

**Step 2: Add the impersonator-write block**

Insert this block immediately after the closing brace of the tenant-status gate (line 663) and before the `checkPermission` call (line 666):

```javascript
// Impersonator write-block: super-admin sessions that obtained a token via
// /superAdmin#impersonateTenant carry { impersonating: true, readOnly: true,
// impersonationExpiresAt }. Block all non-read ops and reject if expired.
if (decoded && decoded.impersonating === true) {
  const exp = Number(decoded.impersonationExpiresAt) || 0;
  if (exp && Date.now() > exp) {
    await writeAuditLog(userId, userEmail, 'impersonation_expired', table, 0, tenantId);
    res.status(401).json({ error: 'Impersonation session expired. Sign out and re-impersonate.' });
    return;
  }
  if (decoded.readOnly === true) {
    const readOnlyOps = ['select', 'getTenantConfig', 'checkSlugAvailable', 'get_tenant_settings', 'list_invoices'];
    if (!readOnlyOps.includes(operation)) {
      await writeAuditLog(userId, userEmail, 'impersonator_write_blocked', table, 0, tenantId);
      res.status(403).json({ error: 'Read-only impersonation session: writes are not permitted.' });
      return;
    }
  }
}
```

`decoded` is already in scope from the auth-verify earlier in the handler. Confirm by `grep -n "verifyIdToken\|decoded\." firebase/functions/index.js | head -20`. If the variable is named differently, align.

**Step 3: Commit**

```bash
git add firebase/functions/index.js
git commit -m "feat(functions): block writes from impersonating super-admin sessions

Enforces the readOnly claim minted by superOpImpersonateTenant.
Also rejects requests after impersonationExpiresAt elapses.
Both paths land in audit_log so abuse is observable."
```

---

## Task 5 — Update Firestore rules for new collections

**Files:**
- Modify: `firebase/firestore.rules`

**Step 1: Read the current rules**

Run: `cat firebase/firestore.rules`

Identify where the existing `support_tickets` / `feedback_events` / `internal_notes` blocks live. Add new blocks for the read/write paths used by the rollup functions and Gemini logging.

**Step 2: Insert these match blocks inside the same `match /databases/{database}/documents { … }` wrapper as the existing rules**

```javascript
// Gemini per-call token usage. Written by Cloud Functions only (admin SDK
// bypasses rules). Readable by super-admins via the superAdmin endpoint
// (which uses admin SDK), so deny client read/write.
match /tenants/{tenantId}/geminiUsage/{eventId} {
  allow read, write: if false;
}

// Daily cost rollups, written by dailyTenantCostAggregation. Same rationale.
match /tenants/{tenantId}/cost_daily/{day} {
  allow read, write: if false;
}
match /tenant_costs_monthly/{key} {
  allow read, write: if false;
}

// Daily usage rollups.
match /tenants/{tenantId}/usage_daily/{day} {
  allow read, write: if false;
}
match /usage_stats_monthly/{key} {
  allow read, write: if false;
}

// Operator profiles — admin SDK only.
match /operator_profiles/{uid} {
  allow read, write: if false;
}

// Super-admin audit log (writeSuperAudit destination).
match /super_audit/{id} {
  allow read, write: if false;
}
```

If any of these collection names differ in `index.js` (the rollups likely use one of: `cost_daily`, `tenant_costs_monthly`, `usage_daily`, `usage_stats_monthly`, etc.), grep for the exact path before writing the rule:

Run: `grep -nE "tenant_costs|cost_daily|usage_daily|usage_stats|operator_profiles|super_audit" firebase/functions/index.js | head -20`

Use the actual path that the writers use. Add `if false` rules for each (admin SDK writes bypass rules; clients must not touch these).

**Step 3: Lint the rules**

Run: `cd firebase && firebase deploy --only firestore:rules --dry-run 2>&1 | tail -30`
Expected: "compiled successfully" or equivalent. If the dry-run flag isn't supported on the installed CLI, run `firebase emulators:exec --only firestore "echo ok"` to verify rule compile.

**Step 4: Commit**

```bash
git add firebase/firestore.rules
git commit -m "chore(rules): deny client access to admin-SDK-only collections

geminiUsage, cost_daily, tenant_costs_monthly, usage_daily,
usage_stats_monthly, operator_profiles, super_audit — all written
by Cloud Functions only. Explicit deny prevents accidental client
write attempts from bypassing the secureApi audit trail."
```

---

## Task 6 — Add the impersonation handler in `index.html`

**Files:**
- Modify: `firebase/public/index.html` — early init script.

**Step 1: Find the auth init block**

Run: `grep -n "onAuthStateChanged\|signInWithCustomToken\|firebase.initializeApp" firebase/public/index.html | head -10`

Locate the script block where `firebase.initializeApp` runs and where `auth.onAuthStateChanged` is wired.

**Step 2: Insert the impersonation handler immediately after `firebase.initializeApp`, before the auth-state listener**

```html
<script>
(function impersonationBootstrap() {
  // If launched from /super-admin with ?impersonateToken=…&tenant=…&expiresAt=…,
  // sign in with the custom token, scrub the URL, and let the rest of the app boot
  // as the impersonated tenant. The banner (see banner script) detects the
  // resulting impersonating claim and renders itself.
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('impersonateToken');
    if (!token) return;
    const tenant = params.get('tenant') || '';
    const expiresAt = Number(params.get('expiresAt') || 0);
    sessionStorage.setItem('impersonationExpiresAt', String(expiresAt));
    sessionStorage.setItem('impersonationTenantSlug', tenant);
    // Scrub the URL so a copy-paste doesn't leak the token.
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, '', cleanUrl);
    firebase.auth().signInWithCustomToken(token).catch(err => {
      console.error('[impersonation] sign-in failed:', err);
      alert('Impersonation sign-in failed: ' + (err.message || err));
    });
  } catch (e) {
    console.warn('[impersonation] bootstrap failed:', e);
  }
})();
</script>
```

The `<script>` block must live **after** the existing `firebase.initializeApp(window.firebaseConfig)` call but **before** the `onAuthStateChanged` listener — otherwise the listener fires before the custom-token sign-in starts.

**Step 3: Commit**

```bash
git add firebase/public/index.html
git commit -m "feat(app): handle ?impersonateToken= query param

Signs in with the custom token minted by superOpImpersonateTenant,
scrubs the token from the URL, and stores the expiry in
sessionStorage for the banner to display."
```

---

## Task 7 — Render the impersonation banner + auto-logout in `index.html`

**Files:**
- Modify: `firebase/public/index.html` — add banner DOM + script.

**Step 1: Add banner DOM right after `<body>`**

Insert at the very top of `<body>`:

```html
<div id="impersonation-banner" style="display:none;position:sticky;top:0;left:0;right:0;z-index:9999;
  background:linear-gradient(90deg,#d63031 0%,#ff7675 100%);color:#fff;padding:8px 14px;
  font-family:Inter,system-ui,sans-serif;font-size:13px;font-weight:600;text-align:center;
  box-shadow:0 4px 14px rgba(0,0,0,.3);letter-spacing:.02em">
  <span id="imp-banner-text">⚠ IMPERSONATING — read-only</span>
  <span id="imp-banner-countdown" style="margin-left:14px;font-family:JetBrains Mono,monospace;opacity:.92"></span>
  <button id="imp-banner-exit" style="margin-left:14px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.4);
    color:#fff;padding:3px 10px;border-radius:4px;font-weight:700;cursor:pointer;font-size:11px;font-family:inherit">
    EXIT IMPERSONATION
  </button>
</div>
```

**Step 2: Add the banner-driver script — place it inside the existing `onAuthStateChanged` callback or just after**

```html
<script>
(function impersonationBanner() {
  const banner = document.getElementById('impersonation-banner');
  const text = document.getElementById('imp-banner-text');
  const countdown = document.getElementById('imp-banner-countdown');
  const exitBtn = document.getElementById('imp-banner-exit');
  let timer = null;
  let expiresAt = 0;

  exitBtn.addEventListener('click', async () => {
    try { await firebase.auth().signOut(); } catch (e) {}
    window.location.href = '/super-admin.html';
  });

  function format(ms) {
    if (ms <= 0) return '00:00';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function startCountdown() {
    if (timer) clearInterval(timer);
    timer = setInterval(async () => {
      const remaining = expiresAt - Date.now();
      countdown.textContent = format(remaining) + ' remaining';
      if (remaining <= 0) {
        clearInterval(timer);
        try { await firebase.auth().signOut(); } catch (e) {}
        alert('Impersonation session expired. Returning to super-admin console.');
        window.location.href = '/super-admin.html';
      }
    }, 1000);
  }

  firebase.auth().onAuthStateChanged(async user => {
    if (!user) { banner.style.display = 'none'; return; }
    try {
      const tok = await user.getIdTokenResult(false);
      const c = tok.claims || {};
      if (c.impersonating === true) {
        const tenant = c.impersonatingTenantSlug || sessionStorage.getItem('impersonationTenantSlug') || c.tenantSlug || '?';
        const admin = c.impersonatingAs || '?';
        text.innerHTML = '⚠ <strong>IMPERSONATING</strong> ' + tenant + ' as ' + admin + ' · read-only';
        expiresAt = Number(c.impersonationExpiresAt) || Number(sessionStorage.getItem('impersonationExpiresAt')) || 0;
        banner.style.display = 'block';
        if (expiresAt) startCountdown();
      } else {
        banner.style.display = 'none';
      }
    } catch (e) {
      console.warn('[impersonation] banner check failed:', e);
    }
  });
})();
</script>
```

**Step 3: Commit**

```bash
git add firebase/public/index.html
git commit -m "feat(app): impersonation banner + auto-logout

Sticky red banner shows the impersonated tenant, the operator
email, and a live countdown. Click EXIT or wait for expiry to
sign out and return to /super-admin.html."
```

---

## Task 8 — Add per-feature feedback widget in `index.html`

**Files:**
- Modify: `firebase/public/index.html` — add a floating feedback button + modal.

**Step 1: Confirm the `submitFeedback` op and feature allowlist**

Already confirmed: `firebase/functions/index.js:1202-1230` accepts `{ feature, sentiment: 'positive'|'negative', comment }` for features in: `recipes, inventory, prep_sheets, ingredients, menu, shopping, vendor_orders, activity_log, admin, scan, oracle_assistant, billing, general`.

**Step 2: Find the existing `secureApi` wrapper in `index.html`**

Run: `grep -n "secureApi\|cloudFunctionUrl\|apiBase\|secure-api" firebase/public/index.html | head -10`

Note the function name and call shape so we can reuse it (likely `secureApi('submitFeedback', { feature, sentiment, comment, route, userAgent, appVersion })`).

**Step 3: Add the floating feedback button + modal at the bottom of `<body>`, before the closing tag**

```html
<style>
  #feedback-fab {
    position:fixed;bottom:20px;right:20px;z-index:8000;
    width:48px;height:48px;border-radius:24px;border:none;cursor:pointer;
    background:linear-gradient(135deg,#74acdf,#2e78b8);color:#fff;
    font-size:22px;box-shadow:0 6px 18px rgba(0,0,0,.35);
  }
  #feedback-fab:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(0,0,0,.45)}
  #feedback-modal-back {
    position:fixed;inset:0;background:rgba(5,10,22,.7);backdrop-filter:blur(4px);
    z-index:9000;display:none;align-items:center;justify-content:center;
  }
  #feedback-modal-back.open{display:flex}
  #feedback-modal {
    width:96%;max-width:420px;background:#1a2842;color:#e0e6ed;
    border:1px solid rgba(116,172,223,.35);border-radius:14px;padding:22px;
    font-family:Inter,system-ui,sans-serif;box-shadow:0 20px 50px rgba(0,0,0,.5);
  }
  #feedback-modal h3{font-size:17px;font-weight:800;margin-bottom:6px;color:#fff}
  #feedback-modal p{font-size:12px;color:#a0b4c8;margin-bottom:14px}
  #feedback-modal label{display:block;font-size:11px;color:#8a9bad;font-weight:700;
    text-transform:uppercase;letter-spacing:.08em;margin:10px 0 4px}
  #feedback-modal select,#feedback-modal textarea{width:100%;background:rgba(0,0,0,.4);
    border:1px solid rgba(255,255,255,.12);color:#e0e6ed;padding:9px 12px;border-radius:8px;
    font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box}
  #feedback-modal textarea{min-height:90px}
  .fb-thumbs{display:flex;gap:8px;margin-top:6px}
  .fb-thumb{flex:1;padding:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);
    color:#e0e6ed;border-radius:8px;cursor:pointer;font-size:14px;font-family:inherit;font-weight:600}
  .fb-thumb.active.pos{background:rgba(0,184,148,.25);border-color:rgba(0,184,148,.55);color:#6bd68a}
  .fb-thumb.active.neg{background:rgba(214,48,49,.25);border-color:rgba(214,48,49,.55);color:#ff9a9a}
  .fb-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
  .fb-btn{padding:8px 14px;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
  .fb-btn.primary{background:linear-gradient(135deg,#74acdf,#2e78b8);color:#fff}
  .fb-btn.ghost{background:rgba(255,255,255,.08);color:#e0e6ed;border:1px solid rgba(255,255,255,.15)}
</style>
<button id="feedback-fab" title="Send feedback" aria-label="Send feedback">♡</button>
<div id="feedback-modal-back" role="dialog" aria-labelledby="fb-title">
  <div id="feedback-modal">
    <h3 id="fb-title">Send feedback</h3>
    <p>Tell Anthony what's working or what's broken. Goes straight to the operator console.</p>
    <label>Feature</label>
    <select id="fb-feature">
      <option value="recipes">Recipes</option>
      <option value="ingredients">Ingredients</option>
      <option value="inventory">Inventory</option>
      <option value="prep_sheets">Prep sheets</option>
      <option value="menu">Menu</option>
      <option value="shopping">Shopping list</option>
      <option value="vendor_orders">Vendor orders</option>
      <option value="scan">Inventory scan</option>
      <option value="oracle_assistant">Oracle assistant (voice)</option>
      <option value="activity_log">Activity log</option>
      <option value="admin">Admin / billing</option>
      <option value="billing">Billing</option>
      <option value="general" selected>General</option>
    </select>
    <label>Reaction</label>
    <div class="fb-thumbs">
      <button class="fb-thumb pos" data-sent="positive">👍 Working</button>
      <button class="fb-thumb neg" data-sent="negative">👎 Not working</button>
    </div>
    <label>Comment (optional)</label>
    <textarea id="fb-comment" maxlength="2000" placeholder="What happened? What did you expect?"></textarea>
    <div class="fb-actions">
      <button class="fb-btn ghost" id="fb-cancel">Cancel</button>
      <button class="fb-btn primary" id="fb-send" disabled>Send</button>
    </div>
  </div>
</div>
<script>
(function feedbackWidget() {
  const fab = document.getElementById('feedback-fab');
  const back = document.getElementById('feedback-modal-back');
  const featureSel = document.getElementById('fb-feature');
  const commentEl = document.getElementById('fb-comment');
  const sendBtn = document.getElementById('fb-send');
  const cancelBtn = document.getElementById('fb-cancel');
  const thumbs = document.querySelectorAll('.fb-thumb');
  let sentiment = null;

  // Map current route to a default feature.
  function inferFeature() {
    const h = (window.location.hash || '').toLowerCase();
    if (h.includes('recipe')) return 'recipes';
    if (h.includes('ingred')) return 'ingredients';
    if (h.includes('inv')) return 'inventory';
    if (h.includes('prep')) return 'prep_sheets';
    if (h.includes('menu')) return 'menu';
    if (h.includes('shop')) return 'shopping';
    if (h.includes('vendor') || h.includes('order')) return 'vendor_orders';
    if (h.includes('scan')) return 'scan';
    if (h.includes('oracle') || h.includes('voice')) return 'oracle_assistant';
    if (h.includes('log') || h.includes('activity')) return 'activity_log';
    if (h.includes('admin')) return 'admin';
    if (h.includes('bill')) return 'billing';
    return 'general';
  }

  function open() {
    featureSel.value = inferFeature();
    sentiment = null;
    thumbs.forEach(t => t.classList.remove('active'));
    commentEl.value = '';
    sendBtn.disabled = true;
    back.classList.add('open');
    setTimeout(() => commentEl.focus(), 80);
  }
  function close() { back.classList.remove('open'); }

  function refreshSendEnabled() {
    sendBtn.disabled = !(sentiment || commentEl.value.trim());
  }

  fab.addEventListener('click', open);
  cancelBtn.addEventListener('click', close);
  back.addEventListener('click', e => { if (e.target === back) close(); });
  thumbs.forEach(t => t.addEventListener('click', () => {
    sentiment = t.dataset.sent;
    thumbs.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    refreshSendEnabled();
  }));
  commentEl.addEventListener('input', refreshSendEnabled);

  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    try {
      // secureApi is the existing wrapper. If the function name differs in this
      // file, change here.
      await secureApi('submitFeedback', {
        feature: featureSel.value,
        sentiment,
        comment: commentEl.value.trim().slice(0, 2000),
        route: window.location.hash || window.location.pathname,
        userAgent: (navigator.userAgent || '').slice(0, 300),
        appVersion: (window.APP_VERSION || ''),
      });
      sendBtn.textContent = 'Sent ✓';
      setTimeout(() => { close(); sendBtn.textContent = 'Send'; }, 700);
    } catch (e) {
      sendBtn.textContent = 'Send';
      alert('Feedback failed: ' + (e.message || e));
    } finally {
      sendBtn.disabled = false;
    }
  });

  // Hide the FAB if the user is impersonating — operator should not generate
  // fake feedback on the customer's behalf.
  firebase.auth().onAuthStateChanged(async user => {
    if (!user) { fab.style.display = 'none'; return; }
    try {
      const tok = await user.getIdTokenResult(false);
      fab.style.display = (tok.claims && tok.claims.impersonating) ? 'none' : 'block';
    } catch (e) { /* keep visible on error */ }
  });
})();
</script>
```

**Step 4: Sanity-check that `secureApi` exists with this signature**

If the existing wrapper has a different name (e.g. `callApi`, `cf`), find/replace before commit.

Run: `grep -nE "function secureApi|const secureApi|secureApi =" firebase/public/index.html | head -5`

If 0 hits: find the actual wrapper used elsewhere for `submitFeedback` or other writes (the prior backend test must have been driven by something), and substitute its name in the `sendBtn.addEventListener('click', ...)` call.

**Step 5: Commit**

```bash
git add firebase/public/index.html
git commit -m "feat(app): add per-feature feedback widget

Floating ♡ FAB opens a modal with feature selector, thumbs
positive/negative, and optional comment. Calls submitFeedback
op which writes to tenants/{id}/feedback_events. Hidden during
impersonation so operators don't pollute the data."
```

---

## Task 9 — Run `_e2e_super_admin.js` against the deployed (or local) endpoint

**Files:**
- Run: `firebase/functions/_e2e_super_admin.js`

**Step 1: Inspect the test to confirm prerequisites**

Run: `head -60 firebase/functions/_e2e_super_admin.js`

Confirm what env vars it needs (`FIREBASE_WEB_API_KEY` per earlier read).

**Step 2: Decide local vs deployed**

If a Firebase emulator with auth + functions is already configured (`firebase.json` should have an `emulators` block), prefer that. Otherwise run against the live endpoint after Task 10 deploy.

If running locally: `cd firebase && firebase emulators:start --only auth,functions,firestore` in another terminal, then in the test, point `SUPER_URL` to the emulator URL.

If running against deploy: skip this task and run the test in Task 11 after deploy.

**Step 3: Execute**

```bash
cd firebase/functions
FIREBASE_WEB_API_KEY="$(gcloud secrets versions access latest --secret=FIREBASE_WEB_API_KEY 2>/dev/null || echo)" \
  node _e2e_super_admin.js 2>&1 | tee /tmp/e2e-super-admin.log
```

If `gcloud secrets` is not configured, ask the user for the key — this is one of the few items where credentials require a human in the loop. (Per `~/.claude/CLAUDE.md`: "credentials I don't have access to" is a valid ask.)

**Step 4: Triage failures**

Any failure other than the one we caused → fix the underlying op before deploy. Run iteratively until green.

**Step 5: No commit needed** — this is a test run.

---

## Task 10 — Deploy Cloud Functions + Hosting + Firestore rules

**Files:**
- Run: `firebase deploy`

**Step 1: Pre-deploy diff sanity-check**

Run: `git status && git diff --stat HEAD`
Expected: `firebase/functions/index.js`, `firebase/firestore.rules`, `firebase/public/index.html`, `firebase/public/super-admin.html` modified or new. No surprise files. Backup/, node_modules/, audit_*.json should NOT be in the deploy.

**Step 2: Confirm `firebase.json` includes the new scheduled functions**

Run: `cat firebase/firebase.json | head -40`
Verify `functions` block exists. The exports in `index.js` (5 scheduled funcs) get picked up automatically — no `firebase.json` change needed.

**Step 3: Deploy**

```bash
cd firebase
firebase deploy --only functions,firestore:rules,hosting 2>&1 | tee /tmp/deploy.log
```

Watch for:
- `functions[superAdmin(us-central1)] Successful update operation.`
- `functions[dailyTenantCostAggregation(us-central1)] Successful create/update operation.`
- `firestore: released rules to cloud.firestore`
- `hosting: file upload complete`

**Step 4: If deploy fails on a single function**

Re-run with `--only functions:<name>` for the failing function, fix, redeploy.

**Step 5: No commit needed** — deploy is a side-effect, code already committed.

---

## Task 11 — Smoke-test the live console

**Files:** none — manual verification.

**Step 1: Open the live console**

Navigate to `https://restaurantoracle.app/super-admin.html`. Confirm the existing super_admin Google account signs in and the gate passes.

**Step 2: Walk every tab — Overview**

- KPI grid loads with non-`—` values. If all KPIs are `—`, run rollups (button on Overview).
- MRR sparkline draws.
- Top at-risk tenants list populates.
- Recent audit shows entries.

**Step 3: Tenants tab**

- Table loads (must be `<500ms` per spec; record load time from DevTools network).
- Filter by status, plan, sort by health/MRR/slug.
- Click a tenant → drawer opens with summary/users/billing/costs/usage/health/tickets/feedback/notes/meta/data/audit/rawdata/flags/announce/actions/impersonate/refund/plan/comp/export/danger tabs, all loadable.

**Step 4: Tickets tab**

- Click `+ New ticket` → enter test tenant slug, subject, body, priority `low`. Toast `Ticket created: <id>`.
- Open the ticket from the list → reply with `internal=false`, then with `internal=true`. Confirm both render.
- Assign to your operator email. Confirm.
- Close the ticket. Confirm chip turns to `closed`.
- Reopen.

**Step 5: Feedback tab**

- In a separate browser/profile, sign in as a tenant user.
- Click the ♡ FAB on the main app → submit a thumbs-down with comment "smoke test".
- Back on the operator console Feedback tab → refresh → confirm the event appears with feature, sentiment, comment, tenant.

**Step 6: Impersonation flow**

- On a tenant detail drawer, click `Impersonate`.
- New tab opens. Confirm:
  - Red banner shows `IMPERSONATING <slug> as <your email> · 29:xx remaining`.
  - URL has been scrubbed of the token.
  - Try to write — e.g. add an ingredient. Expect a 403 toast/error from `secureApi`.
  - Click `EXIT IMPERSONATION` → redirected to `/super-admin.html`, signed out of the impersonated tab.
- Back on console: confirm an `impersonation` audit row was written (check the Recent audit on Overview, or the tenant's Audit tab).

**Step 7: Capture screenshots**

Per spec deliverable. Use the macOS `Cmd+Shift+4` or the `screencapture` CLI. Save to `docs/screenshots/super-admin-overview.png`, `…tenants.png`, `…tenant-drawer.png`, `…tickets.png`, `…ticket-thread.png`, `…feedback.png`, `…agents.png`, `…announce.png`, `…flags.png`, `…settings.png`, `…impersonation-banner.png`.

```bash
mkdir -p docs/screenshots
# manually capture each via Cmd+Shift+4, save to the names above
```

If user prefers automated capture: I can drive Chrome via the `claude-in-chrome` MCP. Skip if Chrome MCP not connected.

**Step 8: Commit screenshots**

```bash
git add docs/screenshots
git commit -m "docs: add smoke-test screenshots for operator console"
```

---

## Task 12 — Final commit & changelog

**Files:**
- Modify: `Restaurant_Oracle_Updates.md` if it exists (mentioned in `git status`).

**Step 1: Check the changelog file**

Run: `ls Restaurant_Oracle_Updates.md && head -20 Restaurant_Oracle_Updates.md`

If it exists and follows a date-stamped pattern, prepend a 2026-04-24 entry summarizing:
- Operator console deployed, all 8 tabs live.
- Per-tenant Gemini cost tracking now functional.
- In-app feedback widget rolled out to all tenants.
- Impersonation flow live (read-only, 30 min cap, audited).

**Step 2: Commit changelog if updated**

```bash
git add Restaurant_Oracle_Updates.md
git commit -m "docs: changelog entry for operator console launch"
```

**Step 3: Final status**

Run: `git log --oneline -15 && git status`

Expected: clean working tree (or only the unrelated untracked Backup/ etc. that pre-existed). All operator-console commits present.

**Step 4: Report back to user**

Summarize: deployed at `restaurantoracle.app/super-admin.html`, all 8 tabs verified, screenshots captured, e2e green. Note any deferred items (e.g. anything yellow during smoke test).

---

## Risks & rollback

- **Gemini wrap regression:** If the wrap subtly changes the response shape (e.g. reads `result` vs `geminiResult`), voice/scan break. Mitigation: explicit smoke test in Task 11; rollback by `git revert` of Tasks 1 and 2 commits.
- **Impersonation read-only too strict:** If a read-only op is missing from `readOnlyOps` allowlist in Task 4, the impersonator hits 403 for benign reads. Mitigation: smoke test covers main user flows; widen the allowlist.
- **Firestore rules over-deny:** If a client legitimately needs to read `geminiUsage` (it doesn't today, but future code might), the rule blocks it. Mitigation: rollback rules deploy via `firebase firestore:rules:release <previous-version>`.
- **Feedback widget submitFeedback name mismatch:** If `secureApi` wrapper has a different name in `index.html`, the Send button fails silently. Caught in Task 8 step 4 grep + Task 11 step 5 smoke test.

## Success criteria

1. `https://restaurantoracle.app/super-admin.html` loads, all tabs render data without errors in console.
2. A test ticket can be created, replied, assigned, closed, reopened.
3. A test feedback event submitted from the main app surfaces in the Feedback tab within 30 s.
4. An impersonation session: opens new tab, shows banner with countdown, blocks writes with 403, auto-signs-out after 30 min.
5. `tenants/{id}/geminiUsage` has new docs after a voice or scan call. `dailyTenantCostAggregation` rollup picks them up the next morning.
6. `_e2e_super_admin.js` passes against the live endpoint.
7. Screenshots committed under `docs/screenshots/`.
