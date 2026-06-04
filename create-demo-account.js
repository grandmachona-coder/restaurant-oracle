/**
 * create-demo-account.js
 *
 * Creates the Apple App Review demo account + an isolated "Demo Bistro" tenant,
 * seeded with realistic fictional data so every tab renders populated. This is
 * the hard-gate item in iOS-Build-Plan.md §0.2 ("Apple demo account"): the app
 * is a login wall and reviewers cannot use Google/Apple SSO, so they need a
 * plain email/password account.
 *
 * What it does (all via Application Default Credentials — no SA key, per org policy):
 *   1. Firebase Auth user demo@bistrosteward.com (known password, emailVerified=true
 *      so the password-user email-verification gate at app.html:1742 is satisfied).
 *   2. Custom claims {tenantId:'demo', tenantSlug:'demo', approved:true, role:'owner'}
 *      — satisfies the approval gate (app.html:1648); tenant is resolved purely from
 *      these claims (app.html loads no hostname-based slug), so this account opens the
 *      demo tenant on the NATIVE iOS app too (which loads restaurant-oracle.web.app/app).
 *   3. tenants/demo doc — id == slug == 'demo' (mirrors lachona so the upcScanner
 *      feature flag, which keys on tenantId/doc-id per index.js:1630, lines up).
 *      status:'active' (not in the blocked list at index.js:955), onboardingComplete:true
 *      (skips the wizard at app.html:1267).
 *   4. Seeds structural + fictional inventory/recipes/menus/prep (schemas mirrored from
 *      live lachona docs). LaChona's real data is NOT copied — demo is fully isolated.
 *   5. Adds 'demo' to feature_flags/upcScanner.enabledTenants so the barcode scanner
 *      (the headline native feature reviewers must be able to test) is visible.
 *
 * Usage (from repo root, where node_modules/firebase-admin lives):
 *   node create-demo-account.js            # DRY RUN — prints the plan, writes nothing
 *   node create-demo-account.js --execute  # creates everything
 *
 * Idempotency: aborts on --execute if the demo user or tenants/demo already exists,
 * so a re-run never clobbers a live demo. Delete both first to recreate.
 *
 * Credentials: ADC (gcloud auth application-default login). Same as migrate-to-multitenant.js.
 */

const admin = require('firebase-admin');
const crypto = require('crypto');

const EXECUTE = process.argv.includes('--execute');

// ── Demo account credentials (these go into App Store Connect → App Review Information) ──
const DEMO_EMAIL = 'demo@bistrosteward.com';
const DEMO_PASSWORD = '***REMOVED***';
const DEMO_DISPLAY = 'Demo Owner';
const TENANT_ID = 'demo';          // doc id == slug (mirrors lachona)
const TENANT_SLUG = 'demo';
const RESTAURANT_NAME = 'Demo Bistro';

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'restaurant-oracle' });
const db = admin.firestore();
const auth = admin.auth();

