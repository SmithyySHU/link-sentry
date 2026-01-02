import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Missing DATABASE_URL in environment.");
  process.exit(1);
}

const pool = new Pool({ connectionString: url });

const result = await pool.query("SELECT current_user, current_database();");
console.log(result.rows[0]);

await pool.end();
