import { createHash, randomUUID } from "node:crypto";

import { type AuditStore } from "../../audit-store/src/index.js";
import { detectorCatalog } from "../../drift-detectors/src/index.js";
import { type RepositoryStewardGithubClient } from "../../github-client/src/index.js";
import {
  addDays,
  dashboardBodySizeLimit,
  defaultDashboardLimits,
  defaultInspectionBudget,
  defaultManualFields,
  findingLedgerSchema,
  manualFindingFieldsSchema,
  type DashboardProjection,
  type EstimatedReviewEffort,
  type FindingLedger,
  type FindingObservation,
  type InspectionRun,
  type LifecycleState,
  type ManualClassification,
  type ManualFindingFields,
  type RecommendedDisposition,
  type SyncMetadata,
} from "../../shared-types/src/index.js";

export interface DashboardIssueConfig {
  repository: string;
  issueNumber: number;
}

export const managedBlockStart = "<!-- repository-steward:managed:start -->";
export const managedBlockEnd = "<!-- repository-steward:managed:end -->";
const findingBlockPrefix = "repository-steward:finding";

export function extractManagedBlock(body: string): string | null {
  const start = body.indexOf(managedBlockStart);
  const end = body.indexOf(managedBlockEnd);
  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  const contentStart = start + managedBlockStart.length;
  return body.slice(contentStart, end).trim();
}

