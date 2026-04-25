/**
 * agents.js — Phase 2 automation agents for Restaurant Oracle SaaS.
 *
 * Exports Cloud Function handlers and helpers:
 *   - runProvisioning({ tenantId, email, plan }) — called from signupTenant
 *   - healthCheck                                — scheduled hourly
 *   - revenueSnapshot                            — scheduled daily 06:00 UTC
 *   - onboardingNudge                            — scheduled daily 14:00 UTC
 *
 * Agents read from `/tenants/{tenantId}/` and write results to either
 * `/platform_stats/` (rollups), `/platform_alerts/` (high-sev events), or
 * the tenant's own `onboarding/nudges` subcollection.
 *
 * Spec docs: /Users/mulefamily/Claude/Restaurant-Oracle/agents/
 */
'use strict';

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
// Sentry is initialized in index.js at cold-start; here we only grab the
// already-initialized client to report exceptions from scheduled handlers.
const Sentry = require('@sentry/node');

// Defer getting db/auth until first use so this file is safe to require before
// admin.initializeApp() in index.js.
function db() { return admin.firestore(); }
function authSdk() { return admin.auth(); }

// ── Plan pricing (keep in sync with index.js PLAN_PRICES_CENTS) ─────────────
const PLAN_PRICES_CENTS = { starter: 2900, pro: 4900, scale: 9900 };

// ════════════════════════════════════════════════════════════════════════════
//  AGENT 1 — PROVISIONING
// ════════════════════════════════════════════════════════════════════════════
/**
 * Ensure a newly-created tenant has the minimum seed data + marks
 * provisioning_complete. Idempotent — safe to re-run.
 */
