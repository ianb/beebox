# Cloudflare publication hostname reservations are canonical and machine-wide

Hostname spellings are normalized at the machine-store boundary so case and a
trailing dot cannot create duplicate reservations across publications or boxes.

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveCloudflarePublishConnection, grantCloudflarePublishConnection, reserveCloudflarePublishBinding, reserveCloudflarePublishHostname, getCloudflarePublishHostnameOwner } from "../../src/core/secrets/cloudflare-publish.js";

const secretDir = await mkdtemp(path.join(tmpdir(), "bbx-hostnames-"));
process.env.BBX_SECRETS_FILE = path.join(secretDir, "secrets.json");
const connection = "0123456789abcdef0123456789abcdef";
const now = "2026-09-25T12:00:00.000Z";
await saveCloudflarePublishConnection({ name: "main", accountId: connection, credentialType: "account-api-token", apiToken: "placeholder", tokenId: "token-id", verifiedAt: now });
await grantCloudflarePublishConnection({ name: "main", boxSlug: "box-a" });
await grantCloudflarePublishConnection({ name: "main", boxSlug: "box-b" });
const bindings = [
  { pubId: "abcdefghijklmnopqrstuvwxyz", boxSlug: "box-a", hostHandle: "site-a" },
  { pubId: "bcdefghijklmnopqrstuvwxyz2", boxSlug: "box-b", hostHandle: "site-b" },
];
for (const [index, binding] of bindings.entries()) await reserveCloudflarePublishBinding({ ...binding, connectionName: "main", bucketName: `bucket-${index}`, workerName: binding.hostHandle, createdAt: now });
```

An owner-entered spelling is stored canonically, and a second box cannot
reserve another spelling of the same hostname.

```ts
await reserveCloudflarePublishHostname({ pubId: bindings[0].pubId, boxSlug: "box-a", hostname: "Www.Example.org." });
const owner = await getCloudflarePublishHostnameOwner("www.example.org");
const duplicate = await Promise.resolve()
  .then(() => reserveCloudflarePublishHostname({ pubId: bindings[1].pubId, boxSlug: "box-b", hostname: "www.example.org" }))
  .then(() => "allowed", (error) => error.message);
JSON.stringify({ canonical: owner?.customHostname, ownerPubId: owner?.pubId, duplicateRejected: duplicate.includes("already assigned") })
=> {"canonical":"www.example.org","ownerPubId":"abcdefghijklmnopqrstuvwxyz","duplicateRejected":true}
```

```ts teardown
await rm(secretDir, { recursive: true, force: true });
delete process.env.BBX_SECRETS_FILE;
```
