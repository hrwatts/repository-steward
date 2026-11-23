import assert from "node:assert/strict";

import { test } from "../harness.js";
import { classifyFindingRisk } from "../../packages/risk-classifier/src/index.js";
import { findingSchema, type Finding } from "../../packages/shared-types/src/index.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return findingSchema.parse({
    finding_key: "sha256:key",
    dedup_key: "owner/repo::detector::condition",
    fingerprint: "owner/repo::code",
    fingerprint_schema_version: 1,
    repository: "owner/repo",
    detector_id: "detector",
    detector_version: "1",
    canonical_subject: "subject",
    canonical_condition: "condition",
    title: "Finding",
    code: "finding",
    summary: "Summary",
    risk: "R1",
    status: "advisory",
    evidence: [],
    source_urls: [],
    protected_paths_touched: [],
    tags: ["metadata"],
    related_paths: [],
    data: {},
    notification_suppressed: false,
    ...overrides,
  });
}

test("risk classifier raises protected-path findings to R6", () => {
  assert.equal(
    classifyFindingRisk(finding({ protected_paths_touched: ["results/baseline.json"] })),
    "R6",
  );
});

test("risk classifier never downgrades a detector declaration", () => {
  assert.equal(classifyFindingRisk(finding({ risk: "R5", tags: ["metadata"] })), "R5");
});

test("risk classifier raises workflow uncertainty to R4", () => {
  assert.equal(classifyFindingRisk(finding({ risk: "R1", tags: ["workflow"] })), "R4");
});
