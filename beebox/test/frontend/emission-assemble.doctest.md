# Emission assembly — the pinned wire format for every send site

`assembleChatMessage` is the one place an Emission becomes a chat payload
(docs/plans/input-extraction.md, chunk 1). These examples pin the exact
historical output of each of the five send sites it replaces — the
refactor's zero-behavior-change guarantee is these strings.

```ts setup
import { assembleChatMessage } from "../../src/frontend/src/input/targets/chat-assemble.js";
import { createTypedEmission, createVoiceEmission } from "../../src/frontend/src/input/emission.js";
import { buildSpeechMessage } from "../../src/frontend/src/components/chat/InteractiveChat-helpers.js";
import { markUnsureWords, resolveEmissionWords, UNSURE_THRESHOLD, UNSURE_EXTEND } from "../../src/frontend/src/input/unsure-words.js";

const W = { localTime: "14:23", zoomedView: null, timePassed: null };
```

## Site 1 — typed send: plain text

Historical builder: `handleSend` (`InteractiveChat-actions.ts`).

```ts
const e = createTypedEmission({ text: "hello there", images: [], files: [], selections: [] });
const out = assembleChatMessage(e, W);
out.message
=> <typed local-time="14:23">hello there</typed>

out.messageId === e.id
=> true

out.images.length
=> 0
```

## Site 1 — typed send: selections fold, files block, images ride

(The text here carries no `[file#N]` tokens, so both files also get noted
at the end of the body — see the placemarker section below.)

```ts
const e = createTypedEmission({
  text: "compare [selection#1] with the doc",
  images: [{ id: 1, mimeType: "image/png", dataBase64: "aGk=" }],
  files: [{ id: 1, path: "_tmp/2026-07-04T01-00-00_report.pdf" }, { id: 2, path: "_tmp/2026-07-04T01-00-01_notes.txt" }],
  selections: [{ id: 1, ref: "/_content/notes/Bread.doc.card", text: "let it rise", position: "body; heading: Proofing (#proofing)" }],
});
const out = assembleChatMessage(e, W);
JSON.stringify(out.message)
=> "<typed local-time=\"14:23\">compare <user-selection ref=\"/_content/notes/Bread.doc.card\" pos=\"body; heading: Proofing (#proofing)\">let it rise</user-selection> with the doc [file#1] [file#2]</typed>\n<attachments>\n[file#1]: _tmp/2026-07-04T01-00-00_report.pdf\n[file#2]: _tmp/2026-07-04T01-00-01_notes.txt\n</attachments>"

out.images[0]?.mimeType
=> image/png
```

## Missing [file#N] placemarkers are noted at the end of the text

`[file#N]` tokens are placemarkers the user can position in the text; a
file whose token is missing gets its token appended at the end instead, so
the `<attachments>` block never lists an unreferenced file. Voice sends
(whose spoken text never had tokens) and typed sends where the user edited
a token out both land here.

```ts
const e = createVoiceEmission({
  text: "summarize the attached report",
  files: [{ id: 1, path: "_tmp/2026-07-19T10-00-00_report.pdf" }],
  selections: [],
  diarized: false,
});
JSON.stringify(assembleChatMessage(e, W).message.replace(e.id, "ID"))
=> "<speech message-id=\"ID\" local-time=\"14:23\">summarize the attached report [file#1]</speech>\n<attachments>\n[file#1]: _tmp/2026-07-19T10-00-00_report.pdf\n</attachments>"
```

A present token is left in place — only the absent ones append:

```ts
const e = createTypedEmission({
  text: "compare [file#1] against the notes",
  images: [],
  files: [{ id: 1, path: "_tmp/a.pdf" }, { id: 2, path: "_tmp/b.txt" }],
  selections: [],
});
JSON.stringify(assembleChatMessage(e, W).message)
=> "<typed local-time=\"14:23\">compare [file#1] against the notes [file#2]</typed>\n<attachments>\n[file#1]: _tmp/a.pdf\n[file#2]: _tmp/b.txt\n</attachments>"
```

## A body written before the `#` rename keeps its own spelling

A draft persisted before 2026-08-25 comes back saying `[file1]`. The
`<attachments>` block labels it the same way, so the token and the line that
resolves it always agree within one message — the agent is told to read either
form, not to reconcile two. A file the old body never mentioned still gets the
current form, because that token is being written now.

