---
title: "Passing route tests emit scan startup shape errors"
workstream: chat-routing
area: beebox
filed-by: agent
discovered-in: chat-routing — change-selected test run
resolution: implemented
---

Resolved by `380395bfb`: scan promotion now tracks in-flight startup and
debounced passes and the server waits for them during close, so temporary route
test boxes are not removed while a pass is validating them. The focused teardown
regression and isolated scan-upload route suite pass without startup-failure
diagnostics; the deliberate non-annex fixture warning remains.

A passing `pnpm --dir beebox test:changed` run emitted a stack trace beginning
`[scan] Startup promote pass failed: MissingBeeBoxDependencyError` for a temporary
`bbx-route-test-*` box. The error said the shapeVersion 3 box did not declare a
beebox dependency. All 108 selected files and 1,277 assertions passed.

The diagnostic may come from a deliberately malformed fixture or a startup pass
that outlives fixture teardown; its source test has not been isolated. Expected
failure fixtures should assert their diagnostics locally, while unexpected
background failures should fail the test that caused them. A passing run should
not leave this stack trace unexplained.

Searched the public queue, including closed issues, for the exact diagnostic
and test diagnostic noise; no matching focused issue found. This records the
observation only and does not authorize broader test infrastructure cleanup.
