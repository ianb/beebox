---
name: cb-issue-actions
description: Work the issue queue's `next-action:` tags — provisional agent tasks (reconfirm, duplicate, invalid, fixed) that ask you to verify a suspected outcome and apply it only when evidence confirms it. Use when the human says "work the next actions", "go through the reconfirms", "check the issues tagged fixed", "triage the queue", or when you want to find issues an agent can resolve without a decision. Includes extraction scripts. Conventions in issues/CLAUDE.md.
---

# Working `next-action:` tags

`next-action:` is a **provisional agent task** on an issue. Someone suspects an
outcome and is asking the next agent to check it. The whole discipline is in one
line of `issues/CLAUDE.md`:

> A matching tag is not permission to close blindly.

Read every value with the question mark the UI shows — **"fixed?"**,
**"reconfirm?"**. Nothing here is asserted. It is what Ian thinks is *likely*
and wants confirmed properly.

Your job is to **produce evidence**, then act on what the evidence says — which
is often the opposite of what the tag guesses.

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

**`reconfirm` — two questions, in order.** The most common tag, and it is
`fixed` and `invalid` stacked:

1. **Was it explicitly fixed?** Do the `fixed` search below — git history first.
2. **If not obviously fixed, is it still an issue at all?** It may be **moot**:
   the surrounding code changed, the feature moved, the situation that produced
   it no longer exists.

Three outcomes: fixed → close `implemented` naming the commit; moot → close
`wontfix` saying what made it moot; still live → remove the field and record what
you checked, so the next pass starts further along. A flake tagged `reconfirm`
needs a real run, not a reading.

**`duplicate` — does another issue own this work?** Compare *scope*, not titles.
Two issues about the same symptom with different root causes are not duplicates.

**Search `closed/` too.** A duplicate of an already-closed issue means this one
closes as well — the work is done, the item just outlived it.

When it is a duplicate: **merge the details into one issue first**, then close
this one `superseded` with a reference to the survivor. Do the merge before the
move; a duplicate often carries the better reproduction, the sharper `file:line`
pointers, or a second sighting that matters as evidence. Losing that is the real
cost of a careless dedup.

**Ask Ian** when merging looks lossy, or when the merged result would be an
oversized issue covering too much. Two focused issues can beat one sprawling
one, and that is his call rather than yours.

**`invalid` — is this moot?** Mostly Ian asking whether the issue still applies:
it describes a situation, a file, or a behavior that no longer exists. Check
whether the thing it is about is still there at all before assessing the claim.

Two ways an issue can be invalid, and they get different closing notes:

- **Moot** — it was true and the world moved. Say what changed.
- **Never held** — filed on a misread. Say what was actually true, so the same
  misread doesn't get filed again.

Both close `wontfix`. And issues do get filed correctly and *then* misjudged as
invalid, so confirm before closing — the tag is a question.

**`fixed` — is the reported behavior already resolved?** Usually this means:
*the work probably happened, there is evidence in git, and the issue just got
lost.* So **search history first** — the fix commonly landed under a different
description, inside a larger change, or in a workstream that never closed the
item:

```bash
git log --oneline -S'<a distinctive symbol or string from the issue>' -- <path>
git log --oneline --since='<issue date>' -- <the file the issue names>
```

Then confirm the behavior rather than trusting a commit that reads like the fix.
Close with `resolution: implemented` naming the resolving commit.

## Verification bar

The tag is a hypothesis from someone with less context than you now have. Match
the evidence to the claim:

- **Behavioral claims need a run.** Reproduce, or drive the app (`browse` skill,
  `bin/browse`). Reading the diff is not verification.
- **Flakes need repetition.** One green run does not clear a flake — see the
  tracked-flake protocol in `.claude/agents/finish.md`.
- **Anything needing a real device, a phone, live credentials, or a human eye is
  not yours to confirm.** That is what `needs: [manual-testing]` exists for, and
  **only Ian clears it.**

**`needs: [manual-testing]` plus `fixed` or `reconfirm` → check in with Ian.**
Don't resolve those alone and don't silently skip them. The two tags together
mean the code side is believed done while the confirming evidence is the kind
only he can produce, so the useful move is to bring him the specific question:
what you verified, what remains unverifiable from here, and the smallest thing
he could do to settle it. Narrowing a written multi-step protocol down to one
action is often the whole contribution.

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
