# OpenAI Audio service

Fake OpenAI Audio records transcription and TTS calls, returning placeholder responses.

```ts setup
import { createFakeOpenAIAudio } from "../src/services/openai-audio.js";
```

## Transcription returns configured text

```
const svc = createFakeOpenAIAudio({ transcriptionText: "Hello world" });
const result = await svc.transcribe(Buffer.from("audio data"));
result.text
=> Hello world
```

``` continue
result.language
=> en
```

## Transcription records calls

```
const svc = createFakeOpenAIAudio();
await svc.transcribe(Buffer.from("data"), { filename: "test.webm", prompt: "English" });
svc.transcriptions.length
=> 1
```

``` continue
svc.transcriptions[0]?.filename
=> test.webm
```

## TTS returns audio buffer

```
const svc = createFakeOpenAIAudio();
const result = await svc.textToSpeech("Say this");
result.contentType
=> audio/mpeg
```

``` continue
result.audio.length > 0
=> true
```

## TTS records calls

```
const svc = createFakeOpenAIAudio();
await svc.textToSpeech("Hello", { voice: "nova" });
await svc.textToSpeech("Goodbye");
svc.speeches.length
=> 2
```

``` continue
svc.speeches[0]?.voice
=> nova
```

``` continue
svc.speeches[1]?.text
=> Goodbye
```
