// # Speech Tag Parsing
//
// `parseAllSpeechTags()` extracts `<speech>` tags from assistant responses for TTS playback. Each segment has text content and optional voice/emotion/instruction attributes.

import { test } from "tap";
import "agent-doctest/tap";
import { parseAllSpeechTags, hasAssistantSpeech } from "../../../../src/lib/audio/speech-parsing/parse.js";
import { splitSpeechParts } from "../../../../src/lib/audio/speech-parsing/parse.js";

// Some assertions feed unknown voices to exercise the warn-and-default path.
// Silence the warning so it doesn't pollute test output.
console.warn = () => {};

// ## Splitting into ordered parts
//
// `splitSpeechParts` interleaves non-spoken text and `<speech>` chunks, tagging
// each chunk with its absolute index (matching parseAllSpeechTags order):

// ## Basic speech extraction
//
// A simple speech tag extracts its text:
void test("A simple speech tag extracts its text:", async (t) => {
  // doctest:L18
  const segments = parseAllSpeechTags("<speech>Hello there!</speech>");
  t.check(segments, [
    {
      text: "Hello there!",
      instructions: undefined,
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "Hello there!",
      hasTextBefore: false,
    },
  ]);
});

// ## Speech with instructions
//
// Delivery instructions ride on the `instructions` attribute; the tag's content
// is only the spoken text:
void test("Delivery instructions ride on the instructions attribute; the tag's content i...", async (t) => {
  // doctest:L37
  const segments = parseAllSpeechTags('<speech instructions="Gentle, not urgent">I found three overdue items.</speech>');
  t.check(segments, [
    {
      text: "I found three overdue items.",
      instructions: "Gentle, not urgent",
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "I found three overdue items.",
      hasTextBefore: false,
    },
  ]);
});

// The value is entity-decoded the same way `name` is, so an agent can write a
// double quote as `&quot;` and an ampersand as `&amp;`:
void test("The value is entity-decoded the same way name is, so an agent can write a dou...", async (t) => {
  // doctest:L49
  const segments = parseAllSpeechTags('<speech instructions="Say &quot;ta-da&quot; slowly &amp; warmly">Ta-da.</speech>');
  t.check(segments, [
    {
      text: "Ta-da.",
      instructions: "Say \"ta-da\" slowly & warmly",
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "Ta-da.",
      hasTextBefore: false,
    },
  ]);
});

// The older form nests an `<instructions>` child. Saved transcripts and agents
// with stale guidance still contain it, so it is still read, and its text is
// removed from the spoken text:
void test("The older form nests an <instructions> child.", async (t) => {
  // doctest:L59
  const segments = parseAllSpeechTags(`<speech>Good morning!
<instructions>Warm and cheerful</instructions>
</speech>`);
  t.check(segments, [
    {
      text: "Good morning!",
      instructions: "Warm and cheerful",
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "Good morning!",
      hasTextBefore: false,
    },
  ]);
});

// When both forms appear, the attribute wins and the child's text is still
// kept out of the spoken text:
void test("When both forms appear, the attribute wins and the child's text is still kept...", async (t) => {
  // doctest:L73
  const segments = parseAllSpeechTags('<speech instructions="From the attribute">Hello.<instructions>From the child</instructions></speech>');
  t.check(segments, [
    {
      text: "Hello.",
      instructions: "From the attribute",
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "Hello.",
      hasTextBefore: false,
    },
  ]);
});

// A child that carries its own attributes is still a child; its text is not
// spoken:
void test("A child that carries its own attributes is still a child; its text is not spo...", async (t) => {
  // doctest:L85
  const segments = parseAllSpeechTags('<speech>Hello.<instructions pace="slow">Gentle</instructions></speech>');
  t.check(segments, [
    {
      text: "Hello.",
      instructions: "Gentle",
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "Hello.",
      hasTextBefore: false,
    },
  ]);
});

// An empty attribute falls back to the child:
void test("An empty attribute falls back to the child:", async (t) => {
  // doctest:L96
  const segments = parseAllSpeechTags('<speech instructions=" "><instructions>From the child</instructions>Hello.</speech>');
  t.check(segments, [
    {
      text: "Hello.",
      instructions: "From the child",
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "Hello.",
      hasTextBefore: false,
    },
  ]);
});

// ## Emotion attribute
void test("Emotion attribute", async (t) => {
  // doctest:L104
  const segments = parseAllSpeechTags('<speech emotion="happy">Great news!</speech>');
  t.check(segments, [
    {
      text: "Great news!",
      instructions: undefined,
      emotion: "happy",
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "Great news!",
      hasTextBefore: false,
    },
  ]);
});

// ## Voice attribute
//
// Valid voices are accepted:
void test("Valid voices are accepted:", async (t) => {
  // doctest:L114
  const segments = parseAllSpeechTags('<speech voice="coral">Hello</speech>');
  t.check(segments, [
    {
      text: "Hello",
      instructions: undefined,
      emotion: undefined,
      voice: "coral",
      overrideInstructions: undefined,
      name: undefined,
      displayText: "Hello",
      hasTextBefore: false,
    },
  ]);
});

