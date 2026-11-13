// Builds the platform once before the tests, so they run the same Worker `void deploy` uploads.
//
// The test config is the built one without the Workers AI binding: Wrangler would otherwise
// start a remote AI proxy, which needs a Cloudflare login. Tests answer Claude from a stub
// instead (see fakeClaude in helpers.ts).

import { readFileSync, writeFileSync } from "node:fs";
import { createBuilder } from "vite";

export const TEST_CONFIG = "dist/ssr/wrangler.test.json";

export default async () => {
  const builder = await createBuilder({ logLevel: "warn" });
  await builder.buildApp();
  const { ai: _ai, ...config } = JSON.parse(readFileSync("dist/ssr/wrangler.json", "utf8"));
  writeFileSync(TEST_CONFIG, JSON.stringify(config, null, 2));
};
