import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the suite inside workerd via @cloudflare/vitest-pool-workers. The plugin
// reads wrangler.jsonc for the Worker entry (`main`) and its bindings — notably
// the PUB_STORE and PUB_INGEST R2 bindings (the content/ingestion bucket split,
// Codex cross-review amendment 1), each backed by a per-test isolated miniflare
// store.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
});
