'use strict';

// Signup → trial → cancel state-machine spec tests.
// Validates the pure helpers extracted to ./billing-state.js so failures
// surface here before they reach production webhooks or the signup form.
//
// Run: node firebase/functions/_test_billing_state.js

const assert = require('assert');
const {
  PLAN_CATALOG,
  CURRENT_TERMS_VERSION,
  validateSignupInput,
  mapSquareStatusToTenantStatus,
  checkTenantAccessByStatus,
} = require('./billing-state');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ok ' + name); passed++; }
  catch (e) { console.log('  FAIL ' + name + ' — ' + e.message); failed++; }
}
function group(name, fn) { console.log('# ' + name); fn(); }

// ─── Plan catalog ───
group('PLAN_CATALOG', () => {
  t('exposes starter/pro/scale', () => {
    assert(PLAN_CATALOG.starter); assert(PLAN_CATALOG.pro); assert(PLAN_CATALOG.scale);
  });
  t('starter $29, pro $49, scale $99', () => {
    assert.strictEqual(PLAN_CATALOG.starter.priceCents, 2900);
    assert.strictEqual(PLAN_CATALOG.pro.priceCents, 4900);
    assert.strictEqual(PLAN_CATALOG.scale.priceCents, 9900);
  });
  t('every plan has Square envKey', () => {
    for (const slug of Object.keys(PLAN_CATALOG)) {
      assert(PLAN_CATALOG[slug].envKey.startsWith('SQUARE_PLAN_VAR_'));
    }
  });
});

// ─── Signup validation ───
function validBody() {
  return {
    email: 'owner@example.com',
    password: 'a-strong-pass-123',
    restaurantName: 'Test Bistro',
    plan: 'starter',
    cardNonce: 'cnon:CBASEAbc123_token',
    cardholderName: 'Test Owner',
    verificationToken: 'verf_xyz',
    agreedToTerms: true,
    termsVersion: CURRENT_TERMS_VERSION,
  };
}

group('validateSignupInput — happy path', () => {
  t('valid body passes', () => {
    const r = validateSignupInput(validBody());
    assert.strictEqual(r.valid, true, JSON.stringify(r.errors));
    assert.strictEqual(r.errors.length, 0);
  });
  t('email lowercased + trimmed', () => {
    const b = validBody(); b.email = '  Owner@Example.COM  ';
    const r = validateSignupInput(b);
    assert.strictEqual(r.valid, true);
    assert.strictEqual(r.normalized.email, 'owner@example.com');
  });
  t('plan lowercased', () => {
    const b = validBody(); b.plan = 'PRO';
    const r = validateSignupInput(b);
    assert.strictEqual(r.valid, true);
    assert.strictEqual(r.normalized.plan, 'pro');
  });
  t('all three plans accepted', () => {
    for (const plan of ['starter', 'pro', 'scale']) {
      const b = validBody(); b.plan = plan;
      assert.strictEqual(validateSignupInput(b).valid, true, plan);
    }
  });
});

group('validateSignupInput — rejects bad inputs', () => {
  t('missing email', () => {
    const b = validBody(); delete b.email;
    const r = validateSignupInput(b);
    assert.strictEqual(r.valid, false);
    assert(r.errors.some(e => /email/i.test(e)));
  });
  t('malformed email', () => {
    const b = validBody(); b.email = 'not-an-email';
    assert.strictEqual(validateSignupInput(b).valid, false);
  });
  t('short password (7 chars)', () => {
    const b = validBody(); b.password = '1234567';
    const r = validateSignupInput(b);
    assert(r.errors.some(e => /8 characters/.test(e)));
  });
  t('password too long (>128)', () => {
    const b = validBody(); b.password = 'x'.repeat(129);
    const r = validateSignupInput(b);
    assert(r.errors.some(e => /too long/.test(e)));
  });
  t('restaurant name 1 char', () => {
    const b = validBody(); b.restaurantName = 'A';
    assert.strictEqual(validateSignupInput(b).valid, false);
  });
  t('restaurant name 101 chars', () => {
    const b = validBody(); b.restaurantName = 'X'.repeat(101);
    assert.strictEqual(validateSignupInput(b).valid, false);
  });
  t('unknown plan', () => {
    const b = validBody(); b.plan = 'enterprise';
    const r = validateSignupInput(b);
    assert(r.errors.some(e => /starter, pro, or scale/.test(e)));
  });
  t('card nonce missing cnon: prefix', () => {
    const b = validBody(); b.cardNonce = 'fake-token-123';
    assert.strictEqual(validateSignupInput(b).valid, false);
  });
  t('agreedToTerms false', () => {
    const b = validBody(); b.agreedToTerms = false;
    assert.strictEqual(validateSignupInput(b).valid, false);
  });
  t('agreedToTerms truthy non-boolean rejected', () => {
    const b = validBody(); b.agreedToTerms = 'yes';
    assert.strictEqual(validateSignupInput(b).valid, false);
  });
  t('malformed termsVersion', () => {
    const b = validBody(); b.termsVersion = 'v1';
    assert.strictEqual(validateSignupInput(b).valid, false);
  });
  t('empty body returns multi-error list', () => {
    const r = validateSignupInput({});
    assert.strictEqual(r.valid, false);
    assert(r.errors.length >= 5, 'expected ≥5 errors, got ' + r.errors.length);
  });
});

