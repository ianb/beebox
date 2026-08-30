---
title: "Box Retrospectives"
status: implemented
workstream: unknown
issues: []
---
# Box Retrospectives

A periodic sweep over a box's chat sessions that mines what the boxholder
implicitly taught the agent — corrections, preferences, register, recurring
asks, context gaps — and integrates it into the box's existing belief
surfaces (personality card, guide cards, briefing) under the evidence model
(`source: inferred`, low confidence, provenance refs). The box already has a
loop for *explicit* feedback (`process-guidance`); this is its implicit twin.
Today nothing observes sessions: the personality card's own `unresolved`
list says *"What register does the boxholder actually use? Need to observe
and adapt"* — and no component's job is to observe.

Converged with the boxholder before this plan was written:

- Boxholder-side first (dev-session mining is a separate, deferred effort).
- Direct-write integration governed by the evidence model — not a
  propose-and-approve queue — with two review affordances: structured git
  trailers on every retro commit, and a per-run report recording exactly
  what was looked at, what was noticed, and what was done.
- Narrative "what I learned" summary kept out of the core briefing card; it
  lives in the per-run report.
- v1 mines chat sessions only; manual trigger first, weekly schedule later.

## Stated preferences this plan trades against

- `beebox/CLAUDE.md` Behavioral Notes — *"Read before writing. Don't
  guess file formats, XML structures, or API shapes."*; *"Git trailers are
  structured metadata. Commits use trailers like `Created-By:
  connector-name`."*; *"All cross-process locks go through
  `src/lib/file-lock.ts`."*; *"Keep source and docs generic — never
  hardcode personal names."*
- `beebox/CLAUDE.md` Cards — *"Mutations to frontmatter cards are
  parse-mutate-reserialize"*; *"Schemas can include `instructions` — prose
  embedded in the schema that's injected into agent context when processing
  cards of that type."*
- `beebox/CLAUDE.md` Key Concepts (Services) — *"Every external
  dependency is wrapped in a typed interface with real + fake
  implementations. Fakes have observable state for testing."*
- `beebox/code-style.md` — custom error classes; no silent error
  swallowing; max 2 positional params; files ≤300 lines.
- Shipped precedents (denser than docs): `bbx feedback`
  (`src/cli/commands/feedback.ts`) for session-context capture from a CLI
  command; `process-guidance.procedure.card` for the
  signal→agent-integration→validate procedure shape; the evidence model in
  `src/schemas/guide-elements.tsx` / `personality-instructions.ts`.
- "Treat noisy command output as a bug" (monorepo CLAUDE.md) — `bbx retro`
  output must stay quiet and structured; the report file carries the detail.

## What already exists

Reused (no rebuilds in this plan except one small refactor, noted):

