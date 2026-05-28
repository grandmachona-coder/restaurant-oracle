/**
 * refund-guard.js — validation + idempotency for operator-issued refunds.
 *
 * Why this exists (Cashier recon K-6).
 *   superOpIssueRefund had three holes:
 *     1. No amount cap — a typo (490000¢ instead of 4900¢) refunded 10× the plan.
 *     2. The Square idempotency key embedded Date.now(), which DEFEATS
 *        idempotency: a double-click produced two distinct keys → two refunds.
 *     3. No second approval — one fat-fingered field went straight to Square.
 *
 *   This module holds the pure, testable pieces:
 *     • validateRefund() — positive-integer amount, mandatory second approval
 *       (confirm:true + a re-typed confirmAmountCents that must match), and a
 *       cap at the original payment amount (a refund can never exceed the
 *       charge).
 *     • refundIdempotencyKey() — DETERMINISTIC key so the same logical refund
 *       (tenant + payment + amount) dedupes at Square; a caller-supplied UUID
 *       takes precedence.
 */
'use strict';

const crypto = require('crypto');

/**
 * Validate a refund request against the original payment amount.
 *   params       = { amountCents, confirm, confirmAmountCents }
 *   paymentAmount = integer cents actually charged (from Square), or null if unknown.
 * Returns { ok: true, amount } or { ok: false, error, status }.
 */
function validateRefund(params, paymentAmount) {
  const p = params || {};

  if (p.amountCents === undefined || p.amountCents === null) {
    return { ok: false, error: 'amountCents required', status: 400 };
  }
  const amount = Number(p.amountCents);
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: 'amountCents must be a positive integer (cents)', status: 400 };
  }

  // Second approval — catches single-field typos.
  if (p.confirm !== true || Number(p.confirmAmountCents) !== amount) {
    return {
      ok: false,
      error: 'Refund requires confirm:true and a matching confirmAmountCents (second approval)',
      status: 400,
    };
  }

  // Cap at the original charge.
  if (paymentAmount === null || paymentAmount === undefined || !Number.isFinite(Number(paymentAmount))) {
    return { ok: false, error: 'Could not verify original payment amount', status: 502 };
  }
  if (amount > Number(paymentAmount)) {
    return {
      ok: false,
      error: 'Refund (' + amount + '¢) exceeds original payment (' + Number(paymentAmount) + '¢)',
      status: 400,
    };
  }

  return { ok: true, amount };
}

/**
 * Deterministic Square idempotency key. A caller-supplied clientRefundId (UUID)
 * wins; otherwise derive from the logical refund identity so a double-submit of
 * the SAME refund collapses to one. Square caps idempotency_key at 45 chars for
 * refunds.
 *
 * We HASH the identity rather than concatenating + slicing. Raw slicing was
 * collision-prone: with long tenant/payment IDs, `r-{tenant}-{payment}-{amount}`
 * sliced to 45 chars could drop the amount (or part of the paymentId), so two
 * DIFFERENT refunds could share a key and Square would silently dedupe the
 * second legitimate refund away. A sha256 of the full identity guarantees the
 * amount always participates and the result fits in 45 chars. (Different amounts
 * → different hashes → a legitimate second partial refund is still allowed.)
 */
function refundIdempotencyKey(tenantId, paymentId, amount, clientRefundId) {
  if (typeof clientRefundId === 'string' && clientRefundId.trim()) {
    return ('refund-' + clientRefundId.trim()).slice(0, 45);
  }
  const h = crypto.createHash('sha256')
    .update(String(tenantId) + '|' + String(paymentId) + '|' + String(amount))
    .digest('hex');
  return ('r-' + h).slice(0, 45); // 'r-' + 43 hex chars = 45
}

module.exports = { validateRefund, refundIdempotencyKey };
