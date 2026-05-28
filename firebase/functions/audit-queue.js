/**
 * audit-queue.js — Pub/Sub-backed audit-log pipeline.
 *
 * Why this exists.
 *   The previous writeAuditLog() called Firestore .add() directly with a
 *   try/catch that silently swallowed errors. A transient Firestore failure
 *   meant a missing audit entry — and we'd never know. Inspector recon
 *   Pass 1 flagged this as P1; Pass 2 confirmed 61+ call sites at risk.
 *
 * Architecture.
 *   writeAuditLog(...)
 *      → publishAuditEvent()      [Pub/Sub topic: bistro-steward-audit-events]
 *         ↑ on success: return immediately, consumer will write
 *         ↓ on publish failure: directWriteAuditEvent()
 *            ↑ on success: return; audit landed, no replay needed
 *            ↓ on direct-write failure: writePendingAudit()
 *               ↑ on success: pending_audit retry loop picks it up later
 *               ↓ on all-paths failure: Sentry.captureException()
 *
 *   consumeAuditEvent (Cloud Function, Pub/Sub-triggered)
 *      → .create() at /tenants/{id}/audit_log/{eventId}  (idempotent)
 *      → ALREADY_EXISTS = duplicate delivery, ack OK
 *      → any other failure → throw → Pub/Sub retries, eventually DLQ
 *
 * Idempotency.
 *   Each event carries an eventId (caller-provided OR auto-generated).
 *   Consumer uses eventId as the Firestore doc ID, so duplicate Pub/Sub
 *   deliveries become ALREADY_EXISTS, which we treat as a successful ack.
 *
 * Operational prerequisites (one-time, before deploying these functions):
 *   gcloud pubsub topics create bistro-steward-audit-events \
 *     --project=restaurant-oracle
 *   gcloud pubsub topics create bistro-steward-audit-events-dlq \
 *     --project=restaurant-oracle
 *   (Configure the DLQ on the consumer subscription separately —
 *    Firebase's pubsub trigger does not auto-create dead-letter wiring.)
 */
'use strict';

const crypto = require('crypto');

// Lazy-load to keep cold-start fast for callers that never hit the queue path.
let _pubsubClient = null;
function getPubSubClient() {
  if (!_pubsubClient) {
    const { PubSub } = require('@google-cloud/pubsub');
    _pubsubClient = new PubSub();
  }
  return _pubsubClient;
}

const AUDIT_TOPIC_NAME = process.env.AUDIT_TOPIC_NAME || 'bistro-steward-audit-events';
const PUBLISH_TIMEOUT_MS = 5000;

/**
 * Normalize a raw event payload to the canonical audit-log shape.
 * Accepts the existing writeAuditLog parameter names and the new event shape.
 */
function normalizeEvent(raw) {
  return {
    user_id: raw.user_id || raw.userId || null,
    user_email: raw.user_email || raw.userEmail || 'unknown',
    tenant_id: raw.tenant_id || raw.tenantId || null,
    operation: raw.operation || 'unknown',
    collection: raw.collection || 'N/A',
    record_count: Number(raw.record_count || raw.recordCount || 0),
    extra: raw.extra || null,
    // Wall-clock timestamp the publisher saw; consumer overlays a Firestore
    // serverTimestamp on write for monotonic ordering across functions.
    publisher_timestamp_ms: raw.publisher_timestamp_ms || Date.now(),
  };
}

/**
 * Build a stable eventId.
 *
 * ⚠️ idempotencyKey CONTRACT (Pass 3 / Inspector): a supplied key is treated
 * as a globally-unique identifier for ONE logical audit event. The consumer
 * writes with `.create()` keyed by this id, so two publishes with the SAME
 * key collapse into a single audit row — that's the intended dedup behavior
 * (e.g. a Square webhook delivered twice). Callers MUST NOT reuse a key for
 * two semantically different events, or the second will be silently dropped.
 * When in doubt, omit the key: we then generate a fresh UUID and no dedup
 * happens. To make accidental misuse less silent, we suffix a short hash of
 * the key's own characters so malformed/duplicated keys still produce a
 * valid, distinct-looking doc id rather than a raw collision on a truncated
 * string.
 */
function deriveEventId(event, idempotencyKey) {
  if (idempotencyKey && typeof idempotencyKey === 'string') {
    const safe = idempotencyKey.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
    if (safe) {
      // Suffix a deterministic hash of the ORIGINAL key so two different raw
      // keys that sanitize to the same 80-char prefix don't collide.
      const h = crypto.createHash('sha1').update(idempotencyKey).digest('hex').slice(0, 8);
      return safe + '_' + h;
    }
  }
  return crypto.randomUUID();
}

