# Transcription config: realtime + HQ

`src/core/transcription.ts` owns the per-box transcription config. Two
independent settings: `service` (realtime/batch — voxtral/deepgram/whisper)
and `hqService` (narration-mode checkpoint HQ pass — whisper/voxtral).
Stored at `config/transcription.json`.

```ts setup
import {
  loadTranscriptionConfig,
  updateTranscriptionConfig,
} from "../../src/core/transcription.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

## Defaults

With no box: defaults for both fields.

```ts
const cfg = await loadTranscriptionConfig();
JSON.stringify(cfg)
=> {"service":"voxtral","hqService":"whisper"}
```

With a box and no config file: same defaults, but read from a missing path.

```ts
const box = await makeTmpBox();
JSON.stringify(await loadTranscriptionConfig(box.root))
=> {"service":"voxtral","hqService":"whisper"}
```

```ts cleanup
await box.cleanup();
```

## Partial updates merge

Setting just `service` preserves `hqService` (which falls back to default).

```ts
const box = await makeTmpBox();
await updateTranscriptionConfig(box.root, { service: "deepgram" });
JSON.stringify(await loadTranscriptionConfig(box.root))
=> {"service":"deepgram","hqService":"whisper"}
```

```ts cleanup
await box.cleanup();
```

Setting just `hqService` preserves `service`.

```ts
const box = await makeTmpBox();
await updateTranscriptionConfig(box.root, { service: "voxtral" });
await updateTranscriptionConfig(box.root, { hqService: "voxtral" });
JSON.stringify(await loadTranscriptionConfig(box.root))
=> {"service":"voxtral","hqService":"voxtral"}
```

```ts cleanup
await box.cleanup();
```

## Legacy config with only `service` reads cleanly

A pre-existing config file with just `service` should still load — the
new `hqService` field is optional and defaults to `whisper`.

```ts
const box = await makeTmpBox();
await box.write("config/transcription.json", '{"service":"deepgram"}\n');
JSON.stringify(await loadTranscriptionConfig(box.root))
=> {"service":"deepgram","hqService":"whisper"}
```

```ts cleanup
await box.cleanup();
```
