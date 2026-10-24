---
title: "TTS comparison, second run: new texts, every model rendered by script"
status: draft
workstream: tts-comparison-page
issues: []
---
# TTS comparison, second run: new texts, every model rendered by script

The text-to-speech comparison on beebox.run
(`site/cards/develop.attach/tts-comparison.doc.card`) plays takes from a
September 2026 run whose generator was not kept. The boxholder chose a new
set of test texts in two listening rounds (2026-10-24). This plan renders
that set on all nineteen models with a script kept in the repository, then
rewrites the page around it.

**Issues addressed:** none filed. Searched `issues/` for `tts`,
`text-to-speech`, and `comparison`. Related, not resolved here:
`issues/exploration/2026-10-20-tts-inline-delivery-markup.md` (inline
direction markup; this run adds evidence for it) and
`issues/docs-and-chores/2026-10-17-public-provider-list-drifts-from-code.md`
(a different page).

## Design

No design section: the work changes a public page about development and a
research script. Nothing a person meets in the box changes. The boxholder's
page requests are recorded as requirements in Tracks 3 and 4.

## Smallest fix and budget

Smallest fix: extend `candidates.ts`, which already renders on seventeen
models (`research/tts-model-comparison/candidates.ts`), with the chosen texts,
and hand-write the page around its output. That fails three requirements:
the page needs direction on every model that has a channel (candidates.ts
sends direction only to the three instruction-field models), the takes need
transcript checks and costs for the page's sections, and a later run must be
reproducible from `results.json` through `publish.ts`, which the boxholder
asked for when the first page shipped ("Adding or re-rendering a model" in
the README).

Chosen design, four tracks:

