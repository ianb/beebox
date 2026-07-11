# Tours — scripted browser walks for rendering + a11y review

A **tour** is a scripted walk through the running app that produces
review artifacts: screenshots at desktop (1280×800) and mobile
(375×800), accessibility-tree snapshots, axe-core violation reports,
and any soft-assertion findings the tour author wrote. Tours live in
`test/tours/*.tour.ts`; the framework is `test/tours/tour-lib/`.

**Tours are a review instrument, not a test gate.** Findings and axe
violations never affect the exit code, artifacts are gitignored, and
nothing in CI or pre-commit runs them. This is deliberate: the browser
daemon is shared and occasionally flaky, and the output is judgment
material (screenshots, a11y reports), not pass/fail facts. Do not wire
tours into pre-commit or the test suite — a soft-finding instrument
makes a permanently red gate. Behavior belongs in doctests
([testing.md](testing.md)).

## Running

```bash
bin/tour              # list available tours
bin/tour capture      # run one
bin/tour --all        # run every tour
```

Needs the shared dev router (`pnpm dev` at the monorepo root) reachable;
the worktree is auto-detected from `$PWD`, box defaults to `test1`
(`BROWSE_BOX` overrides). A healthy tour takes tens of seconds — both
viewport passes included.

**Caveat: tours share the one Chrome window with interactive
`bin/browse` use** (the per-worktree daemon holds Chrome's profile
lock, so no second instance). Don't run a tour while driving the
browser by hand — each corrupts the other's state, and the daemon can
return `os error 35` flakes under combined load.

## Artifacts

Each run writes `test/tours/.artifacts/<tour>/<runId>/` (gitignored):

- `summary.md` — open this first. Findings are listed at the top
  (❌ fail / ⚠️ warn / ℹ️ info), then one section per checkpoint with
  the desktop and mobile screenshots inlined and per-viewport axe
  violation counts.
- `<checkpoint>.<viewport>.png` — screenshot.
- `<checkpoint>.<viewport>.ax.txt` — full accessibility-tree snapshot.
- `<checkpoint>.<viewport>.axe.json` — axe violations (color-contrast
  is suppressed at run time pending
  `issues/code-quality/2026-05-28-color-contrast-wcag-aa-audit.md`; edit
  `tour-lib/axe.ts` `SUPPRESS_RULES` to re-enable).

A capture-time degradation (page-readiness timeout, axe crash) is
recorded as a ⚠️ finding rather than silently producing a
loading-state screenshot or a fake "0 violations".

## When to use tours

- **Verifying UI-touching work.** After changing a surface, run its
  tour and review `summary.md` before calling the work done — the
  visual/a11y counterpart to running tests. This catches
  "renders broken at mobile width", "lost its h1", "landmark
  disappeared" — things no doctest can see.
- **A11y sweeps.** The axe reports across `bin/tour --all` are the
  box's accessibility audit surface (a real sweep once fixed four
  structural violation classes across the app).
- **Review evidence.** When an agent builds UI, its tour artifacts are
  how a human (or another agent) audits the result without driving the
  browser themselves.

## When NOT to use tours

- **Not as a gate** — see above.
- **Not for logic or state-machine behavior** — doctests own that.
- **Not for states that need fabricated backend conditions** — that's
  the dev-harness pattern (`/dev/capture-mode`,
  `/dev/composer-states`: DEV-only routes mounting real components
  over injectable fake services). The line: **tours walk the real app;
  harnesses fabricate states.** A tour shows you what a fresh visitor
  sees; a harness shows you every state a component can be in.
- **Not for pixel-level regression** — there's no baseline/diff
  mechanism; screenshots are for human/agent eyes.

## How an agent reviews with tours

1. `bin/tour <name>`; note the console counts.
2. Read `summary.md` — findings first.
3. **View the checkpoint PNGs directly** (agents can read images):
   compare desktop vs mobile, look for clipped/overlapping/empty
   states, and report any visible breakage even when tangential to the
   task at hand.
4. Where a checkpoint shows nonzero axe violations, open its
   `.axe.json` for the nodes and failure summaries.
5. Treat ❌ findings and visible breakage as work items; ⚠️ capture
   degradations mean the artifact itself may be unreliable — re-run
   before drawing conclusions from it.

## Writing and organizing tours

- **One tour per primary surface**, named for it (`dashboard`,
  `capture`, …). Extend the surface's tour (or add a checkpoint) when
  you add UI to it — the same duty as adding a doctest for a new
  codepath.
- **Navigate by clicking** (`t.click({ role, name })`) so the tour
  exercises real navigation; use `t.go(path)` only when the deep link
  itself is the thing under review.
- **Every checkpoint asserts something** — at least one
  `expect.heading` or `expect.landmark`, so a blank-page regression
  fails loudly instead of producing a plausible-looking screenshot.
- **The header comment states what the tour can and can't reach**
  (e.g. `capture.tour.ts` notes camera permissions limit it to the
  camera-off state). Reachability limits are content, not apology.
- Keep tours short — tens of seconds. A data-driven page sweep
  (`nav-pages.tour.ts`) is fine; a ten-minute odyssey is not.

## API sketch

```ts
tour({ name, description }, async (t) => {
  await t.go("/dashboard");          // path → dev-router URL
  await t.checkpoint("loaded");      // screenshot + AX + axe, both viewports
  await t.expect.heading("Dashboard", { level: 1 });  // soft assertion
  await t.expect.landmark("Primary");
  await t.expect.button("+ Memo");
  await t.click({ role: "link", name: "Browse" });    // accessible-name locator
  await t.expect.custom("has rows", (ax) => ax.includes("row"));
});
```

Each tour runs as two full passes (desktop, then mobile). Expectations
are soft — a miss records a ❌ finding and the tour continues; only a
thrown error (unresolvable locator, browser failure) aborts a pass,
and even then the other pass still runs and reports.
