// Tests run in Node and start the built Worker (dist/ssr) in workerd through Wrangler's
// test harness. This config keeps voidPlugin() out of the test process; test/build.ts
// builds the app once first.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["test/build.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
