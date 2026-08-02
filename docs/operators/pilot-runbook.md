# Pilot Runbook

## Start the dry pilot

1. Configure `DATABASE_URL`.
2. Configure `GITHUB_TOKEN` for higher GitHub API limits.
3. Configure `DASHBOARD_ISSUE_REPO` and `DASHBOARD_ISSUE_NUMBER`.
4. Run:

```bash
npm run inspect:pilot
npm run sync:dashboard
```

## Review output

- `artifacts/runs/<inspection-id>/run.json`
- `artifacts/runs/<inspection-id>/summary.md`
- `artifacts/runs/<inspection-id>/risk-summary.json`
- `artifacts/runs/<inspection-id>/coverage.json`
- `artifacts/runs/<inspection-id>/findings/*.json`

## Dashboard review fields

The maintenance issue is updated inside a machine-managed block. The only operator-editable fields are:

- `manual_classification`
- `estimated_review_effort`
- `recommended_disposition`

## Success criteria for moving beyond v0.1

- high useful-finding precision
- low duplicate rate
- no protected scientific paths misclassified for low-risk automation
- acceptable attention burden for the reviewer
