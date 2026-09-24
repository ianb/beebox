---
title: "The box agent treats a general question as a question about the box and researches far too much"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder report, 2026-09-23
priority: backlog
---

The boxholder asked the box agent an ordinary question. It asked for a
brainstorm about an external group, so it needed little or no research. The
agent inferred that the question must relate to the box, and it searched the
box extensively. It failed as a general assistant because it centered the
mechanics it lives inside.

The cause is probably the weight of box guidance in the agent's context. The
box CLAUDE.md and agent guide describe the box in detail, and nothing tells the
agent that many questions have no relation to the box. Guidance that makes box
questions go well can make general questions go badly.

## Tension

- Guidance could say "not every question is about the box; answer general
  questions directly and look in the box only when the question names or
  implies box content." But a prompt line alone may not outweigh the rest of
  the context.
- The agent sometimes should connect a general question to box content (for
  example, notes about that group). The right behavior is a light check, not
  zero research.
- A knowledge audit can test this: a general brainstorm prompt, with a check
  on read count or elapsed tool calls. See
  [knowledge-audit-scores-wasted-reads](../features/2026-09-23-knowledge-audit-scores-wasted-reads.md).
