# TTS model comparison

A comparison of text-to-speech models, kept for choosing the box's voice backend (`beebox/src/shared/tts-backends.ts`; the decision record is [tts-backend-selection](../../beebox/docs/plans/tts-backend-selection.md)). Nineteen models read the same seven test texts, plain and with delivery direction. One take of each model, clip, and variant is published on beebox.run as "Text-to-speech model comparison" ([the card](../../site/cards/develop.attach/tts-comparison.doc.card), linked from For developers).

## Runs

| Date | Models | Notes |
|---|---|---|
| 2026-09-16 | 15 models through OpenAI, ElevenLabs, Cartesia, Deepgram direct and OpenRouter | Generator not kept. Two Gemini 3.1 pacing takes through OpenRouter timed out. |
| 2026-09-23 | Gemini 3.8 Flash, 3.8 Flash-Lite, 3.1 Flash on Google's own API | Generator not kept. |
| 2026-10-20 | Voxtral TTS 3 | `render.ts --model voxtral-mini-tts-3`. Transcribed with gpt-4o-transcribe. |

The dates come from the original audio files and are recorded per model as `rendered`.

## Files

- [results.json](results.json): the single source. `models` (display name, pill vendor, API model, route, voice, list price, render date), `clips` (text, what to listen for, a rough English-spelling pronunciation of the foreign words, direction in prose and tag forms), and `renders`, one per model × clip × variant × repeat: the channel direction went through, the exact `sent` fields, timing, cost (billed by OpenRouter, or list price × characters or tokens when `costEstimated`), and for the first successful take the transcript and its check.
- [lib.ts](lib.ts): the schema (`loadResults()` refuses unknown fields, duplicate takes, and file names that do not match the take), the transcript check, and the secret-store reader.
- [render.ts](render.ts): renders one model and replaces its rows.
- [publish.ts](publish.ts): picks the take the page plays, transcodes those takes for the site, and writes the card.
- [page-template.md](page-template.md): the card's authored prose. `<!-- contents -->`, `<!-- models -->`, `<!-- leaks -->` and `<!-- clips -->` mark where `publish.ts` puts the generated sections.

## Method

Seven clips, each testing one thing: pacing (plain only, several takes per model because pauses vary: five in the runs so far, three for a new model; the page plays the middle-length take and gives the range), whole-phrase code-switching, single German words, sarcasm that only direction can carry, and relief, anger and exhaustion that the words already carry. Every model reads every clip **plain**. A model that accepts direction also reads some clips **directed**, through the channel it has: an instruction field, inline tags, a fixed emotion value, or events and spans. A few read **markup** takes too. The page describes each channel.

The **transcript check** (`transcriptCheck()` in lib.ts) sends the first successful take of each model, clip, and variant to a speech-to-text model and compares words, ignoring case, punctuation, and accents: words of the text missing from the transcript, words in the transcript not in the text, and words of the sent direction (a tag, a prose prefix) in the transcript, which usually means the direction was read aloud. The page shows only the last, in each take and in a "Direction read aloud" section: the other differences were nearly all the transcriber's (numbers, foreign phrases). The stored checks were recomputed with this function on 2026-10-20.

## The audio

Original takes (MP3 and WAV, 82 MB) stay out of git, in `~/src/workstream-exhibits/tts-model-comparison/tts-model-comparison/audio/`; set `TTS_AUDIO_DIR` to use another directory. `publish.ts` transcodes each to mono Opus at 32 kbit/s in WebM, in `site/assets/tts-comparison/` (7 MB for the 213 takes the page plays). All takes are model speech of synthetic test sentences. Nothing from a box goes in.

## Adding or re-rendering a model

Keys come from the machine secret store (`~/.config/beebox/secrets.json`, or `BBX_SECRETS_FILE`): `mistral` for Voxtral and `openai-thinking` for transcription. They are never printed, and a failed request's response body is never shown or stored.

```sh
R="node --import tsx research/tts-model-comparison"
$R/render.ts --model voxtral-mini-tts-3 --dry-run   # list the takes it would make
$R/render.ts --model voxtral-mini-tts-3             # render, transcribe, replace the model's rows
$R/publish.ts                                       # transcode new takes, rewrite the card
pnpm --dir site build
```

Only Voxtral has an adapter. To render another model, add a `Provider` to `PROVIDERS` in `render.ts`: its model record, its directed variants per clip, and `synthesize()`. `render.ts` writes nothing unless every request succeeds. When the takes the page plays change, `publish.ts` lists the `.webm` files it no longer plays and stops; rerun it with `--prune` to delete them.

Then read the new rows on the page, update the prose in `page-template.md` if a statement changed (the shipped default, channels, untried controls), add a row to the Runs table above, and commit. Landing on `main` and pushing publishes the page.

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

Round 2 (2026-10-24), so far:

- Staying late (M1) replaces the wistful twist, with its first wording ("Agreeing, but tired and a little put-upon: you'll do it, and you'd rather not."). Gemini 3.8 Flash-Lite carried every wording of the direction; gpt-4o-mini-tts carried none of them well. That difference is a finding for the page. The short mood wording also suits models that take direction inline in the text.
- The list (L) is tested only as Markdown bullets; the in-sentence and numbered versions are dropped.
- Test results (M2) is dropped. The other wordings of the staying-late direction (M1x) stay out of the run; they are the evidence behind the finding above.
- Both explanations stay: the worked math (E, plain and Markdown _then_) and the water-boiling one (W, plain and directed).
