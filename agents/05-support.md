# Agent 5 — Support

**Goal**: tenant submits a question; agent classifies it, drafts a reply
with Gemini, routes to either auto-reply (simple/FAQ) or human-in-loop
(complex/billing/outage).

## Trigger

HTTP endpoint `/supportInquiry` — called from the in-app "Help" button.

## Status

**Spec only** — deferred. Support inbox UI not yet built. For Phase 2 MVP,
email `support@restaurantoracle.app` is the sole channel.

## Future actions

1. Receive `{ tenantId, question, context }` from the app.
2. Categorize via Gemini: `billing | how-to | bug | outage | other`.
3. For `how-to`: draft answer from known-good knowledge base + send to user.
4. For `billing`: escalate to human (write ticket + email super-admin).
5. For `bug` / `outage`: write to `/platform_alerts/` with full context.
6. Log every interaction to `/tenants/{id}/support_tickets/`.

## Knowledge base

Would live in `/platform_knowledge/` as doc pairs `{question, answer}`.
Retrieval via simple keyword match for now (not RAG) — scale later if needed.

## Implementation

Not implemented. Build when support volume justifies it (post-launch).
