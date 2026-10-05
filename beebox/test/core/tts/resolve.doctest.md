# Which key speaks for each backend

`resolveTtsService` (`src/core/tts/resolve.ts`) turns the box's chosen backend
and its granted keys into a service. Each backend takes exactly one key. For
Gemini that is the `gemini` key: OpenRouter serves the same model but cannot
carry style direction to it, so an OpenRouter key deliberately does not stand
in. No request is sent here.

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

## The `gemini` key speaks Gemini

```ts
const box = await geminiBox(["gemini"]);
const tts = await resolveTtsService(box.root);
({ backend: tts.backend, stylable: tts.stylable })
=> { backend: "gemini", stylable: true }
```

```ts cleanup
await box.cleanup();
```

## An OpenRouter key alone does not, and the error says why

Through OpenRouter, Gemini 3.8 would lose the personality card's speaking
style without any audible sign. A missing key that names itself is the
better failure.

```ts
const box = await geminiBox(["openrouter"]);
await resolveTtsService(box.root)
=> throws TtsNotConfiguredError: TTS backend "gemini" needs a Google AI Studio key. Grant the "gemini" secret to this box, or choose a different TTS backend. An OpenRouter key does not stand in: through OpenRouter the speaking style is lost.
```

```ts cleanup
await box.cleanup();
```
