---
title: "Agent feedback as doc cards"
status: active
workstream: feedback-as-cards
issues:
  - ../../../issues/exploration/2026-09-16-feedback-as-a-card-location.md
  - ../../../issues/bugs/2026-08-12-bbx-feedback-rejects-its-own-transcript.md
---
# Agent feedback as doc cards

When a box agent notices friction in Bee Box tooling, it writes an ordinary doc card in `_config/feedback/`. The card carries a title, evidence, and relevant context. Review still treats the directory as an inbox.

**Issues addressed:** `2026-09-16-feedback-as-a-card-location`; `2026-08-12-bbx-feedback-rejects-its-own-transcript` (the transcript embedding path ends). The collection-cadence and introspectable-storage issues remain separate.

## Smallest fix and budget

Use `.doc.card`, remove `bbx feedback`, teach the agent to write a card, adapt the collector, and migrate old files. Estimated source and test churn: 600–900 changed lines. Authored docs and audits: roughly 250 lines. No new schema or service.

## Stated preferences this plan trades against

The boxholder chose doc cards and written context over automatic transcript capture in this session. This preserves the request to make feedback a location, at the cost of verbatim automatic context. `beebox/CLAUDE.md` says *“Work only on the requested problem”*; collection cadence and a general observation taxonomy remain outside this work.

## What already exists

- `src/schemas/doc.tsx:4`: *“The minimal ‘I have a document with a title and a body’ card.”* Reuse it for agent prose.
- `src/schemas/feedback.tsx:39`: `cardSchema("feedback", …)` requires `target`, `source`, and `timestamp`. Keep its boxholder-response meaning.
- `src/core/agent-guide/commands.ts:20`: the guide now directs agents to `_config/feedback/` doc cards; it previously named the command.
- `feedback-review/collect.ts:32`: `isFeedbackFilename` recognizes doc cards and legacy timestamped Markdown.
- `src/cli/commands/session.ts:145`: `bbx session` remains available for an agent to look up context when useful.

## Prior art (external)

No external premise governs this change. The repository's existing card and migration contracts decide the format.

## Ontology

- **Agent observation:** prose by a box agent about Bee Box friction. Identity is its card path under `_config/feedback/`; the directory is its queue, and its Markdown body can link earlier cards. New storage is `.doc.card` (`src/schemas/doc.tsx:15`).
- **Boxholder feedback:** a response to a surfaced question or card fragment. Identity is its `.feedback.card` path and `target.ref`; it remains a different noun (`src/schemas/feedback.tsx:39-47`).
- **Session context:** selected evidence in an observation's body, authored by the agent. A session ID may point to a native transcript (`src/cli/commands/session.ts:145`). It is not an automatically selected transcript dump.
- **Resolved observation:** the same file moved under `_config/feedback/resolved/`; the move and Git commit are the review action (`feedback-review/collect.ts:171-190`).
- **Legacy observation:** timestamped `.md` produced by the old command. Migration converts both unresolved and resolved files; the reader accepts it during rollout.

## Tracks / scope

1. **Agent writing path.** Remove command registration and teach a short `.doc.card` example in the agent guide. Install a nested `_config/feedback/CLAUDE.md` for guidance while working in that directory. The agent writes a title, observation and relevant context, links related cards, then commits normally. A session ID is included only when known; never guess the latest session. First chunk: update guide and remove the command.
2. **Reader.** Find doc cards directly inside each `_config/feedback/`, excluding `resolved/` and directory docs. Keep legacy filename recognition during migration, but require the box migration before resolving a legacy note; its raw transcript whitespace can fail the move's commit hook. Treat unexpected files and read/remote errors as visible scan failures. Resolve doc cards through the existing card move operation, which rewrites inbound refs and commits affected paths. First chunk: collector update and focused fixtures.
3. **Stored data.** Register one append-only script migration. Convert every legacy timestamped file under both feedback and resolved directories to a `.doc.card` sibling. Preserve the observation and context in the body, remove the redundant absolute `Box path` line, rewrite paths under that box root as box-relative paths, shorten other machine-home prefixes to `~/` with a visible note, normalize trailing whitespace that made moves fail lint, and derive a title from its feedback section or filename. Refuse a destination collision. First chunk: migrator plus isolated-box run.

