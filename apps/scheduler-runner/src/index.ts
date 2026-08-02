import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { createAuditStore, writeRunArtifacts, type InspectionBundle } from "../../../packages/audit-store/src/index.js";
import { detectorCatalog, runMaintenanceDetectors } from "../../../packages/drift-detectors/src/index.js";
import {
  certificateHash,
  makeValidationCertificate,
  renderRunMarkdown,
} from "../../../packages/evidence-generator/src/index.js";
import { OctokitGithubClient } from "../../../packages/github-client/src/index.js";
import { resolveRepositoryPolicy } from "../../../packages/policy-engine/src/index.js";
import { planRepair } from "../../../packages/repair-planner/src/index.js";
import {
  inspectRepositorySnapshot,
  loadRepositoryInventory,
} from "../../../packages/repository-discovery/src/index.js";
import { summarizeRisk } from "../../../packages/risk-classifier/src/index.js";
import {
  defaultInspectionBudget,
  inspectionRunSchema,
  repositoryCoverageSchema,
  type Finding,
  type FindingObservation,
  type InspectionRun,
  type SyncMetadata,
} from "../../../packages/shared-types/src/index.js";

type Environment = {
  inventoryPath: string;
  databaseUrl: string | undefined;
  dryRun: boolean;
  mutationsEnabled: boolean;
  outputRoot: string;
  dashboardIssueRepo: string | undefined;
  dashboardIssueNumber: number | undefined;
  githubToken: string | undefined;
  githubAppId: string | undefined;
  githubPrivateKey: string | undefined;
  githubInstallationId: string | undefined;
  artifactName: string | undefined;
  artifactRunUrl: string | undefined;
  artifactRetentionUntil: string | undefined;
};

