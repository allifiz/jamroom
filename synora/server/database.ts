import "server-only";
import { createClient, type Client, type Transaction } from "@libsql/client";
import type { SqlExecutor, SqlValue, SynoraStore } from "../core/store";

let client: Client | undefined;

function database(): Client {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is required for Synora v2");
  if (!/^(file:|libsql:|https:|wss:)/.test(url)) throw new Error("Unsupported database URL");
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url.startsWith("file:") && !authToken) throw new Error("TURSO_AUTH_TOKEN is required");
  client = createClient({ url, authToken });
  return client;
}

function executor(db: Client | Transaction): SqlExecutor {
  return {
    async query<T>(sql: string, args: SqlValue[] = []) {
      const result = await db.execute({ sql, args });
      return result.rows as T[];
    },
    async execute(sql: string, args: SqlValue[] = []) {
      const result = await db.execute({ sql, args });
      return result.rowsAffected;
    },
  };
}

export function synoraStore(): SynoraStore {
  const db = database();
  return {
    ...executor(db),
    async write<T>(callback: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      const transaction = await db.transaction("write");
      try {
        const result = await callback(executor(transaction));
        await transaction.commit();
        return result;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    },
  };
}
