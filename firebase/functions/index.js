/**
 * SECURE API CLOUD FUNCTION (1st Gen)
 * Restaurant Oracle - Firebase Backend
 * v2.0 - Security Overhaul
 *
 * Security features:
 * - CORS restricted to known origins
 * - Server-side role enforcement (owner vs employee permissions)
 * - Email whitelist (approved_emails collection)
 * - Audit logging of all mutations
 * - Input validation and sanitization
 * - Rate limiting per user
 * - Security headers on all responses
 * - Max instances to prevent billing attacks
 * - Content-Type validation
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Sentry = require('@sentry/node');
const square = require('./square');
const emails = require('./emails');
const invoices = require('./invoices');
// NOTE: agents is required AFTER admin.initializeApp(), below.

// ════════════════════════════════════════════════════════════════════════════
//  SENTRY — error monitoring (DSN via SENTRY_DSN secret; no-op if unset)
// ════════════════════════════════════════════════════════════════════════════
// Release token '%GIT_SHA%' is rewritten by firebase/deploy.sh at deploy time.
Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  environment: process.env.FUNCTIONS_EMULATOR ? 'development' : 'production',
  release: 'restaurant-oracle@%GIT_SHA%',
  tracesSampleRate: 0.1,
  beforeSend(event) {
    try {
      // Scrub request body — may contain password, cardNonce, verificationToken,
      // base64 scan images, tenant PII. Never ship raw.
      if (event.request && event.request.data !== undefined) {
        let data = event.request.data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch (_) { data = { _raw: '[REDACTED]' }; }
        }
        if (data && typeof data === 'object') {
          const drop = ['password','newPassword','confirmPassword','cardNonce','cvv',
                        'verificationToken','token','idToken','access_token','refresh_token',
                        'images','image','imageBase64','scanImage','rawBody'];
          drop.forEach(k => { if (k in data) data[k] = '[REDACTED]'; });
        }
        event.request.data = data;
      }
      // Scrub auth/cookie headers.
      if (event.request && event.request.headers) {
        const h = event.request.headers;
        ['authorization','Authorization','cookie','Cookie'].forEach(k => {
          if (k in h) h[k] = '[REDACTED]';
        });
      }
      // Drop extra blobs we attach for debugging — tenant rows, claims, etc.
      if (event.extra) {
        ['data','body','rows','claims','payload','bodyText'].forEach(k => {
          if (k in event.extra) delete event.extra[k];
        });
      }
    } catch (_) { /* never block reporting on scrub failure */ }
    return event;
  },
});

/**
 * Report an exception with per-request scope (tenantId / op / handler tags).
 * Safe to call from any HTTPS handler catch block — never throws.
 * Email / body data are intentionally NOT tagged (PII) — they get scrubbed in beforeSend.
 */
function captureError(error, req, handler) {
  try {
    Sentry.withScope(scope => {
      scope.setTag('handler', handler);
      const body = (req && req.body) ? req.body : {};
      const op = body.operation || body.op;
      if (op)                scope.setTag('op', String(op));
      if (body.table)        scope.setTag('table', String(body.table));
      if (body.tenantSlug)   scope.setTag('tenantSlug', String(body.tenantSlug));
      if (req && req.method) scope.setTag('method', req.method);
      Sentry.captureException(error);
    });
  } catch (_) { /* never throw from capture path */ }
}

// CORS restricted to known origins only (1.1)
const ALLOWED_ORIGINS = [
  'https://restaurant-oracle.web.app',
  'https://restaurant-oracle.firebaseapp.com',
  'http://localhost:5000',
  'http://localhost:5002',
  'https://lachona-dashboard.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  'https://restaurantoracle.app',
  'https://admin.restaurantoracle.app',
];

// Allow any tenant subdomain of restaurantoracle.app
function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.restaurantoracle\.app$/.test(origin)) return true;
  return false;
}

const cors = require('cors')({
  origin: function (origin, callback) {
    // Reject requests with no origin (prevents null-origin bypass via sandboxed iframes)
    if (!origin) return callback(new Error('CORS: Origin required'), false);
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error('CORS: Origin not allowed'), false);
  }
});

admin.initializeApp({
  projectId: 'restaurant-oracle'
});
const db = admin.firestore();
const auth = admin.auth();

// Require agents after admin is initialized (agents.js defers admin usage)
const agents = require('./agents');

// Rate limiting (in-memory per instance)
const rateLimitMap = new Map();
const RATE_LIMIT = { maxRequests: 100, windowMs: 60000 };

// Allowed collections (whitelist) - all now accessed via tenant namespace
const ALLOWED_COLLECTIONS = [
  'team_members', 'areas', 'cats', 'menu_cats', 'rec_cats',
  'units', 'ings', 'inv', 'shopping', 'preps', 'recs',
  'menus', 'log', 'conversions', 'vendors', 'settings',
  'approved_emails', 'audit_log', 'counters', 'invoices', 'feedback_events',
  'ai_insight_cache'
];

// Allowed operations
const ALLOWED_OPERATIONS = [
  'select', 'insert', 'update', 'upsert', 'delete',
  'invite_user', 'voice', 'scan', 'reserve_ids',
  'provisionTenant', 'deprovisionTenant', 'getTenantConfig', 'checkSlugAvailable',
  'submitFeedback',
  'get_tenant_settings', 'rotate_invoice_token', 'list_invoices',
  'ai_insight',
];

// ==================== ROLE-BASED PERMISSION MATRIX (1.2) ====================
// Defines which roles can perform which operations on which collections
const PERMISSION_MATRIX = {
  // Super-admin: platform operator only (you), can provision/deprovision tenants
  super_admin: {
    select: '*',
    insert: '*',
    update: '*',
    upsert: '*',
    delete: '*',
    invite_user: true,
    voice: true,
    scan: true,
    reserve_ids: true,
    provisionTenant: true,
    deprovisionTenant: true,
    getTenantConfig: true,
    checkSlugAvailable: true,
    submitFeedback: true,
    get_tenant_settings: true,
    rotate_invoice_token: true,
    list_invoices: true,
    ai_insight: true,
  },
  // Owner can do everything within their tenant
  owner: {
    select: '*',
    insert: '*',
    update: '*',
    upsert: '*',
    delete: '*',
    invite_user: true,
    voice: true,
    scan: true,
    reserve_ids: true,
    getTenantConfig: true,
    checkSlugAvailable: true,
    provisionTenant: false,
    deprovisionTenant: false,
    submitFeedback: true,
    get_tenant_settings: true,
    rotate_invoice_token: true,
    list_invoices: true,
    ai_insight: true,
  },
  // Employee has restricted access
  employee: {
    select: '*',
    insert: ['inv', 'log', 'shopping'],
    update: ['inv', 'log', 'shopping'],
    upsert: ['inv', 'log', 'shopping', 'ings', 'areas', 'cats', 'menu_cats', 'rec_cats', 'units', 'recs', 'menus', 'preps', 'conversions'],
    delete: [],
    invite_user: false,
    voice: true,
    scan: true,
    reserve_ids: true,
    getTenantConfig: false,
    checkSlugAvailable: false,
    provisionTenant: false,
    deprovisionTenant: false,
    submitFeedback: true,
    get_tenant_settings: false,
    rotate_invoice_token: false,
    list_invoices: true,
    ai_insight: true,
  }
};

function checkPermission(role, operation, collection) {
  const rolePerms = PERMISSION_MATRIX[role];
  if (!rolePerms) return false;

  // Boolean special operations
  const boolOps = ['invite_user', 'voice', 'scan', 'reserve_ids',
                   'provisionTenant', 'deprovisionTenant', 'getTenantConfig', 'checkSlugAvailable',
                   'submitFeedback',
                   'get_tenant_settings', 'rotate_invoice_token', 'list_invoices',
                   'ai_insight'];
  if (boolOps.includes(operation)) return rolePerms[operation] === true;

  const allowed = rolePerms[operation];
  if (!allowed) return false;
  if (allowed === '*') return true;
  if (Array.isArray(allowed)) return allowed.includes(collection);
  return false;
}

// ── Tenant-namespaced collection reference ──────────────────────────────────
// All kitchen data lives at /tenants/{tenantId}/{collectionName}
function tenantCol(tenantId, collectionName) {
  if (!tenantId) throw new Error('tenantId required');
  return db.collection('tenants').doc(tenantId).collection(collectionName);
}

// ── Slug → kebab-case converter ──────────────────────────────────────────────
function toSlug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
}

// ── Plan catalog ─────────────────────────────────────────────────────────────
// Canonical plan definitions. Square plan variation IDs are injected at runtime
// via Secret Manager (SQUARE_PLAN_VAR_{STARTER,PRO,SCALE}).
const PLAN_CATALOG = {
  starter: { priceCents: 2900, name: 'Starter', envKey: 'SQUARE_PLAN_VAR_STARTER' },
  pro:     { priceCents: 4900, name: 'Pro',     envKey: 'SQUARE_PLAN_VAR_PRO' },
  scale:   { priceCents: 9900, name: 'Scale',   envKey: 'SQUARE_PLAN_VAR_SCALE' },
};

function getPlanVariationId(planSlug) {
  const entry = PLAN_CATALOG[planSlug];
  if (!entry) throw new Error(`Unknown plan: ${planSlug}`);
  const variationId = process.env[entry.envKey];
  if (!variationId) throw new Error(`${entry.envKey} not configured`);
  return variationId;
}

// ── Default seed data for a new tenant ──────────────────────────────────────
function getDefaultSeedData() {
  return {
    units: [
      { id: 1, name: 'kg' }, { id: 2, name: 'g' }, { id: 3, name: 'lb' },
      { id: 4, name: 'oz' }, { id: 5, name: 'liter' }, { id: 6, name: 'ml' },
      { id: 7, name: 'each' }, { id: 8, name: 'dozen' }, { id: 9, name: 'case' },
      { id: 10, name: 'cup' }, { id: 11, name: 'tbsp' }, { id: 12, name: 'tsp' },
    ],
    cats: [
      { id: 1, name: 'Proteins' }, { id: 2, name: 'Produce' }, { id: 3, name: 'Dairy' },
      { id: 4, name: 'Dry Goods' }, { id: 5, name: 'Beverages' }, { id: 6, name: 'Frozen' },
      { id: 7, name: 'Spices & Herbs' }, { id: 8, name: 'Oils & Condiments' },
    ],
    menuCats: [
      { id: 1, name: 'Appetizers' }, { id: 2, name: 'Mains' }, { id: 3, name: 'Sides' },
      { id: 4, name: 'Desserts' }, { id: 5, name: 'Drinks' },
    ],
    recCats: [
      { id: 1, name: 'Sauces & Bases' }, { id: 2, name: 'Proteins' },
      { id: 3, name: 'Sides' }, { id: 4, name: 'Desserts' },
    ],
    areas: [
      { id: 1, name: 'Walk-in Cooler' }, { id: 2, name: 'Dry Storage' },
      { id: 3, name: 'Line' }, { id: 4, name: 'Freezer' },
    ],
    settings: [
      { id: 1, key: 'autoAddToInv', value: false },
    ],
    counters: [
      { id: 'next_id', value: 1000 },
    ],
  };
}

// ==================== INPUT VALIDATION (1.11) ====================
const MAX_PAYLOAD_SIZE = 1000000; // 1MB
const MAX_SCAN_PAYLOAD_SIZE = 2000000; // 2MB for scan operations (base64 image)
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_LENGTH = 1000;
const MAX_DELETE_BATCH = 100;

function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  // Strip HTML tags
  return str.replace(/<[^>]*>/g, '').substring(0, MAX_STRING_LENGTH);
}

function validateData(data, maxSize) {
  if (data === null || data === undefined) return { valid: true };

  const limit = maxSize || MAX_PAYLOAD_SIZE;
  const jsonStr = JSON.stringify(data);
  if (jsonStr.length > limit) {
    return { valid: false, error: 'Payload too large' };
  }

  // Validate arrays aren't too large
  if (Array.isArray(data) && data.length > MAX_ARRAY_LENGTH) {
    return { valid: false, error: 'Array too large (max ' + MAX_ARRAY_LENGTH + ' items)' };
  }

  return { valid: true };
}

function sanitizeRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const sanitized = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item =>
        typeof item === 'object' && item !== null ? sanitizeRecord(item) : item
      );
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeRecord(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ==================== RATE LIMITING ====================
function checkRateLimit(userId) {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId);
  if (!userLimit || now > userLimit.resetTime) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + RATE_LIMIT.windowMs });
    return { allowed: true, remaining: RATE_LIMIT.maxRequests - 1 };
  }
  if (userLimit.count >= RATE_LIMIT.maxRequests) {
    return { allowed: false, remaining: 0 };
  }
  userLimit.count++;
  return { allowed: true, remaining: RATE_LIMIT.maxRequests - userLimit.count };
}

