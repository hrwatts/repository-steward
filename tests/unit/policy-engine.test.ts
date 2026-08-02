import assert from "node:assert/strict";

import { test } from "../harness.js";
import { matchesProtectedPath, minimalReviewEligible } from "../../packages/policy-engine/src/index.js";
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
