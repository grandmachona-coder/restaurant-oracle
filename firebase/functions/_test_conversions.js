'use strict';

// Conversion + shopping-list spec tests.
// These mirror the pure math used by app.html (convertToStorage / convertToRecipe /
// roundQty / shoppingMultiplier) and the Python testbed (shopping_model.py).
// If either side changes, this file should be updated and both sides re-validated.
//
// Run: node firebase/functions/_test_conversions.js

const assert = require('assert');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ok ' + name); passed++; }
  catch (e) { console.log('  FAIL ' + name + ' — ' + e.message); failed++; }
}
function group(name, fn) { console.log('# ' + name); fn(); }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9); }

// ─── Pure math helpers (spec — must match app.html lines 3278/3283/4609/4620/4631) ───

// NOTE: kept in lockstep with app.html. L-1/L-6 (Phase C) added consistent
// positive-factor and non-negative-qty guards across all four entry points.
function convertToStorage(qty, conv) {
  if (!conv || !(conv.factor > 0)) return null; // L-1: reject 0/NaN/negative factor
  if (!(qty >= 0)) return null;                  // L-6: reject negative qty
  return { qty: Math.ceil(qty / conv.factor), unit: conv.storageUnit };
}
function convertToRecipe(qty, conv) {
  if (!conv || !(conv.factor > 0)) return null;
  if (!(qty >= 0)) return null;
  return { qty: qty * conv.factor, unit: conv.recipeUnit };
}
function convertToRecipeUnits(qty, fromUnit, conv) {
  if (!conv) return { qty: qty, unit: fromUnit };
  if (!(qty >= 0)) return { qty: qty, unit: fromUnit }; // L-6
  if (fromUnit === conv.storageUnit) {
    if (!(conv.factor > 0)) return { qty: qty, unit: fromUnit };
    return { qty: qty * conv.factor, unit: conv.recipeUnit };
  }
  return { qty: qty, unit: fromUnit };
}
function convertToStorageUnits(qty, fromUnit, conv) {
  if (!conv) return { qty: qty, unit: fromUnit };
  if (!(qty >= 0)) return { qty: qty, unit: fromUnit }; // L-6
  if (fromUnit === conv.recipeUnit) {
    if (!(conv.factor > 0)) return { qty: qty, unit: fromUnit };
    return { qty: qty / conv.factor, unit: conv.storageUnit };
  }
  return { qty: qty, unit: fromUnit };
}
function roundQty(qty) {
  if (typeof qty !== 'number' || isNaN(qty)) return 0;
  return Math.round(qty * 100) / 100;
}
function formatQty(qty) {
  var rounded = roundQty(qty);
  var s = rounded.toString();
  return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s;
}
function shoppingMultiplier(numShifts, consumptionRate) {
  var ns = (numShifts >= 1) ? numShifts : 1;
  var cr = (consumptionRate > 0) ? consumptionRate : 1.0;
  return ns * cr;
}

// ─── Conversions used in production (verified against testbed byte-for-byte) ───

const SUNFLOWER_OIL = { ingId: 1, storageUnit: 'L', recipeUnit: 'tbsp', factor: 67.628 }; // 1 L ≈ 67.628 tbsp
const OLIVE_OIL = { ingId: 2, storageUnit: 'L', recipeUnit: 'tbsp', factor: 67.628 };
const FLOUR = { ingId: 3, storageUnit: 'lb', recipeUnit: 'cup', factor: 3.6 }; // 1 lb flour ≈ 3.6 cups
const EGGS = { ingId: 4, storageUnit: 'doz', recipeUnit: 'ea', factor: 12 };

// ─── Tests ───

