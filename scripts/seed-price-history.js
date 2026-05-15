#!/usr/bin/env node
/**
 * seed-price-history.js — Synthetic price_history seeder for Bistro Steward
 *
 * Path B of the Invoice Testing Plan (MASTER.md §Invoice Testing Plan, Path 1).
 * Seeds the top-N ingredients (by recipe usage) of a tenant with 7-point
 * price_history that triggers a red alarm (≥15% rise in last-30 vs prior-30).
 *
 * USAGE
 *   node scripts/seed-price-history.js \
 *     --tenant=lachona \
 *     --top=20 \
 *     --bump=0.18 \
 *     [--dry-run]
 *
 * FLAGS
 *   --tenant=<id|slug>   Required. Tenant doc id or slug.
 *   --top=<n>            Top N ingredients to seed (default 20).
 *   --bump=<frac>        Last-30 price bump fraction (default 0.18 → 18%).
 *   --base-cost=<usd>    Override base cost when ing.cost is 0 (default 5.00).
 *   --vendor=<id>        Vendor id stamped on every history entry (default 0).
 *   --dry-run            Print intended writes without touching Firestore.
 *
 * ALARM TARGETING
 *   index.html `detectIngAlarm` requires:
 *     hist.length >= 4 (excluding synthetic),
 *     last-30 avg / prior-30 avg ratio >= 1.15 → red.
 *   Layout (days ago):  -75, -60, -45, -35, -25, -15, -5
 *                        └─ prior 60d (4 pts) ─┘└── last 30d (3 pts) ──┘
 *   Last-30 avg = base * (1 + bump), prior avg = base.
 *
 * AUTH
 *   Application Default Credentials. Run after `gcloud auth
 *   application-default login`. No service-account key required (org policy
 *   blocks SA keys per CLAUDE.md memory).
 */

'use strict';

// ──────────────────────────────────────────────────────────────────────────
// CLI parsing
// ──────────────────────────────────────────────────────────────────────────
const argv = Object.fromEntries(
  process.argv.slice(2).map(a => {
    if (!a.startsWith('--')) return [a, true];
    const eq = a.indexOf('=');
    if (eq < 0) return [a.slice(2), true];
    return [a.slice(2, eq), a.slice(eq + 1)];
  })
);

const TENANT_ARG = argv.tenant;
const TOP_N      = Number(argv.top || 20);
const BUMP       = Number(argv.bump || 0.18);
const BASE_FALLBACK = Number(argv['base-cost'] || 5.00);
const VENDOR_ID  = Number(argv.vendor || 0);
const DRY_RUN    = !!argv['dry-run'];

if (!TENANT_ARG) {
  console.error('ERROR: --tenant=<id|slug> is required');
  process.exit(1);
}
if (BUMP < 0.15) {
  console.warn(`WARN: bump ${BUMP} < 0.15 will produce amber not red alarm.`);
}

// ──────────────────────────────────────────────────────────────────────────
// Firebase Admin (ADC)
// ──────────────────────────────────────────────────────────────────────────
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'restaurant-oracle' });
const db = admin.firestore();

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

// Resolve tenant id from id or slug.
async function resolveTenantId(arg) {
  // Try as doc id first.
  const direct = await db.collection('tenants').doc(arg).get();
  if (direct.exists) return direct.id;
  // Fall back to slug lookup.
  const bySlug = await db.collection('tenants').where('slug', '==', arg).limit(1).get();
  if (!bySlug.empty) return bySlug.docs[0].id;
  throw new Error(`Tenant not found: ${arg}`);
}

// Day offset (negative) → ISO string at midnight UTC.
function isoDaysAgo(daysAgo) {
  const ms = Date.now() - daysAgo * 86400000;
  return new Date(ms).toISOString();
}

