import { defineConfig } from "vitest/config";
import base from "./vitest.config.mts";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/integration/**/*.integration.ts"],
    // Cold Windows binary downloads can take several minutes; cached runs start quickly.
    hookTimeout: 900_000,
    testTimeout: 30_000,
    maxWorkers: 1,
  },
});
