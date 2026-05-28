/**
 * signup-rollback.js — Compensating-transaction cleanup for handleSignup.
 *
 * Why this exists.
 *   handleSignup runs 8 sequential mutations after input validation:
 *     3. reserve slug (no external side-effect)
 *     4. Square createCustomer
 *     5. Square createCard
 *     6. Square createSubscription
 *     7. Firestore tenant doc + seed data + approved_emails
 *     8. Firebase Auth user create
 *     9. Firebase Auth setCustomUserClaims
 *   A failure at step N leaves the mutations from steps < N standing.
 *   Without compensating cleanup, a typical step-8 failure produces a
 *   paying Square customer with an active subscription and no way to log in.
 *   Recon Pass 1 flagged this as the P0 (only "produces orphaned charges"
 *   failure class). This module is the cleanup half.
 *
 * Order of operations (best-effort; failures logged but never thrown):
 *   1. Cancel Square subscription (if created)
 *   2. Disable Square card (if attached)
 *   3. Audit-record the orphaned Square customer (no delete API exists)
 *   4. Recursive delete of the Firestore tenant doc + every subcollection
 *   5. Delete the Firebase Auth user (if created)
 *   6. Audit-emit rollback_complete with a per-step error map
 */
'use strict';

/**
 * Tenant subcollections that handleSignup may have touched, plus all the
 * ones a normal tenant will eventually accumulate. The recursive delete
 * walks every entry — extras that don't exist for this tenant are no-ops.
 */
const TENANT_SUBCOLLECTIONS = [
  // 16 core data collections
  'ings', 'inv', 'recs', 'menus', 'preps', 'shopping', 'areas', 'cats',
  'menu_cats', 'rec_cats', 'units', 'vendors', 'conversions', 'log',
  'settings', 'counters',
  // Auth-adjacent
  'approved_emails', 'team_members',
  // Audit + operator-side
  'audit_log', 'support_tickets', 'feedback_events', 'internal_notes',
  'geminiUsage', 'tenant_meta', 'comps',
];

async function deleteCollectionInBatches(db, collectionRef, batchSize = 500) {
  /* eslint-disable no-await-in-loop */
  while (true) {
    const snapshot = await collectionRef.limit(batchSize).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snapshot.size < batchSize) return;
  }
  /* eslint-enable no-await-in-loop */
}

async function deleteTenantRecursive(db, tenantId) {
  const tenantRef = db.collection('tenants').doc(tenantId);
  // Delete known subcollections. Firestore has no list-subcollections RPC
  // (well, getCollections() exists on Admin SDK but it's slower); the known
  // list is comprehensive for what handleSignup writes.
  for (const sub of TENANT_SUBCOLLECTIONS) {
    // eslint-disable-next-line no-await-in-loop
    await deleteCollectionInBatches(db, tenantRef.collection(sub), 500);
  }
  // Belt-and-suspenders: enumerate any unknown subcollections we missed.
  try {
    const subs = await tenantRef.listCollections();
    for (const c of subs) {
      // eslint-disable-next-line no-await-in-loop
      await deleteCollectionInBatches(db, c, 500);
    }
  } catch (_) {
    // listCollections() requires extra IAM in some environments. Best-effort.
  }
  await tenantRef.delete();
}

/**
 * Execute the compensating transaction. Returns { ok, errors } where errors
 * is an array of { step, error } records — useful for audit + operator
 * review. Never throws.
 *
 * `deps` injects collaborators so the function is testable:
 *   deps = { square, db, auth, admin, writeAuditLog, logger }
 *
 * `state` accumulates per-step success markers from handleSignup:
 *   { email, slug, squareCustomerId, squareCardId, squareSubscriptionId,
 *     tenantId, ownerUid, stage }
 */
