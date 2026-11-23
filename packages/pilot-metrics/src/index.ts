import { type FindingLedger, type RiskClass } from "../../shared-types/src/index.js";

export interface PilotMetrics {
  finding_count: number;
  reviewed_count: number;
  unreviewed_count: number;
  review_completion_rate: number;
  actionable_count: number;
  false_positive_or_misclassified_count: number;
  low_risk_unsafe_count: number;
  lifecycle_counts: Record<string, number>;
  risk_counts: Record<RiskClass, number>;
  review_effort_counts: Record<string, number>;
  gate_assessment: "human_decision_required";
}

export function calculatePilotMetrics(ledgers: FindingLedger[]): PilotMetrics {
  const riskCounts: Record<RiskClass, number> = {
    R0: 0,
    R1: 0,
    R2: 0,
    R3: 0,
    R4: 0,
    R5: 0,
    R6: 0,
  };
  const lifecycleCounts: Record<string, number> = {};
  const effortCounts: Record<string, number> = {};

  let reviewed = 0;
  let actionable = 0;
  let falsePositiveOrMisclassified = 0;
  let lowRiskUnsafe = 0;
  for (const ledger of ledgers) {
    riskCounts[ledger.risk_class] += 1;
    lifecycleCounts[ledger.lifecycle_state] = (lifecycleCounts[ledger.lifecycle_state] ?? 0) + 1;
    effortCounts[ledger.estimated_review_effort] =
      (effortCounts[ledger.estimated_review_effort] ?? 0) + 1;

    if (ledger.manual_classification !== "unreviewed") {
      reviewed += 1;
    }
    if (ledger.manual_classification === "actionable") {
      actionable += 1;
    }
    if (["false_positive", "misclassified"].includes(ledger.manual_classification)) {
      falsePositiveOrMisclassified += 1;
    }
    if (
      ledger.manual_classification === "unsafe" &&
      ["R0", "R1", "R2", "R3"].includes(ledger.risk_class)
    ) {
      lowRiskUnsafe += 1;
    }
  }

  return {
    finding_count: ledgers.length,
    reviewed_count: reviewed,
    unreviewed_count: ledgers.length - reviewed,
    review_completion_rate: ledgers.length === 0 ? 0 : reviewed / ledgers.length,
    actionable_count: actionable,
    false_positive_or_misclassified_count: falsePositiveOrMisclassified,
    low_risk_unsafe_count: lowRiskUnsafe,
    lifecycle_counts: lifecycleCounts,
    risk_counts: riskCounts,
    review_effort_counts: effortCounts,
    gate_assessment: "human_decision_required",
  };
}
