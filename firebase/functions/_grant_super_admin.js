/**
 * Grant super_admin claim to grandma.chona@gmail.com (preserves existing claims).
 */
'use strict';
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'restaurant-oracle' });
const auth = admin.auth();

const EMAIL = process.argv[2] || 'grandma.chona@gmail.com';

async function main() {
  const u = await auth.getUserByEmail(EMAIL);
  const existing = u.customClaims || {};
  if (existing.superAdmin === true) {
    console.log(`Already super_admin: ${EMAIL}`);
    return;
  }
  const merged = { ...existing, superAdmin: true };
  await auth.setCustomUserClaims(u.uid, merged);
  console.log(`Granted super_admin to ${EMAIL} (${u.uid})`);
  console.log(`New claims: ${JSON.stringify(merged)}`);
  await auth.revokeRefreshTokens(u.uid);
  console.log('Refresh tokens revoked — user will need to re-auth');
}
main().catch(e => { console.error(e); process.exit(1); });
