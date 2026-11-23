import assert from "node:assert/strict";

import { test } from "../harness.js";
import { calculatePilotMetrics } from "../../packages/pilot-metrics/src/index.js";
import type { FindingLedger } from "../../packages/shared-types/src/index.js";

function ledger(overrides: Partial<FindingLedger> = {}): FindingLedger {
  return {
    finding_key: "sha256:key",
    dedup_key: "owner/repo::detector::condition",
    fingerprint_schema_version: 1,
    repository: "owner/repo",
    detector_id: "detector",
    detector_version: "1",
    risk_class: "R1",
    title: "Finding",
    code: "finding",
    summary: "Summary",
    lifecycle_state: "open",
    notification_suppressed_until: null,
    first_seen_at: "2026-11-23T00:00:00.000Z",
    last_seen_at: "2026-11-23T00:00:00.000Z",
    resolved_at: null,
    reopened_at: null,
    occurrence_count: 1,
    consecutive_complete_absences: 0,
    manual_classification: "unreviewed",
    estimated_review_effort: "unreviewed",
    recommended_disposition: "unreviewed",
    latest_evidence: [],
    latest_artifact: {
      artifact_run_url: null,
      artifact_name: null,
      artifact_relative_path: "findings/key.json",
      artifact_retention_until: null,
    },
    latest_source_urls: [],
    latest_observed_head_sha: "abc123",
    latest_certificate_digest: "digest",
    last_successful_sync_run: "run-1",
    ...overrides,
  };
}

test("pilot metrics report review completion without auto-approving the gate", () => {
  const metrics = calculatePilotMetrics([
    ledger({ manual_classification: "actionable", estimated_review_effort: "15m" }),
    ledger({
      finding_key: "sha256:key-2",
      manual_classification: "false_positive",
      risk_class: "R4",
      estimated_review_effort: "5m",
    }),
    ledger({ finding_key: "sha256:key-3" }),
  ]);

  assert.equal(metrics.finding_count, 3);
  assert.equal(metrics.reviewed_count, 2);
  assert.equal(metrics.unreviewed_count, 1);
  assert.equal(metrics.false_positive_or_misclassified_count, 1);
  assert.equal(metrics.gate_assessment, "human_decision_required");
});
