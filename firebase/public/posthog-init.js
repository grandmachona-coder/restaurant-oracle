/*
 * PostHog product analytics — loader + config.
 * Public API key (phc_...) is safe to embed in client JS.
 * Swap 'phc_YOUR_KEY' below for the real project key before deploy.
 *
 * Loaded by index.html, signup.html, admin.html via <script src="posthog-init.js"></script>
 * in <head>. Must run before other app JS so posthog.capture() queues work during boot.
 */
(function(){
  'use strict';
  // Standard PostHog async stub — queues calls until the real script loads.
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  posthog.init('phc_srhjbdeE5yJZC7F4wVSNqwSui46eHJErtQpXfSQ6Te32', {
    api_host: 'https://us.i.posthog.com',
    person_profiles: 'identified_only', // anon /landing visitors don't create profiles
    capture_pageview: false,             // SPA — we emit page_viewed manually in go()
    capture_pageleave: false,            // no auto-events before identify (consent surrogate)
    respect_dnt: true,
    ip: false,                           // GDPR-friendly: drop client IP at server
    disable_session_recording: true,     // PII-risky for restaurant ops
    autocapture: false,                  // explicit events only — avoids accidental PII
    persistence: 'localStorage+cookie',
    // Strip known-sensitive field values from any event properties.
    sanitize_properties: function(props){
      if(!props) return props;
      var drop = ['password','newPassword','confirmPassword','cardNonce','cvv','verificationToken'];
      for(var k in props){
        if(drop.indexOf(k) !== -1) delete props[k];
      }
      return props;
    },
  });

  /**
   * Identify the current user + attach tenant group.
   * Call after Firebase Auth custom claims are loaded.
   * Never call before auth is known (causes anon→id merge issues per PostHog docs).
   */
  window.roIdentify = function(user, claims, extra){
    if(!user || !user.uid) return;
    claims = claims || {};
    extra = extra || {};
    var personProps = {
      tenantId:   claims.tenantId   || null,
      tenantSlug: claims.tenantSlug || null,
      role:       claims.role       || null,
      approved:   !!claims.approved,
      plan:       extra.plan        || null,
      emailVerified: !!user.emailVerified,
      signedUpAt: user.metadata && user.metadata.creationTime || null,
    };
    // Only include email if explicitly allowed (hash it for privacy).
    if(extra.includeEmail && user.email){ personProps.email = user.email; }
    try { posthog.identify(user.uid, personProps); } catch(e) {}
    if(claims.tenantId){
      try {
        posthog.group('tenant', claims.tenantId, {
          slug: claims.tenantSlug || null,
          plan: extra.plan || null,
        });
      } catch(e) {}
    }
  };

  /**
   * Clear identity on sign-out so the next user isn't tracked under the old ID.
   */
  window.roPosthogReset = function(){
    try { posthog.reset(); } catch(e) {}
  };

  /**
   * Safe capture — guards against PostHog not initialized (unlikely but defensive).
   */
  window.roTrack = function(event, props){
    try { posthog.capture(event, props || {}); } catch(e) {}
  };
})();
