/**
 * E2E test for the superAdmin Cloud Function.
 * Creates a throwaway super-admin user, hits every op, then deletes the user.
 *
 * Usage: FIREBASE_WEB_API_KEY=... node _e2e_super_admin.js
 */
'use strict';
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'restaurant-oracle' });
const auth = admin.auth();

const API_KEY = process.env.FIREBASE_WEB_API_KEY;
if (!API_KEY) { console.error('FIREBASE_WEB_API_KEY required'); process.exit(1); }

const SUPER_URL = 'https://us-central1-restaurant-oracle.cloudfunctions.net/superAdmin';
const TEST_EMAIL = `super-e2e-${Date.now()}@bistrosteward.test`;
const TEST_PASSWORD = `TestPass${Date.now()}_!A`;

async function signIn(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error('signIn failed: ' + JSON.stringify(data));
  return data.idToken;
}

async function callOp(token, op, params) {
  const res = await fetch(SUPER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://restaurant-oracle.web.app',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({ op, ...(params || {}) }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log(`[e2e] Creating test super-admin ${TEST_EMAIL}`);
  const user = await auth.createUser({ email: TEST_EMAIL, password: TEST_PASSWORD, emailVerified: true });
  await auth.setCustomUserClaims(user.uid, { superAdmin: true });
  console.log(`  uid=${user.uid}`);

  // Wait a moment for claims propagation
  await new Promise(r => setTimeout(r, 1000));

  console.log('[e2e] Signing in');
  const token = await signIn(TEST_EMAIL, TEST_PASSWORD);
  console.log('  token OK');

  try {
    // 1. dashboard
    console.log('\n[1] dashboard');
    let r = await callOp(token, 'dashboard');
    console.log(`  status=${r.status}`);
    if (r.status !== 200) throw new Error(JSON.stringify(r.data));
    const stats = r.data.data.stats;
    console.log(`  total=${stats.totalTenants} MRR=$${(stats.mrrCents / 100).toFixed(2)} byStatus=${JSON.stringify(stats.byStatus)}`);

    // 2. listTenants
    console.log('\n[2] listTenants');
    r = await callOp(token, 'listTenants');
    console.log(`  status=${r.status} tenants=${r.data.data.tenants.length}`);
    const firstTenant = r.data.data.tenants[0];
    if (firstTenant) console.log(`  first: ${firstTenant.slug} (${firstTenant.status})`);

    // 3. getTenantDetails (for first tenant)
    if (firstTenant) {
      console.log('\n[3] getTenantDetails');
      r = await callOp(token, 'getTenantDetails', { tenantId: firstTenant.id });
      console.log(`  status=${r.status}`);
      console.log(`  subscription=${r.data.data.subscription ? r.data.data.subscription.status : 'null'}`);
      console.log(`  card=${r.data.data.card ? r.data.data.card.cardBrand : 'null'}`);
      console.log(`  team=${r.data.data.team.length} audit=${r.data.data.audit.length}`);
    }

    // 4. listSuperAdmins
    console.log('\n[4] listSuperAdmins');
    r = await callOp(token, 'listSuperAdmins');
    console.log(`  status=${r.status} admins=${r.data.data.admins.length}`);
    for (const a of r.data.data.admins) {
      console.log(`    ${a.email}`);
    }

    // 5. grantSuperAdmin (grant to a throwaway, then revoke)
    const granteeEmail = `grantee-${Date.now()}@bistrosteward.test`;
    const granteeUser = await auth.createUser({ email: granteeEmail, password: 'XYZ_TempPass123' });
    console.log(`\n[5] grantSuperAdmin(${granteeEmail})`);
    r = await callOp(token, 'grantSuperAdmin', { email: granteeEmail });
    console.log(`  status=${r.status} granted=${JSON.stringify(r.data.data)}`);

    console.log('\n[6] revokeSuperAdmin');
    r = await callOp(token, 'revokeSuperAdmin', { email: granteeEmail });
    console.log(`  status=${r.status} claims=${JSON.stringify(r.data.data.claims)}`);

    // Clean up grantee
    await auth.deleteUser(granteeUser.uid);

    // 7. revoke self — should fail
    console.log('\n[7] revokeSuperAdmin(self) — should fail');
    r = await callOp(token, 'revokeSuperAdmin', { email: TEST_EMAIL });
    console.log(`  status=${r.status} error=${r.data.error || 'none'}`);
    if (r.status !== 400) throw new Error('Expected 400 when revoking self');

    // 8. suspend/unsuspend a real tenant (use first tenant)
    if (firstTenant) {
      console.log('\n[8] suspendTenant → unsuspendTenant on ' + firstTenant.slug);
      r = await callOp(token, 'suspendTenant', { tenantId: firstTenant.id, reason: 'E2E test' });
      console.log(`  suspend status=${r.status} result=${JSON.stringify(r.data.data)}`);

      r = await callOp(token, 'unsuspendTenant', { tenantId: firstTenant.id });
      console.log(`  unsuspend status=${r.status} result=${JSON.stringify(r.data.data)}`);
    }

    // 9. updateOperatorStatus(self → busy) — allowed; supervisor edits also allowed by design.
    console.log('\n[9] updateOperatorStatus(self → busy)');
    r = await callOp(token, 'updateOperatorStatus', { uid: user.uid, status: 'busy' });
    console.log(`  status=${r.status} result=${JSON.stringify(r.data.data)}`);
    if (r.status !== 200) throw new Error('Expected 200 for self status update');

    // 10. updateOperatorProfile(self) — allowed
    console.log('\n[10] updateOperatorProfile(self) — should succeed');
    r = await callOp(token, 'updateOperatorProfile', { uid: user.uid, displayName: 'E2E Tester' });
    console.log(`  status=${r.status} result=${JSON.stringify(r.data.data)}`);
    if (r.status !== 200) throw new Error('Expected 200 for self profile update');

    // 11. updateOperatorProfile(other) — should fail 403 (hierarchy guard)
    console.log('\n[11] updateOperatorProfile(other) — should fail 403');
    r = await callOp(token, 'updateOperatorProfile', {
      uid: 'someone-else-uid', displayName: 'Hijacked',
    });
    console.log(`  status=${r.status} error=${r.data.error || 'none'}`);
    if (r.status !== 403) throw new Error('Expected 403 when editing another operator');

    // 12. updateOperatorProfile(self, role=...) — should fail 400 (role goes through grant/revoke)
    console.log('\n[12] updateOperatorProfile(self, role=admin) — should fail 400');
    r = await callOp(token, 'updateOperatorProfile', { uid: user.uid, role: 'admin' });
    console.log(`  status=${r.status} error=${r.data.error || 'none'}`);
    if (r.status !== 400) throw new Error('Expected 400 when role field is present');

    // 13. updateOperatorProfile(self, photoUrl='javascript:...') — should fail 400 (URL guard)
    console.log('\n[13] updateOperatorProfile(self, bad photoUrl) — should fail 400');
    r = await callOp(token, 'updateOperatorProfile', {
      uid: user.uid, photoUrl: 'javascript:alert(1)',
    });
    console.log(`  status=${r.status} error=${r.data.error || 'none'}`);
    if (r.status !== 400) throw new Error('Expected 400 for non-http photoUrl');

    console.log('\n[e2e] All ops passed ✓');

  } finally {
    console.log('\n[e2e] Cleaning up test user');
    try { await auth.deleteUser(user.uid); } catch (e) {}
  }
}

main().catch(e => { console.error('\n[e2e] FAILED:', e); process.exit(1); });
