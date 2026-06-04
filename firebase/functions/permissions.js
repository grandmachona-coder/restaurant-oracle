'use strict';

// Bistro Steward — RBAC Permission Matrix
// Extracted from index.js so unit tests can require it without booting
// firebase-admin. index.js re-exports the same constants for backward compat.

const ALLOWED_COLLECTIONS = [
  'team_members', 'areas', 'cats', 'menu_cats', 'rec_cats',
  'units', 'ings', 'inv', 'shopping', 'preps', 'recs',
  'menus', 'log', 'conversions', 'vendors', 'settings',
  'approved_emails', 'audit_log', 'counters', 'invoices', 'feedback_events',
  'ai_insight_cache', 'receipts'
];

const ALLOWED_OPERATIONS = [
  'select', 'insert', 'update', 'upsert', 'delete',
  'invite_user', 'voice', 'scan', 'upcLookup', 'upcContribute', 'reserve_ids',
  'receiptScan', 'receiptImageUrl', 'receiptImageData',
  'provisionTenant', 'deprovisionTenant', 'getTenantConfig', 'checkSlugAvailable',
  'submitFeedback',
  'get_tenant_settings', 'rotate_invoice_token', 'list_invoices',
  'ai_insight',
];

const BOOL_OPS = [
  'invite_user', 'voice', 'scan', 'upcLookup', 'upcContribute', 'reserve_ids',
  'receiptScan', 'receiptImageUrl', 'receiptImageData',
  'provisionTenant', 'deprovisionTenant', 'getTenantConfig', 'checkSlugAvailable',
  'submitFeedback',
  'get_tenant_settings', 'rotate_invoice_token', 'list_invoices',
  'ai_insight'
];

const PERMISSION_MATRIX = {
  super_admin: {
    select: '*', insert: '*', update: '*', upsert: '*', delete: '*',
    invite_user: true, voice: true, scan: true, upcLookup: true, upcContribute: true, reserve_ids: true, receiptScan: true, receiptImageUrl: true, receiptImageData: true,
    provisionTenant: true, deprovisionTenant: true,
    getTenantConfig: true, checkSlugAvailable: true,
    submitFeedback: true, get_tenant_settings: true,
    rotate_invoice_token: true, list_invoices: true, ai_insight: true,
  },
  owner: {
    select: '*', insert: '*', update: '*', upsert: '*', delete: '*',
    invite_user: true, voice: true, scan: true, upcLookup: true, upcContribute: true, reserve_ids: true, receiptScan: true, receiptImageUrl: true, receiptImageData: true,
    getTenantConfig: true, checkSlugAvailable: true,
    provisionTenant: false, deprovisionTenant: false,
    submitFeedback: true, get_tenant_settings: true,
    rotate_invoice_token: true, list_invoices: true, ai_insight: true,
  },
  admin: {
    select: '*', insert: '*', update: '*', upsert: '*', delete: '*',
    invite_user: true, voice: true, scan: true, upcLookup: true, upcContribute: true, reserve_ids: true, receiptScan: true, receiptImageUrl: true, receiptImageData: true,
    getTenantConfig: true, checkSlugAvailable: false,
    provisionTenant: false, deprovisionTenant: false,
    submitFeedback: true, get_tenant_settings: true,
    rotate_invoice_token: false, list_invoices: true, ai_insight: true,
  },
  employee: {
    select: '*',
    insert: ['inv', 'log', 'shopping', 'receipts'],
    update: ['inv', 'log', 'shopping', 'receipts'],
    upsert: ['inv', 'log', 'shopping', 'ings', 'areas', 'cats', 'menu_cats', 'rec_cats', 'units', 'recs', 'menus', 'preps', 'conversions', 'receipts'],
    delete: [],
    invite_user: false, voice: true, scan: true, upcLookup: true, upcContribute: true, reserve_ids: true, receiptScan: true, receiptImageUrl: true, receiptImageData: true,
    getTenantConfig: false, checkSlugAvailable: false,
    provisionTenant: false, deprovisionTenant: false,
    submitFeedback: true, get_tenant_settings: false,
    rotate_invoice_token: false, list_invoices: true, ai_insight: true,
  }
};

function checkPermission(role, operation, collection) {
  const rolePerms = PERMISSION_MATRIX[role];
  if (!rolePerms) return false;
  if (BOOL_OPS.includes(operation)) return rolePerms[operation] === true;
  const allowed = rolePerms[operation];
  if (!allowed) return false;
  if (allowed === '*') return true;
  if (Array.isArray(allowed)) return allowed.includes(collection);
  return false;
}

module.exports = {
  ALLOWED_COLLECTIONS,
  ALLOWED_OPERATIONS,
  BOOL_OPS,
  PERMISSION_MATRIX,
  checkPermission,
};
