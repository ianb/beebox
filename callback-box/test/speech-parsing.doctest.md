# Speech Tag Parsing

`parseAllSpeechTags()` extracts `<speech>` tags from assistant responses for TTS playback. Each segment has text content and optional voice/emotion/instruction attributes.

```ts setup
import { parseAllSpeechTags, hasAssistantSpeech } from "../src/frontend/src/lib/speech-parsing.js";
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

```
const segs = parseAllSpeechTags(
  "<speech><instructions>Slow and clipped</intructions></instructions>The alarm fired.</speech>"
);
segs.length
=> 1

segs[0].text
=> The alarm fired.
```

The instructions content may be lost when the open tag has a typo'd close
that doesn't match, but the spoken text must still come through.
