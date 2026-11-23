# Threat Model

## Protected assets

- source repositories and their default branches;
- scientific results, baselines, claims, models, and release configuration;
- GitHub App private keys, installation tokens, webhook secrets, and user identity;
- finding history, manual classifications, certificates, and audit evidence.

## Principal threats and current controls

### Accidental source mutation

Source mutation defaults off, the doctor rejects an enabled mutation flag, and
repair planning remains ineligible. Dashboard writes are isolated to a configured
steward issue.

### Incomplete evidence interpreted as success

Detectors declare prerequisites. Missing prerequisite collection fails that
detector, coverage records the failure, and incomplete or filtered coverage cannot
resolve findings.

### Credential confusion or overreach

GitHub App installation authentication is preferred. Invalid authenticated reads
fail closed unless an operator explicitly enables anonymous fallback. Source code
never runs with a source-write token because no such path exists.

### Duplicate or concurrent work

Finding keys are versioned and content-derived. Dashboard sync is digest-confirmed
and retry-safe. The daemon uses a PostgreSQL advisory lock and Actions uses a
single concurrency group.

### Webhook spoofing and replay

Probot validates the webhook secret. A durable delivery-ID inbox and asynchronous
webhook work queue are still required before webhook events can authorize state
transitions; current handlers log lifecycle events only.

### Evidence tampering

Every artifact file is hashed into a manifest and certificate digests are stored
in the audit database. Cryptographic signing and external durable evidence storage
remain required before certificates are treated as release attestations.

### Supply-chain compromise

CI actions are pinned to commits, installs use the lockfile, container bases are
digest-pinned, and the runtime image is non-root. SBOM generation, provenance
attestation, vulnerability scanning, and verification policy remain release gates.

## Deferred mutation controls

Before source-repository repair can be enabled, implement isolated read-only
validation, SHA-bound approval, stale-approval invalidation, protected-change hard
stops, branch protection checks, and post-merge verification. The observation
pilot must also be explicitly evaluated and approved.