```ts
const e = createTypedEmission({
  text: "compare [file1] against the notes",
  images: [],
  files: [{ id: 1, path: "_tmp/a.pdf" }, { id: 2, path: "_tmp/b.txt" }],
  selections: [],
});
JSON.stringify(assembleChatMessage(e, W).message)
=> "<typed local-time=\"14:23\">compare [file1] against the notes [file#2]</typed>\n<attachments>\n[file1]: _tmp/a.pdf\n[file#2]: _tmp/b.txt\n</attachments>"
```

Empty text with only an attachment (the send guard allows it): the body
is just the token, with no stray leading space:

```ts
const e = createTypedEmission({ text: "", images: [], files: [{ id: 1, path: "_tmp/a.pdf" }], selections: [] });
JSON.stringify(assembleChatMessage(e, W).message)
=> "<typed local-time=\"14:23\">[file#1]</typed>\n<attachments>\n[file#1]: _tmp/a.pdf\n</attachments>"
```

## Witness attributes: order is local-time, zoomed-view, time-passed

Historical order from `handleSend`'s template
(`<typed local-time=…${zoomedViewAttr()}${timePassedAttr()}>`).

```ts
const e = createTypedEmission({ text: "hi", images: [], files: [], selections: [] });
assembleChatMessage(e, { localTime: "09:05", zoomedView: "view:_content/notes/Foo.md?view=markdown", timePassed: "2d4h" }).message
=> <typed local-time="09:05" zoomed-view="view:_content/notes/Foo.md?view=markdown" time-passed="2d4h">hi</typed>
```

## Site 2 — keyword voice send: diarized attr leads, selections append

Historical builder: `runKeywordSend` → `buildSpeechMessage`
(`InteractiveChat-voice.ts` / `InteractiveChat-helpers.ts`). The diarized
attribute comes BEFORE local-time — pinned. Spoken text carries no
tokens, so selections append.

```ts
const sel = [{ id: 2, ref: "/_content/recipes/Bread.recipe.card", text: "300g flour", position: "body" }];
const e = createVoiceEmission({ text: "add that to the list", selections: sel, diarized: true });
const out = assembleChatMessage(e, W);
JSON.stringify(out.message.replace(e.id, "ID"))
=> "<speech diarized=\"1\" message-id=\"ID\" local-time=\"14:23\">add that to the list\n<user-selection ref=\"/_content/recipes/Bread.recipe.card\" pos=\"body\">300g flour</user-selection></speech>"
```

Equivalence with the historical helper (same inputs → same bytes, modulo the
`message-id` stamp `buildSpeechMessage` predates and never grew — Track 1,
retranscription-in-chat plan), while it still exists:

```ts continue
const legacy = buildSpeechMessage({ text: "add that to the list", diarized: true, selections: sel, attrs: " local-time=\"14:23\"" });
out.message.replace(` message-id="${e.id}"`, "") === legacy
=> true
```

## Sites 3+4 — desktop/mobile stop-and-send: now fold selections (chunk 5, DECIDED)

