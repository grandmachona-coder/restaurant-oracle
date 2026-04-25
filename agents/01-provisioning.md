# Agent 1 — Provisioning

**Goal**: when a new tenant signs up, set up a working empty workspace and
send a welcome email. This runs once per tenant, at signup.

## Trigger

Chained synchronously from `signupTenant` after the Square subscription is
confirmed. If the chain fails, tenant creation still succeeds — provisioning
is idempotent and re-runnable.

## Inputs

- `tenantId` (Firestore doc id)
- `ownerEmail`
- `plan` (starter / pro / scale)

## Actions

1. Ensure these sub-collections have a starter document so the UI shows an
   empty-but-populated state:
   - `settings/general` — `{ restaurantName, currency: "USD", createdAt }`
   - `areas/default` — `{ name: "Main", order: 0 }`
   - `units/{ea,lb,oz,gal}` — four common unit defaults
2. Reserve counters: `counters/ids = { next: 1 }`
3. Write `provisioning_complete = true` on the tenant doc.
4. Queue a welcome email (Resend / SendGrid) with:
   - Link to sign-in
   - Plan summary
   - 3 quick-start steps (add an ingredient, add an area, invite a teammate)

## Failure modes

- Firestore throttling → retry via backoff (3 attempts).
- Email send failure → log but don't block; the tenant still gets the console.
- If re-run, all writes must be idempotent (`.set({...}, {merge:true})`).

## Escalation

On persistent failure (>3 retries), write an entry to
`platform_alerts/` with `severity="high"` — the Health agent surfaces this in
the super-admin dashboard.

## Implementation

`firebase/functions/agents.js` → `provisioningAgent` (HTTP, internal only).
Called from `signupTenant` via `await agents.provisioning({ tenantId, ... })`.
