const admin = require('firebase-admin');
admin.initializeApp({projectId:'restaurant-oracle'});
(async () => {
  const u = await admin.auth().getUserByEmail('grandma.chona@gmail.com');
  console.log('uid:', u.uid);
  console.log('claims:', JSON.stringify(u.customClaims, null, 2));
  const fs = admin.firestore();
  const flagDoc = await fs.collection('feature_flags').doc('upcScanner').get();
  console.log('upcScanner flag:', flagDoc.exists ? JSON.stringify(flagDoc.data(), null, 2) : 'NOT FOUND');
  const ff = require('./feature-flags');
  const tid = u.customClaims && u.customClaims.tenantId;
  console.log('eval for tenantId='+tid+':', ff.evaluateFeatureFlag(flagDoc.data(), tid));
  const all = await fs.collection('feature_flags').get();
  const docs = []; all.forEach(d=>docs.push({id:d.id,...d.data()}));
  console.log('resolveAllFlags:', ff.resolveAllFlags(docs, tid));
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
