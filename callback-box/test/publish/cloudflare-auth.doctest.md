# Cloudflare auth resolution — env escape hatch vs the wrangler login

`resolveCloudflareAuth` (`docs/plans/pub-setup-wrangler.md` credential model):
the `CLOUDFLARE_API_TOKEN`+`CLOUDFLARE_ACCOUNT_ID` env pair wins when present
(wrangler's own precedence); otherwise the `wrangler login` identity. A
multi-account login is never guessed at — it must be disambiguated explicitly
and is validated against the actual memberships. All against the fake wrangler.

```ts setup
import { resolveCloudflareAuth } from "../../src/publish/cloudflare-auth.js";
import { normalizeTeamDomain } from "../../src/publish/publish-config.js";
import { wranglerBearer, WranglerAuthError } from "../../src/services/cloudflare-bearer.js";
import { createFakeWrangler } from "../../src/services/wrangler.js";

const ONE_ACCOUNT = { email: "owner@example.com", accounts: [{ id: "acct-1", name: "Personal" }] };
const TWO_ACCOUNTS = { email: "owner@example.com", accounts: [{ id: "acct-1", name: "Personal" }, { id: "acct-2", name: "Work" }] };
```

## Env pair wins over any wrangler login

```ts
const wrangler = createFakeWrangler({ identity: ONE_ACCOUNT });
const resolved = await resolveCloudflareAuth(
  {},
  { env: { CLOUDFLARE_API_TOKEN: "env-token", CLOUDFLARE_ACCOUNT_ID: "env-account" }, wrangler },
);
[resolved.ok, resolved.auth.kind, resolved.auth.accountId].join(" ")
=> true env env-account

await resolved.auth.bearer.get()
=> env-token

// Escape-hatch wrangler spawns re-inject the pair explicitly.
JSON.stringify(resolved.auth.deployEnv)
=> {"CLOUDFLARE_API_TOKEN":"env-token","CLOUDFLARE_ACCOUNT_ID":"env-account"}
```

## A single-account wrangler login resolves without flags

```ts
const wrangler = createFakeWrangler({ identity: ONE_ACCOUNT, token: "oauth-tok" });
const resolved = await resolveCloudflareAuth({}, { env: {}, wrangler });
[resolved.ok, resolved.auth.kind, resolved.auth.accountId].join(" ")
=> true wrangler acct-1

// The bearer rides `wrangler auth token`, cached until a refresh is forced.
await resolved.auth.bearer.get()
=> oauth-tok

JSON.stringify(resolved.auth.deployEnv)
=> {}
```

## Not logged in → the login instructions

```ts
const resolved = await resolveCloudflareAuth({}, { env: {}, wrangler: createFakeWrangler() });
[resolved.ok, resolved.reason].join(" ")
=> false not-logged-in

resolved.message.includes("wrangler login")
=> true
```

## Multi-account is never guessed

```ts
const wrangler = createFakeWrangler({ identity: TWO_ACCOUNTS });
const ambiguous = await resolveCloudflareAuth({}, { env: {}, wrangler });
[ambiguous.ok, ambiguous.reason].join(" ")
=> false ambiguous-account

ambiguous.message.includes("--account-id") && ambiguous.message.includes("acct-2")
=> true

// Explicit --account-id resolves it (validated against the memberships)...
const picked = await resolveCloudflareAuth({ accountId: "acct-2" }, { env: {}, wrangler });
[picked.ok, picked.auth.accountId].join(" ")
=> true acct-2

// ...and CLOUDFLARE_ACCOUNT_ID alone (no token) disambiguates the same way.
const viaEnv = await resolveCloudflareAuth({}, { env: { CLOUDFLARE_ACCOUNT_ID: "acct-1" }, wrangler });
[viaEnv.ok, viaEnv.auth.accountId].join(" ")
=> true acct-1

// An account the login can't see is a precise refusal, not a guess.
const unknown = await resolveCloudflareAuth({ accountId: "acct-9" }, { env: {}, wrangler });
[unknown.ok, unknown.reason].join(" ")
=> false unknown-account
```

## The wrangler bearer caches, refreshes on demand, and fails with the fix

```ts
const wrangler = createFakeWrangler({ identity: ONE_ACCOUNT, token: "tok" });
const bearer = wranglerBearer(wrangler);
await bearer.get();
await bearer.get();
// Two gets, one mint — the token is cached until a 401 forces a refresh.
wrangler.tokenCalls
=> 1

await bearer.refresh();
wrangler.tokenCalls
=> 2

// A dead login (revoked / never happened) names the fix.
const dead = wranglerBearer(createFakeWrangler());
await dead.get().catch((e) => e.name)
=> WranglerAuthError
```

## Team-domain normalization (the Worker needs the full https:// origin)

```ts
normalizeTeamDomain("myteam.cloudflareaccess.com")
=> https://myteam.cloudflareaccess.com

normalizeTeamDomain("https://myteam.cloudflareaccess.com")
=> https://myteam.cloudflareaccess.com

// Anything that doesn't normalize to the expected shape is refused (null),
// never deployed as a broken issuer.
JSON.stringify([normalizeTeamDomain("evil.example.com"), normalizeTeamDomain("https://sub.myteam.cloudflareaccess.com/extra")])
=> [null,null]
```
