---
title: "Agent outcomes don't announce themselves — \"the conscience and not the voice\""
workstream: integration-tests
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test run 2, dentist-email + whats-needed items
labels: [soft-launch, field-test-findings, ui-sensibility]
needs: [design]
---

When [situation] the box agent finishes real work — files an email, creates
a decision record, answers get submitted, an event gets created — I want to
[motivation] see that outcome arrive where my attention already is, so I can
[outcome] trust the app did the thing without interrogating it.

Run-2 operator evidence (dentist-email debrief): the agent read the dentist
email, filed it, built a three-option decision record, and caught a weekday
error in the dentist's own email — "and announced none of it." The only
trace was an unlabelled "1" badge. After answering the question card and
watching it flip to "answered", the chat said nothing — not on panel close,
not after reload — and the operator had to ask a second time to learn an
event was created, a reminder set, and the date discrepancy caught. Their
summary line: "An assistant careful enough to ask permission needs to be
loud enough that the question gets seen — right now it has the conscience
and not the voice."

What already improved: the "1 todo on the plate" nav badge landed well —
whats-needed called it "the first time this app has ever put something in
front of me." So the direction is proven; the gap is outcome-shaped events
(question answered → follow-up ran → say what happened, ideally in the
chat thread that asked; reactor work completed → surface a digest line).

Related: [first-run-experience](2026-07-20-first-run-experience.md) (the
surrounding discoverability tension). Design questions: which outcomes rate
an unprompted chat message vs a badge vs nothing; and whether the answered
question's follow-up job should post its result into the asking session's
transcript by default.
