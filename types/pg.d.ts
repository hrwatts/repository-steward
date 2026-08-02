declare module "pg" {
  export interface QueryResult<Row = Record<string, unknown>> {
    rows: Row[];
  }

  export class Pool {
    public constructor(config: { connectionString: string });
    public query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>;
    public end(): Promise<void>;
  }
}
