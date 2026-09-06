import "server-only";
import mongoose, { type ClientSession } from "mongoose";
import dns from "node:dns";
import { getDatabaseEnv } from "../config/env";
import { SetupError } from "../errors/setup-error";

const globalDb = globalThis as typeof globalThis & { diamondMongoPromise?: Promise<typeof mongoose> };

export async function connectDatabase(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!globalDb.diamondMongoPromise) {
    const env = getDatabaseEnv();
    // Explicit opt-in only; never silently switch application DNS to a public resolver.
    if (env.MONGODB_DNS_SERVERS) dns.setServers(env.MONGODB_DNS_SERVERS);
    globalDb.diamondMongoPromise = mongoose.connect(env.MONGODB_URI, {
      bufferCommands: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 10_000,
    }).catch((error: unknown) => {
      globalDb.diamondMongoPromise = undefined;
      throw error;
    });
  }
  const connection = await globalDb.diamondMongoPromise;
  // Permit reconnect after an explicit disconnect in scripts/tests.
  globalDb.diamondMongoPromise = undefined;
  return connection;
}

export async function requireTransactions(): Promise<void> {
  const db = await connectDatabase();
  const hello = await db.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") {
    throw new SetupError("MongoDB connected, but transactions require Atlas or a local replica set; standalone MongoDB is unsupported.");
  }
}

/** Keep operations sequential inside this callback; callbacks may be retried. */
export async function withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  await requireTransactions();
  return mongoose.connection.transaction(work, {
    readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary",
  });
}
