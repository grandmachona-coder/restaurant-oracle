# Restaurant Oracle — Automation Agents

Six autonomous agents run on Firebase Cloud Functions. Each has a narrow scope,
a clear trigger, and writes its decisions to either Firestore or an email/SMS
channel. Agents read from `/tenants/{tenantId}/` and either act directly, or
flag issues for the super-admin console.

| Agent        | Trigger                         | Purpose                                      | Status       |
|--------------|---------------------------------|----------------------------------------------|--------------|
| Provisioning | HTTP (chained from signupTenant)| Seed new tenant, send welcome                | Implemented  |
| Onboarding   | Scheduled (daily 14:00 UTC)     | Nudge tenants who stalled during setup       | Implemented  |
| Deployment   | Firestore trigger on `releases/`| Notify tenants of platform changes           | Spec only    |
| Health       | Scheduled (hourly)              | Compute per-tenant health score; alert super | Implemented  |
| Support      | HTTP (webhook from inbox)       | Route + draft reply using Gemini             | Spec only    |
| Revenue      | Scheduled (daily 06:00 UTC)     | Compute MRR, churn, trends; weekly digest    | Implemented  |

All implemented agents live in `firebase/functions/agents.js` and export
Cloud Functions. The super-admin console (`/super-admin`) surfaces the output
of Health + Revenue in the dashboard.

See individual spec files in this directory for scope, inputs, outputs, and
escalation rules per agent.
