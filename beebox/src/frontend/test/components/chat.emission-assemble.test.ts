// # Emission assembly — the pinned wire format for every send site
//
// `assembleChatMessage` is the one place an Emission becomes a chat payload
// (docs/plans/input-extraction.md, chunk 1). These examples pin the exact
// historical output of each of the five send sites it replaces — the
// refactor's zero-behavior-change guarantee is these strings.

import { test } from "tap";
import "agent-doctest/tap";
import { assembleChatMessage } from "../../src/input/targets/chat-assemble.js";
import { createTypedEmission, createVoiceEmission } from "../../src/input/emission.js";
import { buildSpeechMessage } from "../../src/components/chat/InteractiveChat-helpers.js";
import { markUnsureWords, resolveEmissionWords } from "../../src/input/unsure-words/mark.js";
import { stripUserDisplayTags } from "../../src/components/chat/message-parsing.js";

const W = { localTime: "14:23", zoomedView: null, timePassed: null };

// ## Site 1 — typed send: plain text
//
// Historical builder: `handleSend` (`InteractiveChat-actions.ts`).
void test("Historical builder:", async (t) => {
  // doctest:L24
  const e = createTypedEmission({ text: "hello there", images: [], files: [], selections: [] });
  const out = assembleChatMessage(e, W);
  t.check(out.message, "<typed local-time=\"14:23\">hello there</typed>");

  // doctest:L29
  await t.checkText(out.messageId === e.id, "true");

  // doctest:L32
  await t.checkText(out.images.length, "0");
});

// ## Site 1 — typed send: selections fold, files block, images ride
//
// (The text here carries no `[file#N]` tokens, so both files also get noted
// at the end of the body — see the placemarker section below.)
void test("(The text here carries no [file#N] tokens, so both files also get noted at th...", async (t) => {
  // doctest:L42
  const e = createTypedEmission({
    text: "compare [selection#1] with the doc",
    images: [{ id: 1, mimeType: "image/png", dataBase64: "aGk=" }],
    files: [{ id: 1, path: "_tmp/2026-07-04T01-00-00_report.pdf" }, { id: 2, path: "_tmp/2026-07-04T01-00-01_notes.txt" }],
    selections: [{ id: 1, ref: "/_content/notes/Bread.doc.card", text: "let it rise", position: "body; heading: Proofing (#proofing)" }],
  });
  const out = assembleChatMessage(e, W);
  t.check(out.message, `<typed local-time="14:23">compare <user-selection ref="/_content/notes/Bread.doc.card" pos="body; heading: Proofing (#proofing)">let it rise</user-selection> with the doc [file#1] [file#2]</typed>
<attachments>
[file#1]: _tmp/2026-07-04T01-00-00_report.pdf
[file#2]: _tmp/2026-07-04T01-00-01_notes.txt
</attachments>`);

  // doctest:L52
  t.check(out.images[0]?.mimeType, "image/png");
});

// ## Missing [file#N] placemarkers are noted at the end of the text
//
// `[file#N]` tokens are placemarkers the user can position in the text; a
// file whose token is missing gets its token appended at the end instead, so
// the `<attachments>` block never lists an unreferenced file. Voice sends
// (whose spoken text never had tokens) and typed sends where the user edited
// a token out both land here.
void test("[file#N] tokens are placemarkers the user can position in the text; a file wh...", async (t) => {
  // doctest:L65
  const e = createVoiceEmission({
    text: "summarize the attached report",
    files: [{ id: 1, path: "_tmp/2026-07-19T10-00-00_report.pdf" }],
    selections: [],
    diarized: false,
  });
  t.check(assembleChatMessage(e, W).message.replace(e.id, "ID"), `<speech stt="live" message-id="ID" local-time="14:23">summarize the attached report [file#1]</speech>
<attachments>
[file#1]: _tmp/2026-07-19T10-00-00_report.pdf
</attachments>`);
});

