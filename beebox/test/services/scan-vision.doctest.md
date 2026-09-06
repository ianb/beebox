# ScanVision service — selection, Gemini classification, and the fake

The `ScanVision` service is the photo-analysis backend behind `bbx scan-import`'s
photo flow (design: `docs/plans/scan-vision-claude.md`). This doctest covers the
backend selection rules, the retry classification carried by
`ScanVisionBatchError`, and the fake used by the photo-flow tests.

```ts setup
import {
  selectScanVisionBackend,
  createFakeScanVision,
  createGeminiScanVision,
  ScanVisionBatchError,
  FakeScanVisionFailureError,
} from "../../src/services/scan-vision.js";
```

## Backend selection

Default (no `BBX_SCAN_VISION`) is Claude — the zero-setup path. Gemini is
explicit opt-in and fails closed without a key; unknown values are errors,
never silent fallbacks. The env selects the *backend*; the route arrives
already resolved from `core/openrouter.ts` — the box's own Gemini key
(`core/gemini-key.ts`: store, then `GEMINI_KEY` / `SKE_GEMINI_API_KEY`) when it
has one, OpenRouter otherwise — so there is one Gemini resolution order in the
codebase.

```ts
const claude = selectScanVisionBackend({}, null);
JSON.stringify(claude)
=> {"ok":true,"value":{"backend":"claude"}}

const gemini = selectScanVisionBackend({ BBX_SCAN_VISION: "gemini" }, { via: "direct", apiKey: "placeholder-gemini-key" });
JSON.stringify(gemini)
=> {"ok":true,"value":{"backend":"gemini","route":{"via":"direct","apiKey":"placeholder-gemini-key"}}}

const noKey = selectScanVisionBackend({ BBX_SCAN_VISION: "gemini" }, null);
noKey.ok ? "ok" : noKey.error
=> BBX_SCAN_VISION=gemini but no key can reach the model — grant the "gemini" or "openrouter" secret to this box, or set GEMINI_KEY (or SKE_GEMINI_API_KEY)

const typo = selectScanVisionBackend({ BBX_SCAN_VISION: "gemnii" }, { via: "direct", apiKey: "placeholder-gemini-key" });
typo.ok ? "ok" : typo.error
=> BBX_SCAN_VISION=gemnii is not a valid backend (valid: claude, gemini)

```

A key present but empty is still "no key" — the same fail-closed answer:

```ts continue
const emptyKey = selectScanVisionBackend({ BBX_SCAN_VISION: "gemini" }, { via: "direct", apiKey: "" });
emptyKey.ok
=> false
```

## The fake: default photo/back alternation

With no options, the fake pairs each even page (photo) with the following odd
page (back) — mutual claims, so the reconciliation layer bundles them.

```ts
const fake = createFakeScanVision();
fake.backend
=> fake

const result = await fake.analyzeBatch({ imagePaths: ["/tmp/p0.jpg", "/tmp/p1.jpg", "/tmp/p2.jpg"], boxholderContext: "Names: Dana, Marisol" });
result.analyses.map((a) => `${a.index}:${a.kind}->${a.paired_with_index}`).join(" ")
=> 0:photo->1 1:back->0 2:photo->null

result.usage?.prompt
=> 300

result.costUsd
=> 0.05

fake.describe()
=> scan-vision fake, 1 call(s)
  [p0.jpg, p1.jpg, p2.jpg] context=yes
```

## The fake: scripted failures for retry-path tests

`failTimes` makes the first N calls throw a `ScanVisionBatchError` whose
`retry` classification the runner branches on; the error still carries the
failed attempt's usage so cost accounting includes failures.

```ts
const flaky = createFakeScanVision({ failTimes: 1, failRetry: "transient" });
const caught = await flaky.analyzeBatch({ imagePaths: ["/tmp/a.jpg"], boxholderContext: null }).catch((e) => e);
caught instanceof ScanVisionBatchError && caught instanceof FakeScanVisionFailureError
=> true

caught.retry
=> transient

caught.usage?.prompt
=> 100

caught.costUsd
=> 0.01

const second = await flaky.analyzeBatch({ imagePaths: ["/tmp/a.jpg"], boxholderContext: null, lastResort: true });
second.analyses.length
=> 1

flaky.describe()
=> scan-vision fake, 2 call(s)
  [a.jpg] context=-
  [a.jpg] context=- lastResort
```

`alwaysFailRetry` never recovers — used to drive a batch all the way to
placeholder pages (or, for `"fatal"`, to an aborted run).

```ts
const dead = createFakeScanVision({ alwaysFailRetry: "fatal" });
const fatalErr = await dead.analyzeBatch({ imagePaths: ["/tmp/a.jpg"], boxholderContext: null }).catch((e) => e);
`${fatalErr.name}: retry=${fatalErr.retry}`
=> FakeScanVisionFailureError: retry=fatal
```

## Scripted analyses

The `analyze` option replaces the default generator per call — the photo-flow
doctest uses this to hand-shape batches (including deliberately misaligned
ones for the post-condition tests).

```ts
const unsurePage = (i) => ({ index: i, kind: "unsure", paired_with_index: null, description: "", title: "", rotation: 0, subject_bbox: null, has_text: false, text_blocks: [], date_hint: null, flag_for_review: true, flag_reason: "scripted" });
const scripted = createFakeScanVision({ analyze: (paths) => paths.map((_, i) => unsurePage(i)) });
const unsure = await scripted.analyzeBatch({ imagePaths: ["/tmp/x.jpg"], boxholderContext: null });
unsure.analyses[0]?.kind
=> unsure
```

## Gemini backend surface

The Gemini implementation wraps the existing engine; without network access we
assert only its declared shape (batch size 8 is the historical Gemini batch
default).

```ts
const gsvc = createGeminiScanVision({ route: { via: "direct", apiKey: "k-1" } });
`${gsvc.backend} ${gsvc.batchSize}`
=> gemini 8
```
