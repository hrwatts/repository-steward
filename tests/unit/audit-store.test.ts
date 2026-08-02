import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { test } from "../harness.js";
import { SqliteAuditStore } from "../../packages/audit-store/src/index.js";
import type { InspectionBundle } from "../../packages/audit-store/src/index.js";
import type { FindingLedger } from "../../packages/shared-types/src/index.js";

test("sqlite audit store persists observation evidence and sync metadata", async () => {
  const store = new SqliteAuditStore(":memory:");
  await store.initialize();

  const bundle: InspectionBundle = {
    run: {
      id: "run-1",
      startedAt: "2026-08-02T20:06:29.000Z",
      completedAt: "2026-08-02T20:06:38.000Z",
      dryRun: true,
      repositories: ["hrwatts/gem-lasso"],
      findings: [],
      coverage: [
        {
          repository: "hrwatts/gem-lasso",
          detectors_expected: ["dependency-automation"],
          detectors_completed: ["dependency-automation"],
          detectors_failed: [],
          collection_complete: true,
          filtered: false,
          head_sha: "abc123",
        },
      ],
    },
    observations: [
      {
        run_id: "run-1",
        observed_at: "2026-08-02T20:06:38.000Z",
        finding_key: "sha256:key-1",
        dedup_key: "hrwatts/gem-lasso::dependency-automation::renovate-or-dependabot-missing",
        fingerprint: "hrwatts/gem-lasso::dependency-automation-missing",
        fingerprint_schema_version: 1,
        repository: "hrwatts/gem-lasso",
        detector_id: "dependency-automation",
        detector_version: "1",
        risk_class: "R1",
        status: "advisory",
        title: "Dependency automation is not configured",
        code: "dependency_automation_missing",
        summary: "Missing automation.",
        canonical_subject: "dependency-automation",
        canonical_condition: "renovate-or-dependabot-missing",
        evidence_normalized: ["No dependabot config."],
        source_urls: [],
        observed_head_sha: "abc123",
        certificate_digest: "digest-1",
        artifact_run_url: "https://github.com/hrwatts/repository-steward/actions/runs/1",
        artifact_name: "repository-steward-run-run-1",
        artifact_relative_path: "findings/sha256-key-1.json",
        artifact_retention_until: "2026-11-01T00:00:00.000Z",
        notification_suppressed: false,
        protected_paths_touched: [],
        tags: ["dependencies"],
        related_paths: ["renovate.json"],
        data: {},
      },
    ],
    certificates: [
      {
        inspectionId: "run-1",
        findingKey: "sha256:key-1",
        hash: "digest-1",
        certificate: {
          schema_version: 1,
          repository: "hrwatts/gem-lasso",
          inspection_id: "run-1",
          base_sha: null,
          head_sha: "abc123",
          generator: {
            name: "repository-steward",
            version: "0.1.0",
          },
          change: {
            class: "dependency_automation_missing",
            risk: "R1",
            reason: "Missing automation.",
            changed_files: ["renovate.json"],
            protected_files: [],
            changed_test_files: [],
          },
          validation: {
            clean_install: "not_run",
            unit_tests: "not_run",
            lint: "not_run",
            docs: "not_run",
            idempotence: "not_run",
          },
          uncertainties: ["pilot"],
          eligible_for_minimal_review: false,
        },
      },
    ],
    syncMetadata: {
      run_id: "run-1",
      sync_attempt_id: "attempt-1",
      sync_state: "pending",
      issue_repository: "hrwatts/repository-steward",
      issue_number: 1,
      prior_body_digest: null,
      desired_body_digest: null,
      confirmed_body_digest: null,
      issue_updated_at: null,
      github_response_metadata: {},
    },
  };

  await store.recordInspectionBundle(bundle);
  const loadedRun = await store.loadInspection("run-1");
  const observations = await store.loadObservationsForRun("run-1");
  const syncMetadata = await store.loadSyncMetadata("run-1");

  assert.equal(loadedRun.id, "run-1");
  assert.equal(observations[0]?.evidence_normalized[0], "No dependabot config.");
  assert.equal(syncMetadata?.sync_state, "pending");
});

test("ledger replacement retains durable evidence after artifact expiry", async () => {
  const store = new SqliteAuditStore(":memory:");
  await store.initialize();

  const ledger: FindingLedger = {
    finding_key: "sha256:key-1",
    dedup_key: "hrwatts/gem-lasso::dependency-automation::renovate-or-dependabot-missing",
    fingerprint_schema_version: 1,
    repository: "hrwatts/gem-lasso",
    detector_id: "dependency-automation",
    detector_version: "1",
    risk_class: "R1",
    title: "Dependency automation is not configured",
    code: "dependency_automation_missing",
    summary: "Missing automation.",
    lifecycle_state: "resolved",
    notification_suppressed_until: null,
    first_seen_at: "2026-08-02T20:06:38.000Z",
    last_seen_at: "2026-08-02T20:06:38.000Z",
    resolved_at: "2026-08-04T00:00:00.000Z",
    reopened_at: null,
    occurrence_count: 1,
    consecutive_complete_absences: 2,
    manual_classification: "informational",
    estimated_review_effort: "5m",
    recommended_disposition: "observe",
    latest_evidence: ["No dependabot config."],
    latest_artifact: {
      artifact_run_url: "https://github.com/hrwatts/repository-steward/actions/runs/1",
      artifact_name: "repository-steward-run-run-1",
      artifact_relative_path: "findings/sha256-key-1.json",
      artifact_retention_until: "2026-08-03T00:00:00.000Z",
    },
    latest_source_urls: [],
    latest_observed_head_sha: "abc123",
    latest_certificate_digest: "digest-1",
    last_successful_sync_run: "run-2",
  };

  await store.replaceLedgers([ledger]);
  const loaded = await store.loadLedgers();

  assert.equal(loaded[0]?.latest_artifact.artifact_retention_until, "2026-08-03T00:00:00.000Z");
  assert.equal(loaded[0]?.latest_evidence[0], "No dependabot config.");
});

test("baseline August 2, 2026 artifact set still contains eight observations with expected risk counts", async () => {
  const raw = JSON.parse(
    await readFile("tests/fixtures/baseline-run-2026-08-02.json", "utf8"),
  ) as {
    findings: Array<{ risk: string }>;
  };

  const counts = raw.findings.reduce<Record<string, number>>((accumulator, finding) => {
    accumulator[finding.risk] = (accumulator[finding.risk] ?? 0) + 1;
    return accumulator;
  }, {});

  assert.equal(raw.findings.length, 8);
  assert.equal(counts.R0, 5);
  assert.equal(counts.R1, 1);
  assert.equal(counts.R4, 2);
});