// ==================== AUDIT LOGGING (1.7) ====================
// Writes to /tenants/{tenantId}/audit_log when tenant is known (normal case).
// Falls back to ROOT /audit_log for pre-tenant-resolution events only
// (auth_failure, tenant_not_found) — these can't be tenant-scoped because the
// caller has no valid tenant context. Root fallback entries are readable only
// by admins with direct Firestore console access.
async function writeAuditLog(userId, userEmail, operation, collection, recordCount, tenantId) {
  try {
    const entry = {
      user_id: userId,
      user_email: userEmail || 'unknown',
      tenant_id: tenantId || 'unknown',
      operation: operation,
      collection: collection || 'N/A',
      record_count: recordCount || 0,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    const ref = tenantId
      ? db.collection('tenants').doc(tenantId).collection('audit_log')
      : db.collection('audit_log');
    await ref.add(entry);
  } catch (e) {
    // Don't fail the request if audit logging fails
    console.error('Audit log write failed:', e.message);
  }
}

// ==================== EMAIL WHITELIST CHECK (1.3) ====================
// Checks tenant-namespaced approved_emails subcollection.
// Bootstrap (C-1 hardened): if approved_emails is empty, require the caller's email
// to match tenants/{tenantId}.ownerEmail. Without this gate, any authenticated user
// could send the target slug and claim owner role on a tenant with empty approved_emails.
async function checkEmailWhitelist(email, tenantId) {
  const emailsRef = db.collection('tenants').doc(tenantId).collection('approved_emails');
  const normalizedEmail = (email || '').toLowerCase();

  // Bootstrap check
  const countSnap = await emailsRef.limit(1).get();
  if (countSnap.empty) {
    // Read tenant doc to get authoritative ownerEmail
    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    const ownerEmail = tenantSnap.exists
      ? String(tenantSnap.data().ownerEmail || '').toLowerCase()
      : '';
    if (ownerEmail && ownerEmail === normalizedEmail) {
      return { approved: true, isBootstrap: true };
    }
    // Empty approved_emails AND caller is not the registered owner → reject.
    // This prevents bootstrap-hijack of partially-provisioned tenants.
    return { approved: false, isBootstrap: false, role: null };
  }

  // Targeted query
  const snap = await emailsRef
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get();

  if (!snap.empty) {
    return { approved: true, isBootstrap: false, role: snap.docs[0].data().role || null };
  }

  return { approved: false, isBootstrap: false, role: null };
}

// ============================================================================
// GEMINI TOKEN USAGE LOGGING
// ============================================================================
// Writes one doc per Gemini call so dailyTenantCostAggregation can roll it up.
// Per-tenant subcollection so reads stay scoped to the tenant.
//
// Schema: tenants/{tenantId}/geminiUsage/{auto}
//   { tenantId, userId, op, model, inputTokens, outputTokens, totalTokens,
//     latencyMs, success, errorCode, timestamp }
//
// Failure to write is non-fatal — never let a logging error break a user-
// facing Gemini response. Errors are console.warn only.
async function logGeminiUsage({
  tenantId, userId, op, model,
  inputTokens, outputTokens, totalTokens,
  latencyMs, success, errorCode,
}) {
  if (!tenantId) return; // platform-wide calls don't get logged
  try {
    await db.collection('tenants').doc(tenantId)
      .collection('geminiUsage').add({
        tenantId,
        userId: userId || null,
        op: String(op || 'unknown'),
        model: String(model || 'unknown'),
        inputTokens: Number(inputTokens) || 0,
        outputTokens: Number(outputTokens) || 0,
        totalTokens: Number(totalTokens) || 0,
        latencyMs: Number(latencyMs) || 0,
        success: !!success,
        errorCode: errorCode || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (e) {
    console.warn('[geminiUsage] log write failed (non-fatal):', e.message);
  }
}

// ==================== SECURITY HEADERS (1.8) ====================
function setSecurityHeaders(res) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-XSS-Protection', '1; mode=block');
}

// ==================== USER ROLE LOOKUP ====================
async function getUserRole(userId, userEmail, tenantId) {
  // super_admin claim bypasses tenant role lookup entirely
  try {
    const userRecord = await auth.getUser(userId);
    if (userRecord.customClaims && userRecord.customClaims.superAdmin === true) {
      return 'super_admin';
    }
    // Trust role from custom claim if already set (avoids extra Firestore read)
    if (userRecord.customClaims && userRecord.customClaims.role) {
      return userRecord.customClaims.role;
    }
  } catch (e) { /* ignore */ }

  // Check tenant's team_members subcollection
  const teamSnap = await db.collection('tenants').doc(tenantId)
    .collection('team_members')
    .where('email', '==', userEmail)
    .limit(1)
    .get();

  if (!teamSnap.empty) {
    return teamSnap.docs[0].data().role || 'employee';
  }

  // Bootstrap: first user to authenticate against an empty team_members = owner
  const allMembers = await db.collection('tenants').doc(tenantId)
    .collection('team_members').limit(1).get();
  if (allMembers.empty) return 'owner';

  return 'employee';
}

// ==================== MAIN HANDLER ====================
async function handleRequest(req, res) {
  // Set security headers on all responses
  setSecurityHeaders(res);

  try {
    // Only allow POST (1.17)
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Validate Content-Type (1.17)
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      res.status(400).json({ error: 'Content-Type must be application/json' });
      return;
    }

    // Verify auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      await writeAuditLog('anonymous', 'anonymous', 'auth_failure', null, 0);
      res.status(401).json({ error: 'Missing authorization header' });
      return;
    }

    const idToken = authHeader.replace('Bearer ', '');
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(idToken);
    } catch (authError) {
      await writeAuditLog('unknown', 'unknown', 'auth_failure', null, 0);
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const userId = decodedToken.uid;
    const userEmail = decodedToken.email || '';

    // Email verification gate: block password users whose email is not yet verified.
    // Federated providers (Google, etc.) come pre-verified.
    // firebase=password identifier appears in decodedToken.firebase.sign_in_provider
    {
      const signInProvider = decodedToken.firebase && decodedToken.firebase.sign_in_provider;
      if (signInProvider === 'password' && decodedToken.email_verified !== true) {
        await writeAuditLog(userId, userEmail, 'email_not_verified', null, 0, null);
        res.status(403).json({ error: 'Email not verified. Check your inbox for the verification link.' });
        return;
      }
    }

    // ── Resolve tenantId ─────────────────────────────────────────────────────
    // Primary: from JWT custom claim (set after first approved login)
    // Fallback: from tenantSlug in request body (first login on a new tenant)
    let tenantId = decodedToken.tenantId || null;

    if (!tenantId) {
      const tenantSlug = (req.body && req.body.tenantSlug) || null;
      if (tenantSlug) {
        const slugSnap = await db.collection('tenants')
          .where('slug', '==', tenantSlug)
          .limit(1)
          .get();
        if (!slugSnap.empty) {
          tenantId = slugSnap.docs[0].id;
        }
      }
    }

    if (!tenantId) {
      await writeAuditLog(userId, userEmail, 'tenant_not_found', null, 0, null);
      res.status(400).json({ error: 'Tenant not found. Please ensure you are accessing the correct URL.' });
      return;
    }

    // Rate limit check
    const rateCheck = checkRateLimit(userId);
    if (!rateCheck.allowed) {
      await writeAuditLog(userId, userEmail, 'rate_limit_exceeded', null, 0, tenantId);
      res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
      return;
    }

    // Email whitelist check (1.3) — now tenant-scoped
    const whitelistResult = await checkEmailWhitelist(userEmail, tenantId);
    if (!whitelistResult.approved) {
      await writeAuditLog(userId, userEmail, 'access_denied_not_whitelisted', null, 0, tenantId);
      // Revoke approved claim if user was previously approved but is now removed
      try {
        const userRecord = await auth.getUser(userId);
        if (userRecord.customClaims && userRecord.customClaims.approved) {
          const existing = userRecord.customClaims || {};
          await auth.setCustomUserClaims(userId, { ...existing, approved: false });
        }
      } catch (e) { /* ignore */ }
      res.status(403).json({ error: 'Access denied. Contact the restaurant owner to request access.' });
      return;
    }

    // If bootstrap (first user on a new tenant), auto-approve them as owner
    if (whitelistResult.isBootstrap) {
      await db.collection('tenants').doc(tenantId).collection('approved_emails').add({
        email: userEmail.toLowerCase(),
        role: 'owner',
        added_by: 'system_bootstrap',
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // Stamp approved + tenantId + tenantSlug + role into the Firebase Auth JWT custom claims.
    // Firestore rules use tenantId for isolation; client uses tenantSlug for H-1 URL validation.
    try {
      const userRecord = await auth.getUser(userId);
      const existing = userRecord.customClaims || {};
      const needsUpdate = !existing.approved
        || existing.tenantId !== tenantId
        || !existing.tenantSlug;
      if (needsUpdate) {
        // Role lookup needed before stamping
        const roleForClaim = whitelistResult.role || await getUserRole(userId, userEmail, tenantId);
        // Get slug for claim
        const tenantDoc = await db.collection('tenants').doc(tenantId).get();
        const slugForClaim = tenantDoc.exists ? (tenantDoc.data().slug || null) : null;
        await auth.setCustomUserClaims(userId, {
          ...existing,
          approved: true,
          tenantId: tenantId,
          tenantSlug: slugForClaim,
          role: roleForClaim,
        });
      }
    } catch (e) { /* non-fatal — rules will still block unapproved direct reads */ }

    // H-1: Cross-tenant URL hijack prevention — if caller supplied tenantSlug in body,
    // verify it matches the resolved tenant's actual slug. Rejects stale JWTs pointing
    // at a different tenant than the URL the user is visiting.
    {
      const requestSlug = (req.body && typeof req.body.tenantSlug === 'string')
        ? req.body.tenantSlug.toLowerCase()
        : null;
      if (requestSlug) {
        const tenantDoc = await db.collection('tenants').doc(tenantId).get();
        const actualSlug = tenantDoc.exists
          ? String(tenantDoc.data().slug || '').toLowerCase()
          : '';
        if (actualSlug && actualSlug !== requestSlug) {
          await writeAuditLog(userId, userEmail, 'slug_mismatch', null, 0, tenantId);
          res.status(403).json({
            error: 'Tenant mismatch. Please use the correct restaurant URL.',
            correctSlug: actualSlug,
          });
          return;
        }
      }
    }

    // Get user role for permission checks (1.2)
    const userRole = await getUserRole(userId, userEmail, tenantId);

    // Parse request
    const { operation, table, data, filters, options } = req.body;

    if (!operation || !ALLOWED_OPERATIONS.includes(operation)) {
      res.status(400).json({ error: 'Invalid operation' });
      return;
    }

    // Tenant-status gate: suspended/cancelled tenants get read-only access.
    // Reads = observability for owners to recover; writes = blocked until resumed.
    // Owners can still hit adminBilling (separate endpoint) to resume or update card.
    {
      const tenantDocForGate = await db.collection('tenants').doc(tenantId).get();
      const tenantStatus = tenantDocForGate.exists
        ? String(tenantDocForGate.data().status || 'active').toLowerCase()
        : 'active';
      const readOnlyOps = ['select', 'getTenantConfig', 'checkSlugAvailable'];
      if ((tenantStatus === 'suspended' || tenantStatus === 'cancelled' || tenantStatus === 'canceled')
          && !readOnlyOps.includes(operation)) {
        await writeAuditLog(userId, userEmail, 'tenant_status_blocked', table, 0, tenantId);
        res.status(402).json({
          error: tenantStatus === 'suspended'
            ? 'Account is suspended. Contact support@restaurantoracle.com.'
            : 'Subscription is cancelled. Reactivate from Billing & Team to continue.',
        });
        return;
      }
    }

    // Impersonator write-block: super-admin sessions that obtained a token via
    // /super-admin#impersonateTenant carry { impersonating: true, readOnly: true,
    // impersonationExpiresAt }. Reject expired sessions; block all non-read ops.
    if (decodedToken && decodedToken.impersonating === true) {
      const exp = Number(decodedToken.impersonationExpiresAt) || 0;
      if (exp && Date.now() > exp) {
        await writeAuditLog(userId, userEmail, 'impersonation_expired', table, 0, tenantId);
        res.status(401).json({ error: 'Impersonation session expired. Sign out and re-impersonate.' });
        return;
      }
      if (decodedToken.readOnly === true) {
        const allowedReadOps = ['select', 'getTenantConfig', 'checkSlugAvailable', 'get_tenant_settings', 'list_invoices'];
        if (!allowedReadOps.includes(operation)) {
          await writeAuditLog(userId, userEmail, 'impersonator_write_blocked', table, 0, tenantId);
          res.status(403).json({ error: 'Read-only impersonation session: writes are not permitted.' });
          return;
        }
      }
    }

    // Check role-based permission (1.2)
    if (!checkPermission(userRole, operation, table)) {
      await writeAuditLog(userId, userEmail, 'permission_denied', table, 0, tenantId);
      res.status(403).json({ error: 'Permission denied. Your role (' + userRole + ') cannot perform this action.' });
      return;
    }

    // Validate input data (1.11) - use larger limit for scan operations
    const validation = validateData(data, operation === 'scan' ? MAX_SCAN_PAYLOAD_SIZE : undefined);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    // Handle invite_user operation (owner only - enforced by permission matrix)
    if (operation === 'invite_user') {
      if (!data || !data.email) {
        res.status(400).json({ error: 'Email is required' });
        return;
      }

      const inviteEmail = sanitizeString(data.email).trim().toLowerCase();

      try {
        let existingUser = null;
        try {
          existingUser = await auth.getUserByEmail(inviteEmail);
        } catch (e) { /* User doesn't exist */ }

        const actionCodeSettings = {
          url: 'https://restaurant-oracle.web.app',
          handleCodeInApp: false
        };

        if (existingUser) {
          const resetLink = await auth.generatePasswordResetLink(inviteEmail, actionCodeSettings);
          await writeAuditLog(userId, userEmail, 'invite_user_reset', inviteEmail, 1, tenantId);
          res.status(200).json({
            data: {
              message: 'User already exists. Password reset link generated.',
              resetLink: resetLink,
              existingUser: true
            },
            error: null
          });
          return;
        }

        // Create new user
        const newUser = await auth.createUser({
          email: inviteEmail,
          emailVerified: false,
          disabled: false,
        });

        const inviteRole = (data.role === 'owner') ? 'owner' : 'employee';
        await auth.setCustomUserClaims(newUser.uid, {
          role: inviteRole,
          tenantId: tenantId,
          approved: false, // false until they first log in and hit checkEmailWhitelist
          name: sanitizeString(data.name || '')
        });

        // Add to tenant's approved_emails subcollection
        const tenantEmailsRef = db.collection('tenants').doc(tenantId).collection('approved_emails');
        const existingApproval = await tenantEmailsRef
          .where('email', '==', inviteEmail)
          .limit(1)
          .get();
        if (existingApproval.empty) {
          await tenantEmailsRef.add({
            email: inviteEmail,
            role: inviteRole,
            added_by: userEmail,
            created_at: admin.firestore.FieldValue.serverTimestamp()
          });
        }

        const setupLink = await auth.generatePasswordResetLink(inviteEmail, actionCodeSettings);
        await writeAuditLog(userId, userEmail, 'invite_user_created', inviteEmail, 1, tenantId);

        res.status(200).json({
          data: {
            user: { uid: newUser.uid, email: newUser.email },
            message: 'User created. Share this link for them to set their password.',
            setupLink: setupLink
          },
          error: null
        });
        return;
      } catch (inviteError) {
        console.error('Invite error:', inviteError.message);
        // Map known Firebase error codes to safe messages; never expose raw SDK errors
        const code = inviteError.errorInfo && inviteError.errorInfo.code;
        const safeMsg = code === 'auth/email-already-exists' ? 'Email already exists' :
                        code === 'auth/invalid-email'        ? 'Invalid email address' :
                        code === 'auth/invalid-display-name' ? 'Invalid display name' :
                        'Failed to create invitation. Please try again.';
        res.status(400).json({ error: safeMsg });
        return;
      }
    }

    // ==================== VOICE ASSISTANT (Gemini) ====================
    if (operation === 'voice') {
      const transcript = sanitizeString((data && data.transcript) || '');
      if (!transcript || transcript.length < 2) {
        res.status(400).json({ error: 'No transcript provided' });
        return;
      }

      const context = data.context || {};
      // Cap context lists to prevent prompt inflation / Gemini quota abuse
      const MAX_CONTEXT_ITEMS = 200;
      if (context.ingredients) context.ingredients = context.ingredients.slice(0, MAX_CONTEXT_ITEMS).map(s => sanitizeString(String(s)));
      if (context.areas)       context.areas       = context.areas.slice(0, MAX_CONTEXT_ITEMS).map(s => sanitizeString(String(s)));
      if (context.preps)       context.preps       = context.preps.slice(0, MAX_CONTEXT_ITEMS).map(s => sanitizeString(String(s)));
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.error('GEMINI_API_KEY not configured');
        res.status(500).json({ error: 'Voice assistant not configured' });
        return;
      }

      const __voiceT0 = Date.now();
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const systemPrompt = `You are a voice assistant for a restaurant kitchen management app called Restaurant Oracle.
The user speaks commands and you return a JSON action for the app to execute.

Available actions:
1. "navigate" - Switch to a tab. Params: { "tab": "inventory"|"log"|"ingredients"|"recipes"|"prep"|"menu"|"shopping"|"admin" }
2. "search" - Search for an item. Params: { "tab": "inventory"|"ingredients"|"recipes"|"prep"|"menu"|"shopping", "query": "search text" }
3. "add_inventory" - Add item to inventory in a storage area. Params: { "ingredient": "exact name from list", "qty": number, "unit": "unit string", "area": "exact area name from list" }
4. "add_shopping" - Add item to shopping list. Params: { "ingredient": "exact name from list", "qty": number, "unit": "unit string" }
5. "update_prep" - Update prep item on-hand count. Params: { "prep_name": "exact name from list", "onHand": number }
6. "info" - Answer a question or provide information. Params: { "message": "plain text answer" }
7. "unknown" - Could not understand the command. Params: { "message": "brief sorry message" }

CONTEXT (current app state):
- Current tab: ${context.currentTab || 'inventory'}
- Ingredient names: ${(context.ingredients || []).join(', ') || 'none loaded'}
- Storage area names: ${(context.areas || []).join(', ') || 'none loaded'}
- Prep item names: ${(context.preps || []).join(', ') || 'none loaded'}

RULES:
- Match ingredient/area/prep names to the CLOSEST name from the context lists above. Always return the EXACT spelling from the list.
- For "where is X" or "find X" questions, use action "search" with tab "inventory".
- For "how much X" or "do we have X", use action "search" with tab "inventory".
- For "go to" or "show me" or "open", use action "navigate".
- For "add X to shopping list" or "we need X", use action "add_shopping".
- For "add X to Y" where Y matches a storage area name, use action "add_inventory".
- For "mark X as prepped" or "we prepped N of X", use action "update_prep".
- If quantity is not specified, default to qty: 1 and unit: "each".
- Return ONLY a single JSON object. No markdown, no explanation, no extra text.

JSON format: { "action": "action_name", "params": { ... }, "toast": "Short human-readable confirmation" }`;

        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: transcript }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 256,
            responseMimeType: 'application/json',
          },
        });

        const __voiceUsage = (result && result.response && result.response.usageMetadata) || {};
        await logGeminiUsage({
          tenantId, userId,
          op: 'voice',
          model: 'gemini-2.5-flash',
          inputTokens: __voiceUsage.promptTokenCount || 0,
          outputTokens: __voiceUsage.candidatesTokenCount || 0,
          totalTokens: __voiceUsage.totalTokenCount || 0,
          latencyMs: Date.now() - __voiceT0,
          success: true,
        });

        const responseText = result.response.text().trim();
        let parsed;
        try {
          parsed = JSON.parse(responseText);
        } catch (parseErr) {
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error('Invalid JSON from AI');
          }
        }

        if (!parsed.action || !parsed.params) {
          throw new Error('Malformed AI response');
        }

        const validActions = ['navigate', 'search', 'add_inventory', 'add_shopping', 'update_prep', 'info', 'unknown'];
        if (!validActions.includes(parsed.action)) {
          parsed.action = 'unknown';
          parsed.params = { message: 'Sorry, I did not understand that command.' };
          parsed.toast = 'Command not recognized';
        }

        await writeAuditLog(userId, userEmail, 'voice', parsed.action, 1, tenantId);

        res.status(200).json({
          data: parsed,
          error: null,
          _rateLimit: { remaining: rateCheck.remaining }
        });
        return;

      } catch (geminiError) {
        console.error('Gemini API error:', geminiError.message);
        await logGeminiUsage({
          tenantId, userId,
          op: 'voice',
          model: 'gemini-2.5-flash',
          inputTokens: 0, outputTokens: 0, totalTokens: 0,
          latencyMs: Date.now() - __voiceT0,
          success: false,
          errorCode: (geminiError.message || '').includes('429') ? 'rate_limit' : 'gemini_error',
        });
        if (geminiError.message && geminiError.message.includes('429')) {
          res.status(429).json({ error: 'Voice assistant rate limit reached. Try again in a minute.' });
        } else {
          res.status(500).json({ error: 'Voice assistant temporarily unavailable' });
        }
        return;
      }
    }

    // ==================== RESERVE IDS (Atomic Counter) ====================
    if (operation === 'reserve_ids') {
      try {
        const counterRef = tenantCol(tenantId, 'counters').doc('next_id');
        const newId = await db.runTransaction(async (transaction) => {
          const doc = await transaction.get(counterRef);
          let current = 1000;
          if (doc.exists) {
            current = doc.data().value || 1000;
          }
          const next = current + 1;
          transaction.set(counterRef, { value: next }, { merge: true });
          return next;
        });

        await writeAuditLog(userId, userEmail, 'reserve_ids', 'counters', 1, tenantId);

        res.status(200).json({
          data: { nextId: newId },
          error: null,
          _rateLimit: { remaining: rateCheck.remaining }
        });
        return;
      } catch (counterError) {
        console.error('Reserve ID error:', counterError.message);
        res.status(500).json({ error: 'Failed to reserve ID' });
        return;
      }
    }

    // ==================== INVENTORY SCAN (Gemini Vision) ====================
    if (operation === 'scan') {
      const imageData = (data && data.image) || '';
      const mimeType = (data && data.mimeType) || 'image/jpeg';
      const areaName = sanitizeString((data && data.areaName) || '');
      const existingItems = (data && data.existingItems) || [];
      const allIngredients = (data && data.allIngredients) || [];

      if (!imageData || imageData.length < 100) {
        res.status(400).json({ error: 'No image data provided' });
        return;
      }

      // Validate base64 format
      if (!/^[A-Za-z0-9+/=]+$/.test(imageData.substring(0, 100))) {
        res.status(400).json({ error: 'Invalid image data format' });
        return;
      }

      // Validate decoded image size (~75% of base64 length)
      const imageSizeBytes = imageData.length * 0.75;
      if (imageSizeBytes > 1500000) {
        res.status(400).json({ error: 'Image too large. Please compress further.' });
        return;
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.error('GEMINI_API_KEY not configured');
        res.status(500).json({ error: 'Scan service not configured' });
        return;
      }

      const __scanT0 = Date.now();
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const systemPrompt = `You are an inventory count sheet reader for a restaurant kitchen management app.

You will receive a photo of a printed inventory count sheet with handwritten quantity values.

The sheet has a table with columns: #, Item Name, Unit, Last Qty, New Count.
The "New Count" column contains handwritten numbers that the user filled in.

EXISTING ITEMS in this area: ${existingItems.join(', ') || 'none'}
ALL KNOWN INGREDIENTS: ${allIngredients.join(', ') || 'none'}

YOUR TASK:
1. Read each row of the inventory sheet
2. For each row that has a handwritten value in the "New Count" column, extract the item name and the new quantity
3. Match item names to the EXACT spelling from the EXISTING ITEMS or ALL KNOWN INGREDIENTS lists above
4. If you cannot read a handwritten number clearly, use your best judgment but set confidence to "low"
5. Ignore blank rows or rows where "New Count" is empty

RULES:
- Return ONLY items that have a handwritten new count value
- Match item names to the closest name from the provided lists. Return the EXACT spelling from the lists.
- Quantities can be decimals (0.25, 0.5, 0.75, 1.5, etc.)
- If a handwritten value looks like a fraction or abbreviation, interpret it sensibly
- Return an empty items array if you cannot read any values
- Return ONLY a single JSON object. No markdown, no explanation, no extra text.

JSON format: { "items": [{ "name": "exact ingredient name", "qty": number, "unit": "unit string", "confidence": "high"|"medium"|"low" }] }`;

        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [
            { text: 'Read the handwritten quantities from this inventory count sheet for area: ' + areaName },
            { inlineData: { mimeType: mimeType, data: imageData } }
          ]}],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
          },
        });

        const __scanUsage = (result && result.response && result.response.usageMetadata) || {};
        await logGeminiUsage({
          tenantId, userId,
          op: 'scan',
          model: 'gemini-2.5-flash',
          inputTokens: __scanUsage.promptTokenCount || 0,
          outputTokens: __scanUsage.candidatesTokenCount || 0,
          totalTokens: __scanUsage.totalTokenCount || 0,
          latencyMs: Date.now() - __scanT0,
          success: true,
        });

        const responseText = result.response.text().trim();
        let parsed;
        try {
          parsed = JSON.parse(responseText);
        } catch (parseErr) {
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error('Invalid JSON from AI');
          }
        }

        if (!parsed.items || !Array.isArray(parsed.items)) {
          parsed = { items: [] };
        }

        // Sanitize the output
        parsed.items = parsed.items.map(function(item) {
          return {
            name: String(item.name || '').substring(0, 200),
            qty: typeof item.qty === 'number' ? item.qty : parseFloat(item.qty) || 0,
            unit: String(item.unit || 'ea').substring(0, 20),
            confidence: ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : 'medium'
          };
        }).filter(function(item) {
          return item.name && item.qty >= 0;
        });

        await writeAuditLog(userId, userEmail, 'scan', areaName, parsed.items.length, tenantId);

        res.status(200).json({
          data: parsed,
          error: null,
          _rateLimit: { remaining: rateCheck.remaining }
        });
        return;

      } catch (geminiError) {
        console.error('Gemini Vision error:', geminiError.message);
        await logGeminiUsage({
          tenantId, userId,
          op: 'scan',
          model: 'gemini-2.5-flash',
          inputTokens: 0, outputTokens: 0, totalTokens: 0,
          latencyMs: Date.now() - __scanT0,
          success: false,
          errorCode: (geminiError.message || '').includes('429') ? 'rate_limit' : 'gemini_error',
        });
        if (geminiError.message && geminiError.message.includes('429')) {
          res.status(429).json({ error: 'Scan rate limit reached. Try again in a minute.' });
        } else {
          res.status(500).json({ error: 'Scan service temporarily unavailable' });
        }
        return;
      }
    }

    // ── New tenant-level operations ──────────────────────────────────────────
    if (operation === 'getTenantConfig') {
      const tenantDoc = await db.collection('tenants').doc(tenantId).get();
      if (!tenantDoc.exists) {
        res.status(404).json({ error: 'Tenant not found' });
        return;
      }
      const d = tenantDoc.data();
      // Return safe subset (never expose stripeCustomerId to client)
      res.status(200).json({
        data: {
          tenantId,
          slug: d.slug,
          restaurantName: d.restaurantName,
          plan: d.plan,
          status: d.status,
          onboardingComplete: d.onboardingComplete || false,
        },
        error: null,
      });
      return;
    }

    if (operation === 'checkSlugAvailable') {
      const slug = toSlug((data && data.slug) || '');
      if (!slug || slug.length < 2) {
        res.status(400).json({ error: 'Slug too short' });
        return;
      }
      const snap = await db.collection('tenants').where('slug', '==', slug).limit(1).get();
      res.status(200).json({ data: { available: snap.empty, slug }, error: null });
      return;
    }

    if (operation === 'provisionTenant') {
      if (!checkPermission(userRole, 'provisionTenant', null)) {
        res.status(403).json({ error: 'Only super_admin can provision tenants' });
        return;
      }
      const { restaurantName, ownerEmail, plan, stripeCustomerId } = data || {};
      if (!restaurantName || !ownerEmail) {
        res.status(400).json({ error: 'restaurantName and ownerEmail required' });
        return;
      }
      // M-3: validate email shape
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
        res.status(400).json({ error: 'Invalid email format' });
        return;
      }
      // M-3: cap restaurant name length (defense-in-depth; sanitizeString already truncates to 500)
      if (typeof restaurantName !== 'string' || restaurantName.length < 2 || restaurantName.length > 100) {
        res.status(400).json({ error: 'Restaurant name must be 2-100 characters' });
        return;
      }

      // Generate unique slug
      let slug = toSlug(restaurantName);
      // M-2: reject empty/too-short slugs (e.g. input "!!!" → slug "")
      if (!slug || slug.length < 2) {
        res.status(400).json({ error: 'Restaurant name must contain at least 2 alphanumeric characters' });
        return;
      }
      const slugSnap = await db.collection('tenants').where('slug', '==', slug).limit(1).get();
      if (!slugSnap.empty) slug = slug + '-' + Date.now().toString(36);

      // Create tenant doc (use auto-generated ID as tenantId)
      const newTenantRef = db.collection('tenants').doc();
      const newTenantId = newTenantRef.id;

      // Generate unique invoice token (8 hex chars). Collision check via retry.
      let invoiceToken = invoices.generateInvoiceToken();
      for (let i = 0; i < 3; i++) {
        const tokSnap = await db.collection('tenants').where('invoiceToken', '==', invoiceToken).limit(1).get();
        if (tokSnap.empty) break;
        invoiceToken = invoices.generateInvoiceToken();
      }

      await newTenantRef.set({
        slug,
        restaurantName: sanitizeString(restaurantName),
        ownerEmail: ownerEmail.toLowerCase(),
        plan: plan || 'pro',
        status: 'active',
        onboardingComplete: false,
        stripeCustomerId: stripeCustomerId || null,
        invoiceToken,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Seed default data into tenant namespace
      const seedData = getDefaultSeedData();
      const batch = db.batch();
      for (const [col, items] of Object.entries(seedData)) {
        for (const item of items) {
          const ref = db.collection('tenants').doc(newTenantId).collection(col).doc(String(item.id));
          batch.set(ref, item);
        }
      }
      await batch.commit();

      // Add owner to approved_emails
      await db.collection('tenants').doc(newTenantId).collection('approved_emails').add({
        email: ownerEmail.toLowerCase(),
        role: 'owner',
        added_by: userEmail,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Create Firebase Auth user for owner (if not exists)
      let ownerUid = null;
      try {
        const existing = await auth.getUserByEmail(ownerEmail);
        ownerUid = existing.uid;
      } catch (e) {
        const newUser = await auth.createUser({ email: ownerEmail, emailVerified: false });
        ownerUid = newUser.uid;
      }

      // Stamp JWT claims (includes tenantSlug for client-side URL validation)
      await auth.setCustomUserClaims(ownerUid, {
        tenantId: newTenantId,
        tenantSlug: slug,
        approved: true,
        role: 'owner',
      });

      await writeAuditLog(userId, userEmail, 'provisionTenant', newTenantId, 1, newTenantId);

      res.status(200).json({
        data: {
          tenantId: newTenantId,
          slug,
          appUrl: `https://${slug}.restaurantoracle.app`,
          ownerUid,
        },
        error: null,
      });
      return;
    }

    if (operation === 'deprovisionTenant') {
      if (!checkPermission(userRole, 'deprovisionTenant', null)) {
        res.status(403).json({ error: 'Only super_admin can deprovision tenants' });
        return;
      }
      const targetTenantId = (data && data.tenantId) || tenantId;
      await db.collection('tenants').doc(targetTenantId).update({ status: 'suspended' });

      // Revoke approved claims for all users in this tenant
      const emailsSnap = await db.collection('tenants').doc(targetTenantId)
        .collection('approved_emails').get();
      for (const doc of emailsSnap.docs) {
        const email = doc.data().email;
        try {
          const u = await auth.getUserByEmail(email);
          const existing = u.customClaims || {};
          if (existing.tenantId === targetTenantId) {
            await auth.setCustomUserClaims(u.uid, { ...existing, approved: false });
          }
        } catch (e) { /* ignore missing users */ }
      }

      await writeAuditLog(userId, userEmail, 'deprovisionTenant', targetTenantId, 1, targetTenantId);
      res.status(200).json({ data: { status: 'suspended', tenantId: targetTenantId }, error: null });
      return;
    }

    // ==================== FEEDBACK SUBMISSION ====================
    if (operation === 'submitFeedback') {
      const ALLOWED_FEATURES = new Set([
        'recipes', 'inventory', 'prep_sheets', 'ingredients', 'menu',
        'shopping', 'vendor_orders', 'activity_log', 'admin',
        'scan', 'oracle_assistant', 'billing', 'general',
      ]);
      const feature = (data && typeof data.feature === 'string' && ALLOWED_FEATURES.has(data.feature))
        ? data.feature : 'general';
      const sentiment = (data && (data.sentiment === 'positive' || data.sentiment === 'negative'))
        ? data.sentiment : null;
      const rawComment = (data && typeof data.comment === 'string') ? data.comment : '';
      const comment = sanitizeString(rawComment).slice(0, 2000).trim();
      if (sentiment === null && comment === '') {
        res.status(400).json({ error: 'Feedback must include sentiment or comment' });
        return;
      }
      const route = sanitizeString((data && typeof data.route === 'string') ? data.route.slice(0, 200) : '');
      const userAgent = sanitizeString((data && typeof data.userAgent === 'string') ? data.userAgent.slice(0, 300) : '');
      const appVersion = sanitizeString((data && typeof data.appVersion === 'string') ? data.appVersion.slice(0, 40) : '');

      const docRef = tenantCol(tenantId, 'feedback_events').doc();
      await docRef.set({
        userId, userEmail, feature, sentiment, comment,
        route, userAgent, appVersion,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
      await writeAuditLog(userId, userEmail, 'feedback_submit', 'feedback_events', 1, tenantId);
      res.status(200).json({ data: { id: docRef.id }, error: null });
      return;
    }

    // ==================== TENANT SETTINGS (incl. invoice email) ====================
    if (operation === 'get_tenant_settings') {
      if (!checkPermission(userRole, 'get_tenant_settings', null)) {
        res.status(403).json({ error: 'Permission denied' });
        return;
      }
      const tSnap = await db.collection('tenants').doc(tenantId).get();
      if (!tSnap.exists) { res.status(404).json({ error: 'Tenant not found' }); return; }
      const t = tSnap.data();
      let token = t.invoiceToken;
      // Lazily generate if missing (for tenants provisioned before this feature)
      if (!token) {
        token = invoices.generateInvoiceToken();
        await db.collection('tenants').doc(tenantId).update({ invoiceToken: token });
      }
      res.status(200).json({
        data: {
          invoiceEmail: token + '@invoices.restaurantoracle.app',
          invoiceToken: token,
          restaurantName: t.restaurantName,
          slug: t.slug,
          plan: t.plan,
          status: t.status
        },
        error: null,
        _rateLimit: { remaining: rateCheck.remaining }
      });
      return;
    }

    if (operation === 'rotate_invoice_token') {
      if (!checkPermission(userRole, 'rotate_invoice_token', null)) {
        res.status(403).json({ error: 'Permission denied' });
        return;
      }
      let newToken = invoices.generateInvoiceToken();
      for (let i = 0; i < 3; i++) {
        const s = await db.collection('tenants').where('invoiceToken', '==', newToken).limit(1).get();
        if (s.empty) break;
        newToken = invoices.generateInvoiceToken();
      }
      await db.collection('tenants').doc(tenantId).update({ invoiceToken: newToken });
      await writeAuditLog(userId, userEmail, 'rotate_invoice_token', tenantId, 1, tenantId);
      res.status(200).json({
        data: {
          invoiceEmail: newToken + '@invoices.restaurantoracle.app',
          invoiceToken: newToken
        },
        error: null
      });
      return;
    }

    if (operation === 'ai_insight') {
      if (!checkPermission(userRole, 'ai_insight', null)) {
        res.status(403).json({ error: 'Permission denied' });
        return;
      }
      const mode = String(data && data.mode || '').slice(0, 40);
      const ingName = String(data && data.ingredientName || '').slice(0, 200);
      const currentCost = Number(data && data.currentCost) || 0;
      const currentVendor = String(data && data.currentVendor || '').slice(0, 200);
      const region = String(data && data.region || 'Portland, OR').slice(0, 100);
      const history = Array.isArray(data && data.history) ? data.history.slice(-50) : [];

      if (!['supplier_alternates', 'trend_narration'].includes(mode)) {
        res.status(400).json({ error: 'Invalid mode' });
        return;
      }
      if (!ingName) {
        res.status(400).json({ error: 'ingredientName required' });
        return;
      }

      // 24h cache keyed by (mode, ingName, region)
      const cacheKey = mode + '::' + ingName.toLowerCase() + '::' + region.toLowerCase();
      const cacheRef = tenantCol(tenantId, 'ai_insight_cache').doc(
        Buffer.from(cacheKey).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 100)
      );
      try {
        const cached = await cacheRef.get();
        if (cached.exists) {
          const c = cached.data();
          const ageMs = Date.now() - (c.cachedAt && c.cachedAt.toMillis ? c.cachedAt.toMillis() : 0);
          if (ageMs < 24 * 60 * 60 * 1000) {
            res.status(200).json({ data: c.result, cached: true, error: null });
            return;
          }
        }
      } catch (e) { /* cache miss ok */ }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: 'AI not configured' });
        return;
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

      let prompt = '';
      let generationConfig = { temperature: 0.3, maxOutputTokens: 1024, responseMimeType: 'application/json' };

      if (mode === 'supplier_alternates') {
        prompt = `You are a restaurant sourcing assistant for a small independent restaurant in ${region}.

INGREDIENT: ${ingName}
CURRENT UNIT COST: $${currentCost.toFixed(2)}
CURRENT VENDOR: ${currentVendor || 'unknown'}

Suggest up to 4 alternate wholesale suppliers local to the ${region} area (or nearby) that this restaurant could reasonably buy from. Prefer small/regional wholesalers that service independents over national chains.

Return ONLY a JSON object:
{
  "alternates": [
    { "name": "supplier name", "region": "service area", "estimatedPrice": number_or_null, "confidence": "low|medium|high", "why": "one sentence why worth trying", "contactHint": "phone/website/known as if commonly known, else empty" }
  ],
  "notes": "one-line caveat about price estimates"
}

RULES:
- If you are not confident a supplier exists or services the region, omit it. Do not fabricate.
- estimatedPrice may be null if unknown. Never guess a specific number beyond ±25% of current cost.
- Keep names short and factually grounded.`;
      } else if (mode === 'trend_narration') {
        prompt = `You are a cost analyst for a restaurant.

INGREDIENT: ${ingName}
CURRENT UNIT COST: $${currentCost.toFixed(2)}
RECENT PRICE HISTORY (date, price, vendor): ${JSON.stringify(history)}

In 2 short sentences, explain:
1. What the price trend is showing (direction + magnitude).
2. A plausible cause based on general market knowledge of this ingredient (seasonality, commodity pressure, etc.) — clearly flag this as hypothesis not fact.

Return ONLY JSON: { "summary": "...", "hypothesis": "...", "severity": "low|medium|high" }`;
      }

      try {
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig
        });
        const txt = result.response.text().trim();
        let parsed;
        try { parsed = JSON.parse(txt); }
        catch (_) {
          const m = txt.match(/\{[\s\S]*\}/);
          if (!m) throw new Error('no JSON');
          parsed = JSON.parse(m[0]);
        }

        await cacheRef.set({
          mode, ingName, region,
          result: parsed,
          cachedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        await writeAuditLog(userId, userEmail, 'ai_insight_' + mode, ingName, 1, tenantId);

        res.status(200).json({ data: parsed, cached: false, error: null });
        return;
      } catch (e) {
        console.error('ai_insight error:', e.message);
        res.status(500).json({ error: 'AI insight generation failed' });
        return;
      }
    }

    if (operation === 'list_invoices') {
      if (!checkPermission(userRole, 'list_invoices', null)) {
        res.status(403).json({ error: 'Permission denied' });
        return;
      }
      const limit = Math.min(Math.max(Number(data && data.limit) || 50, 1), 200);
      const snap = await tenantCol(tenantId, 'invoices')
        .orderBy('created_at', 'desc').limit(limit).get();
      const items = snap.docs.map((d) => {
        const x = d.data();
        return {
          id: x.id || d.id,
          vendor_name: x.vendor_name,
          invoice_number: x.invoice_number,
          invoice_date: x.invoice_date,
          total: x.total,
          status: x.status,
          processed: (x.processed || []).length,
          unmatched: (x.unmatched || []).length,
          created_at: x.created_at
        };
      });
      res.status(200).json({ data: items, error: null });
      return;
    }

    // ── Standard CRUD operations ─────────────────────────────────────────────
    // Validate collection name
    const collection = table;
    if (!collection || !ALLOWED_COLLECTIONS.includes(collection)) {
      res.status(400).json({ error: 'Invalid collection' });
      return;
    }

    // Prevent employees from reading audit_log or approved_emails
    if (userRole !== 'owner' && userRole !== 'super_admin' &&
        (collection === 'audit_log' || collection === 'approved_emails')) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    // All data collections accessed via tenant namespace
    const collectionRef = tenantCol(tenantId, collection);
    let result;

    switch (operation) {
      case 'select': {
        let query = collectionRef;
        if (filters && filters.eq) {
          for (const [field, value] of Object.entries(filters.eq)) {
            query = query.where(field, '==', value);
          }
        }
        if (filters && filters.order) {
          query = query.orderBy(filters.order.column, filters.order.ascending !== false ? 'asc' : 'desc');
        }
        if (filters && filters.limit) {
          query = query.limit(Math.min(filters.limit, 1000)); // Cap at 1000
        }
        const snapshot = await query.get();
        result = { data: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })), error: null };
        break;
      }

      case 'insert': {
        const insertData = Array.isArray(data) ? data : [data];
        const sanitizedData = insertData.map(sanitizeRecord);
        const batch = db.batch();
        for (const item of sanitizedData) {
          const docId = item.id ? String(item.id) : collectionRef.doc().id;
          const docRef = collectionRef.doc(docId);
          batch.set(docRef, { ...item, id: item.id || docId });
        }
        await batch.commit();
        await writeAuditLog(userId, userEmail, 'insert', collection, sanitizedData.length, tenantId);
        result = { data: sanitizedData, error: null };
        break;
      }

      case 'update': {
        if (!filters || !filters.eq) {
          res.status(400).json({ error: 'Update requires filters' });
          return;
        }
        const sanitizedUpdateData = sanitizeRecord(data);
        let query = collectionRef;
        for (const [field, value] of Object.entries(filters.eq)) {
          query = query.where(field, '==', value);
        }
        const snapshot = await query.get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.update(doc.ref, sanitizedUpdateData));
        await batch.commit();
        await writeAuditLog(userId, userEmail, 'update', collection, snapshot.docs.length, tenantId);
        result = { data: { updated: snapshot.docs.length }, error: null };
        break;
      }

      case 'upsert': {
        const upsertData = Array.isArray(data) ? data : [data];
        const sanitizedUpsert = upsertData.map(sanitizeRecord);
        const batch = db.batch();
        for (const item of sanitizedUpsert) {
          const docId = item.id ? String(item.id) : collectionRef.doc().id;
          const docRef = collectionRef.doc(docId);
          batch.set(docRef, { ...item, id: item.id || docId }, { merge: true });
        }
        await batch.commit();
        await writeAuditLog(userId, userEmail, 'upsert', collection, sanitizedUpsert.length, tenantId);
        result = { data: sanitizedUpsert, error: null };
        break;
      }

      case 'delete': {
        if (!filters || (!filters.eq && !filters.in)) {
          res.status(400).json({ error: 'Delete requires filters' });
          return;
        }
        const batch = db.batch();
        let deleteCount = 0;
        if (filters.in) {
          for (const [field, values] of Object.entries(filters.in)) {
            if (values.length > MAX_DELETE_BATCH) {
              res.status(400).json({ error: 'Delete batch too large (max ' + MAX_DELETE_BATCH + ')' });
              return;
            }
            for (const value of values) {
              batch.delete(collectionRef.doc(String(value)));
              deleteCount++;
            }
          }
        } else if (filters.eq) {
          let query = collectionRef;
          for (const [field, value] of Object.entries(filters.eq)) {
            query = query.where(field, '==', value);
          }
          const snapshot = await query.get();
          if (snapshot.docs.length > MAX_DELETE_BATCH) {
            res.status(400).json({ error: 'Delete matches too many records (max ' + MAX_DELETE_BATCH + ')' });
            return;
          }
          snapshot.docs.forEach(doc => { batch.delete(doc.ref); deleteCount++; });
        }
        await batch.commit();
        await writeAuditLog(userId, userEmail, 'delete', collection, deleteCount, tenantId);
        result = { data: { deleted: true, count: deleteCount }, error: null };
        break;
      }

      default:
        res.status(400).json({ error: 'Unknown operation' });
        return;
    }

    res.status(200).json({
      data: result.data,
      error: result.error,
      _rateLimit: { remaining: rateCheck.remaining }
    });

  } catch (error) {
    console.error('Cloud function error:', error.message);
    captureError(error, req, 'api');
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Export with CORS wrapper, max 10 instances, 30s timeout (1.17)
exports.api = functions
  .region('us-central1')
  .runWith({ maxInstances: 10, timeoutSeconds: 60, secrets: ['SENTRY_DSN'] })
  .https.onRequest((req, res) => {
    cors(req, res, () => handleRequest(req, res));
  });

// Inbound invoice webhook (SendGrid Inbound Parse)
exports.inboundInvoice = invoices.inboundInvoice;

// ════════════════════════════════════════════════════════════════════════════
//  PHASE 2 — PUBLIC SIGNUP + SQUARE WEBHOOK
// ════════════════════════════════════════════════════════════════════════════

// ── CORS for public signup ──────────────────────────────────────────────────
// Signup is UNAUTHENTICATED (new user has no account yet), but still origin-
// scoped to restaurantoracle.app family + localhost for dev.
const signupCors = require('cors')({
  origin: function (origin, callback) {
    if (!origin) return callback(new Error('CORS: Origin required'), false);
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error('CORS: Origin not allowed'), false);
  }
});

