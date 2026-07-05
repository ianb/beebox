---
name: cb-guide-testing
description: Explains callback-box's testing system — the test tiers, what each is for, and how to choose. Use when deciding how to test something, writing tests in an unfamiliar tier, or judging what coverage a change needs. Triggers include "how should I test this", "what kind of test", "add tests for X", "is this covered". Instructional (a cb-guide-* skill) — the debugging discipline is cb-debug; the full reference is docs/testing.md.
---

# Testing in callback-box: what exists and how to choose

A guide skill: motivations and the decision map. Mechanics, syntax, and
the full tier catalog live in `callback-box/docs/testing.md` — read the
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
- **Knowledge audits** (`src/dev/knowledge-audits.yaml`) — verify a *box
  agent* can recall a convention from its context without re-reading.
  New agent-facing concept → at least one audit (see cb-plan's section).
- **SSR render tests** (`cb render`, `docs/ssr-render-testing.md`) —
  pages rendered server-side with mocked state; the cheap way to check a
  page shape without a browser.
- **Browser probing** (`bin/browse`, the browse skill) — for behavior
  only a real browser shows (scroll, focus, HMR).

## Choosing

Pure logic → pure doctest. HTTP surface → route doctest. Touches box
files → filesystem doctest. Spans wakeup cycles or several steps →
scenario. Page appearance → SSR render first, browser probe second.
"Will the box agent know this?" → knowledge audit. When a change fits no
tier cleanly, that's usually a decomposition smell — split the change,
don't invent a new harness.

Run `pnpm test` before committing (pre-commit runs typecheck + lint, not
tests). Time in tests: `getBoxTime` honors frozen scenario time; plain
`new Date()` doesn't.
