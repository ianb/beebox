---
title: "Question card opens with its options and Submit below invisible folds"
workstream: integration-tests
area: beebox
filed-by: agent
discovered-in: worktree-integration-tests — field-test run 2, dentist-email item
labels: [field-test-findings, ui-error]
resolution: implemented
---

> **Closed 2026-08-10** — boxholder picked options-visible-at-open. The form
> restructured (`QuestionForm.tsx`): the prompt now leads and is never
> clipped (it IS the question), the supporting prose (memo + learning card)
> lives in a 30vh-capped scroll region, and the Submit/Dismiss row is sticky
> to the bottom of whatever scrolls the card — so even a short pane shows a
> live Submit button at open, making the card impossible to misread as
> informational. Verified live with a deliberately long-prose select
> question on both the full card page and the browse pane (probe:
> `submitVisibleAtOpen: true`, 3 radios reachable). Residual noticed while
> verifying, not fixed here: the browse page's detail area can overflow the
> WINDOW rather than its own pane in some layouts — pre-existing, unrelated
> to questions.
Answering a three-option question card took two forced scrolls: the card
opens showing only the prose, with the options below an invisible fold
(run 2 screenshot `dentist-email/06-the-question.png`), and once the options
are reached the Submit button sits below another fold
(`08-selected-just-this-one.png`). No scrollbar or cut-off affordance
signals more content. The operator's judgment: "with a plain mouse I think
a person would have read that card as informational and closed it" — i.e.
the box's question would silently go unanswered, which defeats the
questions subsystem's whole loop.

Two directions, compoundable: size/limit the question panel so options and
Submit are visible at open (they are the point of the card; prose can
scroll instead), and give the panel's scroll container a visible affordance
(the 2026-08-09 `focusable` sweep covered page columns and the companion
tabpanel — check whether this panel is yet another unswept container, and
whether an always-visible scrollbar or fade-out hint belongs on all of
them).
