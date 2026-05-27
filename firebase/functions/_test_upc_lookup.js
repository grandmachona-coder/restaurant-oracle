'use strict';

// UPC / barcode lookup spec tests (Phase 1 — camera-scan inventory).
// Binds to the ACTUAL source in index.js: reads the file, extracts the pure
// helper bodies (isValidBarcode, normalizeOffProduct, normalizePaidProduct)
// and evals them in isolation — so this tests the live code, not a copy. Also
// asserts the permission matrix change directly against permissions.js.
//
// Run: node firebase/functions/_test_upc_lookup.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

function extractFn(name) {
  // Prefer an `async function NAME(` declaration so we don't strip the async
  // keyword; fall back to a plain `function NAME(`.
  let start = src.indexOf('async function ' + name + '(');
  if (start === -1) start = src.indexOf('function ' + name + '(');
  assert(start !== -1, 'could not find function ' + name + ' in index.js');
  let i = src.indexOf('{', start);
  assert(i !== -1, 'no opening brace for ' + name);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// Extract `const NAME = Object.freeze({ ... });` (or plain `= { ... }`) literal.
function extractConst(name) {
  const re = new RegExp('const ' + name + '\\s*=');
  const m = re.exec(src);
  assert(m, 'could not find const ' + name + ' in index.js');
  let i = src.indexOf('{', m.index);
  let depth = 0, end = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return 'const ' + name + ' = ' + src.slice(src.indexOf('{', m.index), end) + ';';
}

// Eval the pure helpers in a sandbox and pull them back out by name. Using
// new Function (not bare eval) so strict-mode scoping doesn't swallow the
// declarations — same approach as _test_sanitize.js.
// eslint-disable-next-line no-new-func
const factory = new Function(
  extractFn('isValidBarcode') + '\n' +
  extractFn('normalizeOffProduct') + '\n' +
  extractFn('normalizePaidProduct') + '\n' +
  'return { isValidBarcode, normalizeOffProduct, normalizePaidProduct };');
const { isValidBarcode, normalizeOffProduct, normalizePaidProduct } = factory();

// Pure cost function — needs RATE_CARD in scope.
// eslint-disable-next-line no-new-func
const costFactory = new Function(
  extractConst('RATE_CARD') + '\n' +
  extractFn('estimateCostsUsd') + '\n' +
  'return estimateCostsUsd;');
const estimateCostsUsd = costFactory();

// Cap helper — inject fake db / process / console so we can exercise the
// boundary and the fail-open path without booting firebase-admin.
// eslint-disable-next-line no-new-func
const capFactory = new Function('db', 'process', 'console',
  extractFn('underPaidLookupCap') + '\n' +
  'return underPaidLookupCap;');
function makeCap({ paidCount = 0, freeCount = 0, env = {}, throwOnGet = false } = {}) {
  const rows = [];
  for (let i = 0; i < paidCount; i++) rows.push({ paid: true });
  for (let i = 0; i < freeCount; i++) rows.push({ paid: false });
  const query = {
    where() { return this; },
    async get() {
      if (throwOnGet) throw new Error('simulated firestore read failure');
      return { forEach(cb) { rows.forEach(r => cb({ data: () => r })); } };
    },
  };
  const fakeDb = { collection: () => ({ doc: () => ({ collection: () => query }) }) };
  return capFactory(fakeDb, { env }, console);
}

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
const asyncTests = [];
function tA(name, fn) {
  asyncTests.push((async () => {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); }
  })());
}

console.log('isValidBarcode — accepts valid GTINs');
t('valid UPC-A (036000291452)', () => assert.strictEqual(isValidBarcode('036000291452'), true));
t('valid EAN-13 (4006381333931)', () => assert.strictEqual(isValidBarcode('4006381333931'), true));
t('valid EAN-8 (40170725)', () => assert.strictEqual(isValidBarcode('40170725'), true));

console.log('isValidBarcode — rejects bad input');
t('wrong check digit', () => assert.strictEqual(isValidBarcode('036000291453'), false));
t('non-digit chars', () => assert.strictEqual(isValidBarcode('12abc6789012'), false));
t('wrong length (5)', () => assert.strictEqual(isValidBarcode('12345'), false));
t('empty', () => assert.strictEqual(isValidBarcode(''), false));
t('null', () => assert.strictEqual(isValidBarcode(null), false));
t('whitespace trimmed then validated', () => assert.strictEqual(isValidBarcode('  036000291452  '), true));

