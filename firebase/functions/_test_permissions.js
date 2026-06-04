'use strict';

// Permission matrix unit tests.
// Run: node firebase/functions/_test_permissions.js
// Pure module — no firebase-admin boot required.

const assert = require('assert');
const {
  ALLOWED_COLLECTIONS,
  ALLOWED_OPERATIONS,
  BOOL_OPS,
  PERMISSION_MATRIX,
  checkPermission,
} = require('./permissions');

let passed = 0;
let failed = 0;

function t(name, fn) {
  try {
    fn();
    console.log('  ok ' + name);
    passed++;
  } catch (e) {
    console.log('  FAIL ' + name + ' — ' + e.message);
    failed++;
  }
}

function group(name, fn) {
  console.log('# ' + name);
  fn();
}

// ─── Module shape ───
group('module exports', () => {
  t('ALLOWED_COLLECTIONS is array', () => assert(Array.isArray(ALLOWED_COLLECTIONS)));
  t('ALLOWED_OPERATIONS is array', () => assert(Array.isArray(ALLOWED_OPERATIONS)));
  t('BOOL_OPS is array', () => assert(Array.isArray(BOOL_OPS)));
  t('PERMISSION_MATRIX has expected roles', () => {
    assert(PERMISSION_MATRIX.super_admin);
    assert(PERMISSION_MATRIX.owner);
    assert(PERMISSION_MATRIX.employee);
  });
  t('checkPermission is function', () => assert.strictEqual(typeof checkPermission, 'function'));
});

// ─── super_admin ───
group('super_admin', () => {
  t('can select all collections', () => {
    for (const c of ALLOWED_COLLECTIONS) {
      assert.strictEqual(checkPermission('super_admin', 'select', c), true, 'select ' + c);
    }
  });
  t('can insert/update/upsert/delete on every collection', () => {
    for (const c of ALLOWED_COLLECTIONS) {
      for (const op of ['insert', 'update', 'upsert', 'delete']) {
        assert.strictEqual(checkPermission('super_admin', op, c), true, op + ' ' + c);
      }
    }
  });
  t('all bool ops true', () => {
    for (const op of BOOL_OPS) {
      assert.strictEqual(checkPermission('super_admin', op, null), true, op);
    }
  });
});

// ─── owner ───
group('owner', () => {
  t('can CRUD all collections', () => {
    for (const c of ALLOWED_COLLECTIONS) {
      for (const op of ['select', 'insert', 'update', 'upsert', 'delete']) {
        assert.strictEqual(checkPermission('owner', op, c), true, op + ' ' + c);
      }
    }
  });
  t('cannot provisionTenant or deprovisionTenant', () => {
    assert.strictEqual(checkPermission('owner', 'provisionTenant', null), false);
    assert.strictEqual(checkPermission('owner', 'deprovisionTenant', null), false);
  });
  t('can invite_user, voice, scan, reserve_ids', () => {
    assert.strictEqual(checkPermission('owner', 'invite_user', null), true);
    assert.strictEqual(checkPermission('owner', 'voice', null), true);
    assert.strictEqual(checkPermission('owner', 'scan', null), true);
    assert.strictEqual(checkPermission('owner', 'reserve_ids', null), true);
  });
  t('can rotate_invoice_token, list_invoices, get_tenant_settings, ai_insight', () => {
    assert.strictEqual(checkPermission('owner', 'rotate_invoice_token', null), true);
    assert.strictEqual(checkPermission('owner', 'list_invoices', null), true);
    assert.strictEqual(checkPermission('owner', 'get_tenant_settings', null), true);
    assert.strictEqual(checkPermission('owner', 'ai_insight', null), true);
  });
});

// ─── admin ───
group('admin', () => {
  t('can CRUD all collections', () => {
    for (const c of ALLOWED_COLLECTIONS) {
      for (const op of ['select', 'insert', 'update', 'upsert', 'delete']) {
        assert.strictEqual(checkPermission('admin', op, c), true, op + ' ' + c);
      }
    }
  });
  t('cannot provisionTenant or deprovisionTenant', () => {
    assert.strictEqual(checkPermission('admin', 'provisionTenant', null), false);
    assert.strictEqual(checkPermission('admin', 'deprovisionTenant', null), false);
  });
  t('cannot rotate_invoice_token or checkSlugAvailable', () => {
    assert.strictEqual(checkPermission('admin', 'rotate_invoice_token', null), false);
    assert.strictEqual(checkPermission('admin', 'checkSlugAvailable', null), false);
  });
  t('can invite_user, voice, scan, reserve_ids, getTenantConfig', () => {
    assert.strictEqual(checkPermission('admin', 'invite_user', null), true);
    assert.strictEqual(checkPermission('admin', 'voice', null), true);
    assert.strictEqual(checkPermission('admin', 'scan', null), true);
    assert.strictEqual(checkPermission('admin', 'reserve_ids', null), true);
    assert.strictEqual(checkPermission('admin', 'getTenantConfig', null), true);
  });
  t('can list_invoices, get_tenant_settings, ai_insight', () => {
    assert.strictEqual(checkPermission('admin', 'list_invoices', null), true);
    assert.strictEqual(checkPermission('admin', 'get_tenant_settings', null), true);
    assert.strictEqual(checkPermission('admin', 'ai_insight', null), true);
  });
});