| Track | Estimated changed lines |
|---|---|
| 1. Clip and variant data (lib.ts schema, results.json clips) | 120 source |
| 2. Provider adapters and rendering (render.ts; candidates.ts reuses them) | 550 source |
| 3. Page generation (publish.ts, the audio tag's reference label) | 200 source, 40 test |
| 4. Page prose and README | 200 docs |

About 900 source and test lines, 200 lines of docs. Generated output is
separate: results.json (about 4,000 lines replaced) and about 230 Opus files
(about 6 MB) replacing the 213 now in `site/assets/tts-comparison/`.
Not a BIG CHANGE.

## Stated preferences this plan trades against

- **Operational simplicity** (boxholder memory, "operational simplicity
  beats per-call cost"): every adapter reads keys that already exist on this
  machine. No new accounts.
- **Fail closed** (boxholder memory, "bias toward strict"): `render.ts`
  already writes nothing unless every take of a model succeeds
  (`research/tts-model-comparison/render.ts:179-181`: *"results.json
  unchanged"*). Kept, per model.
- **Arrange context, don't automate judgment** (boxholder memory): the page
  reports what the transcript shows (direction read aloud) and leaves
  delivery to the listener. No automated quality score.
- **Research corpora skip cross-model review** (`research/AGENTS.md`:
  *"Research corpora do not need a cross-model (Codex) review"*). This plan
  changes code that publishes a public page, so it gets a plan review and a
  diff review anyway, as the first page did.

## What already exists

- `research/tts-model-comparison/render.ts`: the `Provider` interface, one
  Voxtral adapter, the WAV duration reader, transcription with
  gpt-4o-transcribe, and the all-or-nothing write. Reuse and extend.
- `research/tts-model-comparison/candidates.ts`: working request shapes for
  OpenAI direct, OpenRouter (six models, including Gemini 3.1's PCM-only
  answer), ElevenLabs, Cartesia, Deepgram v1 and v2, and the `envKey`
  reader for `~/src/beebox/beebox/.env`. Copy the shapes into the new
  adapters; candidates.ts stays as it is (an exploration tool, and
  importing `render.ts` would run its CLI, `render.ts:197`).
- `beebox/src/services/tts.ts:385` `createTtsService`: the box's own OpenAI
  and Gemini 3.8 Flash-Lite calls. The two shipped models render through it,
  so their takes are what the box sends.
- `beebox/src/core/tts/interaction-stream.ts:87` `interactionAudioChunks`:
  reads Gemini's Interactions stream as PCM. Reuse for Gemini 3.8 Flash and
  3.1 on Google's API (both verified, Track 2).
- `research/tts-model-comparison/lib.ts` `transcriptCheck()`: finds
  direction words in a transcript. Reuse; Track 1 adds formatting words.
- `research/tts-model-comparison/publish.ts`: transcode, prune, template
  fill, contents list, the "Direction read aloud" section. Extend.
- `site/evaluation-tags.ts:47` the `{% audio %}` tag. Extend with a
  reference label (Track 3).
- `site/navigation-script.ts`: one player at a time. No change.

## Prior art (external)

No design decision depends on outside prior art. The provider request shapes
are verified by calling the APIs (Track 2). Value lists come from the
providers' docs where the API does not validate: Cartesia's emotions
(docs.cartesia.ai/build-with-cartesia/sonic-3/volume-speed-emotion),
MiniMax's (platform.minimax.io/docs/api-reference/speech-t2a-http), and
Voxtral's 34 emotions and 5 paces
(docs.mistral.ai/studio/audio/text-to-speech/emotion-tags). Evaluated only.

## Ontology

- **Model** (exists, `lib.ts` `modelSchema`): one speech model on one route
  with one voice. Identified by `id`.
- **Clip** (exists, `lib.ts` `clipSchema`): one test text and what to listen
  for. Gains a short **code** (`S`, `A`, `L`, …) for references. Loses the
  single `direction`; directions move to variants.
- **Variant** (new as data; today a fixed enum `plain | directed | markup`,
  `lib.ts:65`): one way to read a clip. Identified by `id` within its clip
  (`plain`, `directed`, `she`, `money`, `she-italic`, `then-italic`). Has its
  own text when it changes the words (Markdown italics) and an optional
  **direction**.
- **Direction** (exists, `lib.ts` `directionSchema`): the delivery request
  in every form a channel takes: `prose` (instruction field), `prefix`
  (prose in front of the text), `tagged` (the text with free-form bracket
  tags), `emotion` (a fixed value per provider), and provider-specific text
  (`grok`, `voxtral`).
- **Channel** (exists as a string on a render): how a direction reached a
  model. Each adapter maps a direction to one channel or to none.
- **Take** (exists as `Render`): one model reading one variant once.
  Identified by model, clip, variant. Gains a **reference**,
  `<clip code>-<variant>-<model short name>`, shown on the page and used as
  its anchor id.

## Tracks / scope

### Track 1. Clip and variant data

- **What:** replace the clip set in `results.json` with the chosen texts and
  make variants data.
- **Why:** the new set has variants the fixed enum cannot name: stress on
  "she" and on "money", Markdown italics, a list read only as Markdown.
- **Direction:** `clipSchema` gains `code: string` and
  `variants: Variant[]`. `Variant = { id, label, text?, direction?,
  formatting?: string[] }`. `text` replaces the clip text for that variant.
  A variant with no `direction` is a **text variant**: every model reads it.
  `Direction = { prose, tagged?, cartesia?: { emotion, speed?, volume? },
  azure?, minimax?, grok?, voxtral? }`. The fixed values are zod enums of
  the documented or probed lists (Track 2 table), so a typo fails
  `loadResults()` instead of reaching Cartesia or MiniMax, which accept
  anything. The exact texts and directions are in the appendix.
  `formatting` lists words that mean Markdown was read aloud ("dash",
  "bullet", "asterisk", "underscore"); `transcriptCheck` reports them like
  direction words. `renderSchema.variant` becomes a string checked against
  the clip's variant ids in `loadResults()`.
  The clips and variants, from the README's "Choosing the next texts"
  (exact texts and directions: appendix):

  | Code | Clip | Variants |
  |---|---|---|
  | S | Sarcasm (spreadsheet) | plain, directed |
  | A | Anger held in check | plain, directed |
  | R | Staying late (reluctant) | plain, directed |
  | L | A list | plain (Markdown bullets) |
  | C | Code-switching on look-alike words | plain, directed |
  | D | Dialog | plain, directed |
  | E | Worked math | plain, then-italic |
  | W | Water boiling | plain, directed |
  | X | Word stress | plain, she, money, she-italic |

- **Vocabulary lock-ins:** clip codes and variant ids appear in file names
  (`<model>__<clip>__<variant>.<ext>`) and page anchors.
- **First implementation chunk:** the schema change, the new clips in
  results.json with every direction form filled from the Track 2 table, the
  old renders removed, `loadResults()` checks, and `transcriptCheck`
  formatting words. The page is not regenerated in this chunk.

### Track 2. Provider adapters and rendering

- **What:** an adapter per provider family in `render.ts`, so
  `render.ts --model <id>` renders any of the nineteen models.
- **Why:** only Voxtral renders today (`render.ts:95`).
- **Direction:** `Provider` keeps its shape, with `directed` replaced by a
  pure function `request(variant, clip) → { channel, url, body } |
  undefined`. A text variant always gets a request. A directed variant gets
  `undefined` when the model has no channel for that direction; render.ts
  then records a row with `channel: "none available"` and no file, so the
  run's matrix is complete either way. Families and channels:

  Verified against the live APIs on 2026-10-24 (probe scripts and fetched
  docs in the session scratchpad; findings summarized here):

  | Models | Channel | Variants it carries |
  |---|---|---|
  | gpt-4o-mini-tts, both dates | `instructions` field (prose) | every directed variant |
  | Gemini 3.8 Flash-Lite (box service), 3.8 Flash (direct) | `speech_metadata.style` annotation (prose) | every directed variant |
  | Gemini 3.1, direct and via OpenRouter | prose prefix in the text; inline `[tags]` | every directed variant. Direct 3.1 answers 400 "Speech metadata is not supported for this model"; OpenRouter's `instructions` field has no effect on 3.1 (prompt tokens unchanged) |
  | ElevenLabs v3 | inline `[tags]` (not read aloud: probe transcript clean) | variants with a `tagged` form |
  | Fish S2.1 Pro via OpenRouter | inline `[tags]` and `(events)`, `provider.options["fish-audio"].normalize=false` | variants with a `tagged` form |
  | Cartesia sonic-3.6, sonic-turbo | `generation_config.emotion` (+ `speed`, `volume`) | S `sarcastic`, A `angry` (speed 0.85, volume 0.8), R `resigned`, W `calm` |
  | MAI-Voice-2, 2 Flash via OpenRouter | `provider.options.azure.style` | A `angry` only; no accepted style fits S, R, W, D, C, X |
  | MiniMax 2.8 Turbo via OpenRouter | `provider.options.minimax.emotion` | A `angry`, R `sad`, W `calm` |
  | Grok via OpenRouter | `[pause]` events and `<slow>`/`<soft>` spans | A, R, D, with a `grok` form |
  | Voxtral TTS 3 | inline `[emotion=…]` `[pace=…]` | S `sarcastic`, A `tense`/`critical` + slow, R `resigned`, W `calm`, D pace only |
  | tts-1-hd, ElevenLabs Flash v2.5, Deepgram Aura-2, Flux | none | plain and text variants only. Flash v2.5 reads tags aloud (probe: "Sarcastic. …") |

  Two channels cannot be confirmed from a response. Cartesia accepts any
  `emotion` string with 200 (`"zzz_invalid"` produced audio), so a typo is
  silent; the clip data uses an enum of the documented values
  (docs.cartesia.ai/build-with-cartesia/sonic-3/volume-speed-emotion).
  OpenRouter accepts any MiniMax option (`"zzzbad"` returned 200), so the
  page says the MiniMax emotion was sent and not confirmed. MAI styles were
  probed against the Harper voice: accepted are angry, sad, excited,
  hopeful, shouting, whispering, relieved, embarrassed, confused,
  determined, happy, neutral, joyful; an unaccepted style answers 400, so it
  fails loudly.

  Gemini on Google's API is called one request at a time with a 20-second
  backoff on HTTP 429, as candidates.ts does. Every take is transcribed with
  gpt-4o-transcribe. Cost: OpenRouter's billed amount from `GET /api/v1/generation?id=<x-generation-id>`
  (`data.total_cost`, verified on four models); list price × characters
  otherwise, marked `costEstimated`. Fish uses the old run's voice,
  `9a9cf47702da476aa4629e2506d4a857` (a "Fish Official" English voice,
  found in Fish's public catalog and accepted by OpenRouter).
- **Vocabulary lock-ins:** model ids stay as they are in results.json, so
  the page's model list and file names stay recognizable.
- **First implementation chunk:** the request function for each family, with
  `render.test.ts` checking one built request per family (direction in the
  intended field: OpenAI `instructions`, Gemini 3.8 `speech_metadata.style`,
  Gemini 3.1 prefix in the text, Cartesia `generation_config.emotion`,
  OpenRouter `provider.options.azure|minimax`, tags in the text for
  ElevenLabs v3, Fish, Grok, Voxtral; a text variant unchanged on a model
  with no channel). `--dry-run` lists every take with its channel for all
  nineteen models. No requests are sent in this chunk. The CLI entry moves
  behind an `import.meta` main check so the test can import the module.

### Track 3. Page generation

- **What:** publish.ts writes the new page: clip sections by code, each take
  with a visible reference, the "Direction read aloud" section extended with
  formatting read aloud.
- **Why:** the boxholder asked that takes be "labeled better for reference"
  (2026-10-24), and the page must describe the new clip set.
- **Direction:** the `{% audio %}` tag gains an optional `ref` attribute
  (`/^[A-Za-z0-9-]+$/`). It renders the reference as a small label before the
  player and as the player's `id`, so `#X-she-gemini38lite` links to the
  take. Each take line reads: model pill, variant label, channel, notes,
  then the reference and player. A variant a model has no channel for shows
  one line: "No channel for this direction." The pacing representative
  logic (`representative()`, `takesNote()`) goes: every variant has one take.
  Before it transcodes, prunes, or writes the card, publish.ts checks the
  run is complete: every model × clip × variant has a row, and every row
  with a file has its source audio. It fails with the list of gaps. A
  `--fresh` flag empties `site/assets/tts-comparison/` and transcodes every
  take from source, so no WebM from the old run can stand in for a new take
  of the same name; this run uses it. The page drops the old run's audio.
- **Vocabulary lock-ins:** the `ref` attribute on `{% audio %}`.
- **First implementation chunk:** the `ref` attribute with its tests in
  `site/evaluation-tags.test.ts` (valid ref renders the label and id; an
  invalid ref fails the build).

### Track 4. Page prose and README

- **What:** rewrite `page-template.md` for the new texts, and record the run.
- **Why:** the prose describes the old seven texts and pacing takes.
- **Direction:** the "How it was tested" list describes the nine clips.
  A new paragraph states the finding behind clip R, with its evidence named:
  in the round-2 listening test (2026-10-24, the boxholder listening), Gemini
  3.8 Flash-Lite carried all four wordings of the reluctant direction, and
  gpt-4o-mini-tts carried none of them well. Those takes stay in the round-2
  exhibit, not on the page. The full run's R takes are then heard on the
  page beside the statement. The README's
  Runs table gains the new run; the September run is noted as replaced, with
  the commit that last held its results.
- **First implementation chunk:** the template rewrite after the full
  render, so its statements are checked against the takes.

## Could this be simpler?

The simplest version is the smallest fix above: candidates.ts output and a
hand-written page. It fails on two cases. First, fifteen of the nineteen
models take direction in some form, and candidates.ts sends it to three; the
page would show "no direction" for models that have a channel, which is
false. Second, the next model to compare would need the page hand-edited
again, and the first plan's purpose was a repeatable pipeline
(`beebox/docs/implemented-plans/tts-comparison-page.md`).

Considered and cut: moving candidates.ts onto the new adapters (no use for
this run); repeats per take (no clip tests take-to-take variation
now that pacing is gone); a markup variant separate from directed (the new
set has none; the old one existed for anger and exhaustion); automated
delivery scoring.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A provider accepts a direction field and ignores it | No | No | Silent; the page says to listen, and takes sit beside plain ones |
| A model reads tags or Markdown aloud | No | `transcriptCheck` lists direction and formatting words | Clear on the page |
| The transcriber drops a tag read aloud | No | No | Silent; the page states the check's limit (existing prose) |
| Gemini rate limit (429) mid-run | No | Backoff, then the model's run fails whole | Clear: render.ts names the failed takes |
| One take of a model fails | No | The model's results stay unchanged (`render.ts:179-181`) | Clear |
| A variant id in renders matches no clip variant | Track 1 adds a check | `loadResults()` throws | Clear |
| An adapter puts direction in the wrong request field | `render.test.ts`, one request per family | — | Clear in the test |
| A model's rows are missing when publish runs | Track 3 completeness check | publish.ts lists the gaps and writes nothing | Clear |
| An old WebM stands in for a new take of the same name | — | `--fresh` transcodes every take from source | Clear |
| A take's reference collides with another | Track 3 check | publish.ts throws on a duplicate reference | Clear |
| A Cartesia emotion typo is accepted silently | Track 1 enum | Schema rejects an undocumented value | Clear |
| The MiniMax emotion option never reaches MiniMax | No | No (OpenRouter accepts any value) | Silent; the page says "sent, not confirmed" |
| OpenRouter's generation lookup fails | No | Falls back to list price, marked estimated | Clear |

No critical gap: the silent rows are limits of listening tests or of a
route, each stated on the page.

## Agent-flow / user-flow edge cases

- Wrong field: an adapter puts direction in the text for a model that reads
  it aloud. ADDRESSED: the transcript check lists it, and the "Direction read
  aloud" section collects it.
- Stale ref: a link to an old take's anchor (`#pacing`) after the rewrite.
  ACCEPTED: the page is unlisted and one week old; old anchors lead to the
  top of the page.
- Two agents: not applicable; one script writes results.json.
- Hand-edit drift: someone edits the generated card. ADDRESSED: its
  frontmatter says it is generated (`page-template.md:2-3`).
- Fabricated value: not applicable.
- Validation error UX: `loadResults()` names the take and the bad field.
- Transition state: results.json holds either the old run or the new one; the
  page is regenerated only after every model renders.

## NOT in scope

- Gemini 3.1 direction through a request field: neither route has one that
  works (Track 2 table).
- MAI-Voice-2.1 and 2.1 Flash, now listed on OpenRouter: new models are a
  separate addition after this run.
- Voice choice per model: each keeps the old run's voice.
- Changing the box's speech backend or its personality-card direction: the
  clip R finding may bear on it; that is a separate decision.
- Keeping the September run on the page: replaced. Its data stays in git
  history.

## Open design questions

- Whether gpt-4o-transcribe or Voxtral 3 should transcribe
  (`issues/features/2026-10-20-upgrade-transcription-to-voxtral-3.md`).
  Lean: gpt-4o-transcribe, as the October takes used; one transcriber for
  the whole run.

## Knowledge audits

None: no agent-facing concept changes. The work is a research script and a
public page.

## What will hold this after it ships

- `site/evaluation-tags.test.ts`: the `ref` attribute renders and rejects
  bad values.
- `loadResults()` validation: every render names a known model, clip, and
  variant; file names match the take.
- `render.test.ts`: one built request per provider family, so a direction
  in the wrong field fails a test.
- `render.ts --dry-run`: lists every planned take and channel without
  sending requests; run it before a full run.
- publish.ts's completeness check: a run with a gap does not publish.
- The site build's link check fails on a missing audio file
  (`site/build.ts`, from the first plan).

## Implementation order

1. Track 3 first chunk: the `ref` attribute on `{% audio %}`, with tests.
2. Track 1: schema, clips, transcript formatting words.
3. Track 2: adapters and `--dry-run` for all nineteen models; then a live
   render one model at a time.
4. Track 3: publish.ts for the new data; prune the old audio.
5. Track 4: prose and README, checked against the takes.
6. Cross-model diff review; the boxholder listens before landing.

## Rollout shape

Done when: `render.ts --dry-run` lists every take for nineteen models;
every model renders; `publish.ts --prune` regenerates the page; the site
build and site tests pass; the boxholder has listened to the page from a
local build. Landing and pushing publish it, and need the boxholder's yes.
No data migration: results.json is replaced, and the old run stays in git.

## Appendix: the clips

Texts and directions as rendered. `tagged` is used by ElevenLabs v3, Fish,
and Gemini 3.1 (after the prose as a prefix: `<prose>: "<tagged>"`, the old
run's form). A form left out means that family has no channel for the
variant.

**S · Sarcasm.** Text: "Thanks for updating the spreadsheet. I can tell you
put a lot of care into it." Directed: prose "Dry, cutting sarcasm. The
speaker is annoyed and means the opposite of every word. Lean on 'a lot of
care'"; tagged "[sarcastically] Thanks for updating the spreadsheet. [dryly]
I can tell you put a lot of care into it."; Cartesia `sarcastic`; Voxtral
"[emotion=sarcastic]…".

**A · Anger held in check.** Text: "I asked for the report on Monday. It's
Thursday. I'm going to need it by the end of today." Directed: prose
"Barely contained fury: quiet, clipped, every word deliberate. Do not
shout"; tagged "[quietly furious] I asked for the report on Monday.
[coldly] It's Thursday. [through gritted teeth] I'm going to need it by the
end of today."; Cartesia `angry`, speed 0.85, volume 0.8; MAI `angry`;
MiniMax `angry`; Grok "<slow>I asked for the report on Monday.</slow>
[pause] <soft>It's Thursday.</soft> [pause] <slow>I'm going to need it by
the end of today.</slow>"; Voxtral "[emotion=tense][pace=slow]I asked for
the report on Monday. [emotion=critical]It's Thursday. [emotion=tense]I'm
going to need it by the end of today." (the old run's forms).

**R · Staying late.** Text: "Sure, I can stay late tonight." Directed: prose
"Agreeing, but tired and a little put-upon: you'll do it, and you'd rather
not."; tagged "[sighs] [reluctantly] Sure, I can stay late tonight.";
Cartesia `resigned`; MiniMax `sad`; Grok "[sigh] <slow>Sure, I can stay late
tonight.</slow>"; Voxtral "[emotion=resigned]Sure, I can stay late
tonight."

**L · A list.** Text (one text variant, Markdown):
"Before you leave, pack:\n\n- the charger\n- the blue folder with the
lease\n- two forms of ID, one with a photo\n- the spare key for the side
door". Formatting words: dash, hyphen, minus, bullet.

**C · Code-switching on look-alike words.** Text: 'When I asked about the
train, she said "son las once," so we'd missed it. My uncle just shrugged:
"also gut."' Pronunciation: son lahs OHN-seh ("it's eleven o'clock"); AHL-zo
goot ("well, fine"). Directed: prose "Speak in natural American English, but
say the quoted Spanish and German phrases in those languages."; tagged
'When I asked about the train, she said [in Spanish] "son las once," so
we'd missed it. My uncle just shrugged: [in German] "also gut."'

**D · Dialog.** Text: '"Did you lock the door?" she asked.\n\n"I think
so."\n\n"You think so?" He was already reaching for his keys.' Directed:
prose "Read it like an audiobook narrator: give the quoted lines a little
life, and leave a short pause between lines of dialog."; tagged and Grok
the text with "[pause]" between the three lines.

**E · Worked math.** Text: "If x is three, then two x plus one is seven, not
eight: you double first, then add the one." Text variant `then-italic`:
"… you double first, _then_ add the one." Formatting words: underscore.

**W · Water boiling.** Text: "Water boils at 100 °C at sea level, but at
3,000 m (about twice the height of Denver) it boils at about 90, which is
why pasta takes longer up there." Directed: prose "Explain it like a patient
teacher, so the contrast between sea level and altitude is clear."; tagged
"[patiently] " before the text; Cartesia `calm`; MiniMax `calm`; Voxtral
"[emotion=calm]" before the text.

**X · Word stress.** Text: "I didn't say she stole the money." Directed
`she`: prose "Stress the word 'she'; it carries the meaning of the
sentence." Directed `money`: the same with 'money'. Prose channels only.
Text variant `she-italic`: "I didn't say *she* stole the money."
Formatting words: asterisk, star.
