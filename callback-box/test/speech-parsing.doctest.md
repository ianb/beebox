# Speech Tag Parsing

`parseAllSpeechTags()` extracts `<speech>` tags from assistant responses for TTS playback. Each segment has text content and optional voice/emotion/instruction attributes.

```ts setup
import { parseAllSpeechTags, hasAssistantSpeech } from "../src/frontend/src/lib/speech-parsing.js";

// Some assertions feed unknown voices to exercise the warn-and-default path.
// Silence the warning so it doesn't pollute test output.
console.warn = () => {};
```

## Basic speech extraction

A simple speech tag extracts its text:

```
const segments = parseAllSpeechTags("<speech>Hello there!</speech>");
segments.length
=> 1
```

``` continue
segments[0].text
=> Hello there!

segments[0].hasTextBefore
=> false
```

## Speech with instructions

Instructions are extracted from a nested tag and removed from the spoken text:

```
const segments = parseAllSpeechTags(`<speech>Good morning!
<instructions>Warm and cheerful</instructions>
</speech>`);
segments[0].text
=> Good morning!

segments[0].instructions
=> Warm and cheerful
```

## Emotion attribute

```
const segments = parseAllSpeechTags('<speech emotion="happy">Great news!</speech>');
segments[0].emotion
=> happy
```

## Voice attribute

Valid voices are accepted:

```
const segments = parseAllSpeechTags('<speech voice="coral">Hello</speech>');
segments[0].voice
=> coral
```

Invalid voices are silently ignored:

```
const segments = parseAllSpeechTags('<speech voice="unknown">Hello</speech>');
segments[0].voice
=> undefined
```

## Multiple speech segments

```
const segments = parseAllSpeechTags("Some text\n<speech>First</speech>\nMore text\n<speech>Second</speech>");
segments.length
=> 2
```

``` continue
segments[0].text
=> First

segments[0].hasTextBefore
=> true

segments[1].text
=> Second

segments[1].hasTextBefore
=> true
```

## hasAssistantSpeech

Quick check for speech content:

```
hasAssistantSpeech("<speech>Hello</speech>")
=> true

hasAssistantSpeech("Just regular text")
=> false

hasAssistantSpeech("<speech>unclosed tag")
=> false
```

## Malformed instructions tags don't break the speech body

Real-world failure: the agent occasionally emits an extra `</instructions>` after
the legitimate close — sometimes from a typo, sometimes from the model
"correcting" itself. The speech body that follows should still be parsed
correctly. The TTS pipeline should never end up speaking the literal word
"instructions" or the stripped tag markup.

### Stray duplicate `</instructions>`

```
const segs = parseAllSpeechTags(
  "<speech><instructions>Speak warmly</instructions></instructions>Hello there.</speech>"
);
segs.length
=> 1

segs[0].text
=> Hello there.

segs[0].instructions
=> Speak warmly
```

### Typo'd close followed by correct close

The agent sometimes misspells the instructions tag (`intructions`, missing the
second "s"). `normalizeInstructionTags` canonicalizes it before parsing, so the
direction is recovered (not lost) and never leaks into the spoken text.

```
const segs = parseAllSpeechTags(
  "<speech><instructions>Slow and clipped</intructions></instructions>The alarm fired.</speech>"
);
segs.length
=> 1

segs[0].text
=> The alarm fired.

segs[0].instructions
=> Slow and clipped
```

### Typo'd open tag (both ends misspelled)

When *both* the open and close are typo'd, the whole block still normalizes —
the instructions are extracted and the prose stays out of the spoken text
(previously it leaked in as content).

```
const segs = parseAllSpeechTags(
  "<speech name=\"Honey\" override-instructions=\"1\">What a thing to name it.\n<intructions>Quiet, dry, each word careful.</intructions></speech>"
);
segs.length
=> 1

segs[0].text
=> What a thing to name it.

segs[0].instructions
=> Quiet, dry, each word careful.

segs[0].overrideInstructions
=> true
```

### Multiple `<instructions>` blocks in one `<speech>`

When the agent emits two instructions blocks inside one speech tag, keep
only the last non-empty one and strip both from the spoken text.

```
const segs = parseAllSpeechTags(
  "<speech><instructions>First note.</instructions>Hello there.<instructions>Second, more specific note.</instructions></speech>"
);
segs.length
=> 1

segs[0].text
=> Hello there.

segs[0].instructions
=> Second, more specific note.
```

Empty instructions blocks are ignored when picking the last one.

```
const segs = parseAllSpeechTags(
  "<speech><instructions>Real note.</instructions>Body.<instructions>   </instructions></speech>"
);
segs[0].instructions
=> Real note.
```

## Redacted content is never spoken

Markdoc `{% redacted %}…{% /redacted %}` spans render as hidden-until-tap in
the chat. The spoken `text` drops them entirely; `displayText` keeps the
markup so the rendered message still shows the blur.

```
const segs = parseAllSpeechTags(
  "<speech>The answer is {% redacted %}42{% /redacted %} — try it first.</speech>"
);
segs[0].text
=> The answer is  — try it first.

segs[0].displayText
=> The answer is {% redacted %}42{% /redacted %} — try it first.
```

Multiple redacted spans in one speech tag are all dropped:

```
const segs = parseAllSpeechTags(
  "<speech>{% redacted %}one{% /redacted %} and {% redacted %}two{% /redacted %} stay hidden.</speech>"
);
segs[0].text
=> and  stay hidden.
```

An unclosed `{% redacted %}` hides everything through the end of the speech —
dropping just the marker would leak the hidden content:

```
const segs = parseAllSpeechTags(
  "<speech>Before. {% redacted %}secret with no close tag</speech>"
);
segs[0].text
=> Before.
```

A stray close marker is stripped rather than spoken as literal markup:

```
const segs = parseAllSpeechTags(
  "<speech>Oops {% /redacted %} extra close.</speech>"
);
segs[0].text
=> Oops  extra close.
```

A speech tag that is entirely redacted yields empty spoken text (the playback
machine skips the TTS call for it):

```
const segs = parseAllSpeechTags(
  "<speech>{% redacted %}all hidden{% /redacted %}</speech>"
);
JSON.stringify(segs[0].text)
=> ""

segs[0].displayText
=> {% redacted %}all hidden{% /redacted %}
```

## Name attribute

An optional `name` attribute labels the speaker of a chunk:

```
const segs = parseAllSpeechTags('<speech name="Bob">hi, I am bob!</speech>');
segs[0].name
=> Bob

segs[0].text
=> hi, I am bob!
```

No `name` attribute leaves it undefined:

```
const segs = parseAllSpeechTags("<speech>plain</speech>");
segs[0].name
=> undefined
```

## Splitting into ordered parts

`splitSpeechParts` interleaves non-spoken text and `<speech>` chunks, tagging
each chunk with its absolute index (matching parseAllSpeechTags order):

```ts setup
import { splitSpeechParts } from "../src/frontend/src/lib/speech-parsing.js";
```

```
const parts = splitSpeechParts("Intro text <speech>one</speech> mid <speech name=\"Q\">two</speech>");
parts.map(p => p.type).join(",")
=> text,speech,text,speech

parts.filter(p => p.type === "speech").map(p => p.index).join(",")
=> 0,1
```

``` continue
const speechParts = parts.filter(p => p.type === "speech");
speechParts[1]?.type === "speech" ? speechParts[1].segment.name : "?"
=> Q
```

Content with no speech is a single text part:

```
const parts = splitSpeechParts("just prose, nothing spoken");
parts.length
=> 1

parts[0]?.type
=> text
```
