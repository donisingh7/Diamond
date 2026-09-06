import { getSeedAdminEnv } from "../src/lib/config/env";
import { requireTransactions } from "../src/lib/db/connection";
import { ensureIndexes } from "../src/lib/db/models";
import { seedFoundation } from "../src/modules/settings/services/seed-foundation";
import { createInitialAdmin } from "../src/modules/users/services/create-admin";
import { runScript } from "./runtime";

void runScript(async () => {
  const env = getSeedAdminEnv();
  await requireTransactions();
  await ensureIndexes();
  await seedFoundation();
  const admin = await createInitialAdmin(env.SEED_ADMIN_LOGIN_ID, env.SEED_ADMIN_PASSWORD);
  console.log(`Foundation seeded: six market defaults and platform settings ensured; admin ${admin.created ? "created" : "preserved"}.`);
});
