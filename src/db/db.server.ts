import { DatabaseSync, type SQLInputValue, type StatementResultingChanges, type StatementSync } from "node:sqlite";

type Param = SQLInputValue | boolean | undefined;

export interface Statement<Row, Params extends Param[]> {
  all(...params: Params): Row[];
  get(...params: Params): Row | null;
  run(...params: Params): StatementResultingChanges;
}

/** SQLite binds neither booleans nor undefined; store them as 0/1 and NULL. */
const bind = (params: Param[]) => params.map((p) => (p === undefined ? null : typeof p === "boolean" ? Number(p) : p));

/** A thin layer over `node:sqlite` with cached statements and transactions. */
export class Database {
  readonly filename: string;
  private db: DatabaseSync;
  private cache = new Map<string, StatementSync>();
  private depth = 0;

  constructor(filename: string) {
    this.filename = filename;
    this.db = new DatabaseSync(filename);
  }

  exec(sql: string) {
    this.db.exec(sql);
  }

  /** A prepared statement, reused for the same SQL. */
  query<Row = Record<string, any>, Params extends Param[] = Param[]>(sql: string): Statement<Row, Params> {
    let stmt = this.cache.get(sql);
    if (!stmt) this.cache.set(sql, (stmt = this.db.prepare(sql)));
    const s = stmt;
    return {
      all: (...params) => s.all(...bind(params)) as Row[],
      get: (...params) => (s.get(...bind(params)) as Row | undefined) ?? null,
      run: (...params) => s.run(...bind(params)),
    };
  }

  /** Wrap `fn` so it runs in one transaction; nested calls join the outer one. */
  transaction<A extends unknown[], T>(fn: (...args: A) => T): (...args: A) => T {
    return (...args) => {
      if (this.depth > 0) return fn(...args);
      this.db.exec("BEGIN");
      this.depth++;
      try {
        const out = fn(...args);
        this.db.exec("COMMIT");
        return out;
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      } finally {
        this.depth--;
      }
    };
  }

  close() {
    this.cache.clear();
    this.db.close();
  }
}