// ── Seed data (field shapes mirrored from live tenants/lachona docs) ──
const V = 1;
function seed() {
  const units = [
    ['ea','each','ea'],[2,'lb','lb'],[3,'oz','oz'],[4,'fl oz','fl oz'],[5,'cup','cup'],
    [6,'tbsp','tbsp'],[7,'tsp','tsp'],[8,'case','cs'],[9,'dozen','dz'],[10,'liter','L'],
    [11,'gallon','gal'],[12,'quart','qt'],[13,'gram','g'],[14,'kilogram','kg'],
    [15,'bunch','bunch'],[16,'batch','batch'],
  ].map((u,i) => ({ id: i+1, name: u[1], abbr: u[2], _version: V }));

  const cats = ['Proteins','Produce','Dairy','Dry Goods','Beverages','Frozen','Spices & Herbs','Oils & Condiments']
    .map((n,i) => ({ id: i+1, name: n, _version: V }));
  const menuCats = ['Appetizers','Mains','Sides','Desserts','Drinks'].map((n,i) => ({ id: i+1, name: n, _version: V }));
  const recCats = ['Sauces & Bases','Proteins','Sides','Desserts'].map((n,i) => ({ id: i+1, name: n, _version: V }));
  const areas = ['Walk-in Cooler','Dry Storage','Line','Freezer'].map((n,i) => ({
    id: i+1, name: n, prep: 1, is_warehouse: 0, sections: [], assigned_to: '',
    inv_frequency: '', group_name: '', sort_order: i+1, _version: V,
  }));
  const settings = [{ id: 1, key: 'autoAddToInv', value: false }];
  const counters = [{ id: 'next_id', value: 1000 }];

  // ingredients: [id,name,catId,unit,area_id,cost,par,auto_shop]
  const ingRows = [
    [1,'Ground Beef',1,'lb',1,4.50,20,1],[2,'Chicken Breast',1,'lb',1,3.25,15,1],
    [3,'Salmon Fillet',1,'lb',1,9.00,10,1],[4,'Roma Tomatoes',2,'lb',1,1.20,15,1],
    [5,'Yellow Onion',2,'lb',2,0.80,25,1],[6,'Romaine Lettuce',2,'each',1,1.50,20,1],
    [7,'Cheddar Cheese',3,'lb',1,4.00,12,1],[8,'Butter',3,'lb',1,3.50,10,1],
    [9,'All-Purpose Flour',4,'lb',2,0.60,50,0],[10,'Brioche Buns',4,'dozen',2,5.00,8,1],
    [11,'Olive Oil',8,'liter',2,8.00,6,0],[12,'Kosher Salt',7,'lb',2,0.90,8,0],
    [13,'House Lager',5,'case',1,22.00,8,1],[14,'French Fries',6,'case',4,18.00,10,1],
  ];
  const ings = ingRows.map(r => ({
    id: r[0], name: r[1], catId: r[2], cat_id: r[2], unit: r[3], area_id: r[4],
    sub_area: '', cost: r[5], par: r[6], auto_shop: r[7], standalone: 0,
    is_menu_item: 0, menu_id: 0, vendor_id: 0, archived: 0, barcode: null,
    price_history: [], _version: V,
  }));

  // inventory: [ing_id,qty,out_of_stock] — area_id pulled from the matching ingredient.
  const invRows = [
    [1,8,0],[2,18,0],[3,4,0],[4,20,0],[5,30,0],[6,5,0],[7,12,0],
    [8,3,0],[9,60,0],[10,2,0],[11,8,0],[12,10,0],[13,0,1],[14,12,0],
  ];
  const ingById = Object.fromEntries(ings.map(i => [i.id, i]));
  const inv = invRows.map((r,i) => ({
    id: i+1, ing_id: r[0], rec_id: null, menu_id: null, unit: ingById[r[0]].unit,
    qty: r[1], area_id: ingById[r[0]].area_id, sub_area: '', out_of_stock: r[2], _version: V,
  }));

  // recipes: ings[] = {ingId,qty,unit}
  const recDefs = [
    { id:1, name:'Garlic Butter Sauce', catId:1, yield:8, yield_unit:'cup',
      notes:'Melt butter, stir in minced garlic, simmer 3 min on low.',
      ings:[{ingId:8,qty:0.25,unit:'lb'},{ingId:12,qty:0.25,unit:'tsp'}] },
    { id:2, name:'House Burger', catId:2, yield:1, yield_unit:'ea',
      notes:'Grill patty to temp, melt cheddar on top, build on a toasted brioche bun with lettuce + tomato.',
      ings:[{ingId:1,qty:0.5,unit:'lb'},{ingId:7,qty:1,unit:'oz'},{ingId:6,qty:0.1,unit:'each'},{ingId:4,qty:0.1,unit:'lb'},{ingId:10,qty:0.083,unit:'dozen'}] },
    { id:3, name:'Grilled Chicken Plate', catId:2, yield:1, yield_unit:'ea',
      notes:'Season chicken, brush with olive oil, grill ~6 min per side.',
      ings:[{ingId:2,qty:0.5,unit:'lb'},{ingId:11,qty:0.5,unit:'fl oz'},{ingId:12,qty:0.25,unit:'tsp'}] },
    { id:4, name:'House Fries', catId:3, yield:4, yield_unit:'cup',
      notes:'Fry at 350°F until golden, salt immediately.',
      ings:[{ingId:14,qty:0.15,unit:'case'},{ingId:12,qty:0.5,unit:'tsp'}] },
  ];
  const recs = recDefs.map(r => ({
    id: r.id, name: r.name, catId: r.catId, cat_id: r.catId, ings: r.ings,
    sub_recs: [], subRecs: [], yield: r.yield, yield_unit: r.yield_unit,
    notes: r.notes, shelf_life: '', shelfLife: '', photos: [], videos: [],
    menu_items: [], preps: [], is_menu_item: 0, include_in_prep: 0, includeInPrep: 0,
    manual_qty: 0, output_mode: 'auto', group: '', group_name: '', menu_id: 0,
    archived: 0, _version: V,
  }));

  // menus: recs[] = {recId,qty,unit}
  const menuDefs = [
    { id:1, name:'Classic Burger', catId:2, tgt:30, recs:[{recId:2,qty:1,unit:'ea'}] },
    { id:2, name:'Grilled Chicken Plate', catId:2, tgt:20, recs:[{recId:3,qty:1,unit:'ea'},{recId:4,qty:1,unit:'ea'}] },
    { id:3, name:'Side of Fries', catId:3, tgt:25, recs:[{recId:4,qty:1,unit:'ea'}] },
  ];
  const menus = menuDefs.map(m => ({
    id: m.id, name: m.name, catId: m.catId, cat_id: m.catId, unit_id: 1, tgt: m.tgt,
    ings: [], recs: m.recs, preps: [], include_in_prep: 0, include_in_shop: 1,
    archived: 0, _version: V,
  }));

  // prep: links to a recipe by rec_id
  const preps = [
    { id:1, name:'Garlic Butter Sauce', rec_id:1, unit:'batch', tgt:4, on_hand:2, is_menu_item:0, menu_id:0, _version:V },
    { id:2, name:'House Fries Prep',   rec_id:4, unit:'batch', tgt:6, on_hand:3, is_menu_item:0, menu_id:0, _version:V },
  ];

  return { units, cats, menuCats, recCats, areas, settings, counters, ings, inv, recs, menus, preps };
}