// A present token is left in place — only the absent ones append:
void test("A present token is left in place — only the absent ones append:", async (t) => {
  // doctest:L78
  const e = createTypedEmission({
    text: "compare [file#1] against the notes",
    images: [],
    files: [{ id: 1, path: "_tmp/a.pdf" }, { id: 2, path: "_tmp/b.txt" }],
    selections: [],
  });
  t.check(assembleChatMessage(e, W).message, `<typed local-time="14:23">compare [file#1] against the notes [file#2]</typed>
<attachments>
[file#1]: _tmp/a.pdf
[file#2]: _tmp/b.txt
</attachments>`);
});

// ## A body written before the `#` rename keeps its own spelling
//
// A draft persisted before 2026-08-25 comes back saying `[file1]`. The
// `<attachments>` block labels it the same way, so the token and the line that
// resolves it always agree within one message — the agent is told to read either
// form, not to reconcile two. A file the old body never mentioned still gets the
// current form, because that token is being written now.
void test("A draft persisted before 2026-08-25 comes back saying [file1].", async (t) => {
  // doctest:L97
  const e = createTypedEmission({
    text: "compare [file1] against the notes",
    images: [],
    files: [{ id: 1, path: "_tmp/a.pdf" }, { id: 2, path: "_tmp/b.txt" }],
    selections: [],
  });
  t.check(assembleChatMessage(e, W).message, `<typed local-time="14:23">compare [file1] against the notes [file#2]</typed>
<attachments>
[file1]: _tmp/a.pdf
[file#2]: _tmp/b.txt
</attachments>`);
});

// Empty text with only an attachment (the send guard allows it): the body
// is just the token, with no stray leading space:
void test("Empty text with only an attachment (the send guard allows it):", async (t) => {
  // doctest:L111
  const e = createTypedEmission({ text: "", images: [], files: [{ id: 1, path: "_tmp/a.pdf" }], selections: [] });
  t.check(assembleChatMessage(e, W).message, `<typed local-time="14:23">[file#1]</typed>
<attachments>
[file#1]: _tmp/a.pdf
</attachments>`);
});

// ## Witness attributes: order is local-time, zoomed-view, time-passed
//
// Historical order from `handleSend`'s template
// (`<typed local-time=…${zoomedViewAttr()}${timePassedAttr()}>`).
void test("Historical order from handleSend's template (<typed local-time=…${zoomedViewA...", async (t) => {
  // doctest:L122
  const e = createTypedEmission({ text: "hi", images: [], files: [], selections: [] });
  t.check(assembleChatMessage(e, { localTime: "09:05", zoomedView: "view:_content/notes/Foo.md?view=markdown", timePassed: "2d4h" }).message, "<typed local-time=\"09:05\" zoomed-view=\"view:_content/notes/Foo.md?view=markdown\" time-passed=\"2d4h\">hi</typed>");
});

// ## A `chat:new` notification rides along with the first message
//
// When a notification tap started the conversation, the witness carries it and
// the message gets a `<notification-opened>` sibling block, in the shape of the
// server's `<schedule-fired>`. Its title and body were written by an agent, so
// they are escaped.
void test("When a notification tap started the conversation, the witness carries it and...", async (t) => {
  // doctest:L135
  const e = createTypedEmission({ text: "yes, sign it", images: [], files: [], selections: [] });
  const notificationOpened = { id: "n1", title: "Field trip form <due>", body: "Sign by Friday.", at: "2026-09-26T12:00:00.000Z" };
  t.check(assembleChatMessage(e, { ...W, notificationOpened }).message, `<typed local-time="14:23">yes, sign it</typed>
<notification-opened id="n1" sent-at="2026-09-26T12:00:00.000Z">
Field trip form &lt;due&gt;
Sign by Friday.

The boxholder started this conversation by opening this notification.
</notification-opened>`);

  // The transcript hides the block, as it hides `<schedule-fired>`:

  // doctest:L144
  await t.checkText(stripUserDisplayTags(assembleChatMessage(e, { ...W, notificationOpened }).message), "yes, sign it");
});

