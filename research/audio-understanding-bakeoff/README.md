# Audio-understanding bakeoff

A fixed, re-runnable benchmark for models that answer questions about audio. Beebox uses it to choose the model behind `bbx chat ask-about-audio` (`AUDIO_QUESTION_MODEL` in [audio-question.ts](../../beebox/src/core/audio-question.ts)). Each run is a dated report in [runs/](runs/). When a new audio-capable model ships, re-run the protocol and add a new report. Do not edit old reports.

## Runs

| Date | Models | Result | Report |
|---|---|---|---|
| 2026-08-27 | GPT Audio 1.5, Gemini 2.5 Flash, 3.1 Pro Preview, 3.7 Flash; Whisper 1 | 3.1 Pro best, 3.7 Flash close second; product moved to 3.7 Flash | [2026-08-27](runs/2026-08-27.md) |
| 2026-10-09 | Gemini 3.8 Flash, 3.5 Flash-Lite, 3.5 Transcribe; re-runs of 3.7 Flash and 3.1 Pro | 3.1 Pro best again; requests for 3.7 Flash are answered by 3.8 Flash; 3.8 Flash invents speech for speech-free audio; recommends switching to 3.1 Pro | [2026-10-09](runs/2026-10-09.md) |

## What it measures

One speaker recorded 29 short clips on 2026-08-27. Each clip tests one capability: literal and extended transcription, emotion carried only by delivery, English and Spanish pronunciation (including planted single-sound errors), code-switching, names, non-speech sounds, pauses, self-repair, and contrastive stress. Three synthetic controls (a sine tone, digital silence, pink noise) test whether a model invents speech where there is none. A model that does will also invent it for an accidental or empty voice message.

[corpus.json](corpus.json) is the single source for the benchmark. It holds:

- **samples**: each clip's intended script, the direction the speaker was given, what a good answer recognizes, and either a `capture` file name or a `synthetic` FFmpeg source;
- **groups**: the clips sent together in one call, with the binary **checks** the judge scores. Paired contrasts share a group, so the model can compare them.

## The recordings stay out of git

The clips are the boxholder's own voice. They live in the exhibit store, at `~/src/workstream-exhibits/apps/audio-bakeoff/captures/`; set `BAKEOFF_AUDIO_DIR` to use another directory. The originals are still in the 2026-08-27 recording exhibit (`codex-native-audio/audio-model-bakeoff/`). Do not commit the recordings, publish them, or send them to a provider the boxholder has not approved. So far that is Google (Gemini API, directly and through OpenRouter pinned to Google AI Studio) and OpenAI (GPT Audio and Whisper, 2026-08-27 only). The judge receives only text.

## Protocol

1. **Normalize.** FFmpeg converts each clip to mono, 48 kHz, 16-bit PCM WAV.
2. **Blind groups.** Each group goes to the model in one call. The recordings are labeled only "Recording A", "Recording B", and so on. The model is never told the title, the script, the intended manipulation, or the checks. For each recording it reports a literal transcript, language, emotion and intent, pronunciation, timing and emphasis, and non-speech sounds, plus a comparison when the group has more than one recording. A group with `"prompt": "extended"` instead asks for one stage-directed transcript. Both prompts are in [run.ts](run.ts).
3. **Transcription-only models** (Whisper, Gemini 3.5 Transcribe) get each clip on its own, with no questions.
4. **Judge.** A text-only model (`judgeModel` in the corpus) scores every blind answer against the group's checks. It sees what each recording was designed to contain, never the model's name. Checks marked `scored: false` are recorded but not counted, because the performance itself is in doubt.
5. **Summarize.** The pass rate by capability, a per-check matrix, repeat consistency, intended-script word error rate, latency, and cost.

Run every model at least twice. Answers vary between identical calls, and a single run cannot separate a model difference from that variation. The non-speech probes vary the most, so give them five repeats.

## Updating the benchmark

Keys come from `beebox/.env` (`GEMINI_API_KEY`, `BBX_OPENROUTER_API_KEY`). A full pass costs about $0.08 for a Flash-class model and $0.60 for a Pro-class model. Judging costs about $2 per run.

```sh
B="node --import tsx research/audio-understanding-bakeoff/bakeoff.ts"
D=research/audio-understanding-bakeoff/runs/$(date +%F)
$B check                                   # corpus is valid, every recording present
$B run --out $D --models gemini-3.8-flash,gemini-3.7-flash --repeats 2
$B run --out $D --models gemini-3.8-flash,gemini-3.7-flash --repeats 5 --tasks synthetic-controls,cough-laugh
$B judge --out $D
$B summarize --out $D                      # writes $D/summary.md
```

`run` and `judge` resume: a re-run makes only the calls that are missing or failed. Model specs are `<gemini-id>` (Gemini API), `openrouter:<id>` (OpenRouter pinned to Google, as the product routes), and `transcribe:<gemini-id>` (transcription-only).

Then write `runs/<date>.md` by hand around `summary.md`: rankings, what changed since the last run, notable answers quoted from `raw.json`, and a recommendation for `AUDIO_QUESTION_MODEL`. Add a row to the table at the top. Do not edit earlier reports.

**Adding a model.** Re-run the current product model and the previous best in the same run, because prompts, judging, and provider behavior drift; compare only within a run. Check the warnings at the top of `summary.md`: the provider can answer a request with a different model (in 2026-10, `gemini-3.7-flash` was answered by `gemini-3.8-flash`). Add the model's list price to `PRICES` in [lib.ts](lib.ts). A model with a different API (for example Gemini Omni, which accepts only the Interactions API) needs a call function in `run.ts`.

**Adding material.**

1. Record the clip (WebM, WAV, or M4A all work) and put it in the audio directory. Use a new file name; never overwrite a recording that earlier runs used.
2. Add a sample to `corpus.json` with its script, direction, and expectation, and add it to a new or existing group with checks. Keep each check a single observable fact the judge can verify from text, and say what fails. Measure what you can (pause lengths, for example) instead of trusting the direction.
3. Bump `version` in `corpus.json`, run `check`, then run every model you compare in a new run directory. Results from before the change do not cover the new material, and `run` refuses to add calls to a run made against a different corpus.
4. Say in the run report what changed.

Changing a prompt in `run.ts` also starts a new baseline: bump `HARNESS_VERSION`.

## Files

| File | Purpose |
|---|---|
| [corpus.json](corpus.json) | Samples, groups, checks, judge model |
| [bakeoff.ts](bakeoff.ts) | Command line: `check`, `run`, `judge`, `summarize` |
| [run.ts](run.ts), [judge.ts](judge.ts), [summarize.ts](summarize.ts), [check.ts](check.ts), [lib.ts](lib.ts) | The steps and shared helpers |
| `runs/<date>.md` | Hand-written report for each run |
| `runs/<date>/` | `raw.json` (every answer, latency, tokens, cost), `judged.json`, `summary.md` |
