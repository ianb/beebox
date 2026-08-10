---
title: "CLI Design for Agents"
workstream: unknown
needs: [design]
area: callback-box
---

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
