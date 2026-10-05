# Pickers ask the same question the dispatchers answer

`serviceCapabilities` (`src/core/model-capabilities.ts`) tells the
HQ-transcription and TTS pickers which options this box can actually use,
derived from the same key-per-service facts `transcription/index.ts`'s
`dispatchHqTranscription` and `tts/resolve.ts`'s `resolveTtsService` use — so
the picker and the pass it configures can never disagree.

```ts setup
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serviceCapabilities } from "../../src/core/model-capabilities.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}
```

## No grants at all — nothing is usable

```ts
await useTempStore();
const box = await makeTmpBox();

const caps = await serviceCapabilities(box.root);
JSON.stringify(caps.hq.mai)
=> {"usable":false,"needs":["openrouter"]}

JSON.stringify(caps.hq.whisper)
=> {"usable":false,"needs":["openai-thinking","openrouter"]}

JSON.stringify(caps.hq["whisper-llm"])
=> {"usable":false,"needs":["openai-thinking","openrouter"]}

JSON.stringify(caps.hq["whisper-llm-mini"])
=> {"usable":false,"needs":["openai-thinking","openrouter"]}

JSON.stringify(caps.hq.voxtral)
=> {"usable":false,"needs":["mistral"]}

JSON.stringify(caps.hq["voxtral-diarized"])
=> {"usable":false,"needs":["mistral"]}

JSON.stringify(caps.hq["mai-diarized"])
=> {"usable":false,"needs":["openrouter"]}

JSON.stringify(caps.tts.openai)
=> {"usable":false,"needs":["openai-thinking"]}

JSON.stringify(caps.tts.gemini)
=> {"usable":false,"needs":["gemini","openrouter"]}
```

```ts cleanup
await box.cleanup();
```

## An `openrouter` grant lights up everything OpenRouter can reach

MAI has no direct arm, and the Whisper family and TTS `gemini` fall back to
OpenRouter. `voxtral` and TTS `openai` stay unusable —
neither has an OpenRouter path.

```ts
await useTempStore();
const box = await makeTmpBox();
const slug = await boxSlug(box.root);
await setSecret({ name: "openrouter", value: "sk-or-v1-placeholder" });
await grantSecret({ slug, name: "openrouter", access: "server" });

const caps = await serviceCapabilities(box.root);
caps.hq.mai.usable
=> true

caps.hq["mai-diarized"].usable
=> true

caps.hq.whisper.usable
=> true

caps.hq["whisper-llm"].usable
=> true

caps.hq["whisper-llm-mini"].usable
=> true

caps.tts.gemini.usable
=> true

caps.hq.voxtral.usable
=> false

caps.hq["voxtral-diarized"].usable
=> false

caps.tts.openai.usable
=> false
```

## Granting `mistral` on top makes `voxtral` usable too

```ts continue
await setSecret({ name: "mistral", value: "placeholder-mistral-key" });
await grantSecret({ slug, name: "mistral", access: "server" });

const caps2 = await serviceCapabilities(box.root);
caps2.hq.voxtral.usable
=> true

caps2.hq["voxtral-diarized"].usable
=> true

caps2.tts.openai.usable
=> false
```

```ts cleanup
await box.cleanup();
```

## A `gemini` grant alone reaches Gemini speech

Gemini speech has a direct arm, so the Google AI Studio key makes it usable
with no OpenRouter key at all. MAI stays unusable: it has no direct arm.

```ts
await useTempStore();
const box = await makeTmpBox();
await setSecret({ name: "gemini", value: "AIza-placeholder-gemini-key" });
await grantSecret({ slug: await boxSlug(box.root), name: "gemini", access: "server" });

const caps = await serviceCapabilities(box.root);
`${String(caps.tts.gemini.usable)} ${String(caps.hq.mai.usable)}`
=> true false
```

```ts cleanup
await box.cleanup();
```
