# Google connector OAuth `state` nonce store

The Google-services OAuth callback persists shared, broadly-scoped Google tokens
and is reachable outside the per-box auth wall. `createGoogleOAuthState` (called
behind the owner wall in `googleSetup`) mints a one-time nonce the callback must
present back via `consumeGoogleOAuthState`; without a valid nonce the callback
rejects. See `src/connectors/google-oauth-state.ts`.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  createGoogleOAuthState,
  consumeGoogleOAuthState,
  parseOAuthState,
} from "../../src/connectors/google-oauth-state.js";

const boxRoot = await mkdtemp(path.join(os.tmpdir(), "oauth-state-"));
```

## `state` is `<boxSlug>:<nonce>`, and the nonce round-trips

```ts
const state = createGoogleOAuthState({ boxRoot, boxSlug: "ledger", returnPath: "admin", createdBy: "owner@example.com" });
const parsed = parseOAuthState(state);
JSON.stringify({ boxSlug: parsed.boxSlug, hasNonce: parsed.nonce.length > 0 })
=> {"boxSlug":"ledger","hasNonce":true}
```

## A valid nonce consumes exactly once (one-time use closes replay)

```ts continue
const first = consumeGoogleOAuthState({ boxRoot, nonce: parsed.nonce });
JSON.stringify(first)
=> {"returnPath":"admin","createdBy":"owner@example.com"}

// Replaying the same nonce fails — it was consumed.
consumeGoogleOAuthState({ boxRoot, nonce: parsed.nonce })
=> null
```

## An unknown / attacker-chosen nonce is rejected

```ts continue
consumeGoogleOAuthState({ boxRoot, nonce: "not-a-real-nonce" })
=> null

consumeGoogleOAuthState({ boxRoot, nonce: "" })
=> null
```

## Legacy stateless shapes carry no nonce, so they no longer authorize

```ts continue
parseOAuthState("ledger")
=> null

parseOAuthState("ledger:admin") === null
=> false
```

`parseOAuthState` treats everything after the first colon as the nonce, so the
legacy `boxSlug:returnPath` shape parses to a nonce of `"admin"` — which is not a
real minted nonce, so `consumeGoogleOAuthState` rejects it:

```ts continue
const legacy = parseOAuthState("ledger:admin");
consumeGoogleOAuthState({ boxRoot, nonce: legacy.nonce })
=> null
```

## An expired nonce is pruned and rejected

```ts continue
const storePath = path.join(boxRoot, ".callback-box", "google-oauth-state.secret.json");
await mkdir(path.dirname(storePath), { recursive: true });
// Hand-write an already-expired record (nonceHash is sha256 of "stale-nonce").
const staleHash = createHash("sha256").update("stale-nonce").digest("hex");
await writeFile(storePath, JSON.stringify({ pending: [{ nonceHash: staleHash, returnPath: "admin", createdBy: null, createdAt: 1, expiresAt: 2 }] }));

consumeGoogleOAuthState({ boxRoot, nonce: "stale-nonce" })
=> null
```

```ts cleanup
await rm(boxRoot, { recursive: true, force: true });
```
