import { ensureConnected } from "./client";

async function main() {
  try {
    const client = await ensureConnected();

    const res = await client.query("SELECT current_user, current_database();");
    const row = res.rows[0];

    console.log("DB connection OK ✅");
    console.log("user:", row.current_user);
    console.log("db:  ", row.current_database);
  } catch (err) {
    console.error("DB connection FAILED ❌");
    console.error(err);
    process.exitCode = 1;
  }
}

await main();
