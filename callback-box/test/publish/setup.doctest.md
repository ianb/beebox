# `cb pub setup` — provisioning against a fake Cloudflare

The one-time provisioning flow (Track E of `docs/plans/publish-pages.md`):
ensure the R2 bucket, deploy `pub-worker` via wrangler with the version stamp
(+ Access vars when given), enforce workers.dev-on / preview-URLs-OFF, and
resolve the `workers.dev` hostname. Everything runs against the FAKE
provisioning client and a recording deploy stub — no network, no wrangler.

The `pub-worker` name / `pub-store` bucket come from the real committed
`pub-worker/wrangler.jsonc` (the single source of truth), and the version stamp
is the real hash of the committed Worker source.

```ts setup
import { setupPublishing } from "../../src/publish/setup.js";
import { localPubWorkerVersion } from "../../src/publish/pub-worker-meta.js";
import { createFakeProvisioningClient } from "../../src/services/cloudflare-provisioning.js";

const CREDS_ENV = { CLOUDFLARE_API_TOKEN: "test-token", CLOUDFLARE_ACCOUNT_ID: "test-account" };

// A recording deploy stub standing in for `wrangler deploy`.
function fakeDeploy(calls, result) {
  return async (args) => {
    calls.push(args);
    return result ?? { code: 0, output: "Deployed pub-worker" };
  };
}
```

## First run: creates the bucket, deploys, disables previews, prints the hostname

```ts
const client = createFakeProvisioningClient({ accountSubdomain: "mybox" });
const deploys = [];
const result = await setupPublishing({}, { env: CREDS_ENV, client, deploy: fakeDeploy(deploys) });
result.ok
=> true

[result.hostname, result.bucketName, result.bucketCreated].join(" ")
=> pub-worker.mybox.workers.dev pub-store true

// The bucket was created and the workers.dev routing was ENFORCED to
// enabled-with-previews-disabled (previews are a leak surface).
JSON.stringify(client.ops)
=> ["create-bucket:pub-store","set-subdomain:pub-worker:true:false"]

// One wrangler deploy, in the pub-worker package dir, with the account creds.
deploys.length
=> 1

deploys[0].cwd.endsWith("/pub-worker")
=> true

JSON.stringify(deploys[0].credsEnv)
=> {"CLOUDFLARE_API_TOKEN":"test-token","CLOUDFLARE_ACCOUNT_ID":"test-account"}
```

The deploy bakes in the version stamp — the hash of the committed Worker
source — and, with no Access flags, NO Access vars (the committed empty
placeholders apply, so account tiers fail closed):

```ts continue
const version = await localPubWorkerVersion();
JSON.stringify(deploys[0].wranglerArgs)
=> ["deploy","--var","PUB_WORKER_VERSION:«*»"]

deploys[0].wranglerArgs[2] === `PUB_WORKER_VERSION:${version}`
=> true

result.version === version
=> true

result.accessConfigured
=> false

// CLOUDFLARE_R2_BUCKET is not in the env yet — setup says what line to add.
result.bucketEnvHint
=> CLOUDFLARE_R2_BUCKET=pub-store
```

## Re-run is idempotent: an existing bucket is success, not failure

```ts
const client = createFakeProvisioningClient({ accountSubdomain: "mybox", buckets: ["pub-store"] });
const result = await setupPublishing({}, { env: { ...CREDS_ENV, CLOUDFLARE_R2_BUCKET: "pub-store" }, client, deploy: fakeDeploy([]) });
[result.ok, result.bucketCreated].join(" ")
=> true false

// Bucket already existed → no create call; the routing enforcement still runs.
JSON.stringify(client.ops)
=> ["set-subdomain:pub-worker:true:false"]

// The env already names the bucket — no hint needed.
result.bucketEnvHint
=> null
```

## Access flags bake the vars into the deploy

