---
title: "A codeword for \"you decide, and learn not to ask me this\" — and the principles it updates"
workstream: unattached
area: docs
labels: [agent-workflow]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder request
priority: normal
---

Agents in this repository often ask the developer questions the developer
does not understand and does not care about. One question is cheap. The
pattern costs attention, and nothing today stops the next session from
asking the same kind of question.

The developer wants one short reply that means all of this:

1. I can't answer this question (or I don't care about it).
2. I trust you to decide. Decide, say what you chose, and continue.
3. This question should not have reached me. Update the principles on what
   is worth asking me, so it does not happen again.

## The missing principles

There is no written rule for what deserves a question. Fragments exist:
the root `AGENTS.md` asks for confirmation before hard-to-reverse or
outward-facing actions, the finish skill says not to ask "close-out vs
checkpoint" because the answer changes nothing, and `beebox/AGENTS.md` says
to ask at a login wall. Nothing states the general test. A first draft to
start from:

- **Ask** when the answer depends on something only the developer knows
  (preferences, priorities, private context, what they want to happen), or
  when the action is hard to reverse, outward-facing, spends money, or
  touches real box data or credentials.
- **Decide** when the answer follows from the code, the docs, an existing
  convention, or ordinary engineering judgment, and when either answer is
  cheap to change later. State the choice so the developer can veto it.
- **Never ask** a question whose answer would not change what you do.

The codeword is the feedback loop that grows this list from real misses.

## Design questions

- **The codeword.** It must be short, rare in ordinary speech, and
  unambiguous. Candidates: a slash command such as `/yourcall` (a skill can
  carry the whole procedure), or a fixed phrase. A plain phrase like "your
  call" is natural, but an agent may read it as ordinary permission and skip
  step 3.
- **What the agent does on the codeword.** Answer the question itself and
  say what it chose; then name the kind of question it should not have
  asked; then propose the principle change (a line in a named file) and make
  it, or file it, per the developer's standing permission for docs edits.
- **Where the principles live.** The root `AGENTS.md` (every session reads
  it), a dedicated doc it links to, or the agent's memory directory. Memory
  is per-agent and invisible to Codex sessions; a tracked doc is shared.
- **Scope.** Dev-repo sessions first. Box agents ask the boxholder questions
  too (question cards, chat), and the same codeword could feed the box's
  guidance, but that is a separate surface (the agent guide's QUESTIONS
  section).
- **Measuring it.** Each use of the codeword is one recorded miss. A count over
  time shows whether the principles are working.
