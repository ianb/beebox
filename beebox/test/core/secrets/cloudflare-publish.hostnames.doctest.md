# Cloudflare publication host mapping is canonical and machine-wide

A box can reserve one immutable shared host mapping. The reservation is keyed by
box, uses the granted connection, and normalizes host spelling.

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveCloudflarePublishConnection, grantCloudflarePublishConnection, reserveCloudflarePublishBoxHost, attachCloudflarePublishBoxHost } from "../../../src/core/secrets/cloudflare-publish.js";

const secretDir = await mkdtemp(path.join(tmpdir(), "bbx-hostnames-"));
process.env.BBX_SECRETS_FILE = path.join(secretDir, "secrets.json");
const connection = "0123456789abcdef0123456789abcdef";
const now = "2026-09-25T12:00:00.000Z";
await saveCloudflarePublishConnection({ name: "main", accountId: connection, credentialType: "account-api-token", apiToken: "placeholder", tokenId: "token-id", verifiedAt: now });
await grantCloudflarePublishConnection({ name: "main", boxSlug: "box-a" });
await grantCloudflarePublishConnection({ name: "main", boxSlug: "box-b" });
const hostInput = { boxSlug: "box-a", connectionName: "main", hostname: "Sites.Example.org.", bucketName: "bucket-a", workerName: "worker-a", hostHandle: "box-host-a", createdAt: now };
```

An identical reservation is retryable, while other-box reuse and renaming are
refused. The mapping becomes attached only after an exact host readback.

```ts
const reserved = await reserveCloudflarePublishBoxHost(hostInput);
const retry = await reserveCloudflarePublishBoxHost({ ...hostInput, hostname: "sites.example.org" });
const duplicate = await Promise.resolve()
  .then(() => reserveCloudflarePublishBoxHost({ ...hostInput, boxSlug: "box-b", hostname: "sites.example.org", bucketName: "bucket-b", workerName: "worker-b", hostHandle: "box-host-b" }))
  .then(() => "allowed", (error) => error.message);
const rename = await Promise.resolve()
  .then(() => reserveCloudflarePublishBoxHost({ ...hostInput, hostname: "new.example.org" }))
  .then(() => "allowed", (error) => error.message);
const attached = await attachCloudflarePublishBoxHost({ boxSlug: "box-a", connectionName: "main", hostname: "sites.example.org" });
JSON.stringify({ canonical: reserved.hostname, retry: retry.status, duplicateRejected: duplicate.includes("already assigned"), renameRejected: rename.includes("cannot rename"), attached: attached.status })
=> {"canonical":"sites.example.org","retry":"pending","duplicateRejected":true,"renameRejected":true,"attached":"attached"}
```

```ts teardown
await rm(secretDir, { recursive: true, force: true });
delete process.env.BBX_SECRETS_FILE;
```
