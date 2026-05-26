# CLAUDE.md Review — 2026-04-28

**Working document. Delete after the proposed changes are applied or rejected.**

## Scope

This reviews the CLAUDE.md and `.claude/rules/` files **in this repo** that guide
agents developing callback-box itself. It is **not** about the CLAUDE.md, rules,
and docs that this repo generates for boxes (those live under `~/src/boxes/<name>/`
and are produced by `cb init`).

Files in scope:

- `CLAUDE.md` (root, 135 lines)
- `deploy/CLAUDE.md` (8 lines)
- `docs/architecture/CLAUDE.md` (54 lines)
- `src/connectors/CLAUDE.md` (25 lines)
- `src/core/reactor/CLAUDE.md` (23 lines)
- `src/dev/CLAUDE.md` (34 lines)
- `src/services/CLAUDE.md` (123 lines, after fix)
- `.claude/rules/doctest.md` (21 lines)

## Already fixed (committed in this pass)

1. `deploy/CLAUDE.md` — replaced stale `provision.sh` reference with the actual
   scripts (`create-server.sh`, `setup-server.sh`).
2. `src/services/CLAUDE.md` — added `claude-chat.ts` to the inventory table with
   a note that it isn't part of the `Services` container.
3. `CLAUDE.md` (root) — added missing `src/` directories to the source layout
   block: `activities/`, `scenario/`, `dev/`, `lib/`, `types/`.
4. `CLAUDE.md` (root) — compacted Cards section (dropped XML example, merged
   structure paragraphs), tightened Behavioral Notes (14 bullets → 9, removed
   "Don't invent card XML formats" since that concern only applies inside a
   box, not when developing this repo; removed "Service fakes are
   domain-specific" since `src/services/CLAUDE.md` covers it; merged "Fix
   errors" + "Leave the repo clean"; tightened tRPC and UI-primitives
   bullets), compressed "Improving These Instructions" from 11 lines to 2.
   135 → 117 lines.
5. **Split CONVENTIONS.md** into `CODE-STYLE.md` (general — typecheck/lint,
   error handling, code style; ~58 lines) and `FRONTEND.md` (data-source
   tagging, color palette, UI primitive reference, `className` rule;
   ~110 lines). CONVENTIONS.md deleted. Root CLAUDE.md now `@`-imports only
   CODE-STYLE.md; FRONTEND.md is referenced from the frontend bullet so it
   loads only when an agent reads it. Updated remaining inline reference in
   `chat-pieces.tsx`.
6. **Regenerated `docs/doc-graph.md`** to reflect the split (doc went from
   33 documents to 58 — the prior version was very stale).
7. **Restored `src/dev/doc-graph.ts`** (deleted accidentally in commit
   `85d846e` on 2026-04-18, "Delete dead code; quiet knip false positives";
   only the compiled `dist/dev/doc-graph.js` survived). Added
   `doc-graph` script to package.json (invoked via `pnpm doc-graph`) so knip recognizes it as an
   entry point alongside the other `src/dev/` CLI scripts. Knip now only
   flags activities files (slated for removal anyway).
8. **Fixed self-reference bug in `doc-graph.ts`**. The script previously
   extracted references *from* `docs/doc-graph.md`, treating its
   auto-generated quoted-file content as real references. This let it appear
   to "reference" every file it documented, masking real orphans and
   producing different output on each consecutive run. Added
   `SELF_OUTPUT_PATH` constant and a skip in the second pass. Output is now
   byte-stable across runs (verified). Newly-revealed orphan:
   `docs/TESTING-NEWS-PROCEDURE.md` — genuinely unreferenced anywhere.

## Per-file proposals

### `CLAUDE.md` (root) — DONE in this pass (135 → 117 lines)

See "Already fixed" above. Original analysis preserved below for reference.

**Behavioral Notes (lines 86-99)**

Most bullets are 2-4 sentences where one would do. Proposed rewrites:

