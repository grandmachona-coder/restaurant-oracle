# Security Architecture - Bistro Steward

## Overview

This application uses a **Backend-First** security model. The frontend NEVER talks directly to the database.

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Frontend  │────▶│ Cloud Function   │────▶│  Firestore   │
│  (Browser)  │     │  (Admin SDK)     │     │  (Deny-All)  │
└─────────────┘     └──────────────────┘     └──────────────┘
       │                     │                      │
   Firebase Auth        Admin SDK              Rules: deny all
   (JWT tokens)        (full access)           (no client access)
```

## Security Layers

### 1. Database Level (Firestore Rules — Deny-All)
- **All collections**: `allow read, write: if false;`
- **Catch-all**: `match /{document=**} { allow read, write: if false; }`
- **Admin SDK bypasses rules**: Only Cloud Functions can read/write
- **17 collections** locked: 15 data + `approved_emails` + `audit_log`

### 2. Cloud Function Level (`firebase/functions/index.js`)
- **Authentication**: Firebase ID token verified via `auth.verifyIdToken()`
- **Email Whitelist**: `approved_emails` collection controls access
- **Role-Based Permissions**: Owner vs Employee permission matrix
- **Rate Limiting**: 100 requests/min per user (in-memory per instance)
- **Input Validation**: Payload size (1MB), string length (500), array length (1000)
- **HTML Sanitization**: `sanitizeString()` strips HTML tags server-side
- **Collection Whitelist**: Only 17 allowed collections
- **Operation Whitelist**: Only `select/insert/update/upsert/delete/invite_user`
- **Audit Logging**: All mutations logged to `audit_log` collection
- **Security Headers**: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, X-XSS-Protection
- **CORS**: Restricted to known origins (null origin rejected)
- **Method Restriction**: POST only
- **Content-Type Validation**: Must be `application/json`
- **Max Instances**: 10 (prevents billing attacks)
- **Timeout**: 30 seconds

### 3. Frontend Level
- **No Direct DB Access**: All operations via `secureApi()` wrapper
- **XSS Prevention**: `escHtml()` function escapes all user content in innerHTML
- **Debug Logging**: `console.log` replaced with `dbg()` — only active on localhost
- **Double-Click Prevention**: Global click guard (600ms debounce)
- **Loading Overlay**: Prevents UI interaction during data fetch
- **Inactivity Timeout**: Auto-signs out after inactivity

### 4. Hosting Level (`firebase.json`)
- **X-Content-Type-Options**: nosniff
- **X-Frame-Options**: DENY
- **Referrer-Policy**: strict-origin-when-cross-origin
- **Strict-Transport-Security**: max-age=31536000; includeSubDomains
- **Content-Security-Policy**: Restricts script/style/connect sources

## Files

| File | Purpose |
|------|---------|
| `firebase/firestore.rules` | Deny-all Firestore security rules |
| `firebase/functions/index.js` | Secure Cloud Function API handler |
| `firebase/firebase.json` | Hosting config with security headers |
| `firebase-adapter.js` | Frontend adapter with `secureApi()` wrapper |
| `firebase-config.js` | Client-side Firebase config (public keys only) |
| `SECURITY.md` | This documentation |

## Permission Matrix

| Operation | Owner | Employee |
|-----------|-------|----------|
| `select` (read) | All collections | All collections (except `audit_log`, `approved_emails`) |
| `insert` | All collections | `inv`, `log`, `shopping` only |
| `update` | All collections | `inv`, `log`, `shopping` only |
| `upsert` | All collections | Most collections (no security collections) |
| `delete` | All collections | None |
| `invite_user` | Yes | No |

## API Usage

All database operations go through the Cloud Function:

```javascript
// ALL operations use secureApi() — never direct Firestore access
await secureApi('select', 'ings', null, { order: { column: 'id' } });
await secureApi('upsert', 'ings', dataArray);
await secureApi('delete', 'ings', null, { eq: { id: 123 } });
```

## Rate Limiting

- **Limit**: 100 requests per minute per user (per Cloud Function instance)
- **Response**: 429 Too Many Requests when exceeded
- **Audit**: Rate limit violations logged

## Firebase API Key (Public)

The Firebase API key in `firebase-config.js` is intentionally public — it identifies the project but does not grant data access. Security is enforced by:
1. Firestore deny-all rules (no client access)
2. Cloud Function authentication (JWT required)
3. Email whitelist (only approved users)

## Deployment

```bash
# Deploy Cloud Functions
cd firebase && firebase deploy --only functions

# Deploy Firestore rules
firebase deploy --only firestore:rules

# Deploy hosting (with security headers)
firebase deploy --only hosting

# Deploy everything
firebase deploy
```

## Security Audit History

- **2026-02-13**: CAI-framework security audit — 10 findings (0 Critical, 2 High, 5 Medium, 2 Low, 1 Info). All remediations applied.
- **2026-02**: Quality audit (16 issues) — all Tier 1-3 issues resolved.
- **2026-01**: Migration from Supabase to Firebase with security overhaul.

## Audit Checklist

- [x] Firestore rules deny all client access
- [x] Cloud Function verifies JWT on every request
- [x] Email whitelist enforced
- [x] Role-based permission matrix
- [x] Input validation and HTML sanitization
- [x] Rate limiting per user
- [x] Audit logging on all mutations
- [x] CORS restricted to known origins (null origin rejected)
- [x] CSP and HSTS headers configured
- [x] No sensitive data in production console.log
- [x] Dependencies audited (0 vulnerabilities)
- [x] No service_role/admin keys in frontend code
