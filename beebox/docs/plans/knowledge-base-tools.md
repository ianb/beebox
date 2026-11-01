---
title: "Search areas, bbx pdf save, trusted anchors, and bbx refs"
status: draft
workstream: shared-browser
issues:
  - ../../../issues/features/2026-11-01-webpage-save-server-bytes-and-pdfs.md
  - ../../../issues/features/2026-05-11-backlinks-surface.md
---
# Search areas, bbx pdf save, trusted anchors, and bbx refs

A research box holds about 5,100 saved sources beside a smaller set of written knowledge cards. Its agents need search to reach the written cards first, PDFs saved like web pages, ids on saved text that citations can name, and a way to ask what cites a card. The boxholder approved these four changes on 2026-11-01. Cross-model plan review findings are folded in below. The same request's `--name`, saved-bytes, and failed-`bbx mv` fixes landed first (commit `29b03357b`).

**Issues addressed:** `2026-11-01-webpage-save-server-bytes-and-pdfs` (PDF half; its server-bytes-from-the-browser half stays open). `2026-05-11-backlinks-surface` (the `bbx refs --incoming` part; it stays open for outgoing refs and unlinked mentions). `2026-08-09-pdf-url-into-the-commentary-path` is related and stays open: Clerk has no path to this command. Searched `issues/` for search area, archive search, exclude, anchor, and bbx pdf: nothing else matches.

## Design

Situations:

- When an assistant answers a benefits question in a box holding thousands of archived source pages, I want search to return the written guidance first, so I can answer from the reviewed text and go to the source only to check it.
- When I need one exact sentence from an archived page, I want to search the archive on purpose, so I can find it without learning its folder layout.
- When a source I cite is a PDF on a government site, I want to save it the way I save a web page, so its address and hash stay with it.
- When a page changes, I want to ask what cites it and which block, so I can re-check only those cards.
- When I do not want this: a box with no archive sets nothing and its search behaves as today, apart from `_tmp/` no longer appearing.

Right place and time: each is a command an agent runs. Nothing interrupts. Default search says how many hits an area held back, so a hidden result is findable, and a person sees that line in quick search too.

Spirit: serves "see the gears" (the areas are named in `_config/box.json`, and search reports what they hid). Risks "feel possible" if hidden results read as missing; the held-back line is the guard.

Trust: all are direct requests. Search never changes data. `bbx pdf save` commits one card, reviewable in git, as `bbx webpage save` does.

Wrong or nothing: an unknown area lists the known ones. A malformed search config warns and searches everything. A URL that returns a sign-in page is refused, saving nothing. An anchor a box function places badly stops the save and names the anchor. A broken citation anchor is a `bbx validate` warning.

Walk, search: `bbx search "income limit"` → `searchBox` reads `search.areas` → hits under `_content/archive/` are removed and counted → the agent sees knowledge cards, then `(38 more in archive: --area archive)`.

## Smallest fix and budget

Smallest: `--exclude <prefix>` on search, a script around `fetch` for PDFs, and leaving anchors to the existing un-escape step. That leaves every caller to remember the exclusion, which is the reported problem. Chosen: four tracks, about 550 source and 350 test lines, plus about 60 lines of box docs and guide text. Under the BIG CHANGE line.

## Stated preferences this plan trades against

- "Minimize invented concepts": a search area is a new noun, a named list of path prefixes. `prominence` was rejected for this because `src/shared/prominence.ts` defines it per card, and 5,000 cards would each need the field, and because it means "who it is for", with no named way to ask for one group.
- "Bias toward strict": a malformed search config warns and does not fail search. A box whose search stops working over a config typo fails worse than one that searches too much, and the warning stays visible.
- `src/shared/markdoc-config/ingest.ts`: *"An agent that later edits the card can add real tags or HTML; that edit is the deliberate step."* Anchors add a second deliberate step, written by box code, limited to ids.

## What already exists