group('convertToStorage (recipe → storage, ceil)', () => {
  t('62 tbsp Sunflower Oil → 1 L (ceil)', () => {
    const r = convertToStorage(62, SUNFLOWER_OIL);
    assert.strictEqual(r.qty, 1);
    assert.strictEqual(r.unit, 'L');
  });
  t('989 tbsp Olive Oil → 15 L (ceil from 14.624)', () => {
    const r = convertToStorage(989, OLIVE_OIL);
    assert.strictEqual(r.qty, 15);
    assert.strictEqual(r.unit, 'L');
  });
  t('exactly 1 factor → 1 storage unit', () => {
    const r = convertToStorage(67.628, SUNFLOWER_OIL);
    assert.strictEqual(r.qty, 1);
  });
  t('zero qty → 0 storage', () => {
    assert.strictEqual(convertToStorage(0, SUNFLOWER_OIL).qty, 0);
  });
  t('null conversion → null', () => {
    assert.strictEqual(convertToStorage(10, null), null);
  });
  t('zero factor → null', () => {
    assert.strictEqual(convertToStorage(10, { factor: 0, storageUnit: 'L', recipeUnit: 'tbsp' }), null);
  });
  t('negative factor → null (L-1)', () => {
    assert.strictEqual(convertToStorage(10, { factor: -2, storageUnit: 'L', recipeUnit: 'tbsp' }), null);
  });
  t('NaN factor → null (L-1)', () => {
    assert.strictEqual(convertToStorage(10, { factor: NaN, storageUnit: 'L', recipeUnit: 'tbsp' }), null);
  });
  t('negative qty → null (L-6)', () => {
    assert.strictEqual(convertToStorage(-5, SUNFLOWER_OIL), null);
  });
  t('1 partial cup flour → 1 lb (ceil)', () => {
    const r = convertToStorage(1, FLOUR);
    assert.strictEqual(r.qty, 1);
  });
});

group('convertToRecipe (storage → recipe, multiply)', () => {
  t('1 L Sunflower Oil → 67.628 tbsp', () => {
    const r = convertToRecipe(1, SUNFLOWER_OIL);
    assert(near(r.qty, 67.628), 'got ' + r.qty);
    assert.strictEqual(r.unit, 'tbsp');
  });
  t('1 doz eggs → 12 ea', () => {
    const r = convertToRecipe(1, EGGS);
    assert.strictEqual(r.qty, 12);
    assert.strictEqual(r.unit, 'ea');
  });
  t('null conversion → null', () => {
    assert.strictEqual(convertToRecipe(1, null), null);
  });
});

group('convertToRecipeUnits (unit-aware passthrough)', () => {
  t('storage → recipe converts', () => {
    const r = convertToRecipeUnits(2, 'L', SUNFLOWER_OIL);
    assert(near(r.qty, 135.256));
    assert.strictEqual(r.unit, 'tbsp');
  });
  t('already recipe unit passes through', () => {
    const r = convertToRecipeUnits(50, 'tbsp', SUNFLOWER_OIL);
    assert.strictEqual(r.qty, 50);
    assert.strictEqual(r.unit, 'tbsp');
  });
  t('no conversion → passthrough', () => {
    const r = convertToRecipeUnits(5, 'ea', null);
    assert.strictEqual(r.qty, 5);
    assert.strictEqual(r.unit, 'ea');
  });
  t('negative qty → passthrough unchanged (L-6)', () => {
    const r = convertToRecipeUnits(-2, 'L', SUNFLOWER_OIL);
    assert.strictEqual(r.qty, -2);
    assert.strictEqual(r.unit, 'L');
  });
});

group('convertToStorageUnits (unit-aware passthrough + safe divide)', () => {
  t('recipe → storage divides', () => {
    const r = convertToStorageUnits(135.256, 'tbsp', SUNFLOWER_OIL);
    assert(near(r.qty, 2));
    assert.strictEqual(r.unit, 'L');
  });
  t('already storage unit passes through', () => {
    const r = convertToStorageUnits(3, 'L', SUNFLOWER_OIL);
    assert.strictEqual(r.qty, 3);
    assert.strictEqual(r.unit, 'L');
  });
  t('zero or negative factor → passthrough (no div-by-zero)', () => {
    const r = convertToStorageUnits(10, 'tbsp', { storageUnit: 'L', recipeUnit: 'tbsp', factor: 0 });
    assert.strictEqual(r.qty, 10);
    assert.strictEqual(r.unit, 'tbsp');
  });
  t('negative factor → passthrough (no negative storage) (L-1)', () => {
    const r = convertToStorageUnits(10, 'tbsp', { storageUnit: 'L', recipeUnit: 'tbsp', factor: -3 });
    assert.strictEqual(r.qty, 10);
    assert.strictEqual(r.unit, 'tbsp');
  });
  t('negative qty → passthrough unchanged (L-6)', () => {
    const r = convertToStorageUnits(-10, 'tbsp', SUNFLOWER_OIL);
    assert.strictEqual(r.qty, -10);
    assert.strictEqual(r.unit, 'tbsp');
  });
});

