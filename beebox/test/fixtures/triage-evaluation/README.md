# Synthetic document triage corpus

All people, documents, message bodies, and raw assets are fictional. These
fixtures test preparation and classification separately. They are not private
box exports, historical decisions, or per-box calibration data.

- `destinations.json`: 12 cases across eight fictional destinations, including
  category-boundary cases and no-match. Expected labels are author judgments.
- `emails/`: 10 raw Gmail MIME payloads plus the authored case definitions.
  Covers HTML-only mail, misleading snippets, delayed relevance, a placeholder
  plain alternative hiding useful HTML, generic advertisements, prompt
  injection, no fitting destination, and attachment-only evidence. The
  attachment-only payload references the synthetic scanned PDF; the current
  MIME adapter fetches bytes but does not extract its text.
- `documents/`: five raw files (text PDF, scan PDF, junk-layer PDF, rotated
  document illustration, corrupt PDF), separately authored expected text, and
  reproducible generation/preparation scripts. See its [README](documents/README.md).
- `results/2026-09-28/`: generated observation snapshots, including probability
  distributions, failed-preparation status, and elapsed times. They are not
  golden model-output assertions. The [report](../../../docs/reports/jev-document-triage-experiment-2026-09-28.md)
  explains the comparisons and limits.

The [instruction probe](instructions/README.md) separately tests explicit
boundaries, best-effort policy, abstention and repeated calls on fixed evidence.

## Reproduce

Run from the monorepo root. Output directories must have an existing parent;
`replay.ts` requires a fresh directory so stale records cannot masquerade as
new output. It never reads a real box. It builds a disposable synthetic box
only when `--agent` is requested; `runTriage` uses dry-run routing.

```sh
# Offline service/parser smoke; uniform fake, not classification quality.
node --import tsx beebox/test/fixtures/triage-evaluation/replay.ts --out scratch/triage-fake

# Real local PDF/image preparation, no model or provider calls.
python3 beebox/test/fixtures/triage-evaluation/documents/prepare.py --output scratch/triage-prepared

# Four prepared documents; corrupt input stays in preparation.json, unclassified.
node --import tsx beebox/test/fixtures/triage-evaluation/replay.ts --group documents --prepared scratch/triage-prepared --out scratch/triage-documents

# Live calls require an explicitly authorized key file containing BBX_OPENROUTER_API_KEY.
# Set TRIAGE_KEY_FILE to that local file; never commit it or paste its contents.
node --import tsx beebox/test/fixtures/triage-evaluation/replay.ts --group emails --out scratch/triage-live --live --key-env-file "$TRIAGE_KEY_FILE" --agent
```

`--live` spends through the existing Jev service. `--agent` independently starts
one real current-triage batch using configured model
`claude-haiku-4-5-20251001`. Omit both switches for an offline fake run. Current
triage already uses smallModel; these are not separate baseline arms. The
agent result records the configured model; it does not assert an independently
observed provider model. Jev records the returned model identifier.

The runner sends one item per Jev call. Email admission and destination are
independent questions over the same evidence. It does not feed expected labels
or intended OCR text into either model. Opaque option IDs avoid category-name
collisions. Neutral staged filenames prevent fixture IDs revealing document
labels to the agent. `agent.json.files` maps them back for analysis.

For email experiments, the agent sees current 4,000-character clipping; Jev's
prepared variant sees the complete normalized body. This deliberately probes
representation differences, not model superiority under identical inputs.
Missing or placeholder bodies stay missing. The attached PDF's text must be
prepared separately; `not-extracted` is not no-match.

Do not score a missing agent decision's synthesized fallback as a correct
no-match. Check returned files and reasons; count missing/invalid outputs as
protocol errors. `dryRun` returns classifier predictions; production holds
null categories, guesses, and unknown categories. Judge predicted category
and eventual routing behavior separately.

## Boundaries

No thresholds are fitted. This small, clear, English-language corpus excludes
handwriting, encrypted PDFs, long multipage scans, difficult lighting, real
object photos, rich visual diagrams, and adversarial MIME variants. The image
is a rendered document illustration, not a camera photograph. OCR cannot
replace vision for pictures of physical possessions. Local Tesseract is a
probe tool here; it is not wired into production intake by this change.

All retained snapshots use the household-administration corpus and neutral
filenames/opaque message IDs. Earlier scenario observations were superseded by
new live calls, not relabeled. The replay rejects unexpected preparation
failures before model calls and reports expected unclassified documents.