- `searchBox` filters by prefix after searching, with `PATH_FILTER_FETCH = 1000` (`src/core/search/query/core.ts`). With 5,000 archived matches, the top 1,000 could all be archive, leaving nothing after the filter. Track A removes this limit.
- `_config/box.json` through `loadBoxConfig` (`src/core/box/config.ts`).
- `runPdfMode` and `importPdfSession` (`src/core/commands/scan-import/pdf.ts`) copy a PDF, probe it, run Docling, and build the template, wrapped in a capture session.
- `pdf-reanalyze` parses and keeps the card's other fields (`src/core/commands/pdf-reanalyze.ts`: `fields["docling"] = {`), so new fields survive it.
- `fetchPage` (`src/core/webpage/fetch.ts`) has the redirect policy; it fails on any non-HTML type and caps a body at 10 MB.
- `findInboundCardRefs` (`src/core/find-inbound-card-refs.ts`) already scans with `bbx mv`'s resolver. It reports counts, and its transform drops the fragment.
- Markdoc annotations: tested against `markdocConfig`, `## Head {% #h1 %}` gives `<h2 id="h1">` and a paragraph's `{% #p1 %}` gives `<p id="p1">`; a list item drops the id. The web view's `makeHeadingNode` (`src/shared/markdoc-config/tags/core.ts`) declares only `level`, so it ignores an id on a heading.
- `lint-cards.ts` walks every ref and calls `resolveRefExists`, which splits the fragment off first.

## Prior art (external)

No external premise. Markdoc's annotation syntax is already in use.

## Ontology

- **Search area** (new): a name and a list of box-relative path prefixes in `_config/box.json`. Held out of default search. Not access control: `--path` and `--area` reach it.
- **Kind weight** (new): a multiplier on a card type's search score. Not a tier: a strong archive hit can still beat a weak knowledge hit.
- **Anchor** (new word, existing mechanism): an id on a heading or paragraph in a card body, written as a Markdoc annotation `{% #id %}`. Named by a ref's `#id`. Not a search section path (`/Components/Programs`, `src/shared/markdown-sections.ts`).
- **Referrer** (existing, `InboundCardRef`): a file with a ref to a card. Gains `fragments`.
- `capture` on a pdf card: same meaning as on a webpage card (`src/schemas/webpage.tsx`); `sources` is the shared entry (`src/cards/sources-entry.ts`).

## Tracks / scope

### Track A: search areas

**What.** Default search holds back configured areas and `_tmp/`, reports the count, and applies kind weights.

**Why.** Assistants hit raw sources before the written answer; `--path` and `--kind` by hand is the workaround.

**Direction.** `_config/box.json`:

```json
{ "search": { "areas": { "archive": ["_content/archive"] }, "kindWeights": { "knowledge": 2 } } }
```

`SearchBoxOptions.area?: string`. `bbx search --area <name|all>`. With no `area`: remove hits under any area prefix and under `_tmp/`, unless the caller's own path prefix lies inside that prefix (asking for a folder inside the archive gets it). With a name: only that area's prefixes, intersected with any path prefix. `all`: nothing removed. An unknown name throws `UnknownAreaError`, shown like `UnknownKindError`. Prefix match is by path segment. Result gains `heldBack: { area: string; count: number }[]`, with `_tmp` not reported. Weight applies to the score before the sort, inside the existing `_content`-first ordering. When any filter or weight applies, fetch every match (`count(db)`), not 1,000. `QuickSearchOverlay` and the full Search card (`src/frontend/src/renderers/search.tsx`) both show the held-back line, and the card stops saying "all paths" when something is held back. The card's path filter reaches inside an area, so a person can still search it. The tRPC route takes `area`; no picker now. The missing-`contains` worklist (`src/core/search/contains-state.ts`) and its wakeup batch skip held-back areas: otherwise thousands of hidden cards queue for agent-written summaries. **Gate:** quick search on a 50,000-document index with a common term stays under 150 ms added and is measured in this track. If it fails, cap the fetch at 5,000 and report counts as "at least".

**Lock-ins.** `search.areas`, `search.kindWeights`, `--area`, `heldBack`.

