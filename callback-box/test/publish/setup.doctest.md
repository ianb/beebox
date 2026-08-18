# `cb pub setup` — provisioning against a fake Cloudflare

The one-time provisioning flow (`docs/implemented-plans/pub-setup-wrangler.md`): ensure
BOTH R2 buckets (content + ingestion — the bucket split), resolve the
workers.dev hostname, optionally provision Cloudflare Access via the API,
deploy `pub-worker` via the wrangler service with the version stamp (+ Access
vars), enforce workers.dev-on / preview-URLs-OFF, and persist the non-secret
Access values so reruns never erase them. Everything runs against the FAKE
provisioning client, FAKE wrangler, and FAKE Access client — no network, no
wrangler spawn.

The `pub-worker` name / `pub-store` + `pub-ingest` buckets come from the real
committed `pub-worker/wrangler.jsonc` (the single source of truth), and the
version stamp is the real hash of the committed Worker source.

```ts setup
import { setupPublishing } from "../../src/publish/setup.js";
import { readPublishSecret } from "../../src/publish/connector-secret.js";
import { readPublishConfig, writePublishConfig } from "../../src/publish/publish-config.js";
import { localPubWorkerVersion } from "../../src/publish/pub-worker-meta.js";
import { createFakeProvisioningClient } from "../../src/services/cloudflare-provisioning.js";
import { createFakeAccessClient } from "../../src/services/cloudflare-access.js";
import { createFakeTokensClient } from "../../src/services/cloudflare-tokens.js";
import { createFakeWrangler } from "../../src/services/wrangler.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

// A logged-in fake wrangler (single account, deploys succeed unless scripted).
function fakeWrangler(runResults) {
  return createFakeWrangler({
    identity: { email: "owner@example.com", accounts: [{ id: "test-account", name: "Test" }] },
    runResults,
  });
}

// The resolved auth bundle the CLI would build from that login.
function fakeAuth(client, wrangler) {
  return { client, wrangler, accountId: "test-account", deployEnv: {} };
}
```

## First run: creates both buckets, deploys, disables previews, prints the hostname

```ts
const box = await makeTmpBox();
const client = createFakeProvisioningClient({ accountSubdomain: "mybox" });
const wrangler = fakeWrangler();
const result = await setupPublishing({}, { boxRoot: box.root, auth: fakeAuth(client, wrangler) });
result.ok
=> true

[result.hostname, result.bucketName, result.ingestBucketName].join(" ")
=> pub-worker.mybox.workers.dev pub-store pub-ingest

[result.bucketCreated, result.ingestBucketCreated].join(" ")
=> true true

// Both buckets created; workers.dev routing ENFORCED to
// enabled-with-previews-disabled (previews are a leak surface).
JSON.stringify(client.ops)
=> ["create-bucket:pub-store","create-bucket:pub-ingest","set-subdomain:pub-worker:true:false"]

// One wrangler deploy, pinned to the resolved account, stamped with the real
// committed-source version hash; no Access vars (none configured).
const version = await localPubWorkerVersion();
wrangler.runs.length
=> 1

wrangler.runs[0] === `test-account:deploy --var PUB_WORKER_VERSION:${version}`
=> true

[result.version === version, result.accessConfigured].join(" ")
=> true false

// No Access values were learned, so nothing was persisted.
await readPublishConfig(box.root)
=> null

await box.cleanup();
```

## Re-run is idempotent: existing buckets are success, not failure

```ts
const box = await makeTmpBox();
const client = createFakeProvisioningClient({ accountSubdomain: "mybox", buckets: ["pub-store", "pub-ingest"] });
const result = await setupPublishing({}, { boxRoot: box.root, auth: fakeAuth(client, fakeWrangler()) });
[result.ok, result.bucketCreated, result.ingestBucketCreated].join(" ")
=> true false false

// Buckets already existed → no create calls; the routing enforcement still runs.
JSON.stringify(client.ops)
=> ["set-subdomain:pub-worker:true:false"]

await box.cleanup();
```

## Manual Access flags bake the vars into the deploy AND persist them

```ts
const box = await makeTmpBox();
const client = createFakeProvisioningClient({ accountSubdomain: "mybox" });
const wrangler = fakeWrangler();
const result = await setupPublishing(
  { accessTeamDomain: "https://myteam.cloudflareaccess.com", accessAud: "aud-tag-123" },
  { boxRoot: box.root, auth: fakeAuth(client, wrangler) },
);
[result.ok, result.accessConfigured].join(" ")
=> true true

wrangler.runs[0].includes("--var ACCESS_TEAM_DOMAIN:https://myteam.cloudflareaccess.com --var ACCESS_AUD:aud-tag-123")
=> true

// Persisted (config/publish.json) so a later plain rerun redeploys the same vars.
JSON.stringify(await readPublishConfig(box.root))
=> {"accessTeamDomain":"https://myteam.cloudflareaccess.com","accessAud":"aud-tag-123"}
```

