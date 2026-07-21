# `GET /auth/google-services/callback` rejects grants without a valid state nonce

The callback persists the shared, broadly-scoped Google tokens and is registered
at server ROOT — reachable outside the per-box auth wall (and, under `cb hub`,
proxied like any request). Before the fix it trusted a caller-controlled `state`
and exchanged the `code` with no owner/nonce check: a credential-swap surface.
Now it requires a one-time nonce minted behind the owner wall by `googleSetup`;
an attacker-chosen `state` gets a 400 and no token exchange is even attempted.
See `issues/closed/bugs/2026-07-19-google-oauth-callback-unauthenticated.md`.

```ts setup
import { makeTestServer } from "../../helpers/doctest-server.js";
import { createGoogleOAuthState } from "../../../src/connectors/google-oauth-state.js";
import { signSession, COOKIE_NAME } from "../../../src/webapp/auth.js";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tokensFile = path.join(os.tmpdir(), `oauth-cb-tokens-${process.pid}-${Date.now()}.json`);
process.env.CB_GOOGLE_TOKENS_FILE = tokensFile;

function cb(query: string): { method: string; url: string } {
  return { method: "GET", url: `/auth/google-services/callback?${query}` };
}
```

## An attacker-chosen `state` (with a `code`) is rejected — no tokens written

```ts
const ctx = await makeTestServer();
// A forged state naming the real box, plus a plausible auth code.
const res = await ctx.rootRequest(cb("state=test:forged-nonce&code=attacker-code"));
res.statusCode
=> 400

// The shared token file was never created — no exchange happened.
existsSync(tokensFile)
=> false
```

## A missing / malformed `state` is rejected too

```ts continue
const noState = await ctx.rootRequest(cb("code=attacker-code"));
noState.statusCode
=> 400

// Legacy bare-slug and slug:returnPath shapes carry no minted nonce → rejected.
const legacy = await ctx.rootRequest(cb("state=test&code=x"));
legacy.statusCode
=> 400
```

## A genuine minted nonce passes the gate (and is single-use)

A nonce created via the owner-gated helper is accepted by the callback: with no
`code` present it reaches the "no code" branch (a 302 back to the box) rather
than the 400 rejection — proof the nonce cleared the security gate. Replaying it
then fails, because consumption is one-time.

```ts continue
const state = createGoogleOAuthState({ boxRoot: ctx.boxRoot, boxSlug: "test", returnPath: "admin", createdBy: null });

// Use the raw Fastify inject (a 302 has no JSON body for rootRequest to parse).
const accepted = await ctx.server.inject(cb(`state=${encodeURIComponent(state)}`));
accepted.statusCode
=> 302

// Replaying the now-consumed nonce is rejected.
const replay = await ctx.rootRequest(cb(`state=${encodeURIComponent(state)}&code=x`));
replay.statusCode
=> 400

await ctx.cleanup();
```

## An owner-bound nonce rejects a session that isn't the initiator

When the nonce was minted by an owner (`createdBy` set), the session completing
the callback must BE that owner. A stolen/leaked state completed by anyone else
— or by no session at all — is rejected (403) before any token exchange, closing
the owner-binding gap where hub mode checked only box access, not the initiator.

```ts
const ctx2 = await makeTestServer();
const ownerState = createGoogleOAuthState({ boxRoot: ctx2.boxRoot, boxSlug: "test", returnPath: "admin", createdBy: "owner@example.com" });

// Completed with NO session identity → mismatch → 403, no tokens written.
const anon = await ctx2.rootRequest(cb(`state=${encodeURIComponent(ownerState)}&code=x`));
print(`anon: ${anon.statusCode}`);
print(`tokens written: ${existsSync(tokensFile)}`);
=>
anon: 403
tokens written: false
```

A different signed-in user is likewise rejected (the nonce is single-use, so mint
a fresh one).

```ts continue
const strangerState = createGoogleOAuthState({ boxRoot: ctx2.boxRoot, boxSlug: "test", returnPath: "admin", createdBy: "owner@example.com" });
const strangerCookie = signSession({ email: "stranger@example.com", name: "Stranger" });
const stranger = await ctx2.rootRequest({
  method: "GET",
  url: `/auth/google-services/callback?state=${encodeURIComponent(strangerState)}&code=x`,
  headers: { cookie: `${COOKIE_NAME}=${strangerCookie}` },
});
stranger.statusCode
=> 403
```

The initiating owner completing the callback clears the gate (no `code` → 302
back to the box, not a 403).

```ts continue
const ownerState2 = createGoogleOAuthState({ boxRoot: ctx2.boxRoot, boxSlug: "test", returnPath: "admin", createdBy: "owner@example.com" });
const ownerCookie = signSession({ email: "owner@example.com", name: "Owner" });
const owner = await ctx2.server.inject({
  method: "GET",
  url: `/auth/google-services/callback?state=${encodeURIComponent(ownerState2)}`,
  headers: { cookie: `${COOKIE_NAME}=${ownerCookie}` },
});
owner.statusCode
=> 302

await ctx2.cleanup();
```

```ts cleanup
delete process.env.CB_GOOGLE_TOKENS_FILE;
```