export function digestManagedBlock(block: string | null): string | null {
  if (block === null) {
    return null;
  }

  const normalized = block.replace(/\r\n/g, "\n").trim();
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

export function replaceManagedBlock(body: string, managedContent: string): string {
  const block = `${managedBlockStart}\n${managedContent.trim()}\n${managedBlockEnd}`;
  const start = body.indexOf(managedBlockStart);
  const end = body.indexOf(managedBlockEnd);

  if (start === -1 || end === -1 || end < start) {
    const trimmed = body.trimEnd();
    return trimmed.length === 0 ? block : `${trimmed}\n\n${block}`;
  }

  const before = body.slice(0, start).trimEnd();
  const after = body.slice(end + managedBlockEnd.length).trimStart();
  const segments = [before, block, after].filter((segment) => segment.length > 0);
  return segments.join("\n\n");
}

export function parseManualFindingFields(
  body: string,
  knownFindingKeys: Set<string>,
): Map<string, ManualFindingFields> {
  const managed = extractManagedBlock(body);
  const fields = new Map<string, ManualFindingFields>();
  if (!managed) {
    return fields;
  }

  const matches = [...managed.matchAll(/<!--\s*repository-steward:finding\s*([\s\S]*?)-->/g)];
  for (const match of matches) {
    const rawJson = match[1]?.trim();
    if (!rawJson) {
      throw new Error("Malformed repository-steward finding block: missing JSON payload.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch (error) {
      throw new Error(
        `Malformed repository-steward finding block: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const validated = manualFindingFieldsSchema.safeParse(parsed);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      throw new Error(
        `Invalid manual finding block for ${(parsed as { finding_key?: unknown }).finding_key ?? "<unknown>"}: ${
          issue?.message ?? "validation failed"
        }`,
      );
    }

    if (!knownFindingKeys.has(validated.data.finding_key)) {
      throw new Error(`Unknown manual finding block key: ${validated.data.finding_key}`);
    }

    if (fields.has(validated.data.finding_key)) {
      throw new Error(`Duplicate manual finding block for key: ${validated.data.finding_key}`);
    }

    fields.set(validated.data.finding_key, validated.data);
  }

  return fields;
}

export function finalizeLedgersForRun(input: {
  existingLedgers: FindingLedger[];
  run: InspectionRun;
  observations: FindingObservation[];
  manualFields: Map<string, ManualFindingFields>;
  detectorVersionById: Map<string, string>;
  suppressionWindowDays?: number;
}): FindingLedger[] {
  const suppressionWindowDays = input.suppressionWindowDays ?? defaultInspectionBudget.suppress_duplicate_findings_for_days;
  const ledgerMap = new Map(input.existingLedgers.map((ledger) => [ledger.finding_key, findingLedgerSchema.parse(ledger)]));
  const observationMap = new Map(input.observations.map((observation) => [observation.finding_key, observation]));
  const observationByDedupKey = new Map(
    input.observations.map((observation) => [observation.dedup_key, observation]),
  );
  const coverageByRepository = new Map(input.run.coverage.map((coverage) => [coverage.repository, coverage]));

  for (const observation of input.observations) {
    const existing = ledgerMap.get(observation.finding_key);
    const manual = input.manualFields.get(observation.finding_key);
    const recommendedDisposition = manual?.recommended_disposition ?? existing?.recommended_disposition ?? defaultManualFields.recommended_disposition;
    const nextLifecycle = recommendedDisposition === "suppress" ? "operator_suppressed" : "open";

    const nextLedger: FindingLedger = {
      finding_key: observation.finding_key,
      dedup_key: observation.dedup_key,
      fingerprint_schema_version: observation.fingerprint_schema_version,
      repository: observation.repository,
      detector_id: observation.detector_id,
      detector_version: observation.detector_version,
      risk_class: observation.risk_class,
      title: observation.title,
      code: observation.code,
      summary: observation.summary,
      lifecycle_state:
        existing?.lifecycle_state === "resolved"
          ? nextLifecycle
          : recommendedDisposition === "suppress"
            ? "operator_suppressed"
            : existing?.lifecycle_state === "operator_suppressed"
              ? "operator_suppressed"
              : nextLifecycle,
      notification_suppressed_until: observation.notification_suppressed
        ? addDays(observation.observed_at, suppressionWindowDays)
        : null,
      first_seen_at: existing?.first_seen_at ?? observation.observed_at,
      last_seen_at: observation.observed_at,
      resolved_at: null,
      reopened_at: existing?.lifecycle_state === "resolved" ? observation.observed_at : existing?.reopened_at ?? null,
      superseded_at: null,
      superseded_by_detector_version: null,
      superseded_by_finding_key: null,
      occurrence_count: (existing?.occurrence_count ?? 0) + 1,
      consecutive_complete_absences: 0,
      manual_classification:
        manual?.manual_classification ?? existing?.manual_classification ?? defaultManualFields.manual_classification,
      estimated_review_effort:
        manual?.estimated_review_effort ?? existing?.estimated_review_effort ?? defaultManualFields.estimated_review_effort,
      recommended_disposition: recommendedDisposition,
      latest_evidence: observation.evidence_normalized,
      latest_artifact: {
        artifact_run_url: observation.artifact_run_url,
        artifact_name: observation.artifact_name,
        artifact_relative_path: observation.artifact_relative_path,
        artifact_retention_until: observation.artifact_retention_until,
      },
      latest_source_urls: observation.source_urls,
      latest_observed_head_sha: observation.observed_head_sha,
      latest_certificate_digest: observation.certificate_digest,
      last_successful_sync_run: input.run.id,
    };

    ledgerMap.set(observation.finding_key, nextLedger);
  }

  for (const ledger of [...ledgerMap.values()]) {
    if (observationMap.has(ledger.finding_key)) {
      continue;
    }

    const coverage = coverageByRepository.get(ledger.repository);
    const currentDetectorVersion = input.detectorVersionById.get(ledger.detector_id);
    const hasDetectorVersionChange = currentDetectorVersion !== undefined && currentDetectorVersion !== ledger.detector_version;

    if (hasDetectorVersionChange) {
      const replacement = observationByDedupKey.get(ledger.dedup_key);
      ledgerMap.set(ledger.finding_key, {
        ...ledger,
        lifecycle_state: "superseded",
        superseded_at: ledger.superseded_at ?? input.run.completedAt,
        superseded_by_detector_version: currentDetectorVersion ?? null,
        superseded_by_finding_key: replacement?.finding_key ?? null,
        last_successful_sync_run: input.run.id,
      });
      continue;
    }

    if (
      !coverage ||
      !coverage.collection_complete ||
      coverage.filtered ||
      !coverage.detectors_completed.includes(ledger.detector_id) ||
      coverage.detectors_failed.includes(ledger.detector_id)
    ) {
      continue;
    }

    const nextAbsences = ledger.consecutive_complete_absences + 1;
    const manual = input.manualFields.get(ledger.finding_key);
    const recommendedDisposition = manual?.recommended_disposition ?? ledger.recommended_disposition;
    const lifecycleState: LifecycleState =
      nextAbsences >= 2
        ? "resolved"
        : recommendedDisposition === "suppress"
          ? "operator_suppressed"
          : ledger.lifecycle_state;

    ledgerMap.set(ledger.finding_key, {
      ...ledger,
      lifecycle_state: lifecycleState,
      consecutive_complete_absences: nextAbsences,
      resolved_at: nextAbsences >= 2 ? input.run.completedAt : ledger.resolved_at,
      manual_classification: manual?.manual_classification ?? ledger.manual_classification,
      estimated_review_effort: manual?.estimated_review_effort ?? ledger.estimated_review_effort,
      recommended_disposition: recommendedDisposition,
      last_successful_sync_run: input.run.id,
    });
  }

  for (const ledger of ledgerMap.values()) {
    const manual = input.manualFields.get(ledger.finding_key);
    if (manual) {
      const nextLifecycle =
        ledger.lifecycle_state === "resolved" || ledger.lifecycle_state === "superseded"
          ? ledger.lifecycle_state
          : manual.recommended_disposition === "suppress"
            ? "operator_suppressed"
            : "open";
      ledgerMap.set(ledger.finding_key, {
        ...ledger,
        lifecycle_state: nextLifecycle,
        manual_classification: manual.manual_classification,
        estimated_review_effort: manual.estimated_review_effort,
        recommended_disposition: manual.recommended_disposition,
      });
    }
  }

  return [...ledgerMap.values()].sort(compareLedgers);
}

export function buildDashboardProjection(
  ledgers: FindingLedger[],
  history: Array<{
    runId: string;
    completedAt: string;
    findingCount: number;
    dryRun: boolean;
    artifactRunUrl: string | null;
  }>,
): DashboardProjection {
  const open = ledgers.filter((ledger) => ledger.lifecycle_state === "open").slice(0, defaultDashboardLimits.open_findings_limit);
  const operatorSuppressed = ledgers
    .filter((ledger) => ledger.lifecycle_state === "operator_suppressed")
    .slice(0, defaultDashboardLimits.suppressed_findings_limit);
  const resolved = ledgers
    .filter((ledger) => ledger.lifecycle_state === "resolved")
    .sort((left, right) => (right.resolved_at ?? "").localeCompare(left.resolved_at ?? ""))
    .slice(0, defaultDashboardLimits.recently_resolved_limit);
  const superseded = ledgers
    .filter((ledger) => ledger.lifecycle_state === "superseded")
    .sort((left, right) => (right.superseded_at ?? "").localeCompare(left.superseded_at ?? ""))
    .slice(0, defaultDashboardLimits.superseded_findings_limit);

  return {
    open,
    operator_suppressed: operatorSuppressed,
    resolved,
    superseded,
    run_history: history.slice(0, defaultDashboardLimits.run_history_limit).map((item) => ({
      run_id: item.runId,
      completed_at: item.completedAt,
      finding_count: item.findingCount,
      dry_run: item.dryRun,
      artifact_run_url: item.artifactRunUrl,
    })),
  };
}

export function renderDashboardManagedBlock(projection: DashboardProjection): string {
  const lines: string[] = [
    "# Repository Steward Dashboard",
    "",
    "## Open Findings",
    "",
  ];

  appendLedgerSection(lines, projection.open, "No open findings.");
  lines.push("## Operator-Suppressed Findings");
  lines.push("");
  appendLedgerSection(lines, projection.operator_suppressed, "No operator-suppressed findings.");
  lines.push("## Recently Resolved");
  lines.push("");
  appendLedgerSection(lines, projection.resolved, "No recently resolved findings.");
  lines.push("## Superseded Detector Results");
  lines.push("");
  appendLedgerSection(lines, projection.superseded, "No superseded detector results.");
  lines.push("## Run History");
  lines.push("");

  if (projection.run_history.length === 0) {
    lines.push("No run history is available.");
  } else {
    for (const run of projection.run_history) {
      lines.push(
        `- \`${run.run_id}\` completed ${run.completed_at} | findings: ${run.finding_count} | dry run: ${
          run.dry_run ? "yes" : "no"
        }${run.artifact_run_url ? ` | [run](${run.artifact_run_url})` : ""}`,
      );
    }
  }

  const rendered = lines.join("\n").trim();
  if (rendered.length > dashboardBodySizeLimit) {
    throw new Error(`Dashboard managed block exceeds size limit (${dashboardBodySizeLimit} characters).`);
  }

  return rendered;
}

export async function syncDashboardIssue(
  client: RepositoryStewardGithubClient,
  store: AuditStore,
  config: DashboardIssueConfig,
  runId?: string,
): Promise<void> {
  const [owner, repo] = config.repository.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid dashboard repository: ${config.repository}`);
  }

  const resolvedRunId = runId ?? (await store.listPendingSyncRunIds())[0];
  if (!resolvedRunId) {
    return;
  }

  const run = await store.loadInspection(resolvedRunId);
  const observations = await store.loadObservationsForRun(resolvedRunId);
  const existingLedgers = await store.loadLedgers();
  const existingMetadata =
    (await store.loadSyncMetadata(resolvedRunId)) ??
    makeInitialSyncMetadata(resolvedRunId, config.repository, config.issueNumber);
  const issueTarget = { owner, repo, issueNumber: config.issueNumber };
  const issue = await client.getIssue(issueTarget);
  const knownKeys = new Set<string>([
    ...existingLedgers.map((ledger) => ledger.finding_key),
    ...observations.map((observation) => observation.finding_key),
  ]);
  const manualFields = parseManualFindingFields(issue.body, knownKeys);
  const nextLedgers = finalizeLedgersForRun({
    existingLedgers,
    run,
    observations,
    manualFields,
    detectorVersionById: new Map(detectorCatalog.map((detector) => [detector.detectorId, detector.detectorVersion])),
  });
  const history = await store.listInspectionHistory(defaultDashboardLimits.run_history_limit);
  const projection = buildDashboardProjection(nextLedgers, history);
  const managedBlock = renderDashboardManagedBlock(projection);
  const desiredBody = replaceManagedBlock(issue.body, managedBlock);
  const currentDigest = digestManagedBlock(extractManagedBlock(issue.body));
  const desiredDigest = digestManagedBlock(managedBlock);
  if (!desiredDigest) {
    throw new Error("Failed to compute desired dashboard digest.");
  }

  let metadata: SyncMetadata = {
    ...existingMetadata,
    sync_attempt_id: randomUUID(),
    sync_state: currentDigest === desiredDigest ? "issue_body_confirmed" : "issue_update_requested",
    issue_repository: config.repository,
    issue_number: config.issueNumber,
    prior_body_digest: currentDigest,
    desired_body_digest: desiredDigest,
    confirmed_body_digest: currentDigest === desiredDigest ? desiredDigest : existingMetadata.confirmed_body_digest,
    issue_updated_at: issue.updatedAt,
    github_response_metadata: {
      issue_html_url: issue.htmlUrl,
      mode: currentDigest === desiredDigest ? "already_applied" : "pending_update",
    },
  };
  await store.saveSyncMetadata(metadata);

  if (currentDigest !== desiredDigest) {
    await client.updateIssueBody(issueTarget, desiredBody);
    const confirmed = await client.getIssue(issueTarget);
    const confirmedDigest = digestManagedBlock(extractManagedBlock(confirmed.body));
    if (confirmedDigest !== desiredDigest) {
      throw new Error("Dashboard issue update did not converge on the desired managed block digest.");
    }

    metadata = {
      ...metadata,
      sync_state: "issue_body_confirmed",
      confirmed_body_digest: confirmedDigest,
      issue_updated_at: confirmed.updatedAt,
      github_response_metadata: {
        issue_html_url: confirmed.htmlUrl,
        mode: "updated",
      },
    };
    await store.saveSyncMetadata(metadata);
  }

  await store.replaceLedgers(nextLedgers);
  await store.saveSyncMetadata({
    ...metadata,
    sync_state: "ledger_finalized",
  });
  await store.saveSyncMetadata({
    ...metadata,
    sync_state: "synced",
  });
}

function appendLedgerSection(lines: string[], ledgers: FindingLedger[], emptyMessage: string): void {
  if (ledgers.length === 0) {
    lines.push(emptyMessage);
    lines.push("");
    return;
  }

  for (const ledger of ledgers) {
    lines.push(`### ${ledger.repository}: ${ledger.title}`);
    lines.push("");
    lines.push(`- Detector: \`${ledger.detector_id}@${ledger.detector_version}\``);
    lines.push(`- Risk: \`${ledger.risk_class}\``);
    lines.push(`- Finding key: \`${ledger.finding_key}\``);
    lines.push(`- Dedup key: \`${ledger.dedup_key}\``);
    lines.push(`- Lifecycle: \`${ledger.lifecycle_state}\``);
    if (ledger.lifecycle_state === "superseded") {
      lines.push(`- Superseded at: ${ledger.superseded_at ?? "unknown"}`);
      lines.push(`- Replacement detector version: \`${ledger.superseded_by_detector_version ?? "unknown"}\``);
      lines.push(`- Replacement finding: \`${ledger.superseded_by_finding_key ?? "none"}\``);
    }
    lines.push(
      `- Notification suppression: ${
        ledger.notification_suppressed_until ? `through ${ledger.notification_suppressed_until}` : "no"
      }`,
    );
    lines.push(`- Manual classification: \`${ledger.manual_classification}\``);
    lines.push(`- Estimated review effort: \`${ledger.estimated_review_effort}\``);
    lines.push(`- Recommended disposition: \`${ledger.recommended_disposition}\``);
    lines.push(`- Evidence: ${ledger.latest_evidence.join(" | ") || "none"}`);
    lines.push(`- Run: ${ledger.latest_artifact.artifact_run_url ?? "unavailable"}`);
    lines.push(`- Artifact: ${ledger.latest_artifact.artifact_name ?? "unavailable"}`);
    lines.push(`- Path: ${ledger.latest_artifact.artifact_relative_path}`);
    lines.push(`- Retention through: ${ledger.latest_artifact.artifact_retention_until ?? "unknown"}`);
    lines.push(`- Certificate SHA-256: \`${ledger.latest_certificate_digest}\``);
    lines.push(renderManualFindingBlock(ledger));
    lines.push("");
  }
}

function renderManualFindingBlock(ledger: FindingLedger): string {
  const block = {
    finding_key: ledger.finding_key,
    manual_classification: ledger.manual_classification as ManualClassification,
    estimated_review_effort: ledger.estimated_review_effort as EstimatedReviewEffort,
    recommended_disposition: ledger.recommended_disposition as RecommendedDisposition,
  };

  return `<!--\n${findingBlockPrefix}\n${JSON.stringify(block, null, 2)}\n-->`;
}

function makeInitialSyncMetadata(runId: string, repository: string, issueNumber: number): SyncMetadata {
  return {
    run_id: runId,
    sync_attempt_id: randomUUID(),
    sync_state: "pending",
    issue_repository: repository,
    issue_number: issueNumber,
    prior_body_digest: null,
    desired_body_digest: null,
    confirmed_body_digest: null,
    issue_updated_at: null,
    github_response_metadata: {},
  };
}

function compareLedgers(left: FindingLedger, right: FindingLedger): number {
  return (
    severityForLifecycle(left.lifecycle_state) - severityForLifecycle(right.lifecycle_state) ||
    left.repository.localeCompare(right.repository) ||
    left.detector_id.localeCompare(right.detector_id) ||
    left.finding_key.localeCompare(right.finding_key)
  );
}

function severityForLifecycle(state: LifecycleState): number {
  switch (state) {
    case "open":
      return 0;
    case "operator_suppressed":
      return 1;
    case "resolved":
      return 2;
    case "superseded":
      return 3;
  }
}
