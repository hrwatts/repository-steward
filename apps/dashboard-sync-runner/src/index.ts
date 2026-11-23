import { createAuditStore } from "../../../packages/audit-store/src/index.js";
import { OctokitGithubClient } from "../../../packages/github-client/src/index.js";
import { syncDashboardIssue } from "../../../packages/notification-service/src/index.js";

type Environment = {
  databaseUrl: string | undefined;
  dashboardIssueRepo: string;
  dashboardIssueNumber: number;
  githubToken: string | undefined;
  githubAppId: string | undefined;
  githubPrivateKey: string | undefined;
  githubInstallationId: string | undefined;
  syncRunId: string | undefined;
  allowAnonymousReadFallback: boolean;
};

export async function runDashboardSync(): Promise<void> {
  const env = readEnvironment();
  const store = createAuditStore(env.databaseUrl);
  await store.initialize();
  try {
  const client = new OctokitGithubClient({
    ...(env.githubToken ? { token: env.githubToken } : {}),
    ...(env.githubAppId ? { appId: env.githubAppId } : {}),
    ...(env.githubPrivateKey ? { privateKey: env.githubPrivateKey } : {}),
    ...(env.githubInstallationId ? { installationId: env.githubInstallationId } : {}),
    allowAnonymousReadFallback: env.allowAnonymousReadFallback,
  });

  await syncDashboardIssue(
    client,
    store,
    {
      repository: env.dashboardIssueRepo,
      issueNumber: env.dashboardIssueNumber,
    },
    env.syncRunId,
  );
  } finally {
    await store.close?.();
  }
}

function readEnvironment(): Environment {
  const dashboardIssueRepo = normalizeRequired(process.env.DASHBOARD_ISSUE_REPO, "DASHBOARD_ISSUE_REPO");
  const dashboardIssueNumber = Number(
    normalizeRequired(process.env.DASHBOARD_ISSUE_NUMBER, "DASHBOARD_ISSUE_NUMBER"),
  );
  if (!Number.isInteger(dashboardIssueNumber) || dashboardIssueNumber <= 0) {
    throw new Error("DASHBOARD_ISSUE_NUMBER must be a positive integer.");
  }

  return {
    databaseUrl: normalizeOptional(process.env.DATABASE_URL),
    dashboardIssueRepo,
    dashboardIssueNumber,
    githubToken: normalizeOptional(process.env.GITHUB_TOKEN),
    githubAppId: normalizeOptional(process.env.GITHUB_APP_ID),
    githubPrivateKey: normalizeOptional(process.env.GITHUB_PRIVATE_KEY),
    githubInstallationId: normalizeOptional(process.env.GITHUB_INSTALLATION_ID),
    syncRunId: normalizeOptional(process.env.REPOSITORY_STEWARD_SYNC_RUN_ID),
    allowAnonymousReadFallback: parseBoolean(
      process.env.REPOSITORY_STEWARD_ALLOW_ANONYMOUS_READ_FALLBACK,
      false,
    ),
  };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function normalizeRequired(value: string | undefined, name: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new Error(`${name} is required.`);
  }
  return normalized;
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

async function main(): Promise<void> {
  await runDashboardSync();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
