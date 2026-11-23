# Repository Steward

Repository Steward is a safety-first maintenance control plane for a portfolio
of GitHub repositories. It discovers maintenance drift, resolves layered
policy, records reproducible evidence, and maintains a durable finding ledger
without creating source-repository activity for its own sake.

The current release is an **inspection-only production foundation**. It can run
continuously as a daemon, but source branches, commits, pull requests, reviews,
and merges remain disabled until the pilot gate is explicitly approved.

## Guarantees

- detector prerequisites are collected independently of user inventory hints;
- incomplete collection is never treated as evidence that a file is absent;
- finding identifiers and detector versions are stable and explicit;
- observations are immutable and lifecycle state is stored separately;
- partial scans and detector-version changes cannot silently resolve findings;
- protected paths raise findings to the advisory-only `R6` class;
- dashboard retries are idempotent and preserve operator-owned text;
- every run artifact bundle contains a SHA-256 manifest;
- `REPOSITORY_STEWARD_MUTATIONS_ENABLED` defaults to `false` and the operator
  doctor rejects an enabled mutation path.

See [the risk model](docs/risk-model.md) and [architecture](docs/architecture.md).

## Quick start

### Local Node.js

Requirements: Node.js 22 or newer.

```bash
npm ci
npm run check
npm run steward -- doctor
npm run inspect:pilot
```

For unauthenticated inspection of public repositories, explicitly set:

```bash
REPOSITORY_STEWARD_ALLOW_ANONYMOUS_READ_FALLBACK=true
```

Anonymous fallback is opt-in outside the supplied local Compose example.

### Turnkey container deployment

```bash
cp .env.example .env
docker compose up --build
```

This starts PostgreSQL and the scheduler daemon. The daemon scans immediately,
then repeats every `REPOSITORY_STEWARD_SCAN_INTERVAL_MINUTES` (720 by default).
It exposes health state at `http://localhost:3001/healthz`.

To also receive GitHub App webhooks:

```bash
docker compose --profile webhook up --build
```

Populate the GitHub App variables first. See [deployment](docs/deployment.md)
and the [manifest template](deploy/github-app-manifest.example.json).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run steward -- doctor` | Validate mutation gate, inventory, storage, credentials, and GitHub reads |
| `npm run steward -- scan` | Run one inspection |
| `npm run steward -- sync` | Synchronize the oldest pending run to the dashboard |
| `npm run steward -- pilot-report` | Summarize reviewed precision, safety, lifecycle, risk, and effort evidence |
| `npm run start:daemon` | Run the durable scheduled inspection process |
| `npm run start:probot` | Run the GitHub App webhook receiver |
| `npm run check` | Type-check and run the test suite |

## Configuration

The pilot inventory is [examples/hrwatts/repositories.json](examples/hrwatts/repositories.json).
The centrally managed policy is
[policy-schema/defaults/hrwatts-default-policy.json](policy-schema/defaults/hrwatts-default-policy.json).
Repository-local files use the partial
[override schema](policy-schema/repository-policy.override.schema.json).

Important environment variables are documented in [.env.example](.env.example).
Prefer GitHub App installation credentials in deployed environments. A token is
acceptable for local reads and steward-dashboard writes, but invalid credentials
fail closed unless anonymous fallback is explicitly enabled.

## Evidence

Each run writes:

- `run.json`, `coverage.json`, and `summary.md`;
- normalized finding observations;
- observation certificates and their digests;
- `risk-summary.json`;
- `artifact-manifest.json` with the byte length and SHA-256 of every evidence file.

PostgreSQL is the production state store. SQLite remains available for local
development and one-shot scans.

## Safety boundary

Repair planning remains advisory. The reusable validation workflows are not yet
authorized as source-mutation gates, and the system does not create maintenance
PRs. See [the threat model](docs/threat-model.md) and
[production runbook](docs/operators/production-runbook.md).
