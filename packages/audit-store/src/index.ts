import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import Database from "better-sqlite3";
import { Pool } from "pg";

import {
  dashboardSyncPayloadSchema,
  findingLedgerSchema,
  findingObservationSchema,
  inspectionRunSchema,
  syncMetadataSchema,
  validationCertificateSchema,
  type DashboardSyncPayload,
  type FindingLedger,
  type FindingObservation,
  type InspectionRun,
  type SyncMetadata,
  type ValidationCertificate,
} from "../../shared-types/src/index.js";

export interface InspectionBundle {
  run: InspectionRun;
  observations: FindingObservation[];
  certificates: Array<{
    inspectionId: string;
    findingKey: string;
    hash: string;
    certificate: ValidationCertificate;
  }>;
  syncMetadata?: SyncMetadata;
}

export interface RepositorySnapshotManifest {
  schema_version: 1;
  repository: string;
  head_sha: string | null;
  default_branch: string;
  collected_at: string;
  files: Array<{
    path: string;
    state: "present" | "absent";
    sha256: string | null;
    bytes: number | null;
  }>;
}

export interface AdditionalRunArtifact {
  relativePath: string;
  content: string;
}

type PoolClientLike = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
  release: () => void;
};

export interface AuditStore {
  initialize(): Promise<void>;
  recordInspectionBundle(bundle: InspectionBundle): Promise<void>;
  recentlySeenFinding(repository: string, findingKey: string, windowDays: number): Promise<boolean>;
  loadInspection(runId: string): Promise<InspectionRun>;
  loadObservationsForRun(runId: string): Promise<FindingObservation[]>;
  loadLedgers(): Promise<FindingLedger[]>;
  replaceLedgers(ledgers: FindingLedger[]): Promise<void>;
  loadSyncMetadata(runId: string): Promise<SyncMetadata | null>;
  saveSyncMetadata(metadata: SyncMetadata): Promise<void>;
  listPendingSyncRunIds(): Promise<string[]>;
  listInspectionHistory(limit: number): Promise<
    Array<{
      runId: string;
      completedAt: string;
      findingCount: number;
      dryRun: boolean;
      artifactRunUrl: string | null;
    }>
  >;
  close?(): Promise<void>;
}

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  dry_run INTEGER NOT NULL,
  finding_count INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS finding_observations (
  run_id TEXT NOT NULL,
  finding_key TEXT NOT NULL,
  repository TEXT NOT NULL,
  detector_id TEXT NOT NULL,
  detector_version TEXT NOT NULL,
  risk_class TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  notification_suppressed INTEGER NOT NULL,
  artifact_run_url TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (run_id, finding_key)
);

