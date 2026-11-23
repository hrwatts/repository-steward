# Architecture

Repository Steward separates observation, durable state, operator projection,
and future source mutation so a failure in one stage cannot silently authorize
another.

## Runtime services

- `apps/daemon-runner`: reliable interval scheduling, PostgreSQL advisory lock,
  health state, inspection, and optional dashboard synchronization.
- `apps/scheduler-runner`: one complete inspection and evidence bundle.
- `apps/dashboard-sync-runner`: idempotent projection of durable ledger state to
  the managed block in a GitHub issue.
- `apps/probot-server`: authenticated webhook receiver and health endpoint.
- `apps/cli`: operator `doctor`, one-shot scan, and dashboard sync commands.

## Inspection flow

1. Load and validate the repository inventory.
2. Ask the detector catalog for required paths and collect their contents at the
   repository default-branch head.
3. Merge central policy with repository-local partial overrides.
4. Execute every detector independently and record explicit coverage.
5. Raise detector-declared risk when protected or sensitive evidence requires it.
6. Generate observations, certificates, and a content-addressed artifact manifest.
7. Commit the inspection bundle transactionally to SQLite or PostgreSQL.
8. Reconcile the finding ledger and update only the dashboard's managed block.

## State model

- observations are immutable facts tied to a run, detector version, head SHA,
  certificate digest, and artifact location;
- ledgers are the authoritative lifecycle projection;
- notification suppression does not close or operator-suppress a finding;
- resolution requires two complete, unfiltered absences from the same detector
  version;
- the GitHub issue is a projection, not the source of computed history.

## Concurrency and retries

The daemon holds a PostgreSQL advisory lock for an entire inspection cycle, so
only one replica schedules work. GitHub Actions uses a non-cancelling concurrency
group. GitHub reads and the idempotent dashboard update use bounded rate-limit-
aware retries; list operations paginate.

## Deliberately absent

- source-repository branch or PR creation;
- automatic dispatch of repository-local code with a write token;
- user-attributed approvals;
- autonomous changes to protected scientific, security, release, or baseline paths.
