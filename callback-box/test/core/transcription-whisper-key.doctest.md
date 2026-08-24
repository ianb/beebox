# The Whisper path resolves its key through the store

`core/transcription/index.ts` was the last consumer still reading
`THINKING_OPENAI_API_KEY` from the environment directly. It now goes through
`getOpenAiThinkingKey(boxRoot)` like its siblings — the machine secret store's
`openai-thinking` entry first, the env var as the transition fallback
(`docs/plans/secret-custody.md`, Track 3).

`boxRoot` was already on `TranscribeAudioParams`, so nothing above changed
shape; a caller that omits it has no box whose grants to check and gets the env
path only.

Values below are obvious placeholders. The success path is not exercised here —
it would mean an outbound call to OpenAI — so this covers the refusal an
unconfigured box gets, plus the ordering of the shared reader the Whisper path
now calls.

```ts setup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcribeAudioHq } from "../../src/core/transcription/index.js";
import { getOpenAiThinkingKey } from "../../src/core/openai-thinking-key.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "cb-whisper-secrets-"));
  process.env.CB_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}
```

## No grant and no env var: a refusal naming the grant to ask for

The message is the one the boxholder acts on, not the old bare env-var name.

```ts
const dir = await useTempStore();
const box = await makeTmpBox();
delete process.env.THINKING_OPENAI_API_KEY;

let failure;
try {
  await transcribeAudioHq(
    { audioBuffer: Buffer.from("not really audio"), filename: "memo.webm", boxRoot: box.root },
    { service: "whisper" },
  );
} catch (e) {
  failure = e;
}
print(`${failure.name} permanent=${failure.permanent} code=${failure.code}`);
print(failure.message);
=>
MissingWhisperKeyError permanent=true code=missing_api_key
No OpenAI key for transcription — ask the boxholder to grant the "openai-thinking" secret to this box, or set THINKING_OPENAI_API_KEY
```

## The store wins over the env var; the env var is the fallback

This is the reader the Whisper path now calls, exercised against the same box.

```ts continue
const slug = await boxSlug(box.root);
process.env.THINKING_OPENAI_API_KEY = "placeholder-whisper-env-key";
print(`ungranted: ${await getOpenAiThinkingKey(box.root, { observe: true })}`);

await setSecret({ name: "openai-thinking", value: "placeholder-whisper-store-key" });
await grantSecret({ slug, name: "openai-thinking", access: "server" });
print(`granted: ${await getOpenAiThinkingKey(box.root, { observe: true })}`);

delete process.env.THINKING_OPENAI_API_KEY;
print(`no env, no box: ${await getOpenAiThinkingKey(undefined, { observe: true })}`);
=>
ungranted: placeholder-whisper-env-key
granted: placeholder-whisper-store-key
no env, no box: null
```

```ts cleanup
await box.cleanup();
await rm(dir, { recursive: true, force: true });
delete process.env.THINKING_OPENAI_API_KEY;
```
