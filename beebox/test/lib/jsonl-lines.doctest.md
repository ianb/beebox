# Splitting JSONL on newlines only

`jsonlLines` (`src/lib/jsonl-lines.ts`) is how the engine reads a JSONL file or
stream one line at a time. It exists because `node:readline` also ends a line at
U+2028 and U+2029, characters JSON allows raw inside a string. A chat message
with pasted text holding one was split into fragments that each failed to parse,
and dropped from the chat's history.

```ts setup
import { Readable } from "node:stream";
import { jsonlLines } from "../../src/lib/jsonl-lines.js";

async function lines(chunks) {
  const out = [];
  for await (const line of jsonlLines(Readable.from(chunks))) out.push(line);
  return out;
}

/** Make the two separators visible in a shown value. */
function visible(text) {
  return text.replaceAll("\u2028", "<LS>").replaceAll("\u2029", "<PS>");
}
```

A JSON line whose string holds U+2028 and U+2029 stays one line and parses:

```ts
const file = [
  JSON.stringify({ text: "Load the kiln\u2028Fire by noon\u2029Unload" }),
  JSON.stringify({ text: "next" }),
].join("\n") + "\n";
(await lines([file])).map((line) => visible(JSON.parse(line).text))
=> ["Load the kiln<LS>Fire by noon<PS>Unload", "next"]
```

The rest matches `readline` with `crlfDelay: Infinity`: a CRLF ending reads as an
LF one, an empty line between newlines is kept, and a last line with no trailing
newline still arrives:

```ts continue
await lines(["a\r\n\nb"])
=> ["a", "", "b"]
```

Chunk boundaries do not matter, including one that falls inside a multi-byte
character:

```ts continue
const bytes = Buffer.from("é\u2028x\nsecond\n");
(await lines([bytes.subarray(0, 1), bytes.subarray(1, 4), bytes.subarray(4)])).map(visible)
=> ["é<LS>x", "second"]
```
