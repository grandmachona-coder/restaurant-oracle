/**
 * Find all users with superAdmin custom claim.
 */
'use strict';
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'restaurant-oracle' });
const auth = admin.auth();

async function main() {
  const superAdmins = [];
  let nextPageToken;
  let total = 0;
  do {
    const page = await auth.listUsers(1000, nextPageToken);
    total += page.users.length;
    for (const u of page.users) {
      if (u.customClaims && u.customClaims.superAdmin === true) {
        superAdmins.push({ uid: u.uid, email: u.email, claims: u.customClaims });
      }
    }
    nextPageToken = page.pageToken;
  } while (nextPageToken);

  console.log(`Scanned ${total} users. ${superAdmins.length} are super_admin:`);
  for (const u of superAdmins) {
    console.log(`  ${u.email} (${u.uid}) — claims: ${JSON.stringify(u.claims)}`);
  }

  // Also show grandma.chona@gmail.com specifically
  try {
    const g = await auth.getUserByEmail('grandma.chona@gmail.com');
    console.log(`\ngrandma.chona@gmail.com: uid=${g.uid}, claims=${JSON.stringify(g.customClaims || {})}`);
  } catch (e) {
    console.log('\ngrandma.chona@gmail.com: NOT FOUND');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
