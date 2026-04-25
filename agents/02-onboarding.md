# Agent 2 — Onboarding

**Goal**: guide new tenants through the first week. Trigger nudge emails at
the right moments based on what they've done so far.

## Trigger

Firebase Scheduled Function — runs daily at 14:00 UTC.

## Inputs (per tenant, read from Firestore)

- `tenant.createdAt` — age of account
- `tenant.onboardingComplete` — if true, agent skips this tenant
- Presence of docs in: `ings/`, `areas/`, `team_members/`, `log/`
- Last sign-in time (from Auth)

## Onboarding milestones

| # | Milestone                              | Signal                           |
|---|----------------------------------------|----------------------------------|
| 1 | Completed signup                       | Tenant doc exists                |
| 2 | First sign-in                          | Any audit log entry              |
| 3 | First inventory item                   | `ings/` has ≥1 doc               |
| 4 | First count (inventory used)           | `log/` has ≥1 entry              |
| 5 | Invited a teammate                     | `team_members/` has ≥2           |
| 6 | Completed onboarding (self-reported)   | `tenant.onboardingComplete=true` |

## Nudge schedule

| Days since signup | Condition                       | Email subject                             |
|-------------------|---------------------------------|-------------------------------------------|
| 2                 | milestone 2 missed              | "Welcome back — here's how to sign in"    |
| 4                 | milestone 3 missed              | "Add your first ingredient in 60 seconds" |
| 7                 | milestone 4 missed              | "Run your first count this week"          |
| 10                | milestone 5 missed              | "Invite your team — better together"      |
| 14                | milestone 6 missed              | "Let's get you set up on a quick call"    |

Never send more than one nudge per tenant per day. Track sent nudges in
`/tenants/{id}/onboarding/nudges` with `{milestone, sentAt}`.

## Actions

- For each active tenant: compute current milestone, check schedule, enqueue
  email if due + not already sent for this milestone.

## Escalation

If day 14 nudge goes unresponded (no sign-in for 5 days after), flag to
Health agent with `health_issue="inactive_new_tenant"`.

## Implementation

`firebase/functions/agents.js` → `onboardingNudge` scheduled function.
Emails sent via Resend (requires `RESEND_API_KEY` secret — currently stubbed).
