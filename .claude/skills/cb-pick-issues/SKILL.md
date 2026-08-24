---
name: cb-pick-issues
description: Choose what to work on from the issue queue — survey it, find clusters, check what's stale or already shipped, and propose (or, when told to, launch) work with the right kind of session. Use when the human says "what should we work on", "look at the queue", "find a cluster", "pick an issue", "what's related to X", "is there a body of work around Y", or asks for a proposal from the backlog. Upstream of cb-issue-actions (which works `next-action:` tags) and of the issues skill (filing). Tooling: bin/issues.
---

# Picking issues

Choosing work from ~350 open issues is a judgment task with a tooling layer
under it. The tooling (`bin/issues`) makes surveys cheap; this skill is about
what to do with the survey, and — above all — **what you are allowed to do at
each step**. Field semantics (`priority:`, `next-action:`, `needs:`,
`discovered-in:`) are in `issues/CLAUDE.md`; nothing here overrides it.

## The mode you are in

Every request to look at the queue is one of three modes. Read the human's
words and pick the *weaker* mode whenever they are ambiguous. Changing mode
requires a new instruction from them — you never promote yourself.

| Their words (examples) | Mode | Allowed | Not allowed |
|---|---|---|---|
| "look at", "look into", "what's in the queue", "find a cluster", "what's related to X", "what should we work on" | **Investigate** | `bin/issues` queries; read issues in full; check the code for what has since shipped; write up findings; append dated notes to issue *bodies* recording what you verified (found stale, re-encountered — per `issues/CLAUDE.md`) | changing frontmatter (`priority:`, `needs:`, `next-action:`, `workstream:`), closing, moving or merging issues; launching anything; choosing a model |
| "propose", "what would you do", "make a plan for", "pick one", "which of these" | **Propose** | everything above, plus one ranked recommendation with the issue set, the kind of session it deserves, and a draft briefing | launching; setting `priority:`; closing or merging issues |
| "do it", "launch", "start a worktree on X", "go" — naming a specific item or approving a specific proposal | **Act** | launch via the `launch-worktree-session` skill (which still asks about model when unsure), passing `--issue <path>` for the issue the workstream takes responsibility for and listing the rest of the cluster in the briefing; amend the chosen issues per `issues/CLAUDE.md` | widening to a second item, cluster, or session without a fresh "go" |

Rules that come from real failures:

- **One instruction, one action.** "Look for another cluster" is one
  Investigate. It does not become a launch, and it never becomes two. Approval
  of proposal A approves A only.
- **"Look into" means report back.** It is not "look into and then handle."
- **Approval doesn't carry over.** Being told to launch one cluster says
  nothing about the next; each launch is its own "go".
- **Model choice is part of the proposal, never of the act.** Say what kind of
  issue it is — how much is *undecided*, not how many files move — and suggest
  the rung from the launch skill's ladder (Codex default; Opus for harder work;
  Fable for genuinely open architecture or judgment). The human confirms. A
  measurement or design question that needs judgment about *what to measure*
  is a Fable-shaped task even when the diff will be small.

## A cluster is a hypothesis

`bin/issues groups` and `bin/issues similar` produce **candidate** sets. A
candidate set is a reason to read, not a finding. The failure this rule exists
for: a session grouped eight connector issues by title, inferred from words like
"discard" and "overwrite" that the boxholder's live calendar was at risk, and
began launching a workstream on that premise — without having read the issues.

So, for any cluster you intend to say something about:

1. Read every member in full (`bin/issues show`, or the file). Titles and
   slugs are a retrieval index and never appear in a finding as evidence.
2. For each member, check whether it is still true: open the code it names;
   `bin/issues similar <path> --closed` finds a closed sibling whose fix may
   already cover it. Issues describing things that have since shipped — or
   whose core research claim is now false — are common, and their fate
   (close, amend, reopen) is part of the finding.
3. State the cluster's *cause*, not its vocabulary. Two issues that share words
   but not a mechanism are not one body of work; two that share a mechanism
   but no words are. The semantic tools make the first mistake cheap.
4. Name what you did **not** read. A survey that read 6 of 11 members says so.

## How to survey

Signals, roughly in order of how well they have predicted a real body of work:

- `bin/issues groups --by discovered-in` — one audit's findings, filed
  together, are usually one piece of work.
- `bin/issues groups --by date` — a session's design thinking lands on one day
  and cross-references itself.
- `bin/issues similar <path> --all [--docs]` — semantic neighbours across
  categories and dates; the only signal that finds design clusters with no
  shared tag (`--docs` pulls in plans and design docs as prior art). Scores
  are relative: for issue-as-query, ≳0.65 has been reliably related and
  0.55–0.65 is a maybe; text queries score lower across the board.
- `bin/issues search "<symptom>" [--label …] [--area …]` — hybrid keyword +
  semantic with facets, for "is there anything about X".
- `labels:` (`--label`) — good where present, thin coverage.
- `workstream:` — mostly `unknown`/`unattached`; a named value may be a live
  owner or a tombstone. Not a clustering signal.

Exclude by default: `needs: [manual-testing]` (the developer's own queue),
`watch/` (trigger-driven, never picked), and anything with a `next-action:`
tag (that is `cb-issue-actions` territory — mention them, don't work them).

## What a proposal contains

One recommendation, not a menu. For it: the issue paths (every member, with
the ones you'd close or amend marked), the mechanism that makes them one piece
of work, what you verified is still true and how, what you didn't read, the
kind of session it deserves and why, and a draft briefing in the
`launch-worktree-session` shape. If two candidates are genuinely close, say
which you'd pick and the one fact that would flip it — don't hand back three
options for one question.

## Seams

- Filing something you noticed while surveying → the `issues` skill (search
  first; re-encounter rules apply).
- Issues with `next-action:` tags → `cb-issue-actions`.
- Launching → `launch-worktree-session` (only in Act mode).
- A survey that produced a fact worth keeping — a cluster judged *not* to be
  one body of work, an issue found stale — goes into the issue bodies as
  dated notes (allowed in every mode), not into chat. Frontmatter changes and
  closes wait for Act.
