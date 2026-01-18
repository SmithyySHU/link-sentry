import crypto from "crypto";
import { closeConnection } from "./client";
import { createUser, getUserByEmail } from "./auth";
import { backfillSitesUserId } from "./sites";

const DEMO_USER_EMAIL = process.env.DEMO_USER_EMAIL || "demo@scanlark.local";

async function main() {
  let user = await getUserByEmail(DEMO_USER_EMAIL);
  if (!user) {
    const password = crypto.randomBytes(24).toString("base64url");
    user = await createUser(DEMO_USER_EMAIL, password);
  }
  const updated = await backfillSitesUserId(user.id);
  console.log(`Demo user: ${user.email} (${user.id})`);
  console.log(`Backfilled ${updated} site(s)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnection();
  });
