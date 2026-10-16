# Cloudflare site Workers deploy with pinned metadata bindings

The Worker upload uses the packaged JavaScript module and exact publication
bindings. This fake exercises multipart request construction only; no Cloudflare
account request is made.

```ts setup
import { createCloudflareWorkerDeployer } from "../../../src/services/managed-publication-runtime/worker-deployer.js";
import { staticBearer } from "../../../src/services/cloudflare-bearer.js";
import assert from "node:assert/strict";
```

The multipart upload binds a Worker to one bucket, PubId, host handle, and code
version. The API token is sent only as the bearer header.

```ts
const requests: Array<{ url: string; method: string | undefined; authorization: string | null; form: RequestInit["body"] }> = [];
const deployer = createCloudflareWorkerDeployer({
  accountId: "0123456789abcdef0123456789abcdef",
  bearer: staticBearer("placeholder-token"),
}, {
  fetch: async (url, init) => {
    requests.push({ url, method: init?.method, authorization: new Headers(init?.headers).get("authorization"), form: init?.body });
    return Response.json({ success: true });
  },
});
await deployer.deploy({
  mode: "pinned",
  scriptName: "bbx-site-example",
  bucketName: "bbx-pub-example",
  pubId: "abcdefghijklmnopqrstuvwxyz",
  hostHandle: "bbx-random-host",
  workerVersion: "a".repeat(64),
  bundle: new TextEncoder().encode("export default { fetch() { return new Response('ok') } }"),
});
const recorded = requests[0];
const form = recorded?.form;
assert.ok(form instanceof FormData, "the upload body is multipart form data");
const moduleFile = form.get("index.js");
assert.ok(moduleFile instanceof Blob, "the upload carries index.js");
JSON.stringify({
  url: recorded?.url,
  method: recorded?.method,
  authorization: recorded?.authorization,
  metadata: JSON.parse(String(form.get("metadata"))),
  module: await moduleFile.text(),
})
=> {"url":"https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts/bbx-site-example","method":"PUT","authorization":"Bearer placeholder-token","metadata":{"main_module":"index.js","compatibility_date":"2026-07-06","bindings":[{"type":"r2_bucket","name":"PUB_STORE","bucket_name":"bbx-pub-example"},{"type":"plain_text","name":"PUB_ID","text":"abcdefghijklmnopqrstuvwxyz"},{"type":"plain_text","name":"HOST_HANDLE","text":"bbx-random-host"},{"type":"plain_text","name":"PUB_WORKER_VERSION","text":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]},"module":"export default { fetch() { return new Response('ok') } }"}
```
