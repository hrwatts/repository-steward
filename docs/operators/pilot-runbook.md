# Pilot Runbook

## Start or resume inspection-only operation

1. Configure `DATABASE_URL`.
2. Configure GitHub App installation credentials, a token, or explicit anonymous
   fallback for public reads.
3. Configure `DASHBOARD_ISSUE_REPO` and `DASHBOARD_ISSUE_NUMBER`.
4. Validate and run:

```bash
npm run steward -- doctor
npm run steward -- scan
npm run steward -- sync
```

## Review output

- `artifacts/runs/<inspection-id>/run.json`
- `artifacts/runs/<inspection-id>/summary.md`
- `artifacts/runs/<inspection-id>/risk-summary.json`
- `artifacts/runs/<inspection-id>/coverage.json`
- `artifacts/runs/<inspection-id>/findings/*.json`
- `artifacts/runs/<inspection-id>/certificates/*.json`
- `artifacts/runs/<inspection-id>/snapshots/*.json`
- `artifacts/runs/<inspection-id>/artifact-manifest.json`

## Dashboard review fields

The maintenance issue is updated inside a machine-managed block. The only operator-editable fields are:

- `manual_classification`
- `estimated_review_effort`
- `recommended_disposition`

## Mutation-gate evidence

The gate is not passed merely because scans complete. Record, by detector and
repository:

- actionable precision and false-positive rate from operator classifications;
- duplicate-notification and finding-churn rates;
- median and high-percentile review effort;
- complete-coverage rate and detector failure rate;
- zero protected-path or protected-change underclassification;
- bounded reviewer attention burden over a representative window.

The historical pilot dashboard remained unreviewed, so it does not yet supply
these measurements. Source-repository repair must remain disabled until the
metrics are collected, reviewed, and explicitly approved.

After dashboard classifications are synchronized, generate the evidence summary:

```bash
npm run steward -- pilot-report
```

The report deliberately returns `human_decision_required`; it cannot authorize
source mutation.
