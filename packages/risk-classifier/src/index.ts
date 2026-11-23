import { type Finding, type RiskClass } from "../../shared-types/src/index.js";

const riskRank: Record<RiskClass, number> = {
  R0: 0,
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4,
  R5: 5,
  R6: 6,
};

export function classifyFindingRisk(finding: Finding): RiskClass {
  const floor = deriveRiskFloor(finding);
  return riskRank[finding.risk] >= riskRank[floor] ? finding.risk : floor;
}

export function summarizeRisk(findings: Finding[]): Record<RiskClass, number> {
  const counts: Record<RiskClass, number> = {
    R0: 0,
    R1: 0,
    R2: 0,
    R3: 0,
    R4: 0,
    R5: 0,
    R6: 0,
  };

  for (const finding of findings) {
    counts[finding.risk] += 1;
  }

  return counts;
}

function deriveRiskFloor(finding: Finding): RiskClass {
  if (finding.protected_paths_touched.length > 0) {
    return "R6";
  }

  const tags = new Set(finding.tags.map((tag) => tag.toLowerCase()));
  if (["authentication", "authorization", "security", "release"].some((tag) => tags.has(tag))) {
    return "R5";
  }

  if (["runtime", "ci", "workflow", "deployment", "validation"].some((tag) => tags.has(tag))) {
    return "R4";
  }

  if (tags.has("documentation") || tags.has("generated")) {
    return "R2";
  }

  if (tags.has("metadata") || tags.has("dependencies")) {
    return "R1";
  }

  return "R0";
}