CREATE TABLE IF NOT EXISTS finding_ledgers (
  finding_key TEXT PRIMARY KEY,
  repository TEXT NOT NULL,
  detector_id TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL,
  last_successful_sync_run TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS certificates (
  inspection_id TEXT NOT NULL,
  finding_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (inspection_id, finding_key)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  run_id TEXT PRIMARY KEY,
  sync_state TEXT NOT NULL,
  sync_attempt_id TEXT NOT NULL,
  issue_repository TEXT,
  issue_number INTEGER,
  prior_body_digest TEXT,
  desired_body_digest TEXT,
  confirmed_body_digest TEXT,
  issue_updated_at TEXT,
  github_response_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES (1, CURRENT_TIMESTAMP);
`;

type SqlPrimitive = string | number | null;

function parseJson<T>(schema: { parse(value: unknown): T }, payload: string): T {
  return schema.parse(JSON.parse(payload) as unknown);
}

export class SqliteAuditStore implements AuditStore {
  private readonly database: any;

  public constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.database = new Database(filePath);
  }

  public async initialize(): Promise<void> {
    this.database.exec(SQLITE_SCHEMA);
    this.database.pragma("journal_mode = WAL");
  }

  public async close(): Promise<void> {
    this.database.close();
  }

  public async recordInspectionBundle(bundle: InspectionBundle): Promise<void> {
    const run = inspectionRunSchema.parse(bundle.run);
    const observations = bundle.observations.map((item) => findingObservationSchema.parse(item));
    const certificates = bundle.certificates.map((item) => ({
      inspectionId: item.inspectionId,
      findingKey: item.findingKey,
      hash: item.hash,
      certificate: validationCertificateSchema.parse(item.certificate),
    }));
    const syncMetadata = bundle.syncMetadata ? syncMetadataSchema.parse(bundle.syncMetadata) : undefined;

    const insertInspection = this.database.prepare(
      `INSERT OR REPLACE INTO inspections (
        id, started_at, completed_at, dry_run, finding_count, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertObservation = this.database.prepare(
      `INSERT OR REPLACE INTO finding_observations (
        run_id, finding_key, repository, detector_id, detector_version, risk_class, observed_at,
        notification_suppressed, artifact_run_url, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertCertificate = this.database.prepare(
      `INSERT OR REPLACE INTO certificates (
        inspection_id, finding_key, sha256, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    );
    const insertSync = this.database.prepare(
      `INSERT OR REPLACE INTO sync_runs (
        run_id, sync_state, sync_attempt_id, issue_repository, issue_number, prior_body_digest,
        desired_body_digest, confirmed_body_digest, issue_updated_at, github_response_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const transaction = this.database.transaction(() => {
      insertInspection.run(
        run.id,
        run.startedAt,
        run.completedAt,
        run.dryRun ? 1 : 0,
        run.findings.length,
        JSON.stringify(run),
      );

      for (const observation of observations) {
        insertObservation.run(
          observation.run_id,
          observation.finding_key,
          observation.repository,
          observation.detector_id,
          observation.detector_version,
          observation.risk_class,
          observation.observed_at,
          observation.notification_suppressed ? 1 : 0,
          observation.artifact_run_url,
          JSON.stringify(observation),
        );
      }

      for (const certificate of certificates) {
        insertCertificate.run(
          certificate.inspectionId,
          certificate.findingKey,
          certificate.hash,
          JSON.stringify(certificate.certificate),
          new Date().toISOString(),
        );
      }

      if (syncMetadata) {
        insertSync.run(
          syncMetadata.run_id,
          syncMetadata.sync_state,
          syncMetadata.sync_attempt_id,
          syncMetadata.issue_repository,
          syncMetadata.issue_number,
          syncMetadata.prior_body_digest,
          syncMetadata.desired_body_digest,
          syncMetadata.confirmed_body_digest,
          syncMetadata.issue_updated_at,
          JSON.stringify(syncMetadata.github_response_metadata),
          new Date().toISOString(),
        );
      }
    });

    transaction();
  }

  public async recentlySeenFinding(
    repository: string,
    findingKey: string,
    windowDays: number,
  ): Promise<boolean> {
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const row = this.database
      .prepare(
        `SELECT COUNT(*) as count
         FROM finding_observations
         WHERE repository = ?
           AND finding_key = ?
           AND observed_at >= ?`,
      )
      .get(repository, findingKey, cutoff) as { count?: number } | undefined;

    return Number(row?.count ?? 0) > 0;
  }

  public async loadInspection(runId: string): Promise<InspectionRun> {
    const row = this.database
      .prepare(`SELECT payload_json FROM inspections WHERE id = ?`)
      .get(runId) as { payload_json?: string } | undefined;

    if (!row?.payload_json) {
      throw new Error(`Inspection run not found: ${runId}`);
    }

    return parseJson(inspectionRunSchema, row.payload_json);
  }

  public async loadObservationsForRun(runId: string): Promise<FindingObservation[]> {
    const rows = this.database
      .prepare(`SELECT payload_json FROM finding_observations WHERE run_id = ? ORDER BY observed_at, finding_key`)
      .all(runId) as Array<{ payload_json: string }>;

    return rows.map((row) => parseJson(findingObservationSchema, row.payload_json));
  }

  public async loadLedgers(): Promise<FindingLedger[]> {
    const rows = this.database
      .prepare(`SELECT payload_json FROM finding_ledgers ORDER BY repository, detector_id, finding_key`)
      .all() as Array<{ payload_json: string }>;

    return rows.map((row) => parseJson(findingLedgerSchema, row.payload_json));
  }

  public async replaceLedgers(ledgers: FindingLedger[]): Promise<void> {
    const parsed = ledgers.map((item) => findingLedgerSchema.parse(item));
    const upsert = this.database.prepare(
      `INSERT OR REPLACE INTO finding_ledgers (
        finding_key, repository, detector_id, lifecycle_state, last_successful_sync_run, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );

    const transaction = this.database.transaction(() => {
      for (const ledger of parsed) {
        upsert.run(
          ledger.finding_key,
          ledger.repository,
          ledger.detector_id,
          ledger.lifecycle_state,
          ledger.last_successful_sync_run,
          JSON.stringify(ledger),
        );
      }
    });

    transaction();
  }

  public async loadSyncMetadata(runId: string): Promise<SyncMetadata | null> {
    const row = this.database
      .prepare(`SELECT * FROM sync_runs WHERE run_id = ?`)
      .get(runId) as Record<string, SqlPrimitive> | undefined;

    if (!row) {
      return null;
    }

    return syncMetadataSchema.parse({
      run_id: row.run_id,
      sync_attempt_id: row.sync_attempt_id,
      sync_state: row.sync_state,
      issue_repository: row.issue_repository,
      issue_number: row.issue_number,
      prior_body_digest: row.prior_body_digest,
      desired_body_digest: row.desired_body_digest,
      confirmed_body_digest: row.confirmed_body_digest,
      issue_updated_at: row.issue_updated_at,
      github_response_metadata: row.github_response_json ? JSON.parse(String(row.github_response_json)) : {},
    });
  }

  public async saveSyncMetadata(metadata: SyncMetadata): Promise<void> {
    const parsed = syncMetadataSchema.parse(metadata);
    this.database
      .prepare(
        `INSERT OR REPLACE INTO sync_runs (
          run_id, sync_state, sync_attempt_id, issue_repository, issue_number, prior_body_digest,
          desired_body_digest, confirmed_body_digest, issue_updated_at, github_response_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.run_id,
        parsed.sync_state,
        parsed.sync_attempt_id,
        parsed.issue_repository,
        parsed.issue_number,
        parsed.prior_body_digest,
        parsed.desired_body_digest,
        parsed.confirmed_body_digest,
        parsed.issue_updated_at,
        JSON.stringify(parsed.github_response_metadata),
        new Date().toISOString(),
      );
  }

  public async listPendingSyncRunIds(): Promise<string[]> {
    const rows = this.database
      .prepare(
        `SELECT run_id
         FROM sync_runs
         WHERE sync_state != 'synced'
         ORDER BY updated_at ASC, run_id ASC`,
      )
      .all() as Array<{ run_id: string }>;

    return rows.map((row) => row.run_id);
  }

  public async listInspectionHistory(limit: number): Promise<
    Array<{
      runId: string;
      completedAt: string;
      findingCount: number;
      dryRun: boolean;
      artifactRunUrl: string | null;
    }>
  > {
    const rows = this.database
      .prepare(
        `SELECT inspections.id, inspections.completed_at, inspections.finding_count, inspections.dry_run,
                MIN(finding_observations.artifact_run_url) AS artifact_run_url
         FROM inspections
         LEFT JOIN finding_observations ON finding_observations.run_id = inspections.id
         GROUP BY inspections.id, inspections.completed_at, inspections.finding_count, inspections.dry_run
         ORDER BY inspections.completed_at DESC
         LIMIT ?`,
      )
      .all(limit) as Array<Record<string, SqlPrimitive>>;

    return rows.map((row) => ({
      runId: String(row.id),
      completedAt: String(row.completed_at),
      findingCount: Number(row.finding_count ?? 0),
      dryRun: Number(row.dry_run ?? 0) === 1,
      artifactRunUrl: row.artifact_run_url ? String(row.artifact_run_url) : null,
    }));
  }
}

export class PostgresAuditStore implements AuditStore {
  private readonly pool: Pool;

  public constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  public async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS inspections (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        dry_run BOOLEAN NOT NULL,
        finding_count INTEGER NOT NULL,
        payload_json JSONB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS finding_observations (
        run_id TEXT NOT NULL,
        finding_key TEXT NOT NULL,
        repository TEXT NOT NULL,
        detector_id TEXT NOT NULL,
        detector_version TEXT NOT NULL,
        risk_class TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        notification_suppressed BOOLEAN NOT NULL,
        artifact_run_url TEXT,
        payload_json JSONB NOT NULL,
        PRIMARY KEY (run_id, finding_key)
      );

      CREATE TABLE IF NOT EXISTS finding_ledgers (
        finding_key TEXT PRIMARY KEY,
        repository TEXT NOT NULL,
        detector_id TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL,
        last_successful_sync_run TEXT,
        payload_json JSONB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS certificates (
        inspection_id TEXT NOT NULL,
        finding_key TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        payload_json JSONB NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (inspection_id, finding_key)
      );

      CREATE TABLE IF NOT EXISTS sync_runs (
        run_id TEXT PRIMARY KEY,
        sync_state TEXT NOT NULL,
        sync_attempt_id TEXT NOT NULL,
        issue_repository TEXT,
        issue_number INTEGER,
        prior_body_digest TEXT,
        desired_body_digest TEXT,
        confirmed_body_digest TEXT,
        issue_updated_at TEXT,
        github_response_json JSONB NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      INSERT INTO schema_migrations (version, applied_at)
      VALUES (1, CURRENT_TIMESTAMP)
      ON CONFLICT (version) DO NOTHING;
    `);
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  public async recordInspectionBundle(bundle: InspectionBundle): Promise<void> {
    const run = inspectionRunSchema.parse(bundle.run);
    const observations = bundle.observations.map((item) => findingObservationSchema.parse(item));
    const certificates = bundle.certificates.map((item) => ({
      inspectionId: item.inspectionId,
      findingKey: item.findingKey,
      hash: item.hash,
      certificate: validationCertificateSchema.parse(item.certificate),
    }));
    const syncMetadata = bundle.syncMetadata ? syncMetadataSchema.parse(bundle.syncMetadata) : undefined;
    const client = await (this.pool as Pool & { connect(): Promise<PoolClientLike> }).connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO inspections (id, started_at, completed_at, dry_run, finding_count, payload_json)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           started_at = EXCLUDED.started_at,
           completed_at = EXCLUDED.completed_at,
           dry_run = EXCLUDED.dry_run,
           finding_count = EXCLUDED.finding_count,
           payload_json = EXCLUDED.payload_json`,
        [run.id, run.startedAt, run.completedAt, run.dryRun, run.findings.length, JSON.stringify(run)],
      );

      for (const observation of observations) {
        await client.query(
          `INSERT INTO finding_observations (
            run_id, finding_key, repository, detector_id, detector_version, risk_class, observed_at,
            notification_suppressed, artifact_run_url, payload_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
          ON CONFLICT (run_id, finding_key) DO UPDATE SET
            repository = EXCLUDED.repository,
            detector_id = EXCLUDED.detector_id,
            detector_version = EXCLUDED.detector_version,
            risk_class = EXCLUDED.risk_class,
            observed_at = EXCLUDED.observed_at,
            notification_suppressed = EXCLUDED.notification_suppressed,
            artifact_run_url = EXCLUDED.artifact_run_url,
            payload_json = EXCLUDED.payload_json`,
          [
            observation.run_id,
            observation.finding_key,
            observation.repository,
            observation.detector_id,
            observation.detector_version,
            observation.risk_class,
            observation.observed_at,
            observation.notification_suppressed,
            observation.artifact_run_url,
            JSON.stringify(observation),
          ],
        );
      }

      for (const certificate of certificates) {
        await client.query(
          `INSERT INTO certificates (
            inspection_id, finding_key, sha256, payload_json, created_at
          ) VALUES ($1, $2, $3, $4::jsonb, $5)
          ON CONFLICT (inspection_id, finding_key) DO UPDATE SET
            sha256 = EXCLUDED.sha256,
            payload_json = EXCLUDED.payload_json,
            created_at = EXCLUDED.created_at`,
          [
            certificate.inspectionId,
            certificate.findingKey,
            certificate.hash,
            JSON.stringify(certificate.certificate),
            new Date().toISOString(),
          ],
        );
      }

      if (syncMetadata) {
        await client.query(
          `INSERT INTO sync_runs (
            run_id, sync_state, sync_attempt_id, issue_repository, issue_number, prior_body_digest,
            desired_body_digest, confirmed_body_digest, issue_updated_at, github_response_json, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
          ON CONFLICT (run_id) DO UPDATE SET
            sync_state = EXCLUDED.sync_state,
            sync_attempt_id = EXCLUDED.sync_attempt_id,
            issue_repository = EXCLUDED.issue_repository,
            issue_number = EXCLUDED.issue_number,
            prior_body_digest = EXCLUDED.prior_body_digest,
            desired_body_digest = EXCLUDED.desired_body_digest,
            confirmed_body_digest = EXCLUDED.confirmed_body_digest,
            issue_updated_at = EXCLUDED.issue_updated_at,
            github_response_json = EXCLUDED.github_response_json,
            updated_at = EXCLUDED.updated_at`,
          [
            syncMetadata.run_id,
            syncMetadata.sync_state,
            syncMetadata.sync_attempt_id,
            syncMetadata.issue_repository,
            syncMetadata.issue_number,
            syncMetadata.prior_body_digest,
            syncMetadata.desired_body_digest,
            syncMetadata.confirmed_body_digest,
            syncMetadata.issue_updated_at,
            JSON.stringify(syncMetadata.github_response_metadata),
            new Date().toISOString(),
          ],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async recentlySeenFinding(
    repository: string,
    findingKey: string,
    windowDays: number,
  ): Promise<boolean> {
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM finding_observations
       WHERE repository = $1
         AND finding_key = $2
         AND observed_at >= $3`,
      [repository, findingKey, cutoff],
    );

    return Number(result.rows[0]?.count ?? 0) > 0;
  }

  public async loadInspection(runId: string): Promise<InspectionRun> {
    const result = await this.pool.query<{ payload_json: InspectionRun }>(
      `SELECT payload_json FROM inspections WHERE id = $1`,
      [runId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`Inspection run not found: ${runId}`);
    }

    return inspectionRunSchema.parse(row.payload_json);
  }

  public async loadObservationsForRun(runId: string): Promise<FindingObservation[]> {
    const result = await this.pool.query<{ payload_json: FindingObservation }>(
      `SELECT payload_json
       FROM finding_observations
       WHERE run_id = $1
       ORDER BY observed_at, finding_key`,
      [runId],
    );

    return result.rows.map((row) => findingObservationSchema.parse(row.payload_json));
  }

  public async loadLedgers(): Promise<FindingLedger[]> {
    const result = await this.pool.query<{ payload_json: FindingLedger }>(
      `SELECT payload_json FROM finding_ledgers ORDER BY repository, detector_id, finding_key`,
    );

    return result.rows.map((row) => findingLedgerSchema.parse(row.payload_json));
  }

  public async replaceLedgers(ledgers: FindingLedger[]): Promise<void> {
    const parsed = ledgers.map((item) => findingLedgerSchema.parse(item));
    const client = await (this.pool as Pool & { connect(): Promise<PoolClientLike> }).connect();

    try {
      await client.query("BEGIN");
      for (const ledger of parsed) {
        await client.query(
          `INSERT INTO finding_ledgers (
            finding_key, repository, detector_id, lifecycle_state, last_successful_sync_run, payload_json
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
          ON CONFLICT (finding_key) DO UPDATE SET
            repository = EXCLUDED.repository,
            detector_id = EXCLUDED.detector_id,
            lifecycle_state = EXCLUDED.lifecycle_state,
            last_successful_sync_run = EXCLUDED.last_successful_sync_run,
            payload_json = EXCLUDED.payload_json`,
          [
            ledger.finding_key,
            ledger.repository,
            ledger.detector_id,
            ledger.lifecycle_state,
            ledger.last_successful_sync_run,
            JSON.stringify(ledger),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async loadSyncMetadata(runId: string): Promise<SyncMetadata | null> {
    const result = await this.pool.query<{
      run_id: string;
      sync_state: SyncMetadata["sync_state"];
      sync_attempt_id: string;
      issue_repository: string | null;
      issue_number: number | null;
      prior_body_digest: string | null;
      desired_body_digest: string | null;
      confirmed_body_digest: string | null;
      issue_updated_at: string | null;
      github_response_json: Record<string, unknown>;
    }>(
      `SELECT * FROM sync_runs WHERE run_id = $1`,
      [runId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return syncMetadataSchema.parse({
      run_id: row.run_id,
      sync_state: row.sync_state,
      sync_attempt_id: row.sync_attempt_id,
      issue_repository: row.issue_repository,
      issue_number: row.issue_number,
      prior_body_digest: row.prior_body_digest,
      desired_body_digest: row.desired_body_digest,
      confirmed_body_digest: row.confirmed_body_digest,
      issue_updated_at: row.issue_updated_at,
      github_response_metadata: row.github_response_json ?? {},
    });
  }

  public async saveSyncMetadata(metadata: SyncMetadata): Promise<void> {
    const parsed = syncMetadataSchema.parse(metadata);
    await this.pool.query(
      `INSERT INTO sync_runs (
        run_id, sync_state, sync_attempt_id, issue_repository, issue_number, prior_body_digest,
        desired_body_digest, confirmed_body_digest, issue_updated_at, github_response_json, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
      ON CONFLICT (run_id) DO UPDATE SET
        sync_state = EXCLUDED.sync_state,
        sync_attempt_id = EXCLUDED.sync_attempt_id,
        issue_repository = EXCLUDED.issue_repository,
        issue_number = EXCLUDED.issue_number,
        prior_body_digest = EXCLUDED.prior_body_digest,
        desired_body_digest = EXCLUDED.desired_body_digest,
        confirmed_body_digest = EXCLUDED.confirmed_body_digest,
        issue_updated_at = EXCLUDED.issue_updated_at,
        github_response_json = EXCLUDED.github_response_json,
        updated_at = EXCLUDED.updated_at`,
      [
        parsed.run_id,
        parsed.sync_state,
        parsed.sync_attempt_id,
        parsed.issue_repository,
        parsed.issue_number,
        parsed.prior_body_digest,
        parsed.desired_body_digest,
        parsed.confirmed_body_digest,
        parsed.issue_updated_at,
        JSON.stringify(parsed.github_response_metadata),
        new Date().toISOString(),
      ],
    );
  }

  public async listPendingSyncRunIds(): Promise<string[]> {
    const result = await this.pool.query<{ run_id: string }>(
      `SELECT run_id
       FROM sync_runs
       WHERE sync_state != 'synced'
       ORDER BY updated_at ASC, run_id ASC`,
    );

    return result.rows.map((row) => row.run_id);
  }

  public async listInspectionHistory(limit: number): Promise<
    Array<{
      runId: string;
      completedAt: string;
      findingCount: number;
      dryRun: boolean;
      artifactRunUrl: string | null;
    }>
  > {
    const result = await this.pool.query<{
      id: string;
      completed_at: string;
      finding_count: number;
      dry_run: boolean;
      artifact_run_url: string | null;
    }>(
      `SELECT inspections.id,
              inspections.completed_at,
              inspections.finding_count,
              inspections.dry_run,
              MIN(finding_observations.artifact_run_url) AS artifact_run_url
       FROM inspections
       LEFT JOIN finding_observations ON finding_observations.run_id = inspections.id
       GROUP BY inspections.id, inspections.completed_at, inspections.finding_count, inspections.dry_run
       ORDER BY inspections.completed_at DESC
       LIMIT $1`,
      [limit],
    );

    return result.rows.map((row) => ({
      runId: row.id,
      completedAt: row.completed_at,
      findingCount: row.finding_count,
      dryRun: row.dry_run,
      artifactRunUrl: row.artifact_run_url,
    }));
  }
}

export function createAuditStore(databaseUrl?: string): AuditStore {
  if (!databaseUrl || databaseUrl.startsWith("sqlite://")) {
    const filePath = databaseUrl?.replace(/^sqlite:\/\//, "") || ".data/repository-steward.db";
    return new SqliteAuditStore(filePath);
  }

  if (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
    return new PostgresAuditStore(databaseUrl);
  }

  throw new Error(`Unsupported DATABASE_URL scheme: ${databaseUrl}`);
}

export async function writeRunArtifacts(
  outputDirectory: string,
  payload: DashboardSyncPayload,
  summaryMarkdown: string,
  certificates: InspectionBundle["certificates"] = [],
  snapshots: RepositorySnapshotManifest[] = [],
  additionalArtifacts: AdditionalRunArtifact[] = [],
): Promise<void> {
  const parsed = dashboardSyncPayloadSchema.parse(payload);
  mkdirSync(outputDirectory, { recursive: true });
  mkdirSync(join(outputDirectory, "findings"), { recursive: true });
  mkdirSync(join(outputDirectory, "certificates"), { recursive: true });
  mkdirSync(join(outputDirectory, "snapshots"), { recursive: true });
  const manifestEntries: Array<{ path: string; sha256: string; bytes: number }> = [];

  const writeArtifact = async (relativePath: string, content: string): Promise<void> => {
    const absolutePath = join(outputDirectory, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
    manifestEntries.push({
      path: relativePath.replace(/\\/g, "/"),
      sha256: createHash("sha256").update(content).digest("hex"),
      bytes: Buffer.byteLength(content),
    });
  };

  await writeArtifact("run.json", JSON.stringify(parsed.run, null, 2));
  await writeArtifact("coverage.json", JSON.stringify(parsed.coverage, null, 2));
  await writeArtifact("summary.md", summaryMarkdown);

  for (const observation of parsed.observations) {
    await writeArtifact(observation.artifact_relative_path, JSON.stringify(observation, null, 2));
  }

  for (const item of certificates) {
    const certificate = validationCertificateSchema.parse(item.certificate);
    const safeKey = item.findingKey.replace(/[^A-Za-z0-9._-]+/g, "-");
    await writeArtifact(
      `certificates/${safeKey}.json`,
      JSON.stringify({ sha256: item.hash, certificate }, null, 2),
    );
  }

  for (const snapshot of snapshots) {
    const safeRepository = snapshot.repository.replace(/[^A-Za-z0-9._-]+/g, "-");
    await writeArtifact(`snapshots/${safeRepository}.json`, JSON.stringify(snapshot, null, 2));
  }

  for (const artifact of additionalArtifacts) {
    await writeArtifact(artifact.relativePath, artifact.content);
  }

  await writeFile(
    join(outputDirectory, "artifact-manifest.json"),
    JSON.stringify(
      {
        schema_version: 1,
        inspection_id: parsed.run.id,
        files: manifestEntries.sort((left, right) => left.path.localeCompare(right.path)),
      },
      null,
      2,
    ),
  );
}
