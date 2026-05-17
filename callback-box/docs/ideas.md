# Ideas & Planned Features

## Review attach-manifest scope

The attach-manifest hook (`docs/attach-manifests.md`) scopes its discipline to `**/*.attach/**` only. Binaries outside attach scopes commit normally, with a soft "this is big, consider moving it" advisory. Revisit once we have real usage: if agents routinely drop binaries outside attach scopes anyway (logs, screenshots, scratch files), either tighten enforcement (gitignore more aggressively, hard-block large binaries anywhere), or accept the looser model and beef up the advisory. Also worth revisiting: per-dir JSON manifest vs per-binary sidecar — if per-dir produces noisy diffs in practice, the sidecar form is a drop-in replacement.

## Catch stale image-refs after card renames

Surfaced during the attach-layout migration test on the ledger box. Many archived capture-session cards reference their image children by the original `photo-NNN.image.card` form, but agents renamed those image cards to descriptive forms long ago (`photo-001-arrow-invoice.image.card`, etc.) without updating the session card's `<image-ref>` entries. ~1,166 broken refs on ledger trace back to this pattern.

The renames probably came from `cb mv` (or agent-issued renames) on the image cards alone, without touching the session card pointing at them. `cb mv` does rewrite cross-card refs, so a single rename via `cb mv` SHOULD propagate. Suggests this happened either before `cb mv`'s rewrite pass existed, or the renames bypassed `cb mv` (agents writing direct file moves, or using filesystem mv).

Catching it:

- `cb validate` already reports broken refs — but the noise level on ledger is high enough that the user hasn't acted on these. Maybe the validator could surface a stale-ref count summary at the top, and/or fail with non-zero exit when broken-ref count grows.
- A pre-commit hook could check that any commit touching an image card also updates any session card referencing it (or just refuses commits that introduce broken refs).
- A periodic cleanup job in wakeup could try to repair: for each broken ref pointing at `<old>.image.card`, look for an image card in the same dir whose `<filename>` matches the basename and the session's apparent ordering, and offer to repair.

## Claude Code Memory Concerns

Auto-memory (`~/.claude/projects/<path-hash>/memory/`) is problematic:

