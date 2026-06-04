/**
 * enable-receipts-everyone.js
 *
 * Turns ON the receipt scanner (Scan Receipt + Margin → Receipts + QuickBooks
 * export) for ALL tenants, by setting feature_flags/receiptScanner
 * defaultValue:true.
 *
 * Kill-switch stays available: add a tenant id to `disabledTenants` on the
 * same doc to switch one tenant off (disabledTenants beats everything).
 *
 * Usage:
 *   cd /Users/mulefamily/Claude/Bistro-Steward
 *   node enable-receipts-everyone.js              # DRY RUN — prints what it will write
 *   node enable-receipts-everyone.js --execute    # actually writes the flag
 *
 * Credentials: Application Default Credentials (gcloud auth application-default login).
 */

const admin = require('firebase-admin');

const FLAG_ID = 'receiptScanner';
const EXECUTE = process.argv.includes('--execute');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'restaurant-oracle',
});
const db = admin.firestore();

(async () => {
  const ref = db.collection('feature_flags').doc(FLAG_ID);
  const snap = await ref.get();
  const cur = snap.exists ? (snap.data() || {}) : {};

  const doc = {
    name: FLAG_ID,
    defaultValue: true, // ON for every tenant
    enabledTenants: Array.isArray(cur.enabledTenants) ? cur.enabledTenants : [],
    disabledTenants: Array.isArray(cur.disabledTenants) ? cur.disabledTenants : [],
  };

  console.log('feature_flags/' + FLAG_ID + ' currently:', snap.exists ? JSON.stringify(cur) : '(does not exist)');
  console.log('Will write (merge):', JSON.stringify(doc, null, 2));

  if (!EXECUTE) {
    console.log('\nDRY RUN — nothing written. Re-run with --execute to apply.');
    process.exit(0);
  }

  await ref.set(doc, { merge: true });
  const after = (await ref.get()).data();
  console.log('\nDONE. feature_flags/' + FLAG_ID + ' is now:', JSON.stringify(after));
  console.log('ALL tenants get the receipt scanner on their next app load.');
  process.exit(0);
})().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