## Could this be simpler?

The smallest change is to tell agents to write doc cards and leave the old collector and files alone. That would hide every new item from review. A middle version would extend the reader and leave all old Markdown in place. It would keep two on-disk meanings in the same directory indefinitely, including resolved archives and their lint failure. The one-shot migration gives both active and resolved observations the same card representation while the reader accepts both during rollout.

## Subplans

None. The format and two product decisions are settled.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Collector sees a non-item Markdown doc | Focused reader test | Recognize legacy pattern or `.doc.card` only; flag other candidates | Clear |
| New card is absent from review | Focused reader test | Scan exact directory for `.doc.card` | Clear when expected directory has only unrecognized files |
| Remote scan fails | Focused reader test | Return nonzero with error | Clear |
| Migration meets duplicate destination | Migration test | Refuse and leave source | Clear |
| Resolution moves a card linked by later observations | Collector test | Use the card move operation to rewrite inbound refs | Clear |
| Resolution is requested for legacy Markdown with raw transcript whitespace | Collector test | Stop before moving; require the registered migration | Clear |
| A doc-card move or commit fails after changing files | No induced-failure test | Stop the sweep and report the box and CLI error; inspect partial changes before retrying | Clear, manual repair |
| Legacy body has trailing spaces | Migration test | Trim trailing whitespace per line | Clear |
| Legacy context names a file under the box by machine path | Migration test | Rewrite the known box-root prefix to `/` | Clear |
| Legacy transcript contains a machine path outside its box | Migration test | Shorten the home prefix to `~/` and append an explanation | Clear |
| New observation quotes an absolute path | Knowledge audit | Guide tells the agent to write box-relative paths | Clear through card validation |
| Agent picks `.feedback.card` | Knowledge audit | Guide states distinction and example | Clear in audit |

## Agent-flow / user-flow edge cases

- **Wrong type:** addressed by guide and knowledge audit; use `.doc.card` for observations.
- **Stale ref:** resolution must use the existing card move operation to rewrite inbound links before committing. A failed move is reported for repair.
- **Two agents writing:** separate filenames and ordinary Git commits; collisions are surfaced by Git.
- **Hand-edit drift:** doc schema validates title and body.
- **Fabricated session ID:** guide says omit it unless known and verified.
- **Validation error UX:** normal card validation shows schema errors.
- **Partial migration:** reader handles both shapes until sweep completes. `issues/deferred/2026-09-21-remove-legacy-feedback-reader.md` removes legacy recognition after all boxes have the manifest entry.

## NOT in scope

- The existing `.feedback.card` schema and user response workflow stay as they are.
- A general observation taxonomy or schedule for collection needs a separate decision.
- No transcript lookup helper or background capture is added.

## Open design questions

None for the first implementation chunk. The boxholder approved the type and context decisions.

## Knowledge audits

Replace command-specific audits with direct-knowledge and behavioral checks: agent explains the directory/type distinction and creates a doc card with relevant context. Audit the nested guide from `_config/feedback/` as well. Run the filtered audits against the isolated test box and record the result.

## What will hold this after it ships

Focused collector and migration tests verify recognition, resolution, and data preservation. A knowledge audit checks the agent's actual writing path. `pnpm test:changed`, typecheck, and lint cover surrounding code. No new test tier.

## Implementation order

1. Agent guide and CLI removal.
2. Collector transition reader and diagnostics.
3. Migration and isolated-box proof.
4. Knowledge audits, selected tests, cross-model review, corrections, and worktree commit.

## Rollout shape

The script migration is deterministic and idempotent, using the migration harness. Dry-run and apply it on the isolated box clone, then validate and inspect the manifest. The collector accepts old and new shapes during rollout; `issues/deferred/2026-09-21-remove-legacy-feedback-reader.md` names the convergence check and cleanup paths. Worktree commits do not deploy; landing waits for a separate finish request.
