# Publication ids

A pub-id names one publication across its `publication` card, its
R2 keys under `pubs/<pub-id>/`, and the Worker routes. For the `secret` tier the
id is the capability token, so its shape and entropy are part of the contract.

```ts setup
import { generatePubId, pubIdSchema } from "../../src/publish/manifest.js";
```

## `generatePubId` produces a value the schema accepts

The id is 26 base32 characters, and two calls differ (128 bits of entropy make a
collision cryptographically impossible). We assert shape, not the random value.

```ts
const id = generatePubId();
id.length
=> 26

pubIdSchema.safeParse(id).success
=> true

generatePubId() === generatePubId()
=> false
```

A malformed id (uppercase, wrong length, out-of-alphabet) is rejected.

```ts
pubIdSchema.safeParse("TOO-SHORT").success
=> false

pubIdSchema.safeParse("ABCDEFGHIJKLMNOP2345672345").success
=> false

pubIdSchema.safeParse("abcdefghijklmnop2345672341").success
=> false
```
