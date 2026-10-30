---
title: "A game framework plugin: an agent-editable outer game with a library of remixable mini-games, learning tasks, and goals"
workstream: box-game
area: beebox
labels: [plugin, game]
needs: [design]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-box-game — boxholder discussion, 2026-10-25 and 2026-10-26
---

The boxholder wants to return to this discussion. It ran in a Codex
session (`gpt-6-astra`) on 2026-10-25 and 2026-10-26; the worktree is
closed. The transcript is
`~/.codex/sessions/2026/10/25/rollout-2026-10-25T21-36-27-01a17610-ff5d-7713-a192-5d7ce9ea8595.jsonl`.
Level so far: discuss. No plan, no code.

## Where the discussion arrived

The first framing (programs as the main players, the agent writing bots)
was set aside. The boxholder's direction, in order:

- **The person plays; the agent authors.** The agent writes and rewrites
  levels, conventional ("old-school") AI opponents, rules, and material. It
  does not play.
- **An outer game holds embedded mini-games.** The outer game (the
  boxholder's working name: "framework") can be as small as level
  progression, but it is a container: it owns the continuing loop, goals,
  progress, and limits. Mini-games are bounded encounters inside it.
- **Goals and learning tasks fit in too:** flashcards, quizzes, vocabulary,
  and real-world goals such as exercise on an honesty system. A goal can be
  more than done or not done (stages, partial progress, retention).
- **The agent can reconfigure the outer game** as well as insert into it.
  The outer game can funnel toward explicit goals, but not every person sets
  it up that way.
- **The person sets the terms; the game holds them.** A person can ask for a
  restrictive loop (daily limits, a required task before another round, a
  stopping point). Changing it is a request to the agent, not a freedom
  inside play, so judgment, not impulse, decides "one more game". Avoid
  manipulative engagement patterns (expiring progress, guilt, manufactured
  urgency); honest unlocks and clear progress are fine.
- **Tools first, code second.** Ship a game framework the agent configures
  for ordinary requests, and extends with code for requests the tools
  cannot express.
- **A library of pre-built mini-games** that are easy to remix and are a
  solid starting point: geography, quiz, vocabulary, logic and spatial
  puzzles, memory and observation, and small creative activities (for
  example, flash fiction from rolled prompt tables, with the agent as a
  reader who reacts without grading).
- **An activity can hand you into a real task.** A game can be an
  invitation that puts you in the right mood and the right place for the
  next thing (a math game before math homework, a word game that opens the
  draft).
- **It is an opt-in plugin.** The plugin ships the mechanics, views, and
  defaults; each box owns its configuration, agent-written extensions,
  content, and progress.

## Research done

MECC precedents, with sources in the transcript: *The Secret Island of Dr.
Quandary* (familiar puzzles tied together by items and prerequisites),
*Storybook Weaver* (making something as the activity), *Odell Lake* (an
exploratory mode and a points mode; discussion afterward as the point),
and *Number/Word Munchers* (content difficulty and game pressure as
separate dials). The Minnesota fishing game the boxholder remembered was not
identified.

## Open when resumed

- The central playable action of the starting outer game.
- What a mini-game reports to the outer game (score, mastery, hints used,
  self-report) and how the outer game turns results into progress.
- Where it renders in the box (plugin views, `beebox/docs/plugins.md`) and
  how agent-written mini-game code is sandboxed.
- Where voice fits.
