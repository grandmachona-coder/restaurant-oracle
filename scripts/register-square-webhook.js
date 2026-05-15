#!/usr/bin/env node
/**
 * register-square-webhook.js
 *
 * One-shot script: registers our Cloud Function URL as a Square webhook
 * subscription, then prints the signature key we need to store in the
 * SQUARE_WEBHOOK_SIGNATURE_KEY Firebase secret.
 *
 * Idempotent: if a subscription with our notification_url already exists, we
 * print its existing signature_key instead of creating a duplicate.
 *
 * Inputs (env):
 *   SQUARE_ACCESS_TOKEN   — sandbox access token
 *
 * Usage:
 *   SQUARE_ACCESS_TOKEN=$(firebase functions:secrets:access SQUARE_ACCESS_TOKEN --project=restaurant-oracle | tail -1) \
 *   node scripts/register-square-webhook.js
 *
 *   ... then pipe the printed signature_key back into Firebase:
 *   printf '<KEY>' | firebase functions:secrets:set SQUARE_WEBHOOK_SIGNATURE_KEY --project=restaurant-oracle --data-file=-
 */

'use strict';

const SQUARE_HOST = process.env.SQUARE_ENV === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';
const API_VERSION = '2025-01-23';

const NOTIFICATION_URL = process.env.SQUARE_WEBHOOK_URL
  || 'https://us-central1-restaurant-oracle.cloudfunctions.net/squareWebhook';

// Valid event types per GET /v2/webhooks/event-types (2025-01-23):
// Square does NOT expose subscription.canceled — cancellations surface via
// subscription.updated with status=CANCELED. Likewise invoice.payment_failed
// is not emitted — payment failures come through invoice.scheduled_charge_failed.
const EVENT_TYPES = [
  'subscription.created',
  'subscription.updated',
  'invoice.created',
  'invoice.published',
  'invoice.payment_made',
  'invoice.scheduled_charge_failed',
  'invoice.canceled',
];

const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
  console.error('✗ SQUARE_ACCESS_TOKEN env var is required');
  process.exit(1);
}

// Deterministic idempotency key derived from notification URL — guarantees Square
// dedupes within its 24h idempotency window even if the script retries due to
// network drops. SHA-256 prefix keeps it under Square's 45-char key limit.
const crypto = require('crypto');
const IDEMPOTENCY_KEY = `ro-webhook-${crypto.createHash('sha256').update(NOTIFICATION_URL).digest('hex').slice(0, 24)}`;

async function squareFetch(endpoint, method, body) {
  const res = await fetch(`${SQUARE_HOST}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Square-Version': API_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Square API ${res.status}: ${JSON.stringify(data.errors || data)}`);
    err.body = data;
    throw err;
  }
  return data;
}

async function listSubscriptions() {
  const res = await squareFetch('/v2/webhooks/subscriptions', 'GET');
  return res.subscriptions || [];
}

async function createSubscription() {
  const res = await squareFetch('/v2/webhooks/subscriptions', 'POST', {
    idempotency_key: IDEMPOTENCY_KEY,
    subscription: {
      name: 'Bistro Steward — Subscription Lifecycle',
      notification_url: NOTIFICATION_URL,
      event_types: EVENT_TYPES,
      api_version: API_VERSION,
    },
  });
  return res.subscription;
}

async function fetchSignatureKey(subscriptionId) {
  // Retrieve the subscription — returns signature_key in the payload
  const res = await squareFetch(`/v2/webhooks/subscriptions/${subscriptionId}`, 'GET');
  return res.subscription;
}

(async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Bistro Steward — Square Webhook Registration');
  console.log(`  Environment: ${SQUARE_HOST.includes('sandbox') ? 'SANDBOX' : 'PRODUCTION'}`);
  console.log(`  Notification URL: ${NOTIFICATION_URL}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Check if already exists
  console.log('→ Checking existing webhook subscriptions...');
  const existing = await listSubscriptions();
  const match = existing.find(s => s.notification_url === NOTIFICATION_URL);

  let subscription;
  if (match) {
    console.log(`  Found existing subscription: ${match.id}`);
    subscription = await fetchSignatureKey(match.id);
  } else {
    console.log('  No existing subscription. Creating...');
    subscription = await createSubscription();
    console.log(`  Created subscription: ${subscription.id}`);
  }

  console.log('\n───────────────────────────────────────────────────────');
  console.log('  Subscription details:');
  console.log(`    id:            ${subscription.id}`);
  console.log(`    enabled:       ${subscription.enabled}`);
  console.log(`    notification:  ${subscription.notification_url}`);
  console.log(`    api_version:   ${subscription.api_version}`);
  console.log(`    event_types:   ${(subscription.event_types || []).join(', ')}`);

  if (!subscription.signature_key) {
    console.error('\n✗ signature_key missing from response');
    console.error('  Full response:', JSON.stringify(subscription, null, 2));
    process.exit(1);
  }

  console.log('───────────────────────────────────────────────────────\n');
  console.log('SIGNATURE KEY (store in Firebase secret SQUARE_WEBHOOK_SIGNATURE_KEY):');
  console.log(`  ${subscription.signature_key}\n`);

  console.log('Run this to update the secret:');
  console.log(`  printf '${subscription.signature_key}' | \\`);
  console.log(`    firebase functions:secrets:set SQUARE_WEBHOOK_SIGNATURE_KEY --project=restaurant-oracle --data-file=-`);
})().catch(err => {
  console.error('\n✗ Failed:', err.message);
  if (err.body) console.error('  Body:', JSON.stringify(err.body, null, 2));
  process.exit(1);
});
