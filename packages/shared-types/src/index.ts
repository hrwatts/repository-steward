import { createHash } from "node:crypto";

import { z } from "zod";

export const riskClassSchema = z.enum(["R0", "R1", "R2", "R3", "R4", "R5", "R6"]);
export type RiskClass = z.infer<typeof riskClassSchema>;

export const findingStatusSchema = z.enum([
  "new",
  "suppressed",
  "advisory",
  "candidate_repair",
  "dismissed",
]);
export type FindingStatus = z.infer<typeof findingStatusSchema>;

export const lifecycleStateSchema = z.enum([
  "open",
  "operator_suppressed",
  "resolved",
  "superseded",
]);
export type LifecycleState = z.infer<typeof lifecycleStateSchema>;

export const manualClassificationSchema = z.enum([
  "unreviewed",
  "actionable",
  "informational",
  "trivial",
  "duplicated",
  "unsafe",
  "misclassified",
  "false_positive",
]);
export type ManualClassification = z.infer<typeof manualClassificationSchema>;

export const estimatedReviewEffortSchema = z.enum([
  "unreviewed",
  "5m",
  "15m",
  "30m",
  "60m",
  "120m_plus",
]);
export type EstimatedReviewEffort = z.infer<typeof estimatedReviewEffortSchema>;

export const recommendedDispositionSchema = z.enum([
  "unreviewed",
  "observe",
  "suppress",
  "hold_r4_advisory",
  "future_r1_fixture",
  "dismiss",
  "investigate_detector",
]);
export type RecommendedDisposition = z.infer<typeof recommendedDispositionSchema>;

export const syncStateSchema = z.enum([
  "pending",
  "issue_update_requested",
  "issue_body_confirmed",
  "ledger_finalized",
  "synced",
]);
export type SyncState = z.infer<typeof syncStateSchema>;

export const repositoryArchetypeSchema = z.enum([
  "python-library",
  "research-companion",
  "benchmark-research",
  "algorithm-port",
  "creative-site",
]);
export type RepositoryArchetype = z.infer<typeof repositoryArchetypeSchema>;

export const repositoryInventorySchema = z.object({
  name: z.string().regex(/^[^/]+\/[^/]+$/),
  archetype: repositoryArchetypeSchema,
  default_branch: z.string().min(1),
  language_profiles: z.array(z.string()).min(1),
  paths_of_interest: z.array(z.string()).min(1),
  policy_overrides: z
    .object({
      protected_paths: z.array(z.string()).optional(),
    })
    .partial()
    .optional(),
});
export type RepositoryInventory = z.infer<typeof repositoryInventorySchema>;

export const inspectionBudgetSchema = z.object({
  maximum_review_requests_per_day: z.number().int().nonnegative(),
  maximum_open_maintenance_prs_per_repository: z.number().int().nonnegative(),
  maximum_open_maintenance_prs_total: z.number().int().nonnegative(),
  suppress_duplicate_findings_for_days: z.number().int().nonnegative(),
  prioritize: z.array(z.string()).min(1),
});
export type InspectionBudget = z.infer<typeof inspectionBudgetSchema>;

export const repositoryPolicySchema = z.object({
  schema_version: z.literal(1),
  repository: z.object({
    importance: z.enum(["emphasized", "normal"]),
    language_profiles: z.array(z.string()).min(1),
    scan_frequency: z.enum(["twice_daily", "daily", "weekly"]),
    timezone: z.string().min(1),
  }),
  review: z.object({
    reviewer: z.string().min(1),
    require_human_review: z.boolean(),
    allow_native_github_review: z.boolean(),
    allow_steward_review_console: z.boolean().optional().default(false),
    dismiss_approval_on_new_commit: z.boolean(),
  }),
  attention: z.object({
    minimum_days_between_low_risk_prs: z.number().int().nonnegative(),
    maximum_open_maintenance_prs: z.number().int().nonnegative(),
    group_compatible_changes: z.boolean(),
  }),
  repairs: z.record(z.string(), z.record(z.string(), z.unknown())),
  protected_paths: z.array(z.string()),
  protected_change_classes: z.array(z.string()),
  validation: z.object({
    required: z.array(z.string()),
    optional: z.array(z.string()).default([]),
  }),
});
export type RepositoryPolicy = z.infer<typeof repositoryPolicySchema>;

export const repositorySnapshotSchema = z.object({
  repository: z.string(),
  defaultBranch: z.string(),
  headSha: z.string().nullable(),
  description: z.string().nullable(),
  isPrivate: z.boolean(),
  pushedAt: z.string().nullable(),
  language: z.string().nullable(),
  stargazerCount: z.number().int().nonnegative(),
  openPullRequestCount: z.number().int().nonnegative(),
  hasIssuesEnabled: z.boolean(),
  contents: z.record(z.string(), z.string().nullable()),
});
export type RepositorySnapshot = z.infer<typeof repositorySnapshotSchema>;