// ## Site 2 — keyword voice send: diarized attr leads, selections append
//
// Historical builder: `runKeywordSend` → `buildSpeechMessage`
// (`InteractiveChat-voice.ts` / `InteractiveChat-helpers.ts`). The diarized
// attribute comes BEFORE local-time — pinned. Spoken text carries no
// tokens, so selections append.
void test("Historical builder: (line 155)", async (t) => {
  // doctest:L156
  const sel = [{ id: 2, ref: "/_content/recipes/Bread.recipe.card", text: "300g flour", position: "body" }];
  const e = createVoiceEmission({ text: "add that to the list", selections: sel, diarized: true });
  const out = assembleChatMessage(e, W);
  t.check(out.message.replace(e.id, "ID"), `<speech stt="live" diarized="1" message-id="ID" local-time="14:23">add that to the list
<user-selection ref="/_content/recipes/Bread.recipe.card" pos="body">300g flour</user-selection></speech>`);

  // Equivalence with the historical helper (same inputs → same bytes, modulo the
  // `message-id` and `stt` stamps `buildSpeechMessage` predates and never grew —
  // Track 1, retranscription-in-chat plan; docs/plans/hq-always.md), while it
  // still exists:

  // doctest:L169
  const legacy = buildSpeechMessage({ text: "add that to the list", diarized: true, selections: sel, attrs: " local-time=\"14:23\"" });
  await t.checkText(out.message.replace(` message-id="${e.id}"`, "").replace(' stt="live"', "") === legacy, "true");
});

// ## Sites 3+4 — desktop/mobile stop-and-send: now fold selections (chunk 5, DECIDED)
//
// Historical builders hand-built `<speech local-time="…"…>${text}</speech>`
// with NO selection folding (`InteractiveChat-composer.tsx`,
// `InteractiveChat-mobile-row.tsx`) — an accident of hand-built payloads, not
// a design. Chunk 5 decided (named, boxholder-visible): ALIGN these two
// paths with every other send path and fold the live selections snapshot in
// (`InteractiveChat-dispatch.ts`'s `sendStopSend`), for consistency — every
// other send path already folds.
void test("Historical builders hand-built <speech local-time=\"…\"…>${text}</speech> with...", async (t) => {
  // doctest:L185
  const sel = [{ id: 3, ref: "/_content/notes/Bread.doc.card", text: "let it rise", position: "body" }];
  const e = createVoiceEmission({ text: "quick thought before I go", selections: sel, diarized: false });
  t.check(assembleChatMessage(e, { localTime: "23:59", zoomedView: null, timePassed: "8h" }).message.replace(e.id, "ID"), `<speech stt="live" message-id="ID" local-time="23:59" time-passed="8h">quick thought before I go
<user-selection ref="/_content/notes/Bread.doc.card" pos="body">let it rise</user-selection></speech>`);
});

// With no selections pending (the common case), the fold is the identity —
// still byte-identical to the old, permanently-unfolded behavior:
void test("With no selections pending (the common case), the fold is the identity — stil...", async (t) => {
  // doctest:L195
  const e2 = createVoiceEmission({ text: "quick thought before I go", selections: [], diarized: false });
  t.check(assembleChatMessage(e2, { localTime: "23:59", zoomedView: null, timePassed: "8h" }).message.replace(e2.id, "ID"), "<speech stt=\"live\" message-id=\"ID\" local-time=\"23:59\" time-passed=\"8h\">quick thought before I go</speech>");
});

// ## `markUnsureWords` — the pure marking function (Track 3, span rework)
//
// `UNSURE_THRESHOLD` (0.7) SEEDS a span; `UNSURE_EXTEND` (0.9) grows it
// outward across adjacent gray words; a one-word gap between two spans
// BRIDGES them; a span never crosses sentence-final punctuation. A word AT
// either threshold is on the confident side (`<`, not `<=`).
//
// Single low word with confident (≥0.9) neighbors: still a single-word span
// — unchanged from the pre-rework behavior.
void test("UNSURETHRESHOLD (0.7) SEEDS a span; UNSUREEXTEND (0.9) grows it outward acros...", async (t) => {
  // doctest:L211
  const cleanWords = [
    { word: "they're", confidence: 0.99 },
    { word: "all", confidence: 0.97 },
    { word: "cloud", confidence: 0.29 },
    { word: "code", confidence: 0.95 },
    { word: "in", confidence: 0.9 },
  ];
  t.check(markUnsureWords("they're all cloud code in", { words: cleanWords }), "they're all <unsure>cloud</unsure> code in");
});

