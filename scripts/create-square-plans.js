#!/usr/bin/env node
/**
 * create-square-plans.js
 *
 * One-shot script: creates the 3 Bistro Steward subscription plans
 * (Starter / Pro / Scale) in Square sandbox via the Catalog API, then
 * prints the Plan Variation IDs we need for the signupTenant Cloud Function.
 *
 * Why not via the Seller Dashboard? Square's new-schema Developer apps no
 * longer expose a sandbox-dashboard launcher. Creating plans via API is the
 * supported path — same end result.
 *
 * Inputs (env vars):
 *   SQUARE_ACCESS_TOKEN   - sandbox access token (pulled from Firebase secrets)
 *   SQUARE_LOCATION_ID    - sandbox default test account location ID
 *
 * Output: prints JSON summary + writes scripts/square-plans.json for reuse.
 *
 * Safety: idempotent via deterministic idempotency keys. Re-running does not
 * create duplicates — Square returns the existing object.
 */

const fs = require('fs');
const path = require('path');

const SQUARE_HOST = 'https://connect.squareupsandbox.com';
const API_VERSION = '2025-01-23';

const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;

if (!ACCESS_TOKEN) {
  console.error('✗ SQUARE_ACCESS_TOKEN env var is required');
  process.exit(1);
}
if (!LOCATION_ID) {
  console.error('✗ SQUARE_LOCATION_ID env var is required');
  process.exit(1);
}

// ── Plan definitions ─────────────────────────────────────────────────────────
// Amount in cents. Idempotency keys are deterministic so re-runs don't dupe.
const PLANS = [
  {
    slug: 'starter',
    name: 'Bistro Steward — Starter',
    amountCents: 2900,
    idempotencyKey: 'ro-plan-starter-v1',
    variationIdempotencyKey: 'ro-planvar-starter-v1',
  },
  {
    slug: 'pro',
    name: 'Bistro Steward — Pro',
    amountCents: 4900,
    idempotencyKey: 'ro-plan-pro-v1',
    variationIdempotencyKey: 'ro-planvar-pro-v1',
  },
  {
    slug: 'scale',
    name: 'Bistro Steward — Scale',
    amountCents: 9900,
    idempotencyKey: 'ro-plan-scale-v1',
    variationIdempotencyKey: 'ro-planvar-scale-v1',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
async function squareFetch(endpoint, body) {
  const res = await fetch(`${SQUARE_HOST}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Square-Version': API_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(`Square API ${res.status}: ${JSON.stringify(data)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/**
 * Create a SUBSCRIPTION_PLAN (parent container). Returns the real plan ID.
 * Schema: https://developer.squareup.com/reference/square/catalog-api/upsert-catalog-object
 */
async function createSubscriptionPlan(plan) {
  const res = await squareFetch('/v2/catalog/object', {
    idempotency_key: plan.idempotencyKey,
    object: {
      type: 'SUBSCRIPTION_PLAN',
      id: `#plan_${plan.slug}`,
      subscription_plan_data: {
        name: plan.name,
      },
    },
  });
  return res.catalog_object.id;
}

/**
 * Create a SUBSCRIPTION_PLAN_VARIATION under a plan. Returns the variation ID
 * which is what the Subscriptions API's `plan_variation_id` field takes.
 */
async function createSubscriptionPlanVariation(plan, planId) {
  const res = await squareFetch('/v2/catalog/object', {
    idempotency_key: plan.variationIdempotencyKey,
    object: {
      type: 'SUBSCRIPTION_PLAN_VARIATION',
      id: `#planvar_${plan.slug}`,
      subscription_plan_variation_data: {
        name: `${plan.name} — Monthly`,
        phases: [
          {
            cadence: 'MONTHLY',
            ordinal: 0,
            pricing: {
              type: 'STATIC',
              price_money: {
                amount: plan.amountCents,
                currency: 'USD',
              },
            },
          },
        ],
        subscription_plan_id: planId,
      },
    },
  });
  return res.catalog_object.id;
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Bistro Steward — Square Plan Bootstrap');
  console.log('  Environment: SANDBOX');
  console.log(`  Location:    ${LOCATION_ID}`);
  console.log('═══════════════════════════════════════════════════════\n');

  const results = [];
  for (const plan of PLANS) {
    try {
      process.stdout.write(`→ ${plan.name} ... `);
      const planId = await createSubscriptionPlan(plan);
      const variationId = await createSubscriptionPlanVariation(plan, planId);
      console.log('✓');
      console.log(`    plan_id:      ${planId}`);
      console.log(`    variation_id: ${variationId}`);
      console.log(`    price:        $${(plan.amountCents / 100).toFixed(2)}/mo\n`);
      results.push({
        slug: plan.slug,
        name: plan.name,
        amountCents: plan.amountCents,
        planId,
        variationId,
      });
    } catch (err) {
      console.log('✗');
      console.error(`    ${err.message}`);
      if (err.body && err.body.errors) {
        for (const e of err.body.errors) {
          console.error(`    [${e.category}/${e.code}] ${e.detail}`);
        }
      }
      process.exit(1);
    }
  }

  // Write results for reuse by the Cloud Function
  const outPath = path.resolve(__dirname, 'square-plans.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        environment: 'sandbox',
        locationId: LOCATION_ID,
        createdAt: new Date().toISOString(),
        plans: results,
      },
      null,
      2,
    ),
  );

  console.log('═══════════════════════════════════════════════════════');
  console.log('  ✅ All 3 plans created.');
  console.log(`  Saved: ${outPath}`);
  console.log('═══════════════════════════════════════════════════════\n');

  console.log('Plan Variation IDs (for signupTenant CF):');
  for (const r of results) {
    console.log(`  ${r.slug.padEnd(8)} ${r.variationId}`);
  }
})();