- Path-hash-based and machine-specific -- not portable across machines
- Not version-controlled, easily lost if repo moves
- Custom subagents don't inherit CLAUDE.md or `.claude/rules/` (only built-in subagents do)
- No setting to relocate memory into the project repo
- Open feature request: [anthropics/claude-code#25739](https://github.com/anthropics/claude-code/issues/25739)

Durable project knowledge should go in repo files (CLAUDE.md, docs/), not auto-memory.

## Keeping the bundled Claude Code SDK binary current

The agent SDK (`@anthropic-ai/claude-agent-sdk`) bundles its own Claude Code binary as an optional npm dependency and ignores anything system-installed (no `$PATH` lookup, no `~/.local/bin/claude`). That binary is frozen at npm-install time, so a long-running server stays on whatever version of Claude Code was current when we last `npm install`-ed.

Today there's no process for refreshing it. The auto-updater on `~/.local/bin/claude` doesn't help — the SDK never looks there. Options:

- A scheduled task on the server that runs `npm install @anthropic-ai/claude-agent-sdk@latest` weekly, then restarts services.
- Tie SDK updates to deploys: `deploy.sh` re-resolves `claude-agent-sdk` to latest before rsync.
- Pin a specific SDK version in `package.json` and only bump deliberately (most explicit, lowest auto-update surface).

Related: [claude-agent-sdk-typescript#296](https://github.com/anthropics/claude-agent-sdk-typescript/issues/296) — the SDK's binary resolver tries musl before glibc on Linux. Worked around in `src/core/sdk-binary-path.ts` by passing `pathToClaudeCodeExecutable` ourselves.

## Per-box secret management

API keys (Mistral, etc.) are configured per-box in `config/connectors/*.secret.json`. When a new box is created, it has no secrets — features like transcription silently fail with "API key not configured." There's no mechanism to provision secrets automatically or inherit them from a shared location.

Options to consider:
- A global/server-level secrets file that boxes inherit from by default
- `add-box.sh` could copy common secrets (mistral, etc.) from an existing box or a template
- A `cb secrets` command to list which secrets each box has/is missing
- Fall back to env vars more aggressively (the env var `CALLBACK_MISTRAL_API_KEY` exists but is commented out by default in setup)

For now: manually copy secret files to new boxes. See `docs/adding-a-box.md` step 7.

## Box deployment friction

Several things go wrong when adding a new box to the server that are easy to forget:

1. **Missing secrets** — see above
2. **File ownership** — `add-box.sh` clones as root, then chowns. But if new box directories are introduced in a code update (e.g., `people/`), existing boxes won't have them until `cb init` runs. The script now runs `cb init --skip-git` as the callback user after pulling, but edge cases remain (e.g., background agents creating directories while running as the wrong user).
3. **No validation after deploy** — there's no health check or `cb validate` run after `add-box.sh` completes. A broken box (missing config, bad permissions) won't be caught until someone tries to use it.

Longer term: `add-box.sh` or a `cb deploy-check` command could verify: all standard dirs exist and are writable, required secrets are present, `cb validate` passes, and the web endpoint responds.

## Scheduler: `cb tick --force` and timeout durability

Surfaced while debugging a Wren daily-rumination "failure" where the agent had actually completed and committed but the wrapper hung past the 10-minute mono timeout.

### Add `--force` to `cb tick --script <name>`

Currently `--script` only filters which schedules to evaluate; `not-before`, `budget`, and lock-group checks still apply, so there's no clean way to manually re-run a script that just ran. Add a `--force` flag that:

- Bypasses `not-before` and `budget` checks.
- On lock-group conflict, only skips if the holder is *live* (the file-lock primitive already auto-cleans dead holders, so this is mostly free — just remove the lock-group skip's reliance on a stale "running" map for force runs).
- Does not preempt a live holder.

### `cb prompt` doesn't exit promptly after the agent's final turn

Symptom: a scheduled `cb prompt …` invocation continued running for ~65 minutes of wall time after the agent's final message landed (commit and journal entry succeeded), until the 10-min mono setTimeout finally fired and SIGKILLed the tree. This made a successful run look like a failure in the scheduler log.

Hypothesis: the spawned `claude --print` process isn't closing stdout/exiting after returning its final response. Worth instrumenting `runAgent` in `src/core/agent.ts` — log when `child.on("close")` fires vs. when the last stdout chunk arrived. If they're far apart, the issue is in claude-code itself; if close fires promptly but our wrapper hangs after, look at the prompt-logger proxy lifecycle (`stopPromptLogger`) and any pending I/O in `cb prompt`.

### Re-evaluate the per-script timeout

`SCRIPT_TIMEOUT = 10m` is monotonic time, which means it pauses during macOS sleep. That's good — a script that was about to finish doesn't get killed just because the laptop closed. But `wren-weekly-research` has `--max-turns 30` (web research) and bumps right against 10 min of real CPU time. Either bump the per-script timeout (configurable in the card?) or add a `<timeout>` attribute on `<scheduled-script>`.

## Service-inject the google-calendar connector

`src/connectors/google-calendar.ts` uses `getGoogleAuth()` + direct REST calls and `ical.js` inline, with no service abstraction. That means there's no doctest-friendly way to exercise its ics-generation path (`generateVtimezone`, `setDateTimeWithTz`, `eventToIcs`). The library-type gap was already noted in `src/connectors/CLAUDE.md` under "Not yet service-injected".

Recent evidence this matters: a latent bug where `ICAL.Time.fromDateTimeString()` was being passed iCal basic-format strings (`YYYYMMDDTHHMMSS`) instead of ISO 8601 extended-format (`YYYY-MM-DDTHH:MM:SS`) broke calendar sync for every box with a Google Calendar connected. No test caught it; it was only noticed when a real wakeup run surfaced the error. A doctest that seeds a fake calendar with one timezone-bearing event and asserts the ics output contains a valid `VTIMEZONE` + `DTSTART` would have caught this immediately.

Work needed:
1. Define a `GoogleCalendarService` interface in `src/services/google-calendar.ts` (partially exists — there's already `createFakeGoogleCalendar`).
2. Refactor `google-calendar.ts` to accept an optional service parameter in its factory, matching the telegram connector pattern.
3. Add `test/connector-google-calendar.doctest.md` exercising the ics round-trip: seed fake calendar → run sync → assert output `.ics` files are parseable by `ICAL.parse()` and contain the expected components.

## Switch deploy from rsync to git push

`deploy/deploy.sh` rsyncs the local working tree to `/opt/callback/`, excluding `.git`. Side effects:

- Server's `git rev-parse HEAD` is meaningless (it reflects whenever .git was last touched, not what's running). The health endpoint now reads `deploy-info.json` to surface the actual deployed hash, but that's a workaround.
- You can deploy from a dirty working tree, so the recorded hash may not match what's on disk.
- No git-native rollback (you redeploy from an older local checkout instead).

Options:

1. **Git push to a bare repo on the server with a post-receive hook.** Hook checks out HEAD into `/opt/callback/`, runs `npm install`, builds frontend, restarts services. Server git matches what's running. Cardworks needs its own remote/hook (or submodule/subtree restructure). Loses today's "scp a single file to test a hotfix" iteration loop — every change has to be a commit.

2. **Server pulls from GitHub on deploy.** Standard CI/CD pattern, single source of truth, but every deploy is a GitHub roundtrip. Same multi-repo dance for cardworks.

3. **Keep rsync but require a clean working tree** (with `--force` for hotfix work). Smallest change. Fixes the truthfulness problem without losing iteration speed.

For now: keeping rsync. Revisit if deployment reproducibility / rollback ergonomics start to bite.

## Ref path normalization

Refs in cards use paths like `ref="../../../store/archive/Foo.record.card"` which are fragile and hard to read. Absolute refs (`ref="/store/archive/Foo.record.card"`) are already supported and preferred.

Ideas for automatic normalization:
- `cb validate --fix` could rewrite relative refs to absolute
- `cb create` could resolve ref arguments to absolute paths before writing
- The card loader could normalize refs on save (convert relative→absolute)
- A lint rule could warn on relative refs that go above the card's parent directory

## CLI Design for Agents

`cb` is increasingly invoked by agents as well as humans. We don't have a dedicated CLI design doc, but should — and it needs ongoing vigilance, not just a one-time pass.

Principles worth encoding:

- **Enumerate valid values in errors.** When a command rejects an enum-shaped argument, the error should name the valid set: `--visibility must be one of: public, private, unlisted (got: "secret")`. This is the highest-leverage error improvement because it fires exactly when the agent doesn't know what to do next and lets it self-correct in one retry. We do reasonably well here but there's no systematic check.
- **Fail before side effects.** Validate inputs early, before anything writes to disk or triggers external calls. An error that fires after a partial write is far more damaging than one that fires at argument parse time.
- **Correct invocation in the error text.** The error should show a working example, not just what was wrong.
- **Idempotent mutations.** Agents retry; they don't notice a duplicate row. Card filenames serve as natural idempotency keys for most `cb` operations (creating a card with the same path twice is a no-op or a merge, not a duplicate). Connectors are the exception — `seenMessageIds`, dedup logic, and external API calls don't have the same guarantee. Worth auditing connector sync paths if retry behavior becomes a problem.
- **Bounded output with navigable truncation.** List-style commands should have a default page size, and truncation messages should teach the agent how to narrow the next query (`"truncated":true,"hint":"add --limit=N or --filter=author:..."`) rather than just cutting off. This applies at both the CLI output layer and the MCP tool description layer — bloated tool descriptions cost tokens on every agent call, never just once. Needs constant vigilance; easy to slip with ad hoc `--json` additions that don't think about pagination.

Consider a `docs/cli-design.md` that codifies these so new commands have a checklist to check against. Alternatively, a lint rule or doctest pattern that exercises error output for enum-typed arguments could catch regressions automatically.

**Three-layer introspection** — each layer answers a different question:

1. `--help` — human-readable: what does this command do?
2. `cb agent-context` — machine-readable JSON describing the full command surface, versioned with a `schema_version` field so a consuming agent can detect breaking shape changes. Flags, types, enums, defaults, required/optional — everything an agent needs to form a valid invocation without a trial-and-error loop.
3. Skill manifests (`SKILL.md` or equivalent) — long-form prose describing *workflows*, not commands: how to compose operations into useful sequences, what to reach for in which situation.

`cb` currently has only layer 1. Layer 2 would be straightforward to generate from the existing command definitions (yargs schema → JSON). Layer 3 is essentially what `docs/IMPLEMENTATION.md` and `.claude/rules/` already do for the Claude Code context — the question is whether to also surface them in a form a non-Claude agent could consume. Both layers 2 and 3 should be kept in sync with the implementation by the same generation step, not maintained by hand.

**Vocabulary consistency** is the highest-leverage item and the hardest to maintain through review alone. Agents don't relearn each CLI from scratch — they generalize from every CLI they've seen, so a command that uses `info` instead of `get`, or `--format=json` instead of `--json`, costs extra retries across every agent invocation, not just the first one. The fix isn't better reviewers; it's a prescriptive vocabulary document that defines the permitted verbs and flags, and a static check that fails on deviations. The `cb` command family is small enough that the vocabulary could be enumerated explicitly: `get`, `list`, `create`, `update`, `delete`; `--json`, `--force`, `--dry-run`, `--limit`, `--cursor`. Any new command picks from this menu. Additions to the menu require updating the doc, not ad hoc review.

## Feature Ideas

### JSON as CLI input — structured arguments and composable profiles

Google's `gws` (Workspace CLI) takes this approach: instead of many individual flags, you pass a single JSON object constructed from the API schema. ([article](https://betterstack.com/community/guides/ai/cli-gws-ai-agents/)) The agent builds one blob rather than learning a large flag surface — fewer distinct interface elements, lower token cost, and the schema can be introspected directly.

```bash
# Individual flags — agent must learn each one
$ cb create --type=memo --title="Hello" --content="..." --author="Ian"

# JSON input — agent constructs one object from the schema
$ cb create --args='{"type":"memo","title":"Hello","content":"...","author":"Ian"}'

# Or from a file
$ cb create --args="$(cat my-memo.json)"
```

The composability payoff is in profiles. A "profile" is just a base JSON file; `jq`'s `*` operator merges objects with right-side winning:

```bash
$ cb create --args="$(jq -n '{"type":"memo","author":"Ian"} * {"title":"Hello","content":"..."}')"
# or
$ cb create --args="$(jq '. * {"title":"Hello"}' base-profile.json)"
```

No profile subsystem needed — files, `jq`, and shell already compose. The convention is: `*` merges, explicit args override profile values, git tracks the profile files.

One further idea from `gws`: the command surface itself is generated at runtime from a live API discovery endpoint rather than a static list. When the underlying API adds a method, the CLI reflects it immediately — no lag between API changes and agent accessibility. `cb` is too hand-crafted for this to apply directly, but the principle is worth holding: the introspection layer (`agent-context`) should be generated from the same source of truth as the implementation, not maintained separately.

This pattern becomes more attractive as the command surface grows (especially for MCP). For `cb` today the flag surface is small enough that individual flags are fine, but worth keeping in mind if the API expands or agents start constructing calls programmatically at scale.

### CLI output as structured streams

The `--deliver=webhook:url` pattern (route CLI output to a file, webhook, or stdout) is really reinventing the pipe inside the CLI. Shell already does this: process substitution + `tee` + `jq` can route different parts of a JSON stream to different destinations without the CLI knowing anything about it:

```bash
cmd | tee >(jq '.notification' | curl -d @- webhook-url) | jq '.content' > out.file
```

This only works if the CLI emits structured JSON in the first place — which is the real precondition. Once it does, `jq` + `tee` + shell become a capable router. The `--deliver` flag trades shell composability for CLI-internal routing; not obviously a win.

The harder problem `--deliver` doesn't solve: stdout is flat. If you want content to go one place, a notification to go another, and metadata to go a third, you need either multiple named output streams (not a shell primitive) or a structured envelope that the consumer splits apart. JSON streaming output is the envelope answer — but then you need the consumer to split it, which is back to shell composition.

The feedback direction (agent reports CLI friction upstream) is genuinely new — there's no pipe equivalent for that. Worth thinking about separately from delivery. — **IMPLEMENTED** as `cb feedback`: agent runs `cb feedback "<observation>"` to record CLI friction to `config/feedback/`, committed silently with session context. Collection and review via `~/src/callback/feedback-review/collect.ts`. Knowledge audit tests in `cb-feedback-*`.

Taken far enough, this stops being shell and becomes a dataflow/glue language. Which may be the right answer, but is a different design space than "CLI with better flags."

### Structured CLI output with UI rendering

`cb` commands could default to JSON output (or always emit it with `--json`) and the web UI could have per-command renderers — a React component or HTML template that receives the JSON and displays it nicely. This dissolves the tension between "JSON for agents, formatted tables for humans": the CLI is always machine-parseable, and the UI layer is where human-friendly rendering happens.

The analogy is how `git log --format=json` doesn't exist but git GUIs parse git's output anyway — except here the command itself controls the schema and the renderer can be co-designed. Commands would declare their output schema; the UI maps command names to renderer components. The admin page or a debug panel could be the first surface.

This also helps with the bounded-output problem: a renderer can decide what to show by default and expose a "show all" control, rather than the CLI trying to guess a good human default.

### Agent "give up" mechanism

Agent writes `.callback-box/agent-failure.json` with `{ reason, phase, sessionId }` to signal it can't complete. Caller detects, reverts uncommitted changes, logs failure. Prevents half-finished work from being committed.

### Chat assistant as job dispatcher

The chat frontend's system prompt should instruct the assistant to use jobs to start tasks rather than executing them synchronously. Also provide it with docs and CLI query tools to check: what's currently running, what's scheduled to run, when something last ran.

### News brief output length

The news brief generation pipeline produces overly long output. The brief should be shorter and more concise — a quick digest, not an exhaustive report. The analyze and brief prompts (`process-news.ts`) are both very large and could use a review for conciseness.

### Automatic transcript handling in schema instructions

Several card type instructions (memo, audio, capture-session) include details about transcription handling (checking for `<transcription>`, skipping untranscribed audio, etc.). This should ideally be handled automatically by the processing pipeline rather than requiring agents to understand transcription state. The schema instructions should focus on describing the card's content and structure, not transcription machinery.

### Documentation graph — IMPLEMENTED

Implemented as `docs/doc-graph.md` (auto-generated cross-reference report). See CLAUDE.md Doc Map.

### Speech playback timing

Currently TTS speech doesn't play until the full response is complete (or at least a significant chunk). This means the "speak before doing work" pattern in the chat system prompt doesn't actually work as intended — the user hears the speech and sees the results at the same time, not speech-first. Investigate whether streaming partial speech playback is feasible so the user hears "Let me look into that" before tool calls start executing.

### Voice keyword for photo capture

Add a keyword trigger during voice input (especially the Clerk long recording mode) that captures a photo from the camera. Useful for annotating voice notes with visual context.

### Image card EXIF date extraction

When processing image cards, extract the date taken from EXIF data (DateTimeOriginal) rather than relying on file timestamps, which are unreliable after syncing/copying.

### Agent-editable UI text

The feedback confirmation messages ("Got it, I'll keep that in mind") feel like they come from a service, but they're actually queuing work for the agent. The agent can't directly respond in real-time, but it could edit a "translation file" of UI phrases to make them sound more like its own voice. This would let the agent personalize how the system communicates, even in places where it can't respond dynamically.

### Share-to-box for images and files

The iOS Shortcut share flow currently only handles URLs (opens a browser page with query params). For images, files, and plain text, the shortcut would need to POST data directly to an upload API endpoint using the "Get Contents of URL" action. The `cb create` command already supports `--attachment` and `--attachment-mimetype`, so the backend card creation works — what's needed is a simple HTTP upload endpoint (multipart POST → create card with attachment, no SSE). This would let the share shortcut accept any share sheet type, not just URLs.

### Per-user Google OAuth tokens

Currently Google connector tokens are stored per-box in a single `google.secret.json`. Any box user should be able to connect their own Google account. This means per-user token storage (e.g., keyed by email), knowing which user's tokens to use for which operations, and the OAuth callback tracking which user initiated the flow.
### Chat supplementary text — IMPLEMENTED

Updated `CHAT_SYSTEM_PROMPT` in `chat-session.ts` to describe two-channel output: `<speech>` tags for TTS, and markdown display text outside speech for visual details. Frontend already supported this (ReactMarkdown rendering + speech tag stripping).

### Chat page improvements

Several things for the chat page:

- **Image paste/capture**: support pasting or capturing images directly in the chat input.
- **Max width**: the chat page needs a max-width constraint and general layout cleanup.
- **Rich text input**: consider using TenTap (or similar) for message composition.
- **Capture-from-chat flow**: add a "Capture" item to the chat composer's `+` menu (alongside Camera and Attach file). Selecting it runs a capture session, then returns to chat with a message announcing the capture has been added — referencing what was captured, not the content itself.

### Transcript processing as labeled sub-agents

Two levels of transcript processing that map to different agent types:

1. **Cleanup transcript** (sub-agent) — canonical, well-defined task. Takes raw transcription, cleans up false starts, repetitions, filler words. Preserves original language. Input/output are both text. This can have a standard implementation that works the same way every time.

2. **Restructure into story/formatted text** (skill or procedure) — needs wide context, user preferences about voice and style, judgment about what to keep and what to cut. Not canonical — the rules depend on what Rosa (or whoever) wants. Better as a procedure with custom instructions per use case.

The cleanup sub-agent could be used directly by the inbox processor. The restructure step would be set up by the user as a procedure, possibly chained: raw transcript → cleanup sub-agent → restructure procedure → finished piece.

Key principle: the procedure should show its work. For restructuring, that means demonstrating which words are original vs. edited, with a well-aligned comparison between source and output. This makes the AI's edits auditable and keeps the result grounded in the original language.

### Accountability / goal tracking

Someone sets a personal goal — like drinking water 3 times a day, or practicing guitar — and messages the box when they do it. The box tracks check-ins throughout the day, then posts a summary to the group chat at the end of the day: did they hit their target or not? The family provides the accountability. The goal is a card, check-ins come through chat, and the end-of-day report is a scheduled procedure. Could be playful — streaks, encouragement from the box, family members commenting.

### "Show everything" Markdown mode

The `<Markdown>` component has a `showComments` prop (default off) that reveals HTML comments (`<!-- ... -->`) as styled inline text. This could be extended into a broader "show everything" toggle that exposes hidden structure in rendered documents — comments, metadata markers, processing annotations.

For card-based documents this matters less (cards have explicit schemas), but for generated Markdown (briefs, summaries, agent output), comments are a natural place for agents to leave structured annotations — source attribution, confidence notes, revision markers — that are invisible by default but available on demand. The toggle could live in a debug/detail panel or as a per-view option.

### Review all prompts

`npm run prompt-report` generates `docs/prompts.md` — a full inventory of every prompt, instruction, and rule in the system with scope annotations. Use this to review the full prompt surface area, spot inconsistencies, and identify improvement opportunities across agent system prompts, schema instructions, procedure templates, and connector rules.

### Session output critique tool — IMPLEMENTED

Implemented as `cb session <id> --tool-report` + `@session-critique` subagent. See `docs/testing.md` § Session Critiques for usage.

### Markdown cards (replacing XML)

Consider replacing card XML with Markdown files that have rich validated frontmatter (YAML). The frontmatter would carry all the structured data currently in XML attributes and elements, validated by Zod schemas just like today. The body would be Markdown instead of XML content elements.

Conventions for inline annotations could handle things like source attribution, status markers, or cross-references within the Markdown body. A `type` field in the frontmatter (or the file extension) would determine the schema, and could even indicate a non-Markdown content type for the body if needed.

Benefits: agents already write Markdown fluently, diffs are cleaner, easier to read/edit by hand, no need for the cardworks XML library. Tradeoffs: XML's strict structure prevents malformed cards — Markdown frontmatter is more loosely coupled from the body content.


### Agent "give up" mechanism

When a Claude Code agent can't complete a task, let it write `.callback-box/agent-failure.json` with `{ reason, phase, sessionId }` before exiting. The caller (wakeup cycle, procedure engine, job dispatcher) detects the marker, reverts any uncommitted changes in the box, logs the failure, and moves on. Prevents half-finished work from getting committed and masks "silent success" failures where the agent bailed without indicating it.

### Chat assistant as job dispatcher

The chat frontend's system prompt should instruct the assistant to *dispatch jobs* to start tasks rather than executing them synchronously inside the chat turn. Plus give the assistant CLI query tools + docs to check: what's currently running, what's scheduled, when something last ran. This makes long-running work feel responsive in chat (assistant reports "I've queued X", user can ask "what's running?") and keeps the chat session from holding resources.

### Voice keyword for photo capture

Add a keyword trigger during voice input (especially the Dropbox long-recording mode) that snaps a photo from the camera mid-recording. Useful for annotating voice notes with visual context — "take a picture" while dictating about something visual produces a linked photo + transcript pair.

### Image card EXIF date extraction

When processing image cards, prefer the date from EXIF `DateTimeOriginal` over file timestamps. File mtime/ctime are unreliable after syncing/copying (common with photo workflows) — EXIF is the source of truth for when the photo was taken.

## Gmail sync improvements

The current Gmail connector dedups via a `seenMessageIds` list (capped at 5000) plus a `lastPullDate` `after:` filter. The cap and the date filter interact in ways worth revisiting:

### Drop the `seenMessageIds` cap

Each ID is ~16 chars, so 100k IDs is only ~1.6MB on disk. The 5000-cap exists to keep state small, but it means a labeled set larger than 5000 would roll IDs out and re-fetch them. Removing the cap (or raising it dramatically) lets the bare `label:inbox` query also drop the date filter safely, simplifying the code and fixing the labeling-as-routing case for the unbounded fallback too.

### Detect newly-labeled messages even on the unbounded query

For the bare `label:inbox` default, the date filter is currently kept (see `buildQuery`) to bound the list call. That means labeling an old message and expecting it to flow into the box doesn't work unless the user has configured `labels` or `query`. Options: widen the `after:` window (e.g. `lastPullDate - 30d`) to catch recently-labeled older messages, or use Gmail's history API (`users.history.list`) to incrementally pick up label changes. The history API is the right answer long-term but is a bigger change.

### Garbage-collect unlabeled messages

If a message in the box loses its triggering label in Gmail (user archives it, removes the label, etc.), the box still has the inbox card and the seen ID. There's no signal back. A periodic reconciliation pass — list current matches, remove cards whose IDs no longer match — would close the loop, but needs careful design to avoid deleting cards the user has already acted on.

## Full-text + semantic search over a box

Today discovery in a box is path-based and rule-injected (great for agents, weak for humans). There's no Quick-Switcher / Cmd-Shift-F equivalent — a boxholder who wants to find a specific card has to `grep` or ask the agent. Worth borrowing the Obsidian-style read surface even though writing remains agent-driven.

Prior art: `~/src/ske/ske/src/index/search-index.ts` uses **[Orama](https://github.com/oramasearch/orama)** (`@orama/orama` + `@orama/plugin-data-persistence`) — pure-TS in-process search with both full-text and vector modes. Single binary index file on disk (`search.msp`), restore-from-file on startup, no external service. The ske schema indexes `{ path, kind, name, content, contentHash, embedding: vector[512] }` and exposes `textSearch` + `vectorSearch` with `pathPrefix` / `kind` filters.

What ske did that transfers well:

- **Per-tag indexing for XML** — `extractSearchableTags` walks the XML tree and emits one document per tag-path (`/recipe/ingredient`, `/recipe/step`). Lets search hit specific structural locations, not just whole files. Same pattern works for cards.
- **Markdown section indexing** — `extractMarkdownSections` splits docs by header hierarchy. Useful for guides and generated docs.
- **`contentHash` field** — lets reindex skip unchanged documents.
- **Excerpt generation** around the matched term for result display.

Why this is a good fit for callback specifically:

- Typed cards mean the index schema can include `kind` for first-class filtering by card type.
- Refs already give us a graph; pairing it with text/vector search would close most of the human-discovery gap identified vs. Obsidian (Quick Switcher, Cmd-Shift-F, Omnisearch-style ranking).
- Vector search on uplifted card text would catch "I'm looking for that thing about X" queries where the user doesn't remember the exact wording.
- Index lives in `.callback-box/` (already gitignored), rebuilt by `cb init` or incrementally on commit.

Shape of the work:

1. `cb search "query"` CLI — text + path/kind filters, excerpt output.
2. Web UI Cmd-K palette over the same index.
3. Optional: an MCP tool or `cb search` invocation surface for the agent itself, useful when "what cards mention X?" beats `grep` (synonyms, partial matches, ranking).
4. Embedding generation can be lazy / opt-in (cost) — start with text-only.

Not urgent. The agent doesn't currently need it (path conventions + rules cover its discovery), and humans get by with the chat assistant. But it's a high-value, low-risk addition when human direct-browsing becomes a friction point.

Another option worth looking at: **mempalace** — <https://github.com/mempalace/mempalace> — framed as a memory-palace tool but effectively a search/recall surface over arbitrary notes. Different ergonomics from Orama-style index search; worth a side-by-side if/when this work lands.

## Backlinks surface ("what links here?")

Cardworks already exposes the ref graph — `findIncomingRefs(targetPath)` and `findOutgoingRefs(sourcePath)` in `cardworks/src/loader/loader.ts`. The data exists; no read surface does. Obsidian's Backlinks pane is widely considered its most-used navigation surface, and we have a richer (typed, versioned, fragment-addressable) reference model — closing the UI gap is mostly plumbing.

Sources to merge into one "incoming" list:

1. **Formal refs** — `ref=""` and `refs=""` attributes on any element. Already indexed. Includes version + fragment, so a backlink can say "Recipe.card references this @1.0.0 at `//step[@id='saute']`".
2. **Markdown links in card text** — `[label](path/to/Other.card)` written in prose-typed elements (memos, notes, guides). Not currently part of the ref graph. Need a markdown-aware extractor that resolves relative paths against the source card's location and emits virtual references. Worth detecting both `.card` targets and links to non-card files (images, attachments) so attachments can also answer "where is this used?".
3. *(Optional, later)* **Unlinked mentions** — Obsidian-style: scan card text for plain occurrences of other cards' names/aliases that aren't yet linked. On uplift, the agent can be prompted "this memo mentions 'Jane' — should I `ref` her person card?" — same affordance as Obsidian's one-click promotion, but agent-mediated rather than UI-button.

Surfaces:

- **Card detail view** — a "Referenced by" panel listing incoming refs with source card name, kind, and the structural location (XPath fragment or element type). Group by source kind.
- **`cb refs <card>`** CLI — `--incoming` / `--outgoing`, JSON or table output. Useful for agents during cleanup ("is this card still referenced anywhere?") and humans during direct inspection.
- **Pre-delete check** — before `cb rm`, surface incoming refs so the user/agent knows what will dangle. Cardworks already updates refs on `cb mv`; delete should at least warn.

Combine well with the search feature above: search results that include a backlink count give a quick "popularity" signal for which cards are central to the box.

**Show the version each backlink pins.** Refs carry a version (`@1.0.0`), and the design stance is that those versions should be preserved — a ref captures what the linker meant *at link time*, not whatever the target looks like now. So the backlinks panel should visually distinguish refs to the current version from refs to older versions, and clicking through to an old-version ref should display the historical card content (from git) rather than silently substituting current. See the addressability section below — same principle.

Not urgent for the same reason as search — the agent navigates by path conventions and the user navigates via chat. Becomes important once humans start browsing cards directly, or once we want the agent to do graph-aware reasoning ("clean up cards with no incoming refs older than 90 days").

## Addressable URIs for cards, elements, and versions

Goal: every card, every addressable element inside a card, and every version of either should have a stable URI that can be pasted anywhere — emails, calendar events, chat assistants, other cards, external scripts — and resolved by the callback web UI.

Shape:

```
https://box.example.com/<box>/<path/to/Card.card>[@<version>][#<fragment>]
```

Where `<fragment>` follows cardworks' existing scheme (`id`, `query(xpath)`, `query-all(xpath)`).

The design stance is **historical truth over current validity**:

- Path rewrites on `cb mv` continue to be applied to existing refs — that preserves identity, which is the right move.
- Version pins are sacred — a URI with `@1.0.0` should always resolve to that version's content, served from git history if the live card has moved past it. The web view shows a banner "viewing version 1.0.0; current is 1.2.0" with a link to current.
- An unversioned URI resolves to current (the common case).
- An invalid version (deleted, garbage-collected) shows a clear "version no longer available" rather than silently substituting.

This sidesteps the Obsidian failure mode where `[[Note]]` always resolves to current and link intent decays as notes evolve.

**Prerequisite work**: version semantics need to be deliberate again. Card root-tag versions got lazy after the ske era — for URI version pinning to be meaningful, versions need to change on meaningful events (schema-incompatible change, significant content revision) rather than be noise or always-1.0.0. Worth a deliberate pass on what bumps a version, who does the bumping (agent at edit time? schema-driven?), and how garbage collection interacts with the "every old version is addressable" promise (it probably means *never* GC versions referenced by any live ref).

No `callback://` URI scheme needed — plain `https://` does the job and works across email, calendar, external apps, and chat without any handler registration.

## Cmd-K: document-scoped fast chat

The web UI gets a Cmd-K palette that's not really a "command palette" in the Obsidian sense — it's a **lightweight chat session scoped to the current document**, backed by a fast/cheap model (Haiku). Distinct from the main chat assistant (which is cross-context, agentic, can dispatch jobs).

Use cases:

- "find me the section about X" — jumps within the current card or across a small surrounding set
- "open the recipe Jane sent me last week" — quick navigation
- "summarize this" — local summary, no work dispatched
- "what does `<fragment>` mean here?" — schema-aware explanation of a card element
- "what links to this?" — backlinks query, surfaced inline

The cheap-model choice keeps latency in the keyboard-shortcut tier and cost negligible enough to leave it always-on. It resolves the "is this a command palette or a chat?" tension by collapsing it: a Cmd-K palette where the input is natural language and the affordances are navigation + Q&A about what you're looking at.

## "Today" view as a recurring procedure

Rather than build a hardcoded "today" page like Obsidian's daily notes, make it a procedure that emits a `daily-digest` card each morning. Aggregates whatever the boxholder configures: today's calendar, recently arrived inbox, jobs run overnight, the latest news brief, fresh commits. Renders as a regular card with the box's existing view machinery — no special UI path.

Optional / opt-in during initial box setup, edited like any other procedure. Fits the agentic-composition model: today-view isn't a feature, it's a pattern. Different boxes want different aggregations (a hearth box vs. a research box vs. a family box) and the procedure form lets them differ without core changes.

## iOS share-sheet capture (PWA + Shortcuts)

Both routes avoid needing a native iOS app, which avoids Apple's developer fee, App Store review, and the IAP question entirely.

**Primary**: register the box web UI as a PWA with `share_target` in the manifest. When a user adds the PWA to their home screen, callback shows up as a share destination from any iOS app — Photos, Safari, Voice Memos, etc. Worth verifying current iOS Safari support before committing; share-target support has historically been partial and behind Chrome's. Test on a real device with iOS 17+ before promising the workflow.

**Fallback**: an iOS Shortcut that POSTs to the box's capture endpoint. Five-step setup, no app required, supports any input type the Shortcut can produce. Worth shipping a pre-built Shortcut file users can install in one tap, plus a `docs/ios-shortcut.md` walkthrough.

Either route gives the boxholder one-tap capture from anywhere on iOS — the input-surface gap with native apps largely closes without callback ever entering the App Store.

## Canonical wisdom corpus (in lieu of plugins)

Obsidian's plugin ecosystem solves "how do I extend the tool to do X?" by letting any developer publish installable code. In an agentic system the question is different: the agent can already compose primitives, so the missing piece isn't *code* but *knowledge* — what's a good way to track books? How do recipe collections usually get organized? What's the right schema shape for a CRM-lite?

The proposed analog is a **Wikipedia-shaped corpus of canonical knowledge** the agent consults when the boxholder expresses intent. Not installable, not executable — just documents (probably cards themselves) describing patterns, conventions, and design considerations for common goals. The agent reads, then assembles primitives within the box accordingly.

Properties this would want:

- **Browsable by humans** as well as agents — the boxholder can read "how people structure book tracking" and decide they want a variant.
- **Versioned and stable** — older boxes referencing older guidance shouldn't see it silently rewritten.
- **Collaborative / curated** — a shared remote (or set of remotes) rather than per-box, so wisdom accumulates across the user base.
- **Discoverable on intent** — when a user asks for X, the agent searches the corpus and surfaces relevant entries; the user can override or extend before the agent commits to a build.

Long horizon. The minimum viable version is just a `docs/patterns/` directory inside callback-box itself with a handful of curated examples, surfaced to the agent via the existing rule system. The maximum is something like a federated wiki of agentic-design patterns across many systems. Worth flagging now so the architecture doesn't accidentally foreclose it (e.g., by hardcoding patterns into core rather than treating them as content).

## Filed for later: redraw

<https://wcandillon.github.io/redraw/> — no obvious use case in callback today, but worth remembering exists if we ever want richer visual / hand-drawn rendering in the UI.

## Filed for later: mado

<https://github.com/akiomik/mado> — fast Rust Markdown linter, CommonMark + GFM, ~50x faster than markdownlint. We already lint markdown, so this is mostly a speed win. Caveats: probably doesn't help with the link-checking we care about, and unclear whether either our current linter or mado understands Markdoc (which we plan to adopt).

## Fancier PDF manipulation

If we ever want richer PDF handling than scan-import currently does — form-field detection, structured extraction, layout-aware parsing — `commonforms` looks worth a look.

- <https://github.com/jbarrow/commonforms>
- HN discussion: <https://news.ycombinator.com/item?id=47984675>
