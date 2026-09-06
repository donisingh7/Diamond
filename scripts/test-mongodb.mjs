import dns from "node:dns";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error("MongoDB connection failed: MONGODB_URI is not defined.");
  process.exit(1);
}

const dnsServers = dns.getServers();
const usesOnlyLoopbackDns = dnsServers.every(
  (server) => server === "127.0.0.1" || server === "::1",
);

if (uri.startsWith("mongodb+srv://") && usesOnlyLoopbackDns) {
  console.warn(
    "Local DNS cannot resolve MongoDB SRV records; using public DNS for this test process.",
  );
  dns.setServers(["1.1.1.1", "8.8.8.8"]);
}

const client = new MongoClient(uri, {
  connectTimeoutMS: 10_000,
  serverSelectionTimeoutMS: 10_000,
});

const startedAt = Date.now();

try {
  await client.connect();
  await client.db("admin").command({ ping: 1 });
  console.log(`MongoDB connection successful (${Date.now() - startedAt} ms).`);
} catch (error) {
  const name = error instanceof Error ? error.name : "UnknownError";
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? ` (${String(error.code)})`
      : "";

  console.error(`MongoDB connection failed: ${name}${code}.`);
  process.exitCode = 1;
} finally {
  await client.close();
}
