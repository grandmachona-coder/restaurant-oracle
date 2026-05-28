'use strict';

// E-3 feature-flag evaluation spec tests.
// Run: node firebase/functions/_test_feature_flags.js

const assert = require('assert');
const { evaluateFeatureFlag, resolveAllFlags, _internal } = require('./feature-flags');
const { bucketFor } = _internal;

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ok ' + name); passed++; }
  catch (e) { console.log('  FAIL ' + name + ' — ' + e.message); failed++; }
}
function group(name, fn) { console.log('# ' + name); fn(); }

group('precedence', () => {
  t('disabledTenants beats everything (kill-switch)', () => {
    const f = { name: 'x', enabledTenants: ['t1'], disabledTenants: ['t1'], rolloutPercent: 100, defaultValue: true };
    assert.strictEqual(evaluateFeatureFlag(f, 't1'), false);
  });
  t('enabledTenants beats rollout + default', () => {
    const f = { name: 'x', enabledTenants: ['t1'], disabledTenants: [], rolloutPercent: 0, defaultValue: false };
    assert.strictEqual(evaluateFeatureFlag(f, 't1'), true);
  });
  t('rolloutPercent 100 → true for any tenant not explicitly disabled', () => {
    const f = { name: 'x', rolloutPercent: 100, defaultValue: false };
    assert.strictEqual(evaluateFeatureFlag(f, 'anything'), true);
  });
  t('rolloutPercent 0 → falls back to defaultValue', () => {
    assert.strictEqual(evaluateFeatureFlag({ name: 'x', rolloutPercent: 0, defaultValue: true }, 't1'), true);
    assert.strictEqual(evaluateFeatureFlag({ name: 'x', rolloutPercent: 0, defaultValue: false }, 't1'), false);
  });
  t('defaultValue used when nothing else matches', () => {
    assert.strictEqual(evaluateFeatureFlag({ name: 'x' }, 't1'), false);
    assert.strictEqual(evaluateFeatureFlag({ name: 'x', defaultValue: true }, 't1'), true);
  });
});

group('rollout bucketing', () => {
  t('bucket is in [0,99]', () => {
    for (let i = 0; i < 200; i++) {
      const b = bucketFor('flagA', 'tenant' + i);
      assert(b >= 0 && b <= 99, 'bucket out of range: ' + b);
    }
  });
  t('bucket is STABLE across calls (no flip-flop)', () => {
    const a = bucketFor('flagA', 'tenant42');
    const b = bucketFor('flagA', 'tenant42');
    assert.strictEqual(a, b);
  });
  t('same tenant differs across flags (per-flag salt)', () => {
    // Not guaranteed for every tenant, but should differ for at least some.
    let differs = 0;
    for (let i = 0; i < 50; i++) {
      if (bucketFor('flagA', 't' + i) !== bucketFor('flagB', 't' + i)) differs++;
    }
    assert(differs > 0, 'flag salt had no effect across 50 tenants');
  });
  t('rollout is monotonic: a tenant enabled at P stays enabled at P+1', () => {
    const f = { name: 'grad', defaultValue: false };
    const tid = 'tenantMono';
    const b = bucketFor('grad', tid);
    // enabled exactly when b < pct
    assert.strictEqual(evaluateFeatureFlag({ ...f, rolloutPercent: b }, tid), false); // b < b is false
    assert.strictEqual(evaluateFeatureFlag({ ...f, rolloutPercent: b + 1 }, tid), true);
  });
  t('approx distribution near rolloutPercent', () => {
    const pct = 30;
    let on = 0, total = 3000;
    for (let i = 0; i < total; i++) {
      if (evaluateFeatureFlag({ name: 'dist', rolloutPercent: pct, defaultValue: false }, 'u' + i)) on++;
    }
    const ratio = (on / total) * 100;
    assert(Math.abs(ratio - pct) < 5, 'distribution off: ' + ratio.toFixed(1) + '% vs ' + pct + '%');
  });
});

group('resolveAllFlags', () => {
  t('maps each flag name to a boolean', () => {
    const docs = [
      { id: 'newUI', name: 'newUI', enabledTenants: ['t1'] },
      { id: 'beta', name: 'beta', disabledTenants: ['t1'], defaultValue: true },
      { id: 'roll', name: 'roll', rolloutPercent: 100 },
    ];
    const m = resolveAllFlags(docs, 't1');
    assert.strictEqual(m.newUI, true);
    assert.strictEqual(m.beta, false);  // disabled beats default:true
    assert.strictEqual(m.roll, true);
  });
  t('falls back to id when name missing', () => {
    const m = resolveAllFlags([{ id: 'flagNoName', defaultValue: true }], 't1');
    assert.strictEqual(m.flagNoName, true);
  });
  t('handles empty / null input', () => {
    assert.deepStrictEqual(resolveAllFlags([], 't1'), {});
    assert.deepStrictEqual(resolveAllFlags(null, 't1'), {});
  });
});

console.log('\nTests: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
