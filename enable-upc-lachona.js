/**
 * enable-upc-lachona.js
 *
 * Turns ON the camera barcode scanner ("Scan Barcode" button) for the LaChona
 * tenant ONLY, by creating/updating the feature_flags/upcScanner document.
 *
 * How the flag works (see firebase/functions/feature-flags.js):
 *   - defaultValue:false  → every tenant gets the scanner OFF by default.
 *   - enabledTenants:['lachona'] → LaChona is an explicit opt-IN → ON.
 *   The Cloud Function resolves this per-tenant in getTenantConfig and the app
 *   shows the button only when its tenant resolves true. Fail-closed.
 *
 * Usage:
 *   cd /Users/mulefamily/Claude/Bistro-Steward
 *   node enable-upc-lachona.js              # DRY RUN — prints what it will write
 *   node enable-upc-lachona.js --execute    # actually writes the flag
 *
 * To roll out to everyone later: set defaultValue:true (or just edit the doc).
 * To pause LaChona: remove 'lachona' from enabledTenants (or add to
 * disabledTenants, which beats everything).
 *
 * Credentials: Application Default Credentials, same as migrate-to-multitenant.js.
 *   gcloud auth application-default login   (once, if you haven't)
 */

const admin = require('firebase-admin');

const FLAG_ID = 'upcScanner';
const TENANT_ID = 'lachona';
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
  const curEnabled = Array.isArray(cur.enabledTenants) ? cur.enabledTenants.map(String) : [];
  const nextEnabled = curEnabled.indexOf(TENANT_ID) === -1
    ? curEnabled.concat([TENANT_ID])
    : curEnabled;

  const doc = {
    name: FLAG_ID,
    defaultValue: cur.defaultValue === true, // preserve if already true, else false
    enabledTenants: nextEnabled,
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
  console.log('LaChona (tenant "' + TENANT_ID + '") will see the Scan Barcode button after their next app load.');
  process.exit(0);
})().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
