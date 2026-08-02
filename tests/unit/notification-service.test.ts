import assert from "node:assert/strict";

import { test } from "../harness.js";
import {
  buildDashboardProjection,
  digestManagedBlock,
  extractManagedBlock,
  finalizeLedgersForRun,
  parseManualFindingFields,
  renderDashboardManagedBlock,
  replaceManagedBlock,
  syncDashboardIssue,
} from "../../packages/notification-service/src/index.js";
import type { AuditStore } from "../../packages/audit-store/src/index.js";
import type { RepositoryStewardGithubClient } from "../../packages/github-client/src/index.js";
import {
  type FindingLedger,
  type FindingObservation,
  type InspectionRun,
  type ManualFindingFields,
  type SyncMetadata,
} from "../../packages/shared-types/src/index.js";

const baseObservation: FindingObservation = {
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
};

const baseRun = (overrides?: Partial<InspectionRun>): InspectionRun => ({
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
  ...overrides,
});

const baseLedger = (overrides?: Partial<FindingLedger>): FindingLedger => ({
  finding_key: "sha256:key-1",
  dedup_key: baseObservation.dedup_key,
  fingerprint_schema_version: 1,
  repository: "hrwatts/gem-lasso",
  detector_id: "dependency-automation",
  detector_version: "1",
  risk_class: "R1",
  title: "Dependency automation is not configured",
  code: "dependency_automation_missing",
  summary: "Missing automation.",
  lifecycle_state: "open",
  notification_suppressed_until: null,
  first_seen_at: "2026-08-02T20:06:38.000Z",
  last_seen_at: "2026-08-02T20:06:38.000Z",
  resolved_at: null,
  reopened_at: null,
  occurrence_count: 1,
  consecutive_complete_absences: 0,
  manual_classification: "unreviewed",
  estimated_review_effort: "unreviewed",
  recommended_disposition: "unreviewed",
  latest_evidence: ["No dependabot config."],
  latest_artifact: {
    artifact_run_url: "https://github.com/hrwatts/repository-steward/actions/runs/1",
    artifact_name: "repository-steward-run-run-1",
    artifact_relative_path: "findings/sha256-key-1.json",
    artifact_retention_until: "2026-11-01T00:00:00.000Z",
  },
  latest_source_urls: [],
  latest_observed_head_sha: "abc123",
  latest_certificate_digest: "digest-1",
  last_successful_sync_run: "run-1",
  ...overrides,
});

test("managed block round-trip preserves manual fields and surrounding text", () => {
  const managed = renderDashboardManagedBlock(
    buildDashboardProjection([baseLedger()], [
      {
        runId: "run-1",
        completedAt: "2026-08-02T20:06:38.000Z",
        findingCount: 1,
        dryRun: true,
        artifactRunUrl: "https://github.com/hrwatts/repository-steward/actions/runs/1",
      },
    ]),
  );
  const body = replaceManagedBlock("Intro text\n\nOperator notes", managed);
  const parsed = parseManualFindingFields(body, new Set(["sha256:key-1"]));

  assert.equal(parsed.get("sha256:key-1")?.manual_classification, "unreviewed");
  assert.match(body, /Intro text/);
  assert.match(body, /Operator notes/);
  assert.ok(extractManagedBlock(body));
  assert.ok(digestManagedBlock(extractManagedBlock(body)));
});

test("malformed manual block fails visibly", () => {
  const body = [
    "Notes",
    "<!-- repository-steward:managed:start -->",
    "<!-- repository-steward:finding",
    "{not valid json}",
    "-->",
    "<!-- repository-steward:managed:end -->",
  ].join("\n");

  assert.throws(() => parseManualFindingFields(body, new Set(["sha256:key-1"])), /Malformed/);
});

test("unknown controlled value fails visibly", () => {
  const block: ManualFindingFields = {
    finding_key: "sha256:key-1",
    manual_classification: "unreviewed",
    estimated_review_effort: "unreviewed",
    recommended_disposition: "unreviewed",
  };
  const body = [
    "<!-- repository-steward:managed:start -->",
    "<!-- repository-steward:finding",
    JSON.stringify({ ...block, manual_classification: "bogus" }, null, 2),
    "-->",
    "<!-- repository-steward:managed:end -->",
  ].join("\n");

  assert.throws(() => parseManualFindingFields(body, new Set(["sha256:key-1"])), /Invalid manual finding block/);
});

test("partial scan does not resolve an open finding", () => {
  const next = finalizeLedgersForRun({
    existingLedgers: [baseLedger()],
    run: baseRun({
      id: "run-2",
      completedAt: "2026-08-03T00:00:00.000Z",
      coverage: [
        {
          repository: "hrwatts/gem-lasso",
          detectors_expected: ["dependency-automation"],
          detectors_completed: [],
          detectors_failed: ["dependency-automation"],
          collection_complete: false,
          filtered: false,
          head_sha: "def456",
        },
      ],
    }),
    observations: [],
    manualFields: new Map(),
    detectorVersionById: new Map([["dependency-automation", "1"]]),
  });

  const [ledger] = next;
  assert.ok(ledger);
  assert.equal(ledger.lifecycle_state, "open");
  assert.equal(ledger.consecutive_complete_absences, 0);
});

