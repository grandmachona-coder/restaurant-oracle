'use strict';

// QuickBooks-export spec tests (Margin/Receipts).
// Binds to the ACTUAL pure helpers in public/app.html: reads the file, extracts
// the function bodies and evals them in isolation — so this tests the live code.
//
// Run: node firebase/functions/_test_quickbooks_export.js

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
  ['cogsAccountForCategory', '_csvCell', '_qbDate', '_receiptImageFilename',
   'receiptsToPurchaseRows', 'purchaseRowsToCsv', 'receiptsToBankCsv']
    .map(extractFn).join('\n') + '\n' +
  'return { cogsAccountForCategory, _csvCell, _qbDate, _receiptImageFilename, receiptsToPurchaseRows, purchaseRowsToCsv, receiptsToBankCsv };');
const H = factory();

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); failed++; }
}

console.log('cogsAccountForCategory — standard restaurant COGS scheme');
t('produce → Food', () => assert.strictEqual(H.cogsAccountForCategory('Produce'), '5010 Food Purchases'));
t('meat → Food', () => assert.strictEqual(H.cogsAccountForCategory('Meat & Poultry'), '5010 Food Purchases'));
t('dairy → Food', () => assert.strictEqual(H.cogsAccountForCategory('Dairy'), '5010 Food Purchases'));
t('beer → Beer/Wine/Liquor', () => assert.strictEqual(H.cogsAccountForCategory('Beer'), '5020 Beer, Wine & Liquor'));
t('wine → Beer/Wine/Liquor', () => assert.strictEqual(H.cogsAccountForCategory('Wine & Spirits'), '5020 Beer, Wine & Liquor'));
t('liquor → Beer/Wine/Liquor', () => assert.strictEqual(H.cogsAccountForCategory('Liquor'), '5020 Beer, Wine & Liquor'));
t('coffee → N-A Beverages', () => assert.strictEqual(H.cogsAccountForCategory('Coffee & Tea'), '5030 Non-Alcoholic Beverages'));
t('soda → N-A Beverages', () => assert.strictEqual(H.cogsAccountForCategory('Soda'), '5030 Non-Alcoholic Beverages'));
t('paper → Paper & Packaging', () => assert.strictEqual(H.cogsAccountForCategory('Paper Goods'), '5040 Paper & Packaging'));
t('to-go containers → Paper & Packaging', () => assert.strictEqual(H.cogsAccountForCategory('To-Go Containers'), '5040 Paper & Packaging'));
t('empty → Food default', () => assert.strictEqual(H.cogsAccountForCategory(''), '5010 Food Purchases'));
t('unknown → Food default', () => assert.strictEqual(H.cogsAccountForCategory('Miscellaneous'), '5010 Food Purchases'));

console.log('_csvCell — escaping');
t('plain passthrough', () => assert.strictEqual(H._csvCell('Romaine'), 'Romaine'));
t('comma → quoted', () => assert.strictEqual(H._csvCell('Sysco, Inc'), '"Sysco, Inc"'));
t('quote → doubled + quoted', () => assert.strictEqual(H._csvCell('6" pan'), '"6"" pan"'));
t('embedded double-quote', () => assert.strictEqual(H._csvCell('a"b,c'), '"a""b,c"'));
t('newline → quoted', () => assert.strictEqual(H._csvCell('a\nb'), '"a\nb"'));
t('null → empty', () => assert.strictEqual(H._csvCell(null), ''));

console.log('_qbDate / _receiptImageFilename');
t('ISO date → MM/DD/YYYY', () => assert.strictEqual(H._qbDate('2026-05-01'), '05/01/2026'));
t('invalid date → MM/DD/YYYY shape', () => assert.ok(/^\d{2}\/\d{2}\/\d{4}$/.test(H._qbDate('not-a-date'))));
t('image filename from date+id', () => assert.strictEqual(H._receiptImageFilename({ receiptDate: '2026-05-01', id: 'r1' }), '05-01-2026_r1.jpg'));

console.log('receiptsToPurchaseRows — flatten + categorize + amount');
const ingsById = { 10: { id: 10, catId: 1 }, 11: { id: 11, catId: 2 } };
const catsById = { 1: { id: 1, name: 'Produce' }, 2: { id: 2, name: 'Beer & Wine' } };
const vendorsById = { 5: { id: 5, name: 'Sysco, Inc' } };
const receipt = {
  id: 'r1', vendorId: 5, receiptDate: '2026-05-01', imageRef: 'tenants/x/receipts/r1.jpg',
  items: [
    { lineId: 'L1', description: 'Romaine', qty: 2, unit: 'case', unitCost: 18.5, lineTotal: 37, assignedIngId: 10 },
    { lineId: 'L2', description: 'IPA keg', qty: 1, unit: 'keg', unitCost: 120, lineTotal: 0, assignedIngId: 11 },
    { lineId: 'L3', description: 'Mystery item', qty: 3, unit: 'ea', unitCost: 2, lineTotal: 6, assignedIngId: null },
  ],
};
const rows = H.receiptsToPurchaseRows([receipt], ingsById, catsById, vendorsById);
t('one row per line', () => assert.strictEqual(rows.length, 3));
t('vendor + date resolved', () => { assert.strictEqual(rows[0].vendor, 'Sysco, Inc'); assert.strictEqual(rows[0].date, '05/01/2026'); });
t('food account from produce', () => assert.strictEqual(rows[0].account, '5010 Food Purchases'));
t('amount from lineTotal', () => assert.strictEqual(rows[0].amount, 37));
t('image path set when imageRef present', () => assert.strictEqual(rows[0].image, 'receipts/05-01-2026_r1.jpg'));
t('beer account from category', () => assert.strictEqual(rows[1].account, '5020 Beer, Wine & Liquor'));
t('amount falls back to qty×unitCost when lineTotal 0', () => assert.strictEqual(rows[1].amount, 120));
t('unassigned line → Food default + empty category', () => { assert.strictEqual(rows[2].category, ''); assert.strictEqual(rows[2].account, '5010 Food Purchases'); });

console.log('purchaseRowsToCsv — header + escaping');
const csv = H.purchaseRowsToCsv(rows);
t('header row present', () => assert.ok(csv.split('\n')[0].startsWith('Date,Vendor,Account,Description')));
t('row count = lines + header', () => assert.strictEqual(csv.split('\n').length, 4));
t('vendor with comma is quoted', () => assert.ok(csv.indexOf('"Sysco, Inc"') !== -1));

console.log('receiptsToBankCsv — QBO 3-column, spend negative');
const bank = H.receiptsToBankCsv([{ id: 'r1', vendorId: 5, receiptDate: '2026-05-01', total: 163 }], vendorsById);
t('bank header', () => assert.strictEqual(bank.split('\n')[0], 'Date,Description,Amount'));
t('spend is negative', () => assert.ok(/-163\.00$/.test(bank.split('\n')[1])));

console.log('');
console.log('QuickBooks export: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
