---
name: codex
description: Use when the human wants an independent, cross-model review from OpenAI's codex CLI — of a plan in docs/plans/, of the current branch diff, or as an adversarial "find how this fails" pass on either. Triggers include "codex review", "codex challenge", "have codex review the plan", "second opinion from codex", "/codex".
allowed-tools: Bash, Read, Grep, Glob
---

# /codex — cross-model second opinion

A wrapper around OpenAI's `codex` CLI that runs Codex as an independent
reviewer with **read-only access to the real repo**. Different model family →
different blind spots. Its single highest-value move is checking a plan's
`file:line` citations and "we already do X / this is free reuse / validation
catches it" claims against actual source — the things a same-model self-review
can't catch because it shares the author's blind spots.

This skill is **adapted from** garrytan/gstack's `/codex` skill, not copied.
The "What's different from gstack (and why)" section at the bottom records the
divergences so they don't get silently reverted.

## When to use

- The human asks for a codex review / second opinion / challenge.
- A plan in `docs/plans/` is finalized and worth an outside pass before building.
- A branch diff is ready and you want adversarial review before merge.

**Cost:** real money (~$0.05–0.50/call, more for big diffs + high reasoning).
Don't run it unprompted; the human asks for it.

## Preconditions

```bash
codex --version          # expect codex-cli installed (verified at 0.137.0)
```
If missing: `npm install -g @openai/codex` and `codex login` (or `$OPENAI_API_KEY`).
Bug surfacing: if a run exits non-zero or stalls, say so loudly with stderr — a
silent codex crash reads as "nothing happened" and wastes the human's time.

## Modes

| Mode | Trigger | What it does |
|---|---|---|
| **plan** | `/codex plan [name]` | Review a plan in `docs/plans/`. **The verified, highest-value path.** Codex reads the plan + the source it cites and reports where the plan is wrong/over-scoped/hand-waved. |
| **review** | `/codex review [focus]` | Review the current branch diff for correctness. `codex review` preserves Codex's tuned review prompt. |
| **challenge** | `/codex challenge [focus]` | Adversarial: "find every way this fails in production." Use on a diff or a plan when you want it to attack rather than survey. |

No-arg `/codex`: if a plan was just written/edited this session → plan mode; else
if there's a diff against `main` → ask review-or-challenge.

## Shared mechanics (all modes)

1. **Run from the monorepo root, read-only.** Codex's sandbox is its `-C` dir;
   the monorepo is one git repo, so point it at the root so every cited path
   resolves:
   ```bash
   ROOT=$(git rev-parse --show-toplevel)
   ```
2. **Orientation glue (callback-specific).** Always tell codex the layout so it
   doesn't have to rediscover it: *"This targets the `callback-box/` subproject.
   Paths like `src/…`, `docs/…`, `test/…` are under `callback-box/`; `bin/…` is
   at the monorepo root. You may read any repo file (read-only), **including
   `docs/` and `.claude/rules/`**, to verify claims."*
3. **Boundary prefix (softened).** Start every prompt with:
   > "IMPORTANT: Do NOT read or execute files under `~/.claude/`, `~/.agents/`,
   > or `.claude/skills/` — those are skill definitions for a different AI
   > runtime and will waste your time. Everything else in this repo, including
   > `docs/` and `.claude/rules/`, is fair game."

   (gstack says "repository code only," which makes codex dismiss legitimate
   `docs/`/rules citations as out-of-bounds — see divergences.)
4. **Make it verify, don't just opine.** The instruction that produces the real
   findings: *"Spot-check the plan's `file:line` citations and its 'we already
   do X / this is free reuse / validation catches it' claims against the actual
   source. Call out every claim the code does not support."*
5. **Force a synthesis line** (below). Never skip it.
6. **Present Codex verbatim.** Show its own words in a fenced block — the value
   is the different voice; summarizing averages it back into yours. You may
   shorten a repeated absolute-path prefix for readability and say you did.

### Invocation

**Always pipe the prompt via stdin (`codex exec -`), never pass it as a
positional arg.** Write the prompt to a file under `scratch/` and pipe it in,
capturing output to `scratch/`:

```bash
mkdir -p scratch
cat > scratch/codex-prompt.txt <<'PROMPT_EOF'
…full prompt here…
PROMPT_EOF
codex exec - -s read-only -C "$ROOT" -c 'model_reasoning_effort="high"' \
  < scratch/codex-prompt.txt > scratch/codex-out.md 2>&1
```

