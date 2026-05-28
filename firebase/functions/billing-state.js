'use strict';

// Bistro Steward — billing state machine + signup validation.
// Pure helpers extracted from index.js so they can be unit tested without
// booting firebase-admin or hitting Square. index.js re-exports the same
// functions for backward compat.

const PLAN_CATALOG = {
  starter: { priceCents: 2900, name: 'Starter', envKey: 'SQUARE_PLAN_VAR_STARTER' },
  pro:     { priceCents: 4900, name: 'Pro',     envKey: 'SQUARE_PLAN_VAR_PRO' },
  scale:   { priceCents: 9900, name: 'Scale',   envKey: 'SQUARE_PLAN_VAR_SCALE' },
};

const CURRENT_TERMS_VERSION = '2026-04-24';

function validateSignupInput(body) {
  const errors = [];
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const restaurantName = String(body.restaurantName || '').trim();
  const plan = String(body.plan || '').toLowerCase();
  const cardNonce = String(body.cardNonce || '');
  const cardholderName = String(body.cardholderName || '').trim();
  const verificationToken = body.verificationToken ? String(body.verificationToken) : undefined;
  const agreedToTerms = body.agreedToTerms === true;
  const termsVersion = String(body.termsVersion || '').trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Valid email required');
  }
  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  if (password.length > 128) {
    errors.push('Password too long');
  }
  if (!restaurantName || restaurantName.length < 2 || restaurantName.length > 100) {
    errors.push('Restaurant name must be 2-100 characters');
  }
  if (!PLAN_CATALOG[plan]) {
    errors.push('Plan must be starter, pro, or scale');
  }
  if (!cardNonce || !/^cnon:[A-Za-z0-9_-]+$/.test(cardNonce)) {
    errors.push('Invalid card token');
  }
  if (!agreedToTerms) {
    errors.push('You must agree to the Terms of Service and Privacy Policy');
  }
  if (!termsVersion || !/^\d{4}-\d{2}-\d{2}$/.test(termsVersion)) {
    errors.push('Invalid terms version');
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized: { email, password, restaurantName, plan, cardNonce, cardholderName, verificationToken, agreedToTerms, termsVersion },
  };
}

// Square subscription status → tenant status mapping.
// NOTE: 'canceled' (American spelling) is the canonical tenant-status string.
// Both 'canceled' and 'cancelled' are accepted by checkTenantAccessByStatus
// for backward compat with any historic docs.
function mapSquareStatusToTenantStatus(sqStatus) {
  switch ((sqStatus || '').toUpperCase()) {
    case 'ACTIVE':
    case 'PENDING':
      return 'active';
    case 'PAUSED':
      return 'suspended';
    case 'CANCELED':
    case 'DEACTIVATED':
      return 'canceled';
    case 'TRIAL':
      return 'trial';
    default:
      return 'unknown';
  }
}

// Tenant access gate based on tenant status (used by secureApi/adminBilling).
// Returns { allowed: bool, reason: string|null }.
function checkTenantAccessByStatus(tenantStatus, isSuperAdmin) {
  if (isSuperAdmin) return { allowed: true, reason: null };
  if (tenantStatus === 'suspended') {
    return { allowed: false, reason: 'Account is suspended. Contact support@bistrosteward.com.' };
  }
  if (tenantStatus === 'canceled' || tenantStatus === 'cancelled') {
    return { allowed: false, reason: 'Subscription is cancelled. Reactivate from Billing to continue.' };
  }
  // Cashier recon K-2 (P1): trial_expired must block API access at the gate,
  // matching the Firestore-rules block. Previously the status flag was set by
  // dailyTrialCheck but the gate let traffic through because trial_expired
  // wasn't enumerated here. Now an expired trial converts to a hard read/write
  // block until the customer updates billing or the next Square charge
  // succeeds (which flips status back to 'active').
  if (tenantStatus === 'trial_expired') {
    return { allowed: false, reason: 'Your free trial has ended. Please update billing to continue.' };
  }
  if (tenantStatus === 'unknown') {
    return { allowed: false, reason: 'Account status unknown. Contact support@bistrosteward.com.' };
  }
  // 'active', 'trial', 'past_due' all permitted (past_due gets read-only via separate flag elsewhere).
  return { allowed: true, reason: null };
}

module.exports = {
  PLAN_CATALOG,
  CURRENT_TERMS_VERSION,
  validateSignupInput,
  mapSquareStatusToTenantStatus,
  checkTenantAccessByStatus,
};
