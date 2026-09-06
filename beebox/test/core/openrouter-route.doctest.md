# OpenRouter is a fallback, never an override

`routeVia` (`src/core/openrouter.ts`) decides, for one workload, whether a
request goes to the service's own provider or through OpenRouter. The rule is
one sentence and these tests are the whole of it: **a service's own key wins.**

Adding an OpenRouter key must never change what an already-working box does.
For semantic search that is not a preference — the embedder's identity is
hashed into every card's embed record, so a route that quietly changed the
vectors would invalidate an index nobody asked to rebuild. Consolidating is
therefore an explicit act: remove the direct key, and the service falls
through.

```ts setup
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { routeVia, getOpenRouterKey } from "../../src/core/openrouter.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}
```

## With no key at all, there is no route

A workload with neither credential is not broken — it is unconfigured, which is
the state every caller here already handles by degrading (text-only search, the
Claude scan backend, a CLI that says what to grant).

```ts
await useTempStore();
const box = await makeTmpBox();
const slug = await boxSlug(box.root);

const nothing = await routeVia({ boxRoot: box.root, purpose: "embeddings", directKey: null });
JSON.stringify(nothing)
=> null
```

## The direct key alone routes direct

```ts
await useTempStore();
const box = await makeTmpBox();

const direct = await routeVia({ boxRoot: box.root, purpose: "embeddings", directKey: "placeholder-openai-key" });
JSON.stringify(direct)
=> {"via":"direct","apiKey":"placeholder-openai-key"}
```

## The OpenRouter key alone routes through OpenRouter

```ts
await useTempStore();
const box = await makeTmpBox();
const slug = await boxSlug(box.root);

await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
await grantSecret({ slug, name: "openrouter", access: "server" });

const fallback = await routeVia({ boxRoot: box.root, purpose: "embeddings", directKey: null });
JSON.stringify(fallback)
=> {"via":"openrouter","apiKey":"placeholder-openrouter-key"}
```

## Both present: the direct key still wins

This is the case the decision is about. The OpenRouter key is granted and
usable, and it is not used — the box keeps the provider it already had.

```ts
await useTempStore();
const box = await makeTmpBox();
const slug = await boxSlug(box.root);

await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
await grantSecret({ slug, name: "openrouter", access: "server" });

const both = await routeVia({ boxRoot: box.root, purpose: "embeddings", directKey: "placeholder-openai-key" });
print(`route: ${JSON.stringify(both)}`);
print(`openrouter key is genuinely available: ${await getOpenRouterKey(box.root, { purpose: "embeddings", observe: false })}`);
=>
route: {"via":"direct","apiKey":"placeholder-openai-key"}
openrouter key is genuinely available: placeholder-openrouter-key
```

## An ungranted OpenRouter key is not a route

Storing a secret on the machine is not granting it to a box, and there is no
further arm to fall to — the box is simply unconfigured.

```ts
await useTempStore();
const box = await makeTmpBox();

await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
const ungranted = await routeVia({ boxRoot: box.root, purpose: "embeddings", directKey: null });
JSON.stringify(ungranted)
=> null
```

There is no env-var arm and no legacy file: secret custody retired both for
every provider key, so a credential introduced after that migration is
store-only from the start rather than born with a deprecated path.

```ts
await useTempStore();
const box = await makeTmpBox();
process.env.BBX_OPENROUTER_API_KEY = "placeholder-env-openrouter-key";

const ignored = await routeVia({ boxRoot: box.root, purpose: "embeddings", directKey: null });
delete process.env.BBX_OPENROUTER_API_KEY;
JSON.stringify(ignored)
=> null
```
