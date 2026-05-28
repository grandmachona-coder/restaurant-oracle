/**
 * _test_audit_queue.js — Unit tests for audit-queue.js.
 *
 * Self-contained: uses an in-memory mock Firestore so it doesn't touch the
 * live project. Verifies:
 *   1. processAuditMessage writes to the correct path (tenant-scoped vs root)
 *   2. Duplicate eventId → deduped=true, no double-write
 *   3. Malformed JSON → discarded, no throw
 *   4. Missing tenant_id routes to root /audit_log
 *
 * Usage:
 *   node _test_audit_queue.js
 */
'use strict';

const auditQueue = require('./audit-queue');

// ── Mock Firestore ──────────────────────────────────────────────────────────
function makeMockDb() {
  const writes = []; // [{ path, op, data }]
  const docs = new Map(); // path → data (for ALREADY_EXISTS simulation)

  function makeDocRef(path) {
    return {
      path,
      async create(data) {
        if (docs.has(path)) {
          const err = new Error(`already exists: ${path}`);
          err.code = 6;
          throw err;
        }
        docs.set(path, data);
        writes.push({ path, op: 'create', data });
        return { writeTime: Date.now() };
      },
      async set(data, _opts) {
        docs.set(path, data);
        writes.push({ path, op: 'set', data });
        return { writeTime: Date.now() };
      },
    };
  }

  function makeCollectionRef(name, basePath = '') {
    const colPath = basePath ? `${basePath}/${name}` : name;
    return {
      doc(id) { return makeDocRef(`${colPath}/${id}`); },
      async add(data) {
        const id = `auto-${Math.random().toString(36).slice(2, 10)}`;
        const path = `${colPath}/${id}`;
        docs.set(path, data);
        writes.push({ path, op: 'add', data });
        return makeDocRef(path);
      },
    };
  }

  function collection(name) { return makeCollectionRef(name); }

  // /tenants/{id}/collection/{doc}
  collection.tenantsHelper = (tenantId) => ({
    collection(name) {
      return makeCollectionRef(name, `tenants/${tenantId}`);
    },
  });

  return {
    collection(name) {
      const col = makeCollectionRef(name);
      // monkey-patch doc(id).collection(sub) so we can chain
      const origDoc = col.doc.bind(col);
      col.doc = (id) => {
        const ref = origDoc(id);
        ref.collection = (sub) => makeCollectionRef(sub, `${name}/${id}`);
        return ref;
      };
      return col;
    },
    _writes: writes,
    _docs: docs,
  };
}

// Mock admin SDK — only the bits the queue uses.
const mockAdmin = {
  firestore: {
    FieldValue: {
      serverTimestamp: () => ({ _mockServerTimestamp: true }),
    },
  },
};

// ── Assertions ──────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
function assert(condition, msg) {
  if (condition) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── Tests ───────────────────────────────────────────────────────────────────
async function testTenantScopedWrite() {
  console.log('\n[1] Tenant-scoped write lands at /tenants/{id}/audit_log/{eventId}');
  const db = makeMockDb();
  const payload = {
    user_id: 'u1', user_email: 'alice@example.com',
    tenant_id: 't-abc', operation: 'insert', collection: 'ings',
    record_count: 3, publisher_timestamp_ms: 1234567890,
    eventId: 'evt-001',
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const result = await auditQueue.processAuditMessage(db, mockAdmin, data, { eventId: 'evt-001' });
  assertEq(result.ok, true, 'result.ok=true');
  assertEq(result.deduped, false, 'deduped=false');
  assertEq(db._writes.length, 1, 'exactly one write');
  assertEq(db._writes[0].path, 'tenants/t-abc/audit_log/evt-001', 'path is tenant-scoped');
  assertEq(db._writes[0].data.operation, 'insert', 'operation preserved');
  assertEq(db._writes[0].data.via, 'pubsub', 'via=pubsub');
}

async function testRootFallback() {
  console.log('\n[2] Null tenant_id routes to root /audit_log');
  const db = makeMockDb();
  const payload = {
    user_id: null, user_email: 'unknown',
    tenant_id: null, operation: 'auth_failure',
    eventId: 'evt-root-1',
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const result = await auditQueue.processAuditMessage(db, mockAdmin, data, {});
  assertEq(result.ok, true, 'result.ok=true');
  assertEq(db._writes[0].path, 'audit_log/evt-root-1', 'path is root');
}

async function testDuplicateDelivery() {
  console.log('\n[3] Duplicate eventId returns deduped=true');
  const db = makeMockDb();
  const payload = {
    user_id: 'u1', tenant_id: 't-abc', operation: 'update',
    eventId: 'evt-dupe',
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const r1 = await auditQueue.processAuditMessage(db, mockAdmin, data, { eventId: 'evt-dupe' });
  const r2 = await auditQueue.processAuditMessage(db, mockAdmin, data, { eventId: 'evt-dupe' });
  assertEq(r1.deduped, false, 'first delivery not deduped');
  assertEq(r2.deduped, true, 'second delivery deduped');
  assertEq(db._writes.length, 1, 'only one write occurred');
}

async function testMalformedDiscarded() {
  console.log('\n[4] Malformed JSON is discarded, no throw');
  const db = makeMockDb();
  const data = Buffer.from('not json at all {{}').toString('base64');
  let threw = false;
  let result;
  try {
    result = await auditQueue.processAuditMessage(db, mockAdmin, data, {});
  } catch (_) { threw = true; }
  assertEq(threw, false, 'did not throw');
  assertEq(result.discarded, true, 'discarded=true');
  assertEq(db._writes.length, 0, 'no writes attempted');
}

async function testDirectWriteFallback() {
  console.log('\n[5] directWriteAuditEvent with same eventId is idempotent');
  const db = makeMockDb();
  const event = {
    user_id: 'u1', tenant_id: 't-abc', operation: 'insert',
    collection: 'ings', record_count: 1,
  };
  const id1 = await auditQueue.directWriteAuditEvent(db, mockAdmin, event, 'evt-fallback-1');
  const id2 = await auditQueue.directWriteAuditEvent(db, mockAdmin, event, 'evt-fallback-1');
  assertEq(id1, 'evt-fallback-1', 'first call returns id');
  assertEq(id2, 'evt-fallback-1', 'second call returns same id (ALREADY_EXISTS)');
  assertEq(db._writes.length, 1, 'only one write committed');
}

async function testDeriveEventId() {
  console.log('\n[6] deriveEventId is stable for the same idempotency key');
  const a = auditQueue._internal.deriveEventId({ operation: 'x' }, 'webhook-event-abc');
  const b = auditQueue._internal.deriveEventId({ operation: 'x' }, 'webhook-event-abc');
  assertEq(a, b, 'same key → same id');
  const c = auditQueue._internal.deriveEventId({ operation: 'x' });
  assert(c && c.length >= 8, 'no-key call generates a UUID-shaped id');
}

async function main() {
  console.log('[audit-queue test] starting…');
  await testTenantScopedWrite();
  await testRootFallback();
  await testDuplicateDelivery();
  await testMalformedDiscarded();
  await testDirectWriteFallback();
  await testDeriveEventId();
  console.log(`\n[audit-queue test] ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error('test crashed:', e); process.exit(1); });
