import {
  fingerprintSchemaVersion,
  makeDedupKey,
  makeFindingKey,
  makeFingerprint,
  type Finding,
  type RepositoryInventory,
  type RepositoryPolicy,
  type RepositorySnapshot,
} from "../../shared-types/src/index.js";

type DetectorContext = {
  inventory: RepositoryInventory;
  policy: RepositoryPolicy;
  snapshot: RepositorySnapshot;
};

export interface DetectorExecutionResult {
  detectorId: string;
  detectorVersion: string;
  findings: Finding[];
  succeeded: boolean;
  error?: string;
}

type DetectorDefinition = {
  detectorId: string;
  detectorVersion: string;
  run: (context: DetectorContext, metadata: DetectorMetadata) => Finding[];
};

type DetectorMetadata = {
  detectorId: string;
  detectorVersion: string;
};

const detectors: DetectorDefinition[] = [
  {
    detectorId: "dependency-automation",
    detectorVersion: "1",
    run: detectMissingDependencyAutomation,
  },
  {
    detectorId: "runtime-support",
    detectorVersion: "1",
    run: detectPythonSupportMismatch,
  },
  {
    detectorId: "workflow-presence",
    detectorVersion: "1",
    run: detectMissingExpectedWorkflow,
  },
  {
    detectorId: "policy-presence",
    detectorVersion: "1",
    run: detectMissingRepositoryStewardPolicy,
  },
];

export const detectorCatalog = detectors.map((detector) => ({
  detectorId: detector.detectorId,
  detectorVersion: detector.detectorVersion,
}));