// ── In-memory rate limit for signup (per-IP, separate bucket from authed API)
const signupRateMap = new Map();
const SIGNUP_RATE_LIMIT = { maxRequests: 5, windowMs: 60 * 60 * 1000 }; // 5/hr per IP

function checkSignupRateLimit(ip) {
  const now = Date.now();
  const bucket = signupRateMap.get(ip);
  if (!bucket || now > bucket.resetTime) {
    signupRateMap.set(ip, { count: 1, resetTime: now + SIGNUP_RATE_LIMIT.windowMs });
    return { allowed: true };
  }
  if (bucket.count >= SIGNUP_RATE_LIMIT.maxRequests) {
    return { allowed: false };
  }
  bucket.count++;
  return { allowed: true };
}

// ── Validation helpers ──────────────────────────────────────────────────────
const CURRENT_TERMS_VERSION = '2026-04-24';

function validateSignupInput(body) {
  const errors = [];
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const restaurantName = String(body.restaurantName || '').trim();
  const plan = String(body.plan || '').toLowerCase();
  const cardNonce = String(body.cardNonce || '');
  const cardholderName = String(body.cardholderName || '').trim();
  const verificationToken = body.verificationToken ? String(body.verificationToken) : undefined;
  const agreedToTerms = body.agreedToTerms === true;
  const termsVersion = String(body.termsVersion || '').trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Valid email required');
  }
  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  if (password.length > 128) {
    errors.push('Password too long');
  }
  if (!restaurantName || restaurantName.length < 2 || restaurantName.length > 100) {
    errors.push('Restaurant name must be 2-100 characters');
  }
  if (!PLAN_CATALOG[plan]) {
    errors.push('Plan must be starter, pro, or scale');
  }
  if (!cardNonce || !/^cnon:[A-Za-z0-9_-]+$/.test(cardNonce)) {
    errors.push('Invalid card token');
  }
  if (!agreedToTerms) {
    errors.push('You must agree to the Terms of Service and Privacy Policy');
  }
  if (!termsVersion || !/^\d{4}-\d{2}-\d{2}$/.test(termsVersion)) {
    errors.push('Invalid terms version');
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized: { email, password, restaurantName, plan, cardNonce, cardholderName, verificationToken, agreedToTerms, termsVersion },
  };
}

// ── Square error → user-friendly message mapper ────────────────────────────
// Square returns a structured error with .errors[] each having .code + .detail.
// Map common decline / validation codes to clear messages the user can act on.
function mapSquareErrorToMessage(err, fallback) {
  const errors = (err && err.body && Array.isArray(err.body.errors)) ? err.body.errors : [];
  const primary = errors[0] || {};
  const code = String(primary.code || '').toUpperCase();
  const field = primary.field || '';
  const rawDetail = primary.detail ? String(primary.detail) : '';
  const safeDetail = rawDetail.length > 200 ? rawDetail.slice(0, 200) + '…' : rawDetail;
  const map = {
    CARD_DECLINED:                  'Your card was declined. Try a different card or contact your bank.',
    VERIFY_CVV_FAILURE:             'The security code (CVV) on the card was incorrect. Please re-enter your card details.',
    VERIFY_AVS_FAILURE:             'The billing ZIP/postal code did not match. Please check the address on file with your bank.',
    INVALID_EXPIRATION:             'The card expiration date is invalid or has passed.',
    INVALID_CARD:                   'Card details are invalid. Please re-enter them.',
    INVALID_CARD_DATA:              'Card details are invalid. Please re-enter them.',
    INSUFFICIENT_FUNDS:             'The card has insufficient funds. Try a different card.',
    TRANSACTION_LIMIT:              'This charge exceeds your card\'s limit. Try a different card.',
    CARD_TOKEN_EXPIRED:             'The payment form expired. Please re-enter your card and try again.',
    CARD_TOKEN_USED:                'The payment form was already used. Please re-enter your card and try again.',
    GENERIC_DECLINE:                'Your card was declined. Try a different card or contact your bank.',
    PAN_FAILURE:                    'The card number is invalid. Please re-enter it.',
    ADDRESS_VERIFICATION_FAILURE:   'Billing address verification failed. Please check the address on file with your bank.',
    CVV_FAILURE:                    'The security code (CVV) on the card was incorrect.',
    CARD_NOT_SUPPORTED:             'This card type is not supported. Please use a different card.',
    PAYMENT_LIMIT_EXCEEDED:         'Your bank declined this amount. Please contact your bank or try a different card.',
    ALLOWABLE_PIN_TRIES_EXCEEDED:   'Too many PIN tries. Please try a different card.',
    VOICE_FAILURE:                  'Your card was declined. Please contact your bank.',
    CARDHOLDER_INSUFFICIENT_PERMISSIONS: 'The cardholder\'s bank declined this charge. Please contact your bank.',
    VERIFICATION_TOKEN_EXPIRED:     'Verification expired. Please re-enter your card and try again.',
    VERIFICATION_REQUIRED:          'Additional card verification required. Please re-enter your card.',
    BAD_REQUEST:                    safeDetail || 'The request was rejected. Please check your card details.',
    UNAUTHORIZED:                   'Payment provider authorization failed. Please contact support.',
    FORBIDDEN:                      'Payment provider rejected the request. Please contact support.',
    NOT_FOUND:                      'Payment plan not found. Please contact support.',
    CONFLICT:                       'Duplicate request. Please wait a moment and try again.',
    RATE_LIMITED:                   'Too many attempts. Please wait a minute and try again.',
    INTERNAL_SERVER_ERROR:          'Payment provider temporarily unavailable. Please try again in a moment.',
    SERVICE_UNAVAILABLE:            'Payment provider temporarily unavailable. Please try again in a moment.',
    GATEWAY_TIMEOUT:                'Payment provider timed out. Please try again.',
  };
  if (map[code]) return { message: map[code], code };
  // Field-specific fallbacks when no code matches
  if (field && field.toLowerCase().indexOf('card') !== -1) return { message: 'Card details are invalid. Please re-enter them.', code: code || 'CARD_INVALID' };
  if (safeDetail) return { message: 'Payment error: ' + safeDetail, code: code || 'UNKNOWN' };
  return { message: fallback || 'Payment provider error. Please try again.', code: code || 'UNKNOWN' };
}

// ── Signup handler ──────────────────────────────────────────────────────────
/**
 * Public signup flow:
 *   1. Validate inputs
 *   2. Reject if email already has Firebase Auth account
 *   3. Reserve unique slug from restaurant name
 *   4. Create Square customer
 *   5. Attach card to customer via nonce (Square Cards API)
 *   6. Create Square subscription (plan_variation_id + card_id)
 *   7. Create tenant doc + seed default data + add owner to approved_emails
 *   8. Create Firebase Auth user with password
 *   9. Stamp JWT custom claims { tenantId, tenantSlug, approved, role }
 *  10. Return { tenantId, slug, appUrl }
 *
 * Idempotency/rollback: if any step 4-9 fails, we audit and return. A subsequent
 * retry with the same email is rejected at step 2. Partial tenant state (Square
 * customer created, but tenant not provisioned) is cleaned up by a periodic
 * reconcile job (Phase 2.5) — for now, admins fix via Firestore console.
 */