/**
 * Publish an audit event to Pub/Sub.
 * Resolves with the eventId on success. Throws on publish failure so the
 * caller can fall back to direct-write.
 */
async function publishAuditEvent(rawEvent, idempotencyKey) {
  const event = normalizeEvent(rawEvent);
  const eventId = deriveEventId(event, idempotencyKey);
  const payload = { ...event, eventId };
  const data = Buffer.from(JSON.stringify(payload));

  const pubsub = getPubSubClient();
  const topic = pubsub.topic(AUDIT_TOPIC_NAME);

  // Wrap the publish in a timeout so a hung Pub/Sub client never blocks the
  // user-facing request. Pub/Sub's internal batching + retries are still in
  // play, but we set a hard ceiling for the caller.
  const publishPromise = topic.publishMessage({
    data,
    attributes: {
      eventId,
      operation: event.operation,
      tenantId: event.tenant_id || 'platform',
    },
  });
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('audit publish timeout')), PUBLISH_TIMEOUT_MS);
  });

  await Promise.race([publishPromise, timeoutPromise]);
  return eventId;
}

/**
 * Fallback path: write the event directly to Firestore the same way the
 * legacy writeAuditLog did. Uses .create() with the eventId as doc ID so
 * a later Pub/Sub-delivered duplicate becomes a no-op on the consumer.
 */
async function directWriteAuditEvent(db, admin, rawEvent, eventId) {
  const event = normalizeEvent(rawEvent);
  const id = eventId || deriveEventId(event);
  const entry = {
    ...event,
    eventId: id,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    via: 'direct',
  };
  const ref = event.tenant_id
    ? db.collection('tenants').doc(event.tenant_id).collection('audit_log').doc(id)
    : db.collection('audit_log').doc(id);
  try {
    await ref.create(entry);
  } catch (e) {
    // ALREADY_EXISTS means the consumer already wrote this event — that's
    // a successful outcome, not a failure.
    if (e && (e.code === 6 || /already exists/i.test(e.message || ''))) return id;
    throw e;
  }
  return id;
}

/**
 * Final-resort path: write to /pending_audit with the original error context.
 * A daily reconcile job (TBD) drains this collection back into audit_log.
 */
async function writePendingAudit(db, admin, rawEvent, eventId, errors) {
  const event = normalizeEvent(rawEvent);
  const id = eventId || deriveEventId(event);
  await db.collection('pending_audit').add({
    ...event,
    eventId: id,
    publishError: errors.publishError || null,
    writeError: errors.writeError || null,
    status: 'pending',
    attempts: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return id;
}

/**
 * Consumer side: process one Pub/Sub message into a Firestore audit doc.
 * Throwing causes Pub/Sub to retry (with backoff, eventually DLQ).
 */
async function processAuditMessage(db, admin, messageDataBase64, messageAttributes) {
  let payload;
  try {
    payload = JSON.parse(Buffer.from(messageDataBase64, 'base64').toString('utf8'));
  } catch (e) {
    // Malformed payloads are unrecoverable; do not retry. Log + ack.
    console.error('[audit-consume] malformed payload, discarding:', e.message);
    return { ok: false, discarded: true, reason: 'malformed_json' };
  }

  const eventId = (messageAttributes && messageAttributes.eventId)
    || payload.eventId
    || deriveEventId(payload);

  const entry = {
    user_id: payload.user_id || null,
    user_email: payload.user_email || 'unknown',
    tenant_id: payload.tenant_id || null,
    operation: payload.operation || 'unknown',
    collection: payload.collection || 'N/A',
    record_count: Number(payload.record_count || 0),
    extra: payload.extra || null,
    publisher_timestamp_ms: payload.publisher_timestamp_ms || null,
    eventId,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    via: 'pubsub',
  };

  const ref = entry.tenant_id
    ? db.collection('tenants').doc(entry.tenant_id).collection('audit_log').doc(eventId)
    : db.collection('audit_log').doc(eventId);

  try {
    await ref.create(entry);
    return { ok: true, eventId, deduped: false };
  } catch (e) {
    // Firestore's ALREADY_EXISTS code is 6. Treat that as a duplicate
    // delivery — already written, ack-and-move-on.
    if (e && (e.code === 6 || /already exists/i.test(e.message || ''))) {
      return { ok: true, eventId, deduped: true };
    }
    throw e; // any other failure → Pub/Sub retries
  }
}

module.exports = {
  AUDIT_TOPIC_NAME,
  publishAuditEvent,
  directWriteAuditEvent,
  writePendingAudit,
  processAuditMessage,
  // exposed for testing
  _internal: { normalizeEvent, deriveEventId },
};
