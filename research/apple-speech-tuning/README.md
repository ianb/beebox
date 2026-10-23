# Tuning Apple's on-device speech recognition for the HQ pass

Research, 2026-10-23. The question: can Apple's own recognizer give better
transcripts for the iOS app's HQ dictation pass
(`ios-app/BeeBox/Services/OnDeviceHqTranscriber.swift`), without a different
engine? The boxholder wants better general transcription. Names and unusual
words matter less. This is a dated snapshot of macOS/iOS 26.5 (Xcode 26.6,
Speech module 3525.2.2).

## Summary

- **The app already uses Apple's best configuration.** `SpeechTranscriber`
  with the `.transcription` preset was best or tied for best on every test
  set. No other preset, option, locale, or audio preprocessing reduced its
  error rate by a measurable amount.
- **The SDK has no "higher effort" setting.** There is no beam width, no
  quality mode, and no slower, better model. Every preset uses the same model.
  The presets change only how results are delivered: volatile results, fast
  results, alternatives, timings. `SpeechAnalyzer.Options` has only a task
  priority and a model-retention setting.
- **On real spontaneous speech, Apple is already as accurate as the server
  engines.** Earnings-21 call audio: Apple 12.5% WER, whisper 12.3%, voxtral
  12.6%. AMI meeting speech on headset microphones: Apple 13.2%, voxtral
  13.3%, whisper 21.4%.
- **Apple falls behind on clean, name-dense dictation and in noise.** On the
  synthetic dictation set, Apple had 6.8% WER, against 4.1% for whisper and
  4.3% for voxtral. In café noise it had 20.6%, against 14.5% for whisper.
  Most of the clean-speech gap is names and compound product words
  ("tail scale", "deep gram", "B-Box"). Those are the words the boxholder
  ranked lower.
- **The HQ pass and live transcription use the same model.**
  `.progressiveTranscription` (live) and `.transcription` (HQ) differed by at
  most 0.8 points, and no difference was significant. The on-device HQ pass
  gives final text a little sooner and a little cleaner, but not a better
  model.
- **Things that did not help:** the on-device Foundation Model, as a picker
  among Apple's alternatives (+1.2 points worse) or as an editor (+4.2
  worse); `DictationTranscriber` and the legacy `SFSpeechRecognizer`
  (+4 to +10 points worse); contextual strings on `SpeechTranscriber` (it
  ignores them); loudness normalization; noise reduction (slightly worse);
  pre-resampling; regional English locales.
- **Audio level and bandwidth matter.** Audio that was 24 dB too quiet added
  0.6 to 3.7 points. Bluetooth-style 8 kHz narrowband audio added 8.8 points in
  noise. These are the only input faults found to have an effect. Measure them
  on the phone before changing anything.

