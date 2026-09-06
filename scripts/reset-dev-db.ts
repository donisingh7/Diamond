import { connectDatabase } from "../src/lib/db/connection";
import { models } from "../src/lib/db/models";
import { assertDevelopmentReset } from "./reset-safeguards";
import { runScript } from "./runtime";

void runScript(async () => {
  if (process.env.NODE_ENV !== "development") throw new Error("Development mode must be explicitly enabled.");
  const db = await connectDatabase();
  assertDevelopmentReset(process.env.NODE_ENV, db.connection.name, process.argv.slice(2));
  for (const model of models) await model.deleteMany({});
  console.log("Development application data cleared. Run db:seed to initialize again.");
});
