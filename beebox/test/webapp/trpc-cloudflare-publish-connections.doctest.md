# Cloudflare publishing connections stay server-held

Admin connection procedures store a verified account token in machine custody,
expose metadata only, and grant it to boxes at `server` access. The ordinary
secret APIs never receive this credential value.

```ts setup
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appRouter } from "../../src/webapp/trpc/router.js";
import { createFakeCloudflarePublishTokenVerifier } from "../../src/services/cloudflare-publish-token-verifier.js";
import { resolveCloudflarePublishCredential } from "../../src/core/secrets/cloudflare-publish.js";
import { getCloudflarePublishBinding, reserveCloudflarePublishBinding } from "../../src/core/secrets/cloudflare-publish.js";
import { listSecrets } from "../../src/core/secrets/lifecycle.js";
import { resolveSecret } from "../../src/core/secrets/resolve.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const noBus = { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} };
const storeDir = await mkdtemp(join(tmpdir(), "bbx-cf-publish-"));
const storeFile = join(storeDir, "secrets.json");
process.env.BBX_SECRETS_FILE = storeFile;
const box = await makeTmpBox({ git: true });
const verifier = createFakeCloudflarePublishTokenVerifier();
function caller(isAuthenticatedOwner = true) {
  return appRouter.createCaller({
    boxRoot: box.root,
    boxSlug: "test-box",
    eventBus: noBus,
    services: { cloudflarePublishTokenVerifier: verifier },
    user: { email: "owner@example.com", name: "Owner" },
    authed: true,
    isOwner: true,
    isAuthenticatedOwner,
  });
}
async function message(promise) {
  try { await promise; return "allowed"; }
  catch (error) { return error.code ?? error.message; }
}
```

Only a real authenticated owner may manage this machine-wide credential.

```ts
await message(caller(false).cloudflarePublishConnections.list())
=> FORBIDDEN
```

Saving verifies the token against the selected account and returns metadata,
never the token itself. Other write capabilities remain explicitly unverified
until actual server provisioning exercises them.

```ts continue
const owner = caller();
const saved = await owner.cloudflarePublishConnections.save({
  name: "studio",
  accountId: "0123456789abcdef0123456789abcdef",
  apiToken: "placeholder-cloudflare-token",
});
print(JSON.stringify({
  status: saved.tokenStatus,
  capabilities: saved.capabilities,
  leaksToken: JSON.stringify(saved).includes("placeholder-cloudflare-token"),
  verifiedAccount: verifier.verified[0]?.accountId,
}));
=> {"status":"active","capabilities":{"tokenForAccount":"verified","r2ObjectWrite":"unverified","workerDeploy":"unverified","accessLive":"unverified"},"leaksToken":false,"verifiedAccount":"0123456789abcdef0123456789abcdef"}
```

The token has its own server-only connection slot, not a generic secret slot.

```ts continue
const metadata = await owner.cloudflarePublishConnections.list();
const generic = await listSecrets();
const raw = JSON.parse(await readFile(storeFile, "utf-8"));
print(JSON.stringify({
  connection: metadata[0]?.name,
  genericNames: generic.map((entry) => entry.name),
  stored: raw.cloudflarePublishConnections.studio.apiToken === "placeholder-cloudflare-token",
}));
=> {"connection":"studio","genericNames":[],"stored":true}
```

A grant is always `server`; there is no API input that can raise a publishing
token to agent access. The resolver refuses boxes without the grant.

```ts continue
await owner.cloudflarePublishConnections.grant({ name: "studio", boxSlug: "test-box" });
const credential = await resolveCloudflarePublishCredential({
  name: "studio", boxSlug: "test-box", purpose: "publish-prepare", at: new Date().toISOString(),
});
const notGranted = await message(resolveCloudflarePublishCredential({
  name: "studio", boxSlug: "other-box", purpose: "publish-prepare", at: new Date().toISOString(),
}));
const genericResolve = await resolveSecret({ boxRoot: box.root, name: "cloudflare-publish/studio", purpose: "publish-prepare", access: "agent" });
print(JSON.stringify({ tokenAvailableToServer: credential.apiToken === "placeholder-cloudflare-token", notGranted, genericResolve: genericResolve.ok }));
=> {"tokenAvailableToServer":true,"notGranted":"Cloudflare publishing connection 'studio' has no server grant for box 'other-box'.","genericResolve":false}
```

Publication locators are box-owned, while sites in one box and connection share
the same isolated bucket. A copied PubId cannot be resolved by another box.

```ts continue
const bindingA = await reserveCloudflarePublishBinding({
  pubId: "abcdefghijklmnopqrstuvwxyz",
  boxSlug: "test-box",
  connectionName: "studio",
  bucketName: "bbx-pub-first",
  workerName: "worker-a",
  hostHandle: "host-a",
  createdAt: new Date().toISOString(),
});
const bindingB = await reserveCloudflarePublishBinding({
  pubId: "bcdefghijklmnopqrstuvwxyz2",
  boxSlug: "test-box",
  connectionName: "studio",
  bucketName: "bbx-pub-second",
  workerName: "worker-b",
  hostHandle: "host-b",
  createdAt: new Date().toISOString(),
});
const foreignBinding = await getCloudflarePublishBinding({ pubId: bindingA.pubId, boxSlug: "other-box" }).then(() => false, () => true);
print(JSON.stringify({ sharesBoxBucket: bindingA.bucketName === bindingB.bucketName, foreignBinding }));
=> {"sharesBoxBucket":true,"foreignBinding":true}
```

A failed verification does not create or rotate a connection. Revocation drops
the credential while retaining routing metadata and grants for diagnosis.

```ts continue
const rejectingVerifier = createFakeCloudflarePublishTokenVerifier({ error: new Error("bad token") });
const rejecting = appRouter.createCaller({
  boxRoot: box.root, boxSlug: "test-box", eventBus: noBus,
  services: { cloudflarePublishTokenVerifier: rejectingVerifier },
  user: { email: "owner@example.com", name: "Owner" }, authed: true, isOwner: true, isAuthenticatedOwner: true,
});
const failed = await message(rejecting.cloudflarePublishConnections.save({
  name: "broken", accountId: "0123456789abcdef0123456789abcdef", apiToken: "placeholder-invalid-token",
}));
await owner.cloudflarePublishConnections.revoke({ name: "studio" });
const after = (await owner.cloudflarePublishConnections.list())[0];
const unavailable = await message(resolveCloudflarePublishCredential({
  name: "studio", boxSlug: "test-box", purpose: "publish-disable", at: new Date().toISOString(),
}));
print(JSON.stringify({ failed, names: (await owner.cloudflarePublishConnections.list()).map((item) => item.name), status: after?.tokenStatus, unavailable }));
=> {"failed":"BAD_REQUEST","names":["studio"],"status":"revoked","unavailable":"Cloudflare publishing connection 'studio' is revoked; server operations are unavailable."}
```
