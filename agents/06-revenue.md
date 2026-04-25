# Agent 6 — Revenue

**Goal**: compute MRR, ARR, churn, and plan mix daily. Surface weekly digest
to super-admins. Detect anomalies (MRR drop >10% day-over-day).

## Trigger

Firebase Scheduled Function — runs daily at 06:00 UTC.

## Inputs

- Every tenant doc (`status`, `plan`, `createdAt`, `canceledAt`)
- Plan pricing: starter=$29, pro=$49, scale=$99

## Metrics computed

| Metric            | Definition                                           |
|-------------------|------------------------------------------------------|
| MRR               | Σ plan-price for every `status=active` tenant        |
| ARR               | MRR × 12                                             |
| New MRR           | MRR from tenants created in last 30d                 |
| Churned MRR       | MRR from tenants canceled in last 30d                |
| Net New MRR       | New − Churned                                        |
| Tenant count      | Total, by status, by plan                            |
| Churn rate        | canceled_in_period / active_at_start_of_period       |

## Outputs

Daily snapshot to `/platform_stats/revenue/daily/{YYYY-MM-DD}`:
```
{
  date: "2026-04-23",
  mrrCents, arrCents,
  newMrrCents, churnedMrrCents, netNewMrrCents,
  tenantsTotal, tenantsByStatus: {active, suspended, canceled},
  tenantsByPlan: {starter, pro, scale},
  churnRate,
  computedAt
}
```

Latest also written to `/platform_stats/revenue/_latest` for the super-admin
dashboard to read without scanning the daily collection.

## Weekly digest

Every Monday, reads last 7 days and emails super-admins:
- Current MRR vs 7d ago (delta + %)
- Top growth plan this week
- Churn count this week
- Weekly signups
- Health summary (from Health agent rollup)

## Anomaly detection

If today's MRR < yesterday's by >10%, writes `/platform_alerts/` entry with
`severity="high"` and emails super-admins immediately.

## Implementation

`firebase/functions/agents.js` → `revenueSnapshot` scheduled function (daily).
Weekly digest is a second scheduled function (Mon 08:00 UTC).
