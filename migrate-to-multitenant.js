/**
 * migrate-to-multitenant.js
 *
 * One-time migration: moves all LaChona root Firestore collections
 * into /tenants/lachona/ and stamps JWT claims for existing Auth users.
 *
 * Run AFTER deploying the multi-tenant Cloud Function and rules.
 * Run BEFORE telling users to reload the app.
 *
 * Usage:
 *   cd /Users/mulefamily/Claude/Bistro-Steward
 *   node migrate-to-multitenant.js              # DRY RUN — no writes
 *   node migrate-to-multitenant.js --execute    # actually migrates
 *
 * Prerequisites:
 *   npm install firebase-admin (in this dir or globally)
 *   Application Default Credentials via `gcloud auth application-default login`
 *   (org policy blocks SA key creation per CLAUDE.md memory)
 *
 * Safety:
 *   - DRY RUN by default. Pass --execute to actually write.
 *   - Idempotent: re-runnable. Uses deterministic doc IDs everywhere.
 *   - Reads each collection, writes to tenant namespace, then reports.
 *   - Does NOT delete root collections (use cleanup-root-collections.js).
 */

const admin = require('firebase-admin');

const DRY_RUN = !process.argv.includes('--execute');

// ── CONFIG ────────────────────────────────────────────────────────────────────
const TENANT_ID = 'lachona';
const TENANT_SLUG = 'lachona';
const RESTAURANT_NAME = 'LaChona Bistro';
const OWNER_EMAIL = 'grandma.chona@gmail.com';
const OWNER_ROLE = 'owner';

// Credentials: ADC only. Run once: `gcloud auth application-default login`
// (as a user with Firebase Admin + Cloud Datastore User + Service Account Token
// Creator roles on the project). SA key files are blocked by org policy.

// Collections to migrate (all 15 data collections + counters + audit_log)
const COLLECTIONS_TO_MIGRATE = [
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
  'audit_log', // tenant-isolation fix: historical audit entries move with tenant
];

// ── INIT ──────────────────────────────────────────────────────────────────────
// ADC only. Org policy blocks SA key creation. Run `gcloud auth
// application-default login` first if not already authenticated.
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'restaurant-oracle',
});

console.log('[auth] Using Application Default Credentials (gcloud)');

const db = admin.firestore();
const auth = admin.auth();

// ── HELPERS ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function migrateCollection(collectionName) {
  const sourceRef = db.collection(collectionName);
  const snap = await sourceRef.get();

  if (snap.empty) {
    console.log(`  ⏭  ${collectionName}: empty, skipped`);
    return 0;
  }

  if (DRY_RUN) {
    console.log(`  [DRY] ${collectionName}: ${snap.size} doc(s) would migrate → /tenants/${TENANT_ID}/${collectionName}`);
    return snap.size;
  }

  const destBase = db.collection('tenants').doc(TENANT_ID).collection(collectionName);
  const batchSize = 400; // Firestore batch limit is 500
  let written = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    batch.set(destBase.doc(doc.id), doc.data(), { merge: true });
    batchCount++;
    written++;

    if (batchCount >= batchSize) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
      await sleep(100); // brief pause between batches
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`  ✓  ${collectionName}: ${written} docs → /tenants/${TENANT_ID}/${collectionName}`);
  return written;
}