async function handleSignup(req, res) {
  setSecurityHeaders(res);

  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      res.status(400).json({ error: 'Content-Type must be application/json' });
      return;
    }

    // Rate limit per IP
    const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').toString().split(',')[0].trim();
    const rl = checkSignupRateLimit(ip);
    if (!rl.allowed) {
      res.status(429).json({ error: 'Too many signup attempts. Try again later.' });
      return;
    }

    // Validate
    const { valid, errors, normalized } = validateSignupInput(req.body || {});
    if (!valid) {
      res.status(400).json({ error: errors.join('; ') });
      return;
    }
    const { email, password, restaurantName, plan, cardNonce, cardholderName, verificationToken, termsVersion } = normalized;
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);

    // Payload size guard
    const sizeCheck = validateData(req.body);
    if (!sizeCheck.valid) {
      res.status(400).json({ error: sizeCheck.error });
      return;
    }

    // ── Step 2: Email-already-exists guard ────────────────────────────────
    try {
      await auth.getUserByEmail(email);
      res.status(409).json({ error: 'Account already exists for this email. Sign in instead.' });
      return;
    } catch (e) {
      // auth/user-not-found → good, continue. Any other error bubbles to outer catch.
      if (e && e.code !== 'auth/user-not-found') throw e;
    }

    // ── Step 3: Reserve unique slug ───────────────────────────────────────
    let slug = toSlug(restaurantName);
    if (!slug || slug.length < 2) {
      res.status(400).json({ error: 'Restaurant name must contain at least 2 alphanumeric characters' });
      return;
    }
    const slugSnap = await db.collection('tenants').where('slug', '==', slug).limit(1).get();
    if (!slugSnap.empty) slug = slug + '-' + Date.now().toString(36);

    // ── Step 4: Square customer ───────────────────────────────────────────
    let sqCustomer;
    try {
      sqCustomer = await square.createCustomer({
        email,
        givenName: cardholderName || restaurantName,
        referenceId: slug,
        note: `Restaurant Oracle — ${PLAN_CATALOG[plan].name} — ${restaurantName}`,
      });
    } catch (e) {
      console.error('[signup] Square customer creation failed:', e.message, e.body || '');
      const mapped = mapSquareErrorToMessage(e, 'Payment provider error. Please try again.');
      await writeAuditLog('signup', email, 'signup_failed_square_customer:' + mapped.code, null, 0, null);
      res.status(502).json({ error: mapped.message, code: mapped.code });
      return;
    }

    // ── Step 5: Attach card ───────────────────────────────────────────────
    let sqCard;
    try {
      sqCard = await square.createCard({
        sourceId: cardNonce,
        customerId: sqCustomer.id,
        cardholderName: cardholderName || undefined,
        verificationToken,
      });
    } catch (e) {
      console.error('[signup] Square card attach failed:', e.message, e.body || '');
      const mapped = mapSquareErrorToMessage(e, 'Card was declined or invalid. Please try a different card.');
      await writeAuditLog('signup', email, 'signup_failed_square_card:' + mapped.code, null, 0, null);
      res.status(402).json({ error: mapped.message, code: mapped.code });
      return;
    }

    // ── Step 6: Create subscription with 30-day free trial ────────────────
    // Square defers billing until start_date. Setting start_date = today + 30d
    // gives a 30-day free trial — the card is captured and verified up front,
    // but the first invoice fires 30 days in.
    const TRIAL_DAYS = 30;
    const trialStart = new Date();
    trialStart.setUTCDate(trialStart.getUTCDate() + TRIAL_DAYS);
    const trialStartDate = trialStart.toISOString().slice(0, 10); // YYYY-MM-DD
    let sqSubscription;
    try {
      sqSubscription = await square.createSubscription({
        customerId: sqCustomer.id,
        planVariationId: getPlanVariationId(plan),
        cardId: sqCard.id,
        locationId: process.env.SQUARE_LOCATION_ID,
        startDate: trialStartDate,
      });
    } catch (e) {
      console.error('[signup] Square subscription creation failed:', e.message, e.body || '');
      const mapped = mapSquareErrorToMessage(e, 'Could not start subscription. Please try again.');
      await writeAuditLog('signup', email, 'signup_failed_square_subscription:' + mapped.code, null, 0, null);
      res.status(502).json({ error: mapped.message, code: mapped.code });
      return;
    }

    // ── Step 7: Provision tenant in Firestore ─────────────────────────────
    const newTenantRef = db.collection('tenants').doc();
    const newTenantId = newTenantRef.id;

    await newTenantRef.set({
      slug,
      restaurantName: sanitizeString(restaurantName),
      ownerEmail: email,
      plan,
      status: 'active',
      onboardingComplete: false,
      squareCustomerId: sqCustomer.id,
      squareSubscriptionId: sqSubscription.id,
      squareSubscriptionStatus: sqSubscription.status || 'ACTIVE',
      squareCardId: sqCard.id,
      squareLocationId: process.env.SQUARE_LOCATION_ID || null,
      trialEndsAt: admin.firestore.Timestamp.fromDate(trialStart),
      termsAcceptedAt: admin.firestore.FieldValue.serverTimestamp(),
      termsVersion,
      termsAcceptedIp: ip,
      termsAcceptedUserAgent: userAgent,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Seed default data
    const seedData = getDefaultSeedData();
    const batch = db.batch();
    for (const [col, items] of Object.entries(seedData)) {
      for (const item of items) {
        const ref = db.collection('tenants').doc(newTenantId).collection(col).doc(String(item.id));
        batch.set(ref, item);
      }
    }
    await batch.commit();

    // Add owner to approved_emails
    await db.collection('tenants').doc(newTenantId).collection('approved_emails').add({
      email,
      role: 'owner',
      added_by: 'signup_flow',
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    // ── Step 8: Create Firebase Auth user ─────────────────────────────────
    let ownerUid;
    try {
      const newUser = await auth.createUser({
        email,
        password,
        emailVerified: false,
      });
      ownerUid = newUser.uid;
    } catch (e) {
      console.error('[signup] Firebase Auth user creation failed:', e.message);
      // Tenant is provisioned but user doesn't exist — partial state.
      // Mark tenant for reconciliation.
      await newTenantRef.update({ status: 'pending_user_creation', reconcileNeeded: true });
      await writeAuditLog('signup', email, 'signup_failed_auth_user', newTenantId, 0, newTenantId);
      res.status(500).json({ error: 'Account provisioning failed. Please contact support.' });
      return;
    }

    // ── Step 9: Stamp JWT custom claims ───────────────────────────────────
    await auth.setCustomUserClaims(ownerUid, {
      tenantId: newTenantId,
      tenantSlug: slug,
      approved: true,
      role: 'owner',
    });

    await writeAuditLog(ownerUid, email, 'signup_success', newTenantId, 1, newTenantId);

    // ── Step 9.5: Run provisioning agent (idempotent seed + provisioning_complete flag) ─
    try {
      await agents.runProvisioning({ tenantId: newTenantId, ownerEmail: email, plan });
    } catch (e) {
      console.warn('[signup] provisioning agent non-fatal warning:', e.message);
    }

    // ── Step 9.6: Welcome email (non-fatal) ───────────────────────────────
    try {
      await emails.sendEmail(email, 'owner_welcome', {
        tenantId: newTenantId,
        restaurantName,
        plan: PLAN_CATALOG[plan].name,
        trialEndsAt: trialStart.toISOString(),
      });
    } catch (e) {
      console.warn('[signup] welcome email non-fatal:', e.message);
    }

    // ── Step 10: Return result ────────────────────────────────────────────
    res.status(200).json({
      data: {
        tenantId: newTenantId,
        slug,
        appUrl: `https://restaurantoracle.app/user/${slug}`,
        ownerUid,
      },
      error: null,
    });
  } catch (error) {
    console.error('[signup] Unhandled error:', error.message, error.stack);
    captureError(error, req, 'signupTenant');
    res.status(500).json({ error: 'Internal server error' });
  }
}

exports.signupTenant = functions
  .region('us-central1')
  .runWith({
    maxInstances: 10,
    timeoutSeconds: 60,
    secrets: [
      'SQUARE_ACCESS_TOKEN',
      'SQUARE_LOCATION_ID',
      'SQUARE_PLAN_VAR_STARTER',
      'SQUARE_PLAN_VAR_PRO',
      'SQUARE_PLAN_VAR_SCALE',
      'SQUARE_ENV',
      'RESEND_API_KEY',
      'SENTRY_DSN',
    ],
  })
  .https.onRequest((req, res) => {
    signupCors(req, res, () => handleSignup(req, res));
  });

// ════════════════════════════════════════════════════════════════════════════
//  SQUARE WEBHOOK
// ════════════════════════════════════════════════════════════════════════════

/**
 * Map Square subscription status → tenant status.
 * Square statuses: ACTIVE | PAUSED | DEACTIVATED | CANCELED | PENDING
 */
function mapSquareStatusToTenantStatus(sqStatus) {
  switch ((sqStatus || '').toUpperCase()) {
    case 'ACTIVE':
    case 'PENDING':
      return 'active';
    case 'PAUSED':
      return 'suspended';
    case 'CANCELED':
    case 'DEACTIVATED':
      return 'cancelled';
    default:
      return 'active';
  }
}

/**
 * Resolve tenantId from a Square subscription ID. Returns null if not found.
 */
async function tenantBySquareSubscriptionId(subscriptionId) {
  if (!subscriptionId) return null;
  const snap = await db.collection('tenants')
    .where('squareSubscriptionId', '==', subscriptionId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, doc: snap.docs[0], data: snap.docs[0].data() };
}

/**
 * Handle a subscription lifecycle event. Square emits events like:
 *   subscription.created, subscription.updated, subscription.canceled
 *   invoice.created, invoice.published, invoice.payment_made, invoice.scheduled_charge_failed
 */
async function handleSquareSubscriptionEvent(event) {
  const obj = event && event.data && event.data.object;
  if (!obj) return;

  // Event payloads differ: subscription events wrap .subscription, invoice events wrap .invoice
  const sub = obj.subscription;
  const inv = obj.invoice;

  if (sub) {
    const tenant = await tenantBySquareSubscriptionId(sub.id);
    if (!tenant) {
      console.warn('[webhook] No tenant for Square subscription', sub.id);
      return;
    }
    const priorSqStatus  = (tenant.data.squareSubscriptionStatus || '').toUpperCase();
    const newSqStatus    = (sub.status || '').toUpperCase();
    const tenantStatus   = mapSquareStatusToTenantStatus(sub.status);
    await tenant.doc.ref.update({
      status: tenantStatus,
      squareSubscriptionStatus: sub.status || null,
      lastWebhookEvent: event.type,
      lastWebhookAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await writeAuditLog('square_webhook', 'webhook@square', `webhook_${event.type}`, null, 0, tenant.id);

    // Email on ACTIVE → CANCELED transition (user-initiated via admin ops OR
    // cancelled from Square dashboard). Belt-and-suspenders with adminOpCancel.
    if (newSqStatus === 'CANCELED' && priorSqStatus && priorSqStatus !== 'CANCELED') {
      try {
        await emails.sendEmail(tenant.data.ownerEmail, 'subscription_cancelled', {
          tenantId: tenant.id,
          restaurantName: tenant.data.restaurantName,
          endsAt: sub.charged_through_date || null,
        });
      } catch (e) { console.warn('[webhook] cancelled email failed:', e.message); }
    }
    return;
  }

  if (inv) {
    const tenant = await tenantBySquareSubscriptionId(inv.subscription_id);
    if (!tenant) return;
    const patch = {
      lastWebhookEvent: event.type,
      lastWebhookAt: admin.firestore.FieldValue.serverTimestamp(),
      lastInvoiceStatus: inv.status || null,
    };
    if (event.type === 'invoice.scheduled_charge_failed') {
      patch.status = 'past_due';
    }
    await tenant.doc.ref.update(patch);
    await writeAuditLog('square_webhook', 'webhook@square', `webhook_${event.type}`, null, 0, tenant.id);

    // Invoice-triggered emails (dedupe by invoice ID)
    const invoiceId = inv.id || null;
    const sentFlag = `emailSent_${event.type.replace(/\./g, '_')}_${invoiceId || 'none'}`;
    if (invoiceId && tenant.data[sentFlag]) {
      return;
    }

    const amountCents = extractInvoiceAmountCents(inv);
    const planInfo = PLAN_CATALOG[tenant.data.plan] || {};

    if (event.type === 'invoice.payment_made') {
      try {
        await emails.sendEmail(tenant.data.ownerEmail, 'first_charge_receipt', {
          tenantId: tenant.id,
          restaurantName: tenant.data.restaurantName,
          plan: planInfo.name || tenant.data.plan,
          amountCents: amountCents || planInfo.priceCents,
          priceCents: planInfo.priceCents,
          last4: tenant.data.cardLast4 || null,
          invoiceId,
          paidAt: extractInvoicePaidAt(inv),
          nextBillingDate: extractInvoiceNextBillingDate(inv),
        });
        if (invoiceId) await tenant.doc.ref.update({ [sentFlag]: admin.firestore.FieldValue.serverTimestamp() });
      } catch (e) { console.warn('[webhook] receipt email failed:', e.message); }
    } else if (event.type === 'invoice.scheduled_charge_failed' || event.type === 'invoice.payment_failed') {
      try {
        await emails.sendEmail(tenant.data.ownerEmail, 'payment_failed', {
          tenantId: tenant.id,
          restaurantName: tenant.data.restaurantName,
          plan: planInfo.name || tenant.data.plan,
          amountCents: amountCents || planInfo.priceCents,
          priceCents: planInfo.priceCents,
          last4: tenant.data.cardLast4 || null,
          invoiceId,
        });
        if (invoiceId) await tenant.doc.ref.update({ [sentFlag]: admin.firestore.FieldValue.serverTimestamp() });
      } catch (e) { console.warn('[webhook] payment_failed email failed:', e.message); }
    }
    return;
  }
}

// Square invoice payloads vary — extract safely.
function extractInvoiceAmountCents(inv) {
  if (!inv) return 0;
  const candidates = [
    inv.payment_requests && inv.payment_requests[0] && inv.payment_requests[0].total_completed_amount_money,
    inv.payment_requests && inv.payment_requests[0] && inv.payment_requests[0].computed_amount_money,
    inv.next_payment_amount_money,
  ];
  for (const c of candidates) {
    if (c && typeof c.amount === 'number') return c.amount;
  }
  return 0;
}
function extractInvoicePaidAt(inv) {
  if (!inv) return null;
  const pr = inv.payment_requests && inv.payment_requests[0];
  return (pr && (pr.paid_at || pr.completed_at)) || inv.updated_at || null;
}
function extractInvoiceNextBillingDate(inv) {
  if (!inv) return null;
  const pr = inv.payment_requests && inv.payment_requests[1];
  return (pr && pr.due_date) || null;
}

async function handleSquareWebhook(req, res) {
  setSecurityHeaders(res);
  try {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    if (!signatureKey) {
      console.error('[webhook] SQUARE_WEBHOOK_SIGNATURE_KEY not configured');
      res.status(500).send('not configured');
      return;
    }

    const signatureHeader = req.headers['x-square-hmacsha256-signature'];
    if (!signatureHeader) {
      res.status(401).send('missing signature');
      return;
    }

    // Firebase populates req.rawBody as a Buffer for onRequest functions.
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});

    // Notification URL Square was configured to POST to. Must match exactly.
    const notificationUrl = process.env.SQUARE_WEBHOOK_URL
      || 'https://us-central1-restaurant-oracle.cloudfunctions.net/squareWebhook';

    const verified = square.verifyWebhookSignature({
      signatureHeader,
      body: rawBody,
      url: notificationUrl,
      signatureKey,
    });

    if (!verified) {
      console.warn('[webhook] Signature verification failed');
      await writeAuditLog('square_webhook', 'webhook@square', 'webhook_signature_invalid', null, 0, null);
      res.status(401).send('invalid signature');
      return;
    }

    const event = req.body;
    if (!event || !event.type) {
      res.status(400).send('invalid event');
      return;
    }

    // Valid event types per Square 2025-01-23. Cancellations come through
    // subscription.updated with status=CANCELED (no standalone subscription.canceled).
    // Payment failures come through invoice.scheduled_charge_failed.
    const routableTypes = [
      'subscription.created',
      'subscription.updated',
      'invoice.created',
      'invoice.published',
      'invoice.payment_made',
      'invoice.scheduled_charge_failed',
      'invoice.canceled',
    ];
    if (routableTypes.includes(event.type)) {
      await handleSquareSubscriptionEvent(event);
    } else {
      // Log unrecognized events but 200 so Square doesn't retry
      console.log('[webhook] Ignoring event type:', event.type);
    }

    res.status(200).send('ok');
  } catch (error) {
    console.error('[webhook] Unhandled error:', error.message, error.stack);
    captureError(error, req, 'squareWebhook');
    // Return 500 so Square retries — BUT we've already processed via signature
    // check, so this only fires on Firestore / downstream errors.
    res.status(500).send('error');
  }
}

exports.squareWebhook = functions
  .region('us-central1')
  .runWith({
    maxInstances: 10,
    timeoutSeconds: 30,
    secrets: ['SQUARE_WEBHOOK_SIGNATURE_KEY', 'RESEND_API_KEY', 'SENTRY_DSN'],
  })
  .https.onRequest(handleSquareWebhook);

// ════════════════════════════════════════════════════════════════════════════
//  PHASE 2 — OWNER ADMIN BILLING ENDPOINT
// ════════════════════════════════════════════════════════════════════════════
// Authenticated HTTPS endpoint for owner-only operations: plan change, card
// update, subscription cancellation, team management. Every op re-verifies
// role=owner from JWT claims against the tenant doc as defense-in-depth.

async function requireOwner(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Missing authorization header' };
  }
  const idToken = authHeader.replace('Bearer ', '');
  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken, true);
  } catch (e) {
    return { ok: false, status: 401, error: 'Invalid token' };
  }
  const signInProvider = decoded.firebase && decoded.firebase.sign_in_provider;
  if (signInProvider === 'password' && decoded.email_verified !== true) {
    return { ok: false, status: 403, error: 'Email not verified. Check your inbox for the verification link.' };
  }
  const tenantId = decoded.tenantId;
  const role = decoded.role;
  if (!tenantId) return { ok: false, status: 400, error: 'No tenant bound to this account' };
  if (role !== 'owner' && role !== 'admin') {
    return { ok: false, status: 403, error: 'Owner access required' };
  }
  // Defense-in-depth: re-verify ownership against approved_emails
  const approvalSnap = await db.collection('tenants').doc(tenantId)
    .collection('approved_emails')
    .where('email', '==', (decoded.email || '').toLowerCase())
    .limit(1)
    .get();
  if (approvalSnap.empty) {
    return { ok: false, status: 403, error: 'Not on approved list for this tenant' };
  }
  const approvalRole = approvalSnap.docs[0].data().role;
  if (approvalRole !== 'owner' && approvalRole !== 'admin') {
    return { ok: false, status: 403, error: 'Owner role required (Firestore)' };
  }
  return {
    ok: true,
    userId: decoded.uid,
    userEmail: (decoded.email || '').toLowerCase(),
    tenantId,
    role: approvalRole,
  };
}

// ── Per-op handlers ─────────────────────────────────────────────────────────
async function adminOpGetInfo(ctx) {
  const tenantDoc = await db.collection('tenants').doc(ctx.tenantId).get();
  if (!tenantDoc.exists) return { error: 'Tenant not found' };
  const t = tenantDoc.data();

  // Fetch live subscription + card state from Square
  let subscription = null, card = null;
  try {
    if (t.squareSubscriptionId) {
      subscription = await square.retrieveSubscription({ subscriptionId: t.squareSubscriptionId });
    }
  } catch (e) { console.warn('[admin] retrieveSubscription failed:', e.message); }
  try {
    if (t.squareCardId) {
      card = await square.retrieveCard({ cardId: t.squareCardId });
    }
  } catch (e) { console.warn('[admin] retrieveCard failed:', e.message); }

  // Team members (approved_emails)
  const teamSnap = await db.collection('tenants').doc(ctx.tenantId)
    .collection('approved_emails').get();
  // created_at may be a Firestore Timestamp, JS Date, ISO string, or epoch ms
  // depending on which migration path stamped it. Normalize to ISO string.
  const toIso = (v) => {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'number') return new Date(v).toISOString();
    if (typeof v === 'string') return v;
    return null;
  };
  const team = teamSnap.docs.map(d => ({
    id: d.id,
    email: d.data().email,
    role: d.data().role,
    added_by: d.data().added_by || null,
    created_at: toIso(d.data().created_at),
  }));

  return {
    data: {
      tenant: {
        id: ctx.tenantId,
        slug: t.slug,
        restaurantName: t.restaurantName,
        ownerEmail: t.ownerEmail,
        plan: t.plan,
        status: t.status,
        onboardingComplete: !!t.onboardingComplete,
        createdAt: toIso(t.createdAt),
      },
      subscription: subscription ? {
        id: subscription.id,
        status: subscription.status,
        startDate: subscription.start_date || null,
        canceledDate: subscription.canceled_date || null,
        chargedThroughDate: subscription.charged_through_date || null,
        planVariationId: subscription.plan_variation_id,
      } : null,
      card: card ? {
        id: card.id,
        last4: card.last_4,
        cardBrand: card.card_brand,
        expMonth: card.exp_month,
        expYear: card.exp_year,
        cardholderName: card.cardholder_name || null,
        enabled: card.enabled !== false,
      } : null,
      plans: Object.entries(PLAN_CATALOG).map(([slug, info]) => ({
        slug,
        name: info.name,
        priceCents: info.priceCents,
        current: slug === t.plan,
      })),
      team,
    },
  };
}

async function adminOpChangePlan(ctx, params) {
  const newPlan = String(params.plan || '').toLowerCase();
  if (!PLAN_CATALOG[newPlan]) return { error: 'Invalid plan', status: 400 };

  const tenantRef = db.collection('tenants').doc(ctx.tenantId);
  const tenantDoc = await tenantRef.get();
  const t = tenantDoc.data();
  if (t.plan === newPlan) return { error: 'Already on that plan', status: 400 };
  if (!t.squareSubscriptionId) return { error: 'No active subscription', status: 400 };

  const newVarId = getPlanVariationId(newPlan);
  let updated;
  try {
    updated = await square.swapSubscriptionPlan({
      subscriptionId: t.squareSubscriptionId,
      newPlanVariationId: newVarId,
    });
  } catch (e) {
    console.error('[admin] swapSubscriptionPlan failed:', e.message, e.body || '');
    return { error: 'Plan change failed at payment provider', status: 502 };
  }

  await tenantRef.update({
    plan: newPlan,
    planChangedAt: admin.firestore.FieldValue.serverTimestamp(),
    planChangedBy: ctx.userEmail,
    squareSubscriptionStatus: updated.status || t.squareSubscriptionStatus,
  });
  await writeAuditLog(ctx.userId, ctx.userEmail, 'plan_changed', null, 1, ctx.tenantId);
  return { data: { plan: newPlan, subscription: { id: updated.id, status: updated.status } } };
}

async function adminOpUpdatePaymentMethod(ctx, params) {
  const cardNonce = String(params.cardNonce || '');
  if (!/^cnon:[A-Za-z0-9_-]+$/.test(cardNonce)) return { error: 'Invalid card token', status: 400 };
  const cardholderName = String(params.cardholderName || '').trim() || undefined;
  const verificationToken = params.verificationToken ? String(params.verificationToken) : undefined;

  const tenantRef = db.collection('tenants').doc(ctx.tenantId);
  const t = (await tenantRef.get()).data();
  if (!t.squareCustomerId || !t.squareSubscriptionId) return { error: 'No billing account', status: 400 };

  // 1. Create new card on existing Square customer
  let newCard;
  try {
    newCard = await square.createCard({
      sourceId: cardNonce,
      customerId: t.squareCustomerId,
      cardholderName,
      verificationToken,
    });
  } catch (e) {
    console.error('[admin] createCard failed:', e.message, e.body || '');
    return { error: 'Card was declined or invalid', status: 402 };
  }

  // 2. Point subscription at new card
  let updatedSub;
  try {
    updatedSub = await square.updateSubscriptionCard({
      subscriptionId: t.squareSubscriptionId,
      cardId: newCard.id,
    });
  } catch (e) {
    console.error('[admin] updateSubscriptionCard failed:', e.message, e.body || '');
    return { error: 'Could not attach new card to subscription', status: 502 };
  }

  // 3. Disable the old card (best-effort — don't fail if it errors)
  const oldCardId = t.squareCardId;
  if (oldCardId && oldCardId !== newCard.id) {
    try { await square.disableCard({ cardId: oldCardId }); }
    catch (e) { console.warn('[admin] disable old card failed:', e.message); }
  }

  await tenantRef.update({
    squareCardId: newCard.id,
    cardLast4: newCard.last_4 || null,
    cardBrand: newCard.card_brand || null,
    cardUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    cardUpdatedBy: ctx.userEmail,
  });
  await writeAuditLog(ctx.userId, ctx.userEmail, 'payment_method_updated', null, 1, ctx.tenantId);
  return { data: { cardId: newCard.id, last4: newCard.last_4, brand: newCard.card_brand } };
}

async function adminOpCancelSubscription(ctx) {
  const tenantRef = db.collection('tenants').doc(ctx.tenantId);
  const t = (await tenantRef.get()).data();
  if (!t.squareSubscriptionId) return { error: 'No active subscription', status: 400 };

  let canceled;
  try {
    canceled = await square.cancelSubscription({ subscriptionId: t.squareSubscriptionId });
  } catch (e) {
    console.error('[admin] cancelSubscription failed:', e.message, e.body || '');
    return { error: 'Cancel failed at payment provider', status: 502 };
  }

  await tenantRef.update({
    squareSubscriptionStatus: canceled.status || 'CANCELED',
    canceledAt: admin.firestore.FieldValue.serverTimestamp(),
    canceledBy: ctx.userEmail,
  });
  await writeAuditLog(ctx.userId, ctx.userEmail, 'subscription_canceled', null, 1, ctx.tenantId);
  try {
    await emails.sendEmail(t.ownerEmail || ctx.userEmail, 'subscription_cancelled', {
      tenantId: ctx.tenantId,
      restaurantName: t.restaurantName,
      endsAt: canceled.charged_through_date || null,
    });
  } catch (e) { console.warn('[admin] cancel email failed:', e.message); }
  return {
    data: {
      status: canceled.status,
      chargedThroughDate: canceled.charged_through_date || null,
    },
  };
}

async function adminOpResumeSubscription(ctx) {
  const tenantRef = db.collection('tenants').doc(ctx.tenantId);
  const t = (await tenantRef.get()).data();
  if (!t.squareSubscriptionId) return { error: 'No subscription to resume', status: 400 };

  let resumed;
  try {
    resumed = await square.resumeSubscription({ subscriptionId: t.squareSubscriptionId });
  } catch (e) {
    console.error('[admin] resumeSubscription failed:', e.message, e.body || '');
    return { error: 'Resume failed at payment provider', status: 502 };
  }
  await tenantRef.update({
    squareSubscriptionStatus: resumed.status || 'ACTIVE',
    canceledAt: admin.firestore.FieldValue.delete(),
    resumedAt: admin.firestore.FieldValue.serverTimestamp(),
    resumedBy: ctx.userEmail,
  });
  await writeAuditLog(ctx.userId, ctx.userEmail, 'subscription_resumed', null, 1, ctx.tenantId);
  try {
    const planInfo = PLAN_CATALOG[t.plan] || {};
    await emails.sendEmail(t.ownerEmail || ctx.userEmail, 'subscription_reactivated', {
      tenantId: ctx.tenantId,
      restaurantName: t.restaurantName,
      plan: planInfo.name || t.plan,
      last4: t.cardLast4 || null,
      nextBillingDate: resumed.charged_through_date || null,
    });
  } catch (e) { console.warn('[admin] resume email failed:', e.message); }
  return { data: { status: resumed.status } };
}

async function adminOpInviteTeamMember(ctx, params) {
  const inviteEmail = String(params.email || '').trim().toLowerCase();
  const rawRole = String(params.role || 'employee').toLowerCase();
  const role = ['owner', 'admin', 'employee'].includes(rawRole) ? rawRole : 'employee';
  if (!inviteEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) {
    return { error: 'Valid email required', status: 400 };
  }

  // Already on team?
  const dupSnap = await db.collection('tenants').doc(ctx.tenantId)
    .collection('approved_emails').where('email', '==', inviteEmail).limit(1).get();
  if (!dupSnap.empty) return { error: 'Email already on team', status: 409 };

  // Does a Firebase Auth user exist?
  let uid = null;
  try {
    const user = await auth.getUserByEmail(inviteEmail);
    uid = user.uid;
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      try {
        const newUser = await auth.createUser({ email: inviteEmail, emailVerified: false, disabled: false });
        uid = newUser.uid;
      } catch (createErr) {
        console.error('[admin] createUser failed:', createErr.message);
        return { error: 'Could not create user account', status: 500 };
      }
    } else {
      throw e;
    }
  }

  // Stamp claims
  try {
    const existing = (await auth.getUser(uid)).customClaims || {};
    await auth.setCustomUserClaims(uid, {
      ...existing,
      tenantId: ctx.tenantId,
      role,
      approved: false, // becomes true on first login via checkEmailWhitelist
    });
  } catch (e) { console.warn('[admin] claim stamp failed:', e.message); }

  // Approval row
  const docRef = await db.collection('tenants').doc(ctx.tenantId)
    .collection('approved_emails').add({
      email: inviteEmail,
      role,
      added_by: ctx.userEmail,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

  // Password setup link
  let setupLink = null;
  try {
    setupLink = await auth.generatePasswordResetLink(inviteEmail, {
      url: 'https://restaurantoracle.app/',
      handleCodeInApp: false,
    });
  } catch (e) { console.warn('[admin] password reset link failed:', e.message); }

  await writeAuditLog(ctx.userId, ctx.userEmail, 'team_member_invited', inviteEmail, 1, ctx.tenantId);

  try {
    const tenantDoc = await db.collection('tenants').doc(ctx.tenantId).get();
    const tData = tenantDoc.exists ? tenantDoc.data() : {};
    await emails.sendEmail(inviteEmail, 'team_invite', {
      tenantId: ctx.tenantId,
      restaurantName: tData.restaurantName || 'Restaurant Oracle',
      inviterName: ctx.userEmail,
      inviteeRole: role,
      setupLink,
    });
  } catch (e) { console.warn('[admin] invite email failed:', e.message); }

  return { data: { id: docRef.id, email: inviteEmail, role, uid, setupLink } };
}

async function adminOpRemoveTeamMember(ctx, params) {
  const memberId = String(params.memberId || '');
  if (!memberId) return { error: 'memberId required', status: 400 };
  const ref = db.collection('tenants').doc(ctx.tenantId).collection('approved_emails').doc(memberId);
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Team member not found', status: 404 };
  const data = snap.data();
  if (data.email === ctx.userEmail) return { error: 'Cannot remove yourself', status: 400 };

  await ref.delete();

  // Revoke JWT claim (best-effort)
  try {
    const user = await auth.getUserByEmail(data.email);
    const existing = user.customClaims || {};
    await auth.setCustomUserClaims(user.uid, { ...existing, approved: false });
    await auth.revokeRefreshTokens(user.uid);
  } catch (e) { /* user might not exist */ }

  await writeAuditLog(ctx.userId, ctx.userEmail, 'team_member_removed', data.email, 1, ctx.tenantId);
  return { data: { removed: true, email: data.email } };
}

async function adminOpUpdateMemberRole(ctx, params) {
  const memberId = String(params.memberId || '');
  const rawRole = String(params.role || '').toLowerCase();
  if (!memberId) return { error: 'memberId required', status: 400 };
  if (!['owner', 'admin', 'employee'].includes(rawRole)) {
    return { error: 'Invalid role', status: 400 };
  }
  const ref = db.collection('tenants').doc(ctx.tenantId).collection('approved_emails').doc(memberId);
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Team member not found', status: 404 };
  const data = snap.data();
  if (data.email === ctx.userEmail && rawRole !== 'owner') {
    return { error: 'Cannot demote yourself', status: 400 };
  }

  await ref.update({ role: rawRole, roleChangedAt: admin.firestore.FieldValue.serverTimestamp(), roleChangedBy: ctx.userEmail });

  // Update JWT claim
  try {
    const user = await auth.getUserByEmail(data.email);
    const existing = user.customClaims || {};
    await auth.setCustomUserClaims(user.uid, { ...existing, role: rawRole });
  } catch (e) { /* ignore */ }

  await writeAuditLog(ctx.userId, ctx.userEmail, 'team_member_role_changed', data.email, 1, ctx.tenantId);
  return { data: { memberId, email: data.email, role: rawRole } };
}

async function adminOpCompleteOnboarding(ctx) {
  const tenantRef = db.collection('tenants').doc(ctx.tenantId);
  await tenantRef.update({
    onboardingComplete: true,
    onboardingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
    onboardingCompletedBy: ctx.userEmail,
  });
  await writeAuditLog(ctx.userId, ctx.userEmail, 'onboarding_completed', null, 1, ctx.tenantId);
  return { data: { onboardingComplete: true } };
}

// ── Dispatcher ──────────────────────────────────────────────────────────────
const ADMIN_OPS = {
  getInfo:              adminOpGetInfo,
  changePlan:           adminOpChangePlan,
  updatePaymentMethod:  adminOpUpdatePaymentMethod,
  cancelSubscription:   adminOpCancelSubscription,
  resumeSubscription:   adminOpResumeSubscription,
  inviteTeamMember:     adminOpInviteTeamMember,
  removeTeamMember:     adminOpRemoveTeamMember,
  updateMemberRole:     adminOpUpdateMemberRole,
  completeOnboarding:   adminOpCompleteOnboarding,
};

async function handleAdminBilling(req, res) {
  setSecurityHeaders(res);
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const ct = req.headers['content-type'];
    if (!ct || !ct.includes('application/json')) {
      res.status(400).json({ error: 'Content-Type must be application/json' });
      return;
    }

    const authCtx = await requireOwner(req);
    if (!authCtx.ok) {
      res.status(authCtx.status || 401).json({ error: authCtx.error });
      return;
    }

    const rateCheck = checkRateLimit(authCtx.userId);
    if (!rateCheck.allowed) {
      await writeAuditLog(authCtx.userId, authCtx.userEmail, 'admin_rate_limit_exceeded', null, 0, authCtx.tenantId);
      res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
      return;
    }

    const op = String((req.body && req.body.op) || '');
    const handler = ADMIN_OPS[op];
    if (!handler) { res.status(400).json({ error: 'Unknown operation: ' + op }); return; }

    // Cancelled/suspended tenants can only view status, update card, or resume
    // (not invite/remove members, not change plan, not cancel again).
    const cancelledSafeOps = new Set(['getInfo', 'updatePaymentMethod', 'resumeSubscription']);
    if (!cancelledSafeOps.has(op)) {
      const tenantDoc = await db.collection('tenants').doc(authCtx.tenantId).get();
      const tenantStatus = tenantDoc.exists
        ? String(tenantDoc.data().status || 'active').toLowerCase()
        : 'active';
      if (tenantStatus === 'suspended' || tenantStatus === 'cancelled' || tenantStatus === 'canceled') {
        await writeAuditLog(authCtx.userId, authCtx.userEmail, 'admin_blocked_tenant_status:' + op, null, 0, authCtx.tenantId);
        res.status(402).json({
          error: tenantStatus === 'suspended'
            ? 'Account is suspended. Contact support@restaurantoracle.com.'
            : 'Subscription is cancelled. Reactivate from Billing to continue.',
        });
        return;
      }
    }

    const result = await handler(authCtx, req.body || {});
    if (result.error) {
      res.status(result.status || 400).json({ error: result.error });
      return;
    }
    res.status(200).json({ data: result.data, error: null });
  } catch (error) {
    console.error('[adminBilling] Unhandled:', error.message, error.stack);
    captureError(error, req, 'adminBilling');
    res.status(500).json({ error: 'Internal server error' });
  }
}