(async () => {
  const data = seed();
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));

  console.log('=== Apple demo account — plan ===');
  console.log('  Auth user :', DEMO_EMAIL, '(emailVerified=true)');
  console.log('  Password  :', DEMO_PASSWORD);
  console.log('  Claims    :', JSON.stringify({ tenantId: TENANT_ID, tenantSlug: TENANT_SLUG, approved: true, role: 'owner' }));
  console.log('  Tenant    : tenants/' + TENANT_ID, '| slug=' + TENANT_SLUG, '| name="' + RESTAURANT_NAME + '" | status=active | onboardingComplete=true');
  console.log('  Seed      :', JSON.stringify(counts));
  console.log('  Flag      : add "' + TENANT_ID + '" to feature_flags/upcScanner.enabledTenants');

  // Pre-flight existence checks
  let userExists = false, tenantExists = false;
  try { await auth.getUserByEmail(DEMO_EMAIL); userExists = true; } catch (e) {}
  tenantExists = (await db.collection('tenants').doc(TENANT_ID).get()).exists;
  if (userExists) console.log('  ! Auth user already exists');
  if (tenantExists) console.log('  ! tenants/' + TENANT_ID + ' already exists');

  if (!EXECUTE) {
    console.log('\nDRY RUN — nothing written. Re-run with --execute to create.');
    process.exit(0);
  }
  if (userExists || tenantExists) {
    console.error('\nABORT: demo user and/or tenant already exist. Delete them first to recreate.');
    process.exit(1);
  }

  // 1. Auth user
  const user = await auth.createUser({
    email: DEMO_EMAIL, password: DEMO_PASSWORD, emailVerified: true, displayName: DEMO_DISPLAY,
  });
  console.log('\n[1/5] Created Auth user uid=' + user.uid);

  // 2. Custom claims
  await auth.setCustomUserClaims(user.uid, { tenantId: TENANT_ID, tenantSlug: TENANT_SLUG, approved: true, role: 'owner' });
  console.log('[2/5] Stamped claims');

  // 3. Tenant doc
  let invoiceToken = crypto.randomBytes(4).toString('hex');
  for (let i = 0; i < 3; i++) {
    const tok = await db.collection('tenants').where('invoiceToken', '==', invoiceToken).limit(1).get();
    if (tok.empty) break; invoiceToken = crypto.randomBytes(4).toString('hex');
  }
  await db.collection('tenants').doc(TENANT_ID).set({
    slug: TENANT_SLUG, restaurantName: RESTAURANT_NAME, ownerEmail: DEMO_EMAIL,
    plan: 'pro', status: 'active', onboardingComplete: true, stripeCustomerId: null,
    invoiceToken, createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.collection('tenants').doc(TENANT_ID).collection('approved_emails').add({
    email: DEMO_EMAIL, role: 'owner', added_by: 'create-demo-account.js',
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('[3/5] Created tenants/' + TENANT_ID + ' + approved_emails entry');

  // 4. Seed data (batched)
  let batch = db.batch(), n = 0, total = 0;
  for (const [col, items] of Object.entries(data)) {
    for (const item of items) {
      batch.set(db.collection('tenants').doc(TENANT_ID).collection(col).doc(String(item.id)), item);
      total++;
      if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
  }
  if (n > 0) await batch.commit();
  console.log('[4/5] Seeded ' + total + ' docs across ' + Object.keys(data).length + ' collections');

  // 5. Feature flag — enable barcode scanner for demo
  const flagRef = db.collection('feature_flags').doc('upcScanner');
  const flagSnap = await flagRef.get();
  const cur = flagSnap.exists ? (flagSnap.data() || {}) : { name: 'upcScanner', defaultValue: false };
  const enabled = Array.isArray(cur.enabledTenants) ? cur.enabledTenants.map(String) : [];
  if (enabled.indexOf(TENANT_ID) === -1) enabled.push(TENANT_ID);
  await flagRef.set({ name: 'upcScanner', defaultValue: cur.defaultValue === true, enabledTenants: enabled }, { merge: true });
  console.log('[5/5] upcScanner.enabledTenants =', JSON.stringify(enabled));

  console.log('\n========================================================');
  console.log(' APPLE DEMO ACCOUNT — paste into App Store Connect:');
  console.log('   Username: ' + DEMO_EMAIL);
  console.log('   Password: ' + DEMO_PASSWORD);
  console.log('========================================================');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
