---
title: "The root's \"Let me tell you what this box is for.\" opener stays after the person has said it"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — D-chemistry, A-lending, B-inventory, C-reconnecting, F-newcomer journey walks, 2026-10-09
resolution: implemented
---

Fixed on worktree-journey-walks-oct: the briefing schema instructions, which load as a path rule whenever the agent edits a briefing, now say: when you record the box's purpose, remove the root landmark's stock onboarding openers or replace them with openers for that purpose. A doctest (`schemas.briefing-compile`) keeps the quoted opener text equal to `STOCK_ROOT_OPENERS`. The agent guide is unchanged: its RECORDING routing already sends the box's purpose to the briefing, and by the guide ledger's bin test this rule applies only when touching the purpose, so it belongs on that surface. Residual risk: an agent that records the purpose outside the briefing (B-inventory, C-reconnecting) breaks the routing rule first and will not read this one. Verified by reading the regenerated `box-docs/card-briefing.md`; no knowledge audit was run.

The root landmark ships two onboarding openers, "Let me tell you what this box
is for." and "What can you do?". The landmark schema says to remove them once
the person knows what the box is for. In all six walks the person said what the
box was for, the agent recorded it, and the root place page and the empty root
chat still offered the opener afterward. The defect occurred in every walk. In
A-lending the agent removed the root openers at 11:08 (box commit `b56b498`),
late and incidentally, while editing the root landmark for another reason.

- D-chemistry: the Box tab offered it after the walker had done exactly that.
- A-lending: the opener returned after the question was answered. The agent
  removed it 5 hours later, only because it edited the root landmark for a new
  Loans place.
- B-inventory: the agent wrote the purpose into a nested Inventory briefing.
- C-reconnecting: the agent wrote the purpose into a doc card.
- F-newcomer: the agent wrote the root briefing itself and still left the
  opener (`_content/Box.landmark.card` unchanged from the baseline).
- D-chemistry (second walk): same, after the agent edited the briefing.

## Mechanism

The removal rule exists only in the landmark schema guidance
(`beebox/src/schemas/landmark.ts:218`: "remove them once the person knows what
the box is for"). The stock openers are installed at
`beebox/src/core/box/structure/defaults.ts:240` from `STOCK_ROOT_OPENERS`
(`beebox/src/schemas/landmark.ts:111`). The agent records the
purpose by editing a briefing or a content card. The briefing guidance says
only that openers live on the landmark, not on the briefing
(`beebox/src/schemas/briefing.tsx:76`). The agent never opens the landmark
card on that path, so it never reads the rule. In F-newcomer the agent edited
the root briefing and still did not open the landmark.

## Why the fix is not obvious

A rule in the briefing guidance reaches only agents that edit the briefing;
B and C put the purpose elsewhere. Retiring the opener in code needs a signal
that "the purpose is recorded", which the box does not have as a fact. The
repository's stance is to arrange context for the agent and not to automate
the judgment, so the likely fix is a pointer where the agent records the
purpose, not an auto-remover.

Related: [landmark arrival](../../../beebox/docs/implemented-plans/landmark-arrival.md)
(Track B introduced the fading openers);
[first-screen-says-nothing-about-what-this-is](../../features/2026-08-23-first-screen-says-nothing-about-what-this-is.md).

Reports: [D-chemistry](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09.md) row 45,
[A-lending](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md) row 12,
[B-inventory](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) R9,
[C-reconnecting](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-09.md) R6,
[F-newcomer](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) R5,
[D-chemistry second walk](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09-2.md) R4.
