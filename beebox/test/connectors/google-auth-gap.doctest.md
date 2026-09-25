# Why Google auth is unavailable, said out loud

`getGoogleAuth` returns `null` for four unrelated situations, and every caller
printed one sentence for all of them: *"Google auth not configured. Run: bbx
google-auth."*

That sentence is wrong for three of the four, and it cost real work. On
2026-09-14 a boxholder reauthorized twice against a grant that was already
healthy, because a box agent's shell could not see the token file and the only
thing the system said was "not configured, run google-auth". Reauthorizing cannot
fix a process looking in the wrong place — the message is what sent them there.

```ts setup
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { explainGoogleAuthGap } from "../../src/connectors/google-auth-gap.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const tmp = await mkdtemp(path.join(os.tmpdir(), "google-auth-gap-"));

async function grantedBox() {
  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);
  for (const name of ["google-oauth-client-id", "google-oauth-client-secret"]) {
    await setSecret({ name, value: `placeholder-${name}` });
    await grantSecret({ slug, name, access: "server" });
  }
  return box;
}
```

## No credential grant: the refusal explains itself

`resolveSecret` returns typed refusals carrying, in its own words, "a message
written for RELAY: the box agent reads it out to the boxholder".
`getBoxGoogleClientCreds` dropped them. Now one reaches the surface.

```ts
const bare = await makeTmpBox();
delete process.env.BBX_GOOGLE_TOKENS_FILE;
const ungranted = await explainGoogleAuthGap(bare.root);
[ungranted.startsWith("Google auth unavailable:"), ungranted.includes("google-oauth-client-id")].join(",")
=> true,true
```

```ts continue
await bare.cleanup();
```

## The expensive case: credentials fine, no token file HERE

The grant is healthy and the services authenticate; this process simply looks
somewhere else. The message has to say so, and has to say that authorizing again
will not help — that is the sentence that was missing.

```ts continue
const box = await grantedBox();
delete process.env.BBX_GOOGLE_TOKENS_FILE;
const gap = await explainGoogleAuthGap(box.root);
[
  gap.includes("no token file where this process looks"),
  gap.includes("BBX_GOOGLE_TOKENS_FILE is not set in this process"),
  gap.includes("reauthorizing will not help"),
].join(",")
=> true,true,true
```

It never tells this caller to run `bbx google-auth`, which is the whole point:

```ts continue
gap.includes("Run: bbx google-auth")
=> false
```

## A token file that exists but cannot be read is a different problem

Present-but-unparseable is a machine problem, not a grant problem, so it does not
borrow either of the other two answers.

```ts continue
process.env.BBX_GOOGLE_TOKENS_FILE = path.join(tmp, "broken-tokens.json");
await writeFile(process.env.BBX_GOOGLE_TOKENS_FILE, "{ not json");
const broken = await explainGoogleAuthGap(box.root);
[broken.includes("could not be read"), broken.includes("reauthorizing will not help")].join(",")
=> true,false
```

## Called without a box, it says that rather than guessing

```ts continue
await explainGoogleAuthGap(undefined)
=> Google auth needs a box; this command ran without one.
```

```ts continue
await box.cleanup();
```
