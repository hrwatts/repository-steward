import { readFile } from "node:fs/promises";

import defaultPolicy from "../../../policy-schema/defaults/hrwatts-default-policy.json" with { type: "json" };
import {
  repositoryPolicySchema,
  type RepositoryInventory,
  type RepositoryPolicy,
  type RepositorySnapshot,
} from "../../shared-types/src/index.js";

export async function resolveRepositoryPolicy(
  inventory: RepositoryInventory,
  snapshot: RepositorySnapshot,
  localPolicyText?: string | null,
): Promise<RepositoryPolicy> {
  const parsedDefault = repositoryPolicySchema.parse(defaultPolicy);
  const localPolicy = parseLocalPolicy(localPolicyText);

  const merged = {
    ...parsedDefault,
    repository: {
      ...parsedDefault.repository,
      language_profiles: inventory.language_profiles,
    },
    protected_paths: uniqueStrings([
      ...parsedDefault.protected_paths,
      ...(inventory.policy_overrides?.protected_paths ?? []),
      ...(localPolicy?.protected_paths ?? []),
    ]),
    protected_change_classes: uniqueStrings([
      ...parsedDefault.protected_change_classes,
      ...(localPolicy?.protected_change_classes ?? []),
    ]),
    repairs: {
      ...parsedDefault.repairs,
      ...(localPolicy?.repairs ?? {}),
    },
    validation: {
      required: uniqueStrings([
        ...parsedDefault.validation.required,
        ...(localPolicy?.validation?.required ?? []),
      ]),
      optional: uniqueStrings([
        ...parsedDefault.validation.optional,
        ...(localPolicy?.validation?.optional ?? []),
      ]),
    },
  };

  return repositoryPolicySchema.parse(merged);
}

export async function loadPolicyFile(path: string): Promise<RepositoryPolicy> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  return repositoryPolicySchema.parse(raw);
}

export function matchesProtectedPath(policy: RepositoryPolicy, path: string): boolean {
  return policy.protected_paths.some((pattern) => globMatch(pattern, path));
}

export function minimalReviewEligible(
  policy: RepositoryPolicy,
  touchedPaths: string[],
  risk: string,
): boolean {
  if (!["R1", "R2", "R3"].includes(risk)) {
    return false;
  }

  return touchedPaths.every((path) => !matchesProtectedPath(policy, path));
}

function parseLocalPolicy(localPolicyText?: string | null): Partial<RepositoryPolicy> | null {
  if (!localPolicyText) {
    return null;
  }

  const parsed = JSON.parse(localPolicyText) as unknown;
  return repositoryPolicySchema.partial().parse(parsed) as Partial<RepositoryPolicy>;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function globMatch(pattern: string, target: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "___DOUBLE_WILDCARD___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLE_WILDCARD___/g, ".*");

  const regex = new RegExp(`^${escaped}$`);
  return regex.test(target);
}
