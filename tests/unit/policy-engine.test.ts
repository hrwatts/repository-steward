import assert from "node:assert/strict";

import { test } from "../harness.js";
import {
  matchesProtectedPath,
  minimalReviewEligible,
  resolveRepositoryPolicy,
} from "../../packages/policy-engine/src/index.js";
import defaultPolicy from "../../policy-schema/defaults/hrwatts-default-policy.json" with { type: "json" };
import { repositoryPolicySchema } from "../../packages/shared-types/src/index.js";

test("matchesProtectedPath matches double-star patterns", () => {
  const policy = repositoryPolicySchema.parse(defaultPolicy);

  assert.equal(matchesProtectedPath(policy, "results/summary.csv"), true);
  assert.equal(matchesProtectedPath(policy, "src/main.py"), false);
});

test("minimalReviewEligible rejects non-low-risk classes", () => {
  const policy = repositoryPolicySchema.parse(defaultPolicy);

  assert.equal(minimalReviewEligible(policy, ["src/main.py"], "R4"), false);
  assert.equal(minimalReviewEligible(policy, ["src/main.py"], "R2"), true);
  assert.equal(minimalReviewEligible(policy, ["results/summary.csv"], "R2"), false);
});

test("repository-local policy files are partial overrides", async () => {
  const policy = await resolveRepositoryPolicy(
    {
      name: "owner/repo",
      archetype: "python-library",
      default_branch: "main",
      language_profiles: ["python"],
      paths_of_interest: ["README.md"],
    },
    {
      repository: "owner/repo",
      defaultBranch: "main",
      headSha: "abc123",
      description: null,
      isPrivate: false,
      pushedAt: null,
      language: "Python",
      stargazerCount: 0,
      openPullRequestCount: 0,
      hasIssuesEnabled: true,
      contents: {},
    },
    JSON.stringify({ protected_paths: ["custom/**"] }),
  );

  assert.ok(policy.protected_paths.includes("custom/**"));
  assert.ok(policy.protected_paths.includes("results/**"));
});
