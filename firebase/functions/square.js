/**
 * square.js — Square API client for Restaurant Oracle
 *
 * Fetch-based, zero new dependencies. Exposes the minimum surface we need:
 *   - customers.create
 *   - cards.create (attach a tokenized source to a customer)
 *   - subscriptions.create
 *   - subscriptions.cancel
 *   - webhook signature verification (HMAC-SHA256)
 *
 * Credentials & environment come from env vars populated by Firebase Secret Manager:
 *   SQUARE_ACCESS_TOKEN  — sandbox or production access token
 *   SQUARE_LOCATION_ID   — seller location ID (sandbox: LA45K6CZ9392T)
 *   SQUARE_ENV           — 'sandbox' (default) | 'production'
 *   SQUARE_WEBHOOK_SIGNATURE_KEY — signing key from Square webhook subscription
 */

'use strict';

const crypto = require('crypto');

const SANDBOX_HOST = 'https://connect.squareupsandbox.com';
const PRODUCTION_HOST = 'https://connect.squareup.com';
const API_VERSION = '2025-01-23';

function squareHost() {
  return (process.env.SQUARE_ENV || '').toLowerCase() === 'production'
    ? PRODUCTION_HOST
    : SANDBOX_HOST;
}

function requireToken() {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) {
    throw new Error('SQUARE_ACCESS_TOKEN not configured');
  }
  return token;
}