A later rerun with NO flags redeploys the persisted values instead of erasing
them (a plain rerun must never take working `/a/` tiers down):

```ts continue
const rerunWrangler = fakeWrangler();
const rerun = await setupPublishing({}, { boxRoot: box.root, auth: fakeAuth(createFakeProvisioningClient({ accountSubdomain: "mybox", buckets: ["pub-store", "pub-ingest"] }), rerunWrangler) });
[rerun.ok, rerun.accessConfigured].join(" ")
=> true true

rerunWrangler.runs[0].includes("ACCESS_AUD:aud-tag-123")
=> true

await box.cleanup();
```

## `--access`: API provisioning replaces the dashboard walkthrough

The fake Access client starts with an onboarded org and nothing else — setup
creates the OTP IdP, the `/a` app, and the allow-everyone policy, then bakes
the returned team domain + aud into the deploy:

```ts
const box = await makeTmpBox();
const access = createFakeAccessClient();
const wrangler = fakeWrangler();
const result = await setupPublishing(
  {},
  { boxRoot: box.root, auth: fakeAuth(createFakeProvisioningClient({ accountSubdomain: "mybox" }), wrangler), access },
);
[result.ok, result.accessConfigured].join(" ")
=> true true

JSON.stringify(result.accessProvisioned)
=> {"teamDomain":"https://exampleteam.cloudflareaccess.com","aud":"aud-tag-3","appCreated":true,"otpIdpCreated":true,"policyCreated":true}

// The app protects `<hostname>/a`; the org's bare auth_domain was normalized
// to the full https:// origin the Worker's `iss` check requires.
JSON.stringify(access.ops)
=> ["create-idp:onetimepin","create-app:pub-worker.mybox.workers.dev/a","create-policy:app-2"]

wrangler.runs[0].includes("--var ACCESS_TEAM_DOMAIN:https://exampleteam.cloudflareaccess.com --var ACCESS_AUD:aud-tag-3")
=> true

JSON.stringify(await readPublishConfig(box.root))
=> {"accessTeamDomain":"https://exampleteam.cloudflareaccess.com","accessAud":"aud-tag-3"}
```

A second `--access` run converges: everything is found, nothing is duplicated.

```ts continue
const again = await setupPublishing(
  {},
  { boxRoot: box.root, auth: fakeAuth(createFakeProvisioningClient({ accountSubdomain: "mybox", buckets: ["pub-store", "pub-ingest"] }), fakeWrangler()), access },
);
[again.ok, again.accessProvisioned.appCreated, again.accessProvisioned.otpIdpCreated, again.accessProvisioned.policyCreated].join(" ")
=> true false false false

// No new mutating ops beyond the first run's three.
access.ops.length
=> 3

await box.cleanup();
```

## `--mint-connector-token`: the connector credential is minted, not hand-assembled

The fake tokens client carries the two R2 bucket-item permission groups; setup
mints an account-owned token scoped to exactly the ingestion bucket and stores
it in the machine secret store, granted to this box:

```ts
const box = await makeTmpBox();
const tokens = createFakeTokensClient();
const result = await setupPublishing(
  {},
  { boxRoot: box.root, auth: fakeAuth(createFakeProvisioningClient({ accountSubdomain: "mybox" }), fakeWrangler()), tokens },
);
[result.ok, result.connectorSecret.minted].join(" ")
=> true true

JSON.stringify(tokens.minted)
=> [{"name":"callback-box publish connector (pub-ingest)","bucketName":"pub-ingest","groups":["Workers R2 Storage Bucket Item Read","Workers R2 Storage Bucket Item Write"]}]

// The credential resolves back out of the store — the connector can pull with it.
const secret = await readPublishSecret(box.root);
[secret.accountId, secret.bucket].join(" ")
=> test-account pub-ingest

// The printed server-copy JSON carries the one-time token value.
result.connectorSecret.json.includes("minted-secret-1")
=> true
```

A rerun mints NOTHING — the stored credential wins (no duplicate tokens):

```ts continue
const again = await setupPublishing(
  {},
  { boxRoot: box.root, auth: fakeAuth(createFakeProvisioningClient({ accountSubdomain: "mybox", buckets: ["pub-store", "pub-ingest"] }), fakeWrangler()), tokens },
);
[again.ok, again.connectorSecret.minted, tokens.minted.length].join(" ")
=> true false 1

await box.cleanup();
```

Renamed/missing permission groups are a typed refusal (Cloudflare may rename
them; the message says how to investigate):

```ts
const box = await makeTmpBox();
const bare = createFakeTokensClient({ permissionGroups: [{ id: "pg-x", name: "Something Else" }] });
const result = await setupPublishing(
  {},
  { boxRoot: box.root, auth: fakeAuth(createFakeProvisioningClient({ accountSubdomain: "mybox" }), fakeWrangler()), tokens: bare },
);
[result.ok, result.reason].join(" ")
=> false connector-token

result.message.includes("permission groups")
=> true

await box.cleanup();
```