// Boundary: exactly 0.7 is confident (unchanged body); just under seeds.
void test("Boundary:", async (t) => {
  // doctest:L225
  t.check(markUnsureWords("the", { words: [{ word: "the", confidence: 0.7 }] }), "the");

  // doctest:L228
  t.check(markUnsureWords("the", { words: [{ word: "the", confidence: 0.6999 }] }), "<unsure>the</unsure>");
});

// ## Hysteresis: a seed's gray (0.7–0.9) neighbors join its span
//
// This is the rework's whole point: the recognizer's language model often
// repairs the actually-wrong word to something plausible, smearing doubt
// across its neighbors rather than leaving it scored low itself. "all" and
// "code" are both gray (below `UNSURE_EXTEND`, above `UNSURE_THRESHOLD`) and
// adjacent to the seed "cloud", so the whole run joins one span; "they're"
// (0.99) and "in" (0.95) are confident and stop it on both sides.
void test("This is the rework's whole point:", async (t) => {
  // doctest:L242
  t.check(
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
    ),
    "they're <unsure>all cloud code</unsure> in",
  );
});

// Gray words with NO seed among them never mark at all — extension only
// grows an existing span, it never starts one on its own.
void test("Gray words with NO seed among them never mark at all — extension only grows a...", async (t) => {
  // doctest:L261
  t.check(markUnsureWords("the plan", { words: [{ word: "the", confidence: 0.8 }, { word: "plan", confidence: 0.85 }] }), "the plan");
});

// ## Bridge: two spans separated by exactly one word join into one
//
// The gap word here is confident (0.95, not even gray) — bridging doesn't
// care about the gap word's own score, only that it's a single word between
// two already-marked regions (the "wrong word scores fine between two dips"
// shape this rework targets).
void test("The gap word here is confident (0.95, not even gray) — bridging doesn't care...", async (t) => {
  // doctest:L273
  t.check(
    markUnsureWords(
      "that one not",
      {
        words: [
          { word: "that", confidence: 0.6 },
          { word: "one", confidence: 0.95 },
          { word: "not", confidence: 0.5 },
        ],
      },
    ),
    "<unsure>that one not</unsure>",
  );
});

// A gap word with NO confidence value bridges the same way (rule 5 — treated
// like confident for extension/bridge, transparent rather than a wall):
void test("A gap word with NO confidence value bridges the same way (rule 5 — treated li...", async (t) => {
  // doctest:L290
  t.check(
    markUnsureWords(
      "that one not",
      {
        words: [
          { word: "that", confidence: 0.6 },
          { word: "one" },
          { word: "not", confidence: 0.5 },
        ],
      },
    ),
    "<unsure>that one not</unsure>",
  );
});

// Two confident words between two seeds is too wide a gap — bridge only
// fires for EXACTLY one — so this stays two separate spans.
void test("Two confident words between two seeds is too wide a gap — bridge only fires f...", async (t) => {
  // doctest:L307
  t.check(
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
    ),
    "<unsure>that</unsure> one two <unsure>not</unsure>",
  );
});

// ## Sentence stop: a span never crosses sentence-final punctuation
//
// "agent." ends its sentence (its own text ends in `.`) — even directly
// adjacent to another seed ("something", the very next word), the two never
// merge into one span; adjacent spans separated only by a sentence boundary
// stay separate. The trailing period of the first span's last token stays
// OUTSIDE the tag, same as any other trailing punctuation.
void test("\"agent.\" ends its sentence (its own text ends in .) — even directly adjacent...", async (t) => {
  // doctest:L330
  t.check(
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
    ),
    "In fact you are an <unsure>agent</unsure>. <unsure>something</unsure> happened after",
  );
});