- **Session discovery and parsing** — `src/cli/lib/session.ts:67`
  (`listSessions`), `:203` (`getSessionMetadata`), `:308`
  (`parseSessionLog`), `:265` (`isRealUserMessage`: *"Real user messages
  start with a `<typed>` or `<speech>` tag since the UI wraps human input
  in those"*). All box-cwd native. **One refactor**: `getSessionLogPath`
  / `getSessionDir` hardcode `os.homedir()` (`session.ts:53,61`); the
  walker needs an injectable projects root so doctests can point at a
  fixture directory. Small param threading, no behavior change for
  existing callers.
- **Chat-session registries** — `.beebox/chat-session-history.json`
  (webapp chat session ids, written by `src/core/chat-session-history.ts:29`)
  and `.beebox/chat-thread-sessions.json` / `chat-sessions.json`
  (telegram threads → session ids, written by
  `src/core/chat-reactor-sessions.ts` / `chat-session-pool.ts`). These distinguish
  chat sessions from wakeup/job/procedure runs sharing the same
  `~/.claude/projects/<encoded-box>/` directory.
- **Compact transcript rendering** — `src/cli/commands/feedback.ts:34`
  (`formatEntry`: user/agent text + one-line tool summaries, *"tool_result
  skipped — adds noise without value"*) is the right register for the
  observer's input. `src/dev/lib/session-report.ts:273`
  (`generateSessionReport`) is the heavier dev-critique renderer — not
  reused (it inlines full Bash output, which is dev-tool signal, not
  boxholder signal).
- **Structured agent invocation** — `src/core/agent.ts:122`
  (`invokeStructured(schema, opts)`) validates the SDK's structured output
  against a Zod schema; `src/core/agent-run.ts:36-40` (`outputSchema`,
  `maxBudgetUsd`, `maxTurns`, `model` options).
- **Evidence model** — `src/schemas/guide-elements.tsx:18-43`
  (`ConfidenceLevel`: confirmed/high/medium/low/hypothesis; `BeliefSource`:
  user-stated/feedback/inferred/default), `src/schemas/personality-fields.ts:44-78`
  (tone/traits entries `{text, confidence?, source?, ref?}`, `unresolved`,
  `experiments`), `src/schemas/personality-instructions.ts` (*"Same as
  guides — confidence (hypothesis → confirmed), source (user-stated >
  feedback > inferred > default)"*; *"When editing traits, **always rewrite
  the body**"*).
- **Briefing corrections** — `src/schemas/briefing.tsx:52-55`:
  *"`{% correction %}` — an instruction that overrides default agent
  behaviour, added in response to an observed mistake. Optional `test`
  attribute."*
- **Procedure engine** — `src/schemas/procedure.ts:35` (`ProcedureAgent`)
  and `:107-109`: *"Each phase can contain `<shell>`, `<agent>`, or
  `<instruction>` elements. … `<agent>` invokes Claude Code with the text
  as the prompt."* `process-guidance.procedure.card` (in live boxes'
  `config/procedures/`; notably it is *not* yet a `templates/procedures/`
  builtin) is the shape to mirror, including `$CHECK_SKIP` prechecks.
- **Git trailers** — `src/cli/lib/git.ts:200` (`commitPaths` with
  `trailers`), `src/cli/lib/git-trailers.ts:15-31` (existing key
  vocabularies: `CONNECTOR_TRAILER_KEYS`, `FEEDBACK_TRAILER_KEYS`, …).
- **Question cards** — `src/schemas/question.ts` (`status`, `input`
  select/text/confirm, `context` ref entries); created in `box/questions/`.
- **Scheduled scripts** — e.g.
  `~/src/boxes/hearth/config/schedules/check-rss.scheduled-script.card`
  (`cron=`, `on-wakeup=`, `enabled=`, `lock-group=` attributes).
- **Validation guardrails** — PostToolUse `bbx validate --hook` and the
  per-box pre-commit hook (`src/core/install-validation-hooks.ts`) already
  police every card the integrator edits.
- **Fake-agent testing precedent** — `src/services/claude-chat-fake.ts`;
  the observer call goes behind a small interface with a scripted fake so
  the pipeline is doctestable without API calls.

## Prior art (external)

- **Background / "subconscious" memory extraction** — LangMem's conceptual
  guide describes exactly this pattern: *"prompting an LLM to reflect on a
  conversation after it occurs … finding patterns and extracting insights
  without slowing down the immediate interaction"*, with managers that
  *"consolidate and generalize from existing memories."*
  <https://langchain-ai.github.io/langmem/concepts/conceptual_guide/>.
  Validates the post-hoc observer + consolidating integrator split (vs.
  hot-path memory writes during chat).
- **Letta / MemGPT** — agent self-edits its own memory blocks via tool
  calls. We deliberately differ: belief updates happen in a dedicated
  retrospective pass with an audit trail, not mid-conversation.
  <https://vectorize.io/articles/letta-vs-langchain-memory>
- **Transcript mining as personalization** — a practitioner mined 30 days
  of their own Claude Code transcripts, ranked recurring patterns by
  frequency, and promoted only high-frequency findings to rules
  (<https://barazany.dev/blog/mining-claude-history-ultracode>). Frequency-
  gated promotion matches this plan's recurrence→confidence policy.
- **JSONL mining pitfalls** — a MemPalace issue documents the classic
  traps: user-role entries that are really tool_result plumbing, and
  synthetic messages polluting extraction
  (<https://github.com/MemPalace/mempalace/issues/111>). Our parser already
  filters these (`session.ts:160-171` plumbing/meta filtering;
  `isRealUserMessage`).
- No prior art found for integrating mined observations into a
  confidence/source-annotated belief schema (the evidence model appears to
  be this project's own design); the closest analogue is the
  frequency-gating above.

## Tracks / scope

Single track — the pipeline is one coherent unit: **collect → observe →
ledger → integrate → report**, plus its trigger and docs. Chunks below
under Implementation order.

**What.** A `bbx retro` CLI command does the mechanical work (discover new
chat sessions, render them compactly, run a tool-less LLM observer per
session, verify and dedupe observations, append to a ledger, write the
per-run report's "examined/noticed" sections). A `process-retrospective`
procedure wraps it: precheck (`bbx retro status --check`), run
(`bbx retro scan`), then an `<agent>` integration step that reads the
report + ledger and edits personality/guide cards under the evidence
model, escalating to question cards where policy requires, finishing the
report's "actions" section, and committing with retro trailers.

**Why this needs to change.** The evidence model has writers for
`user-stated` (direct instruction), `feedback` (process-guidance), and
`default` (templates) — but nothing produces `inferred` beliefs from
observed behavior. Personality cards in real boxes sit at
`confidence: low, source: default` blank-slate values indefinitely.

**Direction — locked shapes.**

CLI:

```
bbx retro status [--check]   # counts new qualifying sessions; --check exits
                            # nonzero (procedure $CHECK_SKIP) when none
bbx retro scan [--max-sessions N] [--dry-run]
```

Session qualification (all must hold):
1. The session is chat: it has `<typed>`/`<speech>`-tagged user messages
   (webapp chat wraps human input; the tags may follow the `<chat-app>`
   snapshot prefix) **or** it appears in a chat registry
   (`chat-session-history.json` ∪ thread registries — telegram sends raw
   text with no tags, so registry membership is the marker there), with
   ≥1 user message either way.
2. Transcript mtime older than a 30-minute quiescence window (don't observe
   a conversation in progress).
3. Not already processed (state file), capped at `--max-sessions`
   (default 20) per run — overflow is named in the report, never silent.

Observation record (ledger line, `.beebox/retro/observations.jsonl`):

```jsonc
{
  "runId": "2026-06-09T18-30-00",
  "sessionId": "…",
  "threadRef": "store/chat/telegram/…/thread.chat-thread.card", // when known
  "kind": "correction" | "preference" | "register" | "recurring-ask"
        | "context-gap" | "experiment-evidence",
  "evidence": "verbatim quote from the transcript",
  "evidenceHash": "sha256 of normalized quote",
  "proposal": "one-sentence proposed belief/rule",
  "sink": "personality" | "guide:<config/x.guide.card>" | "briefing" | "question",
  "observedAt": "ISO"
}
```

The observer is a single tool-less `invokeStructured` call per session
(small model, `maxTurns: 1`, `maxBudgetUsd` cap), fed the
`formatEntry`-style compact rendering. It reports observations; it does
**not** assign confidence — confidence is policy, applied by the
integrator from recurrence:

- New belief from a single session → `confidence: hypothesis, source: inferred`.
- Same proposal evidenced in ≥2 distinct sessions → `low`; ≥4 → `medium`.
- `medium` is the ceiling for `source: inferred`. Promotion past it
  requires the boxholder (question card → `user-stated`).
- Never edit or remove a `user-stated` belief; conflicting evidence →
  question card.
- Briefing `{% correction %}` additions always go through a question card
  (authoritative behavior overrides get explicit blessing).
- The integrator touches only: personality `tone` / `traits` /
  `boxholder.relationships` / `unresolved` / `experiments`, guide rules /
  reactions / experiments, and question cards. `speaking-voice` and
  briefing body are off-limits for direct writes.
- Per the schema instructions, every trait/tone edit rewrites the
  personality body.

Hallucination guard: the observation schema *requires* the literal quote
to be recorded in `evidence` — having to produce the quote is the guard
(per the boxholder: the risk is asking for quote-*based* claims without
asking for the quotes themselves). No automated re-verification against
the transcript; deliberately kept lightweight. Dedupe: an `evidenceHash`
already in the ledger is skipped — this neutralizes resumed-session
transcript duplication regardless of how the SDK copies history across
resumes.

Per-run report: `store/reviews/retro/<runId>.md` — committed, plain
markdown (machine-written audit artifact; a card schema would add
validation burden for no agent-facing benefit). Sections: **What I
learned** (the boxholder-facing narrative, kept out of the core briefing
per the converged design), **Sessions examined** (ids, thread refs,
counts; including skipped/deferred/overflow), **Observations** (with
evidence), **Actions taken** (filled by the integrator:
card edits with before/after gist, question cards created, confidence
bumps with recurrence counts).

Git: every integrator commit carries `Created-By: retrospective` and
`Retro-Run: <runId>` trailers. No new `RETRO_TRAILER_KEYS` vocabulary:
`Created-By` is already a connector-axis key
(`git-trailers.ts:15-21`), so retro commits are filterable in the
history browser with zero new code, and `Retro-Run` parses fine as an
arbitrary trailer (`parseTrailers` takes any key). A dedicated
vocabulary constant with no consumer would be dead export (knip).
`git log --grep '^Retro-Run: '` is the review query.

State: `.beebox/retro/state.json` — `lastRunAt`, plus per-session
`{status: done|failed, attempts}` so a failed observer call retries next
run (max 2 attempts, then permanently skipped and recorded in the report).

Procedure: `templates/procedures/process-retrospective.procedure.card`,
mirroring `process-guidance` — precheck `bbx retro status --check`
(`$CHECK_SKIP` when nothing new), run `bbx retro scan`, `<agent>`
integration step whose prompt embeds the confidence policy above, validate
phase running `bbx validate` on touched cards and confirming the report's
Actions section is non-empty when the ledger had new observations.

Trigger: manual procedure run while dogfooding; then a
`process-retrospective.scheduled-script.card` template (weekly cron,
`enabled="false"` by default, `lock-group="retro"`).

**Vocabulary lock-ins.**
- Command: `bbx retro` (subcommands `status`, `scan`).
- Trailer keys: `Retro-Run`; `Created-By: retrospective`.
- Observation kinds: `correction`, `preference`, `register`,
  `recurring-ask`, `context-gap`, `experiment-evidence`.
- Sinks: `personality`, `guide:<ref>`, `briefing`, `question`.
- Paths: `.beebox/retro/{state.json,observations.jsonl}`,
  `store/reviews/retro/<runId>.md`.

**First implementation chunk.** Chunk 1 below — deterministic walker +
`bbx retro status`/`scan --dry-run` skeleton. No open questions inside it.

## Subplans

None. The one candidate — mining wakeup/job sessions, whose signal is
tool-friction rather than boxholder preference — is deferred outright
(NOT in scope), not subplanned.

## Failure modes

> **Accepted documented risk:** concurrent card edits — a live chat agent
> edits `main.personality.card` while the integrator runs. The
> `lock-group` serializes retro against other scheduled procedures but not
> against interactive chat. Worst case is a git commit conflict surfacing
> in the procedure's validate phase (loud, recoverable); the integrator
> re-reads before editing, and card edits are parse-mutate-reserialize.
> Cross-process file-locking of card writes is a box-wide question beyond
> this plan (`CLAUDE.md`: locks go through `src/lib/file-lock.ts` — but no
> card-write path locks today, so retro matching the status quo).

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Chat registry file missing (box never chatted) | chunk-1 doctest | treat as zero chat sessions; report says "no chat registries found" | clear |
| Transcript deleted between listing and read (user cleared `~/.claude`) | chunk-1 doctest | skip + report note (ENOENT pattern per `session.ts:75-82`) | clear |
| Observer returns schema-invalid output | chunk-2 doctest (fake) | `invokeStructured` validation fails → session marked `failed`, retried next run, max 2 attempts, then reported | clear |
| Observer fabricates an evidence quote | none | schema requires the literal quote be recorded — producing it is the guard; no automated re-verification (accepted simplification per boxholder) | silent if it happens; evidence is reviewable in report/ledger |
| Resumed session re-presents old turns → duplicate observations inflate recurrence | chunk-2 doctest | `evidenceHash` dedupe; dedupe count in report | clear |
| Live conversation observed mid-stream | chunk-1 doctest | 30-min quiescence window; deferred sessions listed in report | clear |
| Backlog blowout after long idle (cost runaway) | chunk-1 doctest | `--max-sessions` cap; overflow named in report | clear |
| Corrupt ledger line (partial write) | chunk-2 doctest | tolerant line parse, skip + debug log (`parseJsonlLine` pattern, `session.ts:112-120`) | clear |
| Integrator writes an invalid card | existing hook coverage | PostToolUse `bbx validate --hook` exits 2 → agent sees error; pre-commit blocks the commit | clear |
| Integrator edits a `user-stated` belief or `speaking-voice` | chunk-3 validate phase | procedure validate greps the diff for forbidden targets; policy stated in prompt | clear |
| Concurrent chat-agent edit of same card | none | see accepted risk above | clear (git conflict) |

No unresolved critical gaps (no row is simultaneously untested, unhandled,
and silent).

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** (tone vs trait, guide rule vs reaction) —
  **ADDRESSED**: the integrator processes personality/guide cards, so the
  schemas' embedded `instructions` are injected (`CLAUDE.md`: *"prose
  embedded in the schema that's injected into agent context when processing
  cards of that type"*); the procedure prompt restates the sink policy; a
  knowledge audit covers it (below).
- **Stale ref** — a `ref` on a new belief points at a chat-thread card
  later moved/archived — **ADDRESSED**: refs are tracked by `bbx validate` /
  `bbx mv` (briefing schema instructions: *"auto-tracked by `bbx validate`
  and `bbx mv`"*); raw session ids additionally survive in the run report
  even if transcripts are cleared.
- **Two agents touching the same card** — **ADDRESSED** as accepted
  documented risk (Failure modes).
- **Hand-edit drift** — boxholder hand-edits the personality card oddly —
  **ADDRESSED**: integrator re-reads before editing; validation hook
  catches malformed results; frontmatter mutation is parse-mutate-
  reserialize per `CLAUDE.md`.
- **Fabricated free-form value** — **ADDRESSED**: the schema demands the
  literal quote be recorded, which makes honesty structurally cheaper than
  invention; every belief carries provenance (`ref` + ledger + report)
  that the boxholder can spot-check.
- **Validation error UX** — **ADDRESSED** (existing): `bbx validate --hook`
  emits card-and-field-specific errors the agent already acts on today.
- **Partial migration / transition state** — N/A: no existing data
  changes shape; the feature only adds new files and new belief entries.

## NOT in scope

- **Dev-side session mining** (monorepo/worktree transcripts, CLAUDE.md
  digest, doc-usage miner) — separate effort; different sinks and review
  model (dependabot-style digest), per the converged design.
- **Wakeup / job / procedure session mining** — their signal is tool
  friction, already served by `@session-critique`; boxholder preferences
  arrive overwhelmingly through chat.
- **Frontend surface for retro reports** — they're browsable as files via
  the existing file renderer; a dedicated page is premature.
- **Auto-promotion past `medium` / auto-editing `user-stated` beliefs** —
  by policy, boxholder-only via question cards.
- **Touching `speaking-voice` or briefing body directly** — authoritative
  surfaces; question-card escalation only.
- **Merging with `process-guidance`** — plausible eventually (both end in
  "revise beliefs from signals"); premature until retro's signal quality
  is proven.
- **Brief/periodic-digest integration** (mentioning retro learnings in the
  news brief) — deferred; the run report is the v1 narrative surface.
- **Cross-box aggregation** — each box learns independently.
- **Transcript retention** beyond the ledger — the ledger + reports already
  survive `~/.claude` clearing; no separate aggregate table.

## Open design questions

- **Observer model choice** — lean: the small/cheap tier (haiku-class) via
  `model` option; settle empirically in chunk 2 by comparing observation
  quality on a handful of real test1 sessions. Doesn't block chunk 1.
- **Recurrence similarity** — recurrence counting requires deciding two
  observations are "the same proposal." Lean: leave similarity judgment to
  the integrator (it sees the full ledger), keep `evidenceHash` only for
  exact-duplicate suppression. Revisit if the ledger grows enough that the
  integrator misses recurrences.
- **Whether `process-retrospective` should eventually run on-wakeup** —
  lean: no; weekly cron only. Wakeup is latency-sensitive.

## Knowledge audits

Two new agent-facing concepts land with entries in
`src/dev/knowledge-audits.yaml` (chunk 4):

1. `knows_directly`: where retrospective run reports live
   (`store/reviews/retro/`) and what creates them (`bbx retro` via the
   `process-retrospective` procedure) — agents will encounter these files
   and the `Retro-Run` trailers in git history.
2. `knows_directly`: the inferred-belief policy — what
   `source: inferred` with a `ref` means, the `medium` confidence ceiling,
   and that contradicting `user-stated` beliefs requires a question card.

No audit for `bbx retro` invocation mechanics (agents don't run it ad hoc;
the procedure does — purely infrastructural).

## Implementation order

1. **Walker + CLI skeleton** — projects-root injectability refactor in
   `cli/lib/session.ts`; `bbx retro status [--check]` and
   `bbx retro scan --dry-run` (discovery, chat-registry filtering,
   quiescence, watermark state, compact rendering, report skeleton with
   "Sessions examined"). Doctests via `makeTmpBox` + fixture JSONL.
2. **Observer + ledger** — `RetroObserver` interface (real:
   `invokeStructured`; fake: scripted), observation Zod schema, verbatim-
   evidence verification, `evidenceHash` dedupe, ledger append, report
   "Observations"/"Discarded" sections, per-session failure/retry state.
   Doctests with the fake observer.
3. **Integration procedure** — `RETRO_TRAILER_KEYS` in `git-trailers.ts`;
   `templates/procedures/process-retrospective.procedure.card` with the
   `<agent>` integration prompt (confidence policy, sink policy, question-
   card escalation, body-rewrite rule, report "Actions" section), validate
   phase. Install into test1; first real runs.
4. **Trigger + docs + audits** — scheduled-script template
   (`enabled="false"`), `docs/box-layout.md` + `docs/maintenance.md` +
   glossary entries, the two knowledge-audit entries, `src/dev/CLAUDE.md`
   untouched (this is runtime, not a dev script).

Chunks are commit boundaries; the plan ships as one unit after chunk 4 and
dogfooding on test1.

## Rollout shape

- **Test posture** — default: pure parts (qualification, dedupe, evidence
  verification, state transitions, report rendering) get doctests as they
  land (chunks 1–2); the integration prompt is dogfooded on test1 (then
  `hearth`) before ship rather than scenario-tested — its quality is
  judged by reading run reports and diffs, which is exactly what the
  report artifact is for.
- **Knowledge audits** — both entries land in chunk 4, before merge.
- **Migration** — none; new files and additive belief entries only.
  Existing boxes get the procedure/schedule via the established template-
  update flow (`config/_template-updates/`), and nothing breaks for boxes
  that never run it.
