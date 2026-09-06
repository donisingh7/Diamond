import { getSeedAdminEnv } from "../src/lib/config/env";
import { requireTransactions } from "../src/lib/db/connection";
import { User } from "../src/modules/users/models/user.model";
import { createInitialAdmin } from "../src/modules/users/services/create-admin";
import { runScript } from "./runtime";

void runScript(async () => {
  const env = getSeedAdminEnv();
  await requireTransactions();
  await User.createIndexes();
  const result = await createInitialAdmin(env.SEED_ADMIN_LOGIN_ID, env.SEED_ADMIN_PASSWORD);
  console.log(result.created ? "Admin created." : "Existing admin preserved; password and status unchanged.");
});
