# Paired Jev instruction probe

Synthetic-only exploratory experiment. Protocol and labels were written before
live results. Sixteen cases include five additional rule-paraphrase cases; all are authored
by the same developer agent. These are not independent held-out evidence. This is a small
internal check, not independently labeled or statistically representative data.
No prompt tuning on results is planned. If changed later, record a new experiment.

Four conditions share identical evidence per case:

- Broad/research versus precise/research: explicit boundary definitions and
  precedence, including repair invoices and court disputes. Broad rules leave
  some boundaries undefined, so changed answers demonstrate specification
  effects, not improved model reasoning under equivalent instructions.
- Precise/research versus precise/best: policy change. Equally mixed bank/property
  updates should be unclear under research and financial under best effort.
  Missing source content should remain unclear in both. This tests following a
  concrete tie preference, not whether vague encouragement to guess is reliable.
- Precise/forced removes the unclear option and uses forced-choice instructions.
  This ablates the whole abstention contract (options plus policy), not option
  presence alone. Missing/ambiguous cases cannot satisfy research expectations;
  report their concrete selections separately from errors on answerable cases.

Court/bank/property controls and additional paraphrases check for regressions.
Four baseline boundary cases lack a uniquely specified target and are not
scored. No-match and unclear definitions are identical across broad/precise
conditions to isolate changes to destination definitions.
Advertisement versus injected advertisement and bank versus added newsletter
footer test limited evidence perturbations. They do not establish injection
resistance or robustness to long documents. Each combination repeats three times
with rotated condition order; 192 calls total. This probes variation without
assuming independent samples or fitting thresholds. Report per-case outcomes,
expected-label agreement where meaningful, probability ranges and failures.

Run from the monorepo root:

```sh
# Fake validates runner/plumbing only. Requires a fresh output directory.
node --import tsx beebox/test/fixtures/triage-evaluation/instructions/run.ts --out scratch/instructions-fake
# Set TRIAGE_KEY_FILE to an explicitly authorized file; never echo its content.
node --import tsx beebox/test/fixtures/triage-evaluation/instructions/run.ts --out scratch/instructions-live --key-env-file "$TRIAGE_KEY_FILE"
```

Summarize either a new run or the committed observations:

```sh
python3 beebox/test/fixtures/triage-evaluation/instructions/summarize.py beebox/test/fixtures/triage-evaluation/results/2026-09-28/instructions
```

Only protocol body/preparation, policy and criteria reach Jev. Case IDs, splits,
expected labels and repeat index stay local. Full synthetic request inputs,
request hashes, original protocol and protocol hash are retained for replay.
No real box is read or modified. Outputs use the ordinary service validator;
errors are recorded and cause a failing exit, never silently replaced labels.
The runner bypasses the regular debug logger and records complete synthetic
inputs itself. None of this establishes a privacy-safe production recorder.