async function rollbackSignup(deps, state, reason, errorMessage) {
  const { square, db, auth, writeAuditLog, logger } = deps;
  const log = (logger && logger.warn) ? logger.warn.bind(logger) : ((m) => console.warn('[signup-rollback] ' + m));
  const errors = [];

  const safe = (key, val) => (val == null ? null : val);
  const audit = async (op, extra) => {
    try {
      await writeAuditLog(
        safe('ownerUid', state.ownerUid) || 'signup',
        safe('email', state.email) || 'unknown',
        op,
        safe('tenantId', state.tenantId) || null,
        0,
        safe('tenantId', state.tenantId) || null,
        extra
      );
    } catch (e) {
      // Audit failures must not break rollback. The audit-queue itself
      // has its own fallback path; here we just log.
      log('audit emit failed (' + op + '): ' + (e && e.message));
    }
  };

  await audit('signup_rollback_started', {
    reason,
    errorMessage: (errorMessage || '').slice(0, 500),
    stage: state.stage || 'unknown',
    hasSquareCustomer: !!state.squareCustomerId,
    hasSquareCard: !!state.squareCardId,
    hasSquareSubscription: !!state.squareSubscriptionId,
    hasTenant: !!state.tenantId,
    hasAuthUser: !!state.ownerUid,
  });

  // ── 1. Cancel Square subscription ──────────────────────────────────────
  if (state.squareSubscriptionId) {
    try {
      await square.cancelSubscription({ subscriptionId: state.squareSubscriptionId });
      log('cancelled subscription ' + state.squareSubscriptionId);
    } catch (e) {
      errors.push({ step: 'cancelSubscription', subscriptionId: state.squareSubscriptionId, error: e && e.message });
      log('cancelSubscription failed: ' + (e && e.message));
    }
  }

  // ── 2. Disable Square card ─────────────────────────────────────────────
  if (state.squareCardId) {
    try {
      await square.disableCard({ cardId: state.squareCardId });
      log('disabled card ' + state.squareCardId);
    } catch (e) {
      errors.push({ step: 'disableCard', cardId: state.squareCardId, error: e && e.message });
      log('disableCard failed: ' + (e && e.message));
    }
  }

  // ── 3. Square customer: orphan note (no delete API) ────────────────────
  if (state.squareCustomerId) {
    errors.push({
      step: 'squareCustomer',
      customerId: state.squareCustomerId,
      note: 'Square API has no delete-customer endpoint; orphan recorded for human cleanup',
    });
  }

  // ── 4. Delete Firestore tenant (recursive) ─────────────────────────────
  if (state.tenantId) {
    try {
      await deleteTenantRecursive(db, state.tenantId);
      log('deleted tenant ' + state.tenantId);
    } catch (e) {
      errors.push({ step: 'deleteTenant', tenantId: state.tenantId, error: e && e.message });
      log('deleteTenant failed: ' + (e && e.message));
    }
  }

  // ── 5. Delete Firebase Auth user ───────────────────────────────────────
  if (state.ownerUid) {
    try {
      await auth.deleteUser(state.ownerUid);
      log('deleted auth user ' + state.ownerUid);
    } catch (e) {
      // user-not-found is fine — the user may never have been fully created.
      if (e && e.code !== 'auth/user-not-found') {
        errors.push({ step: 'deleteUser', ownerUid: state.ownerUid, error: e.message });
        // Pass 3 (Host): a stuck Auth user blocks the customer from signing up
        // again with the same email (step-2 guard would 409). Log at ERROR so
        // it surfaces in monitoring, not just the warn stream.
        console.error('[signup-rollback] CRITICAL: deleteUser failed for ' +
          state.ownerUid + ' (' + state.email + ') — manual cleanup needed: ' + e.message);
      }
    }
  }

  await audit('signup_rollback_complete', {
    reason,
    errorCount: errors.length,
    errors,
  });

  return { ok: errors.length === 0, errors };
}

module.exports = {
  rollbackSignup,
  // exposed for testing
  _internal: { deleteTenantRecursive, deleteCollectionInBatches, TENANT_SUBCOLLECTIONS },
};
