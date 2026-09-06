import { requireTransactions, withTransaction } from "../src/lib/db/connection";
import { PlatformSettings } from "../src/modules/settings/models/platform-settings.model";
import { runScript } from "./runtime";

void runScript(async () => {
  await requireTransactions();
  await withTransaction(async (session) => {
    await PlatformSettings.findOne({ key: "platform" }).session(session).lean();
  });
  console.log("Mongoose connected; transaction-capable topology and transactional read verified.");
});
