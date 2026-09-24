# Cloudflare site Workers deploy with pinned metadata bindings

The Worker upload uses the packaged JavaScript module and exact publication
bindings. This fake exercises multipart request construction only; no Cloudflare
account request is made.

```ts setup
import { createCloudflareWorkerDeployer } from "../../src/services/cloudflare-worker-deployer.js";
import { staticBearer } from "../../src/services/cloudflare-bearer.js";
```

The multipart upload binds a Worker to one bucket, PubId, host handle, and code
version. The API token is sent only as the bearer header.

```ts
let recorded;
const deployer = createCloudflareWorkerDeployer({
  accountId: "0123456789abcdef0123456789abcdef",
  bearer: staticBearer("placeholder-token"),
}, {
  fetch: async (url, init) => {
    recorded = { url, method: init.method, authorization: new Headers(init.headers).get("authorization"), form: init.body };
    return Response.json({ success: true });
  },
});
await deployer.deploy({
  scriptName: "bbx-site-example",
  bucketName: "bbx-pub-example",
  pubId: "abcdefghijklmnopqrstuvwxyz",
  hostHandle: "bbx-random-host",
  workerVersion: "a".repeat(64),
  bundle: new TextEncoder().encode("export default { fetch() { return new Response('ok') } }"),
});
const form = recorded.form;
JSON.stringify({
  url: recorded.url,
  method: recorded.method,
  authorization: recorded.authorization,
  metadata: JSON.parse(form.get("metadata")),
  module: await form.get("index.js").text(),
})
=> {"url":"https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts/bbx-site-example","method":"PUT","authorization":"Bearer placeholder-token","metadata":{"main_module":"index.js","compatibility_date":"2026-07-06","bindings":[{"type":"r2_bucket","name":"PUB_STORE","bucket_name":"bbx-pub-example"},{"type":"plain_text","name":"PUB_ID","text":"abcdefghijklmnopqrstuvwxyz"},{"type":"plain_text","name":"HOST_HANDLE","text":"bbx-random-host"},{"type":"plain_text","name":"PUB_WORKER_VERSION","text":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]},"module":"export default { fetch() { return new Response('ok') } }"}
```
