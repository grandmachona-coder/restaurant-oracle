/**
 * _test_signup_rollback.js — Unit tests for signup-rollback.js.
 *
 * Self-contained: mocks Square + Firestore + Auth so it runs offline.
 * Covers each failure boundary in handleSignup:
 *   - Step 5 fail (customer exists, no card/sub/tenant/user)
 *   - Step 6 fail (customer + card, no sub/tenant/user)
 *   - Step 7 fail (customer + card + sub, no tenant/user)
 *   - Step 8 fail (customer + card + sub + tenant + approved_emails, no user)
 *   - Step 9 fail (all of the above + auth user; only claims missing)
 * Plus:
 *   - Best-effort behavior: Square cancel failure doesn't block Auth deletion
 *   - Audit emit on start AND complete with error map
 *
 * Usage:
 *   node _test_signup_rollback.js
 */
'use strict';

const signupRollback = require('./signup-rollback');

// ── Mock Firestore (richer than the audit-queue mock — needs subcollections) ─
function makeMockDb() {
  const writes = [];   // [{path, op, data}]
  const deletes = [];  // [path]
  const docs = new Map();

  function makeDocRef(path) {
    return {
      path,
      async set(data) { docs.set(path, data); writes.push({ path, op: 'set', data }); },
      async delete() { docs.delete(path); deletes.push(path); },
      collection(name) { return makeCollectionRef(`${path}/${name}`); },
      async get() {
        return docs.has(path)
          ? { exists: true, id: path.split('/').pop(), data: () => docs.get(path) }
          : { exists: false, data: () => undefined };
      },
      // For listCollections() — return any direct subcollections we've seen.
      async listCollections() {
        const prefix = path + '/';
        const subs = new Set();
        for (const p of docs.keys()) {
          if (p.startsWith(prefix)) {
            const rest = p.slice(prefix.length);
            const sub = rest.split('/')[0];
            subs.add(sub);
          }
        }
        return Array.from(subs).map(sub => makeCollectionRef(`${path}/${sub}`));
      },
    };
  }

  function makeCollectionRef(colPath) {
    return {
      path: colPath,
      doc(id) {
        if (!id) {
          id = 'auto-' + Math.random().toString(36).slice(2, 10);
        }
        return makeDocRef(`${colPath}/${id}`);
      },
      async add(data) {
        const id = 'auto-' + Math.random().toString(36).slice(2, 10);
        const path = `${colPath}/${id}`;
        docs.set(path, data);
        writes.push({ path, op: 'add', data });
        return makeDocRef(path);
      },
      limit(_n) {
        return {
          get: async () => {
            const prefix = colPath + '/';
            const matched = [];
            for (const [p, data] of docs.entries()) {
              if (p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) {
                matched.push({ ref: makeDocRef(p), id: p.split('/').pop(), data: () => data });
              }
            }
            return {
              empty: matched.length === 0,
              size: matched.length,
              docs: matched,
              forEach: (cb) => matched.forEach(cb),
            };
          },
        };
      },
    };
  }

  const db = {
    collection: (name) => makeCollectionRef(name),
    batch: () => {
      const ops = [];
      return {
        delete: (ref) => { ops.push({ kind: 'delete', ref }); },
        set: (ref, data) => { ops.push({ kind: 'set', ref, data }); },
        commit: async () => {
          for (const op of ops) {
            if (op.kind === 'delete') await op.ref.delete();
            else if (op.kind === 'set') await op.ref.set(op.data);
          }
        },
      };
    },
    _writes: writes,
    _deletes: deletes,
    _docs: docs,
  };
  return db;
}

function makeMockSquare() {
  const calls = [];
  return {
    calls,
    async cancelSubscription({ subscriptionId }) { calls.push({ fn: 'cancelSubscription', subscriptionId }); return { id: subscriptionId, status: 'CANCELED' }; },
    async disableCard({ cardId }) { calls.push({ fn: 'disableCard', cardId }); return { id: cardId, enabled: false }; },
  };
}

function makeFailingSquare() {
  return {
    calls: [],
    async cancelSubscription() { this.calls.push({ fn: 'cancelSubscription' }); throw new Error('square outage'); },
    async disableCard() { this.calls.push({ fn: 'disableCard' }); throw new Error('square outage'); },
  };
}

function makeMockAuth(failNotFound) {
  const calls = [];
  return {
    calls,
    async deleteUser(uid) {
      calls.push({ fn: 'deleteUser', uid });
      if (failNotFound) {
        const e = new Error('user not found'); e.code = 'auth/user-not-found'; throw e;
      }
    },
  };
}

const mockAdmin = {
  firestore: {
    FieldValue: { serverTimestamp: () => ({ _mockServerTimestamp: true }) },
    Timestamp: { fromDate: (d) => ({ _mockTimestamp: true, _date: d }) },
  },
};