To get Whisper-class text on the boxholder's own dictation, the remaining
levers are outside the recognizer's configuration (see
[Recommendations](#recommendations)). The first step is to measure the gap on
the boxholder's own recordings, on their own Mac, with
[the comparison script](#run-it-on-your-own-recordings).

## Every knob Apple exposes

Source: the Speech module interface in the installed SDK,
`MacOSX.sdk/System/Library/Frameworks/Speech.framework/Versions/A/Modules/Speech.swiftmodule/arm64e-apple-macos.swiftinterface`
(the iOS interface is the same module), and the headers in
`Speech.framework/Headers/`. The harness prints the preset contents with
`apple-speech-bench --describe`.

### `SpeechTranscriber` (the HQ model)

| Knob | Values | Effect on accuracy (measured) |
|---|---|---|
| Preset | `.transcription` (no options), `.transcriptionWithAlternatives` (+alternatives), `.timeIndexedTranscriptionWithAlternatives` (+alternatives, +time ranges), `.progressiveTranscription` (+volatile, +fast results), `.timeIndexedProgressiveTranscription` | None. Presets only bundle the options below. |
| `TranscriptionOption` | `.etiquetteReplacements` only (masks profanity) | None. |
| `ReportingOption` | `.volatileResults`, `.alternativeTranscriptions`, `.fastResults` | Final text is unchanged. Alternatives are a 1.3–2.1 point ceiling that no reranker reached (below). |
| `ResultAttributeOption` | `.audioTimeRange`, `.transcriptionConfidence` | Metadata only. |
| Locale | `supportedLocales`; nine English locales installed on this Mac | en-US was best even for British speakers (en-GB/IE/IN: +0.3 to +0.4). |
| Contextual strings (`AnalysisContext`) | Accepted, then ignored | Output identical with and without a list: up to 5 strings (the turn's names), 47–88 (the call's names), or 672 (all calls' names plus distractors). Apple's forum answer agrees: "The SpeechTranscriber module does not currently take contextual strings into account" ([thread 811083](https://developer.apple.com/forums/thread/811083), [thread 801877](https://developer.apple.com/forums/thread/801877)). |
| Custom language model, content hints | Not available | The SDK has no `contentHints` on `SpeechTranscriber`. |
| Audio format | `availableCompatibleAudioFormats`: 16 kHz and 8 kHz mono Int16 | The model consumes 16 kHz. The app's 48 kHz Float32 recording is converted inside the analyzer, and pre-converting gave no significant change. |

`SpeechAnalyzer` adds `Options(priority:modelRetention:)`, a scheduling hint
and a choice of how long to keep the model loaded, plus `AnalysisContext`
(`contextualStrings` by tag, and `userData`). `SpeechDetector` (voice
activity) has a sensitivity level and does not change the text.

### `DictationTranscriber` (the older dictation model)

Apple's documentation: "uses the same speech-to-text machine learning models
as system dictation features do, or as `SFSpeechRecognizer` does when it is
configured for on-device operation"
([DictationTranscriber](https://developer.apple.com/documentation/speech/dictationtranscriber)).
The harness confirmed this: `dt.long` and the legacy `sf.ondevice` produced the
same text.

| Knob | Values | Measured |
|---|---|---|
| Preset | `.phrase`, `.shortDictation`, `.progressiveShortDictation`, `.longDictation`, `.progressiveLongDictation`, `.timeIndexedLongDictation` | `.longDictation` used. |
| `ContentHint` | `.shortForm`, `.farField`, `.atypicalSpeech`, `.customizedLanguage(modelConfiguration:)` | `.farField` made no difference on call audio. |
| `TranscriptionOption` | `.punctuation`, `.emoji`, `.etiquetteReplacements` | Formatting only. |
| `ReportingOption` | `.volatileResults`, `.alternativeTranscriptions`, `.frequentFinalization` | — |
| Contextual strings | Honored | Raised name recall by 10–27 points. Did not close the general-accuracy gap to `SpeechTranscriber`. |
| Custom language model | `SFCustomLanguageModelData` (phrase counts, templates, custom pronunciations in X-SAMPA) compiled with `SFSpeechLanguageModel.prepareCustomLanguageModel(for:configuration:)`; iOS 26 adds a `weight` (0–1) on `SFSpeechLanguageModel.Configuration` | Works with `DictationTranscriber` and legacy `SFSpeechRecognizer` only. Raised name recall by about as much as contextual strings, or less. |

The legacy `SFSpeechRecognizer` has the same levers: `contextualStrings`
(the header says no more than 100 phrases), `customizedLanguageModel`,
`addsPunctuation`, and `requiresOnDeviceRecognition`.

**The custom language model does not reach the better model.** It plugs into
`DictationTranscriber` and `SFSpeechRecognizer` only, and both are much less
accurate than `SpeechTranscriber` on everything except clean, name-dense
speech.

## Method

The harness is in [harness/](harness/). macOS 26 runs the same
`SpeechTranscriber` model as iOS 26. The macOS results therefore stand for the
phone's accuracy, but not for its speed.

- [`AppleSpeechBench.swift`](harness/AppleSpeechBench.swift) runs one
  configuration over a manifest of audio files. It feeds the file through
  `SpeechAnalyzer.analyzeSequence(from:)` as `OnDeviceHqTranscriber` does,
  keeps final results only, and records alternatives and confidence when
  requested. It builds custom language models per vocabulary group. Build it
  with [`build.sh`](harness/build.sh), which embeds the usage string
  `SFSpeechRecognizer` needs.
- [`FoundationRerank.swift`](harness/FoundationRerank.swift) is a second
  pass with the on-device Foundation Model (macOS 26 Apple Intelligence),
  using guided generation and greedy sampling. `pick` mode chooses among
  Apple's alternatives, so it cannot invent words. `edit` mode rewrites the
  transcript with the alternatives as hints.
- [`server-transcribe.ts`](harness/server-transcribe.ts) calls
  `transcribeAudioHq` in-process with the worktree test box's granted keys.
  Engines: `whisper` (whisper-1, the box default), `voxtral`
  (voxtral-mini-latest), and `whisper-llm` (gpt-4o-transcribe).
- [`score.ts`](harness/score.ts) normalizes both texts (case, punctuation,
  diacritics, number words, fillers, and partial words such as "serv-") and
  reports corpus WER, WER with proper-noun words removed, proper-noun recall,
  and a paired-bootstrap 95% interval for each run's difference from the first
  run.
- [`derive-audio.ts`](harness/derive-audio.ts) makes preprocessed copies of a
  set: loudness normalization, FFT noise reduction, pre-resampling to 16 kHz,
  and two stress cases (−24 dB, and an 8 kHz telephone band).

### Data

All audio was converted to the app's recording format: mono Float32 WAV at
48 kHz. Server engines got the same audio as 16 kHz 16-bit WAV to reduce
upload size. All three engines resample to 16 kHz.

| Set | Source and license | Size | What it is like |
|---|---|---|---|
| Earnings-21 | [Rev Earnings-21](https://github.com/revdotcom/speech-datasets/tree/main/earnings21), eval-10 subset, CC BY-SA 4.0 | 109 speaker turns of 10–60 s from 6 calls, 52.6 min, 171 tagged proper-noun mentions | Real, mostly spontaneous Q&A over conference-call audio (11–24 kHz). Verbatim references with tagged entities. Turns were cut by the RTTM speaker timings. Only calls whose RTTM turn count equals the reference's speaker runs were used. |
| AMI | [AMI Meeting Corpus](https://groups.inf.ed.ac.uk/ami/corpus/), `edinburghcstr/ami` config `ihm`, test split, CC BY 4.0 | 80 utterances of 8 s or longer from 7 meetings, 14 min | Real, spontaneous, disfluent meeting speech on individual headset microphones. Many speakers are not native English speakers. This is the closest public match to dictation into a phone held near the mouth. |
| Dictation, clean | [30 notes](harness/dictation-notes.json) written for this test, spoken by OpenAI `gpt-4o-mini-tts` (10 voices, casual delivery) | 30 notes, 6 min, 90 names | Personal-note dictation with fillers and dense, unusual names. |
| Dictation, noisy | The same audio with room echo, a 100 Hz–7 kHz band, and brown noise at about 12 dB SNR | 30 notes | The same notes in café-like noise. |

The synthetic set has two biases. It is name-dense by design. It was also
spoken by an OpenAI voice, which probably favors OpenAI's own recognizers
(gpt-4o-transcribe scored 2.3% there and 37.6% on AMI). Read it as a test of
names and clean dictation, not of general quality.

References are verbatim. They keep repetitions such as "yeah yeah" and
false starts. Engines that clean up speech (gpt-4o-transcribe, and Whisper on
AMI) lose points for omissions that a reader might prefer. The scorer drops
fillers and partial words, but not repetitions.

## Results

WER is corpus-level: total errors divided by total reference words. Δ is the
difference from the first row, with a paired-bootstrap 95% interval. A Δ whose
interval includes zero is not a measured difference. Apple times are on an M-series Mac and include
model load per file. Server times include the upload from this Mac.

### Earnings-21 (real, spontaneous, call audio)

105 turns that every engine transcribed. Voxtral returned errors on 4 turns.

| Run | WER | Δ (95% CI) | WER without names | Name recall |
|---|---|---|---|---|
| **Apple `.transcription` (shipped)** | **12.5%** | — | 12.7% | 58.5% |
| Apple `.progressiveTranscription` (live preset) | 12.6% | +0.1 (−0.4, +0.6) | 12.8% | 59.1% |
| Apple + contextual strings (call's names) | 12.5% | 0.0 (identical) | 12.7% | 58.5% |
| Apple, en-GB locale | 12.9% | +0.4 (+0.1, +0.6) | 13.1% | 58.5% |
| Apple alternatives, best possible pick | 11.2% | −1.3 (−1.6, −1.1) | 11.4% | 63.7% |
| Apple alternatives + Foundation Model pick | 13.7% | +1.2 (+0.6, +1.7) | 13.9% | 57.3% |
| Apple + Foundation Model edit | 16.7% | +4.2 (+1.3, +7.7) | 17.0% | 60.2% |
| `DictationTranscriber` `.longDictation` | 22.9% | +10.4 (+9.0, +11.8) | 23.1% | 50.3% |
| `DictationTranscriber` + contextual strings | 22.6% | +10.1 (+8.6, +11.6) | 22.9% | 60.2% |
| `DictationTranscriber` + custom LM (call's names) | 22.6% | +10.0 (+8.6, +11.5) | 22.8% | 57.3% |
| `DictationTranscriber` `.farField` | 22.9% | +10.4 | 23.1% | 50.3% |
| `SFSpeechRecognizer` on-device | 22.9% | +10.3 (+8.9, +11.8) | 23.0% | 49.7% |
| server whisper | 12.3% | −0.2 (−1.4, +1.1) | 12.5% | 66.7% |
| server whisper + names as prompt | 11.2% | −1.3 (−2.4, −0.1) | 11.4% | 78.9% |
| server voxtral | 12.6% | +0.1 (−1.1, +1.4) | 12.8% | 66.7% |
| server voxtral + names as context_bias | 12.4% | −0.1 (−1.4, +1.2) | 12.6% | 76.6% |
| server gpt-4o-transcribe | 16.9% | +4.4 (+2.0, +7.1) | 16.9% | 60.8% |

Preprocessing, same set, `.transcription`:

| Audio | WER | Δ (95% CI) |
|---|---|---|
| as recorded | 12.4% | — |
| loudness-normalized | 12.5% | +0.1 (−0.2, +0.4) |
| noise-reduced | 12.5% | +0.1 (−0.2, +0.5) |
| pre-resampled to 16 kHz | 12.4% | 0.0 (−0.2, +0.1) |
| 24 dB quieter | 13.0% | +0.6 (+0.3, +1.0) |
| 8 kHz telephone band | 12.4% | 0.0 (−0.2, +0.3) — the source is already telephone audio |

### AMI (real, spontaneous, headset microphones)

78 utterances that every engine transcribed. No tagged names.

| Run | WER | Δ (95% CI) |
|---|---|---|
| **Apple `.transcription` (shipped)** | **13.2%** | — |
| Apple `.progressiveTranscription` | 14.0% | +0.7 (−0.9, +2.8) |
| Apple alternatives, best possible pick | 11.6% | −1.6 (−2.4, −0.8) |
| Apple alternatives + Foundation Model pick | 14.1% | +0.9 (0.0, +1.8) |
| Apple, en-GB / en-IE / en-IN locale | 13.8–13.9% | +0.3 to +0.4 (all 80 utterances) |
| `DictationTranscriber` `.longDictation` | 17.1% | +3.9 (+1.9, +5.7) |
| `SFSpeechRecognizer` on-device | 17.2% | +3.9 (+1.9, +5.9) |
| server voxtral | 13.3% | +0.1 (−1.8, +2.0) |
| server whisper | 21.4% | +8.2 (+3.4, +14.6) |
| server gpt-4o-transcribe | 37.6% | +24.3 (+18.7, +30.2) |

### Synthetic dictation (name-dense; clean and café noise)

| Run | Clean WER | Clean, without names | Clean name recall | Noisy WER | Noisy name recall |
|---|---|---|---|---|---|
| **Apple `.transcription` (shipped)** | **6.8%** | 7.7% | 64.4% | **20.6%** | 39.1% |
| Apple `.progressiveTranscription` | 7.2% | 8.3% | 64.4% | 20.6% | 40.2% |
| Apple alternatives, best possible pick | 6.1% | 6.9% | 68.9% | 18.5% | 47.1% |
| `DictationTranscriber` | 9.6% | 10.9% | 57.8% | 31.6% | 29.9% |
| `DictationTranscriber` + contextual strings (all 90 names) | 5.2% | 6.0% | 84.4% | 29.4% | 46.0% |
| `DictationTranscriber` + custom LM (all 90 names) | 6.0% | 6.9% | 78.9% | 28.1% | 50.6% |
| server whisper | 4.1% | 4.3% | 85.6% | 14.5% | 65.5% |
| server voxtral | 4.3% | 4.8% | 81.1% | 18.9% | 60.9% |
| server gpt-4o-transcribe | 2.3% | 2.5% | 88.9% | 21.0% | 74.7% |

Preprocessing on the noisy set (`.transcription`, Δ from 20.6%):
loudness-normalized +0.3 (−1.1, +1.5); noise-reduced +1.1 (−1.0, +3.3);
pre-resampled −0.6 (−1.4, +0.1); 24 dB quieter +3.7 (+0.8, +8.3); 8 kHz band
+8.8 (+5.9, +12.1).

"Without names" removes every word of a tagged name from both texts. It
cannot remove errors next to a name that the name caused ("Dinner with the
Nguyens" heard as "Dinner within Gwen's"), so it overstates general error on
this set.

### Speed

Earnings-21, 109 turns (53.5 min of audio), one configuration at a time with
nothing else running, on this Mac. The phone will be slower; the
`elapsedMs` log line measures it.

| Run | Median per turn (10–60 s) | Faster than real time |
|---|---|---|
| Apple `.transcription` | 0.79 s | 34× |
| Apple `.transcriptionWithAlternatives`-style options | 0.72 s | 36× |
| Apple `.progressiveTranscription` | 0.94 s | 28× |
| `DictationTranscriber` `.longDictation` | 3.14 s | 9× |
| Foundation Model pick / edit (added to Apple's time) | +1.1 s / +2.2 s | — |
| server voxtral (incl. upload, 4 in parallel) | 1.19 s | — |
| server whisper (incl. upload, 4 in parallel) | 2.36 s | — |

## What the results mean

**There is no hidden quality setting.** All `SpeechTranscriber` presets
produced the same final text, apart from small changes when volatile results
are on. Apple gives no way to trade time for accuracy. The only "more effort"
options are second passes that Apple does not provide, and the obvious ones
failed:

- **Alternatives** carry real signal. An oracle that knows the reference and
  picks the best alternative for each phrase cuts WER by 10–12% relative
  (1.3–2.1 points). But each phrase has only 1.8 alternatives on average, and
  they differ mostly in punctuation, casing, and spacing ("so Brian," versus
  "so, Brian,"). The on-device Foundation Model chose worse than Apple's first
  choice on both real sets. A reranker would need the audio, or a much
  stronger language model with box context, and the 1.3-point ceiling is
  small.
- **Free-form correction** by the on-device model changed correct words and
  added 4.2 points. It also failed to follow the output instruction until
  guided generation was used.

**The older model is not a fallback for quality.** `DictationTranscriber` and
on-device `SFSpeechRecognizer` are 4–10 points worse on real speech and fall
apart in noise. Their vocabulary features (contextual strings, custom
language model) helped only on clean, name-dense audio. There, contextual
strings with all 90 names brought `DictationTranscriber` to 5.2%, which beat
`SpeechTranscriber` (6.8%). That is the only case where it won.

**The input path is probably fine, but measure it.** The app records the
input node's own format (48 kHz Float32 on the built-in microphone) under
`.playAndRecord` with `.default` mode, which does not turn on voice processing (automatic gain control, echo cancellation).
The analyzer converts the audio to 16 kHz Int16 itself, and doing that
conversion first changed nothing. Two conditions did hurt: a quiet recording,
and narrowband Bluetooth audio. The app already asks for
`.bluetoothHighQualityRecording` when the system offers it
(`AudioSessionRouting.swift`). Whether real HQ recordings are quiet, or arrive
over HFP, is not known. The client debug log does not record level or route
for the recording.

**Why the boxholder sees a gap.** On the two real spontaneous sets, Apple
equals voxtral, and it beats whisper on AMI. Apple loses on clean, name-dense
dictation, in noise (to whisper), and on compound and product words. The
likely explanations, in order:

1. Personal dictation is full of names, projects, and tool names that the box
   knows. Apple misses those, and its recognizer cannot be biased toward them.
2. Some recordings may be noisy, quiet, or over Bluetooth. Whisper is more
   robust to noise than Apple.
3. The boxholder's voice and style. Only their own recordings can show this.

## Recommendations

Ranked by expected gain for the cost. None of these changes the model.

1. **Keep `.transcription`. Do not switch presets, locales, or transcribers
   for quality.** Expected gain from any of them: zero or negative. Cost: none.
2. **Measure the gap on the boxholder's own recordings first.** Run
   [compare-own-recordings.ts](#run-it-on-your-own-recordings) on 20 or more
   dictations, with a hand-corrected transcript for at least 10 of them.
   Without `--server`, nothing leaves the Mac. The side-by-side report shows
   which errors are names, which are noise, and which are general. Cost: about
   an hour of the boxholder's time to correct transcripts. It decides whether
   any item below is worth doing.
3. **Log the recording's level and input route in the HQ diagnostic line.**
   Add peak and RMS dBFS and the input port type (built-in, HFP, high-quality
   Bluetooth) to `voice HQ on-device … audioMs= elapsedMs=` in
   `OnDeviceHqTranscriber`. If recordings are often 20 dB or more below
   normal, add gain normalization before the pass. A quiet input cost 0.6–3.7
   points here, and normalization did not hurt normal-level audio. If HFP is
   common, that path cost 8.8 points in noise. Cost: small. No change to text.
4. **For names, the Apple-side option is a second recognizer, not a setting.**
   When the box sends a vocabulary list
   ([vocabulary issue](../../issues/features/2026-09-11-bias-apple-speech-with-box-vocabulary.md)),
   `DictationTranscriber` with contextual strings recovers names well on clean
   audio (name recall 64% → 84%). It is much worse in general and in noise,
   so it cannot replace `SpeechTranscriber`. A combination (use
   `DictationTranscriber`'s spelling of a known box term when it aligns with a
   `SpeechTranscriber` phrase) is plausible but unmeasured. It costs a second
   pass of about 3–5× the time of the first. Do this only if step 2 shows names
   are the main problem.
5. **If step 2 shows general errors in noise, the fix is a server engine for
   noisy recordings, not Apple tuning.** Whisper was 6 points better in noise.
   That is outside this research's remit.

**Do not ship:** Foundation Model reranking or editing, `DictationTranscriber`
as the HQ model, custom language models, contextual strings on
`SpeechTranscriber`, noise reduction, or regional locales.

**Live transcription:** no change. Live uses the same model, with the
same accuracy as the HQ preset on these sets.

## Run it on your own recordings

[`compare-own-recordings.ts`](harness/compare-own-recordings.ts) runs the
Apple configurations and the Foundation Model pass on a folder of
recordings on this Mac. It writes a side-by-side report to
`<dir>/compare/report.md`. When a recording has a same-named `.txt`
transcript beside it, it also prints the WER table. With `--server <box-root>`
it also sends the audio to whisper and voxtral through the box's keys, which
is what the phone's server HQ pass already does.

```bash
research/apple-speech-tuning/harness/build.sh
cd research/apple-speech-tuning/harness && swiftc -O -parse-as-library -target arm64-apple-macos26.0 FoundationRerank.swift -o .build/foundation-rerank && cd -
cd beebox
pnpm exec tsx ../research/apple-speech-tuning/harness/compare-own-recordings.ts ~/path/to/recordings
# optional: compare with the server engines too (sends audio to OpenAI and Mistral)
pnpm exec tsx ../research/apple-speech-tuning/harness/compare-own-recordings.ts ~/path/to/recordings --server ~/src/boxes/<box>
```

The 29 clips from the [audio-understanding bakeoff](../audio-understanding-bakeoff/README.md)
are the boxholder's own voice with intended scripts in its `corpus.json`.
They are a ready-made set, if the boxholder agrees to use them.

## Phone test procedure

The configuration worth testing on a phone is the shipped one plus the
diagnostics in recommendation 3. On a real iPhone with iOS 26 and HQ dictation
on:

1. Dictate ten messages of 10–60 s each in three conditions: quiet room with
   the phone in hand, a noisy place (café or street), and AirPods. Say a few
   box names in each.
2. For each, read the box's `.beebox/client-debug.log` line `voice HQ
   on-device … audioMs= elapsedMs=` (plus level and route, once added).
   Expected: `elapsedMs` below 10% of `audioMs` on recent iPhones.
3. Copy each message's HQ text and correct it by hand. Save the original
   recording (the app's preparation WAV) with the corrected text as a `.txt`,
   and run `compare-own-recordings.ts --server` on the folder.
4. Compare the WER for each condition. If AirPods recordings show HFP as the
   route and score worse, check `.bluetoothHighQualityRecording`
   availability on that phone. If quiet recordings score worse, try gain
   normalization.

## Side finding

The box's voxtral `context_bias` fails with 400 for any term that contains a
space. The re-transcription preaction sends a card's whole existing text as
that field. Filed as
[voxtral-context-bias-rejects-multi-word-prompt](../../issues/bugs/2026-10-23-voxtral-context-bias-rejects-multi-word-prompt.md).

## Dispositions

| Idea | Disposition | Where it applies |
|---|---|---|
| `.transcription` preset | keep (already shipped) | `OnDeviceHqTranscriber.swift` |
| Other presets, `fastResults`, etiquette option, regional locales | reject | — |
| Contextual strings on `SpeechTranscriber` | reject (ignored by the model) | vocabulary issue |
| `DictationTranscriber` or `SFSpeechRecognizer` as the HQ model | reject | — |
| `DictationTranscriber` + contextual strings as a name-fixing second pass | later, only if own-recording results show names dominate | vocabulary issue |
| Custom language model (`SFCustomLanguageModelData`) | reject (only the weaker models take it, and it did no better than contextual strings) | — |
| Foundation Model pick or edit | reject | — |
| Loudness normalization, noise reduction, pre-resampling | reject as default; normalization is later, if the level logging shows quiet recordings | `OnDeviceHqTranscriber.swift` |
| Level and route in the HQ log line | adopt (diagnostic only) | `OnDeviceHqTranscriber.swift` |
| Own-recording comparison | adopt (the next step) | the harness here |