export function runMaintenanceDetectors(context: DetectorContext): DetectorExecutionResult[] {
  return detectors.map((detector) => {
    try {
      return {
        detectorId: detector.detectorId,
        detectorVersion: detector.detectorVersion,
        findings: detector.run(context, {
          detectorId: detector.detectorId,
          detectorVersion: detector.detectorVersion,
        }),
        succeeded: true,
      };
    } catch (error) {
      return {
        detectorId: detector.detectorId,
        detectorVersion: detector.detectorVersion,
        findings: [],
        succeeded: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

export function detectMaintenanceDrift(context: DetectorContext): Finding[] {
  return runMaintenanceDetectors(context).flatMap((result) => result.findings);
}

function detectMissingDependencyAutomation(
  { inventory, snapshot }: DetectorContext,
  metadata: DetectorMetadata,
): Finding[] {
  const hasRenovate = snapshot.contents["renovate.json"] !== null;
  const hasDependabot = snapshot.contents[".github/dependabot.yml"] !== null;

  if (hasRenovate || hasDependabot) {
    return [];
  }

  return [
    createFinding({
      inventory,
      metadata,
      title: "Dependency automation is not configured",
      code: "dependency_automation_missing",
      summary: "The repository does not expose Renovate or Dependabot configuration in the inspected paths.",
      risk: "R1",
      status: "advisory",
      evidence: [
        "No `renovate.json` detected in the repository root.",
        "No `.github/dependabot.yml` detected among the inspected files.",
      ],
      relatedPaths: ["renovate.json", ".github/dependabot.yml"],
      tags: ["dependencies", "automation", "metadata"],
      canonicalSubject: "dependency-automation",
      canonicalCondition: "renovate-or-dependabot-missing",
      data: {
        archetype: inventory.archetype,
      },
    }),
  ];
}

function detectPythonSupportMismatch(
  { inventory, snapshot }: DetectorContext,
  metadata: DetectorMetadata,
): Finding[] {
  if (!inventory.language_profiles.includes("python")) {
    return [];
  }

  const readme = snapshot.contents["README.md"];
  const pyproject = snapshot.contents["pyproject.toml"];
  const workflow = snapshot.contents[".github/workflows/ci.yml"];

  if (!readme || !pyproject || !workflow) {
    return [];
  }

  const readmeVersions = extractPythonVersions(readme);
  const workflowVersions = extractPythonVersions(workflow);
  const pyprojectMinimum = extractPyprojectMinimum(pyproject);

  if (!pyprojectMinimum) {
    return [];
  }

  const mismatch =
    !readmeVersions.has(pyprojectMinimum) || (workflowVersions.size > 0 && !workflowVersions.has(pyprojectMinimum));

  if (!mismatch) {
    return [];
  }

  return [
    createFinding({
      inventory,
      metadata,
      title: "Documented Python support does not match inspected automation",
      code: "python_support_mismatch",
      summary:
        "The README and/or CI workflow does not clearly include the minimum Python version declared in project metadata.",
      risk: "R4",
      status: "advisory",
      evidence: [
        `Detected minimum version from project metadata: ${pyprojectMinimum}.`,
        `README versions seen: ${[...readmeVersions].join(", ") || "none"}.`,
        `Workflow versions seen: ${[...workflowVersions].join(", ") || "none"}.`,
      ],
      relatedPaths: ["README.md", "pyproject.toml", ".github/workflows/ci.yml"],
      tags: ["python", "ci", "documentation"],
      canonicalSubject: "python-runtime-support",
      canonicalCondition: `minimum-version-${pyprojectMinimum}-missing-from-readme-or-workflow`,
      data: {
        pyprojectMinimum,
        readmeVersions: [...readmeVersions],
        workflowVersions: [...workflowVersions],
      },
    }),
  ];
}

function detectMissingExpectedWorkflow(
  { inventory, snapshot }: DetectorContext,
  metadata: DetectorMetadata,
): Finding[] {
  const findings: Finding[] = [];

  if (inventory.archetype === "creative-site" && snapshot.contents[".github/workflows/deploy-pages.yml"] === null) {
    findings.push(
      createFinding({
        inventory,
        metadata,
        title: "Expected Pages deployment workflow is not present",
        code: "missing_pages_workflow",
        summary: "The creative-site archetype expects a Pages deployment workflow, but the inspected path is missing.",
        risk: "R4",
        status: "advisory",
        evidence: ["No `.github/workflows/deploy-pages.yml` found in inspected repository contents."],
        relatedPaths: [".github/workflows/deploy-pages.yml"],
        tags: ["github-pages", "deployment", "workflow"],
        canonicalSubject: "workflow-presence",
        canonicalCondition: "missing-pages-workflow",
        data: {
          archetype: inventory.archetype,
        },
      }),
    );
  }

  if (
    ["python-library", "research-companion", "benchmark-research", "algorithm-port"].includes(
      inventory.archetype,
    ) &&
    snapshot.contents[".github/workflows/ci.yml"] === null
  ) {
    findings.push(
      createFinding({
        inventory,
        metadata,
        title: "Expected CI workflow is not present",
        code: "missing_ci_workflow",
        summary: "The repository archetype expects a CI workflow, but the inspected path is missing.",
        risk: "R4",
        status: "advisory",
        evidence: ["No `.github/workflows/ci.yml` found in inspected repository contents."],
        relatedPaths: [".github/workflows/ci.yml"],
        tags: ["ci", "workflow", "validation"],
        canonicalSubject: "workflow-presence",
        canonicalCondition: "missing-ci-workflow",
        data: {
          archetype: inventory.archetype,
        },
      }),
    );
  }

  return findings;
}

function detectMissingRepositoryStewardPolicy(
  { inventory, snapshot }: DetectorContext,
  metadata: DetectorMetadata,
): Finding[] {
  if (snapshot.contents[".github/repository-steward.json"] !== null) {
    return [];
  }

  return [
    createFinding({
      inventory,
      metadata,
      title: "Repository-local steward policy is not present",
      code: "missing_repository_steward_policy",
      summary:
        "The repository does not yet publish a local repository-steward policy override file; central defaults will be used.",
      risk: "R0",
      status: "advisory",
      evidence: [
        "No `.github/repository-steward.json` detected.",
        `Central archetype defaults for ${inventory.archetype} will apply.`,
      ],
      relatedPaths: [".github/repository-steward.json"],
      tags: ["policy", "inventory"],
      canonicalSubject: "repository-steward-policy",
      canonicalCondition: "missing-local-policy",
      data: {
        archetype: inventory.archetype,
      },
    }),
  ];
}

function createFinding(input: {
  inventory: RepositoryInventory;
  metadata: DetectorMetadata;
  title: string;
  code: string;
  summary: string;
  risk: Finding["risk"];
  status: Finding["status"];
  evidence: string[];
  relatedPaths: string[];
  tags: string[];
  canonicalSubject: string;
  canonicalCondition: string;
  data: Record<string, unknown>;
}): Finding {
  const fingerprint = makeFingerprint(input.inventory.name, input.code.replace(/_/g, "-"), [input.canonicalCondition]);
  const findingKey = makeFindingKey({
    fingerprintSchemaVersion,
    repositoryId: input.inventory.name,
    detectorId: input.metadata.detectorId,
    detectorRuleVersion: input.metadata.detectorVersion,
    canonicalSubject: input.canonicalSubject,
    canonicalCondition: input.canonicalCondition,
  });

  return {
    finding_key: findingKey,
    dedup_key: makeDedupKey(input.inventory.name, input.metadata.detectorId, input.canonicalCondition),
    fingerprint,
    fingerprint_schema_version: fingerprintSchemaVersion,
    repository: input.inventory.name,
    detector_id: input.metadata.detectorId,
    detector_version: input.metadata.detectorVersion,
    canonical_subject: input.canonicalSubject,
    canonical_condition: input.canonicalCondition,
    title: input.title,
    code: input.code,
    summary: input.summary,
    risk: input.risk,
    status: input.status,
    evidence: input.evidence,
    source_urls: [],
    protected_paths_touched: [],
    tags: input.tags,
    related_paths: input.relatedPaths,
    data: input.data,
    notification_suppressed: false,
  };
}

function extractPythonVersions(text: string): Set<string> {
  const matches = [...text.matchAll(/\b3\.(?:10|11|12|13|14)\b/g)];
  return new Set(matches.map((match) => match[0]));
}

function extractPyprojectMinimum(text: string): string | null {
  const match = text.match(/requires-python\s*=\s*["']>=\s*(3\.\d+)/i);
  return match?.[1] ?? null;
}
