# OpenAI Audio service

Fake OpenAI Audio records TTS calls, returning placeholder responses.

```ts setup
import { createFakeOpenAIAudio } from "../../src/services/openai-audio.js";
```

## TTS returns audio buffer

```ts
const svc = createFakeOpenAIAudio();
const result = await svc.textToSpeech("Say this");
result.contentType
=> audio/mpeg
```

```ts continue
result.audio.length > 0
=> true
```

## TTS records calls

```ts
const svc = createFakeOpenAIAudio();
await svc.textToSpeech("Hello", { voice: "nova" });
await svc.textToSpeech("Goodbye");
svc.speeches.length
=> 2
```

```ts continue
svc.speeches[0]?.voice
=> nova
```

```ts continue
svc.speeches[1]?.text
=> Goodbye
```