async function createTenantDoc() {
  const tenantRef = db.collection('tenants').doc(TENANT_ID);
  const existing = await tenantRef.get();

  if (existing.exists) {
    console.log(`  ⏭  tenants/${TENANT_ID} already exists, skipping doc creation`);
    return;
  }

  if (DRY_RUN) {
    console.log(`  [DRY] would create tenants/${TENANT_ID}`);
    return;
  }

  await tenantRef.set({
    slug: TENANT_SLUG,
    restaurantName: RESTAURANT_NAME,
    ownerEmail: OWNER_EMAIL,
    plan: 'pro',
    status: 'active',
    onboardingComplete: true,
    stripeCustomerId: null, // fill in when Stripe is set up
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    migratedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`  ✓  Created tenants/${TENANT_ID} doc`);
}

async function seedApprovedEmails() {
  // Read existing approved_emails from root
  const rootEmailsSnap = await db.collection('approved_emails').get();
  const tenantEmailsRef = db.collection('tenants').doc(TENANT_ID).collection('approved_emails');

  if (rootEmailsSnap.empty) {
    // No root emails — seed owner with deterministic doc id (idempotent: re-runs
    // overwrite the same doc instead of creating duplicates).
    const ownerEmail = OWNER_EMAIL.toLowerCase();
    const ownerDocId = ownerEmail.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (DRY_RUN) {
      console.log(`  [DRY] would seed approved_emails/${ownerDocId} for owner ${ownerEmail}`);
      return;
    }
    await tenantEmailsRef.doc(ownerDocId).set({
      email: ownerEmail,
      role: OWNER_ROLE,
      added_by: 'migration',
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`  ✓  Seeded approved_emails/${ownerDocId} with owner: ${ownerEmail}`);
    return;
  }

  if (DRY_RUN) {
    console.log(`  [DRY] would migrate ${rootEmailsSnap.size} approved_emails → tenant namespace`);
    return;
  }

  const batch = db.batch();
  rootEmailsSnap.docs.forEach(doc => {
    batch.set(tenantEmailsRef.doc(doc.id), doc.data(), { merge: true });
  });
  await batch.commit();
  console.log(`  ✓  Migrated ${rootEmailsSnap.size} approved_emails → tenant namespace`);
}

async function stampExistingUserClaims() {
  console.log('\n[3] Stamping JWT claims for existing Auth users...');

  // Get all users from approved_emails (tenant namespace, just written above)
  const approvedSnap = await db.collection('tenants').doc(TENANT_ID)
    .collection('approved_emails').get();

  const approvedEmails = new Map(); // email → role
  approvedSnap.docs.forEach(doc => {
    const d = doc.data();
    if (d.email) approvedEmails.set(d.email.toLowerCase(), d.role || 'employee');
  });

  console.log(`  Found ${approvedEmails.size} approved email(s) to stamp`);

  // List all Auth users and stamp those in the approved list
  let stamped = 0;
  let pageToken;

  do {
    const listResult = await auth.listUsers(1000, pageToken);

    for (const user of listResult.users) {
      const email = (user.email || '').toLowerCase();
      if (!approvedEmails.has(email)) continue;

      const role = approvedEmails.get(email);
      const existingClaims = user.customClaims || {};

      if (DRY_RUN) {
        console.log(`  [DRY] would stamp ${email} → { tenantId: '${TENANT_ID}', role: '${role}' }`);
      } else {
        await auth.setCustomUserClaims(user.uid, {
          ...existingClaims,
          tenantId: TENANT_ID,
          tenantSlug: TENANT_SLUG,
          approved: true,
          role: role,
        });
        console.log(`  ✓  Stamped ${email} → { tenantId: '${TENANT_ID}', tenantSlug: '${TENANT_SLUG}', role: '${role}' }`);
      }
      stamped++;
    }

    pageToken = listResult.pageToken;
  } while (pageToken);

  console.log(`  Stamped ${stamped} user(s) total`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Bistro Steward — Multi-Tenant Migration');
  console.log(`  Tenant: ${TENANT_ID} (${RESTAURANT_NAME})`);
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : '🔴 EXECUTE (writes are live)'}`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (!DRY_RUN) {
    console.log('  ⚠️  Live writes start in 5 seconds. Ctrl+C to abort.\n');
    await sleep(5000);
  }

  // Step 1: Create tenant doc
  console.log('[1] Creating tenant doc...');
  await createTenantDoc();

  // Step 2: Migrate all collections
  console.log('\n[2] Migrating collections...');
  let totalDocs = 0;
  for (const col of COLLECTIONS_TO_MIGRATE) {
    totalDocs += await migrateCollection(col);
  }

  // Step 2b: Migrate approved_emails
  await seedApprovedEmails();

  // Step 3: Stamp JWT claims
  await stampExistingUserClaims();

  console.log('\n═══════════════════════════════════════════════════════');
  if (DRY_RUN) {
    console.log(`  ✅ Dry run complete. ${totalDocs} docs would be moved across ${COLLECTIONS_TO_MIGRATE.length} collections.`);
    console.log('  Re-run with --execute to actually migrate.');
    console.log('═══════════════════════════════════════════════════════\n');
    return;
  }
  console.log(`  ✅ Migration complete! ${totalDocs} docs moved.`);
  console.log('\n  NEXT STEPS:');
  console.log('  1. Deploy updated Cloud Function + firestore.rules (firebase deploy)');
  console.log('  2. Have existing users reload the app (forces token refresh)');
  console.log('  3. Verify LaChona works at lachona.bistrosteward.com');
  console.log('  4. After verifying, manually delete root collections in Firebase Console');
  console.log('     (team_members, areas, cats, menu_cats, rec_cats, units, ings, inv,');
  console.log('      shopping, preps, recs, menus, log, conversions, settings, counters)');
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('\n❌ Migration failed:', err.message);
  console.error(err);
  process.exit(1);
});