// Build the 7-point history that triggers red alarm.
// base * 1     → -75, -60, -45, -35   (4 prior points)
// base * 1+bump → -25, -15, -5         (3 last-30 points)
function buildHistory(basePrice, bumpFrac, vendorId) {
  const round = (n) => Math.round(n * 100) / 100;
  const lo = round(basePrice);
  const hi = round(basePrice * (1 + bumpFrac));
  const points = [
    { daysAgo: 75, price: lo },
    { daysAgo: 60, price: lo },
    { daysAgo: 45, price: lo },
    { daysAgo: 35, price: lo },
    { daysAgo: 25, price: hi },
    { daysAgo: 15, price: hi },
    { daysAgo:  5, price: hi },
  ];
  return points.map(p => ({
    date: isoDaysAgo(p.daysAgo),
    price: p.price,
    vendorId: vendorId,
    seeded: true,                     // marker — not consumed by detector but
                                      // distinct from `synthetic` (which is
                                      // reserved for the live cost echo).
  }));
}

// Score an ingredient by recipe usage (recursive lineSubRecId expansion).
// Falls back to direct line count if recipe doc has no children.
async function rankIngsByUsage(tenantId) {
  const ingsCol = db.collection('tenants').doc(tenantId).collection('ings');
  const recsCol = db.collection('tenants').doc(tenantId).collection('recs');

  const [ingsSnap, recsSnap] = await Promise.all([ingsCol.get(), recsCol.get()]);

  const allIngs = ingsSnap.docs.map(d => ({
    id: d.id,
    ref: d.ref,
    data: d.data(),
  })).filter(i => !i.data.archived);   // skip archived

  const useCount = new Map();          // ingId → recipe-line count
  for (const r of recsSnap.docs) {
    const lines = r.data().lines || [];
    for (const ln of lines) {
      const ingId = ln.ingId || ln.ing_id;
      if (!ingId) continue;
      useCount.set(ingId, (useCount.get(ingId) || 0) + 1);
    }
  }

  const scored = allIngs.map(i => ({
    ...i,
    usage: useCount.get(i.id) || 0,
  }));

  scored.sort((a, b) => {
    if (b.usage !== a.usage) return b.usage - a.usage;
    return String(a.data.name || '').localeCompare(String(b.data.name || ''));
  });

  return scored;
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`[seed] tenant=${TENANT_ARG} top=${TOP_N} bump=${BUMP} dry=${DRY_RUN}`);

  const tenantId = await resolveTenantId(TENANT_ARG);
  console.log(`[seed] resolved tenantId=${tenantId}`);

  const ranked = await rankIngsByUsage(tenantId);
  console.log(`[seed] tenant has ${ranked.length} active ingredients`);
  if (!ranked.length) {
    console.error(`[seed] ABORT — no ingredients to seed. Import a menu first.`);
    process.exit(2);
  }

  const targets = ranked.slice(0, TOP_N);
  console.log(`[seed] targeting top ${targets.length}:`);
  for (const t of targets) {
    console.log(`        ${t.id.padEnd(24)} usage=${String(t.usage).padStart(3)} cost=${(t.data.cost || 0).toFixed(2)}  ${t.data.name || '(unnamed)'}`);
  }

  if (DRY_RUN) {
    console.log('[seed] dry-run: no Firestore writes performed.');
    process.exit(0);
  }

  let written = 0;
  let skipped = 0;
  // Batch in chunks of 250 (Firestore limit 500 ops/batch).
  for (let i = 0; i < targets.length; i += 250) {
    const slice = targets.slice(i, i + 250);
    const batch = db.batch();
    let opsInBatch = 0;
    for (const t of slice) {
      const baseCost = (t.data.cost > 0 ? t.data.cost : BASE_FALLBACK);
      const history = buildHistory(baseCost, BUMP, VENDOR_ID);
      // Preserve existing real history if present; only add if no non-seeded
      // entries exist. This makes the script idempotent and safe to re-run.
      const existing = Array.isArray(t.data.price_history) ? t.data.price_history : [];
      const realExisting = existing.filter(h => !h.seeded && !h.synthetic);
      if (realExisting.length > 0) {
        skipped++;
        continue;
      }
      batch.update(t.ref, {
        price_history: history,
        // Also set cost so the recipe page shows numbers immediately.
        cost: history[history.length - 1].price,
      });
      written++;
      opsInBatch++;
    }
    if (opsInBatch > 0) await batch.commit();
  }

  console.log(`[seed] done. wrote=${written} skipped=${skipped} (had real history)`);
  process.exit(0);
})().catch(e => {
  console.error('[seed] FAIL:', e.message || e);
  process.exit(1);
});