**First chunk.** Config parse and `searchBox` filter with tests against a small box; no open questions.

### Track B: `bbx pdf save`

**What.** `bbx pdf save <url>`, or `bbx pdf save <file> --url <address>`; `--to`, `--name`, `--meta`, `--no-commit`.

**Why.** Scan-import files into a capture session under the inbox and queues intake. A research box wants a card at a chosen path with its address.

**Direction.** Move the copy, probe, extract, and template steps out of `importPdfSession` into `writePdfCard` (`src/core/pdf/write-card.ts`), used by both. A card is `<dir>/<name>.pdf.card` with `<name>.attach/source.pdf`. `PdfSchema` gains optional `sources` and `capture` (`via`, `sha256`, `redirectedFrom`, `requestHeaders`, `meta`). `filename.via.channel` is `bbx-pdf-save`. The redirect loop moves into `fetchResource({ url, from, accepts, capBytes, timeoutMs })`, which returns bytes with no decoding. `fetchPage` wraps it with today's values and decodes; `fetchPdf` uses a 200 MB cap and 120 s. `bbx pdf reanalyze` also neutralizes its extracted body, which it does not do today, through the same step as `writePdfCard`. Checks `assertAnnexBox` first, and removes what it wrote if the commit fails, as `saveNewCard` does. Exit codes match `bbx webpage save`: 0, 1, 3 for bytes that do not start `%PDF-` (a sign-in page), 4 for a redirect to read first. Failed extraction still saves the card with `error:`, as scan-import does, and prints a note. No intake job: the caller chose the place. Default name: the file or URL's last segment, plus the time and a suffix, as webpage names are. `--name` on an existing card fails.

**Lock-ins.** `capture` on pdf cards; channel `bbx-pdf-save`.

**First chunk.** Extract `writePdfCard` with scan-import's tests still passing.

### Track C: trusted anchors

**What.** A box function returns `anchors`, and the engine writes them after escaping the page text.

**Why.** Citation by block needs ids, and everything a box function returns is escaped, so its annotations come out as literal text.

**Direction.** `PAGE_RESULT` gains `anchors?: { id: string; line: number }[]`. `id` matches `^[a-z0-9][a-z0-9-]*$`, unique. `line` is 0-based in the returned `markdown`. In `write.ts`, after `neutralizeIngestedMarkdown`, which keeps line numbers, append ` {% #id %}` to each line, then parse with Markdoc and require each id on a heading or paragraph node. Otherwise the save fails, naming the anchor. Applied in both new-card and `--update` paths, and the `--json` result carries them unapplied. `makeHeadingNode` gains an `id` attribute that wins over the slug and enters its `seen` set. The frontend paragraph schema and `Para` (`src/frontend/src/components/Markdown/body.tsx`) pass `id` through, and rendering is tested in the app and in published pages. An anchor id equal to a heading slug in the same body fails the save, so a citation cannot land on the wrong element. Box markdown stays escaped.

**Lock-ins.** `anchors: [{ id, line }]`.

**First chunk.** `applyAnchors(body, anchors)` with tests, including text in the page that imitates an annotation.

### Track D: `bbx refs` and anchor checks

**What.** `bbx refs <card>[#anchor] [--json]` lists what refers to a card, and `bbx validate` warns on a `#anchor` the target does not have.

**Why.** Change propagation re-reads every unit today.

**Direction.** The existing scan gains the fragments: `InboundCardRef.fragments: string[]`, collected by a new observation callback at the token level, because `Remap` sees only the resolved path; resolution and counts do not change. Output is one line per referrer: `path  (2 refs: #a, #b)`. With `#anchor`, only referrers naming it. Refs into the attach scope count, as they do for trash. In `lint-cards.ts`, a ref whose fragment matches `^[A-Za-z0-9][\w-]*$` and whose target is a `.card` with a non-empty body must name an annotation id or a heading slug there, else a warning `Broken anchor at …`. Other fragments (`page=3`, `:~:text=`, `/Section`) are not checked. Target anchors are cached per lint run. `anchorsIn(body)` uses Markdoc parse and one id-assignment function shared with `makeHeadingNode`, tested with duplicate headings in both orders.

