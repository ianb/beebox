---
title: "Docling conversions that fit a box's memory"
status: implemented
workstream: docling-memory
issues:
  - ../../../issues/closed/bugs/2026-11-03-concurrent-docling-conversions-exhaust-box-memory.md
---
# Docling conversions that fit a box's memory

On 2026-11-03 two concurrent Docling conversions pushed a hosted box past its
1 GiB `MemoryHigh` and stalled the box server and chat. This plan cuts one
conversion's peak memory by about half and stops it holding every page's
render until the end. It also runs one conversion at a time per box and per
host, reports a memory kill clearly, and gives each box a 2 GiB limit.

**Issues addressed:** `issues/bugs/2026-11-03-concurrent-docling-conversions-exhaust-box-memory.md`.
Searched the queue for `docling`, `UV_CACHE_DIR`, `HF_HOME`, `uv cache`: no
duplicate. Related, not resolved here: `issues/features/2026-11-01-large-box-mode.md`
(the same box's heap OOMs).

## Design

No design section: this changes resource use and one failure message. What a
person sees of a PDF card does not change (output is byte-identical, measured
below).

## Smallest fix and budget

Smallest fix: a cross-process lock around `uvx docling` plus `MemoryHigh=2G`.
It removes concurrent conversions. It does not make one conversion fit: the
current argv needs 2.2 GB for a 56-page report and was OOM-killed at 3.5 GB on
a 333-page manual (measurements below). With the box server and a chat at about
550 MB, a single large PDF still stalls or kills the box.

Chosen design, four tracks:

1. A Python conversion driver replaces the `docling convert` CLI call (about
   170 lines of Python, 60 changed lines in `services/docling/core.ts`).
2. One conversion at a time per box and per host (about 50 lines).
3. A clear error when a conversion is killed for memory (about 40 lines).
4. Deploy and env: `MemoryHigh=2G`, `MemoryMax=2560M`, `OOMPolicy=continue`,
   and `UV_CACHE_DIR`/`HF_HOME` reach agent subprocesses (about 10 lines).

Tests: about 200 lines. Total about 510 changed lines, plus about 120 lines of
docs (decisions-log D18, the issue). Not a BIG CHANGE.

## Stated preferences this plan trades against

- **Write code in TypeScript** (`AGENTS.md`: *"Write code in TypeScript; a `.js`
  or `.mjs` file is only a thin loader for TypeScript."*). The driver is Python.
  The rule is about JavaScript; Docling's memory controls (`layout_batch_size`,
  `table_batch_size`, `queue_max_size`) exist only in its Python API
  (`docling/datamodel/pipeline_options.py:2026-2078` in 2.117.0) and the CLI
  does not expose them (`docling convert --help`: no such flags;
  `--page-batch-size` measured no effect). No TypeScript route reaches them.
  The driver stays one file with no logic beyond option setup and image export.
- **D2: invoke the CLI, not docling-serve** (`docs/plans/scanner-ingest-docling-decisions.md`, D2).
  Kept in spirit: still one `uvx` subprocess per document, no resident service.
  Only the entry point changes, from `docling convert` to `python -I convert.py`.
- **One lock primitive** (`src/lib/file-lock.ts:9-10`: *"Don't add a new lock
  surface elsewhere — extend or wrap this instead."*). Traded against. The
  Docling locks are kernel `flock` locks held by the Python driver.
  `withFileLock` is only fresh while Node's event loop refreshes it
  (`file-lock.ts`, staleness section), and the stall this plan fixes is memory
  pressure, which can pause that loop past the 5-minute stale window while
  Docling keeps running. A kernel lock lives exactly as long as the process
  that uses the memory. `file-lock.ts`'s header gains a line naming this
  exception and why.
- **Engineering principle 4, resilient and never silent.** A memory kill
  becomes a named failure on the card, never a stall.
- **Boxholder decision 2026-11-03**: give every box 2 GiB rather than move
  conversions out of the box's cgroup.

## What already exists

- `src/services/docling/core.ts` — the single caller of `uvx docling`
  (`doclingArgs`, `createDoclingService`). Reuse: keep the `DoclingService`
  interface, `collectOutputs`, `checkExtractionBounds`, `captureTail`, and the
  awake timeout. Only the argv, env, and failure classification change.
- `src/lib/file-lock.ts` — `withFileLock`. Evaluated, not used: see the
  lock-primitive preference above.
- `src/shared/awake-timeout.ts` — `startAwakeTimeout`. Reuse as is.
- `src/lib/package-root.ts` `PACKAGE_ROOT`, and the shipped-asset pattern
  `src/core/agent-guide/guide/core.ts:28`: *`join(PACKAGE_ROOT, "src", "core", "agent-guide", "guide.md")`*
  with a `package.json` `files` entry. Reuse for `convert.py`.
- `src/core/script-env/allowlist.ts:61` lists `UV_TORCH_BACKEND` for `uvx docling`
  but not `UV_CACHE_DIR` or `HF_HOME`. On prod, the agent-started conversions
  therefore built a private 6.4 GB uv cache and a 506 MB model cache under one
  box's home, while `/var/cache/beebox/uv` and `/var/cache/beebox/hf` are empty
  (read on prod 2026-11-03). Extend this list.
- `deploy/systemd/box-sandbox.conf:33-34` `MemoryHigh=1G`, `MemoryMax=2G`. The
  prod unit shows `OOMPolicy=stop` (`systemctl show`), so an OOM kill of any
  process stops the whole box unit.

## Prior art (external)

- Docling's pinned source (2.117.0), read directly:
  - `keep_images` is true whenever page or picture images are requested
    (`pipeline/standard_pdf_pipeline.py:598-602`). The pipeline then keeps
    every page's 2× render until assembly. The CLI turns both on for
    `--image-export-mode referenced` (`cli/main.py:1228-1236`). Adopted as the
    root cause.
  - `DoclingDocument.save_as_json` in referenced mode deep-copies the document
    with its images (`docling_core/types/doc/document.py:3713`). In
    placeholder mode it writes the document as is (`:4333`). Adopted: the
    driver sets file URIs itself and saves in placeholder mode.
  - `uv` runs Python as a child process, not by `exec` (measured: Python's
    parent is the `uv` process). A driver cannot detect its Node parent's
    death through `getppid`, so it watches Node's PID instead.
- Chunked conversion with `convert(page_range=…)` and
  `DoclingDocument.concatenate` (`document.py:5899`): evaluated only. It
  changed the text at 2 of 6 chunk boundaries (Docling joins paragraphs across
  pages) and did not lower the peak once page images were out of the pipeline.

## Ontology

No new nouns in the box's vocabulary. Code-level names:

- **Docling driver** — `src/services/docling/convert.py`. One JSON request on
  argv; writes `<stem>.md`, `<stem>.json`, `<stem>_artifacts/page_NNNNNN_<sha>.png`
  and `image_NNNNNN_<sha>.png`, the same layout the CLI writes and
  `collectOutputs` reads (D5). It is not a service or a daemon.
- **Box Docling lock** — `$HOME/.cache/bbx-docling.lock`, a kernel `flock`
  the driver holds for its whole run. On a hosted host each box is its own user
  with its own `HOME`, so this is per box; on a laptop it is per user, which is
  stricter. Taken first.
- **Host Docling lock** — `$UV_CACHE_DIR/bbx-docling.lock`, taken second, only
  when `UV_CACHE_DIR` is set (prod sets it for every box,
  `src/hub/box-env-file.ts:32`). Without it there is no shared directory to
  name, and the box lock is the only one.
- **Docling exit outcome** — one of: `ok`; `timeout` (our awake budget fired);
  `busy` (driver exit 75, lock wait ran out); `oom` (SIGKILL or exit 137 and
  this cgroup's `memory.events` `oom_kill` count rose during the run);
  `killed` (SIGKILL or 137 with no such evidence, including where the counter
  is unreadable); `failed` (any other non-zero exit). `uv` reports a SIGKILLed
  child as exit 137 (measured).

## Tracks / scope

### Track 1: Python driver with memory-bounded options

- **What:** `convert.py` builds the same `PdfPipelineOptions` the CLI builds
  for our flags (`cli/main.py:1176-1236`), with these changes: no page or
  picture images in the pipeline; `layout_batch_size`, `table_batch_size` and
  `ocr_batch_size` 1; `queue_max_size` 4. After conversion it renders each page
  once with the same backend call Docling uses (`get_page_image(scale=2)`),
  writes the page PNG, crops that page's figures from it as
  `standard_pdf_pipeline.py:1075-1104` does, and frees the render. It writes
  JSON in placeholder mode (URIs already set) and markdown in referenced mode.
  It writes output only on `ConversionStatus.SUCCESS`, as the CLI does
  (`cli/main.py:481`). Deliberate difference: on another status the CLI exits 0
  with no files, and the driver exits 1 with the status and Docling's errors.
  Empty markdown stays a success with an empty body, as today: the CLI marks it
  failed (`cli/main.py:554-568`) but still exits 0 with both files written.
- **Why:** the CLI's memory grows about 14 MB per page and peaks at a fixed
  ~1.4 GB even on 9 pages (table below).
- **Direction:** `core.ts` runs
  `uvx --from docling==V --with onnxruntime --with rapidocr python -I <PACKAGE_ROOT>/src/services/docling/convert.py <json>`
  with env `MALLOC_ARENA_MAX=2`. The JSON request has `source`, `outputDir`,
  `ocr` (`off | regions | replace`), `languages`, `documentTimeoutSeconds`,
  `parentPid`. A `doclingRequest()` pure function builds it; `doclingArgs()`
  stays as the argv builder. The driver exits 1 with a one-line
  `bbx-docling:` reason on failure, and 70 when its parent is gone.
- **Vocabulary lock-ins:** the `bbx-docling:` stderr prefix; the request field
  names above.
- **First chunk:** `convert.py` plus the `core.ts` argv change and its argv
  test. Verified by the integration test and by the byte-identity comparison.

### Track 2: one conversion at a time per host

- **What:** the driver takes the box lock, then the host lock, before it
  imports Docling (a waiting driver costs about 10 MB, not 550). It prints
  `bbx-docling: lock acquired` on stderr. `core.ts` runs a 30-minute awake
  budget from spawn and replaces it with the 10-minute conversion budget when
  that line appears.
- **Why:** the incident was two concurrent conversions. Seven boxes share one
  3.8 GB host, so per-box exclusion alone still allows seven at once.
- **Direction:** request fields `lockPaths: string[]` (from a pure
  `doclingLockPaths(env, homedir)`) and `lockWaitSeconds: 1200`. Exit 75 when
  the wait runs out. The failure reads: *"Another Docling conversion on this
  box or host ran for over 20 minutes; this PDF was not converted. Retry later,
  one at a time."* The driver also watches `parentPid` and exits within 2 s
  when Node is gone, so an orphan cannot keep the lock and the memory.
- **First chunk:** lock-path function and its test; driver locking checked in
  the VM with two concurrent runs and a SIGSTOPped holder.

### Track 3: a clear reason for a memory kill

- **What:** classify the subprocess end. `SIGKILL` or exit 137 that we did not
  cause becomes a memory failure.
- **Why:** today the card says `Docling exited 137: <tail>` or nothing useful,
  and the agent retries.
- **Direction:** a pure `classifyDoclingExit({ exitCode, signal, timedOut, oomKillsBefore, oomKillsAfter })`
  returning the outcome above. Read `oom_kill` from
  `/sys/fs/cgroup/<path from /proc/self/cgroup>/memory.events` before and
  after; `null` where unreadable. `oom` reads: *"Docling was killed during an
  out-of-memory event in this box. Do not retry in parallel; retry once when
  nothing else is converting, or use a smaller PDF."* `killed` says it was
  killed by a signal beebox did not send and that memory is the usual cause.
- **Limit:** if the OOM killer picks the `bbx` process that waits on Docling
  instead, nothing is left to write the card error. The box journal records the
  kill. Accepted: making the error survive its caller needs durable job state,
  which this plan does not add.
- **First chunk:** the classifier and its table test.

### Track 4: deploy limits and env

- `deploy/systemd/box-sandbox.conf`: `MemoryHigh=2G` (boxholder decision).
  Proposed with it, for the boxholder's yes before deploy: `MemoryMax=2560M`
  (today `MemoryMax=2G`, which would leave no throttle band above the new
  `MemoryHigh`) and `OOMPolicy=continue` (today an OOM kill of any process
  stops the whole unit). The comment is rewritten with the measurements.
- `src/core/script-env/allowlist.ts`: add `UV_CACHE_DIR` and `HF_HOME`, so
  agent-started conversions use the host caches and the host lock.
- Lands with the code. Takes effect on deploy (a separate yes).

## Could this be simpler?

The simplest version is the lock plus `MemoryHigh=2G`. It fails on any single
PDF over about 60 pages: today's argv needs 2.2 GB at 56 pages and over 3.5 GB
at 333 pages, so the box still stalls or is killed (principle 4). Next
simplest: keep the CLI and switch to `--image-export-mode placeholder`, with
pages rendered by `pdftoppm` and figures cropped in TypeScript. That keeps
growth with page count down, but the peak stays at 1.8 GB for 56 pages,
because the batch and queue sizes are not reachable from the CLI. It also
changes page pixels (a different renderer), which changes every page asset
name and what `bbx pdf reanalyze` produces. The driver buys the remaining
650 MB and byte-identical output.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A driver option drifts from the CLI's, so output changes | Integration test (real Docling, skips without it) plus the D18 byte comparison | Options mirror `cli/main.py`; comparison recorded | Clear on comparison; silent in prod. Revisit on every Docling upgrade (D3) |
| `convert.py` missing from a published package | New test asserts `package.json` `files` lists it | `extract` fails with "Docling could not be run" | Clear on the card |
| The lock holder's Node process stalls under memory pressure | VM check: SIGSTOP the parent | Kernel `flock` held by the driver; no staleness | Clear (others wait) |
| The Node parent is killed mid-conversion | VM check: kill the parent, driver exits within 2 s | Watch thread, 2 s poll; kernel releases the lock on exit | Clear (lock frees on exit) |
| The OOM killer picks the `bbx` caller or the server, not Docling | VM check run: at a 1.3 GB cap the kernel killed Docling (714 MB anon), the 550 MB neighbour survived, `uv` exited 137, `oom_kill` rose by 1 | Docling is the largest process (~1.1 GB); `OOMPolicy=continue` if approved | Clear in the journal; no card error (accepted, Track 3) |
| `memory.events` unreadable (macOS, cgroup v1) | Classifier table test | Outcome `killed`, never `oom` | Clear |
| A lock file cannot be opened | Driver exits 1 with the path | `failed` with the `bbx-docling:` reason | Clear |
| The 20-minute wait expires | Classifier test for exit 75 | `busy` message on the card | Clear |

No critical gaps.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** no new vocabulary. ADDRESSED.
- **Stale ref:** none introduced. ADDRESSED.
- **Two agents touching the same card:** two reanalyses of the same PDF
  serialize their conversions, but `extractPdf` writes the card's attach
  directory after the lock is released (`src/core/pdf/extract.ts:143-159`).
  GAP, out of scope: same-card write serialization is not a memory problem.
- **Hand-edit drift:** none. ADDRESSED.
- **Fabricated free-form value:** none. ADDRESSED.
- **Validation error UX:** the busy and memory messages say what happened and
  what not to do. ADDRESSED (Tracks 2, 3).
- **Agent Bash timeout:** an agent's tool timeout can kill `bbx` while it waits
  or converts. The driver exits within 2 s, the kernel releases the locks, and a
  retry waits its turn rather than doubling memory. ADDRESSED.
- **Partial rollout:** code without the systemd change keeps the 1 GiB limit.
  Conversions then still exceed it, one at a time instead of two. The deploy
  carries both together.

## NOT in scope

- Running conversions outside the box's cgroup (a host runner). Considered;
  the boxholder chose 2 GiB per box (2026-11-03).
- Chunking large PDFs. Measured; no gain once page images are out of the
  pipeline, and it changes text at chunk boundaries.
- Cleaning up the per-box uv and Hugging Face caches already on prod (6.4 GB
  in one box). A prod write; listed in the handoff for the boxholder.
- A host-wide swap or memory limit for all boxes together.
- Smaller or quantized Docling models, or turning table structure off (the
  table model is ~370 MB of the peak, but these reports are mostly tables).
- `MALLOC_TRIM_THRESHOLD_`, jemalloc, and thread-count tuning: measured
  differences under 5%.

## Open design questions

none

## Knowledge audits

Skip: infrastructural. The agent-facing change is two failure messages, which
explain themselves on the card.

## What will hold this after it ships

- `test/services/docling/core.test.ts` (new, `t.check`): argv and request
  shape, env (`MALLOC_ARENA_MAX`), lock-path resolution, exit classification
  table, and serialization of two concurrent `extract` calls through a fake
  `uvx` on `PATH`.
- `test/core/pdf/extract.integration.test.ts` (existing): real Docling through
  the new driver on a one-page text PDF; it skips loudly where Docling is not
  installed. It catches a broken driver, not option drift: it checks no
  figures and no OCR.
- The byte comparison in D18, which is what covers option drift: six PDFs
  (9 to 333 pages, digital and scanned), OCR `off`, `regions` and `replace`
  with a language override, tables and figures. Repeat it on each Docling
  upgrade.
- `package.json` `files` check for `convert.py`.
- D18 in the decisions log records the measurement method, so the next
  Docling upgrade can repeat it.

## Implementation order

1. Track 1: `convert.py`, the `core.ts` invocation, the `files` entry, tests.
   Byte-compare against the CLI on the test PDFs.
2. Track 3: classifier and memory-events reader, tests.
3. Track 2: host lock, tests.
4. Track 4: systemd drop-in and allowlist.
5. Docs: D18 with measurements; issue update. Cross-model review of the diff.

## Rollout shape

Done when the new unit tests, the existing PDF tests, typecheck, layout-check,
and lint pass; the driver's output matches the CLI's on the six test PDFs
(page and figure file hashes, markdown, JSON apart from paths); and an
acceptance run in a 2 GiB cgroup beside a 550 MB stand-in for the server and
chat converts the 333-page manual and the scanned PDF, with total memory,
swap, pressure, time, and the stand-in's worst stall recorded in D18. No data
migration: cards keep their format; `bbx pdf reanalyze` produces identical
assets. Deploy is a separate yes; it installs the drop-in and restarts boxes.
