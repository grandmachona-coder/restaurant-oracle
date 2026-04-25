/**
 * Run the agent handlers once against live Firestore (admin SDK).
 *
 * This drives the same code path a Cloud Scheduler tick would, but lets us
 * verify output without waiting for the next scheduled run.
 */
'use strict';
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'restaurant-oracle' });

const agents = require('./agents');

async function main() {
  console.log('\n=== [1] runProvisioning on lachona (idempotent) ===');
  const p = await agents.runProvisioning({ tenantId: 'lachona', ownerEmail: 'grandma.chona@gmail.com', plan: 'pro' });
  console.log('  result:', p);

  console.log('\n=== [2] handleHealthCheck ===');
  const h = await agents.handleHealthCheck();
  console.log('  result:', JSON.stringify(h));

  console.log('\n=== [3] handleRevenueSnapshot ===');
  const r = await agents.handleRevenueSnapshot();
  console.log('  MRR=$' + (r.mrrCents / 100).toFixed(2));
  console.log('  byStatus=' + JSON.stringify(r.tenantsByStatus));
  console.log('  byPlan=' + JSON.stringify(r.tenantsByPlan));
  console.log('  new=' + r.newCount + ' churn=' + r.churnCount + ' rate=' + (r.churnRate * 100).toFixed(2) + '%');

  console.log('\n=== [4] handleOnboardingNudge ===');
  const o = await agents.handleOnboardingNudge();
  console.log('  result:', o);

  console.log('\n[e2e] All agents ran ✓');
}

main().catch(e => { console.error('[e2e] FAILED:', e); process.exit(1); });