exports.adminBilling = functions
  .region('us-central1')
  .runWith({
    maxInstances: 10,
    timeoutSeconds: 60,
    secrets: [
      'SQUARE_ACCESS_TOKEN',
      'SQUARE_LOCATION_ID',
      'SQUARE_PLAN_VAR_STARTER',
      'SQUARE_PLAN_VAR_PRO',
      'SQUARE_PLAN_VAR_SCALE',
      'SQUARE_ENV',
      'RESEND_API_KEY',
      'SENTRY_DSN',
    ],
  })
  .https.onRequest((req, res) => {
    cors(req, res, () => handleAdminBilling(req, res));
  });

// ════════════════════════════════════════════════════════════════════════════
//  PHASE 2 — SUPER-ADMIN CONSOLE ENDPOINT
// ════════════════════════════════════════════════════════════════════════════
// Platform-operator-only endpoint: list every tenant, compute MRR, inspect
// individual tenants, suspend/unsuspend, force-cancel subscriptions, grant or
// revoke super_admin status to other users. Auth = Firebase JWT with
// customClaims.superAdmin === true.

const PLAN_PRICES_CENTS = {
  starter: 2900,
  pro: 4900,
  scale: 9900,
};

async function requireSuperAdmin(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Missing authorization header' };
  }
  const idToken = authHeader.replace('Bearer ', '');
  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken, true); // checkRevoked=true
  } catch (e) {
    return { ok: false, status: 401, error: 'Invalid token' };
  }
  if (decoded.superAdmin !== true) {
    // Defense-in-depth: re-fetch from Auth to detect stale tokens
    try {
      const userRecord = await auth.getUser(decoded.uid);
      if (!userRecord.customClaims || userRecord.customClaims.superAdmin !== true) {
        return { ok: false, status: 403, error: 'super_admin access required' };
      }
    } catch (e) {
      return { ok: false, status: 403, error: 'super_admin access required' };
    }
  }
  return {
    ok: true,
    userId: decoded.uid,
    userEmail: (decoded.email || '').toLowerCase(),
  };
}

// ── Super-admin op handlers ─────────────────────────────────────────────────

async function superOpDashboard(/*ctx*/) {
  const snap = await db.collection('tenants').get();
  const tenants = [];
  snap.forEach(d => tenants.push({ id: d.id, ...d.data() }));

  const stats = {
    totalTenants: tenants.length,
    byStatus: {},
    byPlan: {},
    mrrCents: 0,
    newThisMonth: 0,
    canceledThisMonth: 0,
  };

  const now = Date.now();
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

  for (const t of tenants) {
    const status = (t.status || 'unknown').toLowerCase();
    const plan = (t.plan || 'unknown').toLowerCase();
    stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
    stats.byPlan[plan] = (stats.byPlan[plan] || 0) + 1;

    // MRR: only counts active (not suspended/canceled) subs
    if (status === 'active' && PLAN_PRICES_CENTS[plan]) {
      stats.mrrCents += PLAN_PRICES_CENTS[plan];
    }

    const createdAt = t.createdAt && t.createdAt.toMillis ? t.createdAt.toMillis() : 0;
    if (createdAt && createdAt >= monthAgo) stats.newThisMonth++;

    const canceledAt = t.canceledAt && t.canceledAt.toMillis ? t.canceledAt.toMillis() : 0;
    if (canceledAt && canceledAt >= monthAgo) stats.canceledThisMonth++;
  }

  return {
    data: {
      stats,
      generatedAt: new Date().toISOString(),
    },
  };
}

async function superOpListTenants(/*ctx*/) {
  const snap = await db.collection('tenants').orderBy('createdAt', 'desc').get().catch(async () => {
    // Fallback if index not ready or createdAt missing
    return await db.collection('tenants').get();
  });
  const tenants = [];
  snap.forEach(d => {
    const t = d.data() || {};
    tenants.push({
      id: d.id,
      slug: t.slug || d.id,
      restaurantName: t.restaurantName || t.restaurant_name || '',
      ownerEmail: t.ownerEmail || t.owner_email || '',
      plan: t.plan || 'unknown',
      status: t.status || 'unknown',
      createdAt: t.createdAt && t.createdAt.toMillis ? t.createdAt.toMillis() : null,
      squareSubscriptionId: t.squareSubscriptionId || null,
      squareCustomerId: t.squareCustomerId || null,
      suspendedAt: t.suspendedAt && t.suspendedAt.toMillis ? t.suspendedAt.toMillis() : null,
      suspendedReason: t.suspendedReason || null,
      onboardingComplete: !!t.onboardingComplete,
    });
  });
  return { data: { tenants } };
}

async function superOpGetTenantDetails(ctx, params) {
  const tenantId = String(params.tenantId || '');
  if (!tenantId) return { error: 'tenantId required', status: 400 };

  const tenantDoc = await db.collection('tenants').doc(tenantId).get();
  if (!tenantDoc.exists) return { error: 'Tenant not found', status: 404 };
  const t = tenantDoc.data();

  // Live Square state
  let subscription = null, card = null;
  try {
    if (t.squareSubscriptionId) {
      subscription = await square.retrieveSubscription({ subscriptionId: t.squareSubscriptionId });
    }
  } catch (e) { console.warn('[super] retrieveSubscription failed:', e.message); }
  try {
    if (t.squareCardId) {
      card = await square.retrieveCard({ cardId: t.squareCardId });
    }
  } catch (e) { console.warn('[super] retrieveCard failed:', e.message); }

  // Team members
  const teamSnap = await db.collection('tenants').doc(tenantId)
    .collection('approved_emails').get();
  const team = [];
  teamSnap.forEach(d => {
    const data = d.data();
    team.push({
      id: d.id,
      email: data.email,
      role: data.role,
      added_by: data.added_by || null,
      created_at: data.created_at && data.created_at.toMillis ? data.created_at.toMillis() : null,
    });
  });

  // Recent audit log (last 50)
  let audit = [];
  try {
    const auditSnap = await db.collection('tenants').doc(tenantId)
      .collection('audit_log').orderBy('timestamp', 'desc').limit(50).get();
    auditSnap.forEach(d => {
      const data = d.data();
      audit.push({
        id: d.id,
        timestamp: data.timestamp && data.timestamp.toMillis ? data.timestamp.toMillis() : null,
        action: data.action,
        email: data.email,
        operation: data.operation,
        collection: data.collection,
        success: data.success,
      });
    });
  } catch (e) { console.warn('[super] audit log read failed:', e.message); }

  return {
    data: {
      tenant: {
        id: tenantDoc.id,
        slug: t.slug,
        restaurantName: t.restaurantName || t.restaurant_name,
        ownerEmail: t.ownerEmail || t.owner_email,
        plan: t.plan,
        status: t.status,
        createdAt: t.createdAt && t.createdAt.toMillis ? t.createdAt.toMillis() : null,
        onboardingComplete: !!t.onboardingComplete,
        suspendedAt: t.suspendedAt && t.suspendedAt.toMillis ? t.suspendedAt.toMillis() : null,
        suspendedReason: t.suspendedReason || null,
        squareCustomerId: t.squareCustomerId || null,
        squareSubscriptionId: t.squareSubscriptionId || null,
        squareCardId: t.squareCardId || null,
      },
      subscription: subscription ? {
        id: subscription.id,
        status: subscription.status,
        startDate: subscription.start_date,
        canceledDate: subscription.canceled_date,
        chargedThroughDate: subscription.charged_through_date,
        planVariationId: subscription.plan_variation_id,
      } : null,
      card: card ? {
        id: card.id,
        last4: card.last_4,
        cardBrand: card.card_brand,
        expMonth: card.exp_month,
        expYear: card.exp_year,
        cardholderName: card.cardholder_name,
        enabled: card.enabled,
      } : null,
      team,
      audit,
    },
  };
}

async function superOpSuspendTenant(ctx, params) {
  const tenantId = String(params.tenantId || '');
  const reason = String(params.reason || 'Administrative action');
  if (!tenantId) return { error: 'tenantId required', status: 400 };

  const tenantRef = db.collection('tenants').doc(tenantId);
  const snap = await tenantRef.get();
  if (!snap.exists) return { error: 'Tenant not found', status: 404 };

  await tenantRef.update({
    status: 'suspended',
    suspendedAt: admin.firestore.FieldValue.serverTimestamp(),
    suspendedBy: ctx.userEmail,
    suspendedReason: reason,
  });

  await writeAuditLog(ctx.userId, ctx.userEmail, 'super_admin_suspend', 'tenants', 1, tenantId);
  return { data: { tenantId, status: 'suspended', reason } };
}

async function superOpUnsuspendTenant(ctx, params) {
  const tenantId = String(params.tenantId || '');
  if (!tenantId) return { error: 'tenantId required', status: 400 };

  const tenantRef = db.collection('tenants').doc(tenantId);
  const snap = await tenantRef.get();
  if (!snap.exists) return { error: 'Tenant not found', status: 404 };

  await tenantRef.update({
    status: 'active',
    suspendedAt: admin.firestore.FieldValue.delete(),
    suspendedBy: admin.firestore.FieldValue.delete(),
    suspendedReason: admin.firestore.FieldValue.delete(),
    unsuspendedAt: admin.firestore.FieldValue.serverTimestamp(),
    unsuspendedBy: ctx.userEmail,
  });

  await writeAuditLog(ctx.userId, ctx.userEmail, 'super_admin_unsuspend', 'tenants', 1, tenantId);
  return { data: { tenantId, status: 'active' } };
}

async function superOpForceCancel(ctx, params) {
  const tenantId = String(params.tenantId || '');
  if (!tenantId) return { error: 'tenantId required', status: 400 };

  const tenantRef = db.collection('tenants').doc(tenantId);
  const snap = await tenantRef.get();
  if (!snap.exists) return { error: 'Tenant not found', status: 404 };
  const t = snap.data();

  let result = null;
  if (t.squareSubscriptionId) {
    try {
      result = await square.cancelSubscription({ subscriptionId: t.squareSubscriptionId });
    } catch (e) {
      console.warn('[super] forceCancel square error:', e.message);
      return { error: 'Square cancel failed: ' + e.message, status: 502 };
    }
  }

  await tenantRef.update({
    status: 'canceled',
    canceledAt: admin.firestore.FieldValue.serverTimestamp(),
    canceledBy: ctx.userEmail,
    canceledReason: 'force_cancel_by_super_admin',
  });

  await writeAuditLog(ctx.userId, ctx.userEmail, 'super_admin_force_cancel', 'tenants', 1, tenantId);
  return { data: { tenantId, status: 'canceled', subscription: result || null } };
}

async function superOpListSuperAdmins(/*ctx*/) {
  const admins = [];
  let nextPageToken;
  do {
    const page = await auth.listUsers(1000, nextPageToken);
    for (const u of page.users) {
      if (u.customClaims && u.customClaims.superAdmin === true) {
        admins.push({
          uid: u.uid,
          email: u.email,
          displayName: u.displayName || null,
          claims: u.customClaims,
        });
      }
    }
    nextPageToken = page.pageToken;
  } while (nextPageToken);
  return { data: { admins } };
}

async function superOpGrantSuperAdmin(ctx, params) {
  const email = String(params.email || '').trim().toLowerCase();
  if (!email) return { error: 'email required', status: 400 };

  let u;
  try {
    u = await auth.getUserByEmail(email);
  } catch (e) {
    return { error: 'User not found in Auth: ' + email, status: 404 };
  }

  const existing = u.customClaims || {};
  if (existing.superAdmin === true) {
    return { data: { email, alreadyGranted: true } };
  }
  const merged = { ...existing, superAdmin: true };
  await auth.setCustomUserClaims(u.uid, merged);
  await auth.revokeRefreshTokens(u.uid);

  await writeAuditLog(ctx.userId, ctx.userEmail, 'super_admin_granted', email, 1, null);
  return { data: { email, uid: u.uid, claims: merged } };
}

async function superOpRevokeSuperAdmin(ctx, params) {
  const email = String(params.email || '').trim().toLowerCase();
  if (!email) return { error: 'email required', status: 400 };
  if (email === ctx.userEmail) return { error: 'Cannot revoke your own super_admin status', status: 400 };

  let u;
  try {
    u = await auth.getUserByEmail(email);
  } catch (e) {
    return { error: 'User not found in Auth: ' + email, status: 404 };
  }

  const existing = u.customClaims || {};
  const merged = { ...existing };
  delete merged.superAdmin;
  await auth.setCustomUserClaims(u.uid, merged);
  await auth.revokeRefreshTokens(u.uid);

  await writeAuditLog(ctx.userId, ctx.userEmail, 'super_admin_revoked', email, 1, null);
  return { data: { email, uid: u.uid, claims: merged } };
}

// ════════════════════════════════════════════════════════════════════════════
//  OPERATOR DASHBOARD — RATE CARD, COST MODEL & ROLLUPS
// ════════════════════════════════════════════════════════════════════════════
// Pricing constants used by dailyTenantCostAggregation. These are Google/Gemini
// *list* rates that we multiply by observed usage to produce a USD estimate —
// not contractual — we show this to ourselves as an internal unit-cost tool.
const RATE_CARD = Object.freeze({
  firestoreReadPer100k:    0.036,      // $ per 100k document reads
  firestoreWritePer100k:   0.108,      // $ per 100k document writes
  firestoreDeletePer100k:  0.012,      // $ per 100k document deletes
  cfInvocationPer1M:       0.40,       // $ per million CF invocations
  cfGbSecondUsd:           0.0000025,  // $ per GB-second of CF compute
  cfMemoryGbDefault:       0.256,      // 256 MB (default CF memory)
  geminiInputPer1M:        0.075,      // Gemini 2.5 Flash input tokens
  geminiOutputPer1M:       0.30,       // Gemini 2.5 Flash output tokens
  resendPerEmail:          0.0004,     // ~$20 per 50k
});

// ── Shared audit helper that stamps super_admin_ prefix ─────────────────────
async function writeSuperAudit(ctx, action, tenantId, extra) {
  try {
    const entry = {
      user_id: ctx.userId,
      user_email: ctx.userEmail,
      tenant_id: tenantId || 'platform',
      operation: action.startsWith('super_admin_') ? action : ('super_admin_' + action),
      collection: 'operator_console',
      record_count: 1,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ...(extra || {}),
    };
    const ref = tenantId
      ? db.collection('tenants').doc(tenantId).collection('audit_log')
      : db.collection('audit_log');
    await ref.add(entry);
  } catch (e) {
    console.error('[writeSuperAudit] failed:', e.message);
  }
}

