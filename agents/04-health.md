# Agent 4 — Health

**Goal**: compute a health score per tenant hourly, surface unhealthy tenants
to the super-admin dashboard, and alert on acute issues.

## Trigger

Firebase Scheduled Function — runs every hour.

## Inputs (per tenant)

- Time since last audit_log entry (activity)
- Error rate (failed writes in last 24h from audit_log)
- Subscription status from Firestore
- Is suspended? Is canceled?
- Count of team members

## Health score (0 – 100)

Start at 100. Deductions:

| Condition                                    | Deduction |
|----------------------------------------------|-----------|
| No activity in last 24h                      | −10       |
| No activity in last 7d                       | −30       |
| No activity in last 30d                      | −50       |
| Error rate > 5% in last 24h                  | −15       |
| Error rate > 20% in last 24h                 | −35       |
| Subscription canceled, still has access      | −40       |
| Suspended                                    | −70       |
| No team members                              | −5        |
| Onboarding not complete after 14 days        | −10       |

Scores are clamped to `[0, 100]`. Buckets:

- 80–100: `healthy` (green)
- 50–79:  `warning` (yellow)
- 0–49:   `critical` (red)

## Outputs

Writes to `/platform_stats/health/tenants/{tenantId}` a doc:
```
{
  score,
  bucket,
  lastActivity,
  activeErrorRate,
  issues: ["no_activity_7d", "error_rate_high"],
  computedAt
}
```

Also updates rollup at `/platform_stats/health/_summary`:
```
{
  healthy: 12,
  warning: 3,
  critical: 1,
  computedAt
}
```

## Alerts

If a tenant drops from `healthy` → `critical` in a single cycle, writes an
entry to `/platform_alerts/` with `severity="high"` and emails super-admins.

## Implementation

`firebase/functions/agents.js` → `healthCheck` scheduled function (hourly).
Output is queryable from the super-admin console dashboard.