// ── Low-level fetch wrapper ─────────────────────────────────────────────────
async function squareFetch(endpoint, method, body) {
  const res = await fetch(`${squareHost()}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${requireToken()}`,
      'Square-Version': API_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      `Square API ${res.status}: ${JSON.stringify(data && data.errors ? data.errors : data)}`
    );
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

// ── Customers ───────────────────────────────────────────────────────────────
/**
 * Create a Square customer.
 *
 * Idempotency: Square's /v2/customers does NOT accept idempotency_key (unlike most
 * other endpoints) — customer creation is naturally idempotent by email + reference_id.
 * We pass reference_id = tenant slug so lookups work later.
 */
async function createCustomer({ email, givenName, familyName, referenceId, note }) {
  const res = await squareFetch('/v2/customers', 'POST', {
    email_address: email,
    given_name: givenName,
    family_name: familyName,
    reference_id: referenceId,
    note,
  });
  return res.customer;
}

// ── Cards ───────────────────────────────────────────────────────────────────
/**
 * Attach a tokenized source (nonce from Web Payments SDK) as a persistent card
 * on a customer record. Returns the card object (card.id is what subscriptions use).
 */
// Square enforces idempotency_key ≤ 45 chars. crypto.randomUUID() = 36 chars.
function newIdempotencyKey() {
  return crypto.randomUUID();
}

async function createCard({ sourceId, customerId, cardholderName, verificationToken }) {
  const body = {
    idempotency_key: newIdempotencyKey(),
    source_id: sourceId,
    card: {
      customer_id: customerId,
    },
  };
  if (cardholderName) body.card.cardholder_name = cardholderName;
  if (verificationToken) body.verification_token = verificationToken;

  const res = await squareFetch('/v2/cards', 'POST', body);
  return res.card;
}

// ── Subscriptions ───────────────────────────────────────────────────────────
/**
 * Create a subscription. Pass startDate=YYYY-MM-DD to defer billing
 * (Square holds the subscription in PENDING until start_date, then ACTIVE —
 * this is how we implement a free trial without using a separate phase).
 */
async function createSubscription({ customerId, planVariationId, cardId, locationId, startDate }) {
  const body = {
    idempotency_key: newIdempotencyKey(),
    location_id: locationId,
    plan_variation_id: planVariationId,
    customer_id: customerId,
    card_id: cardId,
  };
  if (startDate) body.start_date = startDate;
  const res = await squareFetch('/v2/subscriptions', 'POST', body);
  return res.subscription;
}

async function cancelSubscription({ subscriptionId }) {
  // POST /v2/subscriptions/{id}/cancel — ends at current period end
  const res = await squareFetch(`/v2/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, 'POST');
  return res.subscription;
}

async function retrieveSubscription({ subscriptionId }) {
  const res = await squareFetch(`/v2/subscriptions/${encodeURIComponent(subscriptionId)}`, 'GET');
  return res.subscription;
}

/**
 * Swap a subscription to a different plan variation (e.g. Starter → Pro).
 * Takes effect on the NEXT billing cycle by default.
 */
async function swapSubscriptionPlan({ subscriptionId, newPlanVariationId }) {
  const res = await squareFetch(
    `/v2/subscriptions/${encodeURIComponent(subscriptionId)}/swap-plan`,
    'POST',
    { new_plan_variation_id: newPlanVariationId }
  );
  return res.subscription;
}

/**
 * Update a subscription's card_id (replace payment method).
 * Square's PUT endpoint merges provided fields into the subscription.
 */
async function updateSubscriptionCard({ subscriptionId, cardId }) {
  const res = await squareFetch(
    `/v2/subscriptions/${encodeURIComponent(subscriptionId)}`,
    'PUT',
    { subscription: { card_id: cardId } }
  );
  return res.subscription;
}

/**
 * Disable (deactivate) a card on file. Square doesn't allow true deletion;
 * disable marks the card unusable for future charges.
 */
async function disableCard({ cardId }) {
  const res = await squareFetch(`/v2/cards/${encodeURIComponent(cardId)}/disable`, 'POST');
  return res.card;
}

/**
 * List all cards for a customer. Used by the admin panel to show the card on file.
 */
async function listCustomerCards({ customerId }) {
  const res = await squareFetch(
    `/v2/cards?customer_id=${encodeURIComponent(customerId)}`,
    'GET'
  );
  return res.cards || [];
}

/**
 * Retrieve a specific card (used for displaying last 4 digits in the UI).
 */
async function retrieveCard({ cardId }) {
  const res = await squareFetch(`/v2/cards/${encodeURIComponent(cardId)}`, 'GET');
  return res.card;
}

/**
 * Reactivate a subscription that was canceled (reverses the scheduled cancellation
 * if the current period has not yet ended).
 *
 * Square models a cancellation as a scheduled CANCEL action on an otherwise-ACTIVE
 * subscription. To undo, we fetch the sub, find the scheduled CANCEL action, and
 * delete it. If the sub is PAUSED instead, we POST /resume.
 */
async function resumeSubscription({ subscriptionId }) {
  // 1. Retrieve subscription with actions
  const info = await squareFetch(
    `/v2/subscriptions/${encodeURIComponent(subscriptionId)}?include=actions`,
    'GET'
  );
  const sub = info.subscription || {};
  const actions = sub.actions || [];

  // 2. If PAUSED, call /resume
  if ((sub.status || '').toUpperCase() === 'PAUSED') {
    const res = await squareFetch(
      `/v2/subscriptions/${encodeURIComponent(subscriptionId)}/resume`,
      'POST'
    );
    return res.subscription;
  }

  // 3. Otherwise look for a scheduled CANCEL action and delete it
  const cancelAction = actions.find(a => (a.type || '').toUpperCase() === 'CANCEL');
  if (!cancelAction) {
    const err = new Error('No scheduled cancellation to reverse and subscription is not paused');
    err.status = 400;
    throw err;
  }
  const res = await squareFetch(
    `/v2/subscriptions/${encodeURIComponent(subscriptionId)}/actions/${encodeURIComponent(cancelAction.id)}`,
    'DELETE'
  );
  return res.subscription;
}

// ── Webhook signature verification ──────────────────────────────────────────
/**
 * Verify an incoming Square webhook signature.
 *
 * Square signs the SHA-256 HMAC of (notification_url + request_body) using the
 * signature key from the webhook subscription. The signature is sent in header
 * `x-square-hmacsha256-signature` as base64.
 *
 * @see https://developer.squareup.com/docs/webhooks/step3validate
 *
 * @param {Object} opts
 * @param {string} opts.signatureHeader  value of x-square-hmacsha256-signature
 * @param {string} opts.body             raw request body (UTF-8 string)
 * @param {string} opts.url              full HTTPS URL Square was configured to POST to
 * @param {string} opts.signatureKey     webhook signature key from Square dashboard
 * @returns {boolean}
 */
function verifyWebhookSignature({ signatureHeader, body, url, signatureKey }) {
  if (!signatureHeader || !body || !url || !signatureKey) return false;
  const hmac = crypto.createHmac('sha256', signatureKey);
  hmac.update(url + body);
  const expected = hmac.digest('base64');
  // Constant-time compare — lengths must match for timingSafeEqual
  if (expected.length !== signatureHeader.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signatureHeader, 'utf8')
    );
  } catch {
    return false;
  }
}

// ── Webhook subscriptions management ────────────────────────────────────────
async function listWebhookSubscriptions() {
  const res = await squareFetch('/v2/webhooks/subscriptions', 'GET');
  return res.subscriptions || [];
}

async function createWebhookSubscription({ name, notificationUrl, eventTypes, apiVersion }) {
  const res = await squareFetch('/v2/webhooks/subscriptions', 'POST', {
    idempotency_key: `ro-webhook-${Date.now()}`,
    subscription: {
      name,
      notification_url: notificationUrl,
      event_types: eventTypes,
      api_version: apiVersion || API_VERSION,
    },
  });
  return res.subscription;
}

module.exports = {
  squareFetch,
  createCustomer,
  createCard,
  createSubscription,
  cancelSubscription,
  retrieveSubscription,
  swapSubscriptionPlan,
  updateSubscriptionCard,
  disableCard,
  listCustomerCards,
  retrieveCard,
  resumeSubscription,
  verifyWebhookSignature,
  listWebhookSubscriptions,
  createWebhookSubscription,
  API_VERSION,
};
