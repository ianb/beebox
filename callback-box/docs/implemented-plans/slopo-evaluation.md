# slopo evaluation — callback-box/src

**Date:** 2026-07-02 · **Scope:** `callback-box/src` (622 source files, 3552 code units after excludes)

## Outcome (record)

This is the trial evaluation of `slopo` (an embedding-based near-duplicate
detector) that kicked off two shipped efforts. Both are done:

- **Adoption** — slopo is wired into the `cb-codehealth` skill as an optional
  agent-triaged deep-scan, with committed config at `callback-box/tools/slopo/`.
  See `docs/implemented-plans/slopo-codehealth-adoption.md`.
- **The biggest finding** — the systemic REST-route ⇄ tRPC-router duplication
  below — became its own plan and shipped: every duplicated raw route was
  migrated to tRPC. See `docs/implemented-plans/rest-to-trpc-consolidation.md`.
  Most of the individual util dupes this report lists (`sleep`, `contentHash`,
  `mimetypeToExtension`, `slugify`, `getPublicUrl`, `baseServerUrl`, …) were
  consolidated as part of that work.

The rest of this document is the original evaluation, preserved as the record of
what slopo found and why we adopted it.

## TL;DR

slopo works and it found real stuff. On a clean run it surfaced **105 clusters**; the top
~25 contain **genuine near-duplicates worth consolidating**, including several that have
already **drifted** (a latent-bug signal exact-match tools miss) and one **systemic
architectural duplication** (parallel REST-route and tRPC-router implementations). It also
emits a meaningful amount of **noise** — trivial one-liner comparators and within-file
adjacent-arrow repetition — that a human/agent has to filter. Net: **worth adopting as an
occasional, agent-triaged pass**, not a CI gate. Cost is negligible (~$0.02).

## Setup used

- Install: `uv tool install slopo` (uv 0.8.12 already present).
- Provider: **OpenAI `text-embedding-3-small`** (1536 dims) via slopo's LiteLLM backend,
  key `THINKING_OPENAI_API_KEY`. slopo recommends Voyage `voyage-code-3` for code — we have
  no Voyage key, and there's **no local/offline embedding path** without standing up
  Ollama, so OpenAI was the pragmatic choice. Results were good enough that Voyage wasn't
  worth chasing for an eval.
- Pipeline: `slopo init → index → embed → analyze`. The committed config now lives at
  `callback-box/tools/slopo/slopo.conf.yaml` (the eval itself ran from a throwaway
  `slopo-eval/` dir in the worktree).

### ⚠️ Setup gotcha (important for adoption)

`source_dir_exclude` does **not** exclude `node_modules` by default. My first run indexed
`callback-box/src/frontend/node_modules` and **71% of clusters (212/300) were vite's
bundled helpers** (`_interopRequireDefault`, `_setPrototypeOf`, …) — pure garbage that
buried the real findings. After adding `**/node_modules/**`, `**/dist/**`, `**/build/**`
to the excludes and re-indexing, units dropped 8412 → 3552 and the report became usable.
**Any adoption must ship these excludes in the committed config.**

## Cost & performance (actual)

- Embedding: ~44s for 3480 units (clean run). Analyze: instant. `slopo.db` is 30 MB (gitignore it).
- **Cost: ~$0.02 total** across both runs (the polluted first run embedded ~8k units incl.
  minified node_modules; the clean run ~3.5k). `text-embedding-3-small` is $0.02/1M tokens,
  so a full re-embed of callback-box/src is sub-cent. Incremental re-index only embeds
  changed units, so recurring cost is trivial.
- Privacy: source is sent to OpenAI's embeddings API. Our own private code; acceptable for
  this. No local option was used.

## What it found — triaged

**Signal split:** 68 of 105 clusters are cross-file (≥2 unique files) — the "same thing in
two modules" drift we care about; 37 are within-file adjacent repetition (mostly noise).

### Real duplication worth consolidating (high value)

