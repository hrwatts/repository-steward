import assert from "node:assert/strict";

import { test } from "../harness.js";
import { detectMaintenanceDrift } from "../../packages/drift-detectors/src/index.js";
import {
  repositoryPolicySchema,
  type RepositoryInventory,
  type RepositorySnapshot,
} from "../../packages/shared-types/src/index.js";
import defaultPolicy from "../../policy-schema/defaults/hrwatts-default-policy.json" with { type: "json" };

const inventory: RepositoryInventory = {
  name: "hrwatts/example",
  archetype: "python-library",
  default_branch: "main",
  language_profiles: ["python"],
  paths_of_interest: [
    "README.md",
    "pyproject.toml",
    ".github/workflows/ci.yml",
    ".github/dependabot.yml",
    "renovate.json",
  ],
};

test("detects missing dependency automation with versioned keys", () => {
  const snapshot: RepositorySnapshot = {
    repository: "hrwatts/example",
    defaultBranch: "main",
    headSha: "abc123",
    description: null,
    isPrivate: false,
    pushedAt: null,
    language: "Python",
    stargazerCount: 0,
    openPullRequestCount: 0,
    hasIssuesEnabled: true,
    contents: {
      "README.md": "Python >=3.10",
      "pyproject.toml": 'requires-python = ">=3.10"',
      ".github/workflows/ci.yml": "python-version: [3.11, 3.12]",
      ".github/dependabot.yml": null,
      "renovate.json": null,
    },
  };

  const findings = detectMaintenanceDrift({
    inventory,
    policy: repositoryPolicySchema.parse(defaultPolicy),
    snapshot,
  });

  const dependencyFinding = findings.find((finding) => finding.code === "dependency_automation_missing");
  assert.ok(dependencyFinding);
  assert.match(dependencyFinding.finding_key, /^sha256:/);
  assert.equal(dependencyFinding.detector_id, "dependency-automation");
  assert.equal(dependencyFinding.notification_suppressed, false);

  const mismatchFinding = findings.find((finding) => finding.code === "python_support_mismatch");
  assert.ok(mismatchFinding);
  assert.equal(mismatchFinding.detector_id, "runtime-support");
  assert.ok(mismatchFinding.dedup_key.includes("runtime-support"));
});
