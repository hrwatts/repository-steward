import { createHash } from "node:crypto";

import {
  validationCertificateSchema,
  type DashboardSyncPayload,
  type Finding,
  type InspectionRun,
  type ValidationCertificate,
} from "../../shared-types/src/index.js";

export function makeValidationCertificate(
  inspectionId: string,
  repository: string,
  headSha: string | null,
  finding: Finding,
): ValidationCertificate {
  return validationCertificateSchema.parse({
    schema_version: 1,
    certificate_kind: "observation",
    repository,
    inspection_id: inspectionId,
    base_sha: null,
    head_sha: headSha,
    generator: {
      name: "repository-steward",
      version: "0.2.0",
    },
    change: {
      class: finding.code,
      risk: finding.risk,
      reason: finding.summary,
      changed_files: [],
      protected_files: finding.protected_paths_touched,
      changed_test_files: [],
      observed_files: finding.related_paths,
    },
    validation: {
      clean_install: "not_run",
      unit_tests: "not_run",
      lint: "not_run",
      docs: "not_run",
      idempotence: "not_run",
    },
    uncertainties: [
      "Inspection-only release records observations and does not run source-repository mutation validation.",
    ],
    eligible_for_minimal_review: false,
  });
}

export function certificateHash(certificate: ValidationCertificate): string {
  const canonical = JSON.stringify(canonicalize(certificate));
  return createHash("sha256").update(canonical).digest("hex");
}

export function renderRunMarkdown(run: InspectionRun): string {
  const lines: string[] = [
    "# Inspection Run Summary",
    "",
    `- Run ID: \`${run.id}\``,
    `- Started: ${run.startedAt}`,
    `- Completed: ${run.completedAt}`,
    `- Dry run: ${run.dryRun ? "yes" : "no"}`,
    `- Repositories inspected: ${run.repositories.join(", ")}`,
    `- Finding count: ${run.findings.length}`,
    "",
    "## Coverage",
    "",
  ];

  for (const coverage of run.coverage) {
    lines.push(`### ${coverage.repository}`);
    lines.push("");
    lines.push(`- Collection complete: ${coverage.collection_complete ? "yes" : "no"}`);
    lines.push(`- Filtered: ${coverage.filtered ? "yes" : "no"}`);
    lines.push(`- Detectors expected: ${coverage.detectors_expected.join(", ") || "none"}`);
    lines.push(`- Detectors completed: ${coverage.detectors_completed.join(", ") || "none"}`);
    lines.push(`- Detectors failed: ${coverage.detectors_failed.join(", ") || "none"}`);
    lines.push("");
  }

  lines.push("## Findings");
  lines.push("");

  if (run.findings.length === 0) {
    lines.push("No findings.");
    return lines.join("\n");
  }

  for (const finding of run.findings) {
    lines.push(`### ${finding.repository}: ${finding.title}`);
    lines.push("");
    lines.push(`- Finding key: \`${finding.finding_key}\``);
    lines.push(`- Dedup key: \`${finding.dedup_key}\``);
    lines.push(`- Detector: \`${finding.detector_id}@${finding.detector_version}\``);
    lines.push(`- Risk: \`${finding.risk}\``);
    lines.push(`- Notification suppressed: \`${finding.notification_suppressed ? "yes" : "no"}\``);
    lines.push(`- Summary: ${finding.summary}`);
    lines.push(`- Related paths: ${finding.related_paths.join(", ") || "none"}`);
    lines.push(`- Evidence: ${finding.evidence.join(" | ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function summarizePayloadForArtifact(payload: DashboardSyncPayload): string {
  return renderRunMarkdown(payload.run);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }

  return value;
}
