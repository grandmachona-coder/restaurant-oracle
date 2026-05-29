/* Bistro Steward — Service Worker
 * Strategy:
 *   - HTML: network-first (no-cache header on hosting; SW must not stale-serve)
 *   - Static assets (icon, manifest, posthog, sentry, firebase-config): cache-first
 *   - Cloud Function calls (us-central1-restaurant-oracle): never cache
 *   - Firestore traffic: never cache (handled by Firestore offline persistence)
 *   - Cross-origin (fonts, gstatic, posthog cdn): cache-first w/ stale fallback
 * Versioned cache name → bumping VERSION drops old caches on activate.
 */
'use strict';

const VERSION = 'v13-2026-05-29-html-nostore';
const STATIC_CACHE = 'bs-static-' + VERSION;
const RUNTIME_CACHE = 'bs-runtime-' + VERSION;

const PRECACHE_URLS = [
  '/manifest.json',
  '/icon.png',
  '/firebase-config.js',
  '/posthog-init.js',
  '/sentry-init.js',
  '/app.html'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      return cache.addAll(PRECACHE_URLS).catch(function () { /* allow partial */ });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== STATIC_CACHE && k !== RUNTIME_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isHtml(req) {
  return req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') !== -1;
}

function isCloudFn(url) {
  return /us-central1-restaurant-oracle\.cloudfunctions\.net/.test(url) ||
         /\/secureApi|\/superAdmin|\/adminBilling|\/inboundInvoice|\/squareWebhook|\/signupTenant/.test(url);
}

function isFirestore(url) {
  return /firestore\.googleapis\.com|firebaseio\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com/.test(url);
}

function isStatic(url) {
  return /\/(manifest\.json|icon\.png|firebase-config\.js|posthog-init\.js|sentry-init\.js)$/.test(url);
}

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = req.url;

  // Pass-through: never cache live API/auth traffic
  if (isCloudFn(url) || isFirestore(url)) return;

  // HTML → network-first, fall back to cache only if offline
  if (isHtml(req)) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).then(function (resp) {
        // Mirror successful HTML to runtime cache for offline fallback
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(RUNTIME_CACHE).then(function (c) { c.put(req, copy); });
        }
        return resp;
      }).catch(function () {
        return caches.match(req).then(function (m) { return m || caches.match('/app.html'); });
      })
    );
    return;
  }

  // Static assets → cache-first
  if (isStatic(url) || /^https?:\/\/fonts\.(googleapis|gstatic)\.com/.test(url)) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (resp) {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(STATIC_CACHE).then(function (c) { c.put(req, copy); });
          }
          return resp;
        });
      })
    );
    return;
  }

  // Default: network with runtime cache fallback
  event.respondWith(
    fetch(req).then(function (resp) {
      if (resp && resp.ok && resp.type === 'basic') {
        const copy = resp.clone();
        caches.open(RUNTIME_CACHE).then(function (c) { c.put(req, copy); });
      }
      return resp;
    }).catch(function () { return caches.match(req); })
  );
});
