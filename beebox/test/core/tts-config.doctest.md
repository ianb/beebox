# TTS backend config

Which engine the box speaks with, in `_config/tts.json`. Same shape as the
transcription config next door — absent means defaults, writes are serialized,
and a corrupted file is loud.

```ts setup
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { loadTtsConfig, updateTtsConfig } from "../../src/core/tts/config.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

## A box that never chose keeps sounding the same

The default is `openai`, and that is the point: shipping backend selection must
not change what an existing box sounds like, whatever keys it happens to hold.

```ts
const box = await makeTmpBox();
JSON.stringify(await loadTtsConfig(box.root))
=> {"backend":"openai"}
```

```ts cleanup
await box.cleanup();
```

## Choosing a backend writes it, and reads back

```ts
const box = await makeTmpBox();
JSON.stringify(await updateTtsConfig(box.root, { backend: "gemini" }))
=> {"backend":"gemini"}

JSON.stringify(await loadTtsConfig(box.root))
=> {"backend":"gemini"}
```

```ts cleanup
await box.cleanup();
```

## A hand-edited file with an unknown backend fails loudly

The boxholder can edit this by hand, and a typo must not silently fall back to
the default — that would be a box speaking in a voice nobody chose.

```ts
const box = await makeTmpBox();
await fs.mkdir(path.join(box.root, "_config"), { recursive: true });
await fs.writeFile(path.join(box.root, "_config/tts.json"), '{"backend":"elevenlabs"}\n');
await loadTtsConfig(box.root).then(() => "no throw", (e) => e.constructor.name)
=> ZodError
```

```ts cleanup
await box.cleanup();
```

## An unreadable file is not "no config"

Absent means defaults; malformed JSON means something is wrong and should be
seen.

```ts
const box = await makeTmpBox();
await fs.mkdir(path.join(box.root, "_config"), { recursive: true });
await fs.writeFile(path.join(box.root, "_config/tts.json"), "{not json\n");
await loadTtsConfig(box.root).then(() => "no throw", () => "threw")
=> threw
```

```ts cleanup
await box.cleanup();
```

## No box root at all resolves to the default

`loadTtsConfig()` is called from paths that may have no box in scope; it
answers rather than throwing.

```ts
JSON.stringify(await loadTtsConfig(undefined))
=> {"backend":"openai"}
```
