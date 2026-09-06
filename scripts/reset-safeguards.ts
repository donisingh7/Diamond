export function assertDevelopmentReset(nodeEnv: string | undefined, databaseName: string, args: string[]) {
  if (nodeEnv !== "development") throw new Error("Reset requires NODE_ENV=development.");
  if (!/^diamond_dev(?:_[a-z0-9]+)*$/.test(databaseName)) throw new Error("Reset requires an explicit diamond_dev or diamond_dev_* database.");
  if (args.length !== 2 || args[0] !== "--confirm" || args[1] !== databaseName) throw new Error("Reset requires --confirm <exact-database-name>.");
}