// A closing quote after the terminator is still a sentence end (`agent."` —
// the words stream carries Deepgram's punctuated form, quotes included):
void test("A closing quote after the terminator is still a sentence end (agent.\" — the w...", async (t) => {
  // doctest:L353
  t.check(
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
    ),
    "he said \"<unsure>agent</unsure>.\" <unsure>something</unsure> happened",
  );
});

// ## Fail-open projection: unmatched words, repeats, prefixes, tags
//
// Without a `spokenStart`, the search for the first words-stream entry just
// scans forward from 0 — a prior-typed-input PREFIX the words stream never
// covered still ends up unmarked here only because it happens not to repeat
// a stream word:
void test("Without a spokenStart, the search for the first words-stream entry just scans...", async (t) => {
  // doctest:L376
  t.check(
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
    ),
    "note to self, <unsure>cloud</unsure> computing is great",
  );
});

// `spokenStart` is what actually GUARANTEES the prefix is off-limits (review
// Fix B): here the typed prefix "cloud budget:" repeats the low-confidence
// stream word "cloud" — without `spokenStart` this would wrap the TYPED
// "cloud"; with it, the scan skips every token before the spoken region and
// marks the real, spoken occurrence.
void test("spokenStart is what actually GUARANTEES the prefix is off-limits (review Fix B):", async (t) => {
  // doctest:L397
  const typedPrefix = "cloud budget:";
  t.check(
    markUnsureWords(
      `${typedPrefix} cloud computing is great`,
      {
        words: [
          { word: "cloud", confidence: 0.3 },
          { word: "computing", confidence: 0.98 },
        ],
        spokenStart: typedPrefix.length + 1,
      },
    ),
    "cloud budget: <unsure>cloud</unsure> computing is great",
  );
});

// A keyword-stripped TAIL — words-stream entries with no home in the body
// (the trigger phrase itself, stripped from `processedTranscript`) — is
// tolerated: earlier matches still land, the unmatched tail contributes
// nothing to the span's projection.
void test("A keyword-stripped TAIL — words-stream entries with no home in the body (the...", async (t) => {
  // doctest:L417
  t.check(
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
    ),
    "let's <unsure>grab</unsure> lunch",
  );
});

// A repeated word: alignment order disambiguates which occurrence gets
// marked — the first low-confidence "that" wraps, the later confident one
// doesn't (both stay single-word spans; "one"/"not" between them are too
// confident to extend into, and there's no second seed to bridge toward).
void test("A repeated word:", async (t) => {
  // doctest:L438
  t.check(
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
    ),
    "<unsure>that</unsure> one not that",
  );
});

// The words stream claims a repeat the body doesn't have room for (both
// "that" entries are adjacent seeds — one word-span in stream-space — but
// the body only has one "that" to match): the projection just wraps the one
// token that actually matched, rather than guessing where the second one
// would have gone.
void test("The words stream claims a repeat the body doesn't have room for (both \"that\"...", async (t) => {
  // doctest:L459
  t.check(markUnsureWords("that one thing", { words: [{ word: "that", confidence: 0.6 }, { word: "that", confidence: 0.3 }] }), "<unsure>that</unsure> one thing");
});

// Punctuation stays outside the tag; only the word core (and anything
// strictly between a span's first and last matched core) wraps.
void test("Punctuation stays outside the tag; only the word core (and anything strictly...", async (t) => {
  // doctest:L467
  t.check(markUnsureWords("cloud, right?", { words: [{ word: "cloud", confidence: 0.2 }, { word: "right", confidence: 0.99 }] }), "<unsure>cloud</unsure>, right?");
});

// Non-ASCII words wrap whole, and normalization is case-insensitive across
// accents (review Fix C — an ASCII-only tokenizer used to split "café" and
// wrap only "caf"):
void test("Non-ASCII words wrap whole, and normalization is case-insensitive across acce...", async (t) => {
  // doctest:L476
  t.check(markUnsureWords("I love café music", { words: [{ word: "café", confidence: 0.4 }] }), "I love <unsure>café</unsure> music");

  // doctest:L479
  t.check(markUnsureWords("I met Beyoncé backstage", { words: [{ word: "BEYONCÉ", confidence: 0.3 }] }), "I met <unsure>Beyoncé</unsure> backstage");
});

