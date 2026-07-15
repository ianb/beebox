import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Runs the suite inside workerd via @cloudflare/vitest-pool-workers. The plugin
// reads wrangler.jsonc for the Worker entry (`main`) and its bindings — notably
// the PUB_STORE R2 binding, backed by a per-test isolated miniflare store.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
});
