# Which key speaks for the Gemini backend

`resolveTtsService` (`src/core/tts/resolve.ts`) turns the box's chosen backend
and its granted keys into a service. Gemini speech is reachable two ways: the
`gemini` key goes to Google directly, the `openrouter` key goes through
OpenRouter, and each key only ever reaches its own host. These examples read
the route back from `stylable`, because only the direct route can apply
speaking style (`style.ts`). No request is sent.

```ts setup
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTtsService } from "../../../src/core/tts/resolve.js";
import { updateTtsConfig } from "../../../src/core/tts/config.js";
import { grantSecret, setSecret } from "../../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../../src/lib/box-slug.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

/** A fresh secret store and a box set to speak with Gemini, holding `grants`. */
async function geminiBox(grants) {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  const box = await makeTmpBox();
  await updateTtsConfig(box.root, { backend: "gemini" });
  const values = { gemini: "AIza-placeholder-gemini-key", openrouter: "sk-or-v1-placeholder-placeholder-placeholder-placeholder" };
  for (const name of grants) {
    await setSecret({ name, value: values[name] });
    await grantSecret({ slug: await boxSlug(box.root), name, access: "server" });
  }
  return box;
}
```

## Either key alone is enough

A `gemini` key alone speaks direct, where style is applied.

```ts
const direct = await geminiBox(["gemini"]);
(await resolveTtsService(direct.root)).stylable
=> true
```

```ts cleanup
await direct.cleanup();
```

An `openrouter` key alone speaks through OpenRouter, where it is not.

```ts
const viaOr = await geminiBox(["openrouter"]);
(await resolveTtsService(viaOr.root)).stylable
=> false
```

```ts cleanup
await viaOr.cleanup();
```

## With both granted, the direct key wins

Same model and price on both routes, but style works only direct, and the
direct route finished sooner when measured. Granting OpenRouter on top of a
Gemini key must not quietly lose the boxholder's speaking style.

```ts
const both = await geminiBox(["gemini", "openrouter"]);
(await resolveTtsService(both.root)).stylable
=> true
```

```ts cleanup
await both.cleanup();
```

## Neither key: the error names both fixes

```ts
const none = await geminiBox([]);
await resolveTtsService(none.root)
=> throws TtsNotConfiguredError: TTS backend "gemini" needs a Google AI Studio key or an OpenRouter key. Grant the "gemini" secret (preferred: speaking style works only there) or the "openrouter" secret to this box, or choose a different TTS backend.
```

```ts cleanup
await none.cleanup();
```
