---
title: "Codex SDK as an optional second backend (bring-your-ChatGPT-subscription)"
workstream: backend-research
needs: [decision]
area: callback-box
filed-by: agent
discovered-in: worktree-backend-research — deep-pass backend-alternatives research
---

The LATER recommendation from the backend deep pass
([synthesis](../../research/backend-alternatives/2026-07-18-synthesis.md);
detail in [chatgpt-subscription-path](../../research/backend-alternatives/2026-07-18-chatgpt-subscription-path.md)
and [alt-harnesses](../../research/backend-alternatives/2026-07-18-alt-harnesses.md)).

The tension: the single most-wanted user story pluggability could serve — "I
already pay for ChatGPT; use that" — is only reachable through Codex
(subscription OAuth), i.e. a Shape B harness swap, never through an
Anthropic-compatible endpoint. Codex CLI scored closest to our runtime contract
(published TS SDK, per-turn image input, resume, AGENTS.md + Claude-interoperable
skills, genuine system-prompt append). Known port costs: host-side session-id
mapping (create-with-id explicitly refused, openai/codex#17782), hooks are
shell-only (our in-process card validator regresses), structured-output-under-
tools needs re-verification (#15451).

Why not now (each could flip):
- OpenAI's tolerance of third-party subscription riding is informal (exec tweet,
  Mar 2026); direct questions about commercial use went unanswered.
- Personal-subscription traffic is training-eligible by default behind TWO
  separate opt-out toggles — wrong default for private email/PII.
- Unresolved image-forwarding gap on the subscription-auth path in third-party
  harnesses (vision is core for us).

Pickup triggers:
1. OpenAI formalizes third-party/commercial subscription policy (either way).
2. Anthropic's Agent SDK credit-pool split returns (announced May 2026, pulled
   on its 2026-06-15 effective date) and users need an escape hatch.
3. The image-forwarding gap closes and the two-toggle training default improves.

If picked up: ship as an opt-in, clearly-labeled backend with explicit warnings
(fragile undocumented auth endpoint, training toggles), never the default. The
port-hygiene work in
[chat-backend-port-hygiene](../code-quality/2026-07-18-chat-backend-port-hygiene.md)
is the prerequisite that makes the second backend implementable.