// Invalid voices are silently ignored:
void test("Invalid voices are silently ignored:", async (t) => {
  // doctest:L122
  const segments = parseAllSpeechTags('<speech voice="unknown">Hello</speech>');
  t.check(segments, [
    {
      text: "Hello",
      instructions: undefined,
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "Hello",
      hasTextBefore: false,
    },
  ]);
});

// ## Multiple speech segments
void test("Multiple speech segments", async (t) => {
  // doctest:L133
  const segments = parseAllSpeechTags("Some text\n<speech>First</speech>\nMore text\n<speech>Second</speech>");
  t.check(segments, [
    {
      text: "First",
      instructions: undefined,
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "First",
      hasTextBefore: true,
    },
    {
      text: "Second",
      instructions: undefined,
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "Second",
      hasTextBefore: true,
    },
  ]);
});

// ## hasAssistantSpeech
//
// Quick check for speech content:
void test("Quick check for speech content:", async (t) => {
  // doctest:L157
  t.check(hasAssistantSpeech("<speech>Hello</speech>"), true);

  // doctest:L160
  t.check(hasAssistantSpeech("Just regular text"), false);

  // doctest:L163
  t.check(hasAssistantSpeech("<speech>unclosed tag"), false);
});

// ## Malformed instructions tags don't break the speech body
//
// Real-world failure: the agent occasionally emits an extra `</instructions>` after
// the legitimate close — sometimes from a typo, sometimes from the model
// "correcting" itself. The speech body that follows should still be parsed
// correctly. The TTS pipeline should never end up speaking the literal word
// "instructions" or the stripped tag markup.
//
// ### Stray duplicate `</instructions>`
void test("Real-world failure:", async (t) => {
  // doctest:L178
  const segs = parseAllSpeechTags(
    "<speech><instructions>Speak warmly</instructions></instructions>Hello there.</speech>"
  );
  t.check(segs, [
    {
      text: "Hello there.",
      instructions: "Speak warmly",
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "Hello there.",
      hasTextBefore: false,
    },
  ]);
});

// ### Typo'd close followed by correct close
//
// The agent sometimes misspells the instructions tag (`intructions`, missing the
// second "s"). `normalizeInstructionTags` canonicalizes it before parsing, so the
// direction is recovered (not lost) and never leaks into the spoken text.
void test("The agent sometimes misspells the instructions tag (intructions, missing the...", async (t) => {
  // doctest:L198
  const segs = parseAllSpeechTags(
    "<speech><instructions>Slow and clipped</intructions></instructions>The alarm fired.</speech>"
  );
  t.check(segs, [
    {
      text: "The alarm fired.",
      instructions: "Slow and clipped",
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "The alarm fired.",
      hasTextBefore: false,
    },
  ]);
});

// ### Typo'd open tag (both ends misspelled)
//
// When *both* the open and close are typo'd, the whole block still normalizes —
// the instructions are extracted and the prose stays out of the spoken text
// (previously it leaked in as content).
void test("When both the open and close are typo'd, the whole block still normalizes — t...", async (t) => {
  // doctest:L218
  const segs = parseAllSpeechTags(
    "<speech name=\"Honey\" override-instructions=\"1\">What a thing to name it.\n<intructions>Quiet, dry, each word careful.</intructions></speech>"
  );
  t.check(segs, [
    {
      text: "What a thing to name it.",
      instructions: "Quiet, dry, each word careful.",
      emotion: undefined,
      voice: undefined,
      overrideInstructions: true,
      name: "Honey",
      displayText: "What a thing to name it.",
      hasTextBefore: false,
    },
  ]);
});

// ### Multiple `<instructions>` blocks in one `<speech>`
//
// When the agent emits two instructions blocks inside one speech tag, keep
// only the last non-empty one and strip both from the spoken text.
void test("When the agent emits two instructions blocks inside one speech tag, keep only...", async (t) => {
  // doctest:L240
  const segs = parseAllSpeechTags(
    "<speech><instructions>First note.</instructions>Hello there.<instructions>Second, more specific note.</instructions></speech>"
  );
  t.check(segs, [
    {
      text: "Hello there.",
      instructions: "Second, more specific note.",
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "Hello there.",
      hasTextBefore: false,
    },
  ]);
});

// Empty instructions blocks are ignored when picking the last one.
void test("Empty instructions blocks are ignored when picking the last one.", async (t) => {
  // doctest:L256
  const segs = parseAllSpeechTags(
    "<speech><instructions>Real note.</instructions>Body.<instructions>   </instructions></speech>"
  );
  t.check(segs, [
    {
      text: "Body.",
      instructions: "Real note.",
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "Body.",
      hasTextBefore: false,
    },
  ]);
});

