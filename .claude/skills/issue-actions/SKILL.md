---
name: issue-actions
description: Work the issue queue's `next-action:` tags — provisional agent tasks (reconfirm, duplicate, invalid, fixed) that ask you to verify a suspected outcome and apply it only when evidence confirms it. Use when the human says "work the next actions", "go through the reconfirms", "check the issues tagged fixed", "triage the queue", or when you want to find issues an agent can resolve without a decision. Includes extraction scripts. Conventions in issues/CLAUDE.md.
---

# Working `next-action:` tags

`next-action:` is a **provisional agent task** on an issue. Someone suspects an
outcome and is asking the next agent to check it. The whole discipline is in one
line of `issues/CLAUDE.md`:

> A matching tag is not permission to close blindly.

Your job is to **produce evidence**, then act on what the evidence says — which
is often the opposite of what the tag guesses. The browser renders these values
with question marks for exactly that reason.

Second rule, equally load-bearing:

> Remove the field after acting on it or disproving it.

A stale `next-action:` re-invites the same work forever. Every issue you touch
leaves with the field gone.

## Finding the work

List everything tagged, with the tag and title:

```bash
cd "$(git rev-parse --show-toplevel)"
for f in $(grep -rl "^next-action:" issues --include='*.md' | grep -v CLAUDE.md); do
  printf "%-10s %-56s %s\n" \
    "$(grep -m1 '^next-action:' "$f" | sed 's/^next-action:[[:space:]]*//;s/[[:space:]]*#.*//')" \
    "${f#issues/}" \
    "$(grep -m1 '^title:' "$f" | cut -c8- | tr -d '"' | cut -c1-46)"
done | sort
```

Count by value, to see the shape of the backlog:

```bash
grep -rh "^next-action:" issues --include='*.md' \
  | sed 's/^next-action:[[:space:]]*//;s/[[:space:]]*#.*//' \
  | sort | uniq -c | sort -rn
```

One value only (substitute `reconfirm` / `duplicate` / `invalid` / `fixed`):

```bash
grep -rl "^next-action: *reconfirm" issues --include='*.md' | grep -v CLAUDE.md
```

Cross-reference with priority, since a tagged `important` issue is worth doing
first:

```bash
for f in $(grep -rl "^next-action:" issues --include='*.md' | grep -v CLAUDE.md); do
  printf "%-10s %-12s %s\n" \
    "$(grep -m1 '^next-action:' "$f" | sed 's/^next-action:[[:space:]]*//')" \
    "$(grep -m1 '^priority:' "$f" | sed 's/^priority:[[:space:]]*//' || echo uncategorized)" \
    "${f#issues/}"
done | sort
```

## What each value asks of you

**`reconfirm` — is this still live?** The most common tag and the most open. Read
the issue, then check the current tree: has the code changed, did another
workstream fix it incidentally, does the described behavior still reproduce? A
flake tagged `reconfirm` needs a real run, not a reading. Outcome is usually
"still live, field removed" or "resolved by X, closed".

**`duplicate` — does another issue own this work?** Find the other issue and
compare *scope*, not titles. Two issues about the same symptom with different
root causes are not duplicates. If it is one: close this one with
`resolution: superseded`, note the surviving issue, and make sure anything
unique here is carried over first — a duplicate often has the better repro.

**`invalid` — does the premise hold?** Check the claim, not the conclusion.
Issues get filed on a misread of the code, and they also get filed correctly and
then misjudged as invalid. If the premise fails, close with `resolution: wontfix`
and say what was actually true.

**`fixed` — is the reported behavior already resolved?** Reproduce it. A commit
that *looks* like the fix is not evidence it worked; verify the behavior. Then
close with `resolution: implemented` naming the resolving commit.

## Verification bar

The tag is a hypothesis from someone with less context than you now have. Match
the evidence to the claim:

- **Behavioral claims need a run.** Reproduce, or drive the app (`browse` skill,
  `bin/browse`). Reading the diff is not verification.
- **Flakes need repetition.** One green run does not clear a flake — see the
  tracked-flake protocol in `.claude/agents/finish.md`.
- **Anything needing a real device, a phone, live credentials, or a human eye is
  not yours to confirm.** That is what `needs: [manual-testing]` exists for, and
  **only Ian clears it.** A `next-action: fixed` on an issue that also carries
  `needs: [manual-testing]` does **not** override it: verify what you can,
  report, and leave the flag.

When you cannot settle it, that is a legitimate outcome. Remove the field, write
what you checked and what would settle it, and move on. An issue that has been
investigated twice with no note is worse than one nobody touched.

## Closing mechanics

Follow `issues/CLAUDE.md`. In short: `git mv` to `closed/<category>/`, add
`resolution:`, add a closing note at the top of the body naming the resolving
commit or reason, then:

```bash
pnpm --dir callback-box doc-check --fix
```

which repairs inbound links by basename. Commit the move and the link repairs
together.

## Fixing in place

Some of these are small enough to just fix — that is the point of surfacing them
as agent tasks. Judge by blast radius, not by category:

- **Fix inline** when it is contained and verifiable here (a lint fix, a wrong
  string, a one-file bug with a test).
- **Spin up a worktree session** (`launch-worktree-session` skill) when it
  touches a deployed path, spans surfaces, needs a device, or wants a plan.

Working from the main checkout: a commit touching `callback-box/` **deploys**.
Know that before you commit, not after.

## Reporting back

Group by outcome, not by issue order — closed, still live, could not settle,
escalated. For each closed one, name the evidence. For each still-live one, say
what you checked, so the next pass starts further along than you did.
