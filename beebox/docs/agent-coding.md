# Agent coding, and the checks around it

Part of [how development happens here](development-process.md). See also
[the development workflow](development-workflow.md), [testing what agents know
and do](agent-testing.md), and [technologies and AI services](technologies.md).

## Agent coding

This codebase is written by coding agents, under one maintainer's direction, in
two families: Claude Code and Codex. The agents do the typing. The human decides
what gets built, reviews the plans and the prose, and lands the work.

The instructions those agents read are checked into the repository. `CLAUDE.md`
files carry the working rules, `code-style.md` and `frontend.md` the coding
contracts, `.claude/skills/` the task workflows. A generator mirrors all of it
into `AGENTS.md` files and symlinked skills so Codex reads the same material;
edit the sources, never the mirrors. They are maintained as part of the work:
when a correction exposes missing durable guidance, a short rule goes to the
narrowest accurate owner.

The two families review each other. For anything beyond a small-scope bug fix,
the root instructions require a cross-model review before the work is called
done. The `cross-model` skill runs a read-only reviewer from the other family:
Claude's work is reviewed by Codex, Codex's by Claude. The reviewer supplies
evidence; the driving agent adjudicates it and surfaces what it did not fix.

## Strictness and checks

The dial is up by default. The tsconfig is strict and `any` is banned, as is
bare `catch {}`. A broken invariant gets a hard failure rather than a fallback.
`as` assertions are treated like Rust's `unsafe` and are lint-banned. Defense
concentrates at real boundaries; interior code trusts its types. The rules
behind each of these live in [code-style.md](../code-style.md).

Lint rules are never weakened to make code pass. The one sanctioned suppression
is a single `// eslint-disable-next-line <rule> -- <justification>` for a true,
narrow false positive.

Noisy output is treated as a bug. Warnings, deprecations, and ignored-build
lists cost agent context every time they appear, so the cause gets fixed rather
than the message hidden. Moving noise to stderr does not count.

Commits go through hooks, and `--no-verify` is not used. Pre-commit runs
typecheck and lint for code changes. Every commit, docs-only ones included, runs
`doc-check` for broken documentation references, `path-leak-check` against real
home-directory paths, and an opt-in personal blocklist check.

One rule overrides the rest. When an agent works on a real box, with real
content rather than a test clone, nothing learned there enters this repository
until the maintainer has scrubbed and approved it: not an issue, not a commit
message, not a test fixture. Structural facts are the exception.
