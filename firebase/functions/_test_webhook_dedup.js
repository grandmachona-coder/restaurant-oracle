'use strict';

// K-2 webhook-dedup spec tests.
// Run: node firebase/functions/_test_webhook_dedup.js

const assert = require('assert');
const { processWebhookOnce, _internal } = require('./webhook-dedup');
const { shouldReprocess, isAlreadyExists } = _internal;

let passed = 0, failed = 0;
function sync(name, fn) {
  try { fn(); console.log('  ok ' + name); passed++; }
  catch (e) { console.log('  FAIL ' + name + ' — ' + e.message); failed++; }
}
function asyncT(name, fn) {
  return fn().then(() => { console.log('  ok ' + name); passed++; })
    .catch((e) => { console.log('  FAIL ' + name + ' — ' + e.message); failed++; });
}

// Mock Firestore. store maps eventId → doc data. create() throws ALREADY_EXISTS
// (code 6) if present.
function makeMock(initial) {
  const store = Object.assign({}, initial);
  const admin = { firestore: { FieldValue: { serverTimestamp: () => '<ts>' } } };
  const db = {
    collection: () => ({
      doc: (id) => ({
        create: async (data) => {
          if (id in store) { const e = new Error('already exists'); e.code = 6; throw e; }
          store[id] = Object.assign({}, data);
        },
        get: async () => ({ exists: id in store, data: () => store[id] }),
        set: async (data, opts) => {
          store[id] = opts && opts.merge ? Object.assign({}, store[id], data) : Object.assign({}, data);
        },
      }),
    }),
  };
  return { db, admin, store };
}

async function main() {
  console.log('# pure helpers');
  sync('shouldReprocess: processed → false', () => assert.strictEqual(shouldReprocess('processed'), false));
  sync('shouldReprocess: processing → true', () => assert.strictEqual(shouldReprocess('processing'), true));
  sync('shouldReprocess: null → true', () => assert.strictEqual(shouldReprocess(null), true));
  sync('isAlreadyExists detects code 6', () => assert.strictEqual(isAlreadyExists({ code: 6 }), true));
  sync('isAlreadyExists detects message', () => assert.strictEqual(isAlreadyExists({ message: 'Document already exists' }), true));
  sync('isAlreadyExists false for other', () => assert.strictEqual(isAlreadyExists({ code: 5 }), false));

  console.log('# first delivery');
  await asyncT('first delivery processes and marks processed', async () => {
    const { db, admin, store } = makeMock();
    let ran = 0;
    const r = await processWebhookOnce({ db, admin }, 'evt_1', { type: 'invoice.payment_made' }, async () => { ran++; });
    assert.strictEqual(ran, 1);
    assert.strictEqual(r.processed, true);
    assert.strictEqual(r.deduped, false);
    assert.strictEqual(store['evt_1'].status, 'processed');
  });

  console.log('# duplicate of processed event');
  await asyncT('duplicate of processed event is SKIPPED', async () => {
    const { db, admin } = makeMock({ evt_2: { status: 'processed' } });
    let ran = 0;
    const r = await processWebhookOnce({ db, admin }, 'evt_2', { type: 'x' }, async () => { ran++; });
    assert.strictEqual(ran, 0, 'handler must not run for processed duplicate');
    assert.strictEqual(r.deduped, true);
    assert.strictEqual(r.processed, false);
  });

  console.log('# retry of a previously-failed (still processing) event');
  await asyncT('marker in processing state → REPROCESS (retry-safe)', async () => {
    const { db, admin, store } = makeMock({ evt_3: { status: 'processing' } });
    let ran = 0;
    const r = await processWebhookOnce({ db, admin }, 'evt_3', { type: 'x' }, async () => { ran++; });
    assert.strictEqual(ran, 1, 'should reprocess an unfinished delivery');
    assert.strictEqual(r.processed, true);
    assert.strictEqual(store['evt_3'].status, 'processed');
  });

  console.log('# handler failure leaves marker non-processed and rethrows');
  await asyncT('handler throw → rethrows, marker stays processing', async () => {
    const { db, admin, store } = makeMock();
    let threw = false;
    try {
      await processWebhookOnce({ db, admin }, 'evt_4', { type: 'x' }, async () => { throw new Error('downstream boom'); });
    } catch (e) { threw = true; assert.strictEqual(e.message, 'downstream boom'); }
    assert(threw, 'must rethrow so caller returns 500');
    assert.strictEqual(store['evt_4'].status, 'processing', 'must NOT be marked processed');
  });
  await asyncT('a later retry after failure reprocesses to completion', async () => {
    const { db, admin, store } = makeMock();
    // first attempt fails
    try { await processWebhookOnce({ db, admin }, 'evt_5', { type: 'x' }, async () => { throw new Error('boom'); }); }
    catch (_) { /* expected */ }
    assert.strictEqual(store['evt_5'].status, 'processing');
    // Square retries → should reprocess and complete
    let ran = 0;
    const r = await processWebhookOnce({ db, admin }, 'evt_5', { type: 'x' }, async () => { ran++; });
    assert.strictEqual(ran, 1);
    assert.strictEqual(r.processed, true);
    assert.strictEqual(store['evt_5'].status, 'processed');
  });

  console.log('# unkeyed event');
  await asyncT('missing event_id → processed without dedup, flagged unkeyed', async () => {
    const { db, admin } = makeMock();
    let ran = 0;
    const r = await processWebhookOnce({ db, admin }, null, { type: 'x' }, async () => { ran++; });
    assert.strictEqual(ran, 1);
    assert.strictEqual(r.unkeyed, true);
  });

  console.log('\nTests: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main();
