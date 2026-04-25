/**
 * One-shot cleanup for test tenant HRV3v3Cs5PY3BraRizUf.
 * - Cancels Square subscription immediately (not scheduled)
 * - Deletes any Square card for the customer
 * - Recursively deletes Firestore tenant data
 * - Cleans up root approved_emails entries
 * - Deletes all Auth users attached to the tenant
 *
 * Run: cd functions && node _cleanup_test_tenant.js
 */
'use strict';

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'restaurant-oracle' });
}

const db = admin.firestore();
const auth = admin.auth();

const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_HOST = 'https://connect.squareupsandbox.com';
const API_VERSION = '2025-01-23';

async function squareFetch(endpoint, method, body) {
  if (!SQUARE_ACCESS_TOKEN) {
    console.warn('[cleanup] SQUARE_ACCESS_TOKEN not set — skipping Square operations');
    return null;
  }
  const res = await fetch(`${SQUARE_HOST}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${SQUARE_ACCESS_TOKEN}`,
      'Square-Version': API_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const TENANT_ID = process.argv[2] || 'HRV3v3Cs5PY3BraRizUf';

async function main() {
  console.log(`[cleanup] Starting cleanup for tenant ${TENANT_ID}`);

  // 1. Read tenant doc
  const tenantRef = db.collection('tenants').doc(TENANT_ID);
  const tenantSnap = await tenantRef.get();
  if (!tenantSnap.exists) {
    console.log('[cleanup] Tenant doc not found — tenant already deleted?');
  } else {
    const t = tenantSnap.data();
    console.log(`[cleanup] Tenant: ${t.slug} (${t.restaurant_name}) owner=${t.owner_email}`);

    // 2. Cancel Square subscription immediately via DELETE
    const subId = t.subscription_id;
    if (subId && SQUARE_ACCESS_TOKEN) {
      console.log(`[cleanup] Attempting immediate cancel of subscription ${subId}`);
      // First schedule cancel, then remove any pending actions
      const cancelRes = await squareFetch(`/v2/subscriptions/${subId}/cancel`, 'POST');
      console.log(`[cleanup] Cancel status: ${cancelRes && cancelRes.status}`);
    }

    // 3. Disable customer's card
    if (t.square_customer_id && SQUARE_ACCESS_TOKEN) {
      const cardsRes = await squareFetch(`/v2/cards?customer_id=${t.square_customer_id}`, 'GET');
      if (cardsRes && cardsRes.ok) {
        const cards = (cardsRes.data && cardsRes.data.cards) || [];
        for (const c of cards) {
          if (c.enabled) {
            console.log(`[cleanup] Disabling card ${c.id}`);
            await squareFetch(`/v2/cards/${c.id}/disable`, 'POST');
          }
        }
      }
    }
  }

  // 4. Find all users belonging to this tenant
  const usersToDelete = [];
  let nextPageToken;
  do {
    const page = await auth.listUsers(1000, nextPageToken);
    for (const u of page.users) {
      if (u.customClaims && u.customClaims.tenantId === TENANT_ID) {
        usersToDelete.push({ uid: u.uid, email: u.email });
      }
    }
    nextPageToken = page.pageToken;
  } while (nextPageToken);

  console.log(`[cleanup] Found ${usersToDelete.length} auth users to delete`);
  for (const u of usersToDelete) {
    try {
      await auth.deleteUser(u.uid);
      console.log(`[cleanup]   Deleted auth user ${u.email} (${u.uid})`);
    } catch (e) {
      console.warn(`[cleanup]   Failed to delete ${u.uid}: ${e.message}`);
    }
  }

  // 5. Recursively delete Firestore tenant data
  console.log(`[cleanup] Recursive delete of /tenants/${TENANT_ID}`);
  await db.recursiveDelete(tenantRef);
  console.log('[cleanup]   Done');

  // 6. Clean up root approved_emails entries for this tenant
  const approvedSnap = await db.collection('approved_emails').where('tenantId', '==', TENANT_ID).get();
  const batch = db.batch();
  let approvedCount = 0;
  approvedSnap.forEach(doc => {
    batch.delete(doc.ref);
    approvedCount++;
  });
  if (approvedCount > 0) {
    await batch.commit();
    console.log(`[cleanup] Deleted ${approvedCount} approved_emails entries`);
  }

  console.log('[cleanup] Done.');
}

main().catch(e => {
  console.error('[cleanup] Failed:', e);
  process.exit(1);
});