test("two complete absences resolve a finding and return reopens it", () => {
  const afterFirstAbsence = finalizeLedgersForRun({
    existingLedgers: [baseLedger()],
    run: baseRun({ id: "run-2", completedAt: "2026-08-03T00:00:00.000Z" }),
    observations: [],
    manualFields: new Map(),
    detectorVersionById: new Map([["dependency-automation", "1"]]),
  });
  const afterSecondAbsence = finalizeLedgersForRun({
    existingLedgers: afterFirstAbsence,
    run: baseRun({ id: "run-3", completedAt: "2026-08-03T12:00:00.000Z" }),
    observations: [],
    manualFields: new Map(),
    detectorVersionById: new Map([["dependency-automation", "1"]]),
  });
  const [resolvedLedger] = afterSecondAbsence;
  assert.ok(resolvedLedger);
  assert.equal(resolvedLedger.lifecycle_state, "resolved");

  const reopenedObservation: FindingObservation = {
    ...baseObservation,
    run_id: "run-4",
    observed_at: "2026-08-04T00:00:00.000Z",
    certificate_digest: "digest-4",
  };
  const reopened = finalizeLedgersForRun({
    existingLedgers: afterSecondAbsence,
    run: baseRun({ id: "run-4", completedAt: "2026-08-04T00:00:00.000Z" }),
    observations: [reopenedObservation],
    manualFields: new Map(),
    detectorVersionById: new Map([["dependency-automation", "1"]]),
  });

  const [reopenedLedger] = reopened;
  assert.ok(reopenedLedger);
  assert.equal(reopenedLedger.lifecycle_state, "open");
  assert.equal(reopenedLedger.reopened_at, "2026-08-04T00:00:00.000Z");
});

test("repeated observation suppresses notification but does not change lifecycle state", () => {
  const repeated = finalizeLedgersForRun({
    existingLedgers: [baseLedger()],
    run: baseRun({ id: "run-2", completedAt: "2026-08-03T00:00:00.000Z" }),
    observations: [{ ...baseObservation, run_id: "run-2", observed_at: "2026-08-03T00:00:00.000Z", notification_suppressed: true }],
    manualFields: new Map(),
    detectorVersionById: new Map([["dependency-automation", "1"]]),
  });

  const [repeatedLedger] = repeated;
  assert.ok(repeatedLedger);
  assert.equal(repeatedLedger.lifecycle_state, "open");
  assert.ok(repeatedLedger.notification_suppressed_until);
});

test("operator suppression remains distinct from notification suppression", () => {
  const manualFields = new Map<string, ManualFindingFields>([
    [
      "sha256:key-1",
      {
        finding_key: "sha256:key-1",
        manual_classification: "actionable",
        estimated_review_effort: "15m",
        recommended_disposition: "suppress",
      },
    ],
  ]);

  const suppressed = finalizeLedgersForRun({
    existingLedgers: [baseLedger()],
    run: baseRun({ id: "run-2", completedAt: "2026-08-03T00:00:00.000Z" }),
    observations: [{ ...baseObservation, run_id: "run-2", observed_at: "2026-08-03T00:00:00.000Z", notification_suppressed: true }],
    manualFields,
    detectorVersionById: new Map([["dependency-automation", "1"]]),
  });

  const [suppressedLedger] = suppressed;
  assert.ok(suppressedLedger);
  assert.equal(suppressedLedger.lifecycle_state, "operator_suppressed");
  assert.ok(suppressedLedger.notification_suppressed_until);
});

test("filtered run cannot resolve findings", () => {
  const next = finalizeLedgersForRun({
    existingLedgers: [baseLedger()],
    run: baseRun({
      id: "run-2",
      completedAt: "2026-08-03T00:00:00.000Z",
      coverage: [
        {
          repository: "hrwatts/gem-lasso",
          detectors_expected: ["dependency-automation"],
          detectors_completed: ["dependency-automation"],
          detectors_failed: [],
          collection_complete: true,
          filtered: true,
          head_sha: "def456",
        },
      ],
    }),
    observations: [],
    manualFields: new Map(),
    detectorVersionById: new Map([["dependency-automation", "1"]]),
  });

  const [ledger] = next;
  assert.ok(ledger);
  assert.equal(ledger.consecutive_complete_absences, 0);
});

test("detector version change does not silently resolve old findings", () => {
  const next = finalizeLedgersForRun({
    existingLedgers: [baseLedger()],
    run: baseRun({ id: "run-2", completedAt: "2026-08-03T00:00:00.000Z" }),
    observations: [],
    manualFields: new Map(),
    detectorVersionById: new Map([["dependency-automation", "2"]]),
  });

  const [ledger] = next;
  assert.ok(ledger);
  assert.equal(ledger.lifecycle_state, "open");
  assert.equal(ledger.consecutive_complete_absences, 0);
});

