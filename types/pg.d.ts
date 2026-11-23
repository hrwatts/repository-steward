declare module "pg" {
  export interface QueryResult<Row = Record<string, unknown>> {
    rows: Row[];
  }

  export interface PoolClient {
    query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>;
    release(): void;
  }

  export class Pool {
    public constructor(config: { connectionString: string });
    public query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>;
    public connect(): Promise<PoolClient>;
    public end(): Promise<void>;
  }
}
