# `cb pub status` — deployed state + committed-vs-deployed drift

The status report (Track E of `docs/plans/publish-pages.md`): local publication
counts, the provisioned Cloudflare state (bucket, script bindings, workers.dev
routing), and the version drift check — the deployed Worker's public
`GET /__version` compared against the hash of the committed Worker source.
Every security-relevant misconfig lands in `problems` (the CLI exits nonzero on
any). All against the FAKE client and a stubbed probe — no network.

```ts setup
import { draftPublication } from "../../src/publish/draft.js";
import { localPubWorkerVersion } from "../../src/publish/pub-worker-meta.js";
import { statusPublishing } from "../../src/publish/status.js";
import { createFakeProvisioningClient } from "../../src/services/cloudflare-provisioning.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const CREDS_ENV = { CLOUDFLARE_API_TOKEN: "test-token", CLOUDFLARE_ACCOUNT_ID: "test-account" };

// A fully-healthy deployed state matching the committed wrangler.jsonc.
function healthyClient(overrides) {
  return createFakeProvisioningClient({
    buckets: ["pub-store"],
    accountSubdomain: "mybox",
    scripts: {
      "pub-worker": {
        bindings: [
          { type: "r2_bucket", name: "PUB_STORE" },
          { type: "plain_text", name: "ACCESS_TEAM_DOMAIN", text: "https://myteam.cloudflareaccess.com" },
          { type: "plain_text", name: "ACCESS_AUD", text: "aud-tag" },
        ],
      },
    },
    scriptSubdomains: { "pub-worker": { enabled: true, previewsEnabled: false } },
    ...overrides,
  });
}
```

## Healthy deployment: no problems, drift no

```ts
const box = await makeTmpBox();
const version = await localPubWorkerVersion();
const report = await statusPublishing(
  { boxRoot: box.root },
  { env: CREDS_ENV, client: healthyClient(), probeText: async () => version },
);
[report.configured, report.hostname].join(" ")
=> true pub-worker.mybox.workers.dev

JSON.stringify(report.bucket)
=> {"name":"pub-store","exists":true}

JSON.stringify(report.worker)
=> {"hasStoreBinding":true,"accessConfigured":true}

JSON.stringify(report.routing)
=> {"enabled":true,"previewsEnabled":false}

[report.version.drift, report.version.deployed === report.version.local].join(" ")
=> false true

JSON.stringify(report.problems)
=> []

await box.cleanup();
```

## Local publication counts come from box/publish/ (no Cloudflare needed for them)

```ts
const box = await makeTmpBox();
await box.write("docs/a.md", "# A\n\nbody\n");
const drafted = await draftPublication(
  { boxRoot: box.root, source: "docs/a.md", tier: "secret" },
  { now: new Date("2026-07-14T12:00:00Z"), ownerEmail: null, softwareVersion: "1.0.0", commit: async () => {} },
);
drafted.ok
=> true

const report = await statusPublishing({ boxRoot: box.root }, { env: {}, client: null });
JSON.stringify(report.pubs)
=> {"draft":1,"live":0,"revoked":0,"invalid":0}

// Unconfigured: the report still renders, with the one problem naming the fix.
report.configured
=> false

report.problems.length === 1 && report.problems[0].includes("cb pub setup")
=> true

await box.cleanup();
```

## Version drift is flagged as a problem

```ts
const box = await makeTmpBox();
const report = await statusPublishing(
  { boxRoot: box.root },
  { env: CREDS_ENV, client: healthyClient(), probeText: async () => "0123-some-stale-deployed-hash" },
);
report.version.drift
=> true

report.problems.length === 1 && report.problems[0].includes("DRIFTS")
=> true

await box.cleanup();
```

An unreachable / pre-version-probe Worker reports deployed `null` (also a
problem — the drift check can't vouch for what's live):

```ts continue
const unreachable = await statusPublishing(
  { boxRoot: box.root },
  { env: CREDS_ENV, client: healthyClient(), probeText: async () => null },
);
JSON.stringify([unreachable.version.deployed, unreachable.version.drift])
=> [null,true]
```

## Security misconfigs each land in problems

Preview URLs re-enabled (old Worker versions become reachable — leak surface):

```ts
const box = await makeTmpBox();
const version = await localPubWorkerVersion();
const client = healthyClient({ scriptSubdomains: { "pub-worker": { enabled: true, previewsEnabled: true } } });
const report = await statusPublishing({ boxRoot: box.root }, { env: CREDS_ENV, client, probeText: async () => version });
report.problems.length === 1 && report.problems[0].includes("preview URLs are ENABLED")
=> true

await box.cleanup();
```

Nothing deployed at all (fresh account, creds present):

```ts
const box = await makeTmpBox();
const client = createFakeProvisioningClient({ accountSubdomain: "mybox" });
const report = await statusPublishing({ boxRoot: box.root }, { env: CREDS_ENV, client, probeText: async () => null });
[report.bucket.exists, report.worker === null, report.routing === null].join(" ")
=> false true true

// Bucket missing + Worker missing, and no version probe is attempted for an
// undeployed script (deployed stays null without a probe problem).
report.problems.length
=> 2

report.problems.every((p) => p.includes("cb pub setup"))
=> true

await box.cleanup();
```
