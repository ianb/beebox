---
title: "Box views: wide tables, dates, controls guidance, and view-check advice"
status: active
workstream: web-guidance-scan
issues: []
---
# Box views: wide tables, dates, controls guidance, and view-check advice

Box agents write views from the generated views doc. This plan tells them
how to keep a wide table inside the card, how to handle dates, mobile
keyboards, and announced results, removes repeated text from the views doc,
and makes `bbx view check` print advice for patterns the doc forbids. The
advice never changes the exit code.

**Issues addressed:** none resolved. Related:
- `issues/exploration/2026-11-10-adopt-modern-web-guidance-skill.md`: this
  plan does the box-view items (B1, A5, A6, A7, A9, and the box audits of
  B7) that the first plan, `modern-web-guidance-adoption.md`, left open.
  The issue also lists items this plan does not touch (its 2026-11-11 note:
  the dev-agent skill, modal-toast behaviour B11, an HSTS check at the
  edge, Trusted Types F4), so landing this plan does not close it.
- `issues/exploration/2026-09-30-replace-or-back-prompt-rules-with-lints.md`:
  this plan backs views-doc rules with checks; the issue's scope is wider.
- `issues/bugs/2026-10-24-status-and-error-text-ignore-card-material.md`:
  a different defect in the view renderer.

Searched with `bin/issues search --all` for: `view check`, `wide table`,
`overflow`, `views doc`, `views.md`, `accessibility view`, `full-bleed`,
`Temporal`, `isComposing`, `box view`, `screenshot --card`; and in open
issues for `view horizontal scroll card`, `date shows previous day`,
`view-widgets component table`, `advisory lint box views`. No open issue
covers wide view tables, view dates, or view-check advice.

Sibling plans in this workstream, written in parallel: `ui-primitives-dedup`
(a global `prefers-reduced-motion` CSS rule) and the codebase Temporal
migration. Only Track 5 here waits for the first.

## Design

No design section: this plan changes what box agents read and what
`bbx view check` prints. A person sees a change only when an agent follows
the new guidance (a wide table scrolls inside its own region). It adds no
surface, card type, or behavior.

## Smallest fix and budget

**Smallest fix.** The problem hitting the boxholder is wide tables running
out of the card. The smallest fix is the corrected Styling text and the
wrapper rule in the views doc (Track 2): about 6 doc lines. It reaches
only views an agent writes or edits after reading it.

**Chosen design, per track** (changed lines, additions plus deletions;
this plan file not counted):

| Track | Source | Tests | Docs (authored) |
|---|---|
| 1. `screenshot --card` reports content that scrolls sideways | ~8 | ~35 | ~6 |
| 2. Views doc: new rules, fixes, and one place for each rule | 0 | 0 | ~120 |
| 3. `bbx view check` advice (includes the wide-table rule, the shared IME test cases, and the advise child) | ~620 | ~600 | ~10 |
| 4. Knowledge audits (yaml) | 0 | ~70 | 0 |
| 5. Motion bullet after the global reduced-motion rule | 0 | 0 | ~4 |
| **Total** | **~630** | **~705** | **~140** |

About 1,475 changed lines in total, under the 2,000-line BIG CHANGE line.
The views doc is TypeScript template strings (`src/core/views/doc/*.ts`),
counted here as docs. `box-docs/views.md` is generated, gitignored output
and is not counted. The growth from the first draft (~825) is the review's
changes: a full port of the IME decision instead of a narrowed one, the
DOM rules' skip cases and negative fixtures, the source-scan time budget,
and the wide-table rule; the view-wide CSS rule is gone. Round 2 added
about 175 for the separate advise child and its tests.

**What the fuller design buys.** The doc fix reaches an agent only when it
reads the right section; the existing views with wide tables stay broken
until someone touches them. Track 3 names every such table and every other
forbidden pattern at the step the doc already tells agents to run
(`src/core/views/doc/testing.ts:8-13`), so "fix the tables in my views" is
one request. The real views counted below show 0 of 3 Enter handlers with
a composition check and 0 uses of Temporal.

## Stated preferences this plan trades against

- **Boxholder decisions (this workstream, 2026-11-11).** B1 advisory pass
  approved, advisory only. A5: "yes, we should be using Temporal if we're
  using Temporal." A6: keep it short. A7: approved. A9: approved. B7: box
  audits approved. No new shared components in `beebox/view-widgets` yet.
  "I strongly want to remove duplication," applied to the views doc.
- **Engineering principle 8, one way to do each thing.** Track 2 removes
  four repeated passages. Track 3 needs a second implementation of the
  IME-Enter decision because the shared code cannot reach a box (see
  Track 3, "Why not one shared implementation"). To keep the two from
  drifting, both run one set of test cases, and the copy names its source
  at the site, as principle 8 asks: *"the divergence is documented at the
  site"*.
- **Principles 11 and 12, enforcement beats convention.** Principle 11:
  *"A rule that matters gets a lint rule or a type, not a paragraph."*
  Track 3 is the only check that reaches box views (no ESLint runs in a
  box). It is advisory by boxholder decision. Advisory only is a guarantee
  this plan must keep: no advice failure or advice delay can change a view's
  result (Track 3, "Advisory-only guarantee").
- **Principle 4, never silent.** A failure or timeout inside the advice
  scan does not fail the view and does not vanish: it prints as a
  `partial` remark.
- **bbx-context attention budget.** The views doc is read on demand (the
  views skill: *"Read ... views.md before creating or modifying one"*,
  `src/core/box/guidance-sync/skills/content.ts:222`). New lines go there;
  the always-loaded guide gets nothing. Track 2 deletes more than it adds.
- **Precedent.** `bbx view check`'s `partial` channel
  (`src/cli/commands/view/check-states.ts:60-69`) is the shape for a
  non-failing remark. `src/core/views/markdown-check/core.ts` is the shape
  for a TypeScript-AST scan of a view and its local imports, including its
  error boundary (`:302-308`, *"The Markdown check could not run: …"*).
  The first plan rejects axe and DOM matchers in the check because they
  *"ship new dependencies to boxes"* (`modern-web-guidance-adoption.md`,
  NOT in scope); this plan adds none: `jsdom` is already a runtime
  dependency (`beebox/package.json` `dependencies`).

## What already exists

- **The view container.** `src/frontend/src/components/FileView/AgentViewRenderer.tsx:375`:
  *`<div className="bbx-card-view" data-view-layout={layout}>`*; `:364`
  sets `layout` to `"full-bleed"` when embedded or exported, else
  `"inset"`. The view's own React tree renders inside it (`:376-387`).
  This is the only place a box view renders in the browser: `compileView`
  has two callers, `src/cli/commands/view/render-one.ts:122` and the views
  route (`src/webapp/routes/views.ts`), whose output renders through this
  component.
- **Its CSS.** `src/frontend/src/themes/card-themes.css:177-179`:
  *`.bbx-card-view[data-view-layout="inset"] { padding: var(--bbx-content-padding, 1rem); }`*.
  No `overflow` rule on `.bbx-card-view`, `.bbx-card-surface` (`:8-15`), or
  `.bbx-card-front` (`:118-120`, *`min-width: 0;`*). So a wide table paints
  past the card's edge. This plan leaves this CSS unchanged (Track 1,
  "Rejected").
- **The wrong full-bleed advice.** `src/core/views/doc/core.ts:303-306`:
  *"For content that should reach the card's edges — a map, a wide table,
  an image grid — export `layout = "full-bleed"`"*. Full-bleed removes the
  padding only; a wide table still overflows.
- **The card-shot overflow measure.** `src/core/browser/card-shot/measure.ts:31`:
  *`const inClip=(e)=>{for(let a=e.parentElement;a&&a!==el;a=a.parentElement){if(/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX))return true;}return false;};`*
  and `:32` keeps only elements whose `overflowX` is `visible` and that
  are not `inClip`. `format.ts:38` prints *`overflow: <${o.tag}> "${o.text}" is ${px(o.excess)} wider than its box`*.
  Consequence: a table inside an `overflow-x: auto` wrapper gets no line
  today. The agent cannot tell that part of the table is off screen.
- **The settled render.** `src/cli/commands/view/settle.ts:145-147` mounts
  the view into *`container = window.document.createElement("div")`* in
  jsdom; the loop at `:168-172` waits until no read is pending; `:173`
  *`await act(async () => { root.unmount(); });`*. The settled DOM exists
  only between `:172` and `:173`. `:184-188` returns
  *`{ error: caught.error, partial }`*. The document has no app stylesheet
  (`settle.ts:58-72` installs a bare jsdom) and jsdom does no layout.
