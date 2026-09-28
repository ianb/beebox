# Jev instruction experiment — 2026-09-28

Explicit destination boundaries and a concrete best-effort policy produced the
intended changes in these synthetic cases. Removing the abstention contract
made missing evidence become no-match, strongly confident for both missing-input cases. This supports the proposed
instruction/replay design, not a claim of production accuracy or calibration.

## Method

The [protocol](../../test/fixtures/triage-evaluation/instructions/protocol.json)
was revised to household administration and fixed before the rerun. Sixteen fictional inputs, four conditions and three
repeats produced 192 calls to `typesafe/jev-1.13-20260917`, with zero errors.
The authorized OpenRouter key was read locally; no real box content was sent.
The combined measured call time was 37.781 seconds, not an end-to-end benchmark.
Costs are not available from the current adapter.

Conditions were broad destination definitions with research policy, precise
boundaries with research policy, precise boundaries with best-effort policy,
and precise boundaries with forced-choice policy and no unclear option.
The last condition changes both policy and available outcomes; it does not
isolate option presence alone. All share the same supplied evidence per case.
Preparation is held fixed: missing/failed extraction is represented explicitly,
not rerun here. The earlier mixed-format experiment covers actual extraction.

Question/input hashes and complete synthetic requests are in the
[observations](../../test/fixtures/triage-evaluation/results/2026-09-28/instructions/results.jsonl).
The [runner](../../test/fixtures/triage-evaluation/instructions/run.ts) excludes
case IDs, expected labels, splits and repeats from the model input. Conditions
are interleaved per case with order rotated across repeats. No prompts were
tuned after household results arrived. All older observations were replaced by
new calls, not edited to appear to match changed inputs. Reproduction and caveats are in the
[experiment README](../../test/fixtures/triage-evaluation/instructions/README.md).

Claude reviewed the protocol before live calls. We excluded underspecified
baseline targets from accuracy scoring, aligned no-match/unclear descriptions
across the boundary comparison, and renamed five additional cases as rule
paraphrases rather than independent holdouts. Expected outcomes are author
judgments and are specific to each policy; all examples share one author.

## Observations

| Comparison | Observed result across three repeats per case |
|---|---|
| Repair invoice, broad → precise | financial under broad invoice guidance → property under the explicit exception |
| Plumbing receipt paraphrase, broad → precise | financial under broad invoice guidance → property under the explicit exception |
| Two mixed bank/property cases, research → best effort | unclear → financial in all six paired observations |
| Missing attachment and unreadable PDF, research/best effort | unclear in all twelve observations |
| Readable family-history material outside catalog | none in every condition/repeat |
| Missing attachment, forced condition | none, probability 1.00; confidence 1.00 |
| Unreadable PDF, forced condition | none, probability 1.00; confidence 0.99 |
| Mixed input, forced condition | financial three times at 0.51–0.56; none at 0.33–0.40 |
| Mixed paraphrase, forced condition | financial three times at 0.52–0.55; none at 0.32–0.36 |
| Advertisement with/without injection | none in all conditions/repeats |
| Bank notice with/without unrelated footer | financial in all conditions/repeats |

The best-effort policy explicitly chooses financial for equally mixed
bank/property updates. This tests obedience to that concrete preference, not
whether unspecified encouragement to guess is reliable. It preserved unclear
for missing subject matter. Courts, bank closure, property inspection, tax,
and litigation cases did not acquire unintended label changes.

Precise/research matched all 48 authored targets; precise/best matched its
policy-specific 48 targets. Broad/research matched 36/36 scorable targets;
four boundary cases per repeat were intentionally unscored because the broad
rules provided different or overlapping guidance. Forced matched 36/36 representable
targets, with four unavailable-unclear cases per repeat reported separately.
The invoice cases follow the broad financial guidance before the precise rules
add the property exception; litigation cases lack precedence in the broad
rules. These are specification effects, not improved reasoning under equivalent
instructions. These denominators differ and must not be used to rank overall model accuracy.
Repeats are not independent examples; this remains 16 cases, not 192 cases.

Forced choice also assigned no-match probability 0.32–0.40 to the two readable
mixed inputs, although financial won all six observations. Uncertainty about
placement can leak into no-match even when the evidence is readable.

Across 64 distinct request hashes, 21 had changing probability distributions
and none changed its winning label. The largest per-option range was 0.08.
Small probability improvements in one replay are therefore weak evidence.
Identical calls varied in their probabilities despite stable winning labels.

## Design consequences

- Keep explicit no-match and unclear outcomes with distinct meanings. Missing
  evidence is not proof that no category fits; high probability cannot repair
  an incomplete answer space.
- Put destination boundaries and precedence in understandable instructions.
  Show the effective policy and criteria through the proposed CLI.
- Let instructions permit concrete best-effort choices while retaining honest
  evidence limitations. A universal escalation threshold is not established
  or required by this experiment.
- Replay the same evidence against old/new instructions and compare outcomes
  on the failure plus neighboring correct examples. Repeat near-ties; do not
  optimize probability alone. Keep preparation replay a separate comparison.

## Limits and validation

The cases are short, English, synthetic and deliberately clear. Several spell
out the intended distinction; five paraphrases test rule following, not broad
generalization. Two perturbation pairs do not prove injection resistance or
robustness to large contexts. This does not evaluate agent research, agent
instruction repair, real historical decisions, OCR quality, admission writes,
or the production CLI. No thresholds were fitted and no runtime was changed.

Offline fake execution covered 192 calls/64 request hashes and confirmed local
metadata stays outside model input. The summarizer checks exact case coverage
and rejects missing/duplicate cells. Typecheck and direct runner lint passed.

A separate two-call synthetic model-addressing probe confirmed both
`typesafe/jev-1.13` and `typesafe/jev-1.13-20260917` were requestable and returned
the dated model. Its [observations](../../test/fixtures/triage-evaluation/results/2026-09-28/model-probe.json)
are not part of the 192-call instruction comparison. Future replay must still
check actual returned model identity and report unavailable pins or drift.