- "Read before writing." — keep as is, this one's already tight.
- The doctest bullet repeats `.claude/rules/doctest.md` which the rules system
  loads automatically for `.doctest.md` files. Could be: "Doctests are markdown
  with executable code blocks. The `doctest.md` rule auto-loads when editing
  one — read it before assuming syntax."
- "Two TypeScript configs" bullet — fine, leave it.
- "HTTP endpoints go in tRPC" bullet — currently 5 lines. Compress to:
  "Add HTTP endpoints to tRPC routers (`src/webapp/trpc/routers/`), not raw
  Fastify routes. Raw routes are only for SSE, file uploads, OAuth redirects,
  and webhooks. Older raw routes are tech debt — migrate when you touch them."
- "Frontend UI primitives" bullet — duplicates CONVENTIONS.md (which is
  `@`-imported). Compress to one line: "Frontend uses UI primitives from
  `components/ui/` and a semantic color palette — see CONVENTIONS.md."
- "Don't invent card XML formats" bullet — ~3 lines, can be one: "Card XML
  follows the schema in `src/schemas/`. Read the schema before creating or
  editing cards."
- "Service fakes are domain-specific" — can drop entirely (covered in
  `src/services/CLAUDE.md`).
- "Git trailers" — fine.
- "Check client debug logs" — fine, this is non-obvious.
- "Fix errors as you find them" + "Leave the repo clean" — could merge into one
  bullet: "Fix any lint/type/test errors you encounter (even pre-existing ones)
  and leave the repo clean when committing — no half-done changes."
- "Don't hardcode personal names" — fine, important.

**Improving These Instructions (lines 101-111)**

11 lines of meta-advice. Compress to two:

> When you get corrected on a convention, pattern, or workflow that wasn't
> documented, update CLAUDE.md, CONVENTIONS.md, `.claude/rules/`, or `docs/` so
> the next agent doesn't repeat the mistake. One-line additions preferred.

**Cards section (lines 21-43)**

Solid, but the inline XML example doesn't earn its keep when the schemas are
the source of truth. Proposal: drop the XML example, keep the structural rule
("each card type has a root XML element matching its type name") and add a
pointer like "see `src/schemas/memo.ts` for a worked example."

**Estimated savings: 135 → ~90 lines.**

### `src/services/CLAUDE.md`

Now 123 lines (we just added one row). Two compaction opportunities:

1. "Threading through routes" and "Threading through connectors" (lines 66-95)
   are structurally identical. Merge into one section: "Threading through
   callers" with two short examples.
