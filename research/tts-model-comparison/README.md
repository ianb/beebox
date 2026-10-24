# TTS model comparison

A comparison of text-to-speech models, kept for choosing the box's voice backend (`beebox/src/shared/tts-backends.ts`; the decision record is [tts-backend-selection](../../beebox/docs/plans/tts-backend-selection.md)). Nineteen models read the same nine test texts, plain, as Markdown, and with delivery direction. Every take is published on beebox.run as "Text-to-speech model comparison" ([the card](../../site/cards/develop.attach/tts-comparison.doc.card), linked from For developers).

## Runs

| Date | Models | Notes |
|---|---|---|
| 2026-09-16, 2026-09-23 | 18 models through OpenAI, ElevenLabs, Cartesia, Deepgram direct, OpenRouter, and Google's own API | Seven texts, the first pacing clip read five times. Generator not kept. Replaced by the 2026-10-24 run; its results are in `results.json` at commit 497cbd788. |
| 2026-10-20 | Voxtral TTS 3 | `render.ts --model voxtral-mini-tts-3`, on the September texts. Replaced by the 2026-10-24 run. |
| 2026-10-24 | All nineteen | `render.ts --all`. Nine texts chosen in two listening rounds (below); 361 rows, 289 takes, every take transcribed with gpt-4o-transcribe. About $0.92 billed or at list price, plus about $0.20 of transcription (30 minutes of speech). No take failed after one rerun of the two Gemini 3.1 models (a transcription request lost its connection). |

## Files

- [results.json](results.json): the single source. `models` (display name, the short name used in take references, pill vendor, API model, route, voice, list price, render date, note), `clips` (code, text, what to listen for, a rough English-spelling pronunciation of the foreign words, and variants: a variant has its own text when it adds Markdown, the words that would mean the Markdown was read aloud, and its direction in every form a channel takes), and `renders`, one per model × clip × variant: the channel direction went through (`none available` when the model has no channel for it, with no file), the exact `sent` fields, timing, cost (billed by OpenRouter, or list price × characters or tokens when `costEstimated`), and the transcript and its check.
- [lib.ts](lib.ts): the schema (`loadResults()` refuses unknown fields, unknown models, clips and variants, duplicate takes, file names that do not match the take, and undocumented Cartesia, MAI, and MiniMax values), the transcript check, and the secret-store reader.
- [render.ts](render.ts): an adapter per provider family; renders models and replaces their rows. [render.test.ts](render.test.ts) checks one built request per family.
- [publish.ts](publish.ts): checks the run is complete, transcodes every take for the site, and writes the card.
- [page-template.md](page-template.md): the card's authored prose. `<!-- contents -->`, `<!-- models -->`, `<!-- leaks -->` and `<!-- clips -->` mark where `publish.ts` puts the generated sections.
- [candidates.ts](candidates.ts): the listening tool used to choose the texts (below).

## Method

Nine clips, each testing one thing, each with a one-letter code: sarcasm that only direction can carry (S), anger held in check (A), a reluctant yes (R), a Markdown list (L), code-switching on look-alike words (C), dialog (D), worked math with a Markdown italic (E), a dense explanation with units (W), and word stress (X). Every model reads every **text variant**: the plain text, and the Markdown versions. A **directed** variant goes to a model through the channel it has: an instruction field, a prose prefix, inline tags, a fixed value, or events and spans. A model with no channel for a variant's direction gets a row with no take, and the page says so. `render.ts --dry-run` lists every take and its channel. Each take has a reference, `<clip code>-<variant>-<model short name>` (`X-she-gemini38lite`), shown on the page and used as the player's id.

The **transcript check** (`transcriptCheck()` in lib.ts) sends every take to gpt-4o-transcribe and compares words, ignoring case, punctuation, and accents: words of the text missing from the transcript, words in the transcript not in the text, words of the sent direction in the transcript (direction read aloud), and the variant's formatting words such as "dash" or "asterisk" (Markdown read aloud). The page shows only the last two, in each take and in a "Direction or Markdown read aloud" section: the other differences were nearly all the transcriber's (numbers, foreign phrases).

