import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/** Creates a Drizzle client for the given Postgres connection string. */
export function createDb(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 5 });
  const db = drizzle(sql, { schema });
  return { db, close: () => sql.end() };
}

export type Db = ReturnType<typeof createDb>["db"];
