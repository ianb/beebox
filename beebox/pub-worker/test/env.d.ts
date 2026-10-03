/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Type the `env` handle from `cloudflare:test` (a `Cloudflare.Env`) with the
// Worker's bindings, so tests can seed the R2 store type-safely.
declare namespace Cloudflare {
  interface Env {
    PUB_STORE: R2Bucket;
    ACCESS_TEAM_DOMAIN: string;
    ACCESS_AUD: string;
    PUB_WORKER_VERSION: string;
  }
}