## Access refusals are typed and never silently "fix" drift

An account that never onboarded to Zero Trust (the one remaining dashboard
step Cloudflare gives no API for):

```ts
const box = await makeTmpBox();
const noOrg = createFakeAccessClient({ organization: null });
const result = await setupPublishing(
  {},
  { boxRoot: box.root, auth: fakeAuth(createFakeProvisioningClient({ accountSubdomain: "mybox" }), fakeWrangler()), access: noOrg },
);
[result.ok, result.reason].join(" ")
=> false access-provisioning

result.message.includes("one.dash.cloudflare.com")
=> true
```

An app whose policies exist but aren't allow-everyone was configured
deliberately by someone — setup refuses with the shapes instead of overriding:

```ts continue
const drifted = createFakeAccessClient({
  apps: [{ id: "app-9", aud: "aud-9", domain: "pub-worker.mybox.workers.dev/a", name: "existing", type: "self_hosted" }],
  policies: { "app-9": [{ id: "pol-1", name: "corp only", decision: "allow", includeEveryone: false }] },
});
const refused = await setupPublishing(
  {},
  { boxRoot: box.root, auth: fakeAuth(createFakeProvisioningClient({ accountSubdomain: "mybox" }), fakeWrangler()), access: drifted },
);
[refused.ok, refused.reason].join(" ")
=> false access-provisioning

refused.message.includes("corp only")
=> true

await box.cleanup();
```

## Refusals are typed and name the fix

No Cloudflare login at all (`auth: null` — neither wrangler login nor env creds):

```ts
const box = await makeTmpBox();
const result = await setupPublishing({}, { boxRoot: box.root, auth: null });
[result.ok, result.reason].join(" ")
=> false unconfigured

result.message.includes("wrangler login")
=> true
```

A lone Access flag, or a team domain that isn't the full origin:

```ts continue
const client = createFakeProvisioningClient({});
const half = await setupPublishing({ accessAud: "aud-only" }, { boxRoot: box.root, auth: fakeAuth(client, fakeWrangler()) });
[half.ok, half.reason].join(" ")
=> false invalid-access-flags

const bad = await setupPublishing(
  { accessTeamDomain: "myteam.cloudflareaccess.com", accessAud: "aud" },
  { boxRoot: box.root, auth: fakeAuth(client, fakeWrangler()) },
);
[bad.ok, bad.reason].join(" ")
=> false invalid-access-flags

bad.message.includes("https://<team>.cloudflareaccess.com")
=> true
```

An env bucket override that disagrees with the committed content binding:

```ts continue
const mismatch = await setupPublishing(
  {},
  { boxRoot: box.root, env: { CLOUDFLARE_R2_BUCKET: "other-bucket" }, auth: fakeAuth(client, fakeWrangler()) },
);
[mismatch.ok, mismatch.reason].join(" ")
=> false bucket-mismatch

mismatch.message.includes("other-bucket") && mismatch.message.includes("pub-store")
=> true

// Refused before any Cloudflare mutation.
JSON.stringify(client.ops)
=> []

await box.cleanup();
```

A failing wrangler deploy surfaces the output:

```ts
const box = await makeTmpBox();
const client = createFakeProvisioningClient({ accountSubdomain: "mybox" });
const result = await setupPublishing(
  {},
  { boxRoot: box.root, auth: fakeAuth(client, fakeWrangler({ deploy: { code: 1, output: "X [ERROR] auth failed" } })) },
);
[result.ok, result.reason].join(" ")
=> false deploy-failed

result.output
=> X [ERROR] auth failed

// The deploy failed → routing enforcement never ran (buckets were ensured first).
JSON.stringify(client.ops)
=> ["create-bucket:pub-store","create-bucket:pub-ingest"]

await box.cleanup();
```

## Preview URLs failing to disable is a hard failure (verified by read-back)

Setup trusts the OBSERVED routing state, not its own write: a client whose
settings don't settle to previews-disabled refuses loudly.

```ts
const box = await makeTmpBox();
const client = createFakeProvisioningClient({ accountSubdomain: "mybox" });
// Simulate a Cloudflare that ignores the previews toggle.
client.setScriptSubdomain = async (name, _settings) => {
  client.scriptSubdomains.set(name, { enabled: true, previewsEnabled: true });
};
const result = await setupPublishing({}, { boxRoot: box.root, auth: fakeAuth(client, fakeWrangler()) });
[result.ok, result.reason].join(" ")
=> false preview-urls-enabled

result.message.includes("old Worker versions")
=> true

await box.cleanup();
```

## No workers.dev subdomain on the account is a clear dashboard instruction

```ts
const box = await makeTmpBox();
const client = createFakeProvisioningClient({ accountSubdomain: null });
const result = await setupPublishing({}, { boxRoot: box.root, auth: fakeAuth(client, fakeWrangler()) });
[result.ok, result.reason].join(" ")
=> false no-subdomain

result.message.includes("dashboard")
=> true

await box.cleanup();
```