console.log('normalizeOffProduct — Open Food Facts shape');
t('status 1 with name + quantity parses size/unit', () => {
  const r = normalizeOffProduct({ status: 1, product: { product_name: 'Cola', brands: 'Coca-Cola, Other', quantity: '330 ml' } }, '5449000000996');
  assert.strictEqual(r.name, 'Cola');
  assert.strictEqual(r.brand, 'Coca-Cola'); // first brand only
  assert.strictEqual(r.size, '330 ml');
  assert.strictEqual(r.unit, 'ml');
});
t('falls back to generic_name', () => {
  const r = normalizeOffProduct({ status: 1, product: { generic_name: 'Olive Oil' } }, '123');
  assert.strictEqual(r.name, 'Olive Oil');
  assert.strictEqual(r.brand, null);
});
t('multipack quantity "6 x 330 ml" → unit ml, size preserved', () => {
  const r = normalizeOffProduct({ status: 1, product: { product_name: 'Soda', quantity: '6 x 330 ml' } }, '123');
  assert.strictEqual(r.size, '6 x 330 ml');
  assert.strictEqual(r.unit, 'ml');
});
t('compound quantity "2 L net" → unit l', () => {
  const r = normalizeOffProduct({ status: 1, product: { product_name: 'Water', quantity: '2 L net' } }, '123');
  assert.strictEqual(r.unit, 'l');
});
t('no-unit quantity "12 ct" still extracts ct', () => {
  const r = normalizeOffProduct({ status: 1, product: { product_name: 'Eggs', quantity: '12 ct' } }, '123');
  assert.strictEqual(r.unit, 'ct');
});
t('unitless numeric quantity → unit null, size kept', () => {
  const r = normalizeOffProduct({ status: 1, product: { product_name: 'Thing', quantity: '500' } }, '123');
  assert.strictEqual(r.unit, null);
  assert.strictEqual(r.size, '500');
});
t('status 0 → null', () => assert.strictEqual(normalizeOffProduct({ status: 0 }, '123'), null));
t('empty name → null', () => assert.strictEqual(normalizeOffProduct({ status: 1, product: { product_name: '' } }, '123'), null));
t('missing json → null', () => assert.strictEqual(normalizeOffProduct(null, '123'), null));

console.log('normalizePaidProduct — provider shape');
t('attributes.product + company', () => {
  const r = normalizePaidProduct({ product: { attributes: { product: 'Flour 25lb', company: 'Sysco' } } }, '00012345678905');
  assert.strictEqual(r.name, 'Flour 25lb');
  assert.strictEqual(r.brand, 'Sysco');
});
t('flat name field', () => {
  const r = normalizePaidProduct({ name: 'Sugar' }, '123');
  assert.strictEqual(r.name, 'Sugar');
});
t('no usable name → null', () => assert.strictEqual(normalizePaidProduct({ product: { attributes: {} } }, '123'), null));
t('non-object → null', () => assert.strictEqual(normalizePaidProduct('nope', '123'), null));

console.log('permissions — upcLookup wired into RBAC');
const perms = require('./permissions');
t('upcLookup in ALLOWED_OPERATIONS', () => assert.ok(perms.ALLOWED_OPERATIONS.includes('upcLookup')));
t('upcLookup in BOOL_OPS', () => assert.ok(perms.BOOL_OPS.includes('upcLookup')));
t('owner can upcLookup', () => assert.strictEqual(perms.checkPermission('owner', 'upcLookup', null), true));
t('admin can upcLookup', () => assert.strictEqual(perms.checkPermission('admin', 'upcLookup', null), true));
t('employee can upcLookup', () => assert.strictEqual(perms.checkPermission('employee', 'upcLookup', null), true));
t('super_admin can upcLookup', () => assert.strictEqual(perms.checkPermission('super_admin', 'upcLookup', null), true));
t('unknown role cannot', () => assert.strictEqual(perms.checkPermission('ghost', 'upcLookup', null), false));

console.log('estimateCostsUsd — paid UPC spend rolls into the total');
const ZERO = { reads: 0, writes: 0, deletes: 0, invocations: 0, geminiInput: 0, geminiOutput: 0, emails: 0, upcPaidLookups: 0 };
t('10 paid lookups → upcLookupUsd = 0.30', () => {
  const c = estimateCostsUsd({ ...ZERO, upcPaidLookups: 10 });
  assert.ok(Math.abs(c.upcLookupUsd - 0.30) < 1e-9, 'got ' + c.upcLookupUsd);
});
t('upcLookupUsd is included in totalUsdCost', () => {
  const c = estimateCostsUsd({ ...ZERO, upcPaidLookups: 10 });
  assert.ok(Math.abs(c.totalUsdCost - 0.30) < 1e-9, 'total=' + c.totalUsdCost);
});
t('zero paid lookups → no UPC cost', () => {
  const c = estimateCostsUsd({ ...ZERO });
  assert.strictEqual(c.upcLookupUsd, 0);
});
t('missing upcPaidLookups field → 0, no NaN', () => {
  const c = estimateCostsUsd({ reads: 0, writes: 0, deletes: 0, invocations: 0, geminiInput: 0, geminiOutput: 0, emails: 0 });
  assert.strictEqual(c.upcLookupUsd, 0);
  assert.ok(!Number.isNaN(c.totalUsdCost));
});

console.log('underPaidLookupCap — runaway-spend guard');
tA('under cap (2 of default 1000) → true', async () => {
  assert.strictEqual(await makeCap({ paidCount: 2 })('t1'), true);
});
tA('only paid rows count toward cap (free rows ignored)', async () => {
  // cap=3, 2 paid + 5 free → 2 < 3 → allowed
  assert.strictEqual(await makeCap({ paidCount: 2, freeCount: 5, env: { UPC_PAID_DAILY_CAP: '3' } })('t1'), true);
});
tA('at cap exactly → false (blocks)', async () => {
  assert.strictEqual(await makeCap({ paidCount: 3, env: { UPC_PAID_DAILY_CAP: '3' } })('t1'), false);
});
tA('one below cap → true', async () => {
  assert.strictEqual(await makeCap({ paidCount: 2, env: { UPC_PAID_DAILY_CAP: '3' } })('t1'), true);
});
tA('fails OPEN on firestore read error → true', async () => {
  assert.strictEqual(await makeCap({ throwOnGet: true })('t1'), true);
});
tA('no tenantId → false (cannot scope)', async () => {
  assert.strictEqual(await makeCap({})(''), false);
});

Promise.all(asyncTests).then(() => {
  console.log('');
  console.log('UPC lookup: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
});
