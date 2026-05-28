/**
 * scheduler-heartbeat.js — observability + completeness tracking for the daily
 * scheduled Cloud Functions.
 *
 * Why this exists (Engineer recon N-1/N-2).
 *   N-2 (real): the daily jobs (cost aggregation, usage rollup, health score,
 *   trial check) had NO heartbeat. A silent failure — function crashes on the
 *   initial tenants.get(), or Cloud Scheduler stops triggering — would not
 *   surface until a customer noticed stale dashboards. We now stamp a
 *   per-job heartbeat doc on every run; an operator view / alert can flag a job
 *   whose lastSuccessAt is stale.
 *
 *   N-1 (premise corrected): the recon hypothesized a dependency chain where
 *   `dailyUsageStatsRollup` consumed `dailyTenantCostAggregation`'s output and
 *   would "run against missing data" if the upstream job was killed at its 540s
 *   budget. Reading the code shows this is NOT the case: each of the three
 *   aggregation jobs WRITES its own collection (tenant_costs_daily /
 *   tenant_usage_daily / tenant_health) and READS only raw sources (audit_log,
 *   gemini_usage_log, support_tickets, tenant docs). They are mutually
 *   independent, and each is idempotent (deterministic `{tenantId}_{ymd}` doc id
 *   + set({merge:false})), so a re-run simply overwrites. There is therefore no
 *   inter-job dependency to guard. The genuine residual risk N-1 points at is a
 *   PARTIAL run: a timeout after processing only some tenants leaves that day's
 *   rollup incomplete with no signal. The heartbeat records scanned/written/
 *   errors and derives a `complete` flag, making partial runs visible.
 *
 * Heartbeat doc shape  (/scheduler_heartbeats/{jobName}):
 *   { jobName, lastRunAt, lastStatus: 'success'|'error', lastDurationMs,
 *     lastDate, lastStats, complete: bool, degraded: bool,
 *     lastError: string|null, consecutiveFailures: int,
 *     lastSuccessAt, lastSuccessDate }
 */
'use strict';

/**
 * Derive completeness/degradation from a runner's stats object.
 * `complete`  = every scanned tenant was either written or errored (no early cut-off).
 * `degraded`  = at least one tenant errored.
 * If stats has no `scanned`, we can't judge completeness → complete=true (n/a).
 */
function deriveQuality(stats) {
  const s = stats || {};
  const hasScan = typeof s.scanned === 'number';
  const written = Number(s.written || 0);
  const errors = Number(s.errors || 0);
  const complete = hasScan ? (written + errors >= s.scanned) : true;
  const degraded = errors > 0;
  return { complete, degraded };
}

/**
 * Write/merge the heartbeat doc for a job run.
 * Never throws — heartbeat failure must not fail the underlying job.
 */
async function recordHeartbeat(db, admin, jobName, info) {
  try {
    const ref = db.collection('scheduler_heartbeats').doc(String(jobName));
    const now = admin.firestore.FieldValue.serverTimestamp();
    const status = info.status === 'success' ? 'success' : 'error';
    const { complete, degraded } = deriveQuality(info.stats);

    const update = {
      jobName: String(jobName),
      lastRunAt: now,
      lastStatus: status,
      lastDurationMs: Number(info.durationMs || 0),
      lastDate: info.processingDate || null,
      lastStats: info.stats || null,
      complete: status === 'success' ? complete : false,
      degraded: status === 'success' ? degraded : true,
      lastError: info.error ? String(info.error).slice(0, 500) : null,
    };
    if (status === 'success') {
      update.lastSuccessAt = now;
      update.lastSuccessDate = info.processingDate || null;
      update.consecutiveFailures = 0;
    } else {
      update.consecutiveFailures = admin.firestore.FieldValue.increment(1);
    }
    await ref.set(update, { merge: true });
  } catch (e) {
    // Best-effort only.
    console.warn('[scheduler-heartbeat] record failed for ' + jobName + ': ' + (e && e.message));
  }
}

/**
 * Run a job runner with heartbeat instrumentation.
 *   db, admin    — Firestore + admin SDK handles.
 *   jobName      — heartbeat doc id.
 *   runner       — async () => stats   (stats may include {scanned,written,errors,date}).
 * Records a success or error heartbeat, then RE-THROWS on failure so Pub/Sub
 * retry/alerting semantics are preserved (the previous behavior).
 */
async function withHeartbeat(db, admin, jobName, runner) {
  const started = Date.now();
  let stats;
  try {
    stats = await runner();
  } catch (e) {
    await recordHeartbeat(db, admin, jobName, {
      status: 'error',
      durationMs: Date.now() - started,
      processingDate: null,
      stats: null,
      error: e && e.message,
    });
    throw e; // preserve retry semantics
  }
  await recordHeartbeat(db, admin, jobName, {
    status: 'success',
    durationMs: Date.now() - started,
    processingDate: (stats && stats.date) || null,
    stats: stats || null,
  });
  return stats;
}

module.exports = {
  recordHeartbeat,
  withHeartbeat,
  // exposed for testing
  _internal: { deriveQuality },
};