// Control markup (`<send-message phrase="…" />`, `<user-selection>…`) is
// tag-aware and opaque: a stream word can't land a mark inside one, even
// when it normalizes the same as text the tag happens to contain (review
// Fix B — `keyword.processedTranscript` replaces the spoken trigger phrase
// with exactly this kind of tag, `speech-keywords.ts`'s `keywordTag`). The
// low-confidence "message" here has no home outside the tag, so the tag
// comes back byte-identical:
void test("Control markup (<send-message phrase=\"…\" />, <user-selection>…) is tag-aware...", async (t) => {
  // doctest:L492
  t.check(
    markUnsureWords(
      "let's grab lunch <send-message phrase=\"send message\" />",
      { words: [{ word: "let's", confidence: 0.97 }, { word: "grab", confidence: 0.98 }, { word: "lunch", confidence: 0.95 }, { word: "message", confidence: 0.3 }] },
    ),
    "let's grab lunch <send-message phrase=\"send message\" />",
  );
});

// The same low-confidence word DOES mark when it also occurs as real spoken
// text outside the tag — the tag stays untouched either way:
void test("The same low-confidence word DOES mark when it also occurs as real spoken tex...", async (t) => {
  // doctest:L503
  t.check(
    markUnsureWords(
      "the message got lost <send-message phrase=\"send message\" />",
      { words: [{ word: "the", confidence: 0.99 }, { word: "message", confidence: 0.3 }, { word: "got", confidence: 0.97 }, { word: "lost", confidence: 0.95 }] },
    ),
    "the <unsure>message</unsure> got lost <send-message phrase=\"send message\" />",
  );
});

// A tag SPLITS what would otherwise be one word-span into two separate
// wraps: "grab" and "lunch" are adjacent seeds (one contiguous span in
// stream-space), but the tag sits physically between their matched body
// tokens, so the projection breaks there — a span never contains or crosses
// a control tag.
void test("A tag SPLITS what would otherwise be one word-span into two separate wraps:", async (t) => {
  // doctest:L517
  t.check(
    markUnsureWords(
      "grab <send-message phrase=\"x\" /> lunch",
      { words: [{ word: "grab", confidence: 0.4 }, { word: "lunch", confidence: 0.3 }] },
    ),
    "<unsure>grab</unsure> <send-message phrase=\"x\" /> <unsure>lunch</unsure>",
  );
});

// ## `resolveEmissionWords` — collapsing "no data" onto one state (Fix A)
//
// `null`/`undefined` (a service that never captured confidence — Voxtral,
// OpenAI realtime) and a defined array where NO entry has a numeric
// `confidence` (belt-and-braces) both become `undefined`, never a false
// confidence claim.
void test("null/undefined (a service that never captured confidence — Voxtral, OpenAI re...", async (t) => {
  // doctest:L532
  t.check(resolveEmissionWords(null), undefined);

  // doctest:L535
  t.check(resolveEmissionWords(undefined), undefined);

  // doctest:L538
  t.check(resolveEmissionWords([{ word: "hi" }, { word: "there" }]), undefined);

  // doctest:L541
  t.check(resolveEmissionWords([{ word: "hi" }, { word: "there", confidence: 0.9 }])?.length, 2);
});

// ## Site 2 — keyword voice send: inline `<unsure>` marks on live text
//
// Every dictated message gets the HQ pass when it can (docs/plans/hq-always.md),
// so the wrapper marks the exception: `stt="live"` on any voice emission without
// `hqText`. Realtime words, when captured, mark `<unsure>` spans in place — they
// only ever describe live text. `stt` leads `diarized` in attribute order.
void test("Every dictated message gets the HQ pass when it can (docs/plans/hq-always.md)...", async (t) => {
  // doctest:L553
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
  t.check(assembleChatMessage(eMarked, W).message.replace(eMarked.id, "ID"), "<speech stt=\"live\" message-id=\"ID\" local-time=\"14:23\">They're all <unsure>cloud</unsure> code in different ways.</speech>");
});

