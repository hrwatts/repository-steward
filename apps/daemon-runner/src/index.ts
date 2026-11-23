import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Pool, type PoolClient } from "pg";
import pino from "pino";

import { runDashboardSync } from "../../dashboard-sync-runner/src/index.js";
import { runInspection } from "../../scheduler-runner/src/index.js";

const logger = pino({ name: "repository-steward-daemon" });
const schedulerLockName = "repository-steward:scheduler";

type DaemonState = {
  running: boolean;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastRunId: string | null;
  lastError: string | null;
};

export async function runDaemon(): Promise<void> {
  const intervalMinutes = positiveNumber(
    process.env.REPOSITORY_STEWARD_SCAN_INTERVAL_MINUTES,
    720,
  );
  const port = positiveInteger(process.env.HEALTH_PORT, 3001);
  const runOnce = parseBoolean(process.env.REPOSITORY_STEWARD_RUN_ONCE, false);
  const state: DaemonState = {
    running: false,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastRunId: null,
    lastError: null,
  };
  const shutdown = new AbortController();

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path !== "/healthz" && path !== "/readyz") {
      response.statusCode = 404;
      response.end("Not Found");
      return;
    }

    const ready = state.lastError === null || state.lastCompletedAt !== null;
    response.statusCode = path === "/readyz" && !ready ? 503 : 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ status: "ok", ...state }));
  });
  server.listen(port);
  logger.info({ port, intervalMinutes }, "scheduler daemon started");

  const stop = (): void => {
    shutdown.abort();
    server.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  do {
    await runCycle(state);
    if (!runOnce && !shutdown.signal.aborted) {
      await delay(intervalMinutes * 60_000, shutdown.signal);
    }
  } while (!runOnce && !shutdown.signal.aborted);

  server.close();
}

async function runCycle(state: DaemonState): Promise<void> {
  if (state.running) {
    return;
  }

  state.running = true;
  state.lastStartedAt = new Date().toISOString();
  let lock: { client: PoolClient; pool: Pool } | null = null;
  try {
    lock = await acquireSchedulerLock(process.env.DATABASE_URL);
    if (process.env.DATABASE_URL?.startsWith("postgres") && !lock) {
      logger.info("another scheduler owns the advisory lock; skipping cycle");
      return;
    }

    const run = await runInspection();
    state.lastRunId = run.id;
    if (process.env.DASHBOARD_ISSUE_REPO && process.env.DASHBOARD_ISSUE_NUMBER) {
      await runDashboardSync();
    }
    state.lastCompletedAt = new Date().toISOString();
    state.lastError = null;
    logger.info({ runId: run.id, findingCount: run.findings.length }, "inspection cycle completed");
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    logger.error({ err: error }, "inspection cycle failed");
  } finally {
    if (lock) {
      await lock.client.query("SELECT pg_advisory_unlock(hashtext($1))", [schedulerLockName]);
      lock.client.release();
      await lock.pool.end();
    }
    state.running = false;
  }
}

async function acquireSchedulerLock(databaseUrl: string | undefined): Promise<{
  client: PoolClient;
  pool: Pool;
} | null> {
  if (!databaseUrl?.startsWith("postgres")) {
    return null;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  const result = await client.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
    [schedulerLockName],
  );
  if (!result.rows[0]?.acquired) {
    client.release();
    await pool.end();
    return null;
  }
  return { client, pool };
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("REPOSITORY_STEWARD_SCAN_INTERVAL_MINUTES must be positive.");
  }
  return parsed;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("HEALTH_PORT must be a positive integer.");
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  return value === undefined ? fallback : ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    const timeout = setTimeout(resolveDelay, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolveDelay();
      },
      { once: true },
    );
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runDaemon().catch((error: unknown) => {
    logger.fatal({ err: error }, "scheduler daemon terminated");
    process.exitCode = 1;
  });
}
