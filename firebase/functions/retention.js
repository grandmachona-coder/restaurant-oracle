/**
 * retention.js — enforces the data-retention promises in privacy.html.
 *
 * Why this exists (Inspector recon I-2, P1).
 *   privacy.html §7 promises:
 *     • Cancelled account: retained 30 days (reactivation), then deleted within
 *       a further 60 days  → operational data purged ~90 days after cancel.
 *     • Audit logs & billing records: retained up to 7 years.
 *   None of this was enforced in code — a cancelled tenant's data lived forever.
 *   This module is the enforcement half, run by the dailyRetentionSweep CF.
 *
 * SAFETY (this deletes customer data).
 *   Destructive purge is gated behind the RETENTION_SWEEP_ENABLED env var. When
 *   it is not "true" (the DEFAULT), the sweep runs in REPORT-ONLY mode: identifies
 *   eligible tenants, stamps `purgeEligibleAt`, emits an audit event, and logs —
 *   but deletes nothing. An operator flips RETENTION_SWEEP_ENABLED=true (env)
 *   once they've reviewed the eligibility report. This prevents a logic bug from
 *   silently destroying the data of the only live customer. The 90-day buffer,
 *   idempotency (skip if dataPurgedAt set), and audit-log preservation are
 *   additional guards.
 *
 *   `canceledAt` is the trigger: adminOpCancelSubscription stamps it and
 *   resumeSubscription DELETES it, so the presence of an old canceledAt reliably
 *   means "still cancelled, past the window".
 *
 * What is purged vs preserved.
 *   PURGED:    all operational subcollections (ings, inv, recs, menus, …,
 *              team_members, approved_emails, support_tickets, feedback_events,
 *              internal_notes, geminiUsage, conversions, vendors, settings, …).
 *   PRESERVED: audit_log (holds billing records) for the 7-year window, plus the
 *              tenant doc itself (stamped dataPurgedAt) as the retention anchor.
 *   A separate pass deletes audit_log entries older than 7 years.
 */
'use strict';

const DAY_MS = 86400000;
const PURGE_AFTER_DAYS = 90;            // 30 reactivation + 60 deletion window
const AUDIT_RETENTION_DAYS = 365 * 7;   // 7 years

// Operational subcollections to purge. Deliberately EXCLUDES 'audit_log'
// (preserved 7 years) and tracks everything else a tenant accumulates.
const PURGE_SUBCOLLECTIONS = [
  'ings', 'inv', 'recs', 'menus', 'preps', 'shopping', 'areas', 'cats',
  'menu_cats', 'rec_cats', 'units', 'vendors', 'conversions', 'log',
  'settings', 'counters',
  'approved_emails', 'team_members',
  'support_tickets', 'feedback_events', 'internal_notes',
  'geminiUsage', 'tenant_meta', 'comps',
];

/** Hard-delete enabled only when env explicitly opts in. */
function hardDeleteEnabled(env) {
  return String((env || process.env).RETENTION_SWEEP_ENABLED || '').toLowerCase() === 'true';
}

/** ms timestamp from a Firestore Timestamp | millis | null. */
function toMillis(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  return 0;
}

/**
 * Pure eligibility check. A tenant is due for operational-data purge when it was
 * cancelled (canceledAt present) more than PURGE_AFTER_DAYS ago and has not been
 * purged yet (no dataPurgedAt). Resume clears canceledAt, so reactivated tenants
 * are automatically excluded.
 */
function isTenantDueForPurge(tenant, nowMs) {
  const t = tenant || {};
  if (t.dataPurgedAt) return false;          // already purged (idempotent)
  const canceledMs = toMillis(t.canceledAt);
  if (!canceledMs) return false;             // not cancelled / was resumed
  return (nowMs - canceledMs) > PURGE_AFTER_DAYS * DAY_MS;
}

/** Is a single audit entry past the 7-year retention window? */
function isAuditEntryExpired(entry, nowMs) {
  const ts = toMillis(entry && (entry.timestamp || entry.publisher_timestamp_ms));
  if (!ts) return false; // unknown age → keep (fail safe)
  return (nowMs - ts) > AUDIT_RETENTION_DAYS * DAY_MS;
}

/**
 * Purge one tenant's operational data (best-effort; never throws).
 * deps = { db, admin, deleteCollectionInBatches, auth, revokeTokens, writeAuditLog, logger }
 * Returns { purged: bool, reportOnly: bool, errors: [...] }.
 */
async function purgeTenantData(deps, tenantId, opts) {
  const { db, admin, deleteCollectionInBatches, writeAuditLog, logger } = deps;
  const reportOnly = !(opts && opts.hardDelete);
  const log = (logger && logger.warn) ? logger.warn.bind(logger) : ((m) => console.warn('[retention] ' + m));
  const errors = [];
  const tenantRef = db.collection('tenants').doc(tenantId);

  // Always emit an audit marker so the eligibility decision is recorded.
  const audit = async (op, extra) => {
    try { await writeAuditLog('retention', 'system', op, null, 0, tenantId, extra); }
    catch (e) { log('audit emit failed (' + op + '): ' + (e && e.message)); }
  };

  if (reportOnly) {
    try {
      await tenantRef.update({ purgeEligibleAt: admin.firestore.FieldValue.serverTimestamp() });
    } catch (e) { errors.push({ step: 'stampEligible', error: e && e.message }); }
    await audit('retention_purge_eligible', { reportOnly: true });
    return { purged: false, reportOnly: true, errors };
  }

  // ── Hard-delete path ──────────────────────────────────────────────────
  // 1. Revoke auth + collect owner/team uids from approved_emails BEFORE deleting it.
  if (deps.revokeTokens) {
    try { await deps.revokeTokens(tenantId); }
    catch (e) { errors.push({ step: 'revokeTokens', error: e && e.message }); }
  }
  if (deps.auth) {
    try {
      const emailsSnap = await tenantRef.collection('approved_emails').get();
      for (const d of emailsSnap.docs) {
        const uid = (d.data() || {}).uid;
        if (!uid) continue;
        try { await deps.auth.deleteUser(uid); }
        catch (e) { if (!(e && e.code === 'auth/user-not-found')) errors.push({ step: 'deleteUser', uid, error: e && e.message }); }
      }
    } catch (e) { errors.push({ step: 'enumerateUsers', error: e && e.message }); }
  }

  // 2. Delete operational subcollections (audit_log intentionally preserved).
  for (const sub of PURGE_SUBCOLLECTIONS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await deleteCollectionInBatches(db, tenantRef.collection(sub), 500);
    } catch (e) { errors.push({ step: 'delete:' + sub, error: e && e.message }); }
  }

  // 3. Stamp the tenant doc as purged (retention anchor; audit_log stays).
  try {
    await tenantRef.update({
      dataPurgedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'purged',
    });
  } catch (e) { errors.push({ step: 'stampPurged', error: e && e.message }); }

  await audit('retention_purge_complete', { reportOnly: false, errorCount: errors.length });
  return { purged: true, reportOnly: false, errors };
}

module.exports = {
  PURGE_AFTER_DAYS,
  AUDIT_RETENTION_DAYS,
  PURGE_SUBCOLLECTIONS,
  hardDeleteEnabled,
  isTenantDueForPurge,
  isAuditEntryExpired,
  purgeTenantData,
  _internal: { toMillis },
};
