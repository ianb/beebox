---
name: cross-model
description: Use when the human wants an independent cross-model review — a review by the OTHER model family from whoever is working. From Claude it runs OpenAI's codex; from Codex it runs `claude -p`. Reviews a plan in docs/plans/, the current branch diff, or runs an adversarial "find how this fails" pass on either. Triggers include "cross-model review", "second opinion", "codex review", "have another model review this", "challenge this plan", "/cross-model".
allowed-tools: Bash, Read, Grep, Glob
---

# /cross-model — review by the other model family

Run an independent reviewer from a **different model family than yourself**,
with read-only access to the real repo. Different family → different blind
spots. Its single highest-value move is checking a plan's `file:line` citations
and "we already do X / this is free reuse / validation catches it" claims
against actual source — the things a same-model self-review can't catch because
it shares the author's blind spots.

## Pick your direction FIRST

You know what model you are. Branch on it — there is no detection step:

- **You are Claude** (Claude Code) → review with **Codex**. Jump to
  [Claude → Codex](#claude--codex-run-codex).
- **You are Codex** (OpenAI Codex CLI, invoked as `$cross-model`) → review with
  **Claude**. Jump to [Codex → Claude](#codex--claude-run-claude--p).

**Running the same family as yourself defeats the entire point.** A codex worker
that runs `codex` here, or a Claude session that runs `claude -p`, produces a
same-model self-review wearing the costume of a cross-model check — worse than
no review, because it manufactures confidence. If you can't run the other
family, say so and stop; don't substitute your own.

The Claude → Codex half is adapted from garrytan/gstack's `/codex` skill, not
copied. "What's different from gstack (and why)" at the bottom records the
divergences so they don't get silently reverted.

## When to use

- The human asks for a cross-model review / second opinion / challenge.
- Root `CLAUDE.md` mandates it for anything bigger than a small-scope bug fix,
  before declaring the work done.
- A plan in `docs/plans/` is finalized and worth an outside pass before building.
- A branch diff is ready and you want adversarial review before merge.

## Modes (both directions)

| Mode | Trigger | What it does |
|---|---|---|
| **plan** | `plan [name]` | Review a plan in `docs/plans/`. **The verified, highest-value path.** The reviewer reads the plan + the source it cites and reports where the plan is wrong/over-scoped/hand-waved. |
| **review** | `review [focus]` | Review the current branch diff for correctness. |
| **challenge** | `challenge [focus]` | Adversarial: "find every way this fails in production." Use on a diff or a plan when you want it to attack rather than survey. |

No-arg: if a plan was just written/edited this session → plan mode; else if
there's a diff against `main` → ask review-or-challenge.

## Shared rules (both directions, every mode)

1. **Run from the repo root that makes cited paths resolve.** The monorepo is
   one git repo: `ROOT=$(git rev-parse --show-toplevel)`.
2. **Orientation glue (callback-specific).** Always tell the reviewer the layout
   so it doesn't rediscover it: *"This targets the `beebox/` subproject.
   Paths like `src/…`, `docs/…`, `test/…` are under `beebox/`; `bin/…` is
   at the monorepo root. You may read any repo file (read-only), **including
   `docs/` and `.claude/rules/`**, to verify claims."*
3. **Fence the prompt hard.** A named read-list ("READ EXACTLY THESE files"),
   pre-verified facts it must NOT re-verify, a findings cap. For diff review and
   diff-target challenge, the [required instructions](#required-diff-review-instructions-both-directions)
   convert that closed list to a bounded first hop so the reviewer can trace
   directly relevant code. An unfenced reviewer grep-crawls the repo and burns
   its budget reading.
4. **Make it verify, don't just opine.** The instruction that produces the real
   findings: *"Spot-check the plan's `file:line` citations and its 'we already
   do X / this is free reuse / validation catches it' claims against the actual
   source. Call out every claim the code does not support."*
5. **Ground the review in the originating request, with direct human choices
   highest.** Identify the authority the work is meant to satisfy: the human's
   request and later decisions from this conversation, plus any originating
   issue/brief and attached plan. Put a short `Review authority` block in the
   prompt. Quote decisive human wording exactly where practical; otherwise
   summarize faithfully and label the summary. Point at issue/brief/plan paths
   rather than embedding their full contents. Tell the reviewer that direct
   human requirements and decisions outrank inferred intent, issue proposals,
   plan prose, and implementation choices; it must report contradictions
   against them and must not turn optional issue/plan ideas into requirements.
   If no originating request is available, say so instead of inventing one.
6. **Pipe the prompt via stdin from a file** in `scratch/`, never as a
   positional arg. Both CLIs have an argument-handling trap that punishes the
   positional form (details per direction below).
7. **Foreground, not backgrounded.** Backgrounded reviewer runs get killed
   before completing in this harness.
8. **Treat the review as working evidence, not the work-unit conclusion.**
   Adjudicate it, apply verified findings, and keep the final handoff centered
   on the actual plan or implementation. Do not append the raw review by
   default.
9. **Report only material review outcomes.** Mention findings that remain open,
   require a human choice, or materially changed the work. Collapse resolved
   findings to a short phrase when useful. If the human explicitly asked to
   see the independent review itself, provide a concise ranked summary with
   your adjudication; provide verbatim output only when they ask for raw output.
   **Never editorialize about the review's worth** — no "earned its keep,"
   "caught real issues," "proved valuable," or any other self-congratulation
   about having run it. The findings speak for themselves; running the review
   is baseline process, not an achievement to narrate (boxholder, 2026-08-15).
10. **Surface failures loudly.** If a run exits non-zero or stalls, say so with
   stderr — a silent reviewer crash reads as "nothing happened" and wastes the
   human's time.

---

## Claude → Codex (run `codex`)

You are Claude. Your cross-model reviewer is OpenAI's codex CLI.

### Preconditions

```bash
codex --version          # expect codex-cli installed (verified around 0.146.x)
```
If missing: `npm install -g @openai/codex` and `codex login` (or `$OPENAI_API_KEY`).

### Known-good invocation shape (2026-07-15 incident)

Nine consecutive runs stalled (~0.5 lines/s, timing out at any scope/effort)
before isolating the cause: the **default model `gpt-5.6-sol` was throttled on
this ChatGPT-plan account**, while `-m gpt-5.5` completed a fenced single-file
review in <7 min. It was NOT the desktop-app config (MCP node_repl, plugins,
hooks) — a stripped `CODEX_HOME` (auth.json + 2-line config.toml only)
reproduced the stall on 5.6-sol and the success on 5.5. When codex crawls with
no errors in the log:

1. Try `-m gpt-5.5` (or whatever older model the account allows;
   `gpt-5.1-codex-mini` is rejected on ChatGPT accounts).
   **When the ChatGPT account is quota-exhausted** ("You've hit your usage
   limit"), `-m gpt-5.3-codex-spark` still works — spark has its own quota
   pool (verified 2026-08-18). The bare name `spark` is rejected on ChatGPT
   accounts; use the full id.
2. Re-check the fencing (shared rule 3).
3. Kill orphaned `codex exec` processes from failed runs by PID (never
   `pkill -f codex` — it matches Codex.app and sibling sessions); orphans wedge
   the models-manager child ("timeout waiting for child process to exit").
4. A stripped `CODEX_HOME` (copy auth.json, minimal config.toml) is the clean
   isolation probe when config is suspected.

### Boundary prefix (softened)

Start every prompt with:

> "IMPORTANT: Do NOT read or execute files under `~/.claude/`, `~/.agents/`,
> or `.claude/skills/` — those are skill definitions for a different AI
> runtime and will waste your time, **unless the named review target/read-list
> is itself a specific skill file**. Everything else in this repo, including
> `docs/` and `.claude/rules/`, is fair game."

(gstack says "repository code only," which makes codex dismiss legitimate
`docs/`/rules citations as out-of-bounds — see divergences.)

### Invocation

```bash
ROOT=$(git rev-parse --show-toplevel)
mkdir -p scratch
cat > scratch/cross-model-prompt.txt <<'PROMPT_EOF'
…full prompt here…
PROMPT_EOF
codex exec - -s read-only -C "$ROOT" -m gpt-5.5 \
  -c 'model_reasoning_effort="high"' \
  < scratch/cross-model-prompt.txt > scratch/cross-model-out.md 2>&1
```

> ⚠️ **STDIN STALL — the #1 way this direction wastes a run.** If you pass the
> prompt as a positional arg (`codex exec "$PROMPT" …`), `codex exec` *also*
> reads stdin and waits for EOF. In a backgrounded Bash command stdin never
> closes, so codex hangs forever printing only *"Reading additional input from
> stdin..."* — it looks frozen but is just blocked. The `codex exec -` form gets
> a clean EOF when the piped file ends, so it never stalls. (If you ever do pass
> the prompt as an arg, you MUST add `< /dev/null`.) Don't `pkill -f codex` to
> recover — target the stuck `codex exec` PID.

- `-a never` is an interactive-`codex` flag; `codex exec` rejects it with
  `unexpected argument '-a'` and is non-interactive already.
- The final review is the **last block before `tokens used`** in the output.
  Codex sometimes prints the final message twice — dedupe. Read the tail:
  ```bash
  grep -n "tokens used" scratch/cross-model-out.md   # find the end, Read with offset
  ```
- Refinement (not yet wired): `--json` emits JSONL; extracting only the final
  agent-message event avoids the multi-hundred-KB trace dump. Plain +
  read-tail is the verified path for now.
- **Timeout: run FOREGROUND with the 10-min Bash timeout.** Codex runs long, and
  backgrounding it in this harness gets it killed before it finishes.

### Review / challenge modes (Claude → Codex)

- **review — use `codex exec -` with your own prompt, same as every other mode.**
  The scaffolding in shared rules 2–5 (orientation glue, fencing, verify-don't-
  opine, and review authority) is what makes these reviews land, and it applies
  here too. Include the `Review authority` block before asking whether the code
  is correct; an optional focus narrows the investigation but does not replace
  the originating request. Include the required diff-review instructions below.
- `codex review` (or `codex exec review`) exists and preserves Codex's own tuned
  review prompt, but it takes its prompt differently, so **none** of this skill's
  scaffolding reaches it — an unfenced repo crawl is the usual result. Reach for
  it only as a deliberate experiment, and say in your report that the review ran
  unfenced and without the required diff-review instructions.
- **challenge:** `codex exec - -s read-only -C "$ROOT"` with the adversarial
  persona (shared, below), the `Review authority` block, and the required
  diff-review instructions when the target is a diff.

---

## Codex → Claude (run `claude -p`)

You are Codex. Your cross-model reviewer is Claude Code in headless print mode.

### Invocation

```bash
mkdir -p scratch
git diff main...HEAD > scratch/cross-model-review.diff   # review/challenge modes

cat > scratch/cross-model-prompt.txt <<'PROMPT_EOF'
…full prompt here…
PROMPT_EOF

claude -p \
  --model opus \
  --effort high \
  --setting-sources user \
  --no-session-persistence \
  --tools Read Grep Glob \
  --output-format text \
  < scratch/cross-model-prompt.txt > scratch/cross-model-out.md 2>&1
```

The shell command above is a normal foreground command. **When launching it
through Codex's exec tool, a yielded tool call is not process completion.** If
`exec_command` returns a `session_id`, Claude is still running even when
`output` is empty. Preserve that ID and poll it with `write_stdin` until the
result no longer has a `session_id` and reports an exit code. If the outer tool
wrapper yields a `cell_id`, wait on that cell too. Discarding either ID detaches
the review and makes a healthy, still-running Claude process look like a blank
review.

Use this orchestration shape in Codex API sessions (field names may be exposed
by the local exec wrapper rather than directly):

```javascript
let result = await tools.exec_command({
  cmd:
    "claude -p --model opus --effort high --setting-sources user " +
    "--no-session-persistence --tools Read Grep Glob --output-format text " +
    "< scratch/cross-model-prompt.txt",
  workdir: repoWorktree,
  yield_time_ms: 30000,
});
let review = result.output;
while (result.session_id) {
  result = await tools.write_stdin({
    session_id: result.session_id,
    chars: "",
    yield_time_ms: 30000,
  });
  review += result.output;
}
```

Do not launch a replacement merely because the first yield had no output.
First inspect exact processes:

```bash
ps -axo pid,etime,command | rg '[c]laude -p'
```

If a prior wrapper really orphaned a run, terminate only its exact PID; never
use a broad `pkill` that could kill other Claude sessions.

Run it **from the worktree** (your cwd), not the monorepo root — the diff and
every cited path must be this worktree's. That is only safe because of
`--setting-sources user`; read the next paragraph before dropping any flag.

> ⚠️ **`--setting-sources user` IS LOAD-BEARING — dropping it can delete your
> worktree.** Without it the nested Claude loads this repo's
> `.claude/settings.json` and fires its `SessionEnd` hook when the review
> finishes. That hook removes the worktree, its cloned box, and its branch when
> the branch is merged and clean. Verified the hard way on 2026-08-04: a bare
> `claude -p` run from inside a worktree destroyed that worktree mid-session
> (recorded in `~/.cache/beebox/worktree-cleanup.log`). Loading user
> settings only means the project's hooks are never registered.
> (`.claude/hooks/session-end.sh` now also refuses to clean a worktree that
> still has another live agent belonging to it, and fails closed when it can't
> tell — so this is belt-and-braces. Keep the flag anyway: it stops the hook
> from running at all, which is a guard nothing can get wrong.)

> ⚠️ **`--tools` is variadic, so it eats a positional prompt.** `claude -p
> --tools Read Grep Glob "my prompt"` fails with *"Input must be provided
> either through stdin or as a prompt argument"* — the prompt was parsed as
> another tool name. Pipe from a file, as above.

Flag by flag:

- **`--model opus`** — the default, and the model for diff review. Use
  **`--model fable`** for **plan mode**: a plan review asks whether the
  *approach* is right (wrong problem, over-scoped, wrong seams across surfaces),
  which is synthesis over wide context; a diff review asks whether specific
  claims hold, which Opus does well and fast.
- **`--effort high`** — the mirror of codex's `model_reasoning_effort="high"`.
- **`--no-session-persistence`** — no transcript written for a throwaway review.
- **`--tools Read Grep Glob`** — read-only by construction. No Bash means no
  permission prompt can hang a non-interactive run, and it structurally prevents
  recursion: the reviewer loads a CLAUDE.md that tells it to get a cross-model
  review, and without Bash it cannot act on that.
- **Give it the diff as a file, don't grant it git.** `git diff main...HEAD >
  scratch/cross-model-review.diff`, then name that path in the read-list. Same
  "point at the path" rule as plan mode, and it keeps the tool set read-only.

Other notes:

- **It runs fine inside Codex's `workspace-write` sandbox** — verified 2026-08-04
  via `codex exec -s workspace-write` with the launcher's flags: exit 0, macOS
  keychain auth reaches through. No extra `--add-dir` grant is needed.
- **Do NOT relocate `CLAUDE_CONFIG_DIR`** to keep writes inside the workspace.
  A fresh config dir loses auth entirely (`Not logged in · Please run /login`),
  and copying credentials into a worktree is not an option.
- **Timeout: foreground, ~5 min is typical, not a completion signal.** A real
  3-finding review of one file took 27s, but larger reviews can run longer than
  an exec tool's first yield window. Follow the session-ID polling rule above.
- Once the process actually exits, stdout is the clean final message — no
  `tokens used` tail to hunt for and no double-printing. A yielded empty stdout
  chunk is not the final message.

### Review / challenge modes (Codex → Claude)

Both use the same `claude -p` invocation; only the prompt changes. There is no
`claude` subcommand equivalent to `codex review`, so write the review prompt
yourself with the shared scaffolding (orientation glue, fencing, and
verify-don't-opine). Include the shared `Review authority` block in both modes;
for a diff, name the direct human request and any issue/brief/plan the branch is
implementing before asking whether the code is correct. An optional review
focus narrows the investigation but does not replace the originating request.
Include the required diff-review instructions below for review and diff-target
challenge modes.

---

## Required diff-review instructions (both directions)

Include these three moves in every **review** prompt and every **challenge**
prompt whose target is a diff. Keep them attached to the changed logic and
named intent; they are not a generic invitation to redesign surrounding
systems.

For these diff modes, adapt shared rule 3's read-list from a closed set to a
bounded first hop: name the files the reviewer must read first, permit it to
follow only directly relevant call sites, sibling paths, and shared state owners
needed by the three moves below, and require it to name every extra file it
opened. This preserves fencing without making the requested trace impossible.
Place the three moves after the `Review authority` block and before the findings
cap.

```
- For new or changed logic, choose at least one concrete input or state and
  trace it through the relevant code. Look especially for a wrong value,
  label, state, or side effect that does not throw or otherwise announce itself.
- When the change claims a durable bug fix, reconstruct the original failing
  sequence and the invariant the fix must establish. Inspect relevant sibling
  paths and shared state transitions. Call the fix inadequate only when source
  evidence shows the failure the change was authorized to fix remains
  reachable; report an adjacent reachable failure as its own finding under the
  remedy rule below.
- For each material finding, identify the smallest honest remedy. If that
  remedy would extend the authorized change by adding durable state, a schema
  change, background/retry/persistence machinery, a new subsystem, or a product
  decision, label it `human decision required` rather than presenting that
  expansion as an ordinary fix. The primary agent will adjudicate and mediate
  the decision with the human.
```

This remedy label does not make the reviewer authoritative and does not change
the handoff rules below: the driving agent still verifies every claim, rejects
noise, and brings only the actual decision to the human.

---

## Plan mode (the verified path, both directions)

Plans live in `docs/plans/<name>.md` (in-repo), so **the reviewer reads the file
itself** — no embedding. Prompt skeleton:

```
<boundary prefix — Claude → Codex only>
<orientation glue>

You are an independent, adversarial engineering+design reviewer. A <other model>
wrote docs/plans/<name>.md. Read it, then read the source it cites and verify
the citations and the "we already do X / free reuse / validation catches it"
claims against the actual code — you are a different model family; find what a
same-model self-review would miss.

Review authority (highest to lowest):
- Direct human requirements/decisions: <decisive wording, or "none available">
- Originating issue or brief: <repo path, or "none available">
- Plan under review: docs/plans/<name>.md

Direct human requirements and later decisions outrank issue proposals, plan
prose, inferred intent, and implementation choices. Report any contradiction.
Do not promote optional issue/plan ideas into requirements.

Review for, in priority: (1) wrong-problem / over-engineering — what's the
minimal version, what to cut; (2) architecture flaws; (3) silent failure modes
(no test AND no handling AND invisible); (4) things treated as settled that will
bite in implementation; (5) incorrect/unverifiable citations — name them.

Be concrete: cite plan section + file:line. Rank by impact. Don't pad. End with
the single most important change.
```

(Embedding the plan content is the gstack approach and is **wrong for callback**
— our plans are in-repo, so embedding wastes a large prompt and blocks the
reviewer from reading the surrounding context. Point at the path.)

## Challenge persona (both directions)

*"Your job is to find ways this will fail in production. Think like an attacker
and a chaos engineer — edge cases, races, resource leaks, silent data
corruption. No compliments, just the problems."* Optional focus narrows it.

## Review loops: two rounds, then verification-only

An adversarial reviewer with a findings cap never returns "clean" — it fills
the cap at whatever depth remains, so a review→fix→re-review loop has no
natural exit. The loop is bounded by rule (boxholder ruling, 2026-09-05,
after a loop ran to 8+ rounds):

- **Round 1**: the full review.
- **Round 2**: verify the fixes hold; fresh findings are still welcome.
- **After round 2: STOP inviting new problems.** Any further invocation is
  verification-only — the prompt names the already-found problems and asks
  whether the fixes hold, and explicitly tells the reviewer NOT to hunt for
  new findings. If a fix-verification pass turns up a defect in the fix
  itself, that's in scope; a brand-new surface is not.
- Residual or newly-suspected risks after that go to the human as
  accept-or-fix decisions, never silently fixed.

Adjudicate findings against the project's over-engineering line before
fixing them: mid-operation I/O-failure windows in one-shot operator-run
tools, exotic input encodings (CRLF, quoting edge cases), and
attacker-is-the-owner scenarios are presumptively REJECTED, not fixed —
raise them with the human only if you think one genuinely clears the bar.
The reviewer's "not fit" verdict is evidence, not the stopping condition;
the human's risk judgment is.

## Adjudication and handoff

The reviewer is evidence, not authority. Verify each actionable claim against
the source, distinguish real defects from scope opinions or noise, and decide
what to change.

For a cross-model pass required as validation during another work unit:

- Apply verified findings before declaring the work done.
- In the final handoff, lead with the work outcome and validation status.
- Mention the review only to explain a material change, unresolved risk, or
  decision the human may want to override.
- Do not add a review transcript, a ritual `Recommendation:` line, or a second
  conclusion after the actual conclusion.

When the human explicitly requests the review as the deliverable, return a
concise ranked summary in your own words, followed by your adjudication. Quote
the reviewer sparingly where its exact wording matters. Raw/verbatim output is
opt-in.

## What's different from gstack (and why)

- **Bidirectional.** gstack's skill is Claude → Codex only. Ours picks the other
  family relative to whoever runs it, so a codex worker gets a real outside
  review instead of a self-review in disguise.
- **Point at the path, don't embed.** gstack embeds full plan content because
  its plans live outside the repo sandbox (`~/.claude/plans/`). Callback plans
  live in `docs/plans/` — in-repo — so the reviewer reads them directly. The
  embed is pure cost here.
- **Softened boundary prompt.** gstack's "repository code only" made codex
  dismiss legitimate `docs/`/`.claude/rules/` citations as out-of-scope. We
  explicitly allow them.
- **Verify-citations is the headline instruction, not a footnote.** Every real
  finding in the trial run came from the reviewer reading source and falsifying
  a plan claim. That's the whole point; make it the spine.
- **Plain + read-tail, JSONL deferred.** gstack parses `--json` JSONL for
  reasoning traces. We capture plain output to `scratch/` and read the final
  message; the trace dump is large and codex double-prints the final message,
  so dedupe. Wire `--json` extraction later if the traces prove valuable.
- **Dropped for v1:** session continuity (`.context/codex-session-id`), the
  gstack preamble (telemetry/gbrain/voice), and the known-bad-version probe.
- **Kept:** filesystem-boundary prefix, `-s read-only`, `-C` monorepo root,
  `model_reasoning_effort="high"`, explicit adjudication, and loud exit-code
  surfacing. Raw reviewer output is retained as a scratch artifact but is not
  pasted into an unrelated work-unit conclusion.
