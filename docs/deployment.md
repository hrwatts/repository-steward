# Deployment

## Local or small self-hosted installation

Copy `.env.example` to `.env`, review every value, then run:

```bash
docker compose up --build
```

The default stack contains PostgreSQL and the scheduler daemon. PostgreSQL data
and run artifacts use named volumes. The daemon is safe to replicate because a
PostgreSQL advisory lock permits only one active scan cycle.

Run `npm run steward -- doctor` before the first deployed scan. For webhook
operation, configure a GitHub App and start the optional profile:

```bash
docker compose --profile webhook up --build
```

## GitHub App permissions

Use the narrowest installation scope possible. Inspection needs repository
metadata, contents read, and pull requests read. Dashboard synchronization needs
issues write only on the steward repository. Do not grant contents write while
the mutation gate is closed.

The webhook receiver needs a high-entropy secret and HTTPS termination. Subscribe
only to the installation, pull request, pull request review, check suite, workflow
run, and authorization events actually consumed by the service.

Use `deploy/github-app-manifest.example.json` as a registration template and
replace its example URLs before submission.

## Production requirements

- PostgreSQL with encrypted connections, backups, restore drills, and monitored
  storage growth;
- secrets from the deployment platform, not an `.env` file;
- TLS termination for the webhook endpoint;
- monitoring of `/healthz`, failed cycles, detector failures, and pending syncs;
- immutable container digests and reviewed dependency updates;
- durable artifact storage when evidence must outlive CI retention.

The container image is a multi-stage, non-root build using `npm ci`. Base images
and GitHub Actions are pinned by digest or commit SHA.

## GitHub Actions fallback

`.github/workflows/update.yml` remains a low-infrastructure fallback. It restores
the newest unexpired state artifact and serializes runs. It is not the recommended
production scheduler because GitHub disables scheduled workflows in inactive
public repositories.