group('roundQty / formatQty', () => {
  t('roundQty trims to 2 decimals', () => assert.strictEqual(roundQty(1.23456), 1.23));
  t('roundQty handles NaN → 0', () => assert.strictEqual(roundQty(NaN), 0));
  t('roundQty handles non-number → 0', () => assert.strictEqual(roundQty('foo'), 0));
  t('roundQty handles undefined → 0', () => assert.strictEqual(roundQty(undefined), 0));
  t('formatQty strips trailing zeros: 1.20 → "1.2"', () => assert.strictEqual(formatQty(1.20), '1.2'));
  t('formatQty strips trailing zeros: 1.00 → "1"', () => assert.strictEqual(formatQty(1.00), '1'));
  t('formatQty preserves significant digits: 0.25', () => assert.strictEqual(formatQty(0.25), '0.25'));
  t('formatQty 0 → "0"', () => assert.strictEqual(formatQty(0), '0'));
});

group('shoppingMultiplier (numShifts × consumptionRate)', () => {
  t('1 shift × 1.0 rate = 1', () => assert.strictEqual(shoppingMultiplier(1, 1.0), 1));
  t('3 shifts × 1.5 rate = 4.5', () => assert.strictEqual(shoppingMultiplier(3, 1.5), 4.5));
  t('2 shifts × 1.0 rate = 2', () => assert.strictEqual(shoppingMultiplier(2, 1.0), 2));
  t('shifts < 1 clamped to 1', () => assert.strictEqual(shoppingMultiplier(0, 1.0), 1));
  t('negative shifts clamped to 1', () => assert.strictEqual(shoppingMultiplier(-3, 2.0), 2));
  t('zero rate clamped to 1.0', () => assert.strictEqual(shoppingMultiplier(2, 0), 2));
  t('negative rate clamped to 1.0', () => assert.strictEqual(shoppingMultiplier(2, -1), 2));
});

group('shopping-list math integration', () => {
  // Shift count 3, consumption rate 1.5 → multiplier 4.5
  // Recipe needs 62 tbsp Sunflower Oil per shift
  // Total recipe demand: 62 * 4.5 = 279 tbsp
  // Storage demand: ceil(279 / 67.628) = ceil(4.126) = 5 L
  t('3 shifts × 1.5 rate × 62 tbsp/shift Sunflower Oil → 5 L purchase', () => {
    const mult = shoppingMultiplier(3, 1.5);
    const recipeDemand = 62 * mult;
    const storage = convertToStorage(recipeDemand, SUNFLOWER_OIL);
    assert.strictEqual(mult, 4.5);
    assert.strictEqual(recipeDemand, 279);
    assert.strictEqual(storage.qty, 5);
    assert.strictEqual(storage.unit, 'L');
  });

  t('2 shifts × 1.0 × 989 tbsp Olive Oil → 30 L purchase', () => {
    const mult = shoppingMultiplier(2, 1.0);
    const total = 989 * mult; // 1978 tbsp
    const r = convertToStorage(total, OLIVE_OIL);
    assert.strictEqual(r.qty, 30); // ceil(1978/67.628) = ceil(29.249) = 30
  });

  t('on-hand subtraction: need 5 L, have 2 L → buy 3 L', () => {
    var needed = 5;
    var onHand = 2;
    var buy = Math.max(0, needed - onHand);
    assert.strictEqual(buy, 3);
  });

  t('on-hand exceeds need → buy 0', () => {
    var needed = 2;
    var onHand = 5;
    var buy = Math.max(0, needed - onHand);
    assert.strictEqual(buy, 0);
  });
});

console.log('');
console.log('Tests: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
