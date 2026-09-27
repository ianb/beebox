# Chat Response Extraction

The `ChatThreadSession` extracts `<chat-response>` blocks from streamed agent output as they complete. Each block is emitted immediately so it can be delivered to chat interfaces (Telegram, web) without waiting for the full turn to finish.

This tests the core extraction logic using a minimal `ResponseExtractor` that mirrors the private `checkForResponses()` method.

```ts setup
import { EventEmitter } from "node:events";

class ResponseExtractor extends EventEmitter {
  turnText = "";

  addText(text) {
    this.turnText += text;
    this.checkForResponses();
  }

  finalize() {
    this.checkForResponses();
  }

  checkForResponses() {
    const regex = /<chat-response>([\S\s]*?)<\/chat-response>/g;
    let match;
    let lastIndex = 0;
    while ((match = regex.exec(this.turnText)) !== null) {
      const text = match[1].trim();
      if (text) this.emit("chat-response", text);
      lastIndex = regex.lastIndex;
    }
    if (lastIndex > 0) this.turnText = this.turnText.slice(lastIndex);
  }
}

// Collects emitted responses into an array for easy assertion
function makeExtractor() {
  const ext = new ResponseExtractor();
  const responses = [];
  ext.on("chat-response", (text) => responses.push(text));
  return { ext, responses };
}
```

## Single response

A complete `<chat-response>` tag is extracted immediately:

```ts
const { ext, responses } = makeExtractor();
ext.addText("<chat-response>Hello!</chat-response>");
responses.length
=> 1

responses[0]
=> Hello!
```

## Multiple responses in one chunk

Two responses in the same chunk are both extracted:

```ts
const { ext, responses } = makeExtractor();
ext.addText("<chat-response>On it!</chat-response>some tool use stuff<chat-response>Done, updated the file.</chat-response>");
responses.length
=> 2

responses[0]
=> On it!

responses[1]
=> Done, updated the file.
```

## Streaming across chunks

When a tag spans multiple `addText` calls, it's only extracted once complete. A second response arrives after non-response output:

```ts
const { ext, responses } = makeExtractor();
ext.addText("<chat-response>Looking into");
responses.length
=> 0

ext.addText(" that now</chat-response>");
responses.length
=> 1

responses[0]
=> Looking into that now

ext.addText("I'll check the config...<chat-response>All good, config is valid.</chat-response>");
responses.length
=> 2

responses[1]
=> All good, config is valid.
```

## Text around responses

Text before and after a response is preserved in `turnText` for further processing:

```ts
const { ext, responses } = makeExtractor();
ext.addText("Let me think about this...\n<chat-response>Here's what I found</chat-response>\nNow doing more work...");
responses[0]
=> Here's what I found

ext.turnText
=> «*»Now doing more work...
```

## Empty responses are skipped

Whitespace-only responses are not emitted:

```ts
const { ext, responses } = makeExtractor();
ext.addText("<chat-response>  </chat-response><chat-response>Real response</chat-response>");
responses.length
=> 1

responses[0]
=> Real response
```

## Multiline responses

Newlines within the response body are preserved:

```ts
const { ext, responses } = makeExtractor();
ext.addText("<chat-response>Line one\nLine two\nLine three</chat-response>");
responses[0]
=>
Line one
Line two
Line three
```

## Partial tag completed later

A tag split mid-closing-tag is assembled correctly:

```ts
const { ext, responses } = makeExtractor();
ext.addText("thinking...<chat-response>Final answer</chat-resp");
responses.length
=> 0

ext.addText("onse>");
responses.length
=> 1

responses[0]
=> Final answer
```

## Real-world pattern: acknowledge → work → report

The typical Claude pattern is to send an immediate acknowledgment, do tool calls, then report the result. Both responses are extracted as they arrive:

```ts
const { ext, responses } = makeExtractor();
ext.addText("<chat-response>Checking that for you</chat-response>");
responses.length
=> 1

ext.addText("Let me read the file...\n[tool_use: Read file.txt]\n[tool_result: contents here]\n");
responses.length
=> 1

ext.addText("<chat-response>Found it — the config has 3 entries and looks correct.</chat-response>");
responses.length
=> 2

responses[1]
=> Found it — the config has 3 entries and looks correct.
```
