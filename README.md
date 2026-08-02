# repository-steward

`repository-steward` is a GitHub App centered maintenance system for a configured portfolio of repositories.

This repository currently implements the **v0.1 dry pilot**:

- central twice-daily inspections;
- per-repository policy loading and classification;
- versioned finding keys, deduplication, and notification suppression windows;
- SQLite/PostgreSQL-backed audit persistence with immutable observations and a finding ledger;
- managed-block dashboard issue synchronization;
- workflow artifacts and validation certificate generation;
- no source-repository maintenance PR creation yet.

The initial pilot inventory targets:

- `hrwatts/gem-lasso`
- `hrwatts/median-ci-power-ttest`
- `hrwatts/ifsn-logreg-benchmarks`
- `hrwatts/or-algos`
- `hrwatts/digital-harmony-studies`

## Commands

```bash
npm install
npm run inspect:pilot
npm run sync:dashboard
npm run check
```

## Environment

Important environment variables:

- `DATABASE_URL`
  - unset or `sqlite:///...` -> SQLite audit store
  - `postgres://...` -> PostgreSQL audit store
- `GITHUB_TOKEN`
  - optional token for higher GitHub API rate limits and dashboard issue writes
- `DASHBOARD_ISSUE_REPO`
  - repository in `owner/name` form for the maintenance dashboard issue
- `DASHBOARD_ISSUE_NUMBER`
  - issue number to update
- `REPOSITORY_STEWARD_ARTIFACT_NAME`
  - artifact bundle name recorded with finding observations
- `REPOSITORY_STEWARD_SYNC_RUN_ID`
  - optional explicit inspection run ID for dashboard sync retries
- `REPOSITORY_STEWARD_MUTATIONS_ENABLED`
  - `false` by default in v0.1

## Layout

The repository follows the implementation structure described in the project plan:

- [apps/probot-server](apps/probot-server/src/server.ts)
- [apps/scheduler-runner](apps/scheduler-runner/src/index.ts)
- [packages](packages)
- [policy-schema](policy-schema)
- [examples/hrwatts](examples/hrwatts/repositories.json)
- [docs](docs)
