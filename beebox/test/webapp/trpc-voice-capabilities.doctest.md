# Voice pickers only offer what the box can use

`voice.capabilities` says, per HQ transcription service and TTS backend,
whether this box holds a credential that reaches it — the question the pickers
ask before offering a choice. Choosing an unusable service still saves (a key
may be granted later) but comes back with a warning the client must show.

```ts setup
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appRouter } from "../../src/webapp/trpc/router.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const noBus = { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} };
function owner(boxRoot) {
  return appRouter.createCaller({ boxRoot, boxSlug: "test", eventBus: noBus, services: {}, user: { email: "owner@example.com", name: "Owner" }, authed: true, isOwner: true, isAuthenticatedOwner: true });
}
```

## Nothing granted: everything is unusable, and each says what it needs

```ts
const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
const box = await makeTmpBox();
const caps = await owner(box.root).voice.capabilities();
JSON.stringify({ mai: caps.hq["mai-diarized"], gemini: caps.tts.gemini, whisper: caps.hq.whisper })
=> {"mai":{"usable":false,"needs":["openrouter"]},"gemini":{"usable":false,"needs":["openrouter"]},"whisper":{"usable":false,"needs":["openai-thinking","openrouter"]}}
```

Saving an unusable choice is allowed and warned about in the same response.

```ts continue
const chosen = await owner(box.root).transcription.setHqService({ hqService: "mai-diarized" });
`${chosen.hqService} — ${String(chosen.warning)}`
=> mai-diarized — This box has no key for mai-diarized yet; grant openrouter in Admin → Secrets or it will fail on every pass.
```

## One OpenRouter grant lights up everything it reaches

```ts continue
await setSecret({ name: "openrouter", value: "sk-or-v1-placeholder-placeholder-placeholder-placeholder" });
await grantSecret({ slug: await boxSlug(box.root), name: "openrouter", access: "server" });
const lit = await owner(box.root).voice.capabilities();
JSON.stringify({ mai: lit.hq["mai-diarized"].usable, gemini: lit.tts.gemini.usable, whisper: lit.hq.whisper.usable, voxtral: lit.hq.voxtral.usable, openaiTts: lit.tts.openai.usable })
=> {"mai":true,"gemini":true,"whisper":true,"voxtral":false,"openaiTts":false}

const ok = await owner(box.root).tts.setBackend({ backend: "gemini" });
`${ok.backend} — ${String(ok.warning)}`
=> gemini — null
```

```ts cleanup
await box.cleanup();
```