async function runProvisioning({ tenantId, ownerEmail, plan }) {
  if (!tenantId) throw new Error('tenantId required');
  const tRef = db().collection('tenants').doc(tenantId);

  // Ensure settings/general exists
  await tRef.collection('settings').doc('general').set(
    {
      currency: 'USD',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      plan: plan || 'starter',
      ownerEmail: ownerEmail || null,
    },
    { merge: true }
  );

  // Ensure counters/ids exists
  await tRef.collection('counters').doc('ids').set(
    { next: 1 },
    { merge: true }
  );

  // Mark provisioning complete
  await tRef.set(
    {
      provisioningComplete: true,
      provisionedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`[provisioning] tenant=${tenantId} ready`);
  return { tenantId, ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
//  AGENT 4 — HEALTH
// ════════════════════════════════════════════════════════════════════════════
async function computeTenantHealth(tenantDoc) {
  const t = tenantDoc.data();
  const tenantId = tenantDoc.id;

  let score = 100;
  const issues = [];
  const now = Date.now();

  // Subscription status
  const status = (t.status || 'unknown').toLowerCase();
  if (status === 'suspended') { score -= 70; issues.push('suspended'); }
  if (status === 'canceled') { score -= 40; issues.push('canceled'); }

  // Last activity — from audit_log
  let lastActivity = null;
  let errorCount = 0;
  let totalCount = 0;
  try {
    const since = admin.firestore.Timestamp.fromMillis(now - 24 * 60 * 60 * 1000);
    const auditSnap = await db().collection('tenants').doc(tenantId)
      .collection('audit_log')
      .where('timestamp', '>', since)
      .get();
    totalCount = auditSnap.size;
    auditSnap.forEach(d => {
      const data = d.data();
      if (data.success === false) errorCount++;
      const ts = data.timestamp && data.timestamp.toMillis ? data.timestamp.toMillis() : 0;
      if (ts > (lastActivity || 0)) lastActivity = ts;
    });
  } catch (e) { console.warn(`[health:${tenantId}] audit scan: ${e.message}`); }

  // If no recent activity, look back further
  if (!lastActivity) {
    try {
      const recent = await db().collection('tenants').doc(tenantId)
        .collection('audit_log')
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();
      if (!recent.empty) {
        const data = recent.docs[0].data();
        if (data.timestamp && data.timestamp.toMillis) lastActivity = data.timestamp.toMillis();
      }
    } catch (e) { /* ignore */ }
  }

  if (lastActivity) {
    const hoursSince = (now - lastActivity) / (60 * 60 * 1000);
    if (hoursSince > 24 * 30) { score -= 50; issues.push('no_activity_30d'); }
    else if (hoursSince > 24 * 7) { score -= 30; issues.push('no_activity_7d'); }
    else if (hoursSince > 24) { score -= 10; issues.push('no_activity_24h'); }
  } else {
    score -= 30;
    issues.push('no_activity_ever');
  }

  // Error rate
  if (totalCount > 0) {
    const errorRate = errorCount / totalCount;
    if (errorRate > 0.2) { score -= 35; issues.push('error_rate_high'); }
    else if (errorRate > 0.05) { score -= 15; issues.push('error_rate_warn'); }
  }

  // Team size
  try {
    const teamSnap = await db().collection('tenants').doc(tenantId)
      .collection('approved_emails').limit(2).get();
    if (teamSnap.size === 0) { score -= 20; issues.push('no_team'); }
    else if (teamSnap.size === 1) { score -= 5; issues.push('solo_team'); }
  } catch (e) { /* ignore */ }

  // Onboarding age
  const createdAt = t.createdAt && t.createdAt.toMillis ? t.createdAt.toMillis() : null;
  if (createdAt && !t.onboardingComplete) {
    const ageDays = (now - createdAt) / (24 * 60 * 60 * 1000);
    if (ageDays > 14) { score -= 10; issues.push('onboarding_stale'); }
  }

  score = Math.max(0, Math.min(100, score));
  let bucket = 'healthy';
  if (score < 50) bucket = 'critical';
  else if (score < 80) bucket = 'warning';

  return {
    score,
    bucket,
    issues,
    lastActivity,
    errorCount,
    totalCount,
    computedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function handleHealthCheck() {
  const t0 = Date.now();
  const tenantsSnap = await db().collection('tenants').get();
  const summary = { healthy: 0, warning: 0, critical: 0 };
  const criticalEscalations = [];

  for (const doc of tenantsSnap.docs) {
    const health = await computeTenantHealth(doc);

    // Read previous to detect drops
    const prevRef = db().collection('platform_stats').doc('health')
      .collection('tenants').doc(doc.id);
    const prevSnap = await prevRef.get();
    const prevBucket = prevSnap.exists ? prevSnap.data().bucket : null;

    await prevRef.set(health);

    summary[health.bucket] = (summary[health.bucket] || 0) + 1;

    if (health.bucket === 'critical' && prevBucket && prevBucket !== 'critical') {
      criticalEscalations.push({ tenantId: doc.id, slug: doc.data().slug, score: health.score, issues: health.issues });
    }
  }

  // Rollup summary
  await db().collection('platform_stats').doc('health').set(
    { _summary: { ...summary, computedAt: admin.firestore.FieldValue.serverTimestamp() } },
    { merge: true }
  );

  // Alerts for critical drops
  for (const esc of criticalEscalations) {
    await db().collection('platform_alerts').add({
      severity: 'high',
      type: 'health_critical',
      tenantId: esc.tenantId,
      slug: esc.slug,
      score: esc.score,
      issues: esc.issues,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      acknowledged: false,
    });
  }

  const dt = Date.now() - t0;
  console.log(`[health] scanned ${tenantsSnap.size} tenants in ${dt}ms — healthy=${summary.healthy} warning=${summary.warning} critical=${summary.critical} alerts=${criticalEscalations.length}`);
  return { summary, escalations: criticalEscalations.length, durationMs: dt };
}

// ════════════════════════════════════════════════════════════════════════════
//  AGENT 6 — REVENUE
// ════════════════════════════════════════════════════════════════════════════
function dateKey(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function handleRevenueSnapshot() {
  const t0 = Date.now();
  const now = Date.now();
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

  const tenantsSnap = await db().collection('tenants').get();
  const tenants = [];
  tenantsSnap.forEach(d => tenants.push({ id: d.id, ...d.data() }));

  const byStatus = { active: 0, suspended: 0, canceled: 0 };
  const byPlan = { starter: 0, pro: 0, scale: 0 };
  let mrr = 0, newMrr = 0, churnedMrr = 0;
  let churnCount = 0, newCount = 0;

  for (const t of tenants) {
    const status = (t.status || 'unknown').toLowerCase();
    const plan = (t.plan || 'unknown').toLowerCase();
    byStatus[status] = (byStatus[status] || 0) + 1;
    byPlan[plan] = (byPlan[plan] || 0) + 1;

    if (status === 'active' && PLAN_PRICES_CENTS[plan]) {
      mrr += PLAN_PRICES_CENTS[plan];
    }

    const createdAt = t.createdAt && t.createdAt.toMillis ? t.createdAt.toMillis() : 0;
    const canceledAt = t.canceledAt && t.canceledAt.toMillis ? t.canceledAt.toMillis() : 0;

    if (createdAt >= monthAgo) {
      newCount++;
      if (status === 'active' && PLAN_PRICES_CENTS[plan]) newMrr += PLAN_PRICES_CENTS[plan];
    }
    if (canceledAt >= monthAgo) {
      churnCount++;
      if (PLAN_PRICES_CENTS[plan]) churnedMrr += PLAN_PRICES_CENTS[plan];
    }
  }

  const netNewMrr = newMrr - churnedMrr;
  const churnRate = byStatus.active + churnCount > 0 ? churnCount / (byStatus.active + churnCount) : 0;

  const snapshot = {
    date: dateKey(new Date()),
    mrrCents: mrr,
    arrCents: mrr * 12,
    newMrrCents: newMrr,
    churnedMrrCents: churnedMrr,
    netNewMrrCents: netNewMrr,
    tenantsTotal: tenants.length,
    tenantsByStatus: byStatus,
    tenantsByPlan: byPlan,
    newCount,
    churnCount,
    churnRate,
    computedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Previous snapshot for anomaly detection
  const latestRef = db().collection('platform_stats').doc('revenue')
    .collection('daily').doc('_latest');
  const prev = await latestRef.get();
  const prevMrr = prev.exists ? (prev.data().mrrCents || 0) : 0;

  // Write daily snapshot
  await db().collection('platform_stats').doc('revenue')
    .collection('daily').doc(snapshot.date).set(snapshot);
  await latestRef.set(snapshot);

  // Anomaly: MRR drop > 10% day-over-day
  if (prevMrr > 0 && mrr < prevMrr * 0.9) {
    await db().collection('platform_alerts').add({
      severity: 'high',
      type: 'mrr_drop',
      prevMrrCents: prevMrr,
      currentMrrCents: mrr,
      deltaPercent: ((mrr - prevMrr) / prevMrr) * 100,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      acknowledged: false,
    });
  }

  const dt = Date.now() - t0;
  console.log(`[revenue] MRR=$${(mrr / 100).toFixed(2)} tenants=${tenants.length} new=${newCount} churn=${churnCount} in ${dt}ms`);
  return snapshot;
}

// ════════════════════════════════════════════════════════════════════════════
//  AGENT 2 — ONBOARDING (nudges)
// ════════════════════════════════════════════════════════════════════════════
const NUDGE_SCHEDULE = [
  { day: 2,  milestone: 2, label: 'welcome_back' },
  { day: 4,  milestone: 3, label: 'first_ingredient' },
  { day: 7,  milestone: 4, label: 'first_count' },
  { day: 10, milestone: 5, label: 'invite_team' },
  { day: 14, milestone: 6, label: 'book_call' },
];

async function tenantMilestone(tenantId) {
  // Milestone 1 is implicit (tenant exists). Walk up from 6.
  const t = await db().collection('tenants').doc(tenantId).get();
  if (!t.exists) return 0;
  if (t.data().onboardingComplete) return 6;

  // 5: has ≥2 team members
  const teamSnap = await db().collection('tenants').doc(tenantId)
    .collection('approved_emails').limit(2).get();
  const hasInvited = teamSnap.size >= 2;

  // 4: has ≥1 log entry
  const logSnap = await db().collection('tenants').doc(tenantId)
    .collection('log').limit(1).get();
  const hasLog = !logSnap.empty;

  // 3: has ≥1 ingredient
  const ingSnap = await db().collection('tenants').doc(tenantId)
    .collection('ings').limit(1).get();
  const hasIng = !ingSnap.empty;

  // 2: has any audit log entry (proxy for "signed in")
  const auditSnap = await db().collection('tenants').doc(tenantId)
    .collection('audit_log').limit(1).get();
  const hasSignedIn = !auditSnap.empty;

  if (hasInvited) return 5;
  if (hasLog) return 4;
  if (hasIng) return 3;
  if (hasSignedIn) return 2;
  return 1;
}

async function handleOnboardingNudge() {
  const t0 = Date.now();
  const now = Date.now();

  const tenantsSnap = await db().collection('tenants')
    .where('onboardingComplete', '==', false)
    .get();

  let nudgesEnqueued = 0;

  for (const doc of tenantsSnap.docs) {
    const t = doc.data();
    const tenantId = doc.id;

    // Only consider active tenants
    if ((t.status || '').toLowerCase() !== 'active') continue;

    const createdAt = t.createdAt && t.createdAt.toMillis ? t.createdAt.toMillis() : null;
    if (!createdAt) continue;
    const ageDays = (now - createdAt) / (24 * 60 * 60 * 1000);

    // Find due nudge: where day == ageDays (rounded) and milestone not yet reached
    const due = NUDGE_SCHEDULE.find(n => Math.floor(ageDays) === n.day);
    if (!due) continue;

    const reachedMilestone = await tenantMilestone(tenantId);
    if (reachedMilestone >= due.milestone) continue;

    // Check if already sent
    const nudgeRef = db().collection('tenants').doc(tenantId)
      .collection('onboarding').doc('nudges');
    const nudgeSnap = await nudgeRef.get();
    const sent = nudgeSnap.exists ? (nudgeSnap.data().sent || {}) : {};
    if (sent[due.label]) continue;

    // Enqueue email (stub — RESEND_API_KEY not wired yet).
    // Record intent regardless so we don't double-send when email arrives.
    console.log(`[onboarding] nudge '${due.label}' queued for ${tenantId} (${t.ownerEmail}) ageDays=${ageDays.toFixed(1)}`);
    await nudgeRef.set({
      sent: { ...sent, [due.label]: admin.firestore.FieldValue.serverTimestamp() },
    }, { merge: true });

    // TODO: replace this with actual Resend/SendGrid send
    await db().collection('platform_email_queue').add({
      to: t.ownerEmail,
      template: `onboarding_${due.label}`,
      tenantId,
      ageDays: Math.floor(ageDays),
      milestoneStuck: reachedMilestone,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      sent: false,
    });
    nudgesEnqueued++;
  }

  const dt = Date.now() - t0;
  console.log(`[onboarding] scanned ${tenantsSnap.size} tenants, enqueued ${nudgesEnqueued} nudges in ${dt}ms`);
  return { scanned: tenantsSnap.size, enqueued: nudgesEnqueued };
}

// ════════════════════════════════════════════════════════════════════════════
//  Exported Cloud Functions
// ════════════════════════════════════════════════════════════════════════════

function captureScheduledError(err, handler) {
  try {
    Sentry.withScope(scope => {
      scope.setTag('handler', handler);
      scope.setTag('kind', 'scheduled');
      Sentry.captureException(err);
    });
  } catch (_) { /* never throw from capture path */ }
}

const healthCheck = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 540, memory: '512MB', secrets: ['SENTRY_DSN'] })
  .pubsub.schedule('every 60 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    try { await handleHealthCheck(); }
    catch (e) { console.error('[health] failed:', e); captureScheduledError(e, 'healthCheck'); throw e; }
    return null;
  });

const revenueSnapshot = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 300, memory: '512MB', secrets: ['SENTRY_DSN'] })
  .pubsub.schedule('0 6 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    try { await handleRevenueSnapshot(); }
    catch (e) { console.error('[revenue] failed:', e); captureScheduledError(e, 'revenueSnapshot'); throw e; }
    return null;
  });

const onboardingNudge = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 300, memory: '512MB', secrets: ['SENTRY_DSN'] })
  .pubsub.schedule('0 14 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    try { await handleOnboardingNudge(); }
    catch (e) { console.error('[onboarding] failed:', e); captureScheduledError(e, 'onboardingNudge'); throw e; }
    return null;
  });

module.exports = {
  runProvisioning,
  handleHealthCheck,
  handleRevenueSnapshot,
  handleOnboardingNudge,
  healthCheck,
  revenueSnapshot,
  onboardingNudge,
};
