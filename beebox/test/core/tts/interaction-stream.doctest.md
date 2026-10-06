# Reading audio from a streamed Gemini answer

Gemini speech is always requested as a stream, and each audio chunk goes on to
the MP3 encoder as it arrives. `interactionAudioChunks`
(`src/core/tts/interaction-stream.ts`) reads the server-sent events and yields
only the audio.

```ts setup
import { interactionAudioChunks } from "../../../src/core/tts/interaction-stream.js";

/** Every chunk the stream yields, joined. */
async function collectInteractionAudio(body) {
  const chunks = [];
  for await (const chunk of interactionAudioChunks(body)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** A byte stream that delivers `text` in the given pieces, as a network would. */
function streamOf(...pieces) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
}

const audioEvent = (bytes) =>
  `event: step.delta\ndata: ${JSON.stringify({ event_type: "step.delta", delta: { type: "audio", data: Buffer.from(bytes).toString("base64") } })}\n\n`;
```

## Audio deltas join in order; everything else is skipped

The lifecycle events around the audio carry no samples and are ignored.

```ts
const body = [
  `event: interaction.created\ndata: {"event_type":"interaction.created"}\n\n`,
  `event: step.start\ndata: {"event_type":"step.start"}\n\n`,
  audioEvent([1, 2]),
  audioEvent([3, 4, 5]),
  `event: interaction.completed\ndata: {"event_type":"interaction.completed","interaction":{"usage":{}}}\n\n`,
  `event: done\ndata: [DONE]\n\n`,
].join("");
[...await collectInteractionAudio(streamOf(body))]
=> [1, 2, 3, 4, 5]
```

## Event boundaries need not line up with network chunks

A chunk can end mid-event, or between the `\r` and `\n` of a CRLF stream, and
the samples still come out whole.

```ts
const crlf = (audioEvent([7, 8]) + audioEvent([9])).replaceAll("\n", "\r\n");
[...await collectInteractionAudio(streamOf(crlf.slice(0, 20), crlf.slice(20, 21), crlf.slice(21, 90), crlf.slice(90)))]
=> [7, 8, 9]
```

## A provider error inside the stream is raised, not swallowed

The HTTP status was 200 by the time the stream started, so this is the only
place the failure is visible. The route turns it into a 502 naming the cause.

```ts
await collectInteractionAudio(streamOf(audioEvent([1]), `event: error\ndata: {"event_type":"error","error":{"message":"quota exceeded"}}\n\n`))
=> throws InteractionStreamError: Gemini stream failed: quota exceeded
```

An error event that does not match the expected shape — no `event_type`, only
the SSE `event: error` line or a top-level `error` — still fails. Skipping it
as an unknown shape would end the clip as if it were complete.

```ts
await collectInteractionAudio(streamOf(audioEvent([1]), `event: error\ndata: {"error":{"message":"quota exceeded"}}\n\n`))
=> throws InteractionStreamError: Gemini stream failed: quota exceeded

await collectInteractionAudio(streamOf(audioEvent([1]), `data: {"error":{"code":500}}\n\n`))
=> throws InteractionStreamError: Gemini stream failed: error event with no message
```

An event that is not JSON fails the same way.

```ts
await collectInteractionAudio(streamOf(`event: step.delta\ndata: {not json\n\n`))
=> throws InteractionStreamError: Gemini stream failed: unparseable event: «*»
```

## Stopping early cancels the provider's body

A consumer that stops after the first chunk — the browser left — cancels the
response body, which closes the connection to the provider.

```ts
let cancelled = false;
const encoder = new TextEncoder();
const open = new ReadableStream({
  start(controller) { controller.enqueue(encoder.encode(audioEvent([1, 2]))); },
  cancel() { cancelled = true; },
});
const chunks = interactionAudioChunks(open);
const first = await chunks.next();
await chunks.return(undefined);
({ first: [...first.value], cancelled })
=> { first: [1, 2], cancelled: true }
```
