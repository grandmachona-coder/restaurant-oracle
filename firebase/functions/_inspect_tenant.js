/**
 * Inspect a tenant doc schema.
 */
'use strict';
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'restaurant-oracle' });
const db = admin.firestore();

async function main() {
  const snap = await db.collection('tenants').limit(5).get();
  console.log(`Found ${snap.size} tenants (limited to 5):\n`);
  snap.forEach(d => {
    const data = d.data();
    const keys = Object.keys(data).sort();
    console.log(`== ${d.id} ==`);
    console.log(`  keys: ${keys.join(', ')}`);
    console.log(`  sample: ${JSON.stringify({ slug: data.slug, restaurant_name: data.restaurant_name, restaurantName: data.restaurantName, plan: data.plan, status: data.status, squareSubscriptionId: data.squareSubscriptionId, subscription_id: data.subscription_id, owner_email: data.owner_email, ownerEmail: data.ownerEmail }, null, 2)}`);
    console.log('');
  });
}
main().catch(e => { console.error(e); process.exit(1); });
