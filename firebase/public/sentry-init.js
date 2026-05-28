/*
 * Sentry browser error monitoring — loader + config.
 *
 * DSN is public (safe to embed in client JS). Swap 'FRONTEND_DSN_PLACEHOLDER'
 * below for the real project DSN before deploy.
 *
 * Release token '%GIT_SHA%' is rewritten at deploy time by firebase/deploy.sh.
 *
 * Loaded by app.html, index.html, signup.html, admin.html, super-admin.html via
 *   <script src="https://browser.sentry-cdn.com/10.50.0/bundle.tracing.min.js" crossorigin="anonymous"></script>
 *   <script src="sentry-init.js"></script>
 * in <head>, AFTER the Sentry CDN bundle.
 */
(function(){
  'use strict';

  // If the CDN bundle failed to load (blocked, offline, CSP), degrade silently.
  if (typeof Sentry === 'undefined') {
    if (window.console && console.warn) {
      console.warn('[sentry-init] Sentry CDN not loaded; error monitoring disabled');
    }
    window.roSentryIdentify = function(){};
    window.roSentryReset    = function(){};
    return;
  }

  var host = (location && location.hostname) || '';
  // P2 fix — restaurantoracle.app is the rebrand target; its CORS + CSP wiring
  // was added but this Sentry env detector still tagged it 'staging'. Treat
  // both apex domains (and their www) as production.
  var env  = (host === 'bistrosteward.com'    || host === 'www.bistrosteward.com'
            || host === 'restaurantoracle.app' || host === 'www.restaurantoracle.app')
    ? 'production'
    : (host === 'localhost' || host === '127.0.0.1' ? 'development' : 'staging');

  var DSN = 'FRONTEND_DSN_PLACEHOLDER';
  if (DSN === 'FRONTEND_DSN_' + 'PLACEHOLDER') {
    // DSN not configured — skip init silently rather than throw "Invalid Sentry Dsn".
    window.roSentryIdentify = function(){};
    window.roSentryReset    = function(){};
    return;
  }

  Sentry.init({
    dsn: DSN,
    environment: env,
    release: 'restaurant-oracle@%GIT_SHA%',
    tracesSampleRate: 0.1,

    // Noise filter — known-benign errors we never want to page on.
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications.',
      'Non-Error promise rejection captured',
      /FirebaseError.*offline/,
      /FirebaseError.*unavailable/,
      /Failed to fetch/,
      /Load failed/,
      /NetworkError when attempting to fetch resource/,
    ],

    // Drop errors coming from browser extensions (not our bugs).
    denyUrls: [
      /^chrome-extension:\/\//,
      /^moz-extension:\/\//,
      /^safari-extension:\/\//,
    ],

    // Scrub PII / secrets from every event before sending.
    beforeSend: function(event){
      try {
        if (event.extra) {
          ['data','body','payload','request','response','rows','claims'].forEach(function(k){
            if (k in event.extra) delete event.extra[k];
          });
        }
        // Strip query string — may contain tokens (signup verification links, etc).
        if (event.request && event.request.url) {
          event.request.url = event.request.url.split('?')[0];
        }
        // Redact known-sensitive fields inside breadcrumb data.
        if (event.breadcrumbs && event.breadcrumbs.length) {
          var drop = ['password','newPassword','confirmPassword','cardNonce','cvv',
                      'verificationToken','token','idToken','access_token','refresh_token'];
          event.breadcrumbs.forEach(function(b){
            if (b && b.data && typeof b.data === 'object') {
              for (var i = 0; i < drop.length; i++) {
                if (drop[i] in b.data) b.data[drop[i]] = '[REDACTED]';
              }
            }
          });
        }
      } catch(_) { /* never block reporting on scrub failure */ }
      return event;
    },
  });

  // I-17 (Inspector): tag EVERY event with an auth phase from the moment Sentry
  // initializes. Errors thrown before Firebase Auth resolves (CDN load, login
  // screen, signup flow) otherwise carry no tenant/user context and are
  // indistinguishable from authenticated-session errors in the dashboard.
  // roSentryIdentify flips this to 'authenticated'; roSentryReset flips it back.
  try { Sentry.setTag('auth_phase', 'pre-auth'); } catch(_) {}

  /**
   * Attach user identity + tenant tags to all future events.
   * Mirror of window.roIdentify (PostHog). Call after Firebase Auth claims are loaded.
   * `extra.surface` optional (e.g. 'admin') to distinguish page contexts.
   */
  window.roSentryIdentify = function(user, claims, extra){
    if (!user || !user.uid) return;
    claims = claims || {};
    extra  = extra  || {};
    try {
      Sentry.setUser({ id: user.uid, email: user.email || undefined });
      Sentry.setTag('auth_phase', 'authenticated');
      if (claims.tenantId)   Sentry.setTag('tenantId',   claims.tenantId);
      if (claims.tenantSlug) Sentry.setTag('tenantSlug', claims.tenantSlug);
      if (claims.role)       Sentry.setTag('role',       claims.role);
      if (extra.surface)     Sentry.setTag('surface',    extra.surface);
    } catch(_) {}
  };

  /**
   * Clear identity on sign-out so the next user's errors aren't attributed to the old one.
   */
  window.roSentryReset = function(){
    try {
      Sentry.setUser(null);
      Sentry.setTag('auth_phase', 'pre-auth');
      Sentry.setTag('tenantId',   undefined);
      Sentry.setTag('tenantSlug', undefined);
      Sentry.setTag('role',       undefined);
    } catch(_) {}
  };
})();
