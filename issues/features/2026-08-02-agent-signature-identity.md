---
title: "Agent signature identity: emoji/avatar on the personality card + a first-run 'meet your assistant' moment"
needs: [decision, design]
area: callback-box
labels: [soft-launch]
filed-by: agent
discovered-in: worktree-openclaw-onboarding-research — OpenClaw identity-onboarding research corpus
---

The assistant has no visual identity anywhere in callback-box. `goes-by`
("Egg") is consumed only as prompt text — `personality-compile.ts` renders
"You are **Egg**" and nothing else reads it. The UI `Avatar` component
(`callback-box/src/frontend/src/components/ui/Avatar.tsx`) is for human users.
Chat replies, session lists, and attribution surfaces show the assistant with
no name, no emoji, no avatar.

When a new boxholder starts talking to their box, I want the assistant to be a
*someone* — a name and a visual signature I recognize across chat, history,
and attributions — so the relationship has an anchor before the personality
has earned its shape. This is a **UX hypothesis to prototype**, not a
validated result: the OpenClaw reception research shows praise attaching to
its legible identity files, not evidence that a per-agent signature improves
attachment.

Research behind this:
`research/openclaw-personality-onboarding/compare-cbx-recommendations.md`
(dispositions 2 and 3, revised after a cross-model Codex review). OpenClaw
findings, condensed: the signature elements (emoji/avatar/name) are the
load-bearing part of its identity system; the agent-solo one-shot t0 ritual is
the criticized part (bootstrap paradox — rejected for CBX); its deepest bug is
a two-store split where the ritual writes a file the consumers never read.

## Design spine: stable identifier vs evolving belief

Name and signature are **continuity identifiers** — what the user recognizes
the agent by — while tone/traits are evolving beliefs. Do not let the
identifier churn like a belief: signature fields are user-approved. The agent
(retro included) may *propose* a change with evidence — via the retro
**question** sink, with the boxholder confirming — never a direct
personality-sink rewrite. (Today's observer remit is tone/traits/relationship,
`callback-box/src/core/retro/observer.ts:46`; a signature proposal needs its
own observation kind and a churn guard — small design work.)

## Proposed shape (needs the boxholder's call, then design)

1. **Fields on the personality card**, next to `goes-by`
   (`callback-box/src/schemas/personality.tsx`): optional `emoji` first.
   An image `avatar` (attach ref) is a *separate, later call* — it carries
   schema/validation/transport questions emoji doesn't, and even OpenClaw's
   ritual never asks for one.
2. **An explicit typed UI projection** from the card — the pattern
   `compileSpeakingVoice` already sets (a named projection per consumer;
   `compilePersonality` is the prompt projection). Consumers: assistant
   avatar in chat beside replies, session/attribution surfaces. Never a
   parallel config store (the OpenClaw two-store trap), never an ad-hoc
   re-parse. Expression uses only — no fixed-emoji ack-reactions (reads
   "robotic" per OpenClaw reception).
3. **First-run "meet your assistant" moment** — woven into an existing
   surface of the [first-run-experience](2026-07-20-first-run-experience.md)
   design (the chat zero-state, or the opening of whichever menu flow the
   user picks), NOT a menu item — the menu criterion is complete flows with a
   payoff, and naming is configuration. The agent introduces itself as Egg,
   says it grows into its personality, and offers a different name/signature
   if the user wants. Co-authored and revisable; gives the fields their
   natural first write.

Open questions for the decision: does the boxholder want a signature element
at all; whether the default template seeds one (🥚 for Egg?); which surfaces
render it first; what the churn guard on retro-proposed changes looks like.