| # | What | Where | Note |
|---|------|-------|------|
| **Systemic** | REST route ⇄ tRPC router logic duplicated | `webapp/routes/*` vs `webapp/trpc/routers/*` — status, admin, commands, calendar, debugLog, inbox (clusters 13,14,15,17,18,19,27,28,30,35,37,39,43) | The single biggest finding. Two parallel implementations of the same endpoints; they've drifted in error handling. |
| C04 | `sleep(ms)` defined 4× | cli, core/commands, core/reactor, webapp | Textbook shared-util candidate. |
| C06 | `entrySelfNotes` / `getSelfNotes` — identical body, different names | frontend vs cli | Exactly the "written twice under different names" case slopo advertises. |
| C09 | `mimetypeToExtension` 2× **and drifted** | `core/commands/create.ts` vs `webapp/routes/commands.ts` | One map has heic/heif/video; the other has pdf/txt/json. Divergence = latent bug. |
| C10 | `parseAttrs` XML-attr parser 2× | `core/chat-schedules.ts` vs `frontend/.../parseTags.ts` | Near-identical. |
| C28 | `baseServerUrl` 2× **and drifted** | webapp routes vs trpc | One trims trailing slash, the other doesn't → behavioral divergence. |
| C38 | `getPublicUrl` 2× **and drifted** | core vs webapp/auth | Default `""` vs `"http://localhost:3210"`. |
| C41 | `slugify` 2× **and drifted** | `lib/filename.ts` vs `cli/commands/feedback.ts` | Different regex char-classes + maxLength 50 vs 40 → same input yields different slugs. |
| C36 | `contentHash`/`hashContent` sha256-slice(16) 4× | 3 connectors + search-store | Clean consolidation candidate. |
| C33 | `fileExists` 3× | core/boxes-config, core/maps/finalize, core/maps/precheck-listing | |
| C46 | `log()` prefixed-console helper ~6× | `core/chat-session-*.ts` | Boilerplate begging for one shared factory. |
| C05, C08, C16, C20, C24, C31, C32, C40 | decodeXmlAttr, isRecord, str, markdownConfig, dropUndefined, duration-format, wordCount, scheduled-script listing | Assorted genuine util/logic dupes; several drifted. |

### Noise / false positives (the filtering cost)

- **Trivial one-liners ranked at the very top:** clusters 1–3 are `localeCompare`/`mtime`
  comparators. High embedding similarity, near-zero consolidation value. The
  `body_node_count_threshold` (default 10) does **not** filter one-line arrow comparators.
- **Semantic false positive:** C07 pairs `firesAt > now` with `firesAt <= now` — *opposite*
  predicates that embed as near-identical. A reminder these are similarity, not equivalence.
- **Within-file adjacent repetition:** C50/57/70/80/90 — two similar arrow fns a few lines
  apart in one file. Technically flagged; rarely worth touching. This is most of the 37
  within-file clusters.

Rough hit rate on the top 45: ~22 genuine / ~15 trivial-or-noise / ~2 outright false
positive / rest borderline. Good enough to be useful, noisy enough to need a triage pass.

## Verdict & recommendation

**Adopt — as a periodic, agent-triaged pass scoped to `callback-box/src`, not a CI gate.**

- **Why yes:** it found duplication our lint/exact-match tooling can't — especially the
  drifted copies (C09/C28/C38/C41) which are genuine latent bugs, and the REST/tRPC
  systemic duplication which is a real architecture conversation. Cost and runtime are
  trivial. The `slopo.ignore.txt` workflow means once we triage a cluster as "won't fix,"
  it stays quiet on future runs — so signal improves over time.
- **Why not a gate:** ~1/3 of output is noise (idiomatic one-liners, within-file
  repetition) that needs human/agent judgment to filter. Gating CI on it would be a
  false-positive treadmill.
- **How it was wired in:** a `slopo` step in the **`cb-codehealth`** skill as an optional
  deep-scan — run index/embed/analyze on a package and triage the top cross-file clusters
  against `slopo.ignore.txt`, one package at a time. The config + `slopo.ignore.txt` are
  committed at `callback-box/tools/slopo/`; `slopo.db` and the report dir are gitignored.
- **Config that must ship:** the `node_modules`/`dist`/`build` excludes above, plus test
  excludes. Without them the report is 70% garbage.

**Open question left for later:** worth a one-off Voyage `voyage-code-3` key to compare
against `text-embedding-3-small`? Voyage is code-tuned and might raise the signal ratio,
but OpenAI already produced actionable results, so this is optional polish, not a blocker.