- **What jsdom resolves.** Checked with `node -e`: `getComputedStyle`
  returns `overflowX` `auto` for a class rule in a view's own `<style>`
  element and `scroll` for an inline `overflow-x`; for inline
  `overflow: auto` the `overflowX` longhand is empty but `overflow` is
  `auto`. Tailwind classes resolve to nothing (no app CSS).
- **The child-to-parent channel.** `check-states.ts:64`:
  *`export const PARTIAL_PREFIX = "bbx-view-check partial: ";`*;
  `:67-69` `partialRemarks(stdout)`. `render-one.ts:138` and `:179` print
  remarks. `command.ts:86-92` spawns the child with
  *`timeout: timeoutMs, killSignal: "SIGKILL"`*; `:104-116` turns its exit
  into a result, and a SIGKILL is *`render timed out after …`* with
  `ok: false`. `:143` *`return { ok: views.every((v) => v.ok), views };`*;
  `:203` *`process.exitCode = ok ? 0 : 1;`*. `ViewCheckResult` is
  `command.ts:42-54`. A view's own `console.log` also reaches this stdout.
- **A TypeScript-AST view scan.** `src/core/views/markdown-check/core.ts:245-258`
  loads the TypeScript 7 syntax module lazily, creates a parser, and closes
  it in `finally`; `:274-291` `problemLines` follows relative imports
  through `local-imports.ts:45` `localImportClosure`. The parser runs a Go
  process over a synchronous pipe (`src/lib/typescript/syntax.ts:1-15`,
  `:60`), so an in-process timer cannot interrupt a parse; `command.ts:60-63`
  gives the same reason for rendering in a child.
- **The IME-Enter rule.** `personal-vibe-check/rules/ime-safe-enter.ts`:
  handler forms (`:12-15`), guard forms and placement (`:17-23`,
  `isGuarded` at `:192-208`), exemptions (`:25-30`). It imports ESLint
  only as types (`:38-39`); its decision functions (`polarity`,
  `isGuarded`, `isEarlyReturnGuard`, `requiresModifier`, `isSuppressOnly`,
  `findActingEnterTest`, `:133-270`) read ESTree nodes and parent links. Its
  test (`rules/test/ime-safe-enter.test.ts:16`) holds 44 cases as code
  strings, 24 `valid` and 20 `invalid`, including a guard that is only logged and a
  guard after the action (both must report).
- **Sibling lint rules.** `personal-vibe-check/rules/aria-label-needs-role.ts`
  (aria-label on a role-less `div`/`span`/`p`/`i`/`b`) and
  `no-viewport-height-class.ts:23`
  *`const BANNED = /^!?(?:min-|max-)?h-(?:screen|\[100vh])$/;`*.
- **How beebox ships.** Production runs the bundled `dist/cli.mjs`
  (`beebox/AGENTS.md`). `src/scripts/build-cli/build/bundle.ts:50`:
  *`packages: "external",`*, so any package import stays a runtime
  `node_modules` lookup. `@ianbicking/personal-vibe-check` is a
  `devDependencies` entry (`"workspace:*"`); beebox has no workspace
  package in `dependencies` (checked with `node -e`). The preset's own
  `package.json` has `eslint` as a peer and nine `eslint-plugin-*`
  packages in `dependencies`, and its `exports` map exposes `./eslint`,
  `./plugin`, and config files, not `rules/`.
- **The controls guidance.** `src/core/views/doc/files.ts:205-227`,
  "Controls People Can Use": names, native elements, `aria-pressed`, the
  IME rule (`:218-220`), 24px targets, figure text, motion (`:225-226`),
  `dvh`.
- **Temporal at view runtime.** Browser: `src/frontend/src/main/app.tsx:77`
  *`await Promise.all([ensureTemporal(), bootstrapFileTypeRegistrations()]);`*
  runs before render; views run in the host window. Check:
  `render-one.ts:150` *`if (!("Temporal" in globalThis)) await import("temporal-polyfill/global");`*
  runs before the view module is imported at `:160`. Type check:
  `src/cli/commands/view/typecheck.ts:82` uses *`lib: ["es2020", "dom"]`*,
  but `:96-106` reports only errors in the generated harness, so a view
  that uses `Temporal` does not fail `bbx view typecheck`.
- **Frontmatter dates arrive as strings.** `src/lib/read-yaml.ts:23`
  *`import { CORE_SCHEMA, load } from "js-yaml";`*. Checked: `js-yaml` with
  `CORE_SCHEMA` reads `due: 2026-08-14` as `{"due":"2026-08-14"}`; `yaml`
  reads it the same.
- **Repeated text in views guidance.** Found by reading every section:
  - link syntax is shown twice: "Showing Files in Chat"
    (`core.ts:193-227`) and "Link vs Embed" (`core.ts:229-250`), both with
    the same "Meeting Notes" link to `_content/notes/meeting.md` (`:199`,
    `:235`);
  - `reportActivity` is explained three times: the props-table cell
    (`core.ts:123`), the companion section (`core.ts:261`), and "Reporting
    Card Activity" (`core.ts:265-299`);
  - the box-browser capture loop is in the views doc (`testing.ts:65-78`),
    the views skill (`content.ts:226`), and the browser skill
    (`src/core/box/guidance-sync/skills/content-browser.ts:58-68`);
  - the `bbx view check` mechanics are in the views doc (`testing.ts:15-35`)
    and again in the command reference
    (`src/core/docs-gen/package-docs/bbx-commands.ts:170-176`);
  - the "Filtered Dashboard" example (`src/core/views/doc/examples.ts:59-64`)
    names its input only with a placeholder, while `files.ts:212` says
    *"A placeholder is not a name."*
- **Knowledge audits already present.** `src/dev/knowledge-audits.yaml:9447`
  `view-enter-field-ime-and-name`; `:5946` `views-full-bleed-layout` (a map;
  still valid); `:5982` `views-render-test-command`; `:6182`
  `chat-screenshot-when` and `:6214` `box-page-interaction` (they rely on
  the skills Track 2 edits).

## Prior art (external)

- CSS Overflow 3: when one axis is neither `visible` nor `clip`, `visible`
  on the other computes to `auto`, so a view-wide `overflow-x: auto` makes
  the view a scroll container on both axes and changes the scroll ancestor
  of `position: sticky`. <https://www.w3.org/TR/css-overflow-3/#overflow-control>.
  Evaluated; one reason Track 1 rejects a view-wide rule.