```ts
const client = createFakeProvisioningClient({ accountSubdomain: "mybox" });
const deploys = [];
const result = await setupPublishing(
  { accessTeamDomain: "https://myteam.cloudflareaccess.com", accessAud: "aud-tag-123" },
  { env: CREDS_ENV, client, deploy: fakeDeploy(deploys) },
);
[result.ok, result.accessConfigured].join(" ")
=> true true

JSON.stringify(deploys[0].wranglerArgs.slice(3))
=> ["--var","ACCESS_TEAM_DOMAIN:https://myteam.cloudflareaccess.com","--var","ACCESS_AUD:aud-tag-123"]
```

## Refusals are typed and name the fix

Missing credentials (the client is `null` before creds exist):

```ts
const result = await setupPublishing({}, { env: {}, client: null });
[result.ok, result.reason].join(" ")
=> false unconfigured

result.message.includes("~/.cb-publish.env") && result.message.includes("Workers R2 Storage: Edit")
=> true
```

A lone Access flag, or a team domain that isn't the full origin:

```ts
const client = createFakeProvisioningClient({});
const half = await setupPublishing({ accessAud: "aud-only" }, { env: CREDS_ENV, client, deploy: fakeDeploy([]) });
[half.ok, half.reason].join(" ")
=> false invalid-access-flags

const bad = await setupPublishing(
  { accessTeamDomain: "myteam.cloudflareaccess.com", accessAud: "aud" },
  { env: CREDS_ENV, client, deploy: fakeDeploy([]) },
);
[bad.ok, bad.reason].join(" ")
=> false invalid-access-flags

bad.message.includes("https://<team>.cloudflareaccess.com")
=> true
```

An env bucket that disagrees with the committed Worker binding (the Worker
would read a different bucket than the CLI writes):

```ts
const client = createFakeProvisioningClient({});
const result = await setupPublishing({}, { env: { ...CREDS_ENV, CLOUDFLARE_R2_BUCKET: "other-bucket" }, client, deploy: fakeDeploy([]) });
[result.ok, result.reason].join(" ")
=> false bucket-mismatch

result.message.includes("other-bucket") && result.message.includes("pub-store")
=> true

// Refused before any Cloudflare mutation.
JSON.stringify(client.ops)
=> []
```

A failing wrangler deploy surfaces the output:

```ts
const client = createFakeProvisioningClient({ accountSubdomain: "mybox" });
const result = await setupPublishing(
  {},
  { env: CREDS_ENV, client, deploy: fakeDeploy([], { code: 1, output: "X [ERROR] auth failed" }) },
);
[result.ok, result.reason].join(" ")
=> false deploy-failed

result.output
=> X [ERROR] auth failed

// The deploy failed → routing enforcement never ran (only the bucket create).
JSON.stringify(client.ops)
=> ["create-bucket:pub-store"]
```

## Preview URLs failing to disable is a hard failure (verified by read-back)

Setup trusts the OBSERVED routing state, not its own write: a client whose
settings don't settle to previews-disabled refuses loudly.

```ts
const client = createFakeProvisioningClient({ accountSubdomain: "mybox" });
// Simulate a Cloudflare that ignores the previews toggle.
client.setScriptSubdomain = async (name, _settings) => {
  client.scriptSubdomains.set(name, { enabled: true, previewsEnabled: true });
};
const result = await setupPublishing({}, { env: CREDS_ENV, client, deploy: fakeDeploy([]) });
[result.ok, result.reason].join(" ")
=> false preview-urls-enabled

result.message.includes("old Worker versions")
=> true
```

## No workers.dev subdomain on the account is a clear dashboard instruction

```ts
const client = createFakeProvisioningClient({ accountSubdomain: null });
const result = await setupPublishing({}, { env: CREDS_ENV, client, deploy: fakeDeploy([]) });
[result.ok, result.reason].join(" ")
=> false no-subdomain

result.message.includes("dashboard")
=> true
```