// ## Redacted content is never spoken
//
// Markdoc `{% redacted %}…{% /redacted %}` spans render as hidden-until-tap in
// the chat. The spoken `text` drops them entirely; `displayText` keeps the
// markup so the rendered message still shows the blur.
void test("Markdoc {% redacted %}…{% /redacted %} spans render as hidden-until-tap in th...", async (t) => {
  // doctest:L270
  const segs = parseAllSpeechTags(
    "<speech>The answer is {% redacted %}42{% /redacted %} — try it first.</speech>"
  );
  t.check(segs, [
    {
      text: "The answer is  — try it first.",
      instructions: undefined,
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "The answer is {% redacted %}42{% /redacted %} — try it first.",
      hasTextBefore: false,
    },
  ]);
});

// Multiple redacted spans in one speech tag are all dropped:
void test("Multiple redacted spans in one speech tag are all dropped:", async (t) => {
  // doctest:L283
  const segs = parseAllSpeechTags(
    "<speech>{% redacted %}one{% /redacted %} and {% redacted %}two{% /redacted %} stay hidden.</speech>"
  );
  t.check(segs, [
    {
      text: "and  stay hidden.",
      instructions: undefined,
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "{% redacted %}one{% /redacted %} and {% redacted %}two{% /redacted %} stay hidden.",
      hasTextBefore: false,
    },
  ]);
});

// An unclosed `{% redacted %}` hides everything through the end of the speech —
// dropping just the marker would leak the hidden content:
void test("An unclosed {% redacted %} hides everything through the end of the speech — d...", async (t) => {
  // doctest:L294
  const segs = parseAllSpeechTags(
    "<speech>Before. {% redacted %}secret with no close tag</speech>"
  );
  t.check(segs, [
    {
      text: "Before.",
      instructions: undefined,
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "Before. {% redacted %}secret with no close tag",
      hasTextBefore: false,
    },
  ]);
});

// A stray close marker is stripped rather than spoken as literal markup:
void test("A stray close marker is stripped rather than spoken as literal markup:", async (t) => {
  // doctest:L304
  const segs = parseAllSpeechTags(
    "<speech>Oops {% /redacted %} extra close.</speech>"
  );
  t.check(segs, [
    {
      text: "Oops  extra close.",
      instructions: undefined,
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "Oops {% /redacted %} extra close.",
      hasTextBefore: false,
    },
  ]);
});

// A speech tag that is entirely redacted yields empty spoken text (the playback
// machine skips the TTS call for it):
void test("A speech tag that is entirely redacted yields empty spoken text (the playback...", async (t) => {
  // doctest:L315
  const segs = parseAllSpeechTags(
    "<speech>{% redacted %}all hidden{% /redacted %}</speech>"
  );
  t.check(segs, [
    {
      text: "",
      instructions: undefined,
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "{% redacted %}all hidden{% /redacted %}",
      hasTextBefore: false,
    },
  ]);
});

// ## Name attribute
//
// An optional `name` attribute labels the speaker of a chunk:
void test("An optional name attribute labels the speaker of a chunk:", async (t) => {
  // doctest:L330
  const segs = parseAllSpeechTags('<speech name="Bob">hi, I am bob!</speech>');
  t.check(segs, [
    {
      text: "hi, I am bob!",
      instructions: undefined,
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: "Bob",
      displayText: "hi, I am bob!",
      hasTextBefore: false,
    },
  ]);
});

// No `name` attribute leaves it undefined:
void test("No name attribute leaves it undefined:", async (t) => {
  // doctest:L341
  const segs = parseAllSpeechTags("<speech>plain</speech>");
  t.check(segs, [
    {
      text: "plain",
      instructions: undefined,
      emotion: undefined,
      voice: undefined,
      overrideInstructions: undefined,
      name: undefined,
      displayText: "plain",
      hasTextBefore: false,
    },
  ]);
});

void test("Splitting into ordered parts", async (t) => {
  // doctest:L359
  const parts = splitSpeechParts("Intro text <speech>one</speech> mid <speech name=\"Q\">two</speech>");
  t.check(parts, [
    {
      type: "text",
      text: "Intro text ",
    },
    {
      type: "speech",
      segment: {
        text: "one",
        instructions: undefined,
        emotion: undefined,
        voice: undefined,
        overrideInstructions: undefined,
        name: undefined,
        displayText: "one",
        hasTextBefore: true,
      },
      index: 0,
    },
    {
      type: "text",
      text: " mid ",
    },
    {
      type: "speech",
      segment: {
        text: "two",
        instructions: undefined,
        emotion: undefined,
        voice: undefined,
        overrideInstructions: undefined,
        name: "Q",
        displayText: "two",
        hasTextBefore: true,
      },
      index: 1,
    },
  ]);
});

// Content with no speech is a single text part:
void test("Content with no speech is a single text part:", async (t) => {
  // doctest:L376
  const parts = splitSpeechParts("just prose, nothing spoken");
  t.check(parts, [
    {
      type: "text",
      text: "just prose, nothing spoken",
    },
  ]);
});
