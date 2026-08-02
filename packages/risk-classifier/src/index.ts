import { type Finding, type RiskClass } from "../../shared-types/src/index.js";

export function classifyFindingRisk(finding: Finding): RiskClass {
  return finding.risk;
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