**Lock-ins.** Verb `refs`, audience agent, in `surface-data.ts`.

**First chunk.** Add `fragments` to the scan, then the command.

## Could this be simpler?

Simplest search: `--exclude` flags with no config. It fails because the default is the problem: every agent and quick search would need to remember it. Simplest anchors: let the function write raw markdown it marks trusted. It fails because that markdown holds third-party page text, so a page could inject real tags. Simplest refs: tell agents to grep. It fails on relative refs, which only the resolver in `bbx mv` gets right. Kind weights are the most cuttable item; they stay because the box asked for knowledge above inventory, and a filter cannot express that.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Malformed `search` in box.json | planned | warning, searches everything | clear |
| Area prefix names a folder that moved | planned | none needed: nothing held back | silent, and harmless: hits return |
| Fetching all matches is slow on a large index | measured against the Track A gate | cap at 5,000, "at least" counts | clear |
| PDF URL returns a sign-in page with status 200 | planned | `%PDF-` check, exit 3 | clear |
| Docling missing or fails | exists for scan-import | card saved with `error:` | clear |
| `--no-commit` run leaves annexable PDF uncommitted | planned | caller's choice, printed | clear |
| Anchor on a list item or blank line | planned | save fails, names it | clear |
| Page text contains `{% #x %}` | planned | escaped before anchors apply | clear |
| Re-saving with shifted anchors | planned | `--update` rewrites them; a removed id shows as a `bbx validate` warning on citing cards | clear |
| Existing ref with a free-form `#word` fragment | planned | warning only, never an error | clear |
| `bbx refs` on 5,000 cards is slow | measured | one read pass, as trash does | clear |

## Agent-flow / user-flow edge cases

- Wrong tag or field: ADDRESSED. `--area` lists known names; `anchors` shape errors name the fix.
- Stale ref: ADDRESSED by Track D's warning.
- Two agents on one card: ADDRESSED as today; new cards are exclusive creates.
- Hand-edit drift: ADDRESSED. An annotation an agent adds counts as an anchor, by `anchorsIn`.
- Fabricated value: ADDRESSED. `sha256` and `retrieved` are computed; `--meta` is labelled as caller-kept.
- Validation error UX: ADDRESSED. Warnings name the ref and the card.
- Partial migration: no migration. Old pdf cards lack the optional fields. No index rebuild: areas apply at query time.

## NOT in scope

- `--update` on `bbx pdf save`: not requested; `bbx pdf reanalyze` covers re-extraction.
- A box function for PDFs: extraction is Docling's, and nothing asked for a hook.
- A persistent reverse index: a scan is fast enough until measured otherwise.
- `bbx refs --outgoing`, unlinked mentions, version pins: left on the backlinks issue.
- An area picker in the web UI: the line says what was held back; a picker waits for a person asking.
- Anchors on list items and table rows: `item` drops the id; widen only if the box needs it.
- A hand-written annotation that collides with a later heading slug: rare, and the browser picks the first; only box-function anchors are refused.
- Extra feedback items (timeouts, cross-card validate hooks, schema docs): the boxholder will discuss them.

## Open design questions

None block the first chunks.

## Knowledge audits

Add to the guide's `bbx search` rule that areas exist and `--area` reaches them, plus one rule each for `bbx pdf save` and `bbx refs`. Run a box knowledge audit on those rules at the end.

## What will hold this after it ships

Tests in `test/core/search`, `test/cli/commands/pdf`, `test/core/webpage`, and `test/cli/commands/refs`; the CLI surface test classifies the new verb; the schema's optional fields are checked by card lint.

## Implementation order

Track A, then B, C, D, each committed alone. No adopted prior art, so no ACKNOWLEDGEMENTS entry.

## Rollout shape

One merge when asked. No migration. Existing boxes change only by `_tmp/` leaving default search, until a box writes `search` in its config.
