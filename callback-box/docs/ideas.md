# Ideas & Planned Features

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

## Drop the `resolveSessionLogPath` migration

`src/core/chat-session-history.ts` `resolveSessionLogPath` exists only to migrate landmark-bound session JSONLs from the pre-`e440586` box-root path to the new cwd-encoded path on first read. It's a transitional shim: every box where every existing landmark session has either been touched once (migrating) or expired/forgotten can drop it.

Removal:
- Delete `resolveSessionLogPath` and the `existsSync`/`getSessionLogPath` imports it adds.
- Revert the four call sites (`chat-session.ts` `getHistory` + the migration call in `startRun`, `routes/chat.ts` ×2, `routes/history.ts`, `trpc/routers/history.ts`) back to `getSessionLogPath(boxRoot/cwd, sessionId)` directly — they need to pass the cwd-encoded path now (i.e. `path.join(boxRoot, contextDir)` when contextDir is set).

Trigger: when no live boxes are still running landmark sessions started before `e440586` (Sun May 10 2026). Safe to remove once the only remaining sessions in `chat-session-history.json` were created after that date, or when we're willing to break resume on the stragglers.

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

The feedback direction (agent reports CLI friction upstream) is genuinely new — there's no pipe equivalent for that. Worth thinking about separately from delivery.

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

Not urgent for the same reason as search — the agent navigates by path conventions and the user navigates via chat. Becomes important once humans start browsing cards directly, or once we want the agent to do graph-aware reasoning ("clean up cards with no incoming refs older than 90 days").
