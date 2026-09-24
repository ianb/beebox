# Cloudflare publishing token verification supports user and account tokens

Cloudflare supports user tokens and account tokens. User tokens are verified
separately and require an account-scoped R2 read to confirm the selected account.

```ts setup
import { createCloudflarePublishTokenVerifier } from "../../src/services/cloudflare-publish-token-verifier.js";
```

An account token is verified against the chosen account.

```ts
const requests = [];
const verifier = createCloudflarePublishTokenVerifier({
  fetch: async (url, init) => {
    requests.push({ url, authorization: new Headers(init?.headers).get("authorization") });
    return Response.json({ success: true, result: { id: "token-id", status: "active" } });
  },
});
const result = await verifier.verify({ accountId: "0123456789abcdef0123456789abcdef", apiToken: "placeholder-token" });
JSON.stringify({ result, request: requests[0] })
=> {"result":{"tokenId":"token-id","status":"active","tokenType":"account-api-token"},"request":{"url":"https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/tokens/verify","authorization":"Bearer placeholder-token"}}
```

A user token follows the user-verification endpoint, then a read-only R2 list
confirms its access to the selected account.

```ts continue
const userRequests = [];
const userVerifier = createCloudflarePublishTokenVerifier({
  fetch: async (url, init) => {
    userRequests.push({ url, method: init?.method });
    if (url.endsWith("/user/tokens/verify")) return Response.json({ success: true, result: { id: "user-token-id", status: "active" } });
    if (url.includes("/r2/buckets?")) return Response.json({ success: true, result: [] });
    return new Response("not available", { status: 403 });
  },
});
const userResult = await userVerifier.verify({ accountId: "0123456789abcdef0123456789abcdef", apiToken: "placeholder-user-token" });
JSON.stringify({ type: userResult.tokenType, calls: userRequests.map((r) => r.url.includes("/user/tokens/verify") ? "user-verify" : r.url.includes("/r2/buckets?") ? "r2-list" : "account-verify") })
=> {"type":"user-api-token","calls":["account-verify","user-verify","r2-list"]}
```

Invalid credentials are rejected without echoing the token.

```ts continue
const disabled = createCloudflarePublishTokenVerifier({
  fetch: async () => Response.json({ success: true, result: { id: "token-id", status: "disabled" } }),
});
await disabled.verify({ accountId: "0123456789abcdef0123456789abcdef", apiToken: "placeholder-token" }).then(
  () => "accepted",
  (error) => `${error.message} / leaks token=${error.message.includes("placeholder-token")}`,
)
=> Cloudflare did not verify an active API token. / leaks token=false
```