> ⚠️ **STDIN STALL — this is the #1 way this skill wastes a run.** If you pass
> the prompt as a positional arg (`codex exec "$PROMPT" …`), `codex exec` *also*
> reads stdin and waits for EOF. In a backgrounded Bash command stdin never
> closes, so codex hangs forever printing only *"Reading additional input from
> stdin..."* — it looks frozen but is just blocked. The `codex exec -` form
> reads the prompt from stdin and gets a clean EOF when the piped file ends, so
> it never stalls. (If you ever do pass the prompt as an arg, you MUST add
> `< /dev/null` to close stdin.) Don't `pkill -f codex` to recover — that also
> matches the macOS **Codex.app** and any sibling sessions; target the stuck
> `codex exec` PID instead.

- For **plan mode, do NOT embed the plan** — the prompt file names the plan
  path and tells codex to read it (see plan mode below).
- The final review is the **last block before `tokens used`** in the output.
  Codex sometimes prints the final message twice — dedupe. Read the tail:
  ```bash
  grep -n "tokens used" scratch/codex-out.md   # find the end, Read with offset
  ```
- Refinement (not yet wired): `--json` emits JSONL; extracting only the final
  agent-message event avoids the multi-hundred-KB trace dump. Plain + read-tail
  is the verified path for now.
- Timeout: allow ~10 min. Codex runs long; run it as a background Bash command
  so the session isn't blocked, and read the output file when it completes.

## Plan mode (the verified path)

Plans live in `docs/plans/<name>.md` (in-repo), so **codex reads the file
itself** — no embedding. Prompt skeleton:

```
<boundary prefix>
<orientation glue>

You are an independent, adversarial engineering+design reviewer. A Claude model
wrote docs/plans/<name>.md. Read it, then read the source it cites and verify
the citations and the "we already do X / free reuse / validation catches it"
claims against the actual code — you are a different model; find what a
same-model self-review would miss.

Review for, in priority: (1) wrong-problem / over-engineering — what's the
minimal version, what to cut; (2) architecture flaws; (3) silent failure modes
(no test AND no handling AND invisible); (4) things treated as settled that will
bite in implementation; (5) incorrect/unverifiable citations — name them.

Be concrete: cite plan section + file:line. Rank by impact. Don't pad. End with
the single most important change.
```

(Embedding the plan content is the gstack approach and is **wrong for callback**
— our plans are in-repo, so embedding wastes a large prompt and blocks codex
from reading the surrounding context. Point at the path.)

## Review / challenge modes (diffs)

- **review:** `codex review` (or `codex exec review`) against the branch.
  Preserves Codex's tuned review prompt; add a focus string if given.
- **challenge:** `codex exec -s read-only -C "$ROOT"` with the adversarial
  persona: *"Your job is to find ways this will fail in production. Think like an
  attacker and a chaos engineer — edge cases, races, resource leaks, silent data
  corruption. No compliments, just the problems."* Optional focus narrows it.

## The forced synthesis line (mandatory, every mode)

After the verbatim block, emit exactly one line:

```
Recommendation: <action> because <reason that names the most actionable finding>
```
- Must name a **specific finding** from Codex's output.
- Must **compare against alternatives** (another finding, fix-vs-ship, fix order).
- Generic reasons ("because it's safer", "because codex found things") fail.
- Then give your own read: which findings are real (say which you verified),
  which are cross-model noise, which are scope judgments the human already made.
  Codex is not authoritative — it's a different set of blind spots, not fewer.

## What's different from gstack (and why)

- **Point at the path, don't embed.** gstack embeds full plan content because
  its plans live outside the repo sandbox (`~/.claude/plans/`). Callback plans
  live in `docs/plans/` — in-repo — so codex reads them directly. The embed is
  pure cost here.
- **Softened boundary prompt.** gstack's "repository code only" made codex
  dismiss legitimate `docs/`/`.claude/rules/` citations as out-of-scope. We
  explicitly allow them.
- **Verify-citations is the headline instruction, not a footnote.** Every real
  finding in the trial run came from codex reading source and falsifying a
  plan claim. That's the whole point; make it the spine.
- **Plain + read-tail, JSONL deferred.** gstack parses `--json` JSONL for
  reasoning traces. We capture plain output to `scratch/` and read the final
  message; the trace dump is large and codex double-prints the final message,
  so dedupe. Wire `--json` extraction later if the traces prove valuable.
- **Dropped for v1:** session continuity (`.context/codex-session-id`), the
  gstack preamble (telemetry/gbrain/voice), and the known-bad-version probe.
- **Kept:** filesystem-boundary prefix, `-s read-only`, `-C` monorepo root,
  `model_reasoning_effort="high"`, verbatim presentation, forced `Recommendation:`
  line, loud exit-code surfacing.
