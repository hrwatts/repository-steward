import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createAuditStore } from "../../../packages/audit-store/src/index.js";
import { OctokitGithubClient } from "../../../packages/github-client/src/index.js";
import { calculatePilotMetrics } from "../../../packages/pilot-metrics/src/index.js";
import { loadRepositoryInventory } from "../../../packages/repository-discovery/src/index.js";
import { runDashboardSync } from "../../dashboard-sync-runner/src/index.js";
import { runInspection } from "../../scheduler-runner/src/index.js";

export async function runCli(args: string[] = process.argv.slice(2)): Promise<void> {
  const [command] = args;
  switch (command) {
    case "doctor":
      await doctor();
      return;
    case "scan":
      await runInspection();
      return;
    case "sync":
      await runDashboardSync();
      return;
    case "pilot-report":
      await pilotReport();
      return;
    default:
      process.stdout.write("Usage: repository-steward <doctor|scan|sync|pilot-report>\n");
      if (command) {
        process.exitCode = 2;
      }
  }
}

async function pilotReport(): Promise<void> {
  const store = createAuditStore(process.env.DATABASE_URL?.trim() || undefined);
  await store.initialize();
  try {
    const metrics = calculatePilotMetrics(await store.loadLedgers());
    process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
  } finally {
    await store.close?.();
  }
}

async function doctor(): Promise<void> {
  const checks: Array<{ check: string; status: "pass" | "warn"; detail: string }> = [];
  if (parseBoolean(process.env.REPOSITORY_STEWARD_MUTATIONS_ENABLED, false)) {
    throw new Error("Source-repository mutations must remain disabled until the pilot gate is explicitly approved.");
  }
  checks.push({ check: "mutation gate", status: "pass", detail: "disabled" });

  const inventoryPath = process.env.REPOSITORY_STEWARD_INVENTORY_PATH ?? "examples/hrwatts/repositories.json";
  const inventory = await loadRepositoryInventory(inventoryPath);
  checks.push({ check: "inventory", status: "pass", detail: `${inventory.length} repositories` });

  const store = createAuditStore(process.env.DATABASE_URL?.trim() || undefined);
  await store.initialize();
  await store.close?.();
  checks.push({ check: "audit store", status: "pass", detail: "initialized" });

  const appFields = [
    process.env.GITHUB_APP_ID,
    process.env.GITHUB_PRIVATE_KEY,
    process.env.GITHUB_INSTALLATION_ID,
  ];
  const hasCompleteAppAuth = appFields.every((value) => Boolean(value?.trim()));
  const hasPartialAppAuth = appFields.some((value) => Boolean(value?.trim())) && !hasCompleteAppAuth;
  if (hasPartialAppAuth) {
    throw new Error("GitHub App authentication is incomplete; set all three app credential variables.");
  }

  const allowAnonymous = parseBoolean(
    process.env.REPOSITORY_STEWARD_ALLOW_ANONYMOUS_READ_FALLBACK,
    false,
  );
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!hasCompleteAppAuth && !token && !allowAnonymous) {
    throw new Error("Configure GitHub App credentials, GITHUB_TOKEN, or explicit anonymous read fallback.");
  }

  const client = new OctokitGithubClient({
    ...(token ? { token } : {}),
    ...(hasCompleteAppAuth
      ? {
          appId: process.env.GITHUB_APP_ID!,
          privateKey: process.env.GITHUB_PRIVATE_KEY!,
          installationId: process.env.GITHUB_INSTALLATION_ID!,
        }
      : {}),
    allowAnonymousReadFallback: allowAnonymous,
  });
  const [owner, repo] = inventory[0]?.name.split("/") ?? [];
  if (owner && repo) {
    await client.getRepository(owner, repo);
    checks.push({ check: "GitHub read", status: "pass", detail: inventory[0]?.name ?? "repository" });
  }

  const dashboardConfigured = Boolean(
    process.env.DASHBOARD_ISSUE_REPO && process.env.DASHBOARD_ISSUE_NUMBER,
  );
  checks.push({
    check: "dashboard",
    status: dashboardConfigured ? "pass" : "warn",
    detail: dashboardConfigured ? "configured" : "scan-only mode",
  });

  for (const check of checks) {
    process.stdout.write(`${check.status.toUpperCase()} ${check.check}: ${check.detail}\n`);
  }
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  return value === undefined ? fallback : ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`ERROR ${message}\n`);
    process.exitCode = 1;
  });
}
