---
title: "The codex skill is a same-model no-op from a codex session — and gives false cross-model confidence"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder noticed while landing codex worktree parity
---

The `codex` skill (`.claude/skills/codex/`) runs OpenAI's codex CLI to get an
**independent cross-model review** — a different model family than Claude, so it
catches blind spots a same-model self-review structurally cannot. That is the
whole point (root CLAUDE.md: "Get a Codex (cross-model) review of anything that
isn't a small-scope bug fix … a same-model self-review structurally cannot").

Now that codex workers exist (`bin/launch-worktree-session --agent codex`), the
skill is mirrored into `.agents/skills/` and a codex worker can invoke it as
`$codex`. From a codex session that is **codex reviewing codex** — same model
family, same blind spots. Worse than useless: it produces a review that *looks*
like the mandated cross-model check, so it manufactures false confidence. And the
CLAUDE.md instruction "get a Codex review before declaring done" is now actively
wrong for a codex author — its cross-model reviewer is **Claude**, not Codex.

## Two parts

**(a) Immediate guard — don't let the codex skill run from codex.** Cleanest:
exclude the `codex` skill from the skill mirroring in
`bin/generate-agents-md.ts` `generateSkillLinks` (so `$codex` never exists for a
codex worker) — AND exclude it from the launcher's skill-mirror verification loop
in `bin/launch-worktree-session` (that loop fails closed on any tracked skill
lacking a mirror, so a bare exclusion would refuse to launch). An alternative is a
self-guard inside the skill that detects a codex host and refuses, but not
mirroring it is simpler and keeps `$codex` off the codex worker's menu entirely.

**(b) The real need — codex workers need a cross-model reviewer too, and it is
Claude.** There is no "claude review" skill today. Decide whether to build the
reverse path: a skill that runs `claude -p …` (headless) to get an outside,
adversarial review of a codex worker's plan or branch diff — the mirror image of
what `codex` does for Claude workers. Until it exists, a codex worker's
review step should route to the parent Claude session (done manually for the
annex-trash-remnants hand-off). The generated Codex preamble / AGENTS.md guidance
should also say "your cross-model reviewer is Claude, not Codex" so a codex worker
doesn't read the CLAUDE.md "get a codex review" line literally.

## Related

- `callback-box/docs/implemented-plans/codex-worktree-sessions.md` — the codex
  worktree feature this is a gap in.
- The skill-mirroring + verification loop landed in the codex finish/merge parity
  change (bin/generate-agents-md.ts, bin/launch-worktree-session).
