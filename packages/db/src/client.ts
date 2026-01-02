import { Pool } from "pg";
import { DATABASE_URL } from "./env.js";

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
});

export async function query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }> {
  const res = await pool.query(text, params);
  return { rows: res.rows as T[] };
}
