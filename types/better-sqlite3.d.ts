declare module "better-sqlite3" {
  type BindValue = string | number | boolean | null;

  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement {
    run(...params: BindValue[]): RunResult;
    get<T>(...params: BindValue[]): T | undefined;
    all<T>(...params: BindValue[]): T[];
    pluck(toggle?: boolean): Statement;
  }

  interface Database {
    exec(sql: string): this;
    pragma(sql: string): unknown;
    prepare(sql: string): Statement;
    close(): void;
  }

  interface DatabaseConstructor {
    new (filename: string): Database;
  }

  const Database: DatabaseConstructor;
  export default Database;
}