Historical builders hand-built `<speech local-time="…"…>${text}</speech>`
with NO selection folding (`InteractiveChat-composer.tsx`,
`InteractiveChat-mobile-row.tsx`) — an accident of hand-built payloads, not
a design. Chunk 5 decided (named, boxholder-visible): ALIGN these two
paths with every other send path and fold the live selections snapshot in
(`InteractiveChat-dispatch.ts`'s `sendStopSend`), for consistency — every
other send path already folds.

```ts
const sel = [{ id: 3, ref: "/_content/notes/Bread.doc.card", text: "let it rise", position: "body" }];
const e = createVoiceEmission({ text: "quick thought before I go", selections: sel, diarized: false });
JSON.stringify(assembleChatMessage(e, { localTime: "23:59", zoomedView: null, timePassed: "8h" }).message.replace(e.id, "ID"))
=> "<speech message-id=\"ID\" local-time=\"23:59\" time-passed=\"8h\">quick thought before I go\n<user-selection ref=\"/_content/notes/Bread.doc.card\" pos=\"body\">let it rise</user-selection></speech>"
```

With no selections pending (the common case), the fold is the identity —
still byte-identical to the old, permanently-unfolded behavior:

```ts
const e2 = createVoiceEmission({ text: "quick thought before I go", selections: [], diarized: false });
assembleChatMessage(e2, { localTime: "23:59", zoomedView: null, timePassed: "8h" }).message.replace(e2.id, "ID")
=> <speech message-id="ID" local-time="23:59" time-passed="8h">quick thought before I go</speech>
```

## Site 5 — recovered dictation: same shape as stop-and-send

Historical builder: `handleRecoverSend`
(`InteractiveChat.tsx`) — `buildSpeechMessage` with `selections: []`,
`diarized: false`.

```ts
const e = createVoiceEmission({ text: "the text that survived the drop", selections: [], diarized: false });
assembleChatMessage(e, W).message.replace(e.id, "ID")
=> <speech message-id="ID" local-time="14:23">the text that survived the drop</speech>
```

## `markUnsureWords` — the pure marking function (Track 3, span rework)

`UNSURE_THRESHOLD` (0.7) SEEDS a span; `UNSURE_EXTEND` (0.9) grows it
outward across adjacent gray words; a one-word gap between two spans
BRIDGES them; a span never crosses sentence-final punctuation. A word AT
either threshold is on the confident side (`<`, not `<=`).

```ts
UNSURE_THRESHOLD
=> 0.7

UNSURE_EXTEND
=> 0.9
```

Single low word with confident (≥0.9) neighbors: still a single-word span
— unchanged from the pre-rework behavior.

```ts
const cleanWords = [
  { word: "they're", confidence: 0.99 },
  { word: "all", confidence: 0.97 },
  { word: "cloud", confidence: 0.29 },
  { word: "code", confidence: 0.95 },
  { word: "in", confidence: 0.9 },
];
markUnsureWords("they're all cloud code in", { words: cleanWords })
=> they're all <unsure>cloud</unsure> code in
```

Boundary: exactly 0.7 is confident (unchanged body); just under seeds.

```ts
markUnsureWords("the", { words: [{ word: "the", confidence: 0.7 }] })
=> the

markUnsureWords("the", { words: [{ word: "the", confidence: 0.6999 }] })
=> <unsure>the</unsure>
```

## Hysteresis: a seed's gray (0.7–0.9) neighbors join its span

This is the rework's whole point: the recognizer's language model often
repairs the actually-wrong word to something plausible, smearing doubt
across its neighbors rather than leaving it scored low itself. "all" and
"code" are both gray (below `UNSURE_EXTEND`, above `UNSURE_THRESHOLD`) and
adjacent to the seed "cloud", so the whole run joins one span; "they're"
(0.99) and "in" (0.95) are confident and stop it on both sides.

```ts
markUnsureWords(
  "they're all cloud code in",
  {
    words: [
      { word: "they're", confidence: 0.99 },
      { word: "all", confidence: 0.8 },
      { word: "cloud", confidence: 0.29 },
      { word: "code", confidence: 0.85 },
      { word: "in", confidence: 0.95 },
    ],
  },
)
=> they're <unsure>all cloud code</unsure> in
```

Gray words with NO seed among them never mark at all — extension only
grows an existing span, it never starts one on its own.

```ts
markUnsureWords("the plan", { words: [{ word: "the", confidence: 0.8 }, { word: "plan", confidence: 0.85 }] })
=> the plan
```

## Bridge: two spans separated by exactly one word join into one

The gap word here is confident (0.95, not even gray) — bridging doesn't
care about the gap word's own score, only that it's a single word between
two already-marked regions (the "wrong word scores fine between two dips"
shape this rework targets).

```ts
markUnsureWords(
  "that one not",
  {
    words: [
      { word: "that", confidence: 0.6 },
      { word: "one", confidence: 0.95 },
      { word: "not", confidence: 0.5 },
    ],
  },
)
=> <unsure>that one not</unsure>
```

A gap word with NO confidence value bridges the same way (rule 5 — treated
like confident for extension/bridge, transparent rather than a wall):

```ts
markUnsureWords(
  "that one not",
  {
    words: [
      { word: "that", confidence: 0.6 },
      { word: "one" },
      { word: "not", confidence: 0.5 },
    ],
  },
)
=> <unsure>that one not</unsure>
```

Two confident words between two seeds is too wide a gap — bridge only
fires for EXACTLY one — so this stays two separate spans.

```ts
markUnsureWords(
  "that one two not",
  {
    words: [
      { word: "that", confidence: 0.6 },
      { word: "one", confidence: 0.95 },
      { word: "two", confidence: 0.95 },
      { word: "not", confidence: 0.5 },
    ],
  },
)
=> <unsure>that</unsure> one two <unsure>not</unsure>
```

## Sentence stop: a span never crosses sentence-final punctuation

"agent." ends its sentence (its own text ends in `.`) — even directly
adjacent to another seed ("something", the very next word), the two never
merge into one span; adjacent spans separated only by a sentence boundary
stay separate. The trailing period of the first span's last token stays
OUTSIDE the tag, same as any other trailing punctuation.

```ts
markUnsureWords(
  "In fact you are an agent. something happened after",
  {
    words: [
      { word: "In", confidence: 0.99 },
      { word: "fact", confidence: 0.98 },
      { word: "you", confidence: 0.97 },
      { word: "are", confidence: 0.96 },
      { word: "an", confidence: 0.95 },
      { word: "agent.", confidence: 0.5 },
      { word: "something", confidence: 0.4 },
      { word: "happened", confidence: 0.97 },
      { word: "after", confidence: 0.98 },
    ],
  },
)
=> In fact you are an <unsure>agent</unsure>. <unsure>something</unsure> happened after
```

A closing quote after the terminator is still a sentence end (`agent."` —
the words stream carries Deepgram's punctuated form, quotes included):

```ts
markUnsureWords(
  'he said "agent." something happened',
  {
    words: [
      { word: "he", confidence: 0.99 },
      { word: "said", confidence: 0.98 },
      { word: '"agent."', confidence: 0.5 },
      { word: "something", confidence: 0.4 },
      { word: "happened", confidence: 0.97 },
    ],
  },
)
=> he said "<unsure>agent</unsure>." <unsure>something</unsure> happened
```

## Fail-open projection: unmatched words, repeats, prefixes, tags

Without a `spokenStart`, the search for the first words-stream entry just
scans forward from 0 — a prior-typed-input PREFIX the words stream never
covered still ends up unmarked here only because it happens not to repeat
a stream word:

```ts
markUnsureWords(
  "note to self, cloud computing is great",
  {
    words: [
      { word: "cloud", confidence: 0.3 },
      { word: "computing", confidence: 0.98 },
      { word: "is", confidence: 0.99 },
      { word: "great", confidence: 0.97 },
    ],
  },
)
=> note to self, <unsure>cloud</unsure> computing is great
```

`spokenStart` is what actually GUARANTEES the prefix is off-limits (review
Fix B): here the typed prefix "cloud budget:" repeats the low-confidence
stream word "cloud" — without `spokenStart` this would wrap the TYPED
"cloud"; with it, the scan skips every token before the spoken region and
marks the real, spoken occurrence.

```ts
const typedPrefix = "cloud budget:";
markUnsureWords(
  `${typedPrefix} cloud computing is great`,
  {
    words: [
      { word: "cloud", confidence: 0.3 },
      { word: "computing", confidence: 0.98 },
    ],
    spokenStart: typedPrefix.length + 1,
  },
)
=> cloud budget: <unsure>cloud</unsure> computing is great
```

A keyword-stripped TAIL — words-stream entries with no home in the body
(the trigger phrase itself, stripped from `processedTranscript`) — is
tolerated: earlier matches still land, the unmatched tail contributes
nothing to the span's projection.

```ts
markUnsureWords(
  "let's grab lunch",
  {
    words: [
      { word: "let's", confidence: 0.97 },
      { word: "grab", confidence: 0.4 },
      { word: "lunch", confidence: 0.98 },
      { word: "send", confidence: 0.99 },
      { word: "message", confidence: 0.99 },
    ],
  },
)
=> let's <unsure>grab</unsure> lunch
```

A repeated word: alignment order disambiguates which occurrence gets
marked — the first low-confidence "that" wraps, the later confident one
doesn't (both stay single-word spans; "one"/"not" between them are too
confident to extend into, and there's no second seed to bridge toward).

```ts
markUnsureWords(
  "that one not that",
  {
    words: [
      { word: "that", confidence: 0.6 },
      { word: "one", confidence: 0.99 },
      { word: "not", confidence: 0.98 },
      { word: "that", confidence: 0.9 },
    ],
  },
)
=> <unsure>that</unsure> one not that
```

The words stream claims a repeat the body doesn't have room for (both
"that" entries are adjacent seeds — one word-span in stream-space — but
the body only has one "that" to match): the projection just wraps the one
token that actually matched, rather than guessing where the second one
would have gone.

```ts
markUnsureWords("that one thing", { words: [{ word: "that", confidence: 0.6 }, { word: "that", confidence: 0.3 }] })
=> <unsure>that</unsure> one thing
```

Punctuation stays outside the tag; only the word core (and anything
strictly between a span's first and last matched core) wraps.

```ts
markUnsureWords("cloud, right?", { words: [{ word: "cloud", confidence: 0.2 }, { word: "right", confidence: 0.99 }] })
=> <unsure>cloud</unsure>, right?
```

Non-ASCII words wrap whole, and normalization is case-insensitive across
accents (review Fix C — an ASCII-only tokenizer used to split "café" and
wrap only "caf"):

```ts
markUnsureWords("I love café music", { words: [{ word: "café", confidence: 0.4 }] })
=> I love <unsure>café</unsure> music

markUnsureWords("I met Beyoncé backstage", { words: [{ word: "BEYONCÉ", confidence: 0.3 }] })
=> I met <unsure>Beyoncé</unsure> backstage
```

Control markup (`<send-message phrase="…" />`, `<user-selection>…`) is
tag-aware and opaque: a stream word can't land a mark inside one, even
when it normalizes the same as text the tag happens to contain (review
Fix B — `keyword.processedTranscript` replaces the spoken trigger phrase
with exactly this kind of tag, `speech-keywords.ts`'s `keywordTag`). The
low-confidence "message" here has no home outside the tag, so the tag
comes back byte-identical:

```ts
markUnsureWords(
  `let's grab lunch <send-message phrase="send message" />`,
  { words: [{ word: "let's", confidence: 0.97 }, { word: "grab", confidence: 0.98 }, { word: "lunch", confidence: 0.95 }, { word: "message", confidence: 0.3 }] },
)
=> let's grab lunch <send-message phrase="send message" />
```

The same low-confidence word DOES mark when it also occurs as real spoken
text outside the tag — the tag stays untouched either way:

```ts
markUnsureWords(
  `the message got lost <send-message phrase="send message" />`,
  { words: [{ word: "the", confidence: 0.99 }, { word: "message", confidence: 0.3 }, { word: "got", confidence: 0.97 }, { word: "lost", confidence: 0.95 }] },
)
=> the <unsure>message</unsure> got lost <send-message phrase="send message" />
```

A tag SPLITS what would otherwise be one word-span into two separate
wraps: "grab" and "lunch" are adjacent seeds (one contiguous span in
stream-space), but the tag sits physically between their matched body
tokens, so the projection breaks there — a span never contains or crosses
a control tag.

```ts
markUnsureWords(
  `grab <send-message phrase="x" /> lunch`,
  { words: [{ word: "grab", confidence: 0.4 }, { word: "lunch", confidence: 0.3 }] },
)
=> <unsure>grab</unsure> <send-message phrase="x" /> <unsure>lunch</unsure>
```

## `resolveEmissionWords` — collapsing "no data" onto one state (Fix A)

`null`/`undefined` (a service that never captured confidence — Voxtral,
OpenAI realtime) and a defined array where NO entry has a numeric
`confidence` (belt-and-braces) both become `undefined`, never a false
`stt="deepgram"` claim.

```ts
resolveEmissionWords(null)
=> undefined

resolveEmissionWords(undefined)
=> undefined

resolveEmissionWords([{ word: "hi" }, { word: "there" }])
=> undefined

resolveEmissionWords([{ word: "hi" }, { word: "there", confidence: 0.9 }])?.length
=> 2
```

## Site 2 — keyword voice send: inline `<unsure>` marks + `stt` attribute

Words present and applied: marks land in place, `stt="deepgram"` leads
before `diarized` — pinned exact serialization from the plan's Vocabulary
lock-ins example.

```ts
const spokenWords = [
  { word: "They're", confidence: 0.99 },
  { word: "all", confidence: 0.97 },
  { word: "cloud", confidence: 0.29 },
  { word: "code", confidence: 0.95 },
  { word: "in", confidence: 0.9 },
  { word: "different", confidence: 0.98 },
  { word: "ways", confidence: 0.99 },
];
const eMarked = createVoiceEmission({
  text: "They're all cloud code in different ways.",
  selections: [],
  diarized: false,
  words: spokenWords,
});
assembleChatMessage(eMarked, W).message.replace(eMarked.id, "ID")
=> <speech stt="deepgram" message-id="ID" local-time="14:23">They're all <unsure>cloud</unsure> code in different ways.</speech>
```

Captured but none unsure: `stt="deepgram"` stamps, body comes back
unchanged — distinct from "no data captured".

```ts
const eNoneUnsure = createVoiceEmission({
  text: "everything came through clean",
  selections: [],
  diarized: false,
  words: [
    { word: "everything", confidence: 0.99 },
    { word: "came", confidence: 0.97 },
    { word: "through", confidence: 0.95 },
    { word: "clean", confidence: 0.98 },
  ],
});
assembleChatMessage(eNoneUnsure, W).message.replace(eNoneUnsure.id, "ID")
=> <speech stt="deepgram" message-id="ID" local-time="14:23">everything came through clean</speech>
```

Undefined (no confidence data at all — HQ-replaced text, a non-Deepgram
service, or typed origin): no `stt` attribute, body unchanged. The same
shape a `usedHq` send produces (`prepareVoiceSubmitEmission` passes
`words: undefined`; see `voice-intent.doctest.md`'s HQ-drop case) — from
this layer down, "HQ dropped the words" and "no words were ever captured"
are the same state.

```ts
const eNoData = createVoiceEmission({ text: "no data here", selections: [], diarized: false });
assembleChatMessage(eNoData, W).message.replace(eNoData.id, "ID")
=> <speech message-id="ID" local-time="14:23">no data here</speech>
```

## `stt="hq"` — the always-HQ switch's provenance stamp

`hqText: true` (docs/implemented-plans/hq-dictation-switch.md) stamps `stt="hq"` instead
of `stt="deepgram"`, whether or not realtime words happened to be captured —
the two are mutually exclusive: an HQ pass drops the realtime words it
replaced, so `words` is never defined alongside `hqText`.

```ts
const eHq = createVoiceEmission({
  text: "the corrected HQ transcript",
  selections: [],
  diarized: false,
  hqText: true,
  hqService: "whisper-llm",
});
assembleChatMessage(eHq, W).message.replace(eHq.id, "ID")
=> <speech stt="hq" stt-service="whisper-llm" message-id="ID" local-time="14:23">the corrected HQ transcript</speech>
```

`stt` still leads `diarized` in attribute order, same as the deepgram case:

```ts
const eHqDiarized = createVoiceEmission({
  text: "two people talking",
  selections: [],
  diarized: true,
  hqText: true,
});
assembleChatMessage(eHqDiarized, W).message.replace(eHqDiarized.id, "ID")
=> <speech stt="hq" diarized="1" message-id="ID" local-time="14:23">two people talking</speech>
```

## `hq="pending"` / `hq="failed"` — realtime text sent in place of HQ

When a requested HQ pass does not finish in time
(`docs/plans/resilient-voice-recording.md`, Track 4), the realtime text is
sent marked `hq="pending"` (a `corrects` message follows) or `hq="failed"`
(the realtime text is all there is). Realtime words still stamp
`stt="deepgram"`; `hq` follows the `stt` attributes. The four provenance
shapes a voice send can take:

```ts
const provenance = (extra: Record<string, unknown>) => {
  const e = createVoiceEmission({ text: "hello", selections: [], diarized: false, ...extra });
  return assembleChatMessage(e, W).message.replace(e.id, "ID");
};
provenance({})
=> <speech message-id="ID" local-time="14:23">hello</speech>

provenance({ hqText: true, hqService: "mai" })
=> <speech stt="hq" stt-service="mai" message-id="ID" local-time="14:23">hello</speech>

provenance({ hqFallback: "pending", words: [{ word: "hello", confidence: 0.99 }] })
=> <speech stt="deepgram" hq="pending" message-id="ID" local-time="14:23">hello</speech>

provenance({ hqFallback: "failed" })
=> <speech hq="failed" message-id="ID" local-time="14:23">hello</speech>
```

HQ text and an HQ fallback cannot both describe one message:

```ts
createVoiceEmission({ text: "x", selections: [], diarized: false, hqText: true, hqFallback: "pending" })
=> throws InvariantError
```

## Emission ids are distinct per creation (the dedup key)

```ts
const a = createTypedEmission({ text: "x", images: [], files: [], selections: [] });
const b = createTypedEmission({ text: "x", images: [], files: [], selections: [] });
a.id !== b.id && a.id.startsWith("msg-")
=> true
```