// ─── Square webhook → tenant status mapping ───
group('mapSquareStatusToTenantStatus', () => {
  t('ACTIVE → active', () => assert.strictEqual(mapSquareStatusToTenantStatus('ACTIVE'), 'active'));
  t('PENDING → active (Square trial-period state)', () => assert.strictEqual(mapSquareStatusToTenantStatus('PENDING'), 'active'));
  t('PAUSED → suspended', () => assert.strictEqual(mapSquareStatusToTenantStatus('PAUSED'), 'suspended'));
  // Canonical spelling is American 'canceled' per billing-state.js comment.
  // The access gate accepts both 'canceled' and 'cancelled' for backward compat.
  t('CANCELED → canceled', () => assert.strictEqual(mapSquareStatusToTenantStatus('CANCELED'), 'canceled'));
  t('DEACTIVATED → canceled', () => assert.strictEqual(mapSquareStatusToTenantStatus('DEACTIVATED'), 'canceled'));
  t('lowercase ok (case insensitive)', () => assert.strictEqual(mapSquareStatusToTenantStatus('canceled'), 'canceled'));
  // Secure default: an unrecognized status returns 'unknown', not 'active',
  // so checkTenantAccessByStatus can deny by default rather than fall open.
  t('null defaults to unknown (deny-by-default on missing data)', () => assert.strictEqual(mapSquareStatusToTenantStatus(null), 'unknown'));
  t('unrecognized defaults to unknown', () => assert.strictEqual(mapSquareStatusToTenantStatus('FOO'), 'unknown'));
});

// ─── Access gate (post-cancel/suspended) ───
group('checkTenantAccessByStatus — gate', () => {
  t('active → allowed', () => {
    const r = checkTenantAccessByStatus('active', false);
    assert.strictEqual(r.allowed, true);
  });
  t('trial → allowed', () => {
    const r = checkTenantAccessByStatus('trial', false);
    assert.strictEqual(r.allowed, true);
  });
  t('past_due → allowed (read-only handled separately)', () => {
    const r = checkTenantAccessByStatus('past_due', false);
    assert.strictEqual(r.allowed, true);
  });
  t('suspended → blocked with support message', () => {
    const r = checkTenantAccessByStatus('suspended', false);
    assert.strictEqual(r.allowed, false);
    assert(/suspended/i.test(r.reason));
    assert(/support@bistrosteward\.com/.test(r.reason));
  });
  t('canceled (American) → blocked with reactivate message', () => {
    const r = checkTenantAccessByStatus('canceled', false);
    assert.strictEqual(r.allowed, false);
    assert(/cancelled/i.test(r.reason));
    assert(/Reactivate from Billing/i.test(r.reason));
  });
  t('cancelled (British, legacy) → also blocked', () => {
    const r = checkTenantAccessByStatus('cancelled', false);
    assert.strictEqual(r.allowed, false);
  });
  t('trial_expired → blocked with billing update message', () => {
    const r = checkTenantAccessByStatus('trial_expired', false);
    assert.strictEqual(r.allowed, false);
    assert(/free trial/i.test(r.reason));
    assert(/update billing/i.test(r.reason));
  });
  t('unknown → blocked (deny-by-default)', () => {
    const r = checkTenantAccessByStatus('unknown', false);
    assert.strictEqual(r.allowed, false);
  });
  t('super_admin bypass on suspended', () => {
    const r = checkTenantAccessByStatus('suspended', true);
    assert.strictEqual(r.allowed, true);
  });
  t('super_admin bypass on canceled', () => {
    const r = checkTenantAccessByStatus('canceled', true);
    assert.strictEqual(r.allowed, true);
  });
  t('super_admin bypass on trial_expired', () => {
    const r = checkTenantAccessByStatus('trial_expired', true);
    assert.strictEqual(r.allowed, true);
  });
});

// ─── Full critical-flow simulation ───
group('signup → trial → cancel critical flow', () => {
  t('1. user submits valid signup → validation passes', () => {
    const r = validateSignupInput(validBody());
    assert.strictEqual(r.valid, true);
  });
  t('2. Square fires subscription.created with PENDING → tenant active (in trial)', () => {
    const status = mapSquareStatusToTenantStatus('PENDING');
    assert.strictEqual(status, 'active');
    assert.strictEqual(checkTenantAccessByStatus(status, false).allowed, true);
  });
  t('3. trial converts → ACTIVE → tenant still active', () => {
    const status = mapSquareStatusToTenantStatus('ACTIVE');
    assert.strictEqual(status, 'active');
  });
  t('4. user cancels → CANCELED → tenant canceled', () => {
    const status = mapSquareStatusToTenantStatus('CANCELED');
    assert.strictEqual(status, 'canceled');
    const gate = checkTenantAccessByStatus(status, false);
    assert.strictEqual(gate.allowed, false);
    assert(/Reactivate/.test(gate.reason));
  });
  t('5. owner attempts to login post-cancel → blocked, super_admin can still access', () => {
    assert.strictEqual(checkTenantAccessByStatus('canceled', false).allowed, false);
    assert.strictEqual(checkTenantAccessByStatus('canceled', true).allowed, true);
  });
  t('6. card decline → DEACTIVATED → tenant canceled (same gate as user-cancel)', () => {
    assert.strictEqual(mapSquareStatusToTenantStatus('DEACTIVATED'), 'canceled');
  });
  t('7. owner pauses subscription → PAUSED → suspended (different message)', () => {
    const gate = checkTenantAccessByStatus(mapSquareStatusToTenantStatus('PAUSED'), false);
    assert.strictEqual(gate.allowed, false);
    assert(/suspended/i.test(gate.reason));
    assert(!/Reactivate/.test(gate.reason)); // suspended ≠ cancelled phrasing
  });
});

console.log('');
console.log('Tests: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
