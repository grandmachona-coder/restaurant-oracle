/**
 * Mint an ID token for a given uid by creating a custom token and exchanging
 * it via the Identity Toolkit REST API.
 *
 * Usage: FIREBASE_WEB_API_KEY=... node _mint_token.js <uid>
 */
'use strict';
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'restaurant-oracle' });
const auth = admin.auth();

async function main() {
  const uid = process.argv[2];
  if (!uid) { console.error('uid arg required'); process.exit(1); }

  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) { console.error('FIREBASE_WEB_API_KEY env required'); process.exit(1); }

  const customToken = await auth.createCustomToken(uid);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!res.ok) { console.error('exchange failed:', data); process.exit(1); }
  console.log(data.idToken);
}
main().catch(e => { console.error(e); process.exit(1); });
