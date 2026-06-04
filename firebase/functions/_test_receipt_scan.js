'use strict';

// Receipt-scan spec tests (Margin/Receipts feature).
// Binds to the ACTUAL source in index.js: reads the file, extracts the pure
// helper bodies (sanitizeReceiptItems, isValidReceiptImageRef) and evals them in
// isolation — so this tests the live code, not a copy. Also asserts the
// permission-matrix changes directly against permissions.js.
//
// Run: node firebase/functions/_test_receipt_scan.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const perms = require('./permissions.js');

function extractFn(name) {
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

// eslint-disable-next-line no-new-func
const factory = new Function(
  extractFn('sanitizeReceiptItems') + '\n' +
  extractFn('isValidReceiptImageRef') + '\n' +
  'return { sanitizeReceiptItems, isValidReceiptImageRef };');
const { sanitizeReceiptItems, isValidReceiptImageRef } = factory();

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); failed++; }
}

console.log('sanitizeReceiptItems — typing, defaults, lineIds');
t('non-array input → []', () => assert.deepStrictEqual(sanitizeReceiptItems(null), []));
t('basic line is typed + gets lineId/defaults', () => {
  const out = sanitizeReceiptItems([{ description: 'GV ORG SPINACH 16OZ', qty: 2, unitCost: 3.49, lineTotal: 6.98 }]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].lineId, 'L1');
  assert.strictEqual(out[0].qty, 2);
  assert.strictEqual(out[0].unit, 'ea');           // default unit
  assert.strictEqual(out[0].confidence, 'medium'); // default confidence
  assert.strictEqual(out[0].applied, false);
  assert.strictEqual(out[0].assignedIngId, null);
});
t('lineIds increment across kept rows only', () => {
  const out = sanitizeReceiptItems([
    { description: 'A', qty: 1, unitCost: 1, lineTotal: 1 },
    { description: '', qty: 9, unitCost: 9, lineTotal: 9 }, // dropped (no description)
    { description: 'B', qty: 1, unitCost: 1, lineTotal: 1 },
  ]);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out.map(x => x.lineId), ['L1', 'L2']);
});

console.log('sanitizeReceiptItems — qty×unitCost vs lineTotal mismatch flag');
t('clean line → mismatch false', () => {
  const out = sanitizeReceiptItems([{ description: 'X', qty: 2, unitCost: 3, lineTotal: 6 }]);
  assert.strictEqual(out[0].mismatch, false);
});
t('digit-error line → mismatch true', () => {
  const out = sanitizeReceiptItems([{ description: 'X', qty: 2, unitCost: 3, lineTotal: 10 }]);
  assert.strictEqual(out[0].mismatch, true);
});
t('penny rounding stays within tolerance (no false positive)', () => {
  const out = sanitizeReceiptItems([{ description: 'X', qty: 3, unitCost: 1.111, lineTotal: 3.33 }]);
  assert.strictEqual(out[0].mismatch, false);
});
t('missing price fields → mismatch false (cannot judge)', () => {
  const out = sanitizeReceiptItems([{ description: 'X', qty: 2 }]);
  assert.strictEqual(out[0].mismatch, false);
});

