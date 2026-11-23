import { type Finding } from "../../shared-types/src/index.js";

export interface RepairPlan {
  findingFingerprint: string;
  eligible: boolean;
  mode: "none" | "future_candidate";
  rationale: string;
}

export function planRepair(findings: Finding[]): RepairPlan[] {
  return findings.map((finding) => ({
    findingFingerprint: finding.fingerprint,
    eligible: false,
    mode: "none",
    rationale:
      "Inspection-only releases do not create source-repository branches or pull requests; repair planning is advisory only.",
  }));
}
