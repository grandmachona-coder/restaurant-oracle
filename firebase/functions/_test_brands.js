'use strict';

// Brand-resolution spec tests (recipe-line brand picker + cost propagation).
// Binds to the ACTUAL pure helpers in public/app.html (getDefaultBrandSize,
// _normBrands, formatQty, roundQty): extracts the live function bodies and
// evals them in isolation — tests the real code, not a copy.
//
// Run: node firebase/functions/_test_brands.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');

function extractFn(name) {
  let start = src.indexOf('function ' + name + '(');
  assert(start !== -1, 'could not find function ' + name + ' in app.html');
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// eslint-disable-next-line no-new-func
const factory = new Function(
  ['roundQty', 'formatQty', '_normBrands', 'getDefaultBrandSize'].map(extractFn).join('\n') +
  '\nreturn { _normBrands: _normBrands, getDefaultBrandSize: getDefaultBrandSize };');
const { _normBrands, getDefaultBrandSize } = factory();

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); failed++; }
}

console.log('_normBrands — legacy flat brand → brand.sizes[] migration');
t('non-array → []', () => assert.deepStrictEqual(_normBrands(null), []));
t('legacy flat brand gets wrapped into a default size', () => {
  const out = _normBrands([{ id: 1, name: 'General Mills', barcode: '0123', size: 18, unit: 'oz', cost: 4.2, isDefault: 1 }]);
  assert.strictEqual(out.length, 1);
  assert.ok(Array.isArray(out[0].sizes));
  assert.strictEqual(out[0].sizes[0].barcode, '0123');
  assert.strictEqual(out[0].sizes[0].size, 18);
  assert.strictEqual(out[0].sizes[0].cost, 4.2);
  assert.strictEqual(out[0].sizes[0].isDefault, 1);
});
t('modern brand (already has sizes[]) passes through unchanged', () => {
  const modern = { id: 2, name: 'Kirkland', vendorId: 5, isDefault: 0, sizes: [{ id: 1, size: 32, unit: 'oz', barcode: '9', cost: 6, isDefault: 1 }] };
  const out = _normBrands([modern]);
  assert.strictEqual(out[0], modern);
});

console.log('getDefaultBrandSize — resolution chain (line brandId → isDefault → first)');
const ING = {
  id: 10, defUnit: 'oz', cost: 0.5,
  brands: [
    { id: 1, name: 'General Mills', isDefault: 0, sizes: [{ id: 1, size: 18, unit: 'oz', cost: 4.50, isDefault: 1 }] },
    { id: 2, name: 'Store Brand', isDefault: 1, sizes: [{ id: 1, size: 18, unit: 'oz', cost: 2.70, isDefault: 0 }, { id: 2, size: 36, unit: 'oz', cost: 4.80, isDefault: 1 }] },
    { id: 3, name: 'No Sizes Brand', isDefault: 0, sizes: [] },
  ],
};
t('null ing → null', () => assert.strictEqual(getDefaultBrandSize(null), null));
t('no brands → null (falls back to legacy ing.cost upstream)', () => assert.strictEqual(getDefaultBrandSize({ brands: [] }), null));
t('explicit brandId → that brand', () => assert.strictEqual(getDefaultBrandSize(ING, 1).brandId, 1));
t('brandId 0 (★ default) → isDefault brand', () => assert.strictEqual(getDefaultBrandSize(ING, 0).brandId, 2));
t('no brandId → isDefault brand', () => assert.strictEqual(getDefaultBrandSize(ING).brandId, 2));
t('unknown brandId → falls back to isDefault brand', () => assert.strictEqual(getDefaultBrandSize(ING, 99).brandId, 2));
t('no isDefault flag anywhere → first brand', () => {
  const ing2 = { brands: [{ id: 7, name: 'A', sizes: [] }, { id: 8, name: 'B', sizes: [] }] };
  assert.strictEqual(getDefaultBrandSize(ing2).brandId, 7);
});
t('default size chosen (isDefault size beats first)', () => {
  const r = getDefaultBrandSize(ING, 2);
  assert.strictEqual(r.sizeId, 2);
  assert.strictEqual(r.cost, 4.80);
  assert.strictEqual(r.unit, 'oz');
});
t('brand with no sizes → size null, cost 0', () => {
  const r = getDefaultBrandSize(ING, 3);
  assert.strictEqual(r.size, null);
  assert.strictEqual(r.cost, 0);
});
t('label includes brand + size', () => assert.ok(getDefaultBrandSize(ING, 1).label.indexOf('General Mills') === 0));

console.log('cost-propagation semantics (what calcLineIngCost computes from the resolution)');
t('per-defUnit cost = size.cost / size.size (recipe-line brand 1: 4.50/18oz = 0.25)', () => {
  const r = getDefaultBrandSize(ING, 1);
  assert.ok(Math.abs(r.cost / r.size.size - 0.25) < 1e-9);
});
t('default brand prices cheaper (store brand 36oz: 4.80/36 ≈ 0.1333)', () => {
  const r = getDefaultBrandSize(ING, 0);
  assert.ok(Math.abs(r.cost / r.size.size - 0.13333333) < 1e-6);
});

console.log('');
console.log('Brands: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
