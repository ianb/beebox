---
name: bbx-guide-testing
description: Choose among beebox test tiers and judge appropriate coverage. Use when deciding how to test a change or working in an unfamiliar tier; use bbx-debug for the broader debugging discipline.
---

# Testing in beebox: what exists and how to choose

A guide skill: motivations and the decision map. Mechanics, syntax, and
the full tier catalog live in `beebox/docs/testing.md` — read the
relevant section before writing in a tier you haven't used.

## Why tests look the way they do here

Tests come first **as a design tool**: writing the test forces the
decomposition, sharpening a function's purpose and boundaries — then
documentation, then regression-anchoring. Coverage percentages are not a
goal; cover the substantial codepaths and realistic failures, not every
line (`docs/testing.md` opens with this).

## The tiers, and when each applies

- **Doctests** (`test/**/*.doctest.md`) — the primary format: markdown
  with executable blocks. Three flavors: pure-function; route
  (`makeTestServer()` — NOTE it prefixes URLs with `/test`;
  `rootRequest()` escapes); filesystem (`makeTmpBox()`). Syntax:
  `.claude/rules/doctest.md` (loads automatically when editing one);
  deeper reference in the monorepo `agent-doctest/docs/`.
- **Scenario tests** (`src/scenario/`) — multi-step end-to-end fixtures
  driving a real box through wakeup cycles. For pipeline behavior that
  spans several agent/CLI steps. They run from the beginning — there is
  deliberately no checkpoint-resume.
- **Service fakes** (`src/services/`) — every external dependency has a
  typed fake with observable state; tests never hit real services.
  `test/helpers/fake-agent.ts` enforces real SDK session semantics.
- **Traditional TAP tests** (`test/*.test.ts`) — reserved for things
  that would be circular as doctests, e.g. testing the doctest
  infrastructure itself. Not the default; prefer a doctest.
- **Knowledge audits** (`src/dev/knowledge-audits.yaml`) — verify a *box
  agent* can recall a convention from its context without re-reading.
  New agent-facing concept → at least one audit (see bbx-plan's section).
- **Session critiques** (`@session-critique <session-id>`) — evaluate
  whether the CLI tools helped or hindered the agent in a real session
  (unhelpful output, missing commands, wrong tool, bad errors, wasted
  effort) — not what the agent knows, but whether the tools served it.
- **Card validator hook** (`src/core/sdk-hooks.ts`) — not a test tier
  you write; a live `PostToolUse` hook that lints `.card` writes/edits
  during agent sessions and feeds issues back as `additionalContext`.
- **Smoke tier** (`bin/smoke`) — the merge gate that boots a real box
  and walks it in a browser (~30s, no model turns): does the app run at
  all. You do not usually invoke it; `/finish` runs it for any diff that
  touches a deployed path. Reach for it by hand when a change could
  break startup or the app bar and you want to know before landing.
  `bin/smoke --report` says what each step has actually caught and what it
  costs — the tier is meant to be trimmed when a step stops earning its
  place. Breaking something to prove the tier still fails loudly? Declare
  it with `BBX_SMOKE_FAULT_INJECTION="<what you broke>"` so the run is
  excluded from every count.
- **Frontend dev stubs** (`/fakestream`, `bin/browse`) — for frontend
  bugs that only manifest against real layout/measurement (scroll,
  virtualization, reflow); a dev stub makes the input deterministic
  while you drive the running app.
- **Browser probing** (`bin/browse`, the browse skill) — for behavior
  only a real browser shows (scroll, focus, HMR) and the way to check
  page appearance in general.

## Choosing

Pure logic → pure doctest. HTTP surface → route doctest. Touches box
files → filesystem doctest. Spans wakeup cycles or several steps →
scenario. Page appearance → browser probe (`bin/browse`). Streaming/scroll
UI bugs → frontend dev stub + browser probe. "Will the box agent know
this?" → knowledge audit. "Did the tools help or hinder?" → session
critique. When a change fits no tier cleanly, that's usually a
decomposition smell — split the change, don't invent a new harness.

Run `pnpm test:changed` and `pnpm lint:changed` before committing (pre-commit runs typecheck + staged-file lint,
not tests). The full `pnpm test` belongs to the hourly `full-suite` schedule
and to nobody's iteration loop. Time in tests: `getBoxTime` honors frozen scenario time; plain
`new Date()` doesn't.
