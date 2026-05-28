const admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'restaurant-oracle',
});
(async ()=>{
  const db = admin.firestore();
  const snap = await db.collection('feature_flags').doc('upcScanner').get();
  console.log('feature_flags/upcScanner exists:', snap.exists);
  console.log('data:', JSON.stringify(snap.data() || {}, null, 2));
  // also list all feature flags
  const all = await db.collection('feature_flags').get();
  console.log('\nAll feature_flags docs:');
  all.forEach(d=>console.log(' ', d.id, '→', JSON.stringify(d.data())));
  // also confirm user claim
  const auth = admin.auth();
  try {
    const u = await auth.getUserByEmail('grandma.chona@gmail.com');
    console.log('\nUser claims:', JSON.stringify(u.customClaims || {}, null, 2));
  } catch(e){ console.log('user lookup failed:', e.message); }
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
