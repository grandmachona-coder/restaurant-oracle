/**
 * webhook-dedup.js — idempotent processing for Square webhook deliveries.
 *
 * Why this exists (Cashier recon K-2).
 *   Square webhooks are at-least-once: the same event_id can be delivered more
 *   than once (network hiccup, our 500, Square's own retries). The handler had
 *   NO dedup, so a duplicate invoice.payment_made could re-flip status, re-revoke
 *   tokens, or re-send a receipt. The webhook_events collection existed in the
 *   rules but was never written/checked.
 *
 * Design — "processed marker", retry-safe.
 *   We key on Square's event_id at /webhook_events/{event_id}:
 *     • create() with status='processing' on first sight (atomic — wins exactly
 *       one writer).
 *     • If create() hits ALREADY_EXISTS we read the doc:
 *         - status === 'processed'  → genuine duplicate of a COMPLETED event → SKIP.
 *         - otherwise (processing / failed) → a prior delivery did NOT finish
 *           (we 500'd, or it's an in-flight retry) → REPROCESS. Downstream
 *           handlers are idempotent (status set to same value, token revoke is
 *           a no-op if already revoked), so reprocessing is safe and is strictly
 *           better than dropping an unprocessed event.
 *     • After the handler succeeds we stamp status='processed'.
 *   If the handler throws, we DON'T mark processed and we rethrow — the caller
 *   returns 500, Square retries, and the marker (still 'processing') lets the
 *   retry through. This deliberately favors at-least-once over at-most-once for
 *   billing events: a rare double-process beats a silently dropped payment.
 *
 *   Events with no event_id are processed WITHOUT dedup (can't key them) and
 *   flagged unkeyed in the result for logging.
 */
'use strict';

function isAlreadyExists(e) {
  return !!(e && (e.code === 6 || /already exists/i.test(e.message || '')));
}

/**
 * Pure decision: given the existing marker's status, should we process again?
 * 'processed' → skip; anything else (including null/undefined) → process.
 */
function shouldReprocess(existingStatus) {
  return existingStatus !== 'processed';
}

/**
 * Run `handler` at most once per Square event_id (modulo the retry-safety
 * carve-out above). Never silently swallows handler errors — it rethrows so the
 * webhook returns 500 and Square retries.
 *
 * deps = { db, admin, logger? }
 * Returns { processed, deduped, unkeyed }.
 */
async function processWebhookOnce(deps, eventId, meta, handler) {
  const { db, admin } = deps;
  const log = (deps.logger && deps.logger.warn) ? deps.logger.warn.bind(deps.logger)
    : ((m) => console.warn('[webhook-dedup] ' + m));

  if (!eventId) {
    await handler();
    return { processed: true, deduped: false, unkeyed: true };
  }

  const ref = db.collection('webhook_events').doc(String(eventId));
  const serverTs = () => admin.firestore.FieldValue.serverTimestamp();

  try {
    await ref.create({
      type: (meta && meta.type) || null,
      status: 'processing',
      receivedAt: serverTs(),
    });
  } catch (e) {
    if (!isAlreadyExists(e)) throw e;
    let existingStatus = null;
    try {
      const snap = await ref.get();
      existingStatus = snap.exists ? (snap.data() || {}).status : null;
    } catch (readErr) {
      // If we can't read the marker, fail safe by reprocessing.
      log('marker read failed for ' + eventId + ': ' + (readErr && readErr.message));
    }
    if (!shouldReprocess(existingStatus)) {
      return { processed: false, deduped: true, unkeyed: false };
    }
    // else: in-flight/failed prior delivery → fall through and reprocess.
  }

  await handler(); // may throw → caller returns 500, marker stays non-'processed'

  try {
    await ref.set({ status: 'processed', processedAt: serverTs() }, { merge: true });
  } catch (e) {
    log('mark-processed failed for ' + eventId + ': ' + (e && e.message));
  }
  return { processed: true, deduped: false, unkeyed: false };
}

module.exports = {
  processWebhookOnce,
  // exposed for testing
  _internal: { isAlreadyExists, shouldReprocess },
};
