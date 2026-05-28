'use strict';

// N-1/N-2 scheduler-heartbeat spec tests.
// Run: node firebase/functions/_test_scheduler_heartbeat.js

const assert = require('assert');
const { recordHeartbeat, withHeartbeat, _internal } = require('./scheduler-heartbeat');
const { deriveQuality } = _internal;

let passed = 0, failed = 0;
function t(name, fn) {
  return fn().then(() => { console.log('  ok ' + name); passed++; })
    .catch((e) => { console.log('  FAIL ' + name + ' — ' + e.message); failed++; });
}
function sync(name, fn) {
  try { fn(); console.log('  ok ' + name); passed++; }
  catch (e) { console.log('  FAIL ' + name + ' — ' + e.message); failed++; }
}

// --- Mock Firestore + admin ----------------------------------------------
function makeMock() {
  const store = {};
  const admin = {
    firestore: {
      FieldValue: {
        serverTimestamp: () => '<ts>',
        increment: (n) => ({ __op: 'increment', n }),
      },
    },
  };
  const db = {
    collection: (c) => ({
      doc: (id) => ({
        set: async (data, opts) => {
          const key = c + '/' + id;
          const prev = store[key] || {};
          // emulate merge + increment
          const next = opts && opts.merge ? { ...prev } : {};
          for (const [k, v] of Object.entries(data)) {
            if (v && v.__op === 'increment') next[k] = (prev[k] || 0) + v.n;
            else next[k] = v;
          }
          store[key] = next;
        },
      }),
    }),
  };
  return { db, admin, store };
}

async function main() {
  console.log('# deriveQuality');
  sync('complete when written+errors >= scanned', () => {
    assert.deepStrictEqual(deriveQuality({ scanned: 5, written: 5, errors: 0 }), { complete: true, degraded: false });
  });
  sync('incomplete when partial (written+errors < scanned)', () => {
    assert.deepStrictEqual(deriveQuality({ scanned: 10, written: 4, errors: 0 }), { complete: false, degraded: false });
  });
  sync('degraded when errors > 0', () => {
    assert.deepStrictEqual(deriveQuality({ scanned: 5, written: 4, errors: 1 }), { complete: true, degraded: true });
  });
  sync('no scanned field → complete=true (n/a)', () => {
    assert.deepStrictEqual(deriveQuality({}), { complete: true, degraded: false });
  });

  console.log('# recordHeartbeat');
  await t('success writes lastSuccessAt + resets consecutiveFailures', async () => {
    const { db, admin, store } = makeMock();
    await recordHeartbeat(db, admin, 'jobA', { status: 'success', durationMs: 100, processingDate: '2026-05-20', stats: { scanned: 3, written: 3, errors: 0 } });
    const hb = store['scheduler_heartbeats/jobA'];
    assert.strictEqual(hb.lastStatus, 'success');
    assert.strictEqual(hb.complete, true);
    assert.strictEqual(hb.degraded, false);
    assert.strictEqual(hb.lastSuccessDate, '2026-05-20');
    assert.strictEqual(hb.consecutiveFailures, 0);
  });
  await t('error increments consecutiveFailures and marks not-complete', async () => {
    const { db, admin, store } = makeMock();
    await recordHeartbeat(db, admin, 'jobB', { status: 'error', durationMs: 5, error: 'boom' });
    let hb = store['scheduler_heartbeats/jobB'];
    assert.strictEqual(hb.lastStatus, 'error');
    assert.strictEqual(hb.complete, false);
    assert.strictEqual(hb.degraded, true);
    assert.strictEqual(hb.lastError, 'boom');
    assert.strictEqual(hb.consecutiveFailures, 1);
    // second failure increments again
    await recordHeartbeat(db, admin, 'jobB', { status: 'error', durationMs: 5, error: 'boom2' });
    hb = store['scheduler_heartbeats/jobB'];
    assert.strictEqual(hb.consecutiveFailures, 2);
  });
  await t('partial run recorded as not-complete', async () => {
    const { db, admin, store } = makeMock();
    await recordHeartbeat(db, admin, 'jobC', { status: 'success', durationMs: 540000, processingDate: '2026-05-20', stats: { scanned: 100, written: 60, errors: 0 } });
    assert.strictEqual(store['scheduler_heartbeats/jobC'].complete, false);
  });

  console.log('# withHeartbeat');
  await t('runs runner, records success, returns stats', async () => {
    const { db, admin, store } = makeMock();
    const stats = await withHeartbeat(db, admin, 'jobD', async () => ({ scanned: 2, written: 2, errors: 0, date: '2026-05-20' }));
    assert.strictEqual(stats.written, 2);
    assert.strictEqual(store['scheduler_heartbeats/jobD'].lastStatus, 'success');
    assert.strictEqual(store['scheduler_heartbeats/jobD'].lastDate, '2026-05-20');
  });
  await t('runner throw → records error heartbeat AND re-throws', async () => {
    const { db, admin, store } = makeMock();
    let threw = false;
    try {
      await withHeartbeat(db, admin, 'jobE', async () => { throw new Error('kaboom'); });
    } catch (e) { threw = true; assert.strictEqual(e.message, 'kaboom'); }
    assert(threw, 'withHeartbeat should re-throw to preserve Pub/Sub retry');
    assert.strictEqual(store['scheduler_heartbeats/jobE'].lastStatus, 'error');
    assert.strictEqual(store['scheduler_heartbeats/jobE'].lastError, 'kaboom');
  });

  console.log('\nTests: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main();
