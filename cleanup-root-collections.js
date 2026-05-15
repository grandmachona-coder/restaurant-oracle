/**
 * cleanup-root-collections.js
 *
 * Deletes the 18 root-level Firestore collections that were migrated into
 * /tenants/lachona/ by migrate-to-multitenant.js. Run AFTER verifying the
 * app works end-to-end against the tenant namespace.
 *
 * Safety:
 *   - DRY RUN by default. Pass --execute to actually delete.
 *   - Prints doc counts per collection before deleting.
 *   - Does NOT touch /tenants/**.
 *   - Does NOT delete root /audit_log immediately — that's the pre-auth
 *     fallback path used by writeAuditLog for auth_failure / tenant_not_found
 *     events. Keep it.
 *
 * Usage:
 *   cd /Users/mulefamily/Claude/Bistro-Steward
 *   node cleanup-root-collections.js              # dry run — just counts
 *   node cleanup-root-collections.js --execute    # actually deletes
 *
 * Credentials: same ADC / service-account resolution as migrate-to-multitenant.js.
 */

const admin = require('firebase-admin');

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Collections the migration copied into /tenants/lachona/.
// These were left at root as rollback safety net; now we clean them up.
//
// NOTE: root /audit_log is intentionally EXCLUDED — it's still used by
// writeAuditLog() in the Cloud Function for pre-auth events (auth_failure,
// tenant_not_found) where no tenantId is known yet. Keep it.
const ROOT_COLLECTIONS_TO_DELETE = [
  'team_members',
  'areas',
  'cats',
  'menu_cats',
  'rec_cats',
  'units',
  'ings',
  'inv',
  'shopping',
  'preps',
  'recs',
  'menus',
  'log',
  'conversions',
  'settings',
  'counters',
  'approved_emails',
];

const DRY_RUN = !process.argv.includes('--execute');

// ── CREDENTIALS ───────────────────────────────────────────────────────────────
// ADC only. Org policy blocks SA key creation. Run `gcloud auth
// application-default login` first if not already authenticated.
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'restaurant-oracle',
});

console.log('[auth] Using Application Default Credentials (gcloud)');

const db = admin.firestore();

// ── HELPERS ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Recursively delete a collection in batches. Uses recursive delete on each
 * doc so subcollections go with it. Returns count of docs deleted.
 */
async function deleteCollection(collectionName) {
  const ref = db.collection(collectionName);
  const snap = await ref.get();

  if (snap.empty) {
    console.log(`  ⏭  ${collectionName}: empty`);
    return 0;
  }

  if (DRY_RUN) {
    console.log(`  [DRY] ${collectionName}: ${snap.size} doc(s) would be deleted`);
    return snap.size;
  }

  // Use bulk writer with recursiveDelete to handle subcollections cleanly.
  // BulkWriter batches and rate-limits automatically.
  const bulkWriter = db.bulkWriter();
  let deleted = 0;

  bulkWriter.onWriteError(err => {
    // Retry up to 3 times on transient errors
    if (err.failedAttempts < 3) return true;
    console.error(`    ✗ delete failed (gave up after 3 tries): ${err.message}`);
    return false;
  });

  for (const doc of snap.docs) {
    // recursiveDelete handles subcollections under this doc
    await db.recursiveDelete(doc.ref, bulkWriter);
    deleted++;
  }

  await bulkWriter.close();
  console.log(`  ✓  ${collectionName}: ${deleted} doc(s) deleted`);
  return deleted;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Bistro Steward — Root Collection Cleanup');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no deletes)' : '🔴 EXECUTE (deletes are live)'}`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (!DRY_RUN) {
    console.log('  ⚠️  Destructive deletes start in 5 seconds. Ctrl+C to abort.\n');
    await sleep(5000);
  }

  let grandTotal = 0;
  for (const col of ROOT_COLLECTIONS_TO_DELETE) {
    const n = await deleteCollection(col);
    grandTotal += n;
  }

  console.log('\n═══════════════════════════════════════════════════════');
  if (DRY_RUN) {
    console.log(`  ✅ Dry run complete. ${grandTotal} doc(s) across ${ROOT_COLLECTIONS_TO_DELETE.length} collection(s) would be deleted.`);
    console.log('  Re-run with --execute to actually delete.');
  } else {
    console.log(`  ✅ Cleanup complete. ${grandTotal} doc(s) deleted across ${ROOT_COLLECTIONS_TO_DELETE.length} collection(s).`);
    console.log('  Tenant data at /tenants/lachona/ is untouched.');
    console.log('  Root /audit_log is intentionally preserved (pre-auth fallback).');
  }
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('\n❌ Cleanup failed:', err.message);
  console.error(err);
  process.exit(1);
});
