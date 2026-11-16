// Infrastructure-independent transaction contract. Production adapter must use
// a real libSQL write transaction (not independent HTTP requests).
export type SqlValue = string | number | null;
export interface SqlExecutor {
  query<T>(sql: string, args?: SqlValue[]): Promise<T[]>;
  execute(sql: string, args?: SqlValue[]): Promise<number>;
}
export interface SynoraStore extends SqlExecutor {
  write<T>(callback: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}
