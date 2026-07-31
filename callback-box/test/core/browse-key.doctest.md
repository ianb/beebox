# The local-dev browse key (`CB_BROWSE_API_KEY`)

`verifyBrowseKey` (`src/core/browse-key.ts`) is the shared check behind four
call sites — the box's own wall and tRPC context, the hub's proxy/upgrade gate,
the hub's `/api/boxes`, and the dev router's credential resolvers. It grants
full machine-wide access, so the property that makes it safe is that it is
opt-in: with the env var unset it must be a constant `false` everywhere, on
every input. That is what these tests exist to keep from regressing.

Scope note: this file tests **the predicate only**, not the gates that call it.
Each gate's own wiring — that it consults this at all, and in the right place —
is not covered here; the end-to-end check that it is lives in
`docs/plans/agent-token-browser-auth.md`.

It is header-shaped rather than Fastify-shaped precisely so every call site —
several of which see a raw `http.IncomingMessage` — shares one implementation.

```ts setup
import { verifyBrowseKey, BROWSE_KEY_COOKIE } from "../../src/core/browse-key.js";

const KEY = "test-browse-key-0123456789";
const bearer = { authorization: `Bearer ${KEY}` };
const cookie = { cookie: `${BROWSE_KEY_COOKIE}=${KEY}` };
```

## Unset env: refused on every shape, including a correct-looking key

The fail-closed default. A deployment that never sets the variable cannot be
reached with this credential no matter what a caller sends.

```ts
delete process.env.CB_BROWSE_API_KEY;

JSON.stringify([
  verifyBrowseKey({}),
  verifyBrowseKey(bearer),
  verifyBrowseKey(cookie),
])
=> [false,false,false]
```

An empty string is "unset", not "the empty key" — otherwise `CB_BROWSE_API_KEY=`
in a `.env` would authenticate a request carrying no credential at all.

```ts
process.env.CB_BROWSE_API_KEY = "";

JSON.stringify([verifyBrowseKey({}), verifyBrowseKey({ cookie: `${BROWSE_KEY_COOKIE}=` })])
=> [false,false]
```

## Set env: accepted from a bearer header OR a cookie

Both, for different callers: `bin/browse` sends the cookie (a browser attaches
it to the WebSocket upgrade, where an `Authorization` header never rides), while
a `curl` probe sends the header.

```ts
process.env.CB_BROWSE_API_KEY = KEY;

JSON.stringify([verifyBrowseKey(bearer), verifyBrowseKey(cookie)])
=> [true,true]
```

## A wrong, absent, or malformed credential is refused

Including the near-misses: right key under the wrong cookie name, right value
without the `Bearer ` scheme, and a prefix of the real key.

```ts
process.env.CB_BROWSE_API_KEY = KEY;

JSON.stringify([
  verifyBrowseKey({}),
  verifyBrowseKey({ authorization: `Bearer ${KEY}x` }),
  verifyBrowseKey({ authorization: KEY }),
  verifyBrowseKey({ cookie: `other_cookie=${KEY}` }),
  verifyBrowseKey({ cookie: `${BROWSE_KEY_COOKIE}=${KEY.slice(0, -1)}` }),
])
=> [false,false,false,false,false]
```

## A repeated header value is not a credential

Node hands back an array when a header arrives more than once. Only a single
value can be a credential — an array is treated as absent rather than being
joined or having its first element trusted.

```ts
process.env.CB_BROWSE_API_KEY = KEY;

JSON.stringify(verifyBrowseKey({ authorization: [`Bearer ${KEY}`, "Bearer other"] }))
=> false
```

## A non-ASCII key refuses rather than throwing

`crypto.timingSafeEqual` throws on a length mismatch, and equal JS string length
is not equal byte length. Comparing `.length` instead of `byteLength` let a
same-character-length ASCII value reach it and throw out of an auth check —
turning a refusal into a 500.

```ts
process.env.CB_BROWSE_API_KEY = "kéy-with-non-ascii";

// Same character count as the key, different byte count.
JSON.stringify(verifyBrowseKey({ authorization: "Bearer key-with-non-asciiX".slice(0, 25) }))
=> false
```

The non-ASCII key still works when supplied correctly.

```ts
process.env.CB_BROWSE_API_KEY = "kéy-with-non-ascii";

JSON.stringify(verifyBrowseKey({ authorization: "Bearer kéy-with-non-ascii" }))
=> true
```

## Every value under the cookie name is checked, not just the first

Boxes are path siblings on one origin, so a browser can send several
`cb_browse_key` entries — one per matching path, most-specific first. The one we
want is not reliably first, so a first-entry-only check would refuse a request
that legitimately carries the key.

```ts
process.env.CB_BROWSE_API_KEY = KEY;

JSON.stringify(verifyBrowseKey({ cookie: `${BROWSE_KEY_COOKIE}=stale; ${BROWSE_KEY_COOKIE}=${KEY}` }))
=> true
```
