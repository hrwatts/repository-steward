# Production Runbook

## Initial validation

1. Configure PostgreSQL and GitHub App installation credentials.
2. Keep `REPOSITORY_STEWARD_MUTATIONS_ENABLED=false`.
3. Run `npm run steward -- doctor`.
4. Start the daemon and confirm `/healthz` reports `status: ok`.
5. Verify the first run's coverage before trusting its findings.
6. Configure dashboard writes only after scan-only operation succeeds.

## Routine checks

- `lastCompletedAt` advances at the configured interval;
- `lastError` remains null;
- every expected detector either completed or visibly failed;
- pending dashboard syncs converge;
- artifact manifests verify before evidence is archived;
- PostgreSQL backups complete and restore tests remain current.

## Failure handling

- Authentication errors: stop; verify GitHub App installation scope and identity.
  Do not silently switch to a broader token.
- Rate limits: allow bounded retries to finish, then reduce scan concurrency or
  frequency. Do not loop aggressively.
- Partial collection: retain existing findings and investigate the failed API or
  detector; never mark findings resolved from the partial run.
- Dashboard conflict: preserve the issue body and audit metadata, correct the
  controlled manual block, and retry the same run.
- Database outage: stop scanning and restore PostgreSQL before resuming. Do not
  bootstrap an empty production ledger.

## Backup and recovery

Back up PostgreSQL and durable evidence storage together. Recovery is complete
only when inspections, observations, ledgers, sync metadata, and evidence manifests
refer to one consistent point in time.

## Mutation gate

There is no operational procedure for enabling source writes in this release.
Changing the environment flag is insufficient and intentionally rejected by the
doctor. A separately reviewed release must implement and validate the missing
controls first.