- `display: block` on `<table>`: some WebKit/VoiceOver versions drop table
  semantics (Adrian Roselli, <https://adrianroselli.com/2018/02/tables-css-display-properties-and-aria.html>;
  not re-tested for Safari 18). Independent of semantics, the table's rows
  then sit in an anonymous table box sized to its content
  (<https://www.w3.org/TR/CSS2/tables.html#anonymous-boxes>), so a table
  written with `width: 100%` stops filling the card. Evaluated; the reason
  Track 1 rejects a table-scoped CSS rule.
- modern-web-guidance `responsive-table`: a wrapper with `overflow-x: auto`
  around the table (`research/modern-web-guidance/README.md:217`, "adopt
  with changes"). Adopted as the views-doc rule in Track 2. The wrapper is
  focusable and named so a keyboard user can scroll it (axe
  `scrollable-region-focusable`).
- modern-web-guidance `ime-safe-enter-submit`, already ported to
  `personal-vibe-check/rules/ime-safe-enter.ts` and acknowledged in
  `ACKNOWLEDGEMENTS.md` ("Modern Web Guidance, by Google Chrome"). Adopted
  again in Track 3; that chunk adds the new file to "Where it landed".
- Accessible-name computation needs reference resolution and recursive
  text alternatives (<https://www.w3.org/TR/accname-1.2/#computation-steps>);
  jsdom does no layout (<https://github.com/jsdom/jsdom#pretending-to-be-a-visual-browser>).
  Evaluated; Track 3's DOM rules report only cases that need neither.
- Temporal, checked with the installed polyfill:
  `Temporal.PlainDate.from("2026-08-14T00:00:00.000Z")` throws *"Cannot
  parse"*; `new Date("2026-08-14")` shown in `America/Chicago` is
  `8/13/2026`. Evaluated; it sets the doc wording (date-only is `PlainDate`,
  timestamp is `Instant`).

## Ontology

- **View container** (existing): the `div.bbx-card-view` around each view
  (`AgentViewRenderer.tsx:375`). Unchanged by this plan.
- **Scroll wrapper** (new term in the views doc, no code type): an element
  the view author puts around a table, with `overflow-x: auto`, a
  `role="region"`, a label, and `tabIndex={0}`.
- **Check state** (existing, `CheckState`, `check-states.ts`): one render
  of a view under `bbx view check`.
- **Partial remark** (existing, `partial` on `ViewCheckResult`): the view
  rendered but was not fully checked. Advice failures and timeouts are
  reported here.
- **Advice** (new, `ViewAdvice`): one finding of a pattern the views doc
  forbids. Fields: `rule` (an `AdviceRule`), `message` (the fix in one
  line, naming the doc section), `where` (source `file:line`, or a short
  element description from the settled DOM). It never changes `ok` or the
  exit code; a view with advice still prints `✓`.
- **Advice rule** (new, `AdviceRule`): a closed string union. Source rules:
  `enter-without-ime-check`, `clickable-non-control`, `viewport-height`,
  `date-string-parse`, `utc-today`. DOM rules: `unnamed-control`,
  `img-without-alt`, `aria-label-without-role`, `wide-table-without-wrapper`.
- **DOM snapshot** (new, `ViewDomSnapshot`): what the render child keeps
  of each settled check state for advice: `{ label, html, headStyles }`,
  where `html` is `container.innerHTML` and `headStyles` is the
  `outerHTML` of each `<style>` the view added to `document.head`. Written
  to one temp JSON file per view; not a rendered page and not run again.
- **Advise child** (new, hidden `bbx view advise <slug> --snapshot <path>`):
  a separate process the parent starts after the check outcome is fixed. It
  runs the source scan and the DOM rules and prints advice lines. It does
  not run view code.
- **Overflow finding** (existing, `MEASURE.overflow`, `measure.ts:52`).
- **Sideways scroller** (new, `MEASURE.scrolls`): a part inside the card
  whose `overflow-x` is `auto` or `scroll` and whose content is wider than
  it; `{ tag, text, hidden }`. Not an overflow finding: the content is
  reachable, but the screenshot shows only its start.

## Tracks / scope

### Track 1 — `screenshot --card` reports content that scrolls sideways

- **What.** A new line kind in `bbx browser screenshot --card`. No CSS
  change.
- **Why this needs to change.** The doc (Track 2) tells authors to wrap a
  wide table in a scroll wrapper. Today such a table is invisible to the
  measure: the wrapper is not `visible` and the table is `inClip`
  (`measure.ts:31-32`). The agent then sees a screenshot that shows the
  table's first columns and no hint that more exist.
- **Direction.**
  - `measure.ts`: add `scrolls` to the script and to `MEASURE`: every
    element under the card `article` whose computed `overflowX` is `auto`
    or `scroll` and whose `scrollWidth > clientWidth + 1`, in document
    order, at most `MAX_OVERFLOW`; `{ tag, text, hidden: scrollWidth -
    clientWidth }`. No containment filter: a scroller that holds another
    scroller is reported when it is itself wider than its box, so an outer
    scroller with its own wide content is not hidden by an inner one.
  - `format.ts`: one line per entry:
    `scrolls sideways: <div> "Prices Mon Tue …" has 412px more to the side; the image shows only its start`.
  - Doc lines: `testing.ts:73-78` and `content-browser.ts:66-68`.
- **Rejected for wide tables** (adjudicating review finding 1):
  - *A view-wide `.bbx-card-view { overflow-x: auto }`.* It changes the
    scroll contract of every view in every layout to fix tables: vertical
    overflow becomes `auto`, sticky elements stick to the view, and
    popovers and focus rings near the edge clip (Prior art). The boxholder's
    complaint is tables.
  - *A table-scoped rule (`table { display: block; overflow-x: auto }`).*
    Tables written with `width: 100%` stop filling the card, and table
    semantics in WebKit are uncertain (Prior art).
  - *A `:has()` rule on the table's parent* (`:has(> table)`). The parent is
    an author element that may hold headings and controls; the rule gives
    it the same contract change as the view-wide rule, one level down.
  - *Wrapping in the renderer.* The table is created by the view's React
    tree (`AgentViewRenderer.tsx:376-387`); moving a React-owned node into a
    new parent breaks React's reconciliation of that subtree. There is no
    other place to insert a wrapper.
  - Chosen: the doc rule (Track 2) and the `wide-table-without-wrapper`
    advice (Track 3). Existing views with wide tables stay as they are
    until an agent fixes them; the advice lists them.
- **Vocabulary lock-ins.** `MEASURE.scrolls` `{ tag, text, hidden }`; the
  output prefix `scrolls sideways:`.
- **First implementation chunk.** The measure and format change with
  tests. No open questions.
- **Verification.** `pnpm exec tap test/core/browser/card-shot/format.test.ts
  test/core/browser/card-shot/run.test.ts test/core/browser/card-shot/run.e2e.test.ts`.
  The e2e fixture (real Chrome layout) gains: a wrapped wide table; and
  an outer scroller that holds both an independently wide row and a
  wrapped wide table. Pass: the first gives one `scrolls sideways:` line;
  the second gives two (outer and inner); neither gives an `overflow:` line.

### Track 2 — Views doc: new rules, fixes, and one place for each rule

- **What.** Edit the views doc sources (`src/core/views/doc/*.ts`), the
  views skill (`content.ts`), and the command reference
  (`bbx-commands.ts`). `box-docs/` is generated; never edit it.
- **Why this needs to change.** The Styling text gives wrong advice
  (`core.ts:305`); the doc has no date rule (grep of
  `src/core/views/doc/*.ts` for `Date|Temporal` finds only `mtimeMs`
  number fields); the controls section has no keyboard-type or
  announced-result rule; one example breaks the doc's own rule; and four
  passages repeat (What already exists).
- **Direction.** New and changed text:
  - **Styling** (`core.ts:301-315`): the full-bleed examples become "a
    map, an image grid". Add: "A table with many columns does not fit a
    phone. Put it in a scroll wrapper, so only the table scrolls sideways:
    `<div role="region" aria-label="Prices" tabIndex={0} style={{ overflowX: "auto" }}>`.
    `layout = "full-bleed"` does not make a table fit."
  - **Dates** (new subsection after "ViewCard Structure", exported from
    `files.ts` because `core.ts` has 269 non-blank lines against the
    300-line `max-lines` limit): "`Temporal` is a global in views. A
    date-only value such as `due: 2026-08-14` arrives as the string
    `"2026-08-14"`. Read it with `Temporal.PlainDate.from(value)` and show
    it with `toLocaleString(undefined, { month: "short", day: "numeric" })`.
    A timestamp (`2026-08-14T09:30:00Z`) is `Temporal.Instant.from(value)`.
    Today is `Temporal.Now.plainDateISO()`; days until a date is
    `today.until(date).days`. Do not use `new Date("2026-08-14")`: it reads
    the date as midnight UTC, so a person west of UTC sees the day before.
    `new Date().toISOString().slice(0, 10)` is today in UTC, not today where
    the person is." (Each call checked against the installed polyfill.)
  - **Controls** (`files.ts:205-227`):
    - A6: "Give a field the keyboard it needs: `type="email"`, `"tel"`,
      `"url"`, or `inputMode="numeric"`; on a field where Enter sends,
      `enterKeyHint="send"`."
    - A7: "Show the result of an action ("Saved", "Copied") in an element
      with `role="status"` that is on the page before the action, and
      change its text. Put an error in `role="alert"`. A screen reader does
      not read text that arrives in a new element."
    - The name bullet (`:210-213`) gains: "an `<img>` has `alt` (`alt=""`
      for decoration)."
  - **Example fix** (`examples.ts:59-64`): the filter input gets
    `aria-label="Filter"`.
  - **Consolidation:**
    - merge "Showing Files in Chat" and "Link vs Embed" into one section
      that shows each syntax once;
    - the `reportActivity` props-table cell becomes one line ending "see
      Reporting Card Activity"; the companion section keeps the
      `zoomed-view` and `open-card` facts and points at that section;
    - the views skill (`content.ts:226`) replaces its capture loop with "To
      see a view, follow "Testing a View" in views.md", and keeps its two
      facts found nowhere else (do not use `bbx chat screenshot`; `bbx chat
      ui` for where a control is);
    - `bbx-commands.ts:170-176` keeps the synopsis, one sentence, the exit
      rule, and the pointer to views.md.
- **Vocabulary lock-ins.** Section names "Dates" and "Controls People Can
  Use" (Track 3's messages name them); the term "scroll wrapper".
- **First implementation chunk.** All of the above. No open questions.
- **Verification.** `pnpm exec tap test/core/views/markdown-check.test.ts`
  (it runs every `tsx` block of `generateViewsDoc()`,
  `markdown-check.test.ts:123-124`); regenerate box docs and read the diff
  of `box-docs/views.md`; `pnpm doc-check`. In a real browser with the
  browse skill, using fixture views written for this in the worktree's
  test1 clone (`~/src/box-worktrees/web-guidance-scan/test1/src/views/`,
  generic content), at 390×844 and 1280×900:
  - the doc's scroll wrapper around a 9-column table. Pass: the table
    scrolls inside the card and the page does not scroll sideways; Tab
    reaches the wrapper, its focus ring is fully visible, and the arrow
    keys scroll it; a screen-reader snapshot (`snapshot`) names the region.
  - a view showing `Temporal.PlainDate.from(card.frontmatter.due)`. Pass:
    the date shows (Chrome, native Temporal), and `bbx view check` passes
    it (polyfill path).
  Delete the fixtures after.

### Track 3 — `bbx view check` advice

- **What.** A source scan and a settled-DOM scan that report `ViewAdvice`
  for patterns the views doc forbids. Printed under the view's `✓` or `~`
  line and included in `--json`; never part of `ok`.
- **Why this needs to change.** No check reaches box views except render
  failure and the Markdown rule. The real views counted in Scenario 4 have
  unwrapped tables, an unguarded Enter handler, and UTC "today" values,
  against doc rules that say otherwise.
- **Direction.**
  - New directory `src/core/views/advice/`:
    - `types.ts`: `AdviceRule`, `ViewAdvice`, a zod schema for the child
      line.
    - `ime-enter.ts`: the IME-Enter decision ported in full from
      `ime-safe-enter.ts:133-270` to the TypeScript AST: the same handler
      forms, the same guard polarity, the same rule that a guard counts
      only in the Enter test's own `&&` chain, an enclosing `if`, or an
      early `if (<composing>) return;` before it, and the same three
      exemptions. A guard that is only logged, or that comes after the
      action, does not count (fixing the first draft's weaker "read
      anywhere before Enter").
    - `source.ts`: `sourceAdvice(syntax, fileName, source): ViewAdvice[]`,
      pure over one parsed file. Rules:
      - `enter-without-ime-check`: from `ime-enter.ts`.
      - `clickable-non-control`: a JSX `div`, `span`, `li`, `td`, `tr` or
        `p` with `onClick`, no `role` attribute, and no spread.
      - `viewport-height`: a string or template literal containing `100vh`,
        or a class token matching `no-viewport-height-class.ts:23`'s pattern.
      - `date-string-parse`: `new Date(x)` with one argument, where `x` is
        a string or template literal, a `+` with a string-literal operand,
        an identifier, or a property read; not reported for a numeric
        literal, arithmetic, a call, or a name ending in `Ms` (`mtimeMs` is
        a documented `ViewFile` field, `core.ts:111`).
      - `utc-today`: `.toISOString()` followed by `.slice(0, 10)`,
        `.substring(0, 10)`, or `.split("T")[0]`.
    - `core.ts`: `viewSourceAdvice(viewAbsPath, { root })`: parses the view
      and its local imports, merges by rule, closes the parser in
      `finally`. `where` entries are paths relative to the views directory
      with line numbers.
    - `dom.ts`: `domAdvice(container: Element): ViewAdvice[]`, pure over a
      DOM subtree. It reports only what jsdom can show is wrong without
      layout, styles, or name computation:
      - **Two skip sets** (adjudicating round-2 finding 5). *Not shown*:
        an element inside `[hidden]`, an ancestor with computed
        `display: none`, a closed `<dialog>`, or the non-`summary` content of
        a closed `<details>`. *Not exposed to assistive technology*: an
        element inside `[aria-hidden="true"]` or `[inert]`. The naming rules
        (`unnamed-control`, `img-without-alt`, `aria-label-without-role`)
        skip both sets. `wide-table-without-wrapper` skips only *not shown*:
        a table that is `aria-hidden` or `inert` still paints past the card.
      - `unnamed-control`: `button`, `a[href]`, `select`, `textarea`, and
        `input` (not `hidden`, `submit`, `reset`, `button`, `image`) that
        has no `aria-label`, `aria-labelledby`, or `title` attribute (any
        value: the rule does not resolve or judge them), is not inside a
        `<label>`, and has no `label[for]` matching its `id`. For `button`
        and `a`, also no text content and no descendant with `alt`,
        `aria-label`, `aria-labelledby`, `title`, or an SVG `<title>`
        (a descendant that may supply a name skips the element). Not
        caught, by design: empty labels, dangling `aria-labelledby`, and
        text only inside `aria-hidden` descendants.
      - `img-without-alt`: `img` with no `alt` attribute and no
        `role="presentation"`/`"none"`.
      - `aria-label-without-role`: `div, span, p, i, b` with `aria-label`,
        no `role`, and no spread-origin doubt (DOM has none).
      - `wide-table-without-wrapper`: a `table` whose row with the most
        cells has 4 or more, with no ancestor below the container that
        scrolls horizontally, and no ancestor class token
        `overflow-x-auto`, `overflow-x-scroll`, `overflow-auto`, or
        `overflow-scroll` (Tailwind is not loaded in the check). jsdom
        cannot measure width, so the cell count stands in for "wide"; a
        table of 3 or fewer columns gets no advice.
      - **Horizontal overflow of an element** (adjudicating round-2
        finding 4): `horizontalOverflow(style)` returns the computed
        `overflowX` when it is set; otherwise the first value of the
        computed `overflow` shorthand (CSS Overflow 3: the first value is
        the x axis). It scrolls when that value is `auto` or `scroll`.
        Checked against the installed jsdom with `node -e`:
        `overflow: auto; overflow-x: hidden` gives `overflowX` `hidden`
        (does not scroll; correct), and `overflow: auto hidden` gives an
        empty `overflowX` and `overflow` `auto hidden` (scrolls; correct).
        jsdom does not expand the shorthand into longhands, so
        `overflow-x: hidden; overflow: auto` reports `overflowX` `hidden`
        where a browser scrolls: the rule then gives advice for a table
        that is already wrapped. Accepted as a documented jsdom limit; a
        fixture records it.
      Each `where` is the element's opening tag cut to 60 characters.
  - `src/core/views/markdown-check/local-imports.ts` moves to
    `src/core/views/local-imports.ts` (now imported by two units; file
    layout rule 3). Confirm with `pnpm layout-check --explain src/core/views`
    before adding files.
  - **Advisory-only guarantee** (redesigned in round 2, findings 1–3).
    The render child does no advice work. The parent fixes the check
    outcome first, then runs advice in a separate child with its own
    timeout:
    1. **Render child, unchanged gates.** `settledRender` gains one step
       after the loop (`settle.ts:172`) and before unmount (`:173`): when
       `caught.error === null`, it returns `snapshot` (`container.innerHTML`
       and the head `<style>` elements, both strings). Serializing is linear
       in the DOM and has no rule logic. `render-one.ts` collects one
       snapshot per state, and only when it is about to return 0 (after the
       invalid-dependency-card gate at `:189-197`, so `--allow-invalid-cards`
       works as today) writes them to one JSON file in `os.tmpdir()` and
       prints one line, `bbx-view-check snapshot: <path>`. A failing render
       writes no file.
    2. **Parent outcome, unchanged.** `checkOneView` decides `ok`,
       `timedOut`, `error`, and `partial` from the render child exactly as
       `command.ts:104-116` does now.
    3. **Advice, only for a passing view.** When `ok` is true, the parent
       spawns `bbx view advise <slug> --snapshot <path>` with
       `buildScriptEnv`, `timeout: ADVICE_TIMEOUT_MS` (5,000) and
       `killSignal: "SIGKILL"`, the same pattern as `command.ts:86-92`. The
       advise child parses the source scan's files and, per state, builds a
       jsdom document from `headStyles` and `html` (scripts are not run:
       jsdom's default `runScripts` is off), runs `domAdvice`, and prints
       one `bbx-view-check advice: <json>` line per finding.
    4. **Advice failures.** A kill gives the partial remark `advice not
       checked: timed out after 5s`; a non-zero exit gives `advice not
       checked: <first stderr line>`; an unreadable line gives `advice not
       checked: unreadable output`. None changes `ok`. The parent deletes
       the snapshot file in `finally`.
    The advise runner is a caller argument
    (`checkViews({ …, advise?: AdviseRunner })`, default the real spawn), so
    tests can supply a real slow or crashing process and measure the wall
    time. The source parser closes in `finally` inside the advise child; a
    killed advise child takes its parser process down with its pipe (checked
    in the timeout test).
  - **What a snapshot loses, by rule.** HTML keeps attributes, so it keeps
    everything the DOM rules read: names (`aria-*`, `title`, `alt`, `for`),
    `role`, `hidden`, `inert`, `open` on `<details>` and on a dialog opened
    with `showModal()`, inline `style` (React writes `style` as an
    attribute), and `<style>` elements in the view. It loses: form-control
    properties such as `value` (no rule reads them); styles added through
    the CSSOM (`insertRule`, `adoptedStyleSheets`) and shadow roots. For
    `wide-table-without-wrapper` a CSSOM-only wrapper style is missed, so
    the rule may advise wrapping a table that is wrapped; the message says
    "if this table does not already scroll". The naming rules do not read
    styles except `display: none` for the skip set, where the same loss
    can flag a control that is not shown; accepted, advisory only.
  - **Size.** A snapshot over 5 MB for one state is not written; the
    parent prints `advice not checked: page too large`.
  - **Plumbing.**
    - `check-states.ts`: `SNAPSHOT_PREFIX`, `ADVICE_PREFIX =
      "bbx-view-check advice: "`, and `adviceLines(stdout): { advice:
      ViewAdvice[]; unreadable: number }` (zod at the boundary).
    - `settle.ts`: return `snapshot` beside `partial`.
    - `render-one.ts`: collect snapshots; write the file and print its
      path just before `return 0`.
    - New `src/cli/commands/view/advise.ts`: the hidden `advise` command
      and `runAdvice` (spawn, timeout, parse).
    - `command.ts`: `advice?: ViewAdvice[]` on `ViewCheckResult`, merged by
      rule across states with `where` deduplicated. Text output after the
      view's line and remarks: `    advice: <message> — views/<file>:<line>`
      (at most 3 `where` entries, then `and N more`). Summary appends
      `, N with advice`. `ok` is computed as today (`:143`).
    - The per-view wall time grows by the advise child's start and run
      (one CLI start plus parsing); measure it on the Scenario 4 corpus
      and record it.
  - Docs: one paragraph in `testing.ts` after the partly-checked paragraph
    (`:30-35`): what `advice:` lines mean, that they do not fail the check,
    that an agent may leave one with a stated reason, and that each names
    its doc section. One clause in `bbx-commands.ts`.
  - `ACKNOWLEDGEMENTS.md`, "Modern Web Guidance": add
    `beebox/src/core/views/advice/` to "Where it landed".
- **Why not one shared implementation of the IME decision** (adjudicating
  review finding 3). The reviewer is right that the rule's decision
  functions use no ESLint runtime API. The blocker is where shared code can
  live:
  - In `personal-vibe-check`: the beebox bundle keeps every package import
    external (`bundle.ts:50`), so a box would need the preset installed at
    runtime. It is a dev dependency, its `exports` map does not expose
    `rules/`, and installing it brings ESLint as a peer and nine ESLint
    plugins into every box.
  - In beebox: the preset would then depend on beebox, the application it
    lints; the preset is a standalone package (root `AGENTS.md`: *"Shared
    ESLint/TypeScript/Prettier preset ... Edit it here"*).
  - In a new dependency-free workspace package: beebox has no workspace
    package in `dependencies` today, so the release would need a new
    packaging path for one ~200-line module.
  - A relative import from beebox into `../personal-vibe-check/` would be
    inlined by the bundle, but crosses the package boundary; there is no
    such import anywhere in `beebox/src` (grep found none).
  Chosen instead: one set of test cases. All 44 cases (24 valid, 20
  invalid) move unchanged from
  `rules/test/ime-safe-enter.test.ts` into
  `personal-vibe-check/rules/test/ime-safe-enter.cases.ts`
  (`{ valid: string[]; invalid: string[] }`), exported through a new
  `./rules/ime-safe-enter.cases` entry in the preset's `exports`. The
  ESLint test and beebox's `advice.source.test.ts` (tests may import dev
  dependencies) both run every case. A case that one implementation passes
  and the other fails fails a test. The beebox file states at its top that
  it is a port and names the source and the shared cases.
- **Vocabulary lock-ins.** `ViewAdvice`, the `AdviceRule` ids, `advice`
  in `--json`, the `bbx-view-check advice: ` and `bbx-view-check snapshot: `
  prefixes, the hidden `bbx view advise` command, `ADVICE_TIMEOUT_MS`,
  the `advice:` output label.
- **First implementation chunk.** The shared cases file and its exports
  entry; `types.ts`, `ime-enter.ts`, `source.ts`, `core.ts` with tests;
  the `local-imports.ts` move; the snapshot file, the `advise` command,
  and `runAdvice` with source advice only, with their tests. No open
  questions.
- **Verification.** Unit tests (What will hold this). `bbx view check` in
  the worktree test1 clone (expect no advice: its `todos.tsx` and
  `recipe.tsx` contain none of the patterns). Then Scenario 4.

### Track 4 — Knowledge audits

- **What.** Four new box audits in `src/dev/knowledge-audits.yaml`, and
  reruns of five existing ones. See Knowledge audits.
- **First implementation chunk.** The four entries, each run once against
  the worktree test1 clone after Tracks 2 and 3, with status comments.
- **Verification.** Each new audit passes, or its failure is fixed in the
  doc and rerun.

### Track 5 — The motion bullet, after the global reduced-motion rule

- **What.** Shorten `files.ts:225-226` to: "Animation driven by script
  (`requestAnimationFrame`, a canvas loop, a timer) stops when
  `matchMedia("(prefers-reduced-motion: reduce)").matches`. The app stops
  CSS animations and transitions for a person who asks for reduced motion."
- **Why.** The sibling plan `ui-primitives-dedup` adds a global
  `prefers-reduced-motion` rule. Box views render only inside the app
  document (`AgentViewRenderer.tsx:375`), so the rule reaches them; the
  view author owns only script-driven motion. For the same reason this plan
  has no animation advice rule.
- **Dependency.** Only after that rule is on `main`. If it is not there
  when this plan finishes, leave the bullet unchanged; it is still correct.
- **Verification.** `markdown-check.test.ts`; read the generated doc.

### Scenario walks

Code in these walks is synthetic. Real views appear only in Scenario 4,
as file names, line numbers, and counts.

**1. A box agent writes a view with a wide table.**
1. The agent loads the views skill (`content.ts:216-226`) and reads
   `node_modules/beebox/box-docs/views.md`, generated from
   `src/core/views/doc/*.ts`.
2. Today it reads `core.ts:305` and may export `layout = "full-bleed"`;
   the table still paints past the card. After Track 2 it reads the
   scroll-wrapper rule and wraps the table.
3. On save, the hook runs the Markdown check (`sdk-hooks.ts:20`);
   unchanged.
4. `bbx view check`: `checkViews` (`command.ts:131`) spawns `render-one`.
   If the agent left out the wrapper and the table has 4 or more columns,
   the settled DOM gives `wide-table-without-wrapper`; `✓ <slug>` plus one
   `advice:` line; exit 0.
5. `bbx browser screenshot --card` at 390 wide: without a wrapper,
   `overflow: <table> … wider than its box` (unchanged). With the wrapper,
   today nothing; after Track 1, `scrolls sideways: <div> … has Npx more`.
6. A person on a phone scrolls the table inside its region; the page and
   the rest of the view do not move.

**2. A box agent writes a chat-like input with Enter-to-send.**
1. The agent reads "Controls People Can Use": the IME rule
   (`files.ts:218-220`), and after Track 2 `enterKeyHint="send"` and the
   status rule.
2. Synthetic view: `<textarea placeholder="Message" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />`.
3. `bbx view check`: the render child passes and writes the snapshot;
   the parent then runs the advise child, which prints
   `enter-without-ime-check` at `views/<slug>.tsx:<line>` and, from the
   snapshot, `unnamed-control` (a placeholder only). Output: `✓ <slug>` and two
   `advice:` lines; exit 0.
4. The agent adds `if (e.nativeEvent.isComposing) return;` at the top of
   the handler and an `aria-label`. The early-return guard controls the
   Enter test, so the next check prints no advice. Had it written
   `console.log(e.nativeEvent.isComposing)` instead, the advice would stay.
5. After a send, the view changes the text of a `role="status"` element
   that was present before (A7).

**3. A box agent shows a todo's due date.**
1. A todo is a Markdoc tag in a card body (`{% todo due="2026-07-01" %}`,
   `src/schemas/todo-review-job.ts:79`). A view shows a body only through
   `<Markdown>` (`files.ts:168-180`); reading `body` otherwise, or writing
   `{%` in a regex, is an error on save (`markdown-check/core.ts`, rules 2
   and 3). The widget formats the date through `FriendlyDate`, already on
   Temporal (`modern-web-guidance-adoption.md`, Category G). The agent does
   not parse a todo's date.
2. For a date field in frontmatter (`due: 2026-08-14` on a box card type),
   the view receives the string `"2026-08-14"` (`read-yaml.ts:23`,
   checked). After Track 2 the agent writes
   `Temporal.PlainDate.from(card.frontmatter.due)` and shows "Aug 14".
3. In the browser `Temporal` exists before the view runs (`app.tsx:77`);
   in the check the polyfill loads before the view module
   (`render-one.ts:150`, `:160`); `bbx view typecheck` does not flag the
   global (`typecheck.ts:96-106`).
4. If the agent writes `new Date(card.frontmatter.due)`, the check prints
   `date-string-parse`; west of UTC the date would show one day early
   (checked: `8/13/2026` in `America/Chicago`).

**4. `bbx view check` on the real views counted in the research.**
Corpus: the test box's views and the views in the local box backups (`~/src/boxes/`). The run uses
rsync copies in the scratchpad, never the originals
(`docs/box-work.md`, "Rules for every box"), with this worktree's engine.
Findings stay in the scratchpad and chat; only counts reach tracked files. Expected, from greps of the corpus on
2026-11-11 (the DOM counts are estimates: the DOM pass sees only what the
check states render):

| Rule | Expected |
|---|---|
| `enter-without-ime-check` | 1 of 3 Enter handlers |
| `utc-today` | 5 in 4 files |
| `date-string-parse` | about 9 in 4 files |
| `viewport-height` | 1 |
| `clickable-non-control` | up to 5 in 2 files |
| `wide-table-without-wrapper` | up to 6 in 5 files (tables with fewer than 4 columns drop out) |
| `unnamed-control` | 10–30, most in one file |
| `img-without-alt` | up to 5 |
| `aria-label-without-role` | up to 4 |

In total about 45–65 advice entries across about 15 view files, exit code
unchanged. `test1` and the worktree clone: none. A count far from these is
a finding: read the hits privately before shipping, and narrow a rule that
is mostly false positives.

## Could this be simpler?

- **Simplest version: doc lines only, no check, no measure change.** It
  states the table rule and the new rules. It fails in two ways. The
  existing views with wide tables stay broken with nothing that names
  them. And an agent that does not reread "Controls People Can Use" writes
  Enter handlers and UTC dates that nothing flags, per principle 11 (*"A
  rule that matters gets a lint rule or a type, not a paragraph"*) and
  principle 12 (the maintainer is an agent that holds no memory between
  sessions). `bbx view check` is the step the doc already tells agents to
  run.
- **A universal CSS fallback for tables.** Considered and rejected
  (Track 1, "Rejected"): every CSS route changes layout for views that
  have no wide table.
- **Source scan only.** It fails on wide tables and control names: only
  the settled DOM sees the table a loop renders and the text in
  `<button>{label}</button>`. The DOM pass stays, narrowed to cases jsdom
  can prove.
- **A narrowed IME port** (the first draft). Rejected after review: it
  accepted a guard that was only logged. The full port with shared cases
  costs about 120 more source lines and keeps one behavior in both places.
- **Fewer rules.** Dropped: the animation rule (Track 5's global CSS), the
  `role="dialog"` rule (0 hits in the corpus). Each remaining rule maps to
  one sentence of the doc and has hits in the corpus.
- **Track 1.** About 8 source lines. Without it, the doc's scroll wrapper
  makes the screenshot hide the table's other columns with no signal.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|
| The advise child crashes (the TypeScript process does not start, a parse or read error, a DOM-rule throw) | Planned: a crashing advise runner; `✓`, remark, exit 0 | Partial remark `advice not checked: <reason>` | Clear |
| The advise child is slow or hangs | Planned: a real process that sleeps; the check returns within the advice timeout plus a margin, `✓`, exit 0 | Parent SIGKILL at `ADVICE_TIMEOUT_MS`; remark `timed out after 5s` | Clear |
| A dependency card is invalid and advice would time out | Planned: without `--allow-invalid-cards`, `✗` and the advise runner never starts; with it, `✓` and the timeout remark | Advice runs only after the render child's full outcome | Clear |
| Advice differs between states | Planned: a view with `checkStates` whose second state alone has a finding; merged, deduplicated | Merge by rule | n/a |
| A killed advise child leaves the TypeScript Go process running | Planned: the timeout test checks no child process remains | The Go process reads a closed pipe and exits; verify | Silent if not; the test makes it clear |
| A snapshot loses a CSSOM-only wrapper style | Planned fixture | Message says "if this table does not already scroll" | Clear (one extra line) |
| A snapshot is too large | Planned | Not written; remark `page too large` | Clear |
| The snapshot temp file is left behind | Planned | Parent deletes it in `finally`; a failing render writes none | n/a |
| A view prints a line that starts with the advice prefix | Planned | zod rejects it; unreadable-advice partial remark | Clear |
| `unnamed-control` flags a button named by a `role="img"` child | Planned negative fixture | Any naming attribute on a descendant skips the element | n/a |
| `unnamed-control` misses an empty `aria-label` or dangling `aria-labelledby` | Planned fixture asserting no advice | Accepted: the rule does not compute names | Silent; documented in the rule and here |
| A hidden or inert subtree is flagged by a naming rule | Planned negative fixtures (`hidden`, `display: none`, `inert`, `aria-hidden`, closed `details`, closed `dialog`) | Both skip sets | n/a |
| A visible unwrapped wide table inside `aria-hidden` or `inert` gets no advice | Planned positive fixture | The table rule skips only *not shown* | n/a |
| A wrapper's horizontal overflow is misread from longhand and shorthand | Planned fixtures: `overflow: auto; overflow-x: hidden` (advice), `overflow: auto hidden` (no advice), `overflow-x: hidden; overflow: auto` (advice; jsdom limit) | `horizontalOverflow` | Clear |
| `wide-table-without-wrapper` flags a 4-column table that fits a phone | Planned | Advisory only; the threshold is in one constant | Clear (one extra line) |
| A wrapper styled by Tailwind `overflow-x-auto` is not seen (no app CSS in jsdom) | Planned | Class tokens checked | n/a |
| `date-string-parse` flags `new Date(epochNumberVariable)` | Planned negative cases (`mtimeMs`, arithmetic, calls) | A plain identifier is still flagged; advisory only | Clear |
| The ported IME decision drifts from the ESLint rule | Planned: both run the shared cases | Shared cases file | Clear (a test fails) |
| A large view floods the output | Planned | `where` capped at 3 per rule | Clear |
| Advice changes the exit code and breaks a migration's `validate.shells` gate | Planned: `command.check.test.ts` asserts exit 0 with advice | `ok` computed as today | n/a |
| A doc `tsx` example triggers source advice | Planned: test over every doc example | Fix the example | Clear |
| An outer scroller is hidden by an inner one in `screenshot --card` | Planned e2e nested fixture | No containment filter | n/a |

No critical gap. The one silent row (names the rule does not compute) is
an accepted limit of an advisory check that reports only what it can prove.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field.** ADDRESSED: an agent that picks
  `full-bleed` for a wide table is corrected by the Styling text (Track 2)
  and by `wide-table-without-wrapper` (Track 3).
- **Stale ref.** Not applicable: advice names source lines and DOM
  elements of the current render.
- **Two agents touching the same card.** Not applicable: `bbx view check`
  writes nothing (`testing.ts:30-35`; writes become partial remarks,
  `settle.ts:129-132`).
- **Hand-edit drift.** ADDRESSED: a boxholder's hand-written view gets the
  same advice; it never fails, so it does not block them.
- **Fabricated free-form value.** Not applicable: no new free-form field.
- **Validation error UX.** ADDRESSED: each message states the fix, names
  the doc section ("Dates", "Controls People Can Use", "Styling"), and
  gives `file:line` or the element's opening tag.
- **Partial migration / transition state.** ADDRESSED: existing views are
  unchanged; advice appears the next time an agent runs the check.
  Existing `Date` code and unwrapped tables stay until an agent fixes them.
- **An agent treats advice as failure and loops.** GAP, low cost: an agent
  may keep editing to clear a false positive. The testing paragraph says
  advice may be left with a reason; audit `view-check-advice-meaning`
  tests this.

## NOT in scope

- A CSS change for wide view content (view-wide, table-scoped, or `:has()`):
  each changes layout for views without wide tables (Track 1, "Rejected").
- New shared components in `beebox/view-widgets` (a `Table` with a scroll
  wrapper): deferred by the boxholder.
- Sharing the IME decision code at runtime: no package path reaches boxes
  today (Track 3); shared test cases instead.
- An animation advice rule: the global reduced-motion rule in
  `ui-primitives-dedup` reaches views (Track 5).
- Accessible-name computation in the check (resolving `aria-labelledby`,
  recursive text alternatives): beyond an advisory pass; the DOM rules
  report only provable cases.
- Advice on save, or advice that fails the check: the boxholder chose
  advisory only.
- axe-core or upstream matchers in boxes: new dependencies, as the first
  plan ruled.
- `role="dialog"`, touch-target size, and hover-only controls: 0 corpus
  hits, or jsdom has no layout.
- Identifier fields (`spellCheck`, `autoCapitalize`) in A6: the boxholder
  asked to keep A6 short.
- Hard-coded light colors in views and in the doc's dashboard example
  (A10): unverified how card themes reach views.
- Editing existing box views to clear advice: box content belongs to each
  boxholder; agents fix it when asked or when they next touch a view.
- The codebase Temporal migration: the sibling plan.
- The originating issue's other open items (dev-agent skill, B11, HSTS,
  F4): not this plan.

## Open design questions

1. **Run source advice on save as well?** Lean: no. Save-time output
   becomes noise on every edit, and the boxholder asked for the check.
   Revisit if audits show agents skip `bbx view check`.
2. **Flag `date-string-parse` when the view adds a time of day before
   parsing (a synthetic example: `new Date(iso + "T12:00")`)?** That form
   avoids the UTC shift. Lean: yes, per the boxholder's "we should be using
   Temporal". If the Scenario 4 run shows such forms are most of the
   rule's output and the boxholder finds them noise, narrow the rule.
3. **The 4-column threshold for `wide-table-without-wrapper`.** Lean: 4.
   Adjust once after the Scenario 4 run if most hits fit a phone.

## Knowledge audits

New box audits (Track 4), each run once with
`pnpm knowledge-audit run --box ~/src/box-worktrees/web-guidance-scan/test1 --filter <id>`,
status comment recorded:
- `view-date-only-temporal` (`knows_about`, should read `views.md`):
  "A card type has `due: 2026-08-14` in its frontmatter. In its view I want
  'Aug 14' and how many days are left. How do you read and show it?"
  Pass: `Temporal.PlainDate.from`, `Temporal.Now.plainDateISO`/`until`;
  fails if it parses with `new Date(due)` or `toISOString().slice`.
- `view-wide-table-scroll` (`knows_about`): "My view's table has nine
  columns and runs off the card on my phone. What do you change?" Pass: a
  scroll wrapper with `overflow-x: auto`, named and focusable; fails if it
  proposes `full-bleed` as the fix.
- `view-announce-action-result` (`knows_about`): "After the Save button in
  my view works, how should the view tell the person, including a screen
  reader user?" Pass: change the text of a `role="status"` element present
  before the action; errors in `role="alert"`.
- `view-check-advice-meaning` (`knows_about`): "`bbx view check` printed
  `✓ planner` and then two `advice:` lines. Did the check fail? What do you
  do?" Pass: not a failure; fix each using the named doc section, or say
  why it does not apply.

Reruns, because Track 2 changes the text they read:
`view-enter-field-ime-and-name` (`:9447`), `views-full-bleed-layout`
(`:5946`), `views-render-test-command` (`:5982`), `chat-screenshot-when`
(`:6182`), `box-page-interaction` (`:6214`).

Skipped with reason: A6 (keyboard types) gets no audit. The failure leaves
the default full keyboard; the boxholder expects few such fields.

## What will hold this after it ships

- **Unit tests on pure functions.** `sourceAdvice`, `domAdvice`, and
  `horizontalOverflow` take strings, an `Element`, or a style and return
  values, so the rule decisions are tested without spawning a child. Planned files (names confirmed by
  `pnpm layout-check`): `test/core/views/advice.source.test.ts` (each rule,
  each exemption, and every case in `ime-safe-enter.cases.ts`),
  `test/core/views/advice.dom.test.ts` (jsdom; positive cases and the
  negative fixtures in Failure modes), and `advise.test.ts` for
  `runAdvice` with real slow and crashing processes, timing included.
- **Shared IME cases.** `personal-vibe-check/rules/test/ime-safe-enter.test.ts`
  and `advice.source.test.ts` both run `ime-safe-enter.cases.ts`.
- **Doc examples.** A test runs `sourceAdvice` over every `tsx` block of
  `generateViewsDoc()`, beside the Markdown one at
  `markdown-check.test.ts:123`.
- **Plumbing.** `test/cli/commands/view/command.check.test.ts` gains a
  fixture view with one source and one DOM finding: `✓`, two `advice:`
  lines, `--json` `advice`, exit 0; the invalid-card cases with and
  without `--allow-invalid-cards`; and a multi-state view.
  `command.render-one.settled.test.ts` checks the snapshot of a settled
  state.
- **Card-shot.** `format.test.ts` for the new line; `run.e2e.test.ts` with
  the wrapped table and the nested scrollers (real Chrome layout).
- **Knowledge audits** hold the doc rules. No new test tier.

## Implementation order

Before code: this plan's review is adjudicated (see Review), then a
`bin/coding-feedback add --checkpoint plan-reviewed` entry.

1. Track 1: measure and format change, tests.
2. Track 2: views doc edits, skill and command-reference consolidation,
   example fix; browser checks of the scroll wrapper and Temporal.
3. Track 3a: shared IME cases in the preset; `advice/types.ts`,
   `ime-enter.ts`, `source.ts`, `core.ts`; the `local-imports.ts` move; the
   snapshot file, the `advise` command, and `runAdvice`; tests; doc-example
   test.
4. Track 3b: `dom.ts` with `horizontalOverflow` and the two skip sets,
   DOM advice in the advise child, merge across states, output;
   tests; `testing.ts` and `bbx-commands.ts` lines; `ACKNOWLEDGEMENTS.md`.
5. Scenario 4 run on throwaway copies; compare with the expected table;
   narrow any rule that is mostly false positives. Then Track 4 audits.
6. Track 5, only if the global reduced-motion rule is on `main`.

Each chunk is a commit or a few. The plan ships as one piece, when the
boxholder says so.

## Rollout shape

- **Tests first.** Each rule's positive and negative cases are written
  before the rule. Done when these pass:
  `advice.source.test.ts`, `advice.dom.test.ts`, `advise.test.ts`, the preset's
  `ime-safe-enter.test.ts`, `markdown-check.test.ts`,
  `command.check.test.ts`, `command.render-one.settled.test.ts`,
  `card-shot/format.test.ts`, `run.test.ts`, `run.e2e.test.ts`; and
  `pnpm test:changed`, `pnpm typecheck`, `pnpm lint:changed`,
  `pnpm layout-check`, `pnpm doc-check`.
- **Browser evidence.** The Track 2 checks at two widths, presented as one
  exhibit (`bin/exhibits add`) with captions written by what a person
  sees.
- **Knowledge audits** land with Track 4, run and recorded.
- **Cross-model review** of the implementation before declaring it done.
- **No data migration.** Box files are unchanged.

## Review

Cross-model plan review (codex, 2026-11-11,
`scratch/cross-model/box-view-plan.run.log`). Each finding checked against
the source:
1. *View-wide `overflow-x: auto` changes every view's scroll contract.*
   Accepted. Verified the shared wrapper (`AgentViewRenderer.tsx:364`,
   `:375`) and the overflow computation rule. Dropped all CSS; table-local
   containment by doc rule plus `wide-table-without-wrapper` advice.
   Table-scoped CSS, `:has()`, and renderer wrapping evaluated and rejected
   (Track 1). The browser check now has pass criteria for the wrapper
   (scrolling, focus visibility, keyboard scrolling, name).
2. *No source-scan containment or budget.* Accepted. Verified the
   synchronous Go-process parser (`syntax.ts:1-15`, `:60`) and the
   child's SIGKILL timeout (`command.ts:86-92`). Added the rendered marker,
   `ADVICE_BUDGET_MS`, `viewCheckResultFrom` (all replaced in round 2,
   below), error containment, parser
   cleanup, and tests.
3. *The IME duplication rests on a false impossibility.* Partly accepted.
   The rule does not need ESLint at runtime (`ime-safe-enter.ts:38-39`).
   Sharing the code is still blocked by packaging (`bundle.ts:50`; the
   preset is a dev dependency with ESLint plugins; no workspace runtime
   dependency exists); the blocker is recorded in Track 3. Replaced the
   narrowed port with a full port and shared test cases. Fixed the "read
   anywhere before Enter" weakness.
4. *DOM rules confuse markup presence with names.* Accepted. Narrowed to
   provable cases, added skipped subtrees and negative fixtures; name
   computation is NOT in scope.
5. *Innermost-only scroller reporting hides outer scrolling.* Accepted.
   Removed the containment filter; nested e2e fixture.
6. *Scenario 4 exceeds the private-content boundary.* Accepted. Removed
   handler details, the role fragment, and date-construction descriptions
   tied to private files; scenario code is synthetic and labelled so.
7. *The originating issue must not be closed by this plan.* Accepted.
   `issues: []`; listed as related.

Round 2 (codex, 2026-11-11, `scratch/cross-model/box-view-plan-r2.run.log`).
Round-1 findings 1, 3, 5, 6, 7 judged to hold; 2 and 4 not fully. New
findings, each checked:
1. *DOM advice inside `settledRender` uses the render timeout.* Accepted:
   it ran at `settle.ts:172`, before the next state. Redesigned: the render
   child only serializes the settled DOM; rules run in the advise child.
2. *The marker came before the invalid-card gate.* Accepted: verified
   `render-one.ts:189-197` runs after all states. Removed the marker; the
   snapshot is written only on the `return 0` path, and the parent runs
   advice only after the outcome is fixed. Tests cover both flag settings.
3. *The 3-second budget had no enforceable deadline.* Accepted: the parser
   is synchronous (`syntax.ts:5`). Replaced by a parent-enforced SIGKILL
   timeout on a separate advise child; tests use real slow processes and
   measure time.
4. *Computed `overflowX`-or-`overflow` misclassifies.* Accepted;
   reproduced both cases with jsdom and found a third (shorthand after
   longhand) that jsdom cannot resolve; documented as a limit.
5. *`aria-hidden` treated as not shown.* Accepted: split into two skip
   sets; positive fixture for a visible table in an `aria-hidden` subtree.
Also corrected the IME case count to 44 (24 valid, 20 invalid), verified
by counting the test file; all move unchanged.

## Implementation status

- 2026-11-11, Track 1: `MEASURE.scrolls` and the `scrolls sideways:` line
  (`measure.ts`, `format.ts`); doc lines in `testing.ts` and
  `content-browser.ts`. About 12 source, 37 test, 7 doc changed lines. The
  e2e fixture holds a wrapped 12-column table and an outer scroller that
  holds a wide row and a wrapped table: 3 lines at 390px (wrapper, outer,
  inner), 1 at 1280px (outer only; a 720px table fits), 1 `overflow:` line
  (the old fixture row) throughout. `scrolls` is a required field of
  `MEASURE`, so the `run.test.ts` measures gained `scrolls: []`. The
  fixture's `body` height shrank by the 100px the new blocks add, so the
  card heights the test asserts are unchanged. `pnpm test:changed` selected
  834 files; all passed except `test/core/schema-watcher.test.ts` (a file
  watcher timing test that imports none of the changed files; it also fails
  alone).
- 2026-11-11, Track 2: Styling text and scroll-wrapper rule, new "Dates"
  subsection (`datesSection` in `files.ts`, placed after "ViewCard
  Structure" in `generateViewsDoc`), A6 and A7 control bullets, `alt` in the
  name bullet, the `aria-label` fix in the "Inbox Dashboard" example, and the
  four consolidations (link/embed merged into "Showing Files in Chat", with
  "How the Agent Knows a Companion View is Open" kept for `zoomed-view` and
  `open-card`; `reportActivity` cell and companion text point at "Reporting
  Card Activity"; views skill and `bbx-commands.ts` point at "Testing a
  View"). 116 changed lines (62 added, 54 removed), all docs. The wrapper is
  named "scroll wrapper" with `role="region"`, `aria-label`, `tabIndex={0}`
  and `overflowX: "auto"`; Track 3's `wide-table-without-wrapper` message
  should say "scroll wrapper" and name "Styling". Browser check (bin/browse
  at 390x844 and 1280x900, a fixture view in the test1 clone, deleted
  after): the page does not scroll sideways (document scrollWidth equals the
  window width), the wrapper scrolls (scrollWidth 640 in a 332px box), Tab
  focus reaches it with a fully visible ring, arrow keys scroll it, the
  snapshot lists `region "Prices"`, `Temporal.PlainDate.from("2026-08-14")`
  shows "Aug 14", and `bbx view check` passes the view. Screenshots in
  `scratch/impl/box-view/track2/`. `test:changed` again selected 834 files;
  only `schema-watcher.test.ts` failed (same as Track 1).
- 2026-11-11, Track 5: the motion bullet in `files.ts` now names
  script-driven animation and says the app stops CSS animations and
  transitions. The precondition holds on this branch (the global
  `prefers-reduced-motion` rule is in `src/frontend/src/index.css`, from
  `ui-primitives-dedup`); the bullet lands together with that plan. 6
  changed lines (4 added, 2 removed), all docs. `markdown-check.test.ts`
  passes; generated `views.md` read. `test:changed` as in Track 2.
- 2026-11-11, Track 3: `src/core/views/advice/` (`types.ts`, `ime-enter.ts`,
  `source.ts`, `dom.ts`, `core.ts`), the hidden `bbx view advise` child and
  `runAdvice` (`src/cli/commands/view/advise.ts`), the snapshot step in
  `settle.ts` and `render-one.ts`, and output in `command.ts`. The 44 IME
  cases moved to `personal-vibe-check/rules/test/ime-safe-enter.cases.ts`
  (exported as `./rules/ime-safe-enter.cases`); the ESLint test and
  `advice.source.test.ts` both run them. About 1,050 source, 720 test, 15 doc
  changed lines; source is over the ~620 estimate, mostly the full IME port
  (326 lines, function for function with the ESLint rule) and file comments.
  Deviations:
  - The sweep names the snapshot file (`--snapshot <path>` to `render-one`,
    in a temp directory it removes in `finally`) instead of reading
    `bbx-view-check snapshot: <path>` from the child's stdout, which view
    code also writes to; so there is no `SNAPSHOT_PREFIX`.
  - `page too large` is a per-state remark the advise child prints
    (`advice not checked: <state>: page too large`); its other states and the
    source scan still run.
  - Advice failures are partial remarks, so the view prints `~ <slug> (partly
    checked)`, not `✓`; `ok` and the exit code are unchanged.
  - `wide-table-without-wrapper` also accepts a table that scrolls itself
    (`display: block; overflow-x: …`), not only an ancestor.
  - `ViewAdvice.where` is an array (findings merged by rule).
  - `advice/core.ts` is the directory's one entry (layout rule 5): it
    re-exports the record types and holds `renderedAdvice`, the jsdom
    rebuild. `importedSpecifier` and the specifier walk moved from
    `markdown-check/core.ts` into `src/core/views/local-imports.ts`, shared
    by both checks.
  Scenario 4: the worktree test1 clone and test1 print no advice. The four
  older backups use the removed v2 box shape and the engine refuses them; the
  run covered test1, its clone, and the 2026-10-25 snapshot (4 boxes), 34
  views. Counts (entries / files): `utc-today` 13 / 4 (11 on `new Date()`,
  2 on another date); `unnamed-control` 11 / 5; `date-string-parse` 8 / 4
  (4 add a time of day before parsing, open question 2); `clickable-non-control`
  3 / 3; `viewport-height` 1 / 1; `enter-without-ime-check`,
  `wide-table-without-wrapper`, `img-without-alt`, `aria-label-without-role`
  0. The zeros are not rule misses: the one unguarded Enter handler is in a
  view that fails to render (advice runs only for passing views), and the
  tables and images with no `alt` sit in branches that render only with data
  no check state reaches, and no view puts `aria-label` on a generic element. 36 entries against the expected 45–65. Elapsed time
  for the 34 views: 44.4 s with advice skipped, 55.8 s with it, about 340 ms
  more per view. Exit codes unchanged.
  `test:changed` selected 839 files; all passed except
  `schema-watcher.test.ts` (passes alone; known load flake) and
  `card-shot/run.e2e.test.ts`, which fails the same way with this track's
  changes reverted (the browser daemon's read returns `os error 35`).
- 2026-11-12, Track 4 (knowledge audits): about 115 lines of audit entries and status comments in `knowledge-audits.yaml`, 0 source, 8 docs. Four box audits added (`view-date-only-temporal`, `view-wide-table-scroll`, `view-announce-action-result`, `view-check-advice-meaning`) and run once against the web-guidance-scan test1 clone: all pass. The five reruns (`view-enter-field-ime-and-name`, `views-full-bleed-layout`, `views-render-test-command`, `chat-screenshot-when`, `box-page-interaction`) pass. Three dev audits the sibling plan `ui-primitives-dedup` lists were missing and are added (`dev-anchored-popover`, `dev-confirm-dialog`, and `dev-filter-buttons` for `TabBar mode="buttons"`); `dev-settings-checkbox` already existed. All three give the right answer and fail only `should_read_any: beebox/frontend.md`, because the agent Grep-ed that file and never Read it (the runner counts Read only). No doc was changed. The plan's line citations for the reruns (`:9447` and others) are stale; the ids are what count.