// Captured but none unsure, or no confidence data at all (a non-Deepgram live
// service, or an HQ fallback whose words were never captured): the same
// `stt="live"`, body unchanged.
void test("Captured but none unsure, or no confidence data at all (a non-Deepgram live s...", async (t) => {
  // doctest:L577
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
  t.check(assembleChatMessage(eNoneUnsure, W).message.replace(eNoneUnsure.id, "ID"), "<speech stt=\"live\" message-id=\"ID\" local-time=\"14:23\">everything came through clean</speech>");

  // doctest:L591
  const eNoData = createVoiceEmission({ text: "no data here", selections: [], diarized: false });
  t.check(assembleChatMessage(eNoData, W).message.replace(eNoData.id, "ID"), "<speech stt=\"live\" message-id=\"ID\" local-time=\"14:23\">no data here</speech>");
});

// ## A live gap marker is sent as unsure
//
// `[…]` in live text marks speech the live pass never transcribed
// (`docs/implemented-plans/live-gap-marker.md`). It goes to the agent wrapped in
// `<unsure>`, anywhere in a live voice message — a marker can sit in the
// prefix when an earlier segment's text was folded into the composer. Realtime
// words on either side still mark their own spans; the marker matches no word.
void test("[…] in live text marks speech the live pass never transcribed (docs/implement...", async (t) => {
  // doctest:L605
  const eGap = createVoiceEmission({
    text: "Pick up the cleaning […] and the milk",
    selections: [],
    diarized: false,
    words: [
      { word: "Pick", confidence: 0.99 },
      { word: "up", confidence: 0.98 },
      { word: "the", confidence: 0.97 },
      { word: "cleaning", confidence: 0.3 },
      { word: "and", confidence: 0.95 },
      { word: "the", confidence: 0.96 },
      { word: "milk", confidence: 0.99 },
    ],
  });
  t.check(assembleChatMessage(eGap, W).message.replace(eGap.id, "ID"), "<speech stt=\"live\" message-id=\"ID\" local-time=\"14:23\">Pick up the <unsure>cleaning</unsure> <unsure>[…]</unsure> and the milk</speech>");

  // doctest:L622
  const eGapNoWords = createVoiceEmission({ text: "first […] second […]", selections: [], diarized: false });
  t.check(assembleChatMessage(eGapNoWords, W).message.replace(eGapNoWords.id, "ID"), "<speech stt=\"live\" message-id=\"ID\" local-time=\"14:23\">first <unsure>[…]</unsure> second <unsure>[…]</unsure></speech>");
});

// An HQ message keeps a marker that came from an earlier live segment in its
// prefix, wrapped the same way:
void test("An HQ message keeps a marker that came from an earlier live segment in its pr...", async (t) => {
  // doctest:L631
  const hqWithPrefixGap = createVoiceEmission({ text: "earlier […] then the HQ part", selections: [], diarized: false, hqText: true, hqService: "whisper" });
  t.check(assembleChatMessage(hqWithPrefixGap, W).message.replace(hqWithPrefixGap.id, "ID"), "<speech stt-service=\"whisper\" message-id=\"ID\" local-time=\"14:23\">earlier <unsure>[…]</unsure> then the HQ part</speech>");
});

// A typed message is left as typed, including text moved there by "Edit before
// sending" — the marker stays, without the tag:
void test("A typed message is left as typed, including text moved there by \"Edit before...", async (t) => {
  // doctest:L640
  const typedGap = createTypedEmission({ text: "see […] above", images: [], files: [], selections: [] });
  t.check(assembleChatMessage(typedGap, W).message, "<typed local-time=\"14:23\">see […] above</typed>");
});