## The audio

Original takes (MP3 and WAV) stay out of git, in `~/src/workstream-exhibits/tts-model-comparison/tts-model-comparison/audio/`; set `TTS_AUDIO_DIR` to use another directory. The September and early October takes stay there too, under their old names (`<model>__<clip>__<variant>__<repeat>`). `publish.ts` transcodes each take to mono Opus at 32 kbit/s in WebM, in `site/assets/tts-comparison/` (7.5 MB for the 289 takes). All takes are model speech of synthetic test sentences. Nothing from a box goes in.

## Adding or re-rendering a model

Keys come from the machine secret store (`~/.config/beebox/secrets.json`, or `BBX_SECRETS_FILE`): `openai-thinking` for OpenAI and transcription, `gemini`, `openrouter`, and `mistral`. ElevenLabs, Cartesia, and Deepgram keys come from the main checkout's `beebox/.env` (`BBX_ENV_FILE` overrides). Keys are never printed, and a failed request's response body is never shown or stored.

```sh
R="node --import tsx research/tts-model-comparison"
$R/render.ts --all --dry-run                        # list every take and its channel
$R/render.ts --model voxtral-mini-tts-3             # render, transcribe, replace the model's rows
$R/render.ts --all                                  # every model; providers side by side
$R/publish.ts --fresh                               # check the run, transcode every take, rewrite the card
pnpm --dir site build
```

A model's rows are written only when every one of its requests succeeded; `render.ts` names the models it did not write, and each can be rerun with `--model`. Gemini on Google's API is called one request at a time, with a 20-second backoff per attempt on HTTP 429. `publish.ts` refuses an incomplete run and lists the gaps. Without `--fresh`, it keeps a `.webm` newer than its source, and lists `.webm` files no take names and stops; `--prune` deletes them.

To add a model: add its record to `models` in results.json (with a `short` name), an adapter to `ADAPTERS` in `render.ts`, and a request check to `render.test.ts`. A new channel may need a new direction form in lib.ts and in the clips. Then read the new rows on the page, update the prose in `page-template.md` if a statement changed (the shipped default, channels, untried controls), add a row to the Runs table above, and commit. Landing on `main` and pushing publishes the page.

## Choosing the next texts

[candidates.ts](candidates.ts) renders draft texts on the reachable models and writes a listening page, so texts are chosen before a full run. Keys for ElevenLabs, Cartesia, and Deepgram come from the main checkout's `beebox/.env`.

Round 1 (2026-10-24), boxholder's verdicts:

- Keep sarcasm (the spreadsheet) and anger held in check.
- Drop single German words, exhaustion (adds little over anger), and the Lucía name test (the accent does not change it).
- Pacing becomes a list: one sentence, as Markdown bullets, and numbered. The box tries to keep Markdown out of speech, but the test should give it Markdown.
- Code-switching on look-alike words ("son las once", "also gut") is good.
- Dialog, plain and with a generic direction about pauses: good.
- Word stress ("I didn't say she stole the money"): keep directed stress on "she" and on "money", plus one Markdown *italic* version.
- The wistful twist was too subtle to hear. The worked explanation's wrong answer must be eight (the order-of-operations mistake), and its directed version showed nothing.

Round 2 (2026-10-24):

- Staying late (M1) replaces the wistful twist, with its first wording ("Agreeing, but tired and a little put-upon: you'll do it, and you'd rather not."). Gemini 3.8 Flash-Lite carried every wording of the direction; gpt-4o-mini-tts carried none of them well. That difference is a finding for the page. The short mood wording also suits models that take direction inline in the text.
- The list (L) is tested only as Markdown bullets; the in-sentence and numbered versions are dropped.
- Test results (M2) is dropped. The other wordings of the staying-late direction (M1x) stay out of the run; they are the evidence behind the finding above.
- Both explanations stay: the worked math (E, plain and Markdown _then_) and the water-boiling one (W, plain and directed).

The 2026-10-24 run renders these texts on every model; the plan is [tts-comparison-second-run](../../beebox/docs/plans/tts-comparison-second-run.md).