function ymdUtc(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ════════════════════════════════════════════════════════════════════════════
//  ENRICHED LISTING + OVERVIEW
// ════════════════════════════════════════════════════════════════════════════

async function superOpListTenantsEnriched(/*ctx*/) {
  const [tenantsSnap, healthSnap, metaSnap] = await Promise.all([
    db.collection('tenants').get(),
    db.collection('tenant_health').get().catch(() => ({ forEach: () => {} })),
    db.collection('tenant_meta').get().catch(() => ({ forEach: () => {} })),
  ]);

  const healthById = new Map();
  healthSnap.forEach(d => healthById.set(d.id, d.data()));
  const metaById = new Map();
  metaSnap.forEach(d => metaById.set(d.id, d.data()));

  const now = Date.now();
  const tenants = [];
  const ONE_DAY = 86400000;

  // For each tenant, also fetch open ticket count (count-aggregation for speed)
  const ticketCountPromises = [];
  tenantsSnap.forEach(doc => {
    ticketCountPromises.push(
      doc.ref.collection('support_tickets')
        .where('status', 'in', ['open', 'pending', 'waiting_customer'])
        .count().get()
        .then(c => ({ id: doc.id, count: c.data().count }))
        .catch(() => ({ id: doc.id, count: 0 }))
    );
  });
  const ticketCounts = await Promise.all(ticketCountPromises);
  const ticketCountById = new Map(ticketCounts.map(r => [r.id, r.count]));

  tenantsSnap.forEach(d => {
    const t = d.data() || {};
    const createdAtMs = t.createdAt && t.createdAt.toMillis ? t.createdAt.toMillis() : null;
    const trialEndsAtMs = t.trialEndsAt && t.trialEndsAt.toMillis ? t.trialEndsAt.toMillis() : null;
    const lastActivityMs = t.lastActivityAt && t.lastActivityAt.toMillis ? t.lastActivityAt.toMillis() : null;
    const daysIntoTrial = createdAtMs ? Math.floor((now - createdAtMs) / ONE_DAY) : null;

    // Onboarding progress — simple heuristic: sum of known milestones / total
    const milestones = [
      !!t.onboardingComplete,
      !!t.squareSubscriptionId,
      !!t.squareCardId,
      !!(t.ownerEmail),
      !!(t.restaurantName),
    ];
    const onboardingCompletePercent = Math.round(
      (milestones.filter(Boolean).length / milestones.length) * 100
    );

    const health = healthById.get(d.id) || {};
    const meta = metaById.get(d.id) || {};
    const plan = (t.plan || 'unknown').toLowerCase();
    const planEntry = PLAN_CATALOG[plan] || null;

    tenants.push({
      id: d.id,
      slug: t.slug || d.id,
      restaurantName: t.restaurantName || t.restaurant_name || '',
      ownerEmail: t.ownerEmail || t.owner_email || '',
      plan,
      status: t.status || 'unknown',
      createdAt: createdAtMs,
      trialEndsAt: trialEndsAtMs,
      daysIntoTrial,
      onboardingComplete: !!t.onboardingComplete,
      onboardingCompletePercent,
      lastActivityAt: lastActivityMs,
      openTicketCount: ticketCountById.get(d.id) || 0,
      mrrCents: (t.status === 'active' && planEntry) ? planEntry.priceCents : 0,
      engagementScore: health.engagementScore || null,
      churnRiskScore: health.churnRiskScore || null,
      atRiskFlag: !!health.atRiskFlag,
      tags: meta.tags || [],
      csm: meta.csm || null,
      priorityScore: meta.priorityScore || null,
      strategicValueFlag: !!meta.strategicValueFlag,
      renewalRiskFlag: !!meta.renewalRiskFlag,
    });
  });

  return { data: { tenants } };
}

async function superOpGetKpiOverview(/*ctx*/) {
  const now = Date.now();
  const ONE_DAY = 86400000;
  const monthAgo = now - 30 * ONE_DAY;

  const tenantsSnap = await db.collection('tenants').get();
  const tenants = [];
  tenantsSnap.forEach(d => tenants.push({ id: d.id, ...d.data() }));

  const stats = {
    mrr: 0,
    mrrCents: 0,
    mrrTrendPct: null,
    totalTenants: tenants.length,
    byStatus: {},
    byPlan: {},
    trialsEndingSoon: 0,
    openTicketCount: 0,
    failedWebhooks24h: 0,
    avgGeminiSpendPerTenantMonth: 0,
    churnRate30d: 0,
    newSignups30d: 0,
    conversionRatePct: 0,
    totalCostsThisMonthUsd: 0,
    grossMarginUsd: 0,
    dauPlatform: 0,
  };

  let newCount = 0, canceledCount = 0;
  for (const t of tenants) {
    const status = (t.status || 'unknown').toLowerCase();
    const plan = (t.plan || 'unknown').toLowerCase();
    stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
    stats.byPlan[plan] = (stats.byPlan[plan] || 0) + 1;
    if (status === 'active' && PLAN_CATALOG[plan]) {
      stats.mrrCents += PLAN_CATALOG[plan].priceCents;
    }

    const createdAt = t.createdAt && t.createdAt.toMillis ? t.createdAt.toMillis() : 0;
    if (createdAt && createdAt >= monthAgo) newCount++;
    const canceledAt = t.canceledAt && t.canceledAt.toMillis ? t.canceledAt.toMillis() : 0;
    if (canceledAt && canceledAt >= monthAgo) canceledCount++;

    const trialEndsAt = t.trialEndsAt && t.trialEndsAt.toMillis ? t.trialEndsAt.toMillis() : 0;
    if (trialEndsAt && trialEndsAt >= now && trialEndsAt <= now + 7 * ONE_DAY) stats.trialsEndingSoon++;
  }
  stats.mrr = stats.mrrCents / 100;
  stats.newSignups30d = newCount;
  stats.churnRate30d = stats.totalTenants ? (canceledCount / stats.totalTenants) * 100 : 0;

  const trialTotal = (stats.byStatus.trial || 0) + (stats.byStatus.active || 0);
  stats.conversionRatePct = trialTotal ? ((stats.byStatus.active || 0) / trialTotal) * 100 : 0;

  // Open tickets across platform (collection-group)
  try {
    const openTix = await db.collectionGroup('support_tickets')
      .where('status', 'in', ['open', 'pending', 'waiting_customer'])
      .count().get();
    stats.openTicketCount = openTix.data().count;
  } catch (e) { /* index may not be ready */ }

  // Sum of costs this month from rollups
  try {
    const monthStart = new Date(now);
    monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const monthYMD = ymdUtc(monthStart.getTime());
    const costsSnap = await db.collection('tenant_costs_daily')
      .where('date', '>=', monthYMD)
      .get();
    let total = 0;
    let geminiTotal = 0;
    let tenantsWithGemini = new Set();
    costsSnap.forEach(d => {
      const c = d.data() || {};
      total += Number(c.totalUsdCost || 0);
      if (c.geminiUsdSpend) {
        geminiTotal += Number(c.geminiUsdSpend || 0);
        tenantsWithGemini.add(c.tenantId);
      }
    });
    stats.totalCostsThisMonthUsd = total;
    stats.avgGeminiSpendPerTenantMonth = tenantsWithGemini.size
      ? geminiTotal / tenantsWithGemini.size
      : 0;
    stats.grossMarginUsd = (stats.mrr || 0) - total;
  } catch (e) { /* rollup empty */ }

  // Recent failed CF audits — approx "failed webhooks" = audits with success:false
  try {
    const cutoff = admin.firestore.Timestamp.fromMillis(now - ONE_DAY);
    const failedSnap = await db.collection('audit_log')
      .where('timestamp', '>=', cutoff)
      .get();
    let failed = 0;
    failedSnap.forEach(d => {
      if (d.data().success === false) failed++;
    });
    stats.failedWebhooks24h = failed;
  } catch (e) { /* root-level audit may be small */ }

  // 30-day MRR trend sparkline — derived from active-tenant plan-day rollups
  const sparkDays = 30;
  const mrrTrend = new Array(sparkDays).fill(stats.mrr); // flat default
  stats.mrrTrendPct = 0;

  return { data: { stats, mrrTrend, generatedAt: new Date().toISOString() } };
}

async function superOpGetTenantFull(ctx, params) {
  const tenantId = String(params.tenantId || '');
  if (!tenantId) return { error: 'tenantId required', status: 400 };

  // Re-use getTenantDetails for the core payload
  const base = await superOpGetTenantDetails(ctx, params);
  if (base.error) return base;

  const now = Date.now();
  const ONE_DAY = 86400000;
  const last30 = ymdUtc(now - 30 * ONE_DAY);

  const tenantRef = db.collection('tenants').doc(tenantId);

  // Parallel fetch extra payloads
  const [
    ticketsOpenSnap,
    ticketsRecentSnap,
    feedbackSnap,
    notesSnap,
    healthDoc,
    metaDoc,
    costsSnap,
    usageSnap,
  ] = await Promise.all([
    tenantRef.collection('support_tickets')
      .where('status', 'in', ['open', 'pending', 'waiting_customer'])
      .count().get().catch(() => ({ data: () => ({ count: 0 }) })),
    tenantRef.collection('support_tickets')
      .orderBy('openedAt', 'desc').limit(10).get().catch(() => ({ forEach: () => {} })),
    tenantRef.collection('feedback_events')
      .orderBy('timestamp', 'desc').limit(20).get().catch(() => ({ forEach: () => {} })),
    tenantRef.collection('internal_notes')
      .orderBy('createdAt', 'desc').limit(50).get().catch(() => ({ forEach: () => {} })),
    db.collection('tenant_health').doc(tenantId).get().catch(() => ({ exists: false, data: () => ({}) })),
    db.collection('tenant_meta').doc(tenantId).get().catch(() => ({ exists: false, data: () => ({}) })),
    db.collection('tenant_costs_daily')
      .where('tenantId', '==', tenantId)
      .where('date', '>=', last30)
      .get().catch(() => ({ forEach: () => {} })),
    db.collection('tenant_usage_daily')
      .where('tenantId', '==', tenantId)
      .where('date', '>=', last30)
      .get().catch(() => ({ forEach: () => {} })),
  ]);

  const ticketsRecent = [];
  ticketsRecentSnap.forEach(d => {
    const data = d.data() || {};
    ticketsRecent.push({
      id: d.id,
      subject: data.subject,
      status: data.status,
      priority: data.priority,
      openedAt: data.openedAt && data.openedAt.toMillis ? data.openedAt.toMillis() : null,
      lastUpdatedAt: data.lastUpdatedAt && data.lastUpdatedAt.toMillis ? data.lastUpdatedAt.toMillis() : null,
      assignedToName: data.assignedToName || null,
    });
  });

  const feedback = [];
  feedbackSnap.forEach(d => {
    const data = d.data() || {};
    feedback.push({
      id: d.id,
      feature: data.feature,
      sentiment: data.sentiment,
      comment: data.comment,
      userEmail: data.userEmail,
      timestamp: data.timestamp && data.timestamp.toMillis ? data.timestamp.toMillis() : null,
      reviewed: !!data.reviewed,
    });
  });
  const feedbackSummary = {
    count: feedback.length,
    positive: feedback.filter(f => f.sentiment === 'positive').length,
    negative: feedback.filter(f => f.sentiment === 'negative').length,
    unreviewed: feedback.filter(f => !f.reviewed).length,
  };

  const notes = [];
  notesSnap.forEach(d => {
    const data = d.data() || {};
    notes.push({
      id: d.id,
      body: data.body,
      authorEmail: data.authorEmail,
      createdAt: data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : null,
      updatedAt: data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : null,
      pinned: !!data.pinned,
      tags: data.tags || [],
    });
  });

  const costSummary = {
    days: 0,
    firestoreReads: 0,
    firestoreWrites: 0,
    cfInvocations: 0,
    geminiUsdSpend: 0,
    totalUsdCost: 0,
    daily: [],
  };
  costsSnap.forEach(d => {
    const c = d.data() || {};
    costSummary.days++;
    costSummary.firestoreReads += Number(c.firestoreReads || 0);
    costSummary.firestoreWrites += Number(c.firestoreWrites || 0);
    costSummary.cfInvocations += Number(c.cfInvocations || 0);
    costSummary.geminiUsdSpend += Number(c.geminiUsdSpend || 0);
    costSummary.totalUsdCost += Number(c.totalUsdCost || 0);
    costSummary.daily.push({
      date: c.date,
      totalUsdCost: Number(c.totalUsdCost || 0),
      geminiUsdSpend: Number(c.geminiUsdSpend || 0),
    });
  });
  costSummary.daily.sort((a, b) => (a.date < b.date ? -1 : 1));

  const usageSummary = {
    days: 0,
    recipesCreated: 0,
    prepSheetsGenerated: 0,
    inventoryCounts: 0,
    oracleQueries: 0,
    uniqueUsers: 0,
    sessions: 0,
    daily: [],
  };
  usageSnap.forEach(d => {
    const u = d.data() || {};
    usageSummary.days++;
    usageSummary.recipesCreated += Number(u.recipesCreated || 0);
    usageSummary.prepSheetsGenerated += Number(u.prepSheetsGenerated || 0);
    usageSummary.inventoryCounts += Number(u.inventoryCounts || 0);
    usageSummary.oracleQueries += Number(u.oracleQueries || 0);
    usageSummary.uniqueUsers = Math.max(usageSummary.uniqueUsers, Number(u.uniqueUsers || 0));
    usageSummary.sessions += Number(u.sessions || 0);
    usageSummary.daily.push({
      date: u.date,
      recipesCreated: Number(u.recipesCreated || 0),
      oracleQueries: Number(u.oracleQueries || 0),
      uniqueUsers: Number(u.uniqueUsers || 0),
    });
  });
  usageSummary.daily.sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    data: {
      ...base.data,
      ticketSummary: {
        openCount: ticketsOpenSnap.data().count,
        recent: ticketsRecent,
      },
      feedback,
      feedbackSummary,
      notes,
      costSummary,
      usageSummary,
      health: healthDoc.exists ? healthDoc.data() : null,
      meta: metaDoc.exists ? metaDoc.data() : null,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  SUPPORT TICKETS
// ════════════════════════════════════════════════════════════════════════════

async function superOpListTickets(ctx, params) {
  const { tenantId, status, assignedTo, priority, limit = 100 } = params || {};
  let q;
  if (tenantId) {
    q = db.collection('tenants').doc(String(tenantId)).collection('support_tickets');
  } else {
    q = db.collectionGroup('support_tickets');
  }
  if (status) q = q.where('status', '==', String(status));
  if (priority) q = q.where('priority', '==', String(priority));
  if (assignedTo) q = q.where('assignedTo', '==', String(assignedTo));

  try { q = q.orderBy('openedAt', 'desc'); } catch (e) { /* skip */ }
  q = q.limit(Math.min(500, Math.max(1, Number(limit) || 100)));

  const snap = await q.get();
  const tickets = [];
  snap.forEach(d => {
    const data = d.data() || {};
    // Extract tenantId from ref path (…/tenants/{tid}/support_tickets/{ticketId})
    let derivedTenantId = tenantId || null;
    if (!derivedTenantId && d.ref && d.ref.path) {
      const m = d.ref.path.match(/^tenants\/([^/]+)\//);
      if (m) derivedTenantId = m[1];
    }
    tickets.push({
      id: d.id,
      tenantId: derivedTenantId,
      subject: data.subject,
      status: data.status,
      priority: data.priority,
      openedAt: data.openedAt && data.openedAt.toMillis ? data.openedAt.toMillis() : null,
      lastUpdatedAt: data.lastUpdatedAt && data.lastUpdatedAt.toMillis ? data.lastUpdatedAt.toMillis() : null,
      resolvedAt: data.resolvedAt && data.resolvedAt.toMillis ? data.resolvedAt.toMillis() : null,
      assignedTo: data.assignedTo || null,
      assignedToName: data.assignedToName || null,
      openedByEmail: data.openedByEmail || null,
      tags: data.tags || [],
      source: data.source || null,
    });
  });
  return { data: { tickets } };
}

async function superOpGetTicket(ctx, params) {
  const { tenantId, ticketId } = params || {};
  if (!tenantId || !ticketId) return { error: 'tenantId and ticketId required', status: 400 };
  const ref = db.collection('tenants').doc(tenantId).collection('support_tickets').doc(ticketId);
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Ticket not found', status: 404 };
  const data = snap.data() || {};
  const msgsSnap = await ref.collection('messages').orderBy('createdAt', 'asc').get().catch(() => ({ forEach: () => {} }));
  const messages = [];
  msgsSnap.forEach(d => {
    const m = d.data() || {};
    messages.push({
      id: d.id,
      authorUid: m.authorUid,
      authorEmail: m.authorEmail,
      authorRole: m.authorRole,
      body: m.body,
      internal: !!m.internal,
      createdAt: m.createdAt && m.createdAt.toMillis ? m.createdAt.toMillis() : null,
      attachments: m.attachments || [],
    });
  });
  return {
    data: {
      ticket: {
        id: snap.id,
        tenantId,
        ...data,
        openedAt: data.openedAt && data.openedAt.toMillis ? data.openedAt.toMillis() : null,
        lastUpdatedAt: data.lastUpdatedAt && data.lastUpdatedAt.toMillis ? data.lastUpdatedAt.toMillis() : null,
        resolvedAt: data.resolvedAt && data.resolvedAt.toMillis ? data.resolvedAt.toMillis() : null,
      },
      messages,
    },
  };
}

async function superOpCreateTicket(ctx, params) {
  const { tenantId, subject, body, priority = 'normal', source = 'in_app', assignedTo, tags } = params || {};
  if (!tenantId || !subject || !body) return { error: 'tenantId, subject, body required', status: 400 };

  const tenantRef = db.collection('tenants').doc(tenantId);
  const tSnap = await tenantRef.get();
  if (!tSnap.exists) return { error: 'Tenant not found', status: 404 };

  const ticketRef = tenantRef.collection('support_tickets').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  let assignedToName = null;
  if (assignedTo) {
    try {
      const opRec = await db.collection('operators').doc(assignedTo).get();
      if (opRec.exists) assignedToName = opRec.data().displayName || opRec.data().email;
    } catch (e) { /* ignore */ }
  }

  await ticketRef.set({
    subject: sanitizeString(subject),
    status: 'open',
    priority: ['critical', 'high', 'normal', 'low'].includes(priority) ? priority : 'normal',
    openedBy: ctx.userId,
    openedByEmail: ctx.userEmail,
    openedAt: now,
    lastUpdatedAt: now,
    assignedTo: assignedTo || null,
    assignedToName,
    tags: Array.isArray(tags) ? tags.map(sanitizeString) : [],
    source: ['email', 'chat', 'phone', 'in_app', 'proactive'].includes(source) ? source : 'in_app',
    resolvedAt: null,
    resolvedBy: null,
    slaFirstResponseAt: null,
    slaResolvedAt: null,
  });

  await ticketRef.collection('messages').add({
    authorUid: ctx.userId,
    authorEmail: ctx.userEmail,
    authorRole: 'operator',
    body: sanitizeString(body),
    internal: false,
    createdAt: now,
    attachments: [],
  });

  await writeSuperAudit(ctx, 'ticket_created', tenantId, { ticketId: ticketRef.id });
  return { data: { ticketId: ticketRef.id, tenantId } };
}

async function superOpReplyTicket(ctx, params) {
  const { tenantId, ticketId, body, internal } = params || {};
  if (!tenantId || !ticketId || !body) return { error: 'tenantId, ticketId, body required', status: 400 };

  const ticketRef = db.collection('tenants').doc(tenantId).collection('support_tickets').doc(ticketId);
  const snap = await ticketRef.get();
  if (!snap.exists) return { error: 'Ticket not found', status: 404 };

  const now = admin.firestore.FieldValue.serverTimestamp();
  const msg = {
    authorUid: ctx.userId,
    authorEmail: ctx.userEmail,
    authorRole: 'operator',
    body: sanitizeString(body),
    internal: !!internal,
    createdAt: now,
    attachments: [],
  };
  await ticketRef.collection('messages').add(msg);

  const updates = { lastUpdatedAt: now };
  if (!snap.data().slaFirstResponseAt && !internal) updates.slaFirstResponseAt = now;
  if (snap.data().status === 'resolved' || snap.data().status === 'closed') updates.status = 'open';
  await ticketRef.update(updates);

  await writeSuperAudit(ctx, 'ticket_replied', tenantId, { ticketId, internal: !!internal });
  return { data: { ticketId, ok: true } };
}

async function superOpAssignTicket(ctx, params) {
  const { tenantId, ticketId, assignedTo } = params || {};
  if (!tenantId || !ticketId) return { error: 'tenantId, ticketId required', status: 400 };
  const ticketRef = db.collection('tenants').doc(tenantId).collection('support_tickets').doc(ticketId);
  if (!(await ticketRef.get()).exists) return { error: 'Ticket not found', status: 404 };
  let assignedToName = null;
  if (assignedTo) {
    try {
      const opRec = await db.collection('operators').doc(assignedTo).get();
      if (opRec.exists) assignedToName = opRec.data().displayName || opRec.data().email;
    } catch (e) { /* ignore */ }
  }
  await ticketRef.update({
    assignedTo: assignedTo || null,
    assignedToName,
    lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await writeSuperAudit(ctx, 'ticket_assigned', tenantId, { ticketId, assignedTo: assignedTo || null });
  return { data: { ticketId, assignedTo, assignedToName } };
}

async function superOpCloseTicket(ctx, params) {
  const { tenantId, ticketId, resolution } = params || {};
  if (!tenantId || !ticketId) return { error: 'tenantId, ticketId required', status: 400 };
  const ticketRef = db.collection('tenants').doc(tenantId).collection('support_tickets').doc(ticketId);
  if (!(await ticketRef.get()).exists) return { error: 'Ticket not found', status: 404 };
  const now = admin.firestore.FieldValue.serverTimestamp();
  await ticketRef.update({
    status: 'resolved',
    resolvedAt: now,
    resolvedBy: ctx.userEmail,
    slaResolvedAt: now,
    lastUpdatedAt: now,
    ...(resolution ? { resolution: sanitizeString(resolution) } : {}),
  });
  await writeSuperAudit(ctx, 'ticket_closed', tenantId, { ticketId });
  return { data: { ticketId, status: 'resolved' } };
}

async function superOpReopenTicket(ctx, params) {
  const { tenantId, ticketId } = params || {};
  if (!tenantId || !ticketId) return { error: 'tenantId, ticketId required', status: 400 };
  const ticketRef = db.collection('tenants').doc(tenantId).collection('support_tickets').doc(ticketId);
  if (!(await ticketRef.get()).exists) return { error: 'Ticket not found', status: 404 };
  await ticketRef.update({
    status: 'open',
    resolvedAt: null,
    resolvedBy: null,
    lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await writeSuperAudit(ctx, 'ticket_reopened', tenantId, { ticketId });
  return { data: { ticketId, status: 'open' } };
}

async function superOpAddTicketTag(ctx, params) {
  const { tenantId, ticketId, tag } = params || {};
  if (!tenantId || !ticketId || !tag) return { error: 'tenantId, ticketId, tag required', status: 400 };
  const ticketRef = db.collection('tenants').doc(tenantId).collection('support_tickets').doc(ticketId);
  await ticketRef.update({
    tags: admin.firestore.FieldValue.arrayUnion(sanitizeString(tag)),
    lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { data: { ticketId, tag } };
}

async function superOpRemoveTicketTag(ctx, params) {
  const { tenantId, ticketId, tag } = params || {};
  if (!tenantId || !ticketId || !tag) return { error: 'tenantId, ticketId, tag required', status: 400 };
  const ticketRef = db.collection('tenants').doc(tenantId).collection('support_tickets').doc(ticketId);
  await ticketRef.update({
    tags: admin.firestore.FieldValue.arrayRemove(sanitizeString(tag)),
    lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { data: { ticketId, tag } };
}

// ════════════════════════════════════════════════════════════════════════════
//  FEEDBACK
// ════════════════════════════════════════════════════════════════════════════

async function superOpListFeedback(ctx, params) {
  const { tenantId, feature, sentiment, limit = 200 } = params || {};
  let q;
  if (tenantId) {
    q = db.collection('tenants').doc(tenantId).collection('feedback_events');
  } else {
    q = db.collectionGroup('feedback_events');
  }
  if (feature) q = q.where('feature', '==', String(feature));
  if (sentiment) q = q.where('sentiment', '==', String(sentiment));
  try { q = q.orderBy('timestamp', 'desc'); } catch (e) { /* skip */ }
  q = q.limit(Math.min(1000, Math.max(1, Number(limit) || 200)));

  const snap = await q.get();
  const events = [];
  snap.forEach(d => {
    const data = d.data() || {};
    let derivedTenantId = tenantId || null;
    if (!derivedTenantId && d.ref && d.ref.path) {
      const m = d.ref.path.match(/^tenants\/([^/]+)\//);
      if (m) derivedTenantId = m[1];
    }
    events.push({
      id: d.id,
      tenantId: derivedTenantId,
      userId: data.userId,
      userEmail: data.userEmail,
      feature: data.feature,
      route: data.route,
      sentiment: data.sentiment,
      comment: data.comment,
      timestamp: data.timestamp && data.timestamp.toMillis ? data.timestamp.toMillis() : null,
      reviewed: !!data.reviewed,
      operatorResponse: data.operatorResponse || null,
    });
  });
  return { data: { events } };
}

async function superOpAggregateFeedbackByFeature(ctx, params) {
  const { tenantId, window = '30d' } = params || {};
  const now = Date.now();
  const ONE_DAY = 86400000;
  let cutoff = 0;
  if (window === '7d') cutoff = now - 7 * ONE_DAY;
  else if (window === '30d') cutoff = now - 30 * ONE_DAY;
  else if (window === '90d') cutoff = now - 90 * ONE_DAY;
  else cutoff = 0;

  let q;
  if (tenantId) q = db.collection('tenants').doc(tenantId).collection('feedback_events');
  else q = db.collectionGroup('feedback_events');
  if (cutoff) q = q.where('timestamp', '>=', admin.firestore.Timestamp.fromMillis(cutoff));

  const snap = await q.get();
  const byFeature = {};
  snap.forEach(d => {
    const data = d.data() || {};
    const feature = data.feature || 'unknown';
    const s = data.sentiment || 'null';
    if (!byFeature[feature]) byFeature[feature] = { feature, total: 0, positive: 0, negative: 0, neutral: 0 };
    byFeature[feature].total++;
    if (s === 'positive') byFeature[feature].positive++;
    else if (s === 'negative') byFeature[feature].negative++;
    else byFeature[feature].neutral++;
  });
  const buckets = Object.values(byFeature).sort((a, b) => b.total - a.total);
  return { data: { window, buckets } };
}

async function superOpMarkFeedbackReviewed(ctx, params) {
  const { tenantId, feedbackId, operatorResponse } = params || {};
  if (!tenantId || !feedbackId) return { error: 'tenantId, feedbackId required', status: 400 };
  const ref = db.collection('tenants').doc(tenantId).collection('feedback_events').doc(feedbackId);
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Feedback not found', status: 404 };
  await ref.update({
    reviewed: true,
    reviewedBy: ctx.userEmail,
    reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(operatorResponse ? { operatorResponse: sanitizeString(operatorResponse) } : {}),
  });
  return { data: { ok: true } };
}

// ════════════════════════════════════════════════════════════════════════════
//  INTERNAL NOTES
// ════════════════════════════════════════════════════════════════════════════

async function superOpListNotes(ctx, params) {
  const tenantId = String(params.tenantId || '');
  if (!tenantId) return { error: 'tenantId required', status: 400 };
  const snap = await db.collection('tenants').doc(tenantId).collection('internal_notes')
    .orderBy('pinned', 'desc').orderBy('createdAt', 'desc').get().catch(async () => {
      return await db.collection('tenants').doc(tenantId).collection('internal_notes').get();
    });
  const notes = [];
  snap.forEach(d => {
    const data = d.data() || {};
    notes.push({
      id: d.id,
      body: data.body,
      authorUid: data.authorUid,
      authorEmail: data.authorEmail,
      createdAt: data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : null,
      updatedAt: data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : null,
      pinned: !!data.pinned,
      tags: data.tags || [],
    });
  });
  return { data: { notes } };
}

async function superOpAddNote(ctx, params) {
  const { tenantId, body, pinned = false, tags = [] } = params || {};
  if (!tenantId || !body) return { error: 'tenantId and body required', status: 400 };
  const ref = db.collection('tenants').doc(tenantId).collection('internal_notes').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  await ref.set({
    body: sanitizeString(body),
    authorUid: ctx.userId,
    authorEmail: ctx.userEmail,
    createdAt: now,
    updatedAt: now,
    pinned: !!pinned,
    tags: Array.isArray(tags) ? tags.map(sanitizeString) : [],
  });
  await writeSuperAudit(ctx, 'note_added', tenantId, { noteId: ref.id });
  return { data: { id: ref.id } };
}

async function superOpUpdateNote(ctx, params) {
  const { tenantId, noteId, body, pinned, tags } = params || {};
  if (!tenantId || !noteId) return { error: 'tenantId, noteId required', status: 400 };
  const ref = db.collection('tenants').doc(tenantId).collection('internal_notes').doc(noteId);
  if (!(await ref.get()).exists) return { error: 'Note not found', status: 404 };
  const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (body !== undefined) updates.body = sanitizeString(body);
  if (pinned !== undefined) updates.pinned = !!pinned;
  if (Array.isArray(tags)) updates.tags = tags.map(sanitizeString);
  await ref.update(updates);
  await writeSuperAudit(ctx, 'note_updated', tenantId, { noteId });
  return { data: { ok: true } };
}

async function superOpDeleteNote(ctx, params) {
  const { tenantId, noteId } = params || {};
  if (!tenantId || !noteId) return { error: 'tenantId, noteId required', status: 400 };
  await db.collection('tenants').doc(tenantId).collection('internal_notes').doc(noteId).delete();
  await writeSuperAudit(ctx, 'note_deleted', tenantId, { noteId });
  return { data: { ok: true } };
}

// ════════════════════════════════════════════════════════════════════════════
//  TENANT META (tags, CSM, priority, etc.)
// ════════════════════════════════════════════════════════════════════════════

async function superOpGetTenantMeta(ctx, params) {
  const tenantId = String(params.tenantId || '');
  if (!tenantId) return { error: 'tenantId required', status: 400 };
  const snap = await db.collection('tenant_meta').doc(tenantId).get();
  return { data: { meta: snap.exists ? snap.data() : {} } };
}

async function superOpSetTenantMeta(ctx, params) {
  const { tenantId, fields } = params || {};
  if (!tenantId || !fields || typeof fields !== 'object') return { error: 'tenantId and fields required', status: 400 };
  const allowed = ['tags', 'csm', 'priorityScore', 'followUpDate', 'strategicValueFlag',
                   'competitorDisplacedFrom', 'renewalRiskFlag', 'customLabels'];
  const updates = {};
  for (const k of allowed) {
    if (k in fields) updates[k] = fields[k];
  }
  updates.lastOperatorTouch = admin.firestore.FieldValue.serverTimestamp();
  updates.lastOperatorTouchBy = ctx.userEmail;
  await db.collection('tenant_meta').doc(tenantId).set(updates, { merge: true });
  await writeSuperAudit(ctx, 'meta_updated', tenantId, { keys: Object.keys(updates) });
  return { data: { ok: true } };
}

async function superOpAddTenantTag(ctx, params) {
  const { tenantId, tag } = params || {};
  if (!tenantId || !tag) return { error: 'tenantId and tag required', status: 400 };
  await db.collection('tenant_meta').doc(tenantId).set({
    tags: admin.firestore.FieldValue.arrayUnion(sanitizeString(tag)),
    lastOperatorTouch: admin.firestore.FieldValue.serverTimestamp(),
    lastOperatorTouchBy: ctx.userEmail,
  }, { merge: true });
  await writeSuperAudit(ctx, 'tag_added', tenantId, { tag });
  return { data: { ok: true } };
}

async function superOpRemoveTenantTag(ctx, params) {
  const { tenantId, tag } = params || {};
  if (!tenantId || !tag) return { error: 'tenantId and tag required', status: 400 };
  await db.collection('tenant_meta').doc(tenantId).set({
    tags: admin.firestore.FieldValue.arrayRemove(sanitizeString(tag)),
    lastOperatorTouch: admin.firestore.FieldValue.serverTimestamp(),
    lastOperatorTouchBy: ctx.userEmail,
  }, { merge: true });
  await writeSuperAudit(ctx, 'tag_removed', tenantId, { tag });
  return { data: { ok: true } };
}

// ════════════════════════════════════════════════════════════════════════════
//  COSTS / USAGE / HEALTH READS
// ════════════════════════════════════════════════════════════════════════════

async function superOpGetTenantCosts(ctx, params) {
  const { tenantId, days = 30 } = params || {};
  if (!tenantId) return { error: 'tenantId required', status: 400 };
  const start = ymdUtc(Date.now() - Math.min(365, Math.max(1, Number(days) || 30)) * 86400000);
  const snap = await db.collection('tenant_costs_daily')
    .where('tenantId', '==', tenantId)
    .where('date', '>=', start)
    .get().catch(() => ({ forEach: () => {} }));
  const costs = [];
  snap.forEach(d => costs.push(d.data()));
  costs.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { data: { costs } };
}

async function superOpGetTenantUsage(ctx, params) {
  const { tenantId, days = 30 } = params || {};
  if (!tenantId) return { error: 'tenantId required', status: 400 };
  const start = ymdUtc(Date.now() - Math.min(365, Math.max(1, Number(days) || 30)) * 86400000);
  const snap = await db.collection('tenant_usage_daily')
    .where('tenantId', '==', tenantId)
    .where('date', '>=', start)
    .get().catch(() => ({ forEach: () => {} }));
  const usage = [];
  snap.forEach(d => usage.push(d.data()));
  usage.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { data: { usage } };
}

async function superOpGetTenantHealth(ctx, params) {
  const tenantId = String(params.tenantId || '');
  if (!tenantId) return { error: 'tenantId required', status: 400 };
  const snap = await db.collection('tenant_health').doc(tenantId).get();
  return { data: { health: snap.exists ? snap.data() : null } };
}

// ════════════════════════════════════════════════════════════════════════════
//  ACTIONS: impersonate, export, delete, reset-password, comp, refund, flags, announcements
// ════════════════════════════════════════════════════════════════════════════

async function superOpImpersonateTenant(ctx, params) {
  const tenantId = String(params.tenantId || '');
  if (!tenantId) return { error: 'tenantId required', status: 400 };
  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  if (!tenantSnap.exists) return { error: 'Tenant not found', status: 404 };
  const t = tenantSnap.data() || {};

  // 30-min impersonation window. Custom-token TTL is fixed at 1 h by Firebase,
  // but the resulting ID token's lifetime is bounded by claim
  // `impersonationExpiresAt`. The frontend signs the user out at that
  // timestamp; the backend rejects writes when
  // `impersonating === true && readOnly === true` (see secureApi gate).
  const now = Date.now();
  const expiresAtMs = now + 30 * 60 * 1000;

  const claims = {
    impersonating: true,
    readOnly: true,
    impersonationExpiresAt: expiresAtMs,
    impersonatingTenantId: tenantId,
    impersonatingTenantSlug: t.slug || tenantId,
    impersonatingAs: ctx.userEmail,
    // Tenant-scoped claims so index.html / app.html accept the session.
    tenantId,
    tenantSlug: t.slug || tenantId,
    approved: true,
    role: 'super_admin',
    superAdmin: true,
  };
  const customToken = await auth.createCustomToken(ctx.userId, claims);

  await writeSuperAudit(ctx, 'impersonation', tenantId, {
    durationMs: 30 * 60 * 1000,
    expiresAt: new Date(expiresAtMs).toISOString(),
  });

  return {
    data: {
      customToken,
      tenantSlug: t.slug || tenantId,
      tenantId,
      expiresAtMs,
      expiresInSeconds: 1800,
    },
  };
}

async function superOpExportTenant(ctx, params) {
  const tenantId = String(params.tenantId || '');
  if (!tenantId) return { error: 'tenantId required', status: 400 };

  const tenantRef = db.collection('tenants').doc(tenantId);
  const tenantSnap = await tenantRef.get();
  if (!tenantSnap.exists) return { error: 'Tenant not found', status: 404 };

  const subs = [...ALLOWED_COLLECTIONS, 'support_tickets', 'feedback_events', 'internal_notes'];
  const out = { tenantId, tenant: tenantSnap.data(), collections: {}, exportedAt: new Date().toISOString(), exportedBy: ctx.userEmail };
  for (const sub of subs) {
    try {
      const snap = await tenantRef.collection(sub).get();
      const docs = [];
      snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
      out.collections[sub] = docs;
    } catch (e) {
      out.collections[sub] = { error: e.message };
    }
  }
  await writeSuperAudit(ctx, 'export', tenantId, { docCount: Object.values(out.collections).reduce((a, b) => a + (Array.isArray(b) ? b.length : 0), 0) });
  return { data: out };
}

async function superOpSoftDeleteTenant(ctx, params) {
  const { tenantId, reason } = params || {};
  if (!tenantId) return { error: 'tenantId required', status: 400 };
  const tenantRef = db.collection('tenants').doc(tenantId);
  if (!(await tenantRef.get()).exists) return { error: 'Tenant not found', status: 404 };
  const hardDeleteAt = new Date(Date.now() + 30 * 86400000);
  await tenantRef.update({
    status: 'deleted',
    softDeletedAt: admin.firestore.FieldValue.serverTimestamp(),
    softDeletedBy: ctx.userEmail,
    softDeleteReason: sanitizeString(reason || ''),
    scheduledHardDeleteAt: admin.firestore.Timestamp.fromDate(hardDeleteAt),
  });
  await writeSuperAudit(ctx, 'soft_delete', tenantId, { reason: reason || '', scheduledHardDeleteAt: hardDeleteAt.toISOString() });
  return { data: { tenantId, scheduledHardDeleteAt: hardDeleteAt.toISOString() } };
}

async function superOpHardDeleteTenant(ctx, params) {
  const { tenantId, confirmation, force } = params || {};
  if (!tenantId) return { error: 'tenantId required', status: 400 };
  if (!force) return { error: 'force flag required — this is irreversible', status: 400 };
  if (confirmation !== tenantId) return { error: 'confirmation must equal tenantId', status: 400 };

  const tenantRef = db.collection('tenants').doc(tenantId);
  const tenantSnap = await tenantRef.get();
  if (!tenantSnap.exists) return { error: 'Tenant not found', status: 404 };
  const t = tenantSnap.data() || {};

  // Cancel Square subscription if active
  if (t.squareSubscriptionId && t.status !== 'canceled') {
    try { await square.cancelSubscription({ subscriptionId: t.squareSubscriptionId }); }
    catch (e) { console.warn('[hardDelete] square cancel failed', e.message); }
  }

  // Recursively delete all subcollections
  const subs = [...ALLOWED_COLLECTIONS, 'support_tickets', 'feedback_events', 'internal_notes'];
  for (const sub of subs) {
    try {
      let snap = await tenantRef.collection(sub).limit(500).get();
      while (!snap.empty) {
        const batch = db.batch();
        snap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        snap = await tenantRef.collection(sub).limit(500).get();
      }
    } catch (e) { console.warn('[hardDelete] sub', sub, e.message); }
  }

  // Delete owner Auth user if present
  if (t.ownerEmail) {
    try {
      const u = await auth.getUserByEmail(t.ownerEmail);
      await auth.deleteUser(u.uid);
    } catch (e) { /* may not exist */ }
  }

  // Delete flat-collection rollups
  try {
    const costsQs = await db.collection('tenant_costs_daily').where('tenantId', '==', tenantId).get();
    const batch = db.batch();
    costsQs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  } catch (e) { /* ignore */ }
  try {
    const usageQs = await db.collection('tenant_usage_daily').where('tenantId', '==', tenantId).get();
    const batch = db.batch();
    usageQs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  } catch (e) { /* ignore */ }
  try { await db.collection('tenant_health').doc(tenantId).delete(); } catch (e) { /* ignore */ }
  try { await db.collection('tenant_meta').doc(tenantId).delete(); } catch (e) { /* ignore */ }

  // Finally, delete tenant doc
  await tenantRef.delete();

  await writeSuperAudit(ctx, 'hard_delete', null, { tenantId, slug: t.slug });
  return { data: { tenantId, deleted: true } };
}

async function superOpResetUserPassword(ctx, params) {
  const { tenantId, userEmail } = params || {};
  if (!userEmail) return { error: 'userEmail required', status: 400 };
  try {
    const link = await auth.generatePasswordResetLink(userEmail);
    await writeSuperAudit(ctx, 'reset_password', tenantId || null, { email: userEmail });
    return { data: { email: userEmail, resetLink: link } };
  } catch (e) {
    return { error: 'Password reset failed: ' + e.message, status: 500 };
  }
}

async function superOpRevokeTokens(ctx, params) {
  const { tenantId, userEmail } = params || {};
  if (!userEmail) return { error: 'userEmail required', status: 400 };
  try {
    const u = await auth.getUserByEmail(userEmail);
    await auth.revokeRefreshTokens(u.uid);
    await writeSuperAudit(ctx, 'revoke_tokens', tenantId || null, { email: userEmail, uid: u.uid });
    return { data: { email: userEmail, uid: u.uid, revokedAt: new Date().toISOString() } };
  } catch (e) {
    return { error: 'Revoke failed: ' + e.message, status: 500 };
  }
}

async function superOpResendVerification(ctx, params) {
  const { tenantId, userEmail } = params || {};
  if (!userEmail) return { error: 'userEmail required', status: 400 };
  try {
    const link = await auth.generateEmailVerificationLink(userEmail);
    await writeSuperAudit(ctx, 'resend_verification', tenantId || null, { email: userEmail });
    return { data: { email: userEmail, verificationLink: link } };
  } catch (e) {
    return { error: 'Verification link failed: ' + e.message, status: 500 };
  }
}

async function superOpAdjustPlan(ctx, params) {
  const { tenantId, newPlan } = params || {};
  if (!tenantId || !newPlan) return { error: 'tenantId and newPlan required', status: 400 };
  if (!PLAN_CATALOG[newPlan]) return { error: 'Unknown plan: ' + newPlan, status: 400 };

  const tenantRef = db.collection('tenants').doc(tenantId);
  const snap = await tenantRef.get();
  if (!snap.exists) return { error: 'Tenant not found', status: 404 };
  const t = snap.data() || {};

  let swapResult = null;
  if (t.squareSubscriptionId) {
    try {
      const newVar = getPlanVariationId(newPlan);
      swapResult = await square.swapSubscriptionPlan({
        subscriptionId: t.squareSubscriptionId,
        planVariationId: newVar,
      });
    } catch (e) {
      return { error: 'Square plan swap failed: ' + e.message, status: 502 };
    }
  }

  await tenantRef.update({
    plan: newPlan,
    planChangedAt: admin.firestore.FieldValue.serverTimestamp(),
    planChangedBy: ctx.userEmail,
  });

  await writeSuperAudit(ctx, 'plan_adjusted', tenantId, { newPlan, oldPlan: t.plan });
  return { data: { tenantId, newPlan, square: swapResult } };
}

async function superOpCompInvoice(ctx, params) {
  const { tenantId, invoiceId, reason } = params || {};
  if (!tenantId || !invoiceId) return { error: 'tenantId and invoiceId required', status: 400 };
  // Square doesn't expose a first-class "comp" — we record a ledger entry.
  await db.collection('tenants').doc(tenantId).collection('comps').add({
    invoiceId, reason: sanitizeString(reason || ''),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: ctx.userEmail,
  });
  await writeSuperAudit(ctx, 'comp_invoice', tenantId, { invoiceId, reason: reason || '' });
  return { data: { ok: true } };
}

async function superOpIssueRefund(ctx, params) {
  const { tenantId, paymentId, amountCents, reason } = params || {};
  if (!tenantId || !paymentId || !amountCents) return { error: 'tenantId, paymentId, amountCents required', status: 400 };
  const idempotencyKey = `refund-${tenantId}-${paymentId}-${Date.now()}`;
  let refundResult = null;
  try {
    refundResult = await square.squareFetch('/v2/refunds', 'POST', {
      idempotency_key: idempotencyKey,
      payment_id: String(paymentId),
      amount_money: { amount: Number(amountCents), currency: 'USD' },
      reason: sanitizeString(reason || 'Operator-issued refund'),
    });
  } catch (e) {
    return { error: 'Square refund failed: ' + e.message, status: 502 };
  }
  await writeSuperAudit(ctx, 'refund_issued', tenantId, { paymentId, amountCents, reason: reason || '' });
  return { data: { refund: refundResult } };
}

async function superOpPushAnnouncement(ctx, params) {
  const { title, body, audience = 'all', severity = 'info', expiresAt, dismissible = true, targetRoute } = params || {};
  if (!title || !body) return { error: 'title and body required', status: 400 };
  const ref = db.collection('platform_announcements').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const doc = {
    title: sanitizeString(title),
    body: sanitizeString(body),
    audience: (typeof audience === 'string' || Array.isArray(audience)) ? audience : 'all',
    severity: ['info', 'warning', 'critical'].includes(severity) ? severity : 'info',
    createdAt: now,
    createdBy: ctx.userEmail,
    expiresAt: expiresAt ? admin.firestore.Timestamp.fromDate(new Date(expiresAt)) : null,
    dismissible: !!dismissible,
    targetRoute: targetRoute || null,
  };
  await ref.set(doc);
  await writeSuperAudit(ctx, 'announcement_pushed', null, { id: ref.id, title });
  return { data: { id: ref.id } };
}

async function superOpListAnnouncements(/*ctx*/) {
  const snap = await db.collection('platform_announcements').orderBy('createdAt', 'desc').get().catch(() => ({ forEach: () => {} }));
  const announcements = [];
  snap.forEach(d => {
    const data = d.data() || {};
    announcements.push({
      id: d.id,
      ...data,
      createdAt: data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : null,
      expiresAt: data.expiresAt && data.expiresAt.toMillis ? data.expiresAt.toMillis() : null,
    });
  });
  return { data: { announcements } };
}

async function superOpDeleteAnnouncement(ctx, params) {
  const { id } = params || {};
  if (!id) return { error: 'id required', status: 400 };
  await db.collection('platform_announcements').doc(id).delete();
  await writeSuperAudit(ctx, 'announcement_deleted', null, { id });
  return { data: { ok: true } };
}

async function superOpListFeatureFlags(/*ctx*/) {
  const snap = await db.collection('feature_flags').get().catch(() => ({ forEach: () => {} }));
  const flags = [];
  snap.forEach(d => flags.push({ id: d.id, ...d.data() }));
  return { data: { flags } };
}

async function superOpSetFeatureFlag(ctx, params) {
  const { flag, tenantId, enabled, description, rolloutPercent, defaultValue } = params || {};
  if (!flag) return { error: 'flag required', status: 400 };
  const ref = db.collection('feature_flags').doc(String(flag));
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() : { name: flag, enabledTenants: [], disabledTenants: [] };
  const updates = {
    name: existing.name || flag,
    description: description !== undefined ? sanitizeString(description) : (existing.description || ''),
    defaultValue: defaultValue !== undefined ? !!defaultValue : (existing.defaultValue || false),
    rolloutPercent: rolloutPercent !== undefined ? Number(rolloutPercent) : (existing.rolloutPercent || 0),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: ctx.userEmail,
  };
  if (tenantId !== undefined && enabled !== undefined) {
    if (enabled) {
      updates.enabledTenants = admin.firestore.FieldValue.arrayUnion(String(tenantId));
      updates.disabledTenants = admin.firestore.FieldValue.arrayRemove(String(tenantId));
    } else {
      updates.disabledTenants = admin.firestore.FieldValue.arrayUnion(String(tenantId));
      updates.enabledTenants = admin.firestore.FieldValue.arrayRemove(String(tenantId));
    }
  }
  if (!snap.exists) updates.createdAt = admin.firestore.FieldValue.serverTimestamp();
  await ref.set(updates, { merge: true });
  await writeSuperAudit(ctx, 'feature_flag_set', tenantId || null, { flag, enabled: enabled ?? null });
  return { data: { ok: true } };
}

async function superOpManualAuditEntry(ctx, params) {
  const { tenantId, note } = params || {};
  if (!note) return { error: 'note required', status: 400 };
  const ref = tenantId
    ? db.collection('tenants').doc(tenantId).collection('audit_log')
    : db.collection('audit_log');
  await ref.add({
    user_id: ctx.userId,
    user_email: ctx.userEmail,
    tenant_id: tenantId || 'platform',
    operation: 'super_admin_operator_note',
    collection: 'operator_console',
    note: sanitizeString(note),
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { data: { ok: true } };
}

// ════════════════════════════════════════════════════════════════════════════
//  AGENTS / OPERATORS
// ════════════════════════════════════════════════════════════════════════════

async function superOpListOperators(/*ctx*/) {
  // Union of super-admins (from Auth) + operator profiles (from /operators)
  const [adminsResult, opsSnap] = await Promise.all([
    (async () => {
      const admins = [];
      let nextPageToken;
      do {
        const page = await auth.listUsers(1000, nextPageToken);
        for (const u of page.users) {
          if (u.customClaims && u.customClaims.superAdmin === true) {
            admins.push({ uid: u.uid, email: u.email, displayName: u.displayName, photoURL: u.photoURL });
          }
        }
        nextPageToken = page.pageToken;
      } while (nextPageToken);
      return admins;
    })(),
    db.collection('operators').get().catch(() => ({ forEach: () => {} })),
  ]);

  const profileByUid = new Map();
  opsSnap.forEach(d => profileByUid.set(d.id, d.data() || {}));

  // For each super admin, count their assigned open tickets
  const ticketCounts = {};
  try {
    const allOpen = await db.collectionGroup('support_tickets')
      .where('status', 'in', ['open', 'pending', 'waiting_customer']).get();
    allOpen.forEach(d => {
      const data = d.data() || {};
      if (data.assignedTo) ticketCounts[data.assignedTo] = (ticketCounts[data.assignedTo] || 0) + 1;
    });
  } catch (e) { /* index may be missing */ }

  const operators = adminsResult.map(a => {
    const p = profileByUid.get(a.uid) || {};
    return {
      uid: a.uid,
      email: a.email,
      displayName: p.displayName || a.displayName || a.email,
      photoURL: p.photoUrl || a.photoURL || null,
      status: p.status || 'offline',
      role: p.role || 'super_admin',
      openTicketCount: ticketCounts[a.uid] || 0,
      avgResolutionHours: p.avgResolutionHours || null,
      csat: p.csat || null,
      joinedAt: p.joinedAt && p.joinedAt.toMillis ? p.joinedAt.toMillis() : null,
    };
  });
  return { data: { operators } };
}

async function superOpUpdateOperatorStatus(ctx, params) {
  const { uid, status } = params || {};
  if (!uid || !status) return { error: 'uid, status required', status: 400 };
  if (!['online', 'offline', 'busy'].includes(status)) return { error: 'invalid status', status: 400 };
  await db.collection('operators').doc(uid).set({
    status,
    statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    statusUpdatedBy: ctx.userEmail,
  }, { merge: true });
  return { data: { uid, status } };
}

async function superOpUpdateOperatorProfile(ctx, params) {
  const { uid, displayName, role, photoUrl } = params || {};
  if (!uid) return { error: 'uid required', status: 400 };
  const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (displayName !== undefined) updates.displayName = sanitizeString(displayName);
  if (role !== undefined) updates.role = role;
  if (photoUrl !== undefined) updates.photoUrl = photoUrl;
  await db.collection('operators').doc(uid).set(updates, { merge: true });
  return { data: { ok: true } };
}

// ════════════════════════════════════════════════════════════════════════════
//  PLATFORM-WIDE UTILITIES (recent audit, flush rollups, etc.)
// ════════════════════════════════════════════════════════════════════════════

async function superOpRecentAudit(ctx, params) {
  const { limit = 25 } = params || {};
  const n = Math.min(200, Math.max(1, Number(limit) || 25));
  const rows = [];
  try {
    const snap = await db.collectionGroup('audit_log').orderBy('timestamp', 'desc').limit(n).get();
    snap.forEach(d => {
      const data = d.data() || {};
      rows.push({
        id: d.id,
        path: d.ref.path,
        tenantId: data.tenant_id || null,
        userEmail: data.user_email,
        operation: data.operation,
        collection: data.collection,
        recordCount: data.record_count,
        success: data.success !== false,
        timestamp: data.timestamp && data.timestamp.toMillis ? data.timestamp.toMillis() : null,
      });
    });
  } catch (e) { /* index may be missing */ }
  return { data: { rows } };
}

async function superOpTopAtRiskTenants(/*ctx*/) {
  const snap = await db.collection('tenant_health').get().catch(() => ({ forEach: () => {} }));
  const tenants = [];
  snap.forEach(d => {
    const h = d.data() || {};
    tenants.push({
      tenantId: d.id,
      churnRiskScore: h.churnRiskScore || 0,
      engagementScore: h.engagementScore || 0,
      daysSinceLastLogin: h.daysSinceLastLogin || null,
      atRiskFlag: !!h.atRiskFlag,
      recommendedIntervention: h.recommendedIntervention || null,
    });
  });
  tenants.sort((a, b) => b.churnRiskScore - a.churnRiskScore);
  return { data: { tenants: tenants.slice(0, 10) } };
}

async function superOpRunRollupsNow(ctx/*, params*/) {
  // Operator-triggered immediate rollup for testing
  const [costRes, usageRes, healthRes] = await Promise.all([
    runDailyTenantCostAggregation().catch(e => ({ error: e.message })),
    runDailyUsageStatsRollup().catch(e => ({ error: e.message })),
    runDailyHealthScoreCompute().catch(e => ({ error: e.message })),
  ]);
  await writeSuperAudit(ctx, 'run_rollups_now', null, {});
  return { data: { cost: costRes, usage: usageRes, health: healthRes } };
}

// ════════════════════════════════════════════════════════════════════════════
//  SUPER_OPS DISPATCHER (extended)
// ════════════════════════════════════════════════════════════════════════════

const SUPER_OPS = {
  // Existing
  dashboard:        superOpDashboard,
  listTenants:      superOpListTenants,
  getTenantDetails: superOpGetTenantDetails,
  suspendTenant:    superOpSuspendTenant,
  unsuspendTenant:  superOpUnsuspendTenant,
  forceCancel:      superOpForceCancel,
  listSuperAdmins:  superOpListSuperAdmins,
  grantSuperAdmin:  superOpGrantSuperAdmin,
  revokeSuperAdmin: superOpRevokeSuperAdmin,

  // Enriched listing
  listTenantsEnriched: superOpListTenantsEnriched,
  getTenantFull:       superOpGetTenantFull,
  getKpiOverview:      superOpGetKpiOverview,

  // Tickets
  listTickets:       superOpListTickets,
  getTicket:         superOpGetTicket,
  createTicket:      superOpCreateTicket,
  replyTicket:       superOpReplyTicket,
  assignTicket:      superOpAssignTicket,
  closeTicket:       superOpCloseTicket,
  reopenTicket:      superOpReopenTicket,
  addTicketTag:      superOpAddTicketTag,
  removeTicketTag:   superOpRemoveTicketTag,

  // Feedback
  listFeedback:                superOpListFeedback,
  aggregateFeedbackByFeature:  superOpAggregateFeedbackByFeature,
  markFeedbackReviewed:        superOpMarkFeedbackReviewed,

  // Notes
  listNotes:    superOpListNotes,
  addNote:      superOpAddNote,
  updateNote:   superOpUpdateNote,
  deleteNote:   superOpDeleteNote,

  // Meta
  getTenantMeta:    superOpGetTenantMeta,
  setTenantMeta:    superOpSetTenantMeta,
  addTenantTag:     superOpAddTenantTag,
  removeTenantTag:  superOpRemoveTenantTag,

  // Costs / usage / health reads
  getTenantCosts:   superOpGetTenantCosts,
  getTenantUsage:   superOpGetTenantUsage,
  getTenantHealth:  superOpGetTenantHealth,

  // Actions
  impersonateTenant:   superOpImpersonateTenant,
  exportTenant:        superOpExportTenant,
  softDeleteTenant:    superOpSoftDeleteTenant,
  hardDeleteTenant:    superOpHardDeleteTenant,
  resetUserPassword:   superOpResetUserPassword,
  revokeTokens:        superOpRevokeTokens,
  resendVerification:  superOpResendVerification,
  adjustPlan:          superOpAdjustPlan,
  compInvoice:         superOpCompInvoice,
  issueRefund:         superOpIssueRefund,
  pushAnnouncement:    superOpPushAnnouncement,
  listAnnouncements:   superOpListAnnouncements,
  deleteAnnouncement:  superOpDeleteAnnouncement,
  listFeatureFlags:    superOpListFeatureFlags,
  setFeatureFlag:      superOpSetFeatureFlag,
  manualAuditEntry:    superOpManualAuditEntry,

  // Agents
  listOperators:          superOpListOperators,
  updateOperatorStatus:   superOpUpdateOperatorStatus,
  updateOperatorProfile:  superOpUpdateOperatorProfile,

  // Platform utilities
  recentAudit:         superOpRecentAudit,
  topAtRiskTenants:    superOpTopAtRiskTenants,
  runRollupsNow:       superOpRunRollupsNow,
};

async function handleSuperAdmin(req, res) {
  setSecurityHeaders(res);
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const ct = req.headers['content-type'];
    if (!ct || !ct.includes('application/json')) {
      res.status(400).json({ error: 'Content-Type must be application/json' });
      return;
    }
    const authCtx = await requireSuperAdmin(req);
    if (!authCtx.ok) {
      res.status(authCtx.status || 401).json({ error: authCtx.error });
      return;
    }
    // Rate-limit every super-admin op (per uid, per minute)
    const rl = checkRateLimit(authCtx.userId);
    if (!rl.allowed) {
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }
    const op = String((req.body && req.body.op) || '');
    const handler = SUPER_OPS[op];
    if (!handler) { res.status(400).json({ error: 'Unknown operation: ' + op }); return; }

    const result = await handler(authCtx, req.body || {});
    if (result.error) {
      res.status(result.status || 400).json({ error: result.error });
      return;
    }
    res.status(200).json({ data: result.data, error: null });
  } catch (error) {
    console.error('[superAdmin] Unhandled:', error.message, error.stack);
    captureError(error, req, 'superAdmin');
    res.status(500).json({ error: 'Internal server error' });
  }
}

exports.superAdmin = functions
  .region('us-central1')
  .runWith({
    maxInstances: 5,
    timeoutSeconds: 120,
    secrets: ['SQUARE_ACCESS_TOKEN', 'SQUARE_LOCATION_ID', 'SQUARE_ENV', 'SENTRY_DSN'],
  })
  .https.onRequest((req, res) => {
    cors(req, res, () => handleSuperAdmin(req, res));
  });

// ════════════════════════════════════════════════════════════════════════════
//  OPERATOR DASHBOARD — SCHEDULED ROLLUPS (costs / usage / health)
// ════════════════════════════════════════════════════════════════════════════
// One doc per tenant per day for costs + usage, and a current-state doc per
// tenant for health score. All write via Admin SDK (bypass rules) to the flat
// collections /tenant_costs_daily, /tenant_usage_daily, /tenant_health.
//
// Doc IDs:
//   tenant_costs_daily/{tenantId}_{YYYY-MM-DD}  — yesterday's costs
//   tenant_usage_daily/{tenantId}_{YYYY-MM-DD}  — yesterday's user activity
//   tenant_health/{tenantId}                    — latest score (overwritten daily)
//
// Defensive: one tenant failing never kills the run; empty rollups written for
// tenants with no audit activity so the UI shows "$0" not "query error."

/**
 * Count audit_log rows per operation/collection/tenant for a given UTC day.
 * Returns { reads, writes, deletes, invocations, geminiInput, geminiOutput, emails }.
 * Heuristic mapping:
 *   - Every audit_log entry ≈ 1 CF invocation (each secureApi call writes one).
 *   - `record_count` on audit entry is the write/delete/read batch size.
 *   - op name prefix decides bucket:
 *        *_add / *_update / *_create / *_save / set_* / write_* / save_*  → writes
 *        *_delete / *_archive / delete_* / archive_*                       → deletes
 *        get_* / list_* / read_*                                            → reads
 *        others → treated as writes (conservative)
 *   - Gemini tokens pulled from /gemini_usage_log for the tenant/day.
 *   - Emails pulled from audit entries with operation === 'email_sent'.
 */
async function tallyTenantDay(tenantId, dayStartMs, dayEndMs) {
  const stats = {
    reads: 0, writes: 0, deletes: 0,
    invocations: 0,
    geminiInput: 0, geminiOutput: 0,
    emails: 0,
    activeUsers: new Set(),
  };
  try {
    const auditSnap = await db
      .collection('tenants').doc(tenantId).collection('audit_log')
      .where('timestamp', '>=', new Date(dayStartMs))
      .where('timestamp', '<', new Date(dayEndMs))
      .get();
    for (const d of auditSnap.docs) {
      const e = d.data();
      stats.invocations++;
      const op = String(e.operation || '').toLowerCase();
      const rc = Number(e.record_count || 1);
      if (e.user_id) stats.activeUsers.add(e.user_id);
      if (op === 'email_sent') stats.emails++;
      if (/(^get_|^list_|^read_|^fetch_|_read$|_get$|_list$)/.test(op)) {
        stats.reads += rc;
      } else if (/(_delete$|^delete_|_archive$|^archive_|_clear$)/.test(op)) {
        stats.deletes += rc;
      } else {
        stats.writes += rc;
      }
    }
  } catch (e) {
    // Missing audit collection or index — treat as zero.
    console.warn('[tallyTenantDay] audit scan failed', tenantId, e.message);
  }

  try {
    const gemSnap = await db.collection('gemini_usage_log')
      .where('tenant_id', '==', tenantId)
      .where('timestamp', '>=', new Date(dayStartMs))
      .where('timestamp', '<', new Date(dayEndMs))
      .get();
    for (const d of gemSnap.docs) {
      const e = d.data();
      stats.geminiInput  += Number(e.input_tokens  || e.inputTokens  || 0);
      stats.geminiOutput += Number(e.output_tokens || e.outputTokens || 0);
    }
  } catch (e) {
    // Gemini log may not exist yet — zero out.
  }

  return stats;
}

function estimateCostsUsd(tally) {
  const firestoreReadUsd  = (tally.reads   / 100000) * RATE_CARD.firestoreReadPer100k;
  const firestoreWriteUsd = (tally.writes  / 100000) * RATE_CARD.firestoreWritePer100k;
  const firestoreDelUsd   = (tally.deletes / 100000) * RATE_CARD.firestoreDeletePer100k;
  const cfInvokeUsd       = (tally.invocations / 1000000) * RATE_CARD.cfInvocationPer1M;
  // Assume 0.4 s average CF runtime at default 256 MB.
  const cfGbSec           = tally.invocations * 0.4 * RATE_CARD.cfMemoryGbDefault;
  const cfComputeUsd      = cfGbSec * RATE_CARD.cfGbSecondUsd;
  const geminiInUsd       = (tally.geminiInput  / 1000000) * RATE_CARD.geminiInputPer1M;
  const geminiOutUsd      = (tally.geminiOutput / 1000000) * RATE_CARD.geminiOutputPer1M;
  const emailUsd          = tally.emails * RATE_CARD.resendPerEmail;
  const totalUsdCost      = firestoreReadUsd + firestoreWriteUsd + firestoreDelUsd
                          + cfInvokeUsd + cfComputeUsd
                          + geminiInUsd + geminiOutUsd + emailUsd;
  return {
    firestoreReadUsd, firestoreWriteUsd, firestoreDelUsd,
    cfInvokeUsd, cfComputeUsd,
    geminiInUsd, geminiOutUsd, emailUsd,
    totalUsdCost,
  };
}

/**
 * Iterate all active tenants, compute yesterday's cost rollup, write to
 * /tenant_costs_daily/{tenantId}_{YYYY-MM-DD}. Idempotent (overwrites).
 */
async function runDailyTenantCostAggregation() {
  const started = Date.now();
  // "Yesterday" in UTC (simple — cron runs at ~01:00 PT which is 08:00/09:00 UTC
  // so yesterday-UTC cleanly covers the prior business day for West-Coast users).
  const now = new Date();
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1);
  const dayEnd   = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ymd = ymdUtc(dayStart);

  const tenantsSnap = await db.collection('tenants').get();
  const stats = { scanned: tenantsSnap.size, written: 0, errors: 0, totalUsd: 0 };

  for (const doc of tenantsSnap.docs) {
    const tenantId = doc.id;
    try {
      const tally = await tallyTenantDay(tenantId, dayStart, dayEnd);
      const costs = estimateCostsUsd(tally);
      const docId = `${tenantId}_${ymd}`;
      await db.collection('tenant_costs_daily').doc(docId).set({
        tenantId,
        date: ymd,
        dayStartMs: dayStart,
        dayEndMs: dayEnd,
        reads: tally.reads,
        writes: tally.writes,
        deletes: tally.deletes,
        cfInvocations: tally.invocations,
        geminiInputTokens: tally.geminiInput,
        geminiOutputTokens: tally.geminiOutput,
        emailsSent: tally.emails,
        ...costs,
        computedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: false });
      stats.written++;
      stats.totalUsd += costs.totalUsdCost;
    } catch (e) {
      stats.errors++;
      console.error('[dailyTenantCostAggregation] tenant failed', tenantId, e.message);
    }
  }

  console.log('[dailyTenantCostAggregation] done',
    JSON.stringify({ ...stats, totalUsd: Number(stats.totalUsd.toFixed(4)), elapsedMs: Date.now() - started }));
  return stats;
}

exports.dailyTenantCostAggregation = functions
  .region('us-central1')
  .runWith({ maxInstances: 1, timeoutSeconds: 540, memory: '512MB', secrets: ['SENTRY_DSN'] })
  .pubsub.schedule('0 1 * * *')
  .timeZone('America/Los_Angeles')
  .onRun(async () => { await runDailyTenantCostAggregation(); return null; });

/**
 * Per-tenant activity rollup: active users, total ops, dominant op types.
 * Writes /tenant_usage_daily/{tenantId}_{YYYY-MM-DD}.
 */
async function runDailyUsageStatsRollup() {
  const started = Date.now();
  const now = new Date();
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1);
  const dayEnd   = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ymd = ymdUtc(dayStart);

  const tenantsSnap = await db.collection('tenants').get();
  const stats = { scanned: tenantsSnap.size, written: 0, errors: 0 };

  for (const doc of tenantsSnap.docs) {
    const tenantId = doc.id;
    try {
      const auditSnap = await db
        .collection('tenants').doc(tenantId).collection('audit_log')
        .where('timestamp', '>=', new Date(dayStart))
        .where('timestamp', '<', new Date(dayEnd))
        .get();
      const activeUsers = new Set();
      const opCounts = {};
      let totalOps = 0;
      let lastActivityMs = 0;
      for (const d of auditSnap.docs) {
        const e = d.data();
        totalOps++;
        if (e.user_id) activeUsers.add(e.user_id);
        const op = String(e.operation || 'unknown');
        opCounts[op] = (opCounts[op] || 0) + 1;
        const ts = e.timestamp && e.timestamp.toMillis ? e.timestamp.toMillis() : 0;
        if (ts > lastActivityMs) lastActivityMs = ts;
      }
      // Top 10 operations by count (for UI sparklines).
      const topOps = Object.entries(opCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([op, count]) => ({ op, count }));

      const docId = `${tenantId}_${ymd}`;
      await db.collection('tenant_usage_daily').doc(docId).set({
        tenantId,
        date: ymd,
        dayStartMs: dayStart,
        dayEndMs: dayEnd,
        activeUsers: activeUsers.size,
        totalOps,
        topOps,
        lastActivityMs,
        computedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: false });
      stats.written++;
    } catch (e) {
      stats.errors++;
      console.error('[dailyUsageStatsRollup] tenant failed', tenantId, e.message);
    }
  }

  console.log('[dailyUsageStatsRollup] done',
    JSON.stringify({ ...stats, elapsedMs: Date.now() - started }));
  return stats;
}

exports.dailyUsageStatsRollup = functions
  .region('us-central1')
  .runWith({ maxInstances: 1, timeoutSeconds: 540, memory: '512MB', secrets: ['SENTRY_DSN'] })
  .pubsub.schedule('30 1 * * *')
  .timeZone('America/Los_Angeles')
  .onRun(async () => { await runDailyUsageStatsRollup(); return null; });

/**
 * Compute a 0–100 health score per tenant. Signals:
 *   +30 if active in last 24h (lastActivityMs within 24h)
 *   +20 if >= 3 active users in last 30 days
 *   +15 if subscription status === 'active'
 *   +15 if no open critical tickets
 *   +10 if writes > 0 yesterday
 *   +10 if no errors in last 24h audit
 * Writes /tenant_health/{tenantId}.
 */
async function runDailyHealthScoreCompute() {
  const started = Date.now();
  const now = Date.now();
  const oneDayAgo = now - 86400000;
  const thirtyDaysAgo = now - 30 * 86400000;

  const tenantsSnap = await db.collection('tenants').get();
  const stats = { scanned: tenantsSnap.size, written: 0, errors: 0 };

  for (const doc of tenantsSnap.docs) {
    const tenantId = doc.id;
    const tenant = doc.data();
    try {
      let score = 0;
      const signals = {};

      // Active in last 24h.
      let lastActivityMs = 0;
      let writesYesterday = 0;
      let errorsLast24 = 0;
      try {
        const recentAudit = await db
          .collection('tenants').doc(tenantId).collection('audit_log')
          .orderBy('timestamp', 'desc').limit(50).get();
        for (const d of recentAudit.docs) {
          const e = d.data();
          const ts = e.timestamp && e.timestamp.toMillis ? e.timestamp.toMillis() : 0;
          if (ts > lastActivityMs) lastActivityMs = ts;
          if (ts >= oneDayAgo) {
            const op = String(e.operation || '');
            if (/(_add|_update|_create|_save|_delete)/.test(op)) writesYesterday++;
            if (e.status === 'error' || e.error) errorsLast24++;
          }
        }
      } catch (e) { /* no audit yet */ }
      if (lastActivityMs >= oneDayAgo) { score += 30; signals.activeLast24h = true; }

      // Active user count over last 30 days via recent audit entries.
      let activeUsers30d = 0;
      try {
        const userSnap = await db
          .collection('tenants').doc(tenantId).collection('audit_log')
          .where('timestamp', '>=', new Date(thirtyDaysAgo))
          .limit(500).get();
        const set = new Set();
        for (const d of userSnap.docs) {
          const uid = d.data().user_id;
          if (uid) set.add(uid);
        }
        activeUsers30d = set.size;
      } catch (e) { /* index missing */ }
      if (activeUsers30d >= 3) { score += 20; signals.activeUsers30d = activeUsers30d; }
      else signals.activeUsers30d = activeUsers30d;

      // Subscription status.
      const subStatus = String(tenant.status || '').toLowerCase();
      if (subStatus === 'active' || subStatus === 'trialing') {
        score += 15; signals.subscriptionHealthy = true;
      }

      // Open critical tickets.
      let openCriticalTickets = 0;
      try {
        const ticketSnap = await db
          .collection('tenants').doc(tenantId).collection('support_tickets')
          .where('status', '==', 'open')
          .get();
        for (const d of ticketSnap.docs) {
          const t = d.data();
          if (String(t.priority || '').toLowerCase() === 'critical') openCriticalTickets++;
        }
      } catch (e) { /* no tickets yet */ }
      if (openCriticalTickets === 0) { score += 15; signals.noCriticalTickets = true; }
      else signals.openCriticalTickets = openCriticalTickets;

      if (writesYesterday > 0) { score += 10; signals.writesYesterday = writesYesterday; }
      if (errorsLast24 === 0)  { score += 10; signals.errorsLast24 = 0; }
      else signals.errorsLast24 = errorsLast24;

      let status = 'poor';
      if (score >= 80) status = 'excellent';
      else if (score >= 60) status = 'good';
      else if (score >= 40) status = 'fair';

      await db.collection('tenant_health').doc(tenantId).set({
        tenantId,
        score,
        status,
        signals,
        lastActivityMs,
        activeUsers30d,
        openCriticalTickets,
        computedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: false });
      stats.written++;
    } catch (e) {
      stats.errors++;
      console.error('[dailyHealthScoreCompute] tenant failed', tenantId, e.message);
    }
  }

  console.log('[dailyHealthScoreCompute] done',
    JSON.stringify({ ...stats, elapsedMs: Date.now() - started }));
  return stats;
}

exports.dailyHealthScoreCompute = functions
  .region('us-central1')
  .runWith({ maxInstances: 1, timeoutSeconds: 540, memory: '512MB', secrets: ['SENTRY_DSN'] })
  .pubsub.schedule('0 2 * * *')
  .timeZone('America/Los_Angeles')
  .onRun(async () => { await runDailyHealthScoreCompute(); return null; });

/**
 * Early-morning trial-status sweep. Marks tenants whose trial has elapsed as
 * `trial_expired` so the rest of the platform (UI banners, rules decisions)
 * can act on a single field. Complements dailyTrialReminders (which handles
 * pre-expiry email nudges). Idempotent — only writes when status changes.
 */
async function runDailyTrialCheck() {
  const started = Date.now();
  const now = new Date();
  const snap = await db.collection('tenants')
    .where('trialEndsAt', '<=', now)
    .get();
  const stats = { scanned: snap.size, expired: 0, skipped: 0, errors: 0 };
  for (const doc of snap.docs) {
    try {
      const t = doc.data();
      const status = String(t.status || '').toLowerCase();
      if (status === 'active' || status === 'cancelled' || status === 'canceled' || status === 'trial_expired') {
        stats.skipped++;
        continue;
      }
      await doc.ref.update({
        status: 'trial_expired',
        trialExpiredAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      stats.expired++;
    } catch (e) {
      stats.errors++;
      console.error('[dailyTrialCheck] tenant failed', doc.id, e.message);
    }
  }
  console.log('[dailyTrialCheck] done',
    JSON.stringify({ ...stats, elapsedMs: Date.now() - started }));
  return stats;
}

exports.dailyTrialCheck = functions
  .region('us-central1')
  .runWith({ maxInstances: 1, timeoutSeconds: 300, memory: '256MB', secrets: ['SENTRY_DSN'] })
  .pubsub.schedule('0 8 * * *')
  .timeZone('America/Los_Angeles')
  .onRun(async () => { await runDailyTrialCheck(); return null; });

// ════════════════════════════════════════════════════════════════════════════
//  PHASE 2 — AUTOMATION AGENTS (scheduled)
// ════════════════════════════════════════════════════════════════════════════
// See /agents/*.md for the per-agent spec. Health and Revenue feed the
// super-admin dashboard; Onboarding Nudge queues email reminders.

exports.healthCheck = agents.healthCheck;
exports.revenueSnapshot = agents.revenueSnapshot;
exports.onboardingNudge = agents.onboardingNudge;

// ════════════════════════════════════════════════════════════════════════════
//  TRANSACTIONAL EMAIL — SCHEDULED TRIAL REMINDERS
// ════════════════════════════════════════════════════════════════════════════
// Runs once daily at 09:00 America/Los_Angeles. Scans tenants whose trial
// ends in the next 7 days and fires the appropriate reminder template:
//   day = 7  → trial_ending_7d
//   day = 2  → trial_ending_2d
//   day = 0  → trial_ending_today
// Dedupe keyed by trialEmailsSent.{bucket} on the tenant doc so we never
// re-send the same bucket twice even if the cron retries.
//
// Squares of math: trialEndsAt is set in handleSignup = signup date + 30d.
// Also tolerant of manual trialEndsAt edits via super-admin dashboard.

async function runDailyTrialReminders() {
  const db = admin.firestore();
  const now = new Date();
  // Query window: trialEndsAt between now and now+8d (small pad for timezone slop)
  const windowEnd = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
  const snap = await db.collection('tenants')
    .where('trialEndsAt', '>=', now)
    .where('trialEndsAt', '<=', windowEnd)
    .get();

  const stats = { scanned: snap.size, sent: 0, skipped: 0, errors: 0 };

  for (const doc of snap.docs) {
    const t = doc.data();
    try {
      const tenantStatus = String(t.status || '').toLowerCase();
      if (tenantStatus === 'cancelled' || tenantStatus === 'canceled') {
        stats.skipped++;
        continue;
      }
      if (!t.ownerEmail) { stats.skipped++; continue; }

      const trialEnd = t.trialEndsAt && t.trialEndsAt.toDate ? t.trialEndsAt.toDate() : null;
      if (!trialEnd) { stats.skipped++; continue; }

      // Days until trial end, floored to nearest day (so the morning of day 30 = 0).
      const msPerDay = 24 * 60 * 60 * 1000;
      const daysLeft = Math.round((trialEnd.getTime() - now.getTime()) / msPerDay);

      let bucket = null;
      let template = null;
      if (daysLeft <= 0)              { bucket = 'today'; template = 'trial_ending_today'; }
      else if (daysLeft <= 2)         { bucket = '2d';    template = 'trial_ending_2d';    }
      else if (daysLeft <= 7)         { bucket = '7d';    template = 'trial_ending_7d';    }
      else                            { stats.skipped++; continue; }

      const sent = (t.trialEmailsSent && t.trialEmailsSent[bucket]) || null;
      if (sent) { stats.skipped++; continue; }

      const planInfo = PLAN_CATALOG[t.plan] || {};
      const result = await emails.sendEmail(t.ownerEmail, template, {
        tenantId: doc.id,
        restaurantName: t.restaurantName,
        plan: planInfo.name || t.plan,
        priceCents: planInfo.priceCents,
        last4: t.cardLast4 || null,
        trialEndsAt: trialEnd.toISOString(),
      });
      if (result.ok) {
        await doc.ref.update({
          [`trialEmailsSent.${bucket}`]: admin.firestore.FieldValue.serverTimestamp(),
        });
        stats.sent++;
      } else {
        stats.errors++;
        console.warn('[trialReminder] send failed', doc.id, template, result.error);
      }
    } catch (e) {
      stats.errors++;
      console.error('[trialReminder] tenant error', doc.id, e.message);
    }
  }

  console.log('[trialReminder] done', JSON.stringify(stats));
  return stats;
}

exports.dailyTrialReminders = functions
  .region('us-central1')
  .runWith({
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '512MB',
    secrets: ['RESEND_API_KEY', 'SENTRY_DSN'],
  })
  .pubsub.schedule('0 9 * * *')
  .timeZone('America/Los_Angeles')
  .onRun(async () => {
    await runDailyTrialReminders();
    return null;
  });

// Manual trigger for testing — HTTPS, super-admin only.
exports.runTrialRemindersNow = functions
  .region('us-central1')
  .runWith({
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '512MB',
    secrets: ['RESEND_API_KEY', 'SENTRY_DSN'],
  })
  .https.onRequest((req, res) => {
    cors(req, res, async () => {
      setSecurityHeaders(res);
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          res.status(401).json({ error: 'Missing auth' }); return;
        }
        const decoded = await auth.verifyIdToken(authHeader.replace('Bearer ', ''), true);
        if (decoded.superAdmin !== true) {
          res.status(403).json({ error: 'super admin required' }); return;
        }
        const stats = await runDailyTrialReminders();
        res.status(200).json({ data: stats, error: null });
      } catch (e) {
        console.error('[runTrialRemindersNow] error:', e.message);
        captureError(e, req, 'runTrialRemindersNow');
        res.status(500).json({ error: e.message });
      }
    });
  });

// Manual single-send for template QA — super-admin only.
exports.sendTestEmail = functions
  .region('us-central1')
  .runWith({
    maxInstances: 1,
    timeoutSeconds: 60,
    secrets: ['RESEND_API_KEY', 'SENTRY_DSN'],
  })
  .https.onRequest((req, res) => {
    cors(req, res, async () => {
      setSecurityHeaders(res);
      try {
        if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          res.status(401).json({ error: 'Missing auth' }); return;
        }
        const decoded = await auth.verifyIdToken(authHeader.replace('Bearer ', ''), true);
        if (decoded.superAdmin !== true) {
          res.status(403).json({ error: 'super admin required' }); return;
        }
        const { to, template, data } = req.body || {};
        if (!to || !template) {
          res.status(400).json({ error: 'to + template required' }); return;
        }
        const result = await emails.sendEmail(String(to), String(template), {
          tenantId: 'test',
          restaurantName: 'Test Restaurant',
          plan: 'Pro',
          priceCents: 4900,
          amountCents: 4900,
          last4: '4242',
          trialEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          nextBillingDate: new Date(Date.now() + 30 * 86400000).toISOString(),
          paidAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 14 * 86400000).toISOString(),
          invoiceId: 'INV-TEST-0001',
          inviterName: 'owner@example.com',
          inviteeRole: 'employee',
          setupLink: 'https://restaurantoracle.app/app/',
          ...(data || {}),
        });
        res.status(result.ok ? 200 : 502).json({ data: result, error: result.ok ? null : result.error });
      } catch (e) {
        console.error('[sendTestEmail] error:', e.message);
        captureError(e, req, 'sendTestEmail');
        res.status(500).json({ error: e.message });
      }
    });
  });