// ## HQ text — the norm, unmarked
//
// `hqText: true` is the HQ pass's text. It carries no `stt`, only
// `stt-service` naming the engine when known. An HQ pass drops the realtime
// words it replaced, so `words` is never defined alongside `hqText`.
void test("hqText:", async (t) => {
  // doctest:L652
  const eHq = createVoiceEmission({
    text: "the corrected HQ transcript",
    selections: [],
    diarized: false,
    hqText: true,
    hqService: "whisper-llm",
  });
  t.check(assembleChatMessage(eHq, W).message.replace(eHq.id, "ID"), "<speech stt-service=\"whisper-llm\" message-id=\"ID\" local-time=\"14:23\">the corrected HQ transcript</speech>");

  // doctest:L662
  const eHqDiarized = createVoiceEmission({
    text: "two people talking",
    selections: [],
    diarized: true,
    hqText: true,
  });
  t.check(assembleChatMessage(eHqDiarized, W).message.replace(eHqDiarized.id, "ID"), "<speech diarized=\"1\" message-id=\"ID\" local-time=\"14:23\">two people talking</speech>");
});

// ## Emission ids are distinct per creation (the dedup key)
void test("Emission ids are distinct per creation (the dedup key)", async (t) => {
  // doctest:L675
  const a = createTypedEmission({ text: "x", images: [], files: [], selections: [] });
  const b = createTypedEmission({ text: "x", images: [], files: [], selections: [] });
  await t.checkText(a.id !== b.id && a.id.startsWith("msg-"), "true");
});

// ## An inline image's original file is listed like a file
//
// An image whose original landed gets an `[image#N]: <path>` line after the
// file lines, spelled the way the body spells the token. An image without a
// path (its upload failed, or the client predates originals) gets no line at
// all: the absence is the signal. The wire `images` carry only what the server
// keys the image blocks on — the path reaches it through the text.
void test("An image whose original landed gets an [image#N]:", async (t) => {
  // doctest:L690
  const e = createTypedEmission({
    text: "receipt [image#1] and the older [image2], plus [file#1]",
    images: [
      { id: 1, mimeType: "image/jpeg", dataBase64: "AA", path: "_tmp/2026-09-16T10-00-00.000Z_IMG_0001.jpg" },
      { id: 2, mimeType: "image/png", dataBase64: "BB", path: "_tmp/2026-09-16T10-00-01.000Z_shot.png" },
      { id: 3, mimeType: "image/png", dataBase64: "CC" },
    ],
    files: [{ id: 1, path: "_tmp/2026-09-16T10-00-02.000Z_notes.txt" }],
    selections: [],
  });
  const out = assembleChatMessage(e, W);
  t.check(out.message, `<typed local-time="14:23">receipt [image#1] and the older [image2], plus [file#1]</typed>
<attachments>
[file#1]: _tmp/2026-09-16T10-00-02.000Z_notes.txt
[image#1]: _tmp/2026-09-16T10-00-00.000Z_IMG_0001.jpg
[image2]: _tmp/2026-09-16T10-00-01.000Z_shot.png
</attachments>`);

  // doctest:L704
  t.check(out.images, [
    {
      id: 1,
      mimeType: "image/jpeg",
      dataBase64: "AA",
    },
    {
      id: 2,
      mimeType: "image/png",
      dataBase64: "BB",
    },
    {
      id: 3,
      mimeType: "image/png",
      dataBase64: "CC",
    },
  ]);
});

// Images alone (no files) still open the block; an image whose token was edited
// out of the body is labelled in the current form.
void test("Images alone (no files) still open the block; an image whose token was edited...", async (t) => {
  // doctest:L712
  const e = createTypedEmission({
    text: "what is this",
    images: [{ id: 1, mimeType: "image/png", dataBase64: "AA", path: "_tmp/x.png" }],
    files: [],
    selections: [],
  });
  t.check(assembleChatMessage(e, W).message, `<typed local-time="14:23">what is this</typed>
<attachments>
[image#1]: _tmp/x.png
</attachments>`);
});

// Nothing landed, nothing listed — the message is byte-identical to one sent
// before originals existed.
void test("Nothing landed, nothing listed — the message is byte-identical to one sent be...", async (t) => {
  // doctest:L726
  const e = createTypedEmission({
    text: "look [image#1]",
    images: [{ id: 1, mimeType: "image/png", dataBase64: "AA" }],
    files: [],
    selections: [],
  });
  t.check(assembleChatMessage(e, W).message, "<typed local-time=\"14:23\">look [image#1]</typed>");
});
