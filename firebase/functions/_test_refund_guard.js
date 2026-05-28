'use strict';

// K-6 refund-guard spec tests.
// Run: node firebase/functions/_test_refund_guard.js

const assert = require('assert');
const { validateRefund, refundIdempotencyKey } = require('./refund-guard');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ok ' + name); passed++; }
  catch (e) { console.log('  FAIL ' + name + ' — ' + e.message); failed++; }
}
function group(name, fn) { console.log('# ' + name); fn(); }

const OK_PARAMS = { amountCents: 4900, confirm: true, confirmAmountCents: 4900 };

group('validateRefund', () => {
  t('valid refund within payment amount → ok', () => {
    const r = validateRefund(OK_PARAMS, 4900);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.amount, 4900);
  });
  t('partial refund (less than charge) → ok', () => {
    assert.strictEqual(validateRefund({ amountCents: 1000, confirm: true, confirmAmountCents: 1000 }, 4900).ok, true);
  });
  t('THE K-6 BUG: 10x typo is capped — 490000¢ on a 4900¢ charge → rejected', () => {
    const r = validateRefund({ amountCents: 490000, confirm: true, confirmAmountCents: 490000 }, 4900);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 400);
    assert(/exceeds original payment/.test(r.error));
  });
  t('missing confirm → rejected (second approval required)', () => {
    const r = validateRefund({ amountCents: 4900, confirmAmountCents: 4900 }, 4900);
    assert.strictEqual(r.ok, false);
    assert(/second approval/.test(r.error));
  });
  t('confirmAmountCents mismatch → rejected', () => {
    const r = validateRefund({ amountCents: 4900, confirm: true, confirmAmountCents: 4800 }, 4900);
    assert.strictEqual(r.ok, false);
  });
  t('non-integer amount → rejected', () => {
    assert.strictEqual(validateRefund({ amountCents: 49.5, confirm: true, confirmAmountCents: 49.5 }, 4900).ok, false);
  });
  t('zero / negative amount → rejected', () => {
    assert.strictEqual(validateRefund({ amountCents: 0, confirm: true, confirmAmountCents: 0 }, 4900).ok, false);
    assert.strictEqual(validateRefund({ amountCents: -100, confirm: true, confirmAmountCents: -100 }, 4900).ok, false);
  });
  t('missing amountCents → rejected', () => {
    assert.strictEqual(validateRefund({ confirm: true }, 4900).ok, false);
  });
  t('unknown payment amount → 502 (cannot verify)', () => {
    const r = validateRefund(OK_PARAMS, null);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, 502);
  });
  t('exact full refund (amount === charge) → ok', () => {
    assert.strictEqual(validateRefund({ amountCents: 4900, confirm: true, confirmAmountCents: 4900 }, 4900).ok, true);
  });
});

group('refundIdempotencyKey', () => {
  t('deterministic for same tenant/payment/amount (double-click safe)', () => {
    const a = refundIdempotencyKey('t1', 'sqp_1', 4900);
    const b = refundIdempotencyKey('t1', 'sqp_1', 4900);
    assert.strictEqual(a, b);
  });
  t('different amount → different key (allows legit second partial)', () => {
    assert.notStrictEqual(refundIdempotencyKey('t1', 'sqp_1', 4900), refundIdempotencyKey('t1', 'sqp_1', 1000));
  });
  t('client-supplied UUID wins', () => {
    const k = refundIdempotencyKey('t1', 'sqp_1', 4900, 'abc-123');
    assert(k.indexOf('abc-123') !== -1);
  });
  t('key is <= 45 chars (Square limit)', () => {
    const k = refundIdempotencyKey('tenant-with-a-very-long-id-123456789', 'sqp_payment_id_also_long_000', 4900);
    assert(k.length <= 45, 'key too long: ' + k.length);
  });
  t('long-ID collision resistance: different AMOUNTS never share a key (P2 fix)', () => {
    const tid = 'tenant-with-a-very-long-id-1234567890ABCDEF';
    const pid = 'sqp_payment_id_that_is_also_quite_long_0001';
    const k1 = refundIdempotencyKey(tid, pid, 4900);
    const k2 = refundIdempotencyKey(tid, pid, 490000);
    assert.notStrictEqual(k1, k2, 'truncation collision: different amounts produced same key');
    assert(k1.length <= 45 && k2.length <= 45);
  });
  t('long-ID collision resistance: different PAYMENTS never share a key', () => {
    const tid = 'tenant-with-a-very-long-id-1234567890ABCDEF';
    const k1 = refundIdempotencyKey(tid, 'sqp_payment_aaaaaaaaaaaaaaaaaaaaaaaaaaa1', 4900);
    const k2 = refundIdempotencyKey(tid, 'sqp_payment_aaaaaaaaaaaaaaaaaaaaaaaaaaa2', 4900);
    assert.notStrictEqual(k1, k2);
  });
  t('NO timestamp in key (the old Date.now() bug)', () => {
    // Two calls "moments apart" must be identical — proves no time component.
    const a = refundIdempotencyKey('t1', 'p1', 100);
    const b = refundIdempotencyKey('t1', 'p1', 100);
    assert.strictEqual(a, b);
  });
});

console.log('\nTests: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
