# Cloudflare Worker custom-domain adapter uses documented API shapes

These tests exercise the v4 response/query/body boundary without a live Cloudflare
account. Zone pagination uses `result_info.total_pages`; Worker Domains are
filtered by hostname and attach with hostname/service/zone_id/zone_name.

```ts setup
import { createCloudflareProvisioningClient } from "../../../src/services/cloudflare-provisioning/core.js";
import { staticBearer } from "../../../src/services/cloudflare-bearer.js";

const calls = [];
const client = createCloudflareProvisioningClient(
  { accountId: "0123456789abcdef0123456789abcdef", bearer: staticBearer("test-token") },
  { fetch: async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.pathname === "/client/v4/zones") {
      const page = Number(url.searchParams.get("page"));
      return new Response(JSON.stringify({ success: true, result: [{ id: `zone-${page}`, name: page === 1 ? "example.com" : "sub.example.com", status: "active", account: { id: "0123456789abcdef0123456789abcdef" } }], result_info: { page, per_page: 50, total_pages: 2 } }), { status: 200 });
    }
    if (url.pathname.endsWith("/workers/domains") && init.method === "GET") {
      return new Response(JSON.stringify({ success: true, errors: null, messages: null, result: [{ id: "domain-id", hostname: "site.example.com", service: "bbx-site", environment: "production", zone_id: "zone-1", zone_name: "example.com" }], result_info: { page: 1, total_pages: 1 } }), { status: 200 });
    }
    if (url.pathname.endsWith("/workers/domains") && init.method === "PUT") {
      return new Response(JSON.stringify({ success: true, result: { id: "domain-id", hostname: "site.example.com", service: "bbx-site", environment: "production", zone_id: "zone-1", zone_name: "example.com" } }), { status: 200 });
    }
    throw new Error(`unexpected request ${init.method} ${url}`);
  } },
);
```

Zone pagination follows the documented `total_pages` field and caps each
request at 50 results.

```ts
const zones = await client.listZones();
JSON.stringify({ names: zones.map((zone) => zone.name), pages: calls.filter((call) => call.url.pathname === "/client/v4/zones").map((call) => call.url.searchParams.get("page")), perPage: calls[0].url.searchParams.get("per_page"), account: calls[0].url.searchParams.get("account.id") })
=> {"names":["example.com","sub.example.com"],"pages":["1","2"],"perPage":"50","account":"0123456789abcdef0123456789abcdef"}
```

Worker Domain list uses its exact-hostname filter and maps Cloudflare's snake
case response fields. Attach sends only the documented tuple and parses its
readback.

```ts
const found = await client.listWorkerDomains("site.example.com");
const attached = await client.attachWorkerDomain({ hostname: "site.example.com", service: "bbx-site", zoneId: "zone-1", zoneName: "example.com" });
const getCall = calls.find((call) => call.url.pathname.endsWith("/workers/domains") && call.init.method === "GET");
const putCall = calls.find((call) => call.url.pathname.endsWith("/workers/domains") && call.init.method === "PUT");
JSON.stringify({ hostnameFilter: getCall.url.searchParams.get("hostname"), found: found[0], put: JSON.parse(putCall.init.body), attached })
=> {"hostnameFilter":"site.example.com","found":{"id":"domain-id","hostname":"site.example.com","service":"bbx-site","environment":"production","zoneId":"zone-1","zoneName":"example.com"},"put":{"hostname":"site.example.com","service":"bbx-site","zone_id":"zone-1","zone_name":"example.com"},"attached":{"id":"domain-id","hostname":"site.example.com","service":"bbx-site","environment":"production","zoneId":"zone-1","zoneName":"example.com"}}
```

The API's informational `messages` value is not part of the adapter's consumed
contract, so unexpected non-null shapes remain ignored.

```ts continue
const informationalMessages = createCloudflareProvisioningClient(
  { accountId: "0123456789abcdef0123456789abcdef", bearer: staticBearer("test-token") },
  { fetch: async () => new Response(JSON.stringify({ success: true, errors: null, messages: { notice: true }, result: [] }), { status: 200 }) },
);
(await informationalMessages.listWorkerDomains("site.example.com")).length
=> 0
```

HTTP 200 error envelopes preserve only bounded, control-character-free Cloudflare
error codes and messages, so permission failures are diagnosable without dumping
an arbitrary response body.

```ts continue
const rejected = createCloudflareProvisioningClient(
  { accountId: "0123456789abcdef0123456789abcdef", bearer: staticBearer("test-token") },
  { fetch: async () => new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "missing permission\nplease check" }, { code: 2, message: "ignored" }], result: [] }), { status: 200 }) },
);
const providerError = await Promise.resolve().then(() => rejected.listZones()).then(() => null, (error) => ({ message: error.message, count: error.cfErrors.length }));
JSON.stringify(providerError)
=> {"message":"Cloudflare zone list failed: 200 Cloudflare rejected the request: [10000] missing permission please check, [2] ignored","count":2}
```
