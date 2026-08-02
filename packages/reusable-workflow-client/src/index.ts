import { type RepositoryPolicy } from "../../shared-types/src/index.js";

export interface ValidationDispatchPlan {
  requiredChecks: string[];
  optionalChecks: string[];
  notes: string[];
}

export function buildValidationDispatchPlan(policy: RepositoryPolicy): ValidationDispatchPlan {
  return {
    requiredChecks: policy.validation.required,
    optionalChecks: policy.validation.optional,
    notes: [
      "v0.1 dry pilot does not dispatch repository-local reusable workflows automatically.",
      "The returned check plan is recorded for evidence and future v0.2 mutation paths.",
    ],
  };
}