export const findingSchema = z.object({
  finding_key: z.string().min(1),
  dedup_key: z.string().min(1),
  fingerprint: z.string().min(1),
  fingerprint_schema_version: z.number().int().nonnegative(),
  repository: z.string().regex(/^[^/]+\/[^/]+$/),
  detector_id: z.string().min(1),
  detector_version: z.string().min(1),
  canonical_subject: z.string().min(1),
  canonical_condition: z.string().min(1),
  title: z.string().min(1),
  code: z.string().min(1),
  summary: z.string().min(1),
  risk: riskClassSchema,
  status: findingStatusSchema,
  evidence: z.array(z.string()),
  source_urls: z.array(z.string()).default([]),
  protected_paths_touched: z.array(z.string()),
  tags: z.array(z.string()),
  related_paths: z.array(z.string()),
  data: z.record(z.string(), z.unknown()),
  notification_suppressed: z.boolean().default(false),
});
export type Finding = z.infer<typeof findingSchema>;

export const repositoryCoverageSchema = z.object({
  repository: z.string().regex(/^[^/]+\/[^/]+$/),
  detectors_expected: z.array(z.string()),
  detectors_completed: z.array(z.string()),
  detectors_failed: z.array(z.string()),
  collection_complete: z.boolean(),
  filtered: z.boolean(),
  head_sha: z.string().nullable(),
});
export type RepositoryCoverage = z.infer<typeof repositoryCoverageSchema>;

export const inspectionRunSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  dryRun: z.boolean(),
  repositories: z.array(z.string()),
  findings: z.array(findingSchema),
  coverage: z.array(repositoryCoverageSchema),
});
export type InspectionRun = z.infer<typeof inspectionRunSchema>;

export const validationCertificateSchema = z.object({
  schema_version: z.literal(1),
  certificate_kind: z.enum(["observation", "validation"]).optional(),
  repository: z.string(),
  inspection_id: z.string(),
  base_sha: z.string().nullable(),
  head_sha: z.string().nullable(),
  generator: z.object({
    name: z.string(),
    version: z.string(),
  }),
  change: z.object({
    class: z.string(),
    risk: riskClassSchema,
    reason: z.string(),
    changed_files: z.array(z.string()),
    protected_files: z.array(z.string()),
    changed_test_files: z.array(z.string()),
    observed_files: z.array(z.string()).optional(),
  }),
  validation: z.record(z.string(), z.enum(["passed", "failed", "skipped", "not_run"])),
  uncertainties: z.array(z.string()),
  eligible_for_minimal_review: z.boolean(),
});
export type ValidationCertificate = z.infer<typeof validationCertificateSchema>;

export const artifactReferenceSchema = z.object({
  artifact_run_url: z.string().nullable(),
  artifact_name: z.string().nullable(),
  artifact_relative_path: z.string().min(1),
  artifact_retention_until: z.string().nullable(),
});
export type ArtifactReference = z.infer<typeof artifactReferenceSchema>;

export const findingObservationSchema = z.object({
  run_id: z.string(),
  observed_at: z.string(),
  finding_key: z.string().min(1),
  dedup_key: z.string().min(1),
  fingerprint: z.string().min(1),
  fingerprint_schema_version: z.number().int().nonnegative(),
  repository: z.string().regex(/^[^/]+\/[^/]+$/),
  detector_id: z.string().min(1),
  detector_version: z.string().min(1),
  risk_class: riskClassSchema,
  status: findingStatusSchema,
  title: z.string().min(1),
  code: z.string().min(1),
  summary: z.string().min(1),
  canonical_subject: z.string().min(1),
  canonical_condition: z.string().min(1),
  evidence_normalized: z.array(z.string()),
  source_urls: z.array(z.string()),
  observed_head_sha: z.string().nullable(),
  certificate_digest: z.string().min(1),
  artifact_run_url: z.string().nullable(),
  artifact_name: z.string().nullable(),
  artifact_relative_path: z.string().min(1),
  artifact_retention_until: z.string().nullable(),
  notification_suppressed: z.boolean(),
  protected_paths_touched: z.array(z.string()),
  tags: z.array(z.string()),
  related_paths: z.array(z.string()),
  data: z.record(z.string(), z.unknown()),
});
export type FindingObservation = z.infer<typeof findingObservationSchema>;

export const manualFindingFieldsSchema = z.object({
  finding_key: z.string().min(1),
  manual_classification: manualClassificationSchema,
  estimated_review_effort: estimatedReviewEffortSchema,
  recommended_disposition: recommendedDispositionSchema,
});
export type ManualFindingFields = z.infer<typeof manualFindingFieldsSchema>;

