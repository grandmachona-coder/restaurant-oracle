/**
 * feature-flags.js — deterministic, server-authoritative flag evaluation.
 *
 * Why this exists (Inspector/Expediter recon E-3, P1).
 *   The operator console can write feature-flag documents
 *   (enabledTenants[] / disabledTenants[] / rolloutPercent / defaultValue), but
 *   there was NO evaluation function anywhere — precedence between tenant-scoped
 *   overrides, percentage rollout, and the global default was undefined and
 *   would have been re-invented (differently) by whatever client read the flags.
 *   The feature_flags collection is also super-admin-read-only at the rules
 *   layer, so tenant clients can't (and shouldn't) evaluate raw flag docs
 *   themselves. This module is the single source of truth: the Cloud Function
 *   resolves flags to plain booleans and hands the tenant a {name: bool} map.
 *
 * Precedence (most-specific wins — LaunchDarkly-style):
 *   1. tenant is in disabledTenants[]  → false   (explicit opt-OUT beats all)
 *   2. tenant is in enabledTenants[]   → true    (explicit opt-IN)
 *   3. rolloutPercent > 0 and bucket(tenant, flag) < rolloutPercent → true
 *   4. otherwise                        → defaultValue (default false)
 *
 *   Rationale for (1) over (2): an explicit disable is a kill-switch; if an
 *   operator both enables and disables a tenant (data race / mistake), failing
 *   CLOSED is the safe choice for a feature we were unsure about.
 *
 * Deterministic bucketing.
 *   bucket = FNV-1a(flagName + ':' + tenantId) % 100, in [0, 99].
 *   Salting by flagName means a given tenant lands in a different bucket per
 *   flag (so a tenant unlucky on one rollout isn't unlucky on all of them), and
 *   the result is STABLE across calls — a tenant never flips in/out of a 30%
 *   rollout between requests. No RNG, no crypto dependency, fully testable.
 */
'use strict';

/** FNV-1a 32-bit string hash → unsigned int. Deterministic, dependency-free. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h *= 16777619, kept in 32-bit unsigned range.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Stable rollout bucket in [0, 99] for (flag, tenant). */
function bucketFor(flagName, tenantId) {
  return fnv1a(String(flagName) + ':' + String(tenantId)) % 100;
}

/**
 * Resolve ONE flag doc to a boolean for a given tenant.
 * `flagDoc` is the Firestore data() (or {} ); tenantId is a string.
 */
function evaluateFeatureFlag(flagDoc, tenantId) {
  const doc = flagDoc || {};
  const tid = String(tenantId == null ? '' : tenantId);

  const disabled = Array.isArray(doc.disabledTenants) ? doc.disabledTenants.map(String) : [];
  const enabled = Array.isArray(doc.enabledTenants) ? doc.enabledTenants.map(String) : [];

  if (tid && disabled.indexOf(tid) !== -1) return false; // 1. kill-switch
  if (tid && enabled.indexOf(tid) !== -1) return true;   // 2. explicit opt-in

  const pct = Number(doc.rolloutPercent);
  if (Number.isFinite(pct) && pct > 0) {                 // 3. percentage rollout
    if (pct >= 100) return true;
    if (tid && bucketFor(doc.name || '', tid) < pct) return true;
    // (no tenant id → can't bucket; fall through to default)
  }

  return !!doc.defaultValue;                             // 4. global default
}

/**
 * Resolve a list of flag docs (each shaped like {id|name, ...}) to a flat
 * {flagName: boolean} map for one tenant. Used by getTenantConfig.
 */
function resolveAllFlags(flagDocs, tenantId) {
  const out = {};
  (flagDocs || []).forEach((f) => {
    if (!f) return;
    const name = f.name || f.id;
    if (!name) return;
    out[name] = evaluateFeatureFlag(f, tenantId);
  });
  return out;
}

module.exports = {
  evaluateFeatureFlag,
  resolveAllFlags,
  // exposed for testing
  _internal: { fnv1a, bucketFor },
};
