# Emission assembly — the pinned wire format for every send site

`assembleChatMessage` is the one place an Emission becomes a chat payload
(docs/plans/input-extraction.md, chunk 1). These examples pin the exact
historical output of each of the five send sites it replaces — the
refactor's zero-behavior-change guarantee is these strings.

```ts setup
import { assembleChatMessage } from "../../src/frontend/src/input/targets/chat-assemble.js";
import { createTypedEmission, createVoiceEmission } from "../../src/frontend/src/input/emission.js";
import { buildSpeechMessage } from "../../src/frontend/src/components/chat/InteractiveChat-helpers.js";
import { markUnsureWords, resolveEmissionWords, UNSURE_THRESHOLD } from "../../src/frontend/src/input/unsure-words.js";

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

(The text here carries no `[fileN]` tokens, so both files also get noted
at the end of the body — see the placemarker section below.)

```ts
const e = createTypedEmission({
  text: "compare [selection1] with the doc",
  images: [{ id: 1, mimeType: "image/png", dataBase64: "aGk=" }],
  files: [{ id: 1, path: "tmp/2026-07-04T01-00-00_report.pdf" }, { id: 2, path: "tmp/2026-07-04T01-00-01_notes.txt" }],
  selections: [{ id: 1, ref: "/store/notes/Bread.doc.card", text: "let it rise", position: "body; heading: Proofing (#proofing)" }],
});
const out = assembleChatMessage(e, W);
JSON.stringify(out.message)
=> "<typed local-time=\"14:23\">compare <user-selection ref=\"/store/notes/Bread.doc.card\" pos=\"body; heading: Proofing (#proofing)\">let it rise</user-selection> with the doc [file1] [file2]</typed>\n<attachments>\n[file1]: tmp/2026-07-04T01-00-00_report.pdf\n[file2]: tmp/2026-07-04T01-00-01_notes.txt\n</attachments>"

out.images[0]?.mimeType
=> image/png
```

## Missing [fileN] placemarkers are noted at the end of the text

`[fileN]` tokens are placemarkers the user can position in the text; a
file whose token is missing gets its token appended at the end instead, so
the `<attachments>` block never lists an unreferenced file. Voice sends
(whose spoken text never had tokens) and typed sends where the user edited
a token out both land here.

```ts
const e = createVoiceEmission({
  text: "summarize the attached report",
  files: [{ id: 1, path: "tmp/2026-07-19T10-00-00_report.pdf" }],
  selections: [],
  diarized: false,
});
JSON.stringify(assembleChatMessage(e, W).message)
=> "<speech local-time=\"14:23\">summarize the attached report [file1]</speech>\n<attachments>\n[file1]: tmp/2026-07-19T10-00-00_report.pdf\n</attachments>"
```

A present token is left in place — only the absent ones append:

```ts
const e = createTypedEmission({
  text: "compare [file1] against the notes",
  images: [],
  files: [{ id: 1, path: "tmp/a.pdf" }, { id: 2, path: "tmp/b.txt" }],
  selections: [],
});
JSON.stringify(assembleChatMessage(e, W).message)
=> "<typed local-time=\"14:23\">compare [file1] against the notes [file2]</typed>\n<attachments>\n[file1]: tmp/a.pdf\n[file2]: tmp/b.txt\n</attachments>"
```

Empty text with only an attachment (the send guard allows it): the body
is just the token, with no stray leading space:

```ts
const e = createTypedEmission({ text: "", images: [], files: [{ id: 1, path: "tmp/a.pdf" }], selections: [] });
JSON.stringify(assembleChatMessage(e, W).message)
=> "<typed local-time=\"14:23\">[file1]</typed>\n<attachments>\n[file1]: tmp/a.pdf\n</attachments>"
```

## Witness attributes: order is local-time, zoomed-view, time-passed

Historical order from `handleSend`'s template
(`<typed local-time=…${zoomedViewAttr()}${timePassedAttr()}>`).

```ts
const e = createTypedEmission({ text: "hi", images: [], files: [], selections: [] });
assembleChatMessage(e, { localTime: "09:05", zoomedView: "view:store/notes/Foo.md?view=markdown", timePassed: "2d4h" }).message
=> <typed local-time="09:05" zoomed-view="view:store/notes/Foo.md?view=markdown" time-passed="2d4h">hi</typed>
```

## Site 2 — keyword voice send: diarized attr leads, selections append

Historical builder: `runKeywordSend` → `buildSpeechMessage`
(`InteractiveChat-voice.ts` / `InteractiveChat-helpers.ts`). The diarized
attribute comes BEFORE local-time — pinned. Spoken text carries no
tokens, so selections append.

```ts
const sel = [{ id: 2, ref: "/store/recipes/Bread.recipe.card", text: "300g flour", position: "body" }];
const e = createVoiceEmission({ text: "add that to the list", selections: sel, diarized: true });
const out = assembleChatMessage(e, W);
JSON.stringify(out.message)
=> "<speech diarized=\"1\" local-time=\"14:23\">add that to the list\n<user-selection ref=\"/store/recipes/Bread.recipe.card\" pos=\"body\">300g flour</user-selection></speech>"
```

Equivalence with the historical helper (same inputs → same bytes), while
it still exists:

```ts continue
const legacy = buildSpeechMessage({ text: "add that to the list", diarized: true, selections: sel, attrs: " local-time=\"14:23\"" });
out.message === legacy
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
const sel = [{ id: 3, ref: "/store/notes/Bread.doc.card", text: "let it rise", position: "body" }];
const e = createVoiceEmission({ text: "quick thought before I go", selections: sel, diarized: false });
JSON.stringify(assembleChatMessage(e, { localTime: "23:59", zoomedView: null, timePassed: "8h" }).message)
=> "<speech local-time=\"23:59\" time-passed=\"8h\">quick thought before I go\n<user-selection ref=\"/store/notes/Bread.doc.card\" pos=\"body\">let it rise</user-selection></speech>"
```

With no selections pending (the common case), the fold is the identity —
still byte-identical to the old, permanently-unfolded behavior:

```ts
const e2 = createVoiceEmission({ text: "quick thought before I go", selections: [], diarized: false });
assembleChatMessage(e2, { localTime: "23:59", zoomedView: null, timePassed: "8h" }).message
=> <speech local-time="23:59" time-passed="8h">quick thought before I go</speech>
```

## Site 5 — recovered dictation: same shape as stop-and-send

Historical builder: `handleRecoverSend`
(`InteractiveChat.tsx`) — `buildSpeechMessage` with `selections: []`,
`diarized: false`.

```ts
const e = createVoiceEmission({ text: "the text that survived the drop", selections: [], diarized: false });
assembleChatMessage(e, W).message
=> <speech local-time="14:23">the text that survived the drop</speech>
```

## `markUnsureWords` — the pure marking function (Track 3)

`UNSURE_THRESHOLD` is 0.7 (lowered from 0.85 after real-world use — see the
constant's comment); a word AT the threshold is confident, not unsure
(`< 0.7`, not `<=`).

```ts
UNSURE_THRESHOLD
=> 0.7

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