test("dashboard sync retry is idempotent after issue update but before ledger finalization", async () => {
  const run = baseRun({ findings: [] });
  const observations = [baseObservation];
  const ledgers: FindingLedger[] = [];
  let syncMetadata: SyncMetadata | null = {
    run_id: "run-1",
    sync_attempt_id: "attempt-0",
    sync_state: "pending",
    issue_repository: "hrwatts/repository-steward",
    issue_number: 1,
    prior_body_digest: null,
    desired_body_digest: null,
    confirmed_body_digest: null,
    issue_updated_at: null,
    github_response_metadata: {},
  };
  let replaceAttempts = 0;
  const store: AuditStore = {
    async initialize() {},
    async recordInspectionBundle() {
      throw new Error("not used");
    },
    async recentlySeenFinding() {
      return false;
    },
    async loadInspection() {
      return run;
    },
    async loadObservationsForRun() {
      return observations;
    },
    async loadLedgers() {
      return ledgers;
    },
    async replaceLedgers(nextLedgers) {
      replaceAttempts += 1;
      if (replaceAttempts === 1) {
        throw new Error("synthetic ledger finalization failure");
      }
      ledgers.splice(0, ledgers.length, ...nextLedgers);
    },
    async loadSyncMetadata() {
      return syncMetadata;
    },
    async saveSyncMetadata(next) {
      syncMetadata = next;
    },
    async listPendingSyncRunIds() {
      return ["run-1"];
    },
    async listInspectionHistory() {
      return [
        {
          runId: "run-1",
          completedAt: "2026-08-02T20:06:38.000Z",
          findingCount: 1,
          dryRun: true,
          artifactRunUrl: "https://github.com/hrwatts/repository-steward/actions/runs/1",
        },
      ];
    },
  };

  let body = "Intro";
  let updateCount = 0;
  const client: RepositoryStewardGithubClient = {
    async getRepository() {
      throw new Error("not used");
    },
    async getDefaultBranchHeadSha() {
      throw new Error("not used");
    },
    async getFileText() {
      throw new Error("not used");
    },
    async getIssue() {
      return {
        body,
        updatedAt: "2026-08-02T20:06:38.000Z",
        htmlUrl: "https://github.com/hrwatts/repository-steward/issues/1",
      };
    },
    async updateIssueBody(_target, nextBody) {
      updateCount += 1;
      body = nextBody;
      return {
        body,
        updatedAt: "2026-08-02T20:10:00.000Z",
        htmlUrl: "https://github.com/hrwatts/repository-steward/issues/1",
      };
    },
  };

  await assert.rejects(
    syncDashboardIssue(client, store, { repository: "hrwatts/repository-steward", issueNumber: 1 }, "run-1"),
    /synthetic ledger finalization failure/,
  );
  await syncDashboardIssue(client, store, { repository: "hrwatts/repository-steward", issueNumber: 1 }, "run-1");

  assert.equal(updateCount, 1);
  assert.equal(syncMetadata?.sync_state, "synced");
  assert.equal(ledgers.length, 1);
});

test("github rejection leaves ledger unchanged", async () => {
  const storeLedgers: FindingLedger[] = [];
  const store: AuditStore = {
    async initialize() {},
    async recordInspectionBundle() {
      throw new Error("not used");
    },
    async recentlySeenFinding() {
      return false;
    },
    async loadInspection() {
      return baseRun();
    },
    async loadObservationsForRun() {
      return [baseObservation];
    },
    async loadLedgers() {
      return storeLedgers;
    },
    async replaceLedgers(nextLedgers) {
      storeLedgers.splice(0, storeLedgers.length, ...nextLedgers);
    },
    async loadSyncMetadata() {
      return null;
    },
    async saveSyncMetadata() {},
    async listPendingSyncRunIds() {
      return ["run-1"];
    },
    async listInspectionHistory() {
      return [];
    },
  };

  const client: RepositoryStewardGithubClient = {
    async getRepository() {
      throw new Error("not used");
    },
    async getDefaultBranchHeadSha() {
      throw new Error("not used");
    },
    async getFileText() {
      throw new Error("not used");
    },
    async getIssue() {
      return {
        body: "Intro",
        updatedAt: "2026-08-02T20:06:38.000Z",
        htmlUrl: "https://github.com/hrwatts/repository-steward/issues/1",
      };
    },
    async updateIssueBody() {
      throw new Error("github rejected update");
    },
  };

  await assert.rejects(
    syncDashboardIssue(client, store, { repository: "hrwatts/repository-steward", issueNumber: 1 }, "run-1"),
    /github rejected update/,
  );
  assert.equal(storeLedgers.length, 0);
});