console.log('sanitizeReceiptItems — coercion + hardening');
t('string numbers are coerced', () => {
  const out = sanitizeReceiptItems([{ description: 'X', qty: '2', unitCost: '3.5', lineTotal: '7' }]);
  assert.strictEqual(out[0].qty, 2);
  assert.strictEqual(out[0].unitCost, 3.5);
});
t('barcode is digit-stripped', () => {
  const out = sanitizeReceiptItems([{ description: 'X', qty: 1, unitCost: 1, lineTotal: 1, barcode: ' 0-12345-67890-1 ' }]);
  assert.strictEqual(out[0].barcode, '012345678901');
});
t('barcode capped at 14 digits', () => {
  const out = sanitizeReceiptItems([{ description: 'X', qty: 1, unitCost: 1, lineTotal: 1, barcode: '1234567890123456789' }]);
  assert.strictEqual(out[0].barcode, '12345678901234');
});
t('bad confidence → medium', () => {
  const out = sanitizeReceiptItems([{ description: 'X', qty: 1, unitCost: 1, lineTotal: 1, confidence: 'banana' }]);
  assert.strictEqual(out[0].confidence, 'medium');
});
t('valid confidence preserved', () => {
  const out = sanitizeReceiptItems([{ description: 'X', qty: 1, unitCost: 1, lineTotal: 1, confidence: 'low' }]);
  assert.strictEqual(out[0].confidence, 'low');
});
t('description truncated to 200 chars', () => {
  const out = sanitizeReceiptItems([{ description: 'z'.repeat(500), qty: 1, unitCost: 1, lineTotal: 1 }]);
  assert.strictEqual(out[0].description.length, 200);
});
t('non-finite numbers become 0', () => {
  const out = sanitizeReceiptItems([{ description: 'X', qty: 'abc', unitCost: NaN, lineTotal: undefined }]);
  assert.strictEqual(out[0].qty, 0);
  assert.strictEqual(out[0].unitCost, 0);
  assert.strictEqual(out[0].lineTotal, 0);
});

console.log('isValidReceiptImageRef — cross-tenant guard');
t('valid path for tenant → true', () => assert.strictEqual(isValidReceiptImageRef('tenants/lachona/receipts/abc.jpg', 'lachona'), true));
t('other tenant prefix → false', () => assert.strictEqual(isValidReceiptImageRef('tenants/other/receipts/abc.jpg', 'lachona'), false));
t('path traversal → false', () => assert.strictEqual(isValidReceiptImageRef('tenants/lachona/receipts/../../other/x.jpg', 'lachona'), false));
t('empty string → false', () => assert.strictEqual(isValidReceiptImageRef('', 'lachona'), false));
t('non-string → false', () => assert.strictEqual(isValidReceiptImageRef(null, 'lachona'), false));
t('not under receipts/ → false', () => assert.strictEqual(isValidReceiptImageRef('tenants/lachona/ings/x.jpg', 'lachona'), false));

console.log('permissions — receiptScan / receiptImageUrl / receipts collection');
t('receiptScan in ALLOWED_OPERATIONS', () => assert.ok(perms.ALLOWED_OPERATIONS.includes('receiptScan')));
t('receiptImageUrl in ALLOWED_OPERATIONS', () => assert.ok(perms.ALLOWED_OPERATIONS.includes('receiptImageUrl')));
t('both are BOOL_OPS', () => {
  assert.ok(perms.BOOL_OPS.includes('receiptScan'));
  assert.ok(perms.BOOL_OPS.includes('receiptImageUrl'));
});
t('receipts in ALLOWED_COLLECTIONS', () => assert.ok(perms.ALLOWED_COLLECTIONS.includes('receipts')));
t('owner can receiptScan', () => assert.strictEqual(perms.checkPermission('owner', 'receiptScan', null), true));
t('admin can receiptScan', () => assert.strictEqual(perms.checkPermission('admin', 'receiptScan', null), true));
t('employee can receiptScan + view image', () => {
  assert.strictEqual(perms.checkPermission('employee', 'receiptScan', null), true);
  assert.strictEqual(perms.checkPermission('employee', 'receiptImageUrl', null), true);
});
t('employee can upsert receipts (triage)', () => assert.strictEqual(perms.checkPermission('employee', 'upsert', 'receipts'), true));
t('employee still cannot upsert vendors', () => assert.strictEqual(perms.checkPermission('employee', 'upsert', 'vendors'), false));
t('unknown role cannot receiptScan', () => assert.strictEqual(perms.checkPermission('ghost', 'receiptScan', null), false));

console.log('');
console.log('Receipt scan: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
