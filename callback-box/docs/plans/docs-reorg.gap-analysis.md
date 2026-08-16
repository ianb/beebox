---
title: "Docs-reorg companion: gap analysis — non-obvious, undocumented conventions"
status: active
workstream: unknown
issues: []
---
# Docs-reorg companion: gap analysis — non-obvious, undocumented conventions

Premise (from the plan's Direction section): document only what contradicts
a fresh agent's intuition; flag possibly-incidental divergences as questions
rather than enshrining them.

## A. Undocumented + intentional → document

Data-loss / corruption tier:

1. **Connector sync destroys hand-added frontmatter fields except
   `contains`.** `src/connectors/preserve-agent-fields.ts:1-49` — sync
   rebuilds cards wholesale from templates; only `AGENT_FIELDS =
   ["contains"]` survives (applies to Gmail thread cards and Drive
   doc/sheet cards). An agent annotating a synced card with `priority:` or
   `tags:` sees it silently vanish on next sync. Documented only in the
   module's own comment — not in `src/connectors/CLAUDE.md` or
   `docs/connectors.md`. The strongest "confidently wrong, silent data
   loss" gap found.
2. **Hub-spawned box children get a fail-closed env allowlist, not
   `process.env`.** `src/hub/child-env.ts:8-91`; `CB_SESSION_SECRET` /
   `ANTHROPIC_API_KEY` deliberately withheld. A feature tested under direct
   `cb serve` silently loses its env var under the hub. Needed one-liner:
   "adding an env var a box reads? Also add it to `child-env.ts`."
3. **System prompt must stay time-invariant (warm-pool cache key), and
   resumed sessions never re-send it.** `src/core/session-context.ts:1-14`
   (time context only in per-message `<chat-app>` snapshots) and
   `src/core/agent/run.ts:191-208` (resume omits systemPrompt entirely —
   prompt edits are invisible to open threads until session reset; only
   hint today is `reactor/DESIGN.md:78`).
4. **Timeouts must count awake time, not wall clock.**
   `src/lib/awake-timeout.ts`, `src/lib/exec-with-timeout.ts` — plain
   `setTimeout` counts macOS sleep. CLAUDE.md covers the analogous
   file-lock case but not timeouts.
5. **Box paths have two string forms; leading `/` means box-root-relative,
   not absolute.** `src/shared/box-path.ts:1-26`; conflation already caused
   a live bug per the docstring. Deserves a pointer from CLAUDE.md or
   `docs/box-layout.md`.
6. **Every card schema silently gets optional `title` and `contains`
   (`GLOBAL_CARD_FIELDS`).** `src/cards/schema.ts:63-77`; `contains` is the
   prime retrieval field. `docs/adding-schemas.md` never mentions it and
   its example redeclares `title`, hiding the mechanism — new card types
   end up invisible to search.
7. **`bypassPermissions` is hardcoded for every SDK-spawned box agent.**
   `src/core/agent/run.ts:63`; a box's `.claude/settings.json` does not
   gate engine-spawned agents. Discussed only inside the openclaw-hermes
   research corpus.
8. **`makeTestServer` prefixes every URL with `/test`; `rootRequest()` is
   the escape hatch.** `test/helpers/doctest-server.ts:58-126`;
   `docs/testing.md:80` lists the helper without the prefixing.
9. **v2 box slug comes from the package root's basename, not the served
   `content/` dir.** `src/cli/commands/serve.ts:25-45`; missing from
   `docs/box-layout.md`'s v2 section.
10. ~~**SSR authoring rules**~~ — **obsolete (2026-08-01).** SSR and
    `cb render` were removed; `useSSRMachine` is gone and `useMachine` is
    now the correct import. The module-scope `typeof window === "undefined"`
    guards were kept as general defense, but there is no SSR authoring
    contract left to document.
11. **`restrict-component-classes` silently skips dynamic `className`
    expressions** (`personal-vibe-check/rules/restrict-component-classes.mjs:17-19`);
    FRONTEND.md implies categorical enforcement. Rule of thumb to state:
    keep className values literal.
12. **`src/lib/` helpers keep getting reinvented** (`content-hash.ts`,
    `drop-undefined.ts`, `public-url.ts`, `mimetype.ts`, `filename.ts`,
    `file-exists.ts` each note "previously N private copies"). Fix is one
    CLAUDE.md line pointing at the directory.
13. **Frontmatter reserialization reorders keys to schema declaration
    order** (`src/core/card-io.ts:279-300`) — one-field mutations rewrite
    the whole block (diff noise/merge conflicts). CLAUDE.md states
    parse-mutate-reserialize without this side effect.

## B. Undocumented + possibly-incidental → boxholder questions

**Boxholder dispositions (2026-07-04):** (1) maybe a bug, finicky area —
investigation commissioned. (2) low priority — agent-led editing matters
more than interactive; backlog it. (3) no continuation wanted — a test
should run from the beginning; remove `--from` and fix the doc claim.
(4) important — gets a CLAUDE.md mention ("persistently missed needs a
mention, even if small"). (5) there should be one way to log everywhere;
if there isn't, fix it — consolidation backlogged. (6)–(9) not yet
answered — remain open questions in `docs-reorg.md`.

1. **Reactor chat session-id plumbing may not resume anything.**
   `chat-reactor-sessions.ts:59-71` pre-mints a UUID;
   `agent.ts:51` records the SDK-assigned id only `if (getSessionId() ===
   null)` (already non-null); `chat-jobs.ts:83-88` never writes
   `agentResult.sessionId` back. Next cycle's `resume:` targets a session
   that never existed. Cross-cycle chat memory silently broken, or is
   there resume-or-create semantics making it safe?
2. **Webapp card mutations have no concurrency protection**
   (`trpc/routers/todos.ts:56-83`, `scheduler.ts:~124`: read→mutate→write,
   no lock, no `expect` token — while view-widgets' `writeFile {expect}`
   exists for exactly this). Accepted risk or gap?
3. **`cb scenario run --from <checkpoint>` only skips steps** — nothing
   restores checkpoint state (`src/scenario/runner.ts:280-306`), yet
   `docs/testing.md:345` sells it as re-run-from-checkpoint. Aspirational
   or broken?
4. **Is `getBoxTime` supposed to be the house clock?** Used in ~11 files;
   `new Date()` appears ~66× in core/cli incl. `created:` stamping — which
   ignores frozen scenario time. Intentional split or drift?
5. **Is `makeLog` (`src/core/chat/session/log.ts`) the house logging
   style,** or cluster-local? ~900 raw `console.*` calls elsewhere.
6. **YAML `stringify` never pins `lineWidth: 0`** — long scalars fold
   unpredictably, breaking naive substring edits. Pin it?
7. **Basename-collision lint is case-sensitive**
   (`src/lib/attach-lint.ts:76-98`) but macOS filesystems aren't. Tighten?
8. **`@xstate/store` documented as adopted (`docs/stack-decisions.md:143`)
   but absent from package.json/src.** Still the plan, or strike?
9. **Two-and-a-half registration manifests** (`cb boxes add` scheduler
   manifest vs `hub.json`, plus `cb activity` reading boxes.json) read as
   one system in docs. Cross-reference or unify?
10. `docs/composer-input-machine.md` leads with an unshipped 5-state
    design and buries the shipped 3-state reality — restructure?

## C. Documented but wrong / unfindable from point of need

1. **`src/test-lib/` doesn't exist** — cited by `callback-box/CLAUDE.md:81,124`
   and `docs/testing.md:22`; the infra is the `agent-doctest/` package +
   `test/helpers/`.
2. **`.claude/rules/doctest.md` is a stale copy** — missing the
   `=> throws ErrorName[: message]` shorthand
   (`agent-doctest/src/doctest-hooks.mjs:185-215`); 10 doctests hand-roll
   try/catch instead.
3. **CODE-STYLE.md claims knip enforces export minimalism; `knip.json`
   excludes `"exports"`.**
4. **`eslint.config.mjs` references `eslint-suppressions.json` and a
   `docs/eslint-rule-suppression-audit.md` path that don't resolve** (the
   audit doc lives at monorepo-root `docs/`, not callback-box's).
5. **`src/hub/hub-server.ts:1-14` comment says the hub never lazy-spawns —
   contradicted by `resolveEndpoint()` and `supervisor.ts` `lazy: true`**
   (added 2026-07-04). Fix comment; give lazy-hub a sentence in
   `docs/adding-a-box.md`.
6. **`src/cli/commands/boxes.ts:1-8` says `cb serve` reads boxes.json** —
   contradicts `serve.ts:11-14` and `docs/scheduler.md:31`;
   `docs/user-stories.md` asserts the old behavior as verified.
7. **`src/core/reactor/DESIGN.md:51,70` describes job cards as XML;** code
   reads YAML frontmatter (`job-discovery.ts:1-10`, `chat-jobs.ts:96-104`).
   Also: CLAUDE.md's "XML gone" is too absolute — embedded pseudo-XML
   (`<step>`, `<thread ref>`, `<schedule>`) is a live in-body pattern, and
   `docs/glossary.md:22` vs `:42` contradict each other about it.
8. **FRONTEND.md primitive tables drifted** — missing `FriendlyDate`
   (whose docstring encodes a real SSR/hydration timezone gotcha),
   `VisuallyHidden`, `FileEntry`, `OpenInPanelButton`, `VideoEmbed`.

## D. Over-documented / leave alone

- Job-card filename→type hyphenation fails loud; docstring suffices.
- `hub.json` no-hot-reload already covered twice; only SIGHUP's real
  meaning (crash-loop latch clear, `supervisor.ts:340-351`) merits a clause.
- Router idle-shutdown detail in root CLAUDE.md is genuinely
  counter-intuitive; earns its place (contra a pure line-count cut).
- `CALLBACK_MAIN_ROOT`/`CALLBACK_STATE_DIR`: correctly undocumented
  escape hatches (per the doc-altitude principle: never document
  harness-set env vars).

Verified-solid (no action): `lib/trpc.ts` self-docs,
`docs/adding-api-endpoints.md`, `docs/asset-manifests.md`,
`docs/migrations.md`, chat components CLAUDE.md, `chat-turn-buffer.ts`,
the self-explaining `template-stock-hashes` doctest failure message.