export const findingLedgerSchema = z.object({
  finding_key: z.string().min(1),
  dedup_key: z.string().min(1),
  fingerprint_schema_version: z.number().int().nonnegative(),
  repository: z.string().regex(/^[^/]+\/[^/]+$/),
  detector_id: z.string().min(1),
  detector_version: z.string().min(1),
  risk_class: riskClassSchema,
  title: z.string().min(1),
  code: z.string().min(1),
  summary: z.string().min(1),
  lifecycle_state: lifecycleStateSchema,
  notification_suppressed_until: z.string().nullable(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  resolved_at: z.string().nullable(),
  reopened_at: z.string().nullable(),
  superseded_at: z.string().nullable().optional(),
  superseded_by_detector_version: z.string().nullable().optional(),
  superseded_by_finding_key: z.string().nullable().optional(),
  occurrence_count: z.number().int().nonnegative(),
  consecutive_complete_absences: z.number().int().nonnegative(),
  manual_classification: manualClassificationSchema,
  estimated_review_effort: estimatedReviewEffortSchema,
  recommended_disposition: recommendedDispositionSchema,
  latest_evidence: z.array(z.string()),
  latest_artifact: artifactReferenceSchema,
  latest_source_urls: z.array(z.string()),
  latest_observed_head_sha: z.string().nullable(),
  latest_certificate_digest: z.string().min(1),
  last_successful_sync_run: z.string().nullable(),
});
export type FindingLedger = z.infer<typeof findingLedgerSchema>;

export const syncMetadataSchema = z.object({
  run_id: z.string(),
  sync_attempt_id: z.string().min(1),
  sync_state: syncStateSchema,
  issue_repository: z.string().regex(/^[^/]+\/[^/]+$/).nullable(),
  issue_number: z.number().int().positive().nullable(),
  prior_body_digest: z.string().nullable(),
  desired_body_digest: z.string().nullable(),
  confirmed_body_digest: z.string().nullable(),
  issue_updated_at: z.string().nullable(),
  github_response_metadata: z.record(z.string(), z.unknown()),
});
export type SyncMetadata = z.infer<typeof syncMetadataSchema>;

export const dashboardSyncPayloadSchema = z.object({
  run: inspectionRunSchema,
  observations: z.array(findingObservationSchema),
  coverage: z.array(repositoryCoverageSchema),
});
export type DashboardSyncPayload = z.infer<typeof dashboardSyncPayloadSchema>;

export const dashboardProjectionSchema = z.object({
  open: z.array(findingLedgerSchema),
  operator_suppressed: z.array(findingLedgerSchema),
  resolved: z.array(findingLedgerSchema),
  superseded: z.array(findingLedgerSchema),
  run_history: z.array(
    z.object({
      run_id: z.string(),
      completed_at: z.string(),
      finding_count: z.number().int().nonnegative(),
      dry_run: z.boolean(),
      artifact_run_url: z.string().nullable(),
    }),
  ),
});
export type DashboardProjection = z.infer<typeof dashboardProjectionSchema>;

export const defaultInspectionBudget: InspectionBudget = {
  maximum_review_requests_per_day: 3,
  maximum_open_maintenance_prs_per_repository: 1,
  maximum_open_maintenance_prs_total: 10,
  suppress_duplicate_findings_for_days: 14,
  prioritize: [
    "security",
    "broken_default_branch",
    "failed_installation",
    "failed_documentation",
    "dependency_patch",
    "metadata",
  ],
};

export const defaultManualFields: Omit<ManualFindingFields, "finding_key"> = {
  manual_classification: "unreviewed",
  estimated_review_effort: "unreviewed",
  recommended_disposition: "unreviewed",
};

export const defaultDashboardLimits = {
  open_findings_limit: 100,
  suppressed_findings_limit: 30,
  recently_resolved_limit: 30,
  superseded_findings_limit: 30,
  run_history_limit: 28,
};

export const dashboardBodySizeLimit = 60_000;
export const fingerprintSchemaVersion = 1;

export function makeFingerprint(repository: string, code: string, uniqueParts: string[]): string {
  return [repository, code, ...uniqueParts].join("::").toLowerCase();
}

export function makeFindingKey(input: {
  fingerprintSchemaVersion: number;
  repositoryId: string;
  detectorId: string;
  detectorRuleVersion: string;
  canonicalSubject: string;
  canonicalCondition: string;
}): string {
  const canonical = JSON.stringify({
    fingerprint_schema_version: input.fingerprintSchemaVersion,
    repository_id: input.repositoryId,
    detector_id: input.detectorId,
    detector_rule_version: input.detectorRuleVersion,
    canonical_subject: input.canonicalSubject,
    canonical_condition: input.canonicalCondition,
  });

  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function makeDedupKey(repository: string, detectorId: string, canonicalCondition: string): string {
  return `${repository}::${detectorId}::${canonicalCondition}`.toLowerCase();
}

export function addDays(isoTimestamp: string, days: number): string {
  const date = new Date(isoTimestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
