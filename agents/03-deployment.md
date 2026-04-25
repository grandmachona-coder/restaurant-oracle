# Agent 3 — Deployment

**Goal**: when the platform ships a release, notify tenants and surface the
changelog to super-admins.

## Trigger

Firestore onCreate trigger on `releases/{releaseId}`. Releases are written
by the deploy pipeline (`firebase deploy --only hosting,functions`) via a
post-deploy hook that writes `{version, timestamp, summary, breakingChanges, commitRange}`.

## Status

**Spec only** — deferred. For a single-codebase multi-tenant SaaS, version
management is simple: every tenant runs the same bundle. Notification is
nice-to-have but not MVP-critical.

## Future actions

1. Write a changelog entry to `/platform_stats/releases/log/{releaseId}`.
2. Email super-admin with release summary.
3. If `breakingChanges=true`: surface a tenant banner and notify every owner.
4. Increment `/platform_stats/dashboard.currentVersion`.

## Source of truth

Release entries live in the root `releases/` collection. The super-admin
console is the only reader (users only see the banner injected at runtime).

## Implementation

Not implemented. Add when first breaking change is shipped.