async function main(): Promise<void> {
  const env = readEnvironment();
  const clientOptions = {
    ...(env.githubToken ? { token: env.githubToken } : {}),
    ...(env.githubAppId ? { appId: env.githubAppId } : {}),
    ...(env.githubPrivateKey ? { privateKey: env.githubPrivateKey } : {}),
    ...(env.githubInstallationId ? { installationId: env.githubInstallationId } : {}),
  };
  const client = new OctokitGithubClient(clientOptions);
  const store = createAuditStore(env.databaseUrl);
  await store.initialize();

  const inventory = await loadRepositoryInventory(env.inventoryPath);
  const startedAt = new Date().toISOString();
  const inspectionId = randomUUID();
  const findings: Finding[] = [];
  const observations: FindingObservation[] = [];
  const certificates: InspectionBundle["certificates"] = [];
  const coverage = [];

  for (const repository of inventory) {
    const detectorsExpected = detectorCatalog.map((detector) => detector.detectorId);

    try {
      const snapshot = await inspectRepositorySnapshot(client, repository);
      const localPolicyText = snapshot.contents[".github/repository-steward.json"] ?? null;
      const policy = await resolveRepositoryPolicy(repository, snapshot, localPolicyText);
      const detectorResults = runMaintenanceDetectors({
        inventory: repository,
        policy,
        snapshot,
      });

      coverage.push(
        repositoryCoverageSchema.parse({
          repository: repository.name,
          detectors_expected: detectorsExpected,
          detectors_completed: detectorResults.filter((result) => result.succeeded).map((result) => result.detectorId),
          detectors_failed: detectorResults.filter((result) => !result.succeeded).map((result) => result.detectorId),
          collection_complete: detectorResults.every((result) => result.succeeded),
          filtered: false,
          head_sha: snapshot.headSha,
        }),
      );

      for (const finding of detectorResults.flatMap((result) => result.findings)) {
        const duplicate = await store.recentlySeenFinding(
          finding.repository,
          finding.finding_key,
          defaultInspectionBudget.suppress_duplicate_findings_for_days,
        );
        const findingForRun: Finding = {
          ...finding,
          notification_suppressed: duplicate,
        };
        findings.push(findingForRun);

        const certificate = makeValidationCertificate(inspectionId, repository.name, snapshot.headSha, findingForRun);
        const certificateDigest = certificateHash(certificate);
        certificates.push({
          inspectionId,
          findingKey: findingForRun.finding_key,
          hash: certificateDigest,
          certificate,
        });

        const observationPath = `findings/${sanitizeFileComponent(findingForRun.finding_key)}.json`;
        observations.push({
          run_id: inspectionId,
          observed_at: startedAt,
          finding_key: findingForRun.finding_key,
          dedup_key: findingForRun.dedup_key,
          fingerprint: findingForRun.fingerprint,
          fingerprint_schema_version: findingForRun.fingerprint_schema_version,
          repository: findingForRun.repository,
          detector_id: findingForRun.detector_id,
          detector_version: findingForRun.detector_version,
          risk_class: findingForRun.risk,
          status: findingForRun.status,
          title: findingForRun.title,
          code: findingForRun.code,
          summary: findingForRun.summary,
          canonical_subject: findingForRun.canonical_subject,
          canonical_condition: findingForRun.canonical_condition,
          evidence_normalized: findingForRun.evidence,
          source_urls: findingForRun.source_urls,
          observed_head_sha: snapshot.headSha,
          certificate_digest: certificateDigest,
          artifact_run_url: env.artifactRunUrl ?? null,
          artifact_name: env.artifactName ?? null,
          artifact_relative_path: observationPath,
          artifact_retention_until: env.artifactRetentionUntil ?? null,
          notification_suppressed: duplicate,
          protected_paths_touched: findingForRun.protected_paths_touched,
          tags: findingForRun.tags,
          related_paths: findingForRun.related_paths,
          data: findingForRun.data,
        });
      }

      const repairPlans = planRepair(findings.filter((finding) => finding.repository === repository.name));
      if (repairPlans.length > 0) {
        const planPath = resolve(env.outputRoot, inspectionId, sanitizeFileComponent(repository.name), "repair-plans.json");
        await mkdir(resolve(planPath, ".."), { recursive: true });
        await writeFile(planPath, JSON.stringify(repairPlans, null, 2));
      }
    } catch (error) {
      coverage.push(
        repositoryCoverageSchema.parse({
          repository: repository.name,
          detectors_expected: detectorsExpected,
          detectors_completed: [],
          detectors_failed: detectorsExpected,
          collection_complete: false,
          filtered: false,
          head_sha: null,
        }),
      );
      process.stderr.write(
        `Repository inspection failed for ${repository.name}: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    }
  }

  const completedAt = new Date().toISOString();
  const run: InspectionRun = inspectionRunSchema.parse({
    id: inspectionId,
    startedAt,
    completedAt,
    dryRun: env.dryRun || !env.mutationsEnabled,
    repositories: inventory.map((item) => item.name),
    findings,
    coverage,
  });

  const summaryMarkdown = renderRunMarkdown(run);
  const runOutputDirectory = resolve(env.outputRoot, inspectionId);
  await writeRunArtifacts(
    runOutputDirectory,
    {
      run,
      observations,
      coverage,
    },
    summaryMarkdown,
  );
  await writeFile(
    resolve(runOutputDirectory, "risk-summary.json"),
    JSON.stringify(summarizeRisk(findings), null, 2),
  );
  await writeFile(resolve(env.outputRoot, "latest-run-id.txt"), inspectionId);

  const bundle: InspectionBundle = {
    run,
    observations,
    certificates,
    ...(env.dashboardIssueRepo && env.dashboardIssueNumber
      ? {
          syncMetadata: makePendingSyncMetadata(
            inspectionId,
            env.dashboardIssueRepo,
            env.dashboardIssueNumber,
          ),
        }
      : {}),
  };
  await store.recordInspectionBundle(bundle);

  process.stdout.write(`${summaryMarkdown}\n`);
}

function readEnvironment(): Environment {
  const outputRoot = process.env.REPOSITORY_STEWARD_OUTPUT_ROOT ?? "artifacts/runs";
  const artifactRunUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined;

  return {
    inventoryPath: process.env.REPOSITORY_STEWARD_INVENTORY_PATH ?? "examples/hrwatts/repositories.json",
    databaseUrl: normalizeOptional(process.env.DATABASE_URL),
    dryRun: parseBoolean(process.env.REPOSITORY_STEWARD_DRY_RUN, true),
    mutationsEnabled: parseBoolean(process.env.REPOSITORY_STEWARD_MUTATIONS_ENABLED, false),
    outputRoot,
    dashboardIssueRepo: normalizeOptional(process.env.DASHBOARD_ISSUE_REPO),
    dashboardIssueNumber: process.env.DASHBOARD_ISSUE_NUMBER
      ? Number(process.env.DASHBOARD_ISSUE_NUMBER)
      : undefined,
    githubToken: normalizeOptional(process.env.GITHUB_TOKEN),
    githubAppId: normalizeOptional(process.env.GITHUB_APP_ID),
    githubPrivateKey: normalizeOptional(process.env.GITHUB_PRIVATE_KEY),
    githubInstallationId: normalizeOptional(process.env.GITHUB_INSTALLATION_ID),
    artifactName: normalizeOptional(process.env.REPOSITORY_STEWARD_ARTIFACT_NAME),
    artifactRunUrl,
    artifactRetentionUntil: calculateArtifactRetention(process.env.GITHUB_RETENTION_DAYS),
  };
}

function calculateArtifactRetention(retentionDays: string | undefined): string | undefined {
  if (!retentionDays) {
    return undefined;
  }

  const days = Number(retentionDays);
  if (!Number.isFinite(days)) {
    return undefined;
  }

  const retained = new Date();
  retained.setUTCDate(retained.getUTCDate() + days);
  return retained.toISOString();
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function sanitizeFileComponent(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function makePendingSyncMetadata(
  runId: string,
  repository: string,
  issueNumber: number,
): SyncMetadata {
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