Boundary: exactly 0.7 is confident (unchanged body); just under wraps.

```ts
markUnsureWords("the", { words: [{ word: "the", confidence: 0.7 }] })
=> the

markUnsureWords("the", { words: [{ word: "the", confidence: 0.6999 }] })
=> <unsure>the</unsure>
```

A word with no `confidence` field is "no data" — never wrapped, even when
it's the only entry:

```ts
markUnsureWords("the plan", { words: [{ word: "the" }, { word: "plan" }] })
=> the plan
```

Nothing unsure: body comes back byte-identical.

```ts
markUnsureWords("cloud computing", { words: [{ word: "cloud", confidence: 0.9 }, { word: "computing", confidence: 0.95 }] })
=> cloud computing
```

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
(the trigger phrase itself, stripped from `processedTranscript`) — are
tolerated: earlier matches still land, the unmatched tail is silently
skipped.

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
doesn't.

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

Ambiguous — the words stream claims a repeat the body doesn't have room
for (already consumed by an earlier match): the extra entry has no slot
left and is skipped rather than double-marking or guessing.

```ts
markUnsureWords("that one thing", { words: [{ word: "that", confidence: 0.6 }, { word: "that", confidence: 0.3 }] })
=> <unsure>that</unsure> one thing
```

Punctuation stays outside the tag; only the word core wraps.

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
assembleChatMessage(eMarked, W).message
=> <speech stt="deepgram" local-time="14:23">They're all <unsure>cloud</unsure> code in different ways.</speech>
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
assembleChatMessage(eNoneUnsure, W).message
=> <speech stt="deepgram" local-time="14:23">everything came through clean</speech>
```

Undefined (no confidence data at all — HQ-replaced text, a non-Deepgram
service, or typed origin): no `stt` attribute, body unchanged. The same
shape a `usedHq` send produces (`prepareVoiceSubmitEmission` passes
`words: undefined`; see `voice-intent.doctest.md`'s HQ-drop case) — from
this layer down, "HQ dropped the words" and "no words were ever captured"
are the same state.

```ts
const eNoData = createVoiceEmission({ text: "no data here", selections: [], diarized: false });
assembleChatMessage(eNoData, W).message
=> <speech local-time="14:23">no data here</speech>
```

## Emission ids are distinct per creation (the dedup key)

```ts
const a = createTypedEmission({ text: "x", images: [], files: [], selections: [] });
const b = createTypedEmission({ text: "x", images: [], files: [], selections: [] });
a.id !== b.id && a.id.startsWith("msg-")
=> true
```