2. The fake-options-object example (line 21,
   `createFakeFoo(opts?: { items?: Item[] })`) doesn't match
   `createFakeFeedFetcher(feeds?)` and `createFakeArticleFetcher(articles?)`
   which take positional params. Either standardize the implementations or
   hedge the doc ("most fakes take an options object; see the inventory for
   exact signatures").
3. The google-auth fake doesn't follow the "Fake extends Interface with
   observable state" pattern — `createFakeGoogleAuth()` just returns
   `GoogleAuthService` directly. Either grow the fake (give it `.tokenRequests`
   or similar observable state) or call this out as the one exception.

**Possible addition:** a one-line guideline for *when* to add a service vs.
just calling a library directly. Recurring judgment call.

**Estimated savings: 123 → ~95 lines.**

### `docs/architecture/CLAUDE.md`

Already proportionate to its content. The diagram pipeline is fiddly enough to
warrant the detail. Leave as is.

### `src/connectors/CLAUDE.md`

Tight and accurate. Leave as is. The "Not yet service-injected" section is
genuinely useful — agents adding to google-calendar should know the migration
is in progress.

### `src/core/reactor/CLAUDE.md`

Tight and accurate. Leave as is.

### `src/dev/CLAUDE.md`

Tight and accurate. One small addition worth considering: this directory also
contains `generate-doc-images.ts` and `prompt-report.ts`, neither of which is
mentioned. If the file is meant to be a knowledge-audits guide specifically,
rename the heading from "Dev Tools" to "Knowledge Audits" (since that's the
sole topic). If it's meant to cover all of `src/dev/`, add a sentence about
the other tools.

### `deploy/CLAUDE.md`

Now accurate after the fix. Already minimal.

### `.claude/rules/doctest.md`

Dense but each line is load-bearing. The rule auto-loads only when editing
`.doctest.md` files (via the `paths:` frontmatter), so it doesn't cost root
context. Leave as is.

## What's missing

> **Note (2026-04-28):** activities are slated for removal in favor of a
> different design, so we're skipping doc work for `src/activities/`.
> The layout entry added in this pass should be removed when the directory is.

### Concepts that exist in code but aren't explained

1. ~~**Card status lifecycle.**~~ **Skipped** — the statuses (`new` /
   `pending` / `answered` / `processing` / `processed`) aren't actually
   well-architected; usage is ad hoc. Not worth documenting until the design
   is intentional.

2. **The `cb` CLI surface.** Audit complete; restructure plan logged in
   `docs/cli-restructure.md`. Summary:
   - `cb context` deleted (function moved to webapp). ✅ Done.
   - Decided shape: ~19 top-level commands + 7 groups (`connector`,
     `schedule`, `calendar`, `drive`, `intake`, `procedure`, `chat`).
     ~35 distinct callable forms after restructure (was 40+).
   - Decided renames: `cb finish → cb finish-job`,
     `cb finalize → cb connector flush`, `cb tick → cb schedule tick`,
     `cb scheduled → cb schedule list`, `cb scheduler → cb schedule daemon`,
     `cb scan-import → cb intake scan`, `cb upload → cb intake upload`,
     `cb calendar → cb calendar list`.
   - Deletes done: `cb context`, `cb format`, `cb init-rules` standalone
     (file moved to `src/core/init-rules.ts` as a library routine; prose
     in `prompt-report.ts` updated; `docs/prompts.md` regenerated).
   - `cb activity` will go with the activities removal.
   - `cb assemble-timeline` is **not** dead — used by
     `process-captures.procedure.card` (audit error).
   - Open: whether `cb describe-images` / `cb transcribe-captures` deserve
     `cb image` / `cb audio` homes (defer until a third command lands).
   - Side todo: consolidate the two agent-command sources of truth
     (`agent-guide/commands.ts` and `generateCbCommands()`) — both touch
     every rename, so worth fixing as part of the restructure.
   - **Retracted:** `cb session` IS agent-used as an introspection tool;
     stays in agent docs. (An earlier draft of this review proposed
     removing it — that was wrong.)

   See `docs/cli-restructure.md` for the full mapping, migration order,
   and open questions.

3. ~~**`config/` and `.callback-box/` in a box.**~~ **Done** — see
   `docs/box-layout.md`. Covers marker files, `box/`, `store/`, `config/`,
   `.callback-box/`, `.claude/`, and the auxiliary directories
   (`people/`, `tricks/`, `views/`, `procedure/`, `tmp/`). Comments added
   in three sync points — `BOX_DIRS` in `src/cli/lib/paths.ts`,
   `src/core/agent-guide/box-shape.ts`, and `src/cli/commands/init.ts` —
   each pointing at the doc and reminding editors to update it (and the
   other two locations). Drift was already real: the in-box `box-shape.ts`
   referenced `box/pool/` and `store/calendar/` which aren't in `BOX_DIRS`;
   the new doc flags those as "promote or remove" decisions. Root CLAUDE.md gives the box
   layout in one sentence (`box/inbox/`, `box/jobs/`, …, `config/`) but
   doesn't say what lives in `config/` (schemas, procedures, profiles?) or
   `.callback-box/` (client-debug.log, docid-debug, …). An agent debugging a
   box-side issue has to discover these by greppping.

### Directories without their own CLAUDE.md

Each of these is substantial enough that a directory CLAUDE.md would help, or
their concerns should be hoisted into root CLAUDE.md:

- `src/cli/` — 40+ commands, a `lib/` with shared helpers, a `bootstrap.ts`.
  No guidance on where to add a new command or what conventions exist.
- `src/webapp/` — has tRPC routers, raw routes, views, auth, server. The
  root CLAUDE.md tRPC bullet lives here logically.
- `src/frontend/` — has its own tsconfig, eslint, tailwind, knip configs.
  CONVENTIONS.md covers UI conventions but not architecture (how state is
  organized, how tRPC is consumed, what `machines/` is for).
- `src/schemas/` — `docs/adding-schemas.md` exists; might just need a one-line
  pointer in a `src/schemas/CLAUDE.md` so agents editing schemas land on it.
- `src/test-lib/` — has `docs/` inside it, referenced from the root Guides.
  Might be fine.

You'll have to decide for each: directory CLAUDE.md, hoist to root, or rely on
the Guides table. My instinct: a one-paragraph CLAUDE.md for `src/cli/` and
`src/webapp/` would pay for itself; frontend already has CONVENTIONS.md doing
most of the work.

### "How to add X" coverage

Root Guides table has: card type, API endpoint, box. Missing:

- Add a connector (`docs/connectors.md` exists — is it a how-to or a
  reference? Worth verifying the title means what an agent expects.)
- Add a service (interface + real + fake)
- Add a CLI command
- Add a tRPC procedure (covered by "Adding API endpoints"? Verify.)

Each of those is a recurring task; one short doc per topic prevents drift.

### Decision-tree gaps

Recurring judgment calls that aren't documented anywhere:

- **Service vs. direct library call.** When wrap, when not?
- **Connector vs. CLI command.** Both can pull data from outside; the
  boundaries aren't stated.
- **Procedure vs. plain code.** Multi-step workflows can live in either.
- **Raw Fastify route vs. tRPC procedure.** Partially documented in the
  behavioral note, but the boundary cases (long-polling? large responses?
  binary uploads?) could use a checklist.

### Smaller gaps

1. **`.claude/rules/` is not mentioned in root CLAUDE.md** even though it's
   referenced inline (`see .claude/rules/doctest.md`). One line: "Rules in
   `.claude/rules/<name>.md` auto-load when their `paths:` glob matches the
   file you're editing."

2. ~~**`@CONVENTIONS.md` import syntax** and the mixed-scope problem.~~
   **Done:** split into `CODE-STYLE.md` (general) and `FRONTEND.md` (UI
   reference). Root CLAUDE.md `@`-imports only CODE-STYLE.md. Still worth
   verifying that the `@` syntax is the right Claude Code mechanism (vs.
   relying on co-located file pickup).

3. **When to create a new CLAUDE.md vs. add to root.** The "Improving These
   Instructions" section says when to *update* docs, but not when to
   spin off a new directory CLAUDE.md.

4. **Pre-commit and post-commit hook documentation is fragmented.** Root
   CLAUDE.md mentions both ("pre-commit runs typecheck + lint"; "post-commit
   auto-deploys"). CONVENTIONS.md adds detail. There's no single place that
   says what runs when, and no mention of the card-validator plugin from
   `plugins/`.

5. **No mention of git trailer vocabulary.** Root CLAUDE.md says "commits use
   trailers like `Created-By:`" but doesn't list which trailers exist or what
   they mean. This is the kind of thing agents will guess at.

### Missing rules and conventions

These are recurring decisions agents make where the doc is silent or scattered.
Each could be a one-paragraph entry in root CLAUDE.md or its own file under
`docs/`, depending on depth.

1. **Typed everywhere.** The principle "no untyped boundaries" isn't stated
   in one place. CONVENTIONS.md bans `any` (good), but the broader rule —
   client/server calls go through tRPC for end-to-end types, external data
   gets parsed through Zod at the boundary, internal function signatures are
   explicit, no `as` casts to escape errors — would benefit from being one
   short paragraph in root CLAUDE.md instead of inferred from a dozen
   conventions.

2. **tRPC unless network constraints force otherwise.** Already in the
   behavioral notes but worth promoting from "tech debt note about old raw
   routes" to a positive rule: "Default to tRPC. Reach for raw Fastify only
   when the request/response shape genuinely doesn't fit (SSE, streaming,
   binary I/O, OAuth callbacks, webhooks)."

3. **XState for non-trivial UI state.** There are 7 machines in
   `src/frontend/src/machines/` (chat, activity-chat, SSE, voice recorder,
   speech playback, realtime transcription, claude auth) and they look like
   genuine FSM problems — async coordination, timed retries, queue + prefetch,
   media device lifecycles. Each has one consumer (a `useFoo` hook or one
   component). The convention is sound; the gap is purely documentation.
   No doc explains:
   - When to reach for XState vs. `useState`/`useReducer` (rough rule of
     thumb: timed transitions, async coordination, or "what's currently
     happening" matters for correctness).
   - Naming (`fooMachine.ts`) and the one-machine-per-hook pattern.
   - How machines connect to React (`useMachine` inside a hook, expose a
     narrowed API to components).
   - Where the boundary sits between machine state and tRPC/SSE-driven state.
   Worth a `docs/state-machines.md` plus a one-line pointer from root
   CLAUDE.md.

4. **Component and style rules.** The pieces are documented but split across
   root CLAUDE.md ("UI primitives" bullet), CONVENTIONS.md (palette,
   primitives, `className` rule), and the `restrict-component-classes` ESLint
   rule. The synthesizing rule — "appearance lives in `components/`,
   page-level code only does outer-layout via `className`" — should be
   stated once, in CONVENTIONS.md, with everything else cross-linking to it.

5. **Reliability.** Nothing in any CLAUDE.md or doc covers:
   - Idempotence expectations for connectors and activities (a wakeup that
     re-runs after a crash mid-cycle — what's safe?).
   - Retry/backoff patterns for external API calls.
   - What counts as a recoverable error vs. fatal.
   - Card status as a recovery mechanism (status `processing` left over from
     a crashed run — who cleans it up?).
   - Lock file semantics (the reactor uses locking — is this documented?).
   This is a substantive gap — probably its own `docs/reliability.md`.

6. **Logging — needs both implementation and docs.** Current state:
   - `claude-code-logger` is used for agent traces (logs to
     `.callback-box/logs/`).
   - `client-debug.log` captures forwarded browser console errors.
   - Beyond that, plain `console.log` / `console.error` is scattered through
     the code with no convention.
   No central logger module, no log levels, no structured fields, no
   convention for where logs go for non-agent server code, no guidance on
   what to log in a connector vs. a route vs. an activity. The doc gap can't
   be filled until the logging story is. **Recommendation:** treat this as
   two work items — design and build a logger first, then document
   *"adding logging"* (which logger, when to log, what fields, how to read
   it back).

7. **Testing — how, when, and test-first.** The doctest mechanics are well
   documented (`.claude/rules/doctest.md`, `src/test-lib/docs/`,
   `docs/testing.md`). What's missing is the *practice*:
   - **Which tier to choose.** Pure-function doctest vs. route doctest vs.
     filesystem doctest — when is each appropriate? An agent has to read all
     three to figure this out.
   - **What to fake vs. let run real.** Tied to the services pattern but
     not stated as a testing rule.
   - **What to test.** Coverage for happy path, failure modes, edge cases —
     no convention for what level of thoroughness is expected.
   - **Test-first.** Stating it as the default ("write the doctest first
     when the behavior is well-defined; iterate when it isn't") would
     change agent behavior — currently most agents will write code and
     then ask whether to test it.
   Worth a short `docs/testing-practice.md` distinct from the existing
   mechanics-focused `docs/testing.md`.

## Pre-commit hook scope

Root CLAUDE.md says "runs typecheck + lint", CONVENTIONS.md goes deeper.
Probably fine — keep the root mention as a heads-up and let CONVENTIONS.md
own the detail. (Listed here so we don't do redundant work in the next pass.)

## Code todos surfaced by this review

These are not doc fixes — they're work items in the actual `src/services/` code:

- **Standardize all fakes to named-params constructors.** `createFakeFeedFetcher(feeds?: FakeFeedEntry[])` and `createFakeArticleFetcher(articles?: FakeArticleEntry[])` currently take positional arrays. Change them to `createFakeFeedFetcher({ feeds })` and `createFakeArticleFetcher({ articles })` and update call sites (mostly doctest files). The CLAUDE.md is now written assuming this is the rule, so the code needs to follow.
- **Add a `describe(): string` method to every fake** that returns a multi-line snapshot of current state suitable for doctest matching. Replace ad-hoc `JSON.stringify(fake.sent, null, 2)` patterns in doctests with `print(fake.describe())`. Roll this out one service at a time as you touch them, or in a single sweep.
- **Card normalization story.** `cb format` was deleted in the CLI
  restructure. We still need *some* way to keep cards in flat-XML form.
  Options: a pre-commit hook that auto-formats on stage; a library that
  runs on every `cb create` / `cb mv` so cards are written normalized in
  the first place; or a periodic sweep listed in `docs/maintenance.md`.
  See `docs/cli-restructure.md` "Side issues" for context.
- **Finish the `google-calendar` service-injection migration.** Five direct
  API call sites in `google-calendar.ts` and `calendar-config.ts` need to go
  through `GoogleCalendarService`, and the service is missing a `patchEvent`
  method that the connector needs. Full step-by-step in
  `src/connectors/CLAUDE.md` under "Not yet service-injected".

## Recommended order for next pass

Roughly highest-leverage first:

1. **Design and build a logger**, then document "adding logging" (this is the
   one that needs code work before doc work).
2. **Reliability doc** (idempotence, retries, card-status recovery, locking).
3. **Testing practice doc** (tier selection, what-to-fake, test-first default).
4. **State-machines doc** (when XState, how it connects to React).
5. ~~Apply the root CLAUDE.md compaction.~~ **Done** (135 → 117 lines).
6. Promote "tRPC by default" and "typed everywhere" from inferred conventions
   to stated rules.
7. Document card status lifecycle (new doc in `docs/`, link from root).
8. Decide which directory CLAUDE.md files to add (`src/cli/`, `src/webapp/`?).
9. Fill in the missing "how to add X" guides (connector, service, CLI command).
10. Write a short decision-tree doc for "where does new code go".
11. ~~Decide on the three services-doc fixups (merge sections, hedge fake
    pattern, address google-auth exception).~~ **Done** — pattern reflects
    named-params + describe(); fake-state extension is opt-in; "Threading
    through routes" and "Threading through connectors" merged into a single
    "Threading through callers" section.
12. ~~Decide whether `src/dev/CLAUDE.md` is "knowledge audits" or "all of dev".~~
    **Done in two passes:**
    - First pass: narrowed to knowledge audits + pointer block; created
      `docs/maintenance.md` (periodic tasks doc); kept `generate-doc-images.ts`
      in `docs/architecture/CLAUDE.md`. Root Guides table updated.
    - Second pass: rewrote `src/dev/CLAUDE.md` as a pure index (`src/dev/`
      is honestly a grab-bag of stand-alone CLI scripts; the file maps each
      script to its full doc). Created `docs/knowledge-audits.md` for the
      substantive harness/format/failure-triage content that previously
      lived in `src/dev/CLAUDE.md`. Expanded `docs/maintenance.md` with an
      at-a-glance cadence table, doc-images regen entry, and clearer
      output-triage guidance.
13. Add the one-liner about `.claude/rules/` auto-loading to root CLAUDE.md.
14. Verify `@CODE-STYLE.md` import syntax does what's intended.
15. When activities are removed, drop `src/activities/` from the root layout.
16. Delete this file.
