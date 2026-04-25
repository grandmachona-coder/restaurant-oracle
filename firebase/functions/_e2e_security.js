/**
 * Security test suite.
 * Verifies authorization enforcement on privileged endpoints.
 */
'use strict';
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'restaurant-oracle' });
const auth = admin.auth();

const API_KEY = process.env.FIREBASE_WEB_API_KEY;
if (!API_KEY) { console.error('FIREBASE_WEB_API_KEY required'); process.exit(1); }

const ADMIN_URL = 'https://us-central1-restaurant-oracle.cloudfunctions.net/adminBilling';
const SUPER_URL = 'https://us-central1-restaurant-oracle.cloudfunctions.net/superAdmin';

const TEST_EMAIL = `sec-test-${Date.now()}@restaurant-oracle.test`;
const TEST_PASSWORD = `Sec_Pass_${Date.now()}_X`;

async function signIn(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) }
  );
  const data = await res.json();
  if (!res.ok) throw new Error('signIn failed: ' + JSON.stringify(data));
  return data.idToken;
}

async function call(url, token, op, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://restaurant-oracle.web.app', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ op, ...(params || {}) }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function check(name, cond, detail) {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  return cond;
}

async function main() {
  let pass = 0, fail = 0;
  const record = (ok) => { ok ? pass++ : fail++; };

  // Set up test users
  console.log('[setup] Creating ordinary user (no tenant, no super_admin)');
  const ordinary = await auth.createUser({ email: TEST_EMAIL, password: TEST_PASSWORD, emailVerified: true });
  // No custom claims on purpose
  await new Promise(r => setTimeout(r, 500));

  console.log('[setup] Creating tenant-bound user (role=employee, NOT super_admin)');
  const employeeEmail = `emp-${Date.now()}@restaurant-oracle.test`;
  const employee = await auth.createUser({ email: employeeEmail, password: TEST_PASSWORD, emailVerified: true });
  await auth.setCustomUserClaims(employee.uid, { tenantId: 'lachona', tenantSlug: 'lachona', approved: true, role: 'employee' });
  await new Promise(r => setTimeout(r, 500));

  try {
    const ordinaryToken = await signIn(TEST_EMAIL, TEST_PASSWORD);
    const employeeToken = await signIn(employeeEmail, TEST_PASSWORD);

    console.log('\n[test] /adminBilling authorization:');
    // Ordinary user (no tenant binding)
    let r = await call(ADMIN_URL, ordinaryToken, 'getInfo');
    record(check('ordinary user → 400 (no tenant)', r.status === 400 || r.status === 403, `status=${r.status} error=${r.data.error}`));

    // Employee tries admin op
    r = await call(ADMIN_URL, employeeToken, 'getInfo');
    record(check('employee → 403 (not owner/admin)', r.status === 403, `status=${r.status} error=${r.data.error}`));

    // Unknown op
    r = await call(ADMIN_URL, employeeToken, 'nukeEverything');
    record(check('unknown op → 403/400', [400, 403].includes(r.status), `status=${r.status}`));

    console.log('\n[test] /superAdmin authorization:');
    r = await call(SUPER_URL, ordinaryToken, 'dashboard');
    record(check('ordinary user → 403', r.status === 403, `status=${r.status} error=${r.data.error}`));

    r = await call(SUPER_URL, employeeToken, 'dashboard');
    record(check('employee → 403', r.status === 403, `status=${r.status} error=${r.data.error}`));

    r = await call(SUPER_URL, employeeToken, 'listTenants');
    record(check('employee listTenants → 403', r.status === 403, `status=${r.status}`));

    r = await call(SUPER_URL, employeeToken, 'suspendTenant', { tenantId: 'lachona' });
    record(check('employee suspendTenant → 403', r.status === 403, `status=${r.status}`));

    console.log('\n[test] Input validation:');
    r = await call(SUPER_URL, employeeToken, '');
    record(check('empty op → 4xx', r.status >= 400 && r.status < 500, `status=${r.status}`));

    r = await call(ADMIN_URL, employeeToken, 'inviteTeamMember', { email: '<script>alert(1)</script>' });
    record(check('XSS attempt in email → 4xx', r.status >= 400, `status=${r.status}`));

    console.log('\n[test] Token tampering:');
    // Modify the token (simulated tamper)
    const tampered = employeeToken.slice(0, -5) + 'XXXXX';
    r = await call(SUPER_URL, tampered, 'dashboard');
    record(check('tampered token → 401', r.status === 401, `status=${r.status}`));

    // No bearer prefix
    const noBearerRes = await fetch(SUPER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://restaurant-oracle.web.app', 'Authorization': employeeToken },
      body: JSON.stringify({ op: 'dashboard' }),
    });
    record(check('token without Bearer prefix → 401', noBearerRes.status === 401, `status=${noBearerRes.status}`));

  } finally {
    console.log('\n[cleanup]');
    try { await auth.deleteUser(ordinary.uid); } catch (e) {}
    try { await auth.deleteUser(employee.uid); } catch (e) {}
  }

  console.log(`\n${fail === 0 ? '✓ All security checks passed' : '✗ ' + fail + ' checks FAILED'} (${pass} pass, ${fail} fail)`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('[e2e] FAILED:', e); process.exit(1); });
