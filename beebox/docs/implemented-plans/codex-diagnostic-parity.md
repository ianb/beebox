---
title: "Provider-aware agent diagnostics"
status: implemented
workstream: codex-engine-plan
issues: []
---

# Provider-aware agent diagnostics

When an agent runs inside a box through Claude Code or Codex, it needs the same
Bee Box diagnostic commands to inspect its supported conversation history and
attach useful context to feedback. This plan removes the remaining Claude-only
assumption from the readable `bbx session` path and from `bbx feedback`.

## Stated preferences this plan trades against

- Engineering principle 1, **Types are structure**. Provider selection is an explicit
  `AgentEngine`, not an inferred transcript shape.
- Principle 3, **Validate at boundaries and during parsing**. Native Codex history
  continues through the existing app-server schema boundary.
- Principle 4, **Resilient AND never silent**. Unsupported raw and report modes fail
  with a provider-specific explanation.
- Principle 8, **One way to do each thing**. Readable Codex history reuses
  `readCodexSessionHistory`; it does not parse the private rollout store.
- Principle 10, **Testability is architectural**. Provider resolution, supported-mode
  validation, and the native cwd boundary have pure seams.
- `beebox/code-style.md` requires narrow typed boundaries and visible recovery
  paths. The implementation does not add an untyped generic transcript adapter.

## What already exists

- `src/core/chat/session/codex-transcript.ts` adapts supported `thread/read` results to
  `SessionEntry`. This plan reuses it for readable diagnostics.
- `src/core/chat/session/history.ts` stores the engine that owns each web-chat session.
  This plan uses that record when an explicit session belongs to web chat.
- `src/cli/commands/session-render.ts` renders provider-neutral `SessionEntry` values.
  This plan reuses it without a second renderer.
- Codex exports `CODEX_THREAD_ID` to commands that it runs. Claude exports
  `CLAUDE_CODE_SESSION_ID`. This plan treats these as the native current-session
  identities.
- `src/cli/commands/feedback.ts` already falls back to the newest Claude transcript
  when the Claude environment variable is absent. That fallback remains Claude-only
  because Codex app-server has no callback-owned meaning for “newest unrelated native
  thread.”

## Prior art (external)

The relevant Codex contract was verified by the engine capability probe and generated
app-server protocol used by the shipped adapter. `thread/read` supplies supported
conversation history but not a raw native rollout. No external abstraction is needed:
the product already owns the small boundary this change needs.

## Tracks / scope

### Track 1 — Resolve the diagnostic session owner

**What:** Resolve an explicit engine option, the current native session environment,
or a pinned web-chat history row to `claude` or `codex`.

**Why this needs to change:** An arbitrary session ID does not identify its provider.
Defaulting every unknown ID to Codex would start an app-server probe for ordinary
Claude typos, while defaulting the current Codex ID to Claude makes the command fail.

**Direction:** Add `--engine <claude|codex>` for explicit selection. Match
`CODEX_THREAD_ID` automatically. Use the pinned chat engine when present. Preserve
Claude as the compatibility default for unrecognized IDs.

**First implementation chunk:** Add and test a typed resolver for explicit session
inspection. Feedback separately prefers a resolvable Claude identity, then accepts a
Codex identity only after app-server confirms that its cwd is inside the current box.

### Track 2 — Render supported Codex history

**What:** Let the single-session readable mode load Codex `SessionEntry` values and
pass them to the existing renderer.

**Why this needs to change:** The readable command currently requires a Claude JSONL
path even though the product already has a supported Codex history reader.

**Direction:** Support explicit IDs in the normal and `--dialogue-only` modes. Reject
`--raw`, `--tool-report`, and `--full` for Codex because app-server does not expose the
native raw rollout or tool detail those options promise. Apply the existing huge-output
threshold to normalized Codex entries. Leave combined `--list`, `--latest`, and
`--since` behavior Claude-only and label their help text accordingly.

**First implementation chunk:** Dispatch the explicit single-session read after option
validation and before Claude filesystem resolution.

### Track 3 — Attach Codex context to feedback

**What:** When `CODEX_THREAD_ID` is present, read the tail of that thread through
app-server and include it in the feedback card.

**Why this needs to change:** Codex-authored feedback currently attaches the newest
Claude session, which can be unrelated and misleading.

**Direction:** Prefer a resolvable current Claude identity. Otherwise accept the current
Codex identity only when `thread/read` reports a cwd inside the current box. Use the
same bounded 12-entry context window and the same durable dialogue-only native history
that web chat uses. Ignore compaction markers in feedback context.

**First implementation chunk:** Replace the log-path-only feedback session value with
a discriminated provider-owned session source.

## Could this be simpler?

The smallest change would make `bbx feedback` recognize `CODEX_THREAD_ID` and leave
`bbx session` unchanged. That would fix incorrect feedback context, but an agent could
still not inspect the same supported context before submitting feedback. Reusing the
existing reader and renderer adds one explicit dispatch without creating a general
adapter, which satisfies principles 8 and 10.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `--engine` has an unknown value | Yes | Reject before native I/O and list valid engines. | Clear |
| An explicit session is assigned to the wrong engine | Yes | Explicit option wins; otherwise current environment and pinned history decide. | Clear |
| Codex `thread/read` fails or changes shape | Existing adapter tests | Preserve the app-server/RPC/schema error. | Clear |
| User requests an unsupported Codex detail mode | Yes | Reject and explain that the supported API omits native rollout detail. | Clear |
| A Codex thread ID belongs to another box | Yes | Reject it at the shared `thread/read` cwd boundary and fall back to Claude history for feedback. | Clear |
| Codex feedback history becomes unavailable after resolution | No | Record feedback without context and warn, as the command already does for transcript failures. | Clear |
| No native current-session variable exists | Existing behavior | Fall back to the newest Claude file for compatibility. | Declared fallback |

## Agent-flow / user-flow edge cases

- A Codex CLI agent that runs `bbx feedback` gets its own thread, not a stale Claude
  chat.
- A boxholder can inspect a known Codex thread with an explicit engine even when it is
  not a registered web chat.
- A registered web-chat ID uses its pinned engine after the box default changes.
- An unknown explicit ID keeps the historical Claude lookup and error text unless the
  caller selects Codex.
- Codex compaction markers remain non-dialogue entries and do not fabricate text.

## NOT in scope

- Raw Codex rollout parsing or exposure.
- Cross-provider `--list`, `--latest`, or `--since` aggregation.
- Codex tool-use reports. Supported app-server history omits the required detail.
- Richer live tool progress in web chat.
- A provider-neutral harness protocol or ACP integration.

## Open design questions

There are no open questions for this plan. A later plan can decide whether combined
session listing should include all native harness sessions or only Bee Box-owned
web chats.

## Knowledge audits

No knowledge audit is needed. This changes CLI behavior, not guidance that a box agent
must recall. Command help and error text expose the new option at use time.

## Implementation order

1. Add the typed provider resolver and focused doctests.
2. Add the Codex single-session readable path and unsupported-mode checks.
3. Use the resolver and supported history reader in `bbx feedback`.
4. Run focused doctests, lint, typecheck, and the relevant CLI help smoke check.
5. Obtain cross-model review before declaring the work complete.

## Rollout shape

This is a local CLI compatibility change. It needs no data migration or feature flag.
Claude behavior remains the default. Codex behavior activates only for an explicit
engine, a current Codex thread, or a session pinned to Codex in chat history.