// ─── employee ───
group('employee', () => {
  t('can select any collection', () => {
    for (const c of ALLOWED_COLLECTIONS) {
      assert.strictEqual(checkPermission('employee', 'select', c), true, 'select ' + c);
    }
  });
  t('insert restricted to inv/log/shopping + receipts', () => {
    const allowed = ['inv', 'log', 'shopping', 'receipts'];
    for (const c of ALLOWED_COLLECTIONS) {
      const expect = allowed.includes(c);
      assert.strictEqual(checkPermission('employee', 'insert', c), expect, 'insert ' + c);
    }
  });
  t('update restricted to inv/log/shopping + receipts', () => {
    const allowed = ['inv', 'log', 'shopping', 'receipts'];
    for (const c of ALLOWED_COLLECTIONS) {
      const expect = allowed.includes(c);
      assert.strictEqual(checkPermission('employee', 'update', c), expect, 'update ' + c);
    }
  });
  t('upsert allowed for catalog edits but not vendors/menus_full/etc', () => {
    const allowed = ['inv', 'log', 'shopping', 'ings', 'areas', 'cats', 'menu_cats', 'rec_cats', 'units', 'recs', 'menus', 'preps', 'conversions', 'receipts'];
    for (const c of ALLOWED_COLLECTIONS) {
      const expect = allowed.includes(c);
      assert.strictEqual(checkPermission('employee', 'upsert', c), expect, 'upsert ' + c);
    }
  });
  t('delete forbidden everywhere', () => {
    for (const c of ALLOWED_COLLECTIONS) {
      assert.strictEqual(checkPermission('employee', 'delete', c), false, 'delete ' + c);
    }
  });
  t('cannot invite_user, provisionTenant, deprovisionTenant, getTenantConfig, rotate_invoice_token, get_tenant_settings, checkSlugAvailable', () => {
    assert.strictEqual(checkPermission('employee', 'invite_user', null), false);
    assert.strictEqual(checkPermission('employee', 'provisionTenant', null), false);
    assert.strictEqual(checkPermission('employee', 'deprovisionTenant', null), false);
    assert.strictEqual(checkPermission('employee', 'getTenantConfig', null), false);
    assert.strictEqual(checkPermission('employee', 'rotate_invoice_token', null), false);
    assert.strictEqual(checkPermission('employee', 'get_tenant_settings', null), false);
    assert.strictEqual(checkPermission('employee', 'checkSlugAvailable', null), false);
  });
  t('can voice, scan, reserve_ids, submitFeedback, list_invoices, ai_insight', () => {
    assert.strictEqual(checkPermission('employee', 'voice', null), true);
    assert.strictEqual(checkPermission('employee', 'scan', null), true);
    assert.strictEqual(checkPermission('employee', 'reserve_ids', null), true);
    assert.strictEqual(checkPermission('employee', 'submitFeedback', null), true);
    assert.strictEqual(checkPermission('employee', 'list_invoices', null), true);
    assert.strictEqual(checkPermission('employee', 'ai_insight', null), true);
  });
});

// ─── unknown / malformed inputs ───
group('unknown role / malformed', () => {
  t('unknown role returns false', () => {
    assert.strictEqual(checkPermission('hacker', 'select', 'ings'), false);
    assert.strictEqual(checkPermission(null, 'select', 'ings'), false);
    assert.strictEqual(checkPermission(undefined, 'select', 'ings'), false);
    assert.strictEqual(checkPermission('', 'select', 'ings'), false);
  });
  t('unknown collection blocks employee CRUD', () => {
    assert.strictEqual(checkPermission('employee', 'insert', 'banking'), false);
    assert.strictEqual(checkPermission('employee', 'update', 'banking'), false);
    assert.strictEqual(checkPermission('employee', 'upsert', 'banking'), false);
  });
  t('unknown operation returns false for restricted role', () => {
    assert.strictEqual(checkPermission('employee', 'truncate', 'inv'), false);
    assert.strictEqual(checkPermission('owner', 'rm_rf', 'inv'), false);
  });
});

// ─── matrix integrity ───
group('matrix integrity', () => {
  t('every BOOL_OP appears in ALLOWED_OPERATIONS', () => {
    for (const op of BOOL_OPS) {
      assert(ALLOWED_OPERATIONS.includes(op), op + ' missing from ALLOWED_OPERATIONS');
    }
  });
  t('every role is a non-empty object', () => {
    for (const role of Object.keys(PERMISSION_MATRIX)) {
      const r = PERMISSION_MATRIX[role];
      assert(r && typeof r === 'object', role + ' is not an object');
      assert(Object.keys(r).length > 0, role + ' has no permissions');
    }
  });
  t('owner cannot escalate to provisionTenant via array trick', () => {
    assert.strictEqual(checkPermission('owner', 'provisionTenant', '*'), false);
  });
});

console.log('');
console.log('Tests: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
