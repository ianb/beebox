# Chunks: atomized observations for a co-presenter

One file per observation. A chunk is the smallest thing worth putting on screen while the speaker is mid-sentence: one number, one quote, one before/after, one case, one rule, one date line, one figure. Chunks overlap on purpose; the same fact may appear as a number in one chunk and as part of a case in another. The runtime co-presenter picks a chunk by matching what the speaker just said against each chunk's `cue` phrases, so cues are written the way the speaker talks, not the way the inventory is titled.

`build.ts` renders every chunk into [preview.html](preview.html) (a gallery, one card per chunk in its kind's layout) and [index.md](index.md) (the catalog a co-presenter prompt can carry: id, kind, cues, headline). Run `node --import tsx dev/devprocess-talk/chunks/build.ts` after editing.

## File shape

```markdown
---
kind: number
cue: provenance, discovered-in, who found it, the agent fills in the field
with: pick-issues-batching, evidence-stays-in-tree
source: inventory.md "Ownership vs provenance"
---
# Provenance is written by agents
## Issues, Jul 4 – Oct 9
1,018 / 1,036
agent-filed issues name where they were found
4 / 190
developer-filed ones do
```

- Filename is the id: `<slug>.md`, no number prefix; chunks have no order.
- `kind` is one of the seven below and picks the layout.
- `cue` is three to six phrases, comma separated, that the speaker might say.
- `with` lists ids the co-presenter could show next or instead (optional).
- `source` names where the number was verified (inventory section, slide, report).
- `# Headline` is the one sentence on screen. `## Eyebrow` is the small line above it (where, when).
- Body lines after that are the kind's payload. Keep a chunk under 60 words of body. Numbers come from the inventory or sweep reports, never from memory. Public-safe only: no box content, no private issues, no personal operational detail.

## Kinds and their payload

| kind | payload lines | on screen |
|---|---|---|
| `number` | pairs of lines: a figure, then its caption; one or two pairs | the figure huge, the caption small; two pairs side by side |
| `quote` | a fenced block with the quoted text, then one line naming who/where/when | large quotation, attribution under it |
| `contrast` | two lines starting `Before:` and `After:` (or `Rule:` / `Measured:` etc.) | two columns, left muted, right accented |
| `case` | a markdown table, two to four columns, two to five rows | the table as the whole card |
| `rule` | a fenced block with verbatim text from the repo (a rule, a refusal message, a commit line) | monospace block, nothing else |
| `timeline` | lines `YYYY-MM-DD — event`, three to six of them | a vertical date rail |
| `figure` | one `![alt](relative.svg)` line and one caption line | the SVG, caption under |

## Voice: say the idea, in my voice, now

The cards are shown while I talk. They are not a changelog and not a policy manual. Each one states an idea I hold and the thing that makes me hold it.

- **First person, present tense.** The speaker is "I" or "we"; the audience is "you". Never "the human", "the developer", "a person", "the boxholder". Never "the rule says". Say what I do and what happens.
- **Claim first, evidence second.** The headline is the idea in plain words, the way I would say it out loud. The payload is the number, the before/after, or the story that backs it. A headline is never a description of a mechanism.
- **No history unless the gap is the point.** The eyebrow names the topic in two to four words ("Trimming instructions", "Flaky tests"), not a date and a place. Dates stay only where time is the evidence (held for 40 days; regrew in six weeks; waited since August).
- **Rules are not the subject.** The subject is what goes wrong without the rule and what happens with it. A `rule` card quotes a line only when the line itself is vivid (a refusal message, a commit subject, a sentence I would read aloud). Policy prose ("add a dated body note stating where…") is not vivid; turn that card into a `contrast` or `number`.
- **Direct, not procedural.** "Code lands faster than I can try it" beats "a tag marks code that landed before a person tried it on the real app". "Count first, then make the rule" beats "each rule came after a count that enforced nothing".
- **Short.** Headline under 12 words. Caption under 15. Two-column contrast lines under 20 each.

Before and after, from real cards:

| was | now |
|---|---|
| A tag marks code that landed before a person tried it on the real app | Code lands faster than I can try it |
| Each rule came after a count that enforced nothing | Count first. Then make the rule. |
| Seeing the same problem again counts as new evidence (quoting the filing rules) | Seeing a bug twice is evidence, not noise (contrast: what we used to do / what we do now) |
| Four named levels of permission replace "go ahead" | "Go ahead" meant four different things. Now it means one. |
| In a timed job, a script decides whether to act; an agent decides what to do | The script decides whether to wake the agent. Never why. |
| A lesson must show up twice before it changes the instructions | One bad session is noise. Two is a pattern. |
| Issues found by scripted walks close at two speeds | Bugs the simulated users find are either fixed the same day or wait weeks |

## Write for a listener who has never seen this repo

A chunk is on screen for ten seconds in front of people who do not know this codebase. The speaker may not remember the internal name either. So:

- **No repo noun stands alone.** Every internal word is either replaced by the plain phrase from the table below, or defined in the same sentence in five words or fewer ("a skill, a reusable instruction file,"). Prefer replacing. Headlines and cues are plain too; the file id can stay internal.
- **One internal term per card at most**, and only when the card is about that term.
- **No tool names, flags, paths, or commit hashes** in headline, eyebrow or caption. A `rule` block quotes the repo verbatim and may contain them; the headline above it says in plain words what the block is.
- **Say what a thing is before what it did.** "The nightly job that runs the whole test suite found 29 broken landings" beats "the hourly suite had 29 red landings".
- **The test:** read the headline and payload aloud to someone outside the project. If they would ask "what is a ___?", rewrite.

Standard renderings (use these so the cards agree with each other):

| internal | on a card |
|---|---|
| the repo, beebox, bbx | "the project" or "the app" |
| a box | "a user's data store" (the product keeps each person's notes and files in one); say "the app" when the distinction does not matter |
| worktree | "a separate checkout" (one per task, so several agents work at once) |
| workstream | "a task" or "a named piece of work"; "the task outlives the checkout" |
| the router | "the shared dev server" |
| cull, culling, teardown sweep | "automatic cleanup of finished checkouts" |
| liveness | "whether an agent is still working there" |
| the seam | "moving the lifecycle logic out of one tool's hooks into a command any tool can call" |
| hook, pre-commit hook | "a check that runs before every commit" |
| trailer (Workstream:, Plan:, Issue:) | "a tag in the commit message naming the task / plan / issue" |
| provenance, discovered-in | "where the issue was found" |
| issue, the queue | keep "issue" (a filed problem or idea); "the backlog" |
| manual-testing gate | "waiting for a person to try it on the real app" |
| needs: decision, discuss, next action | "waiting on a human decision"; "a note asking the human to decide" |
| pick-issues | "the step that groups related issues into one piece of work" |
| re-encounter | "the same problem seen again" |
| plan | keep "plan" (a written design the agent follows); "a plan template" |
| .review.md, cross-model review | "a review by a different AI model family, kept as a file" |
| skill | "a reusable instruction file an agent loads for one kind of job" |
| sigil | "a `$name` command token that the agent runs if it sees it" |
| briefing | "the instructions a new agent session starts with" |
| CLAUDE.md / AGENTS.md, the root file, the package file | "the instruction file every agent reads first" |
| guide ledger, word budget | "a counted word budget on the instruction file" |
| doctest | "a test written as a Markdown document the agent can read" |
| the hourly suite, full suite | "the job that runs every test, hourly" |
| smoke tier | "a two-minute walk through the real app before anything lands" |
| careful tier, flake quarantine | "the slow lane for unreliable tests" |
| flake | "a test that fails at random" |
| test ledger | "a log of every test run" |
| lint, ratchet | "automatic style checks"; "a cap that only goes down" |
| doc-check | "a check that every path a doc mentions exists" |
| knowledge audit | "a quiz of what the agent knows about the app" |
| context-size ledger | "a log of how many words the agent is handed" |
| journey | "a scripted walk through the app by an agent playing one user" |
| walker | "the agent playing the user" |
| after-action | "the review pass over a walk's report" |
| claim rows | "things the walker reported" |
| exhibit | "a page of screenshots an agent publishes with one question for the human" |
| comments (bin/comments) | "notes the human leaves on a document for the agent" |
| field probe | "a test done on the real phone app" |
| finish, land | "landing on main" (merge, verify, deploy) |
| schedule, run-script head | "a timed job"; "a script that decides whether to wake an agent" |
| alert, digest | "an automatic warning"; "one daily summary of warnings" |
| launchd | "the Mac's built-in job scheduler" |
| Codex | "OpenAI's coding agent" (the second agent, alongside Claude) |
| GLM | "a third-party model" |
| model ladder, quota | "which model for which job"; "the weekly usage allowance" |
| sha, commit id | drop it, or "one commit" |

## Writing cues

Write what the speaker would say in the moment: "the agent fills that in", "nobody reads the plan", "three in the morning", "it went in and came out". Not: "ownership vs provenance split 2026-08-11". Include the number if the speaker is likely to say it ("ninety-eight percent"). Avoid cues that are true of half the talk ("agents", "issues").
