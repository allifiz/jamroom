import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

const url = process.env.TURSO_DATABASE_URL;
if (!url?.startsWith("file:")) {
  throw new Error("Set TURSO_DATABASE_URL=file:./synora-dev.db for a fresh local database");
}
const db = createClient({ url });
try {
  await db.executeMultiple(readFileSync("synora/migrations/0001_initial.sql", "utf8"));
  console.log("Synora local database initialized");
} finally {
  db.close();
}
