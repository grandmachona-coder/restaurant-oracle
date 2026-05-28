'use strict';

// I-2 retention-sweep spec tests.
// Run: node firebase/functions/_test_retention.js

const assert = require('assert');
const R = require('./retention');

let passed = 0, failed = 0;
function sync(name, fn) {
  try { fn(); console.log('  ok ' + name); passed++; }
  catch (e) { console.log('  FAIL ' + name + ' — ' + e.message); failed++; }
}
function asyncT(name, fn) {
  return fn().then(() => { console.log('  ok ' + name); passed++; })
    .catch((e) => { console.log('  FAIL ' + name + ' — ' + e.message); failed++; });
}

const DAY = 86400000;
const NOW = Date.UTC(2026, 4, 21); // 2026-05-21

async function main() {
  console.log('# isTenantDueForPurge');
  sync('cancelled 91 days ago → due', () => {
    assert.strictEqual(R.isTenantDueForPurge({ canceledAt: NOW - 91 * DAY }, NOW), true);
  });
  sync('cancelled 89 days ago → NOT due (inside 90d window)', () => {
    assert.strictEqual(R.isTenantDueForPurge({ canceledAt: NOW - 89 * DAY }, NOW), false);
  });
  sync('never cancelled → not due', () => {
    assert.strictEqual(R.isTenantDueForPurge({ status: 'active' }, NOW), false);
  });
  sync('already purged (dataPurgedAt set) → not due (idempotent)', () => {
    assert.strictEqual(R.isTenantDueForPurge({ canceledAt: NOW - 200 * DAY, dataPurgedAt: NOW - 100 * DAY }, NOW), false);
  });
  sync('Firestore Timestamp-shaped canceledAt is accepted', () => {
    const ts = { toMillis: () => NOW - 100 * DAY };
    assert.strictEqual(R.isTenantDueForPurge({ canceledAt: ts }, NOW), true);
  });

  console.log('# isAuditEntryExpired');
  sync('8-year-old entry → expired', () => {
    assert.strictEqual(R.isAuditEntryExpired({ timestamp: NOW - 8 * 365 * DAY }, NOW), true);
  });
  sync('6-year-old entry → kept', () => {
    assert.strictEqual(R.isAuditEntryExpired({ timestamp: NOW - 6 * 365 * DAY }, NOW), false);
  });
  sync('unknown age → kept (fail-safe)', () => {
    assert.strictEqual(R.isAuditEntryExpired({}, NOW), false);
  });

  console.log('# hardDeleteEnabled');
  sync('env flag "true" enables', () => {
    assert.strictEqual(R.hardDeleteEnabled({ RETENTION_SWEEP_ENABLED: 'true' }), true);
  });
  sync('absent / other → disabled (safe default)', () => {
    assert.strictEqual(R.hardDeleteEnabled({}), false);
    assert.strictEqual(R.hardDeleteEnabled({ RETENTION_SWEEP_ENABLED: 'yes' }), false);
  });

  // --- mock db/admin for purgeTenantData ---------------------------------
  function makeMock() {
    const calls = { deleted: [], updates: [], audits: [], revoked: [], deletedUsers: [] };
    const admin = { firestore: { FieldValue: { serverTimestamp: () => '<ts>' } } };
    const tenantRef = {
      update: async (u) => { calls.updates.push(u); },
      collection: (sub) => ({
        get: async () => ({ docs: sub === 'approved_emails' ? [{ data: () => ({ uid: 'u1' }) }] : [] }),
        __sub: sub,
      }),
    };
    const db = { collection: () => ({ doc: () => tenantRef }) };
    const deps = {
      db, admin,
      deleteCollectionInBatches: async (_db, ref) => { calls.deleted.push(ref.__sub); },
      auth: { deleteUser: async (uid) => { calls.deletedUsers.push(uid); } },
      revokeTokens: async (tid) => { calls.revoked.push(tid); },
      writeAuditLog: async (a, b, op) => { calls.audits.push(op); },
    };
    return { deps, calls };
  }

  console.log('# purgeTenantData — report-only (default)');
  await asyncT('report-only stamps purgeEligibleAt, deletes nothing', async () => {
    const { deps, calls } = makeMock();
    const r = await R.purgeTenantData(deps, 'tenantX', { hardDelete: false });
    assert.strictEqual(r.purged, false);
    assert.strictEqual(r.reportOnly, true);
    assert.strictEqual(calls.deleted.length, 0, 'should not delete subcollections');
    assert(calls.updates.some(u => 'purgeEligibleAt' in u), 'should stamp purgeEligibleAt');
    assert(calls.audits.includes('retention_purge_eligible'));
  });

  console.log('# purgeTenantData — hard delete');
  await asyncT('hard delete purges operational subcollections but NOT audit_log', async () => {
    const { deps, calls } = makeMock();
    const r = await R.purgeTenantData(deps, 'tenantX', { hardDelete: true });
    assert.strictEqual(r.purged, true);
    assert(calls.deleted.length === R.PURGE_SUBCOLLECTIONS.length, 'deleted ' + calls.deleted.length);
    assert.strictEqual(calls.deleted.indexOf('audit_log'), -1, 'audit_log must be preserved');
    assert(calls.revoked.includes('tenantX'), 'should revoke tokens');
    assert(calls.deletedUsers.includes('u1'), 'should delete enumerated auth user');
    assert(calls.updates.some(u => 'dataPurgedAt' in u), 'should stamp dataPurgedAt');
    assert(calls.audits.includes('retention_purge_complete'));
  });
  sync('PURGE_SUBCOLLECTIONS never includes audit_log', () => {
    assert.strictEqual(R.PURGE_SUBCOLLECTIONS.indexOf('audit_log'), -1);
  });

  console.log('\nTests: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main();