// ── Assertions ─────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}
function assertEq(a, e, msg) { assert(a === e, `${msg} — expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }

// ── Audit-log capture ──────────────────────────────────────────────────────
function makeAuditCapture() {
  const calls = [];
  return {
    calls,
    async writeAuditLog(uid, email, op, coll, count, tenantId, extra) {
      calls.push({ uid, email, op, coll, count, tenantId, extra });
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────
async function testStep5Failure() {
  console.log('\n[1] Step-5 failure (card attach): customer orphan note, no Firestore delete, no Auth delete');
  const square = makeMockSquare();
  const db = makeMockDb();
  const auth = makeMockAuth();
  const audit = makeAuditCapture();
  const deps = { square, db, auth, admin: mockAdmin, writeAuditLog: audit.writeAuditLog };
  const state = {
    email: 'a@x.com',
    slug: 'a-bistro',
    squareCustomerId: 'cust_1',
    squareCardId: null,
    squareSubscriptionId: null,
    tenantId: null,
    ownerUid: null,
    stage: 'square_customer_created',
  };
  const result = await signupRollback.rollbackSignup(deps, state, 'square_card_failed', 'card declined');
  assertEq(result.ok, false, 'has orphan customer error');
  assertEq(result.errors.length, 1, 'one error (orphan customer)');
  assertEq(result.errors[0].step, 'squareCustomer', 'orphan step name');
  assertEq(square.calls.length, 0, 'no Square cleanup attempted');
  assertEq(auth.calls.length, 0, 'no Auth deletion attempted');
  assertEq(audit.calls.length, 2, 'audit emit: started + complete');
  assertEq(audit.calls[0].op, 'signup_rollback_started', 'first audit is started');
  assertEq(audit.calls[1].op, 'signup_rollback_complete', 'second audit is complete');
}

async function testStep6Failure() {
  console.log('\n[2] Step-6 failure (subscription): disable card + orphan customer');
  const square = makeMockSquare();
  const db = makeMockDb();
  const auth = makeMockAuth();
  const audit = makeAuditCapture();
  const deps = { square, db, auth, admin: mockAdmin, writeAuditLog: audit.writeAuditLog };
  const state = {
    email: 'b@x.com', slug: 'b', squareCustomerId: 'cust_2', squareCardId: 'card_2',
    squareSubscriptionId: null, tenantId: null, ownerUid: null,
    stage: 'square_card_attached',
  };
  const result = await signupRollback.rollbackSignup(deps, state, 'square_subscription_failed', 'sub error');
  const calls = square.calls.map(c => c.fn);
  assert(calls.includes('disableCard'), 'disableCard was called');
  assert(!calls.includes('cancelSubscription'), 'cancelSubscription NOT called');
  assertEq(result.errors.filter(e => e.step === 'squareCustomer').length, 1, 'orphan customer recorded');
}

async function testStep8FailureFullRollback() {
  console.log('\n[3] Step-8 failure (Auth user): full rollback — sub canceled, card disabled, tenant deleted, customer orphan');
  const square = makeMockSquare();
  const db = makeMockDb();
  // Pre-seed tenant doc + subcollection data to verify recursive delete
  await db.collection('tenants').doc('t-3').set({ slug: 'b3', ownerEmail: 'c@x.com' });
  await db.collection('tenants').doc('t-3').collection('approved_emails').add({ email: 'c@x.com', role: 'owner' });
  await db.collection('tenants').doc('t-3').collection('ings').doc('1').set({ id: 1, name: 'Tomato' });
  await db.collection('tenants').doc('t-3').collection('units').doc('1').set({ id: 1, name: 'kg' });
  const auth = makeMockAuth();
  const audit = makeAuditCapture();
  const deps = { square, db, auth, admin: mockAdmin, writeAuditLog: audit.writeAuditLog };
  const state = {
    email: 'c@x.com', slug: 'b3',
    squareCustomerId: 'cust_3', squareCardId: 'card_3', squareSubscriptionId: 'sub_3',
    tenantId: 't-3', ownerUid: null,
    stage: 'tenant_provisioned',
  };
  const result = await signupRollback.rollbackSignup(deps, state, 'auth_user_create_failed', 'auth/email-already-exists');
  const sqCalls = square.calls.map(c => c.fn);
  assert(sqCalls.includes('cancelSubscription'), 'cancelSubscription called');
  assert(sqCalls.includes('disableCard'), 'disableCard called');
  // Verify tenant is gone (doc + subcollections)
  assert(!db._docs.has('tenants/t-3'), 'tenant doc deleted');
  assert(!db._docs.has('tenants/t-3/ings/1'), 'ings/1 deleted');
  assert(!db._docs.has('tenants/t-3/units/1'), 'units/1 deleted');
  // approved_emails was an auto-id; verify by prefix scan
  const orphanedSubs = Array.from(db._docs.keys()).filter(p => p.startsWith('tenants/t-3/'));
  assertEq(orphanedSubs.length, 0, 'no tenant subcollection docs remain');
  assertEq(auth.calls.length, 0, 'auth.deleteUser NOT called (user never created)');
  assertEq(result.errors.filter(e => e.step === 'squareCustomer').length, 1, 'orphan customer recorded');
}

async function testStep9FailureWithAuthUser() {
  console.log('\n[4] Step-9 failure (claim mint): full rollback INCLUDING auth.deleteUser');
  const square = makeMockSquare();
  const db = makeMockDb();
  await db.collection('tenants').doc('t-4').set({ slug: 'b4' });
  await db.collection('tenants').doc('t-4').collection('settings').doc('1').set({ id: 1 });
  const auth = makeMockAuth();
  const audit = makeAuditCapture();
  const deps = { square, db, auth, admin: mockAdmin, writeAuditLog: audit.writeAuditLog };
  const state = {
    email: 'd@x.com', slug: 'b4',
    squareCustomerId: 'cust_4', squareCardId: 'card_4', squareSubscriptionId: 'sub_4',
    tenantId: 't-4', ownerUid: 'uid_4',
    stage: 'auth_user_created',
  };
  const result = await signupRollback.rollbackSignup(deps, state, 'claim_mint_failed', 'invalid claim');
  assertEq(auth.calls.length, 1, 'auth.deleteUser called once');
  assertEq(auth.calls[0].uid, 'uid_4', 'correct uid deleted');
  // Errors should still only include the unavoidable orphan customer note
  const realErrors = result.errors.filter(e => e.step !== 'squareCustomer');
  assertEq(realErrors.length, 0, 'no other errors');
}

async function testSquareFailureNonBlocking() {
  console.log('\n[5] Best-effort: Square cancel failure does NOT block tenant/Auth deletion');
  const square = makeFailingSquare();
  const db = makeMockDb();
  await db.collection('tenants').doc('t-5').set({ slug: 'b5' });
  const auth = makeMockAuth();
  const audit = makeAuditCapture();
  const deps = { square, db, auth, admin: mockAdmin, writeAuditLog: audit.writeAuditLog };
  const state = {
    email: 'e@x.com', slug: 'b5',
    squareCustomerId: 'cust_5', squareCardId: 'card_5', squareSubscriptionId: 'sub_5',
    tenantId: 't-5', ownerUid: 'uid_5',
    stage: 'auth_user_created',
  };
  const result = await signupRollback.rollbackSignup(deps, state, 'test', 'simulated');
  assert(!db._docs.has('tenants/t-5'), 'tenant doc deleted despite Square failures');
  assertEq(auth.calls.length, 1, 'auth user deletion still attempted');
  const sqErrors = result.errors.filter(e => e.step === 'cancelSubscription' || e.step === 'disableCard');
  assertEq(sqErrors.length, 2, 'both Square errors captured');
}

async function testAuthUserNotFoundIsFine() {
  console.log('\n[6] auth/user-not-found is not an error');
  const square = makeMockSquare();
  const db = makeMockDb();
  const auth = makeMockAuth(true); // throws auth/user-not-found
  const audit = makeAuditCapture();
  const deps = { square, db, auth, admin: mockAdmin, writeAuditLog: audit.writeAuditLog };
  const state = {
    email: 'f@x.com', slug: 'b6', squareCustomerId: null, squareCardId: null,
    squareSubscriptionId: null, tenantId: null, ownerUid: 'uid_phantom',
    stage: 'auth_user_created',
  };
  const result = await signupRollback.rollbackSignup(deps, state, 'test', 'simulated');
  assertEq(result.ok, true, 'rollback ok (no errors)');
  assertEq(result.errors.length, 0, 'user-not-found suppressed');
}

async function testAuditEmitFailuresDontCrash() {
  console.log('\n[7] Audit emit failures do not break rollback');
  const square = makeMockSquare();
  const db = makeMockDb();
  const auth = makeMockAuth();
  // Audit hook that always throws
  const writeAuditLog = async () => { throw new Error('audit pipeline down'); };
  const deps = { square, db, auth, admin: mockAdmin, writeAuditLog };
  const state = {
    email: 'g@x.com', slug: 'b7', squareCustomerId: 'cust_7', squareCardId: 'card_7',
    squareSubscriptionId: 'sub_7', tenantId: null, ownerUid: null,
    stage: 'square_subscription_created',
  };
  let threw = false;
  try {
    await signupRollback.rollbackSignup(deps, state, 'test', 'simulated');
  } catch (_) { threw = true; }
  assertEq(threw, false, 'did not throw despite audit failures');
  // Square cleanups should still have happened
  assertEq(square.calls.length, 2, 'Square cleanups attempted');
}

async function main() {
  console.log('[signup-rollback test] starting…');
  await testStep5Failure();
  await testStep6Failure();
  await testStep8FailureFullRollback();
  await testStep9FailureWithAuthUser();
  await testSquareFailureNonBlocking();
  await testAuthUserNotFoundIsFine();
  await testAuditEmitFailuresDontCrash();
  console.log(`\n[signup-rollback test] ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error('test crashed:', e); process.exit(1); });
