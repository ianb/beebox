---
name: bbx-frontend
description: Build or change user-facing UI in `src/frontend/`, including components, layout, data states, responsiveness, backend wiring, and visual or UX fixes. Not needed for a one-line copy or className tweak.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# bbx-frontend

The **behavioral** half of frontend work. The catalog — every primitive, the
semantic palette, the `className` rule — lives in **`beebox/frontend.md`**;
read it before writing UI (`CLAUDE.md` already says so). This skill is the
*habits* that catalog can't enforce: compose from primitives, separate data from
presentation, ship the empty/error/loading states, keep it accessible, and
verify in a real browser before calling it done.

## Reach for what exists first

- **Primitives over inline classes.** A `<Button>`, `<Text>`, `<Stack>`,
  `<Card>`, `<Badge>`, `<TextField>`… almost certainly already owns the look you
  want — `frontend.md` is the index. Writing appearance classes inline is the
  signal you skipped it. `restrict-component-classes` enforces this outside
  `components/`: `className` is **outer layout only** (margin, flex-self,
  sizing, position) — never color/border/shadow.
- **Semantic palette, never raw Tailwind colors.** `intent="destructive"`, not
  `bg-red-500`; `tone="muted"`, not `text-gray-400`. A role that doesn't fit is
  a sign you need a *new semantic role* — discuss, don't invent a one-off
  (frontend.md "Frontend Color Palette").
- **Before adding a primitive**, run frontend.md's three-question test (extend
  an existing prop? used 3+ times? genuinely one-off → keep it local). Don't
  abstract on the first occurrence.

## Components own their structure

- **Compose, don't over-configure.** `<Card><CardHeader>…</CardHeader></Card>`
  beats `<Card title=… headerVariant=… content=… />`. Slots and children scale;
  a wall of variant props doesn't.
- **One job per component.** A component near the 300-line cap (code-style.md)
  is usually two components. Split by responsibility, not to game the line count.
- **One primary action per area.** Our screens are usually a mishmash of
  regions (a dashboard panel, a card, a form) — each *area* gets a single
  primary CTA (`<Button intent="primary">`) with the rest secondary/ghost, not
  one primary for the whole screen. Two equal primaries *within one area* means
  that area's hierarchy isn't decided yet.
- **Separate data from presentation.** A container does the fetching and owns
  the three states; a pure presentational child takes already-loaded props and
  just renders. This is what makes the empty/error/loading states impossible to
  forget — they live in the container, in one place.
- **Components own their own a11y landmarks.** A component that *is* a nav, a
  region, or a list renders its own `<nav>` / `<section>` / `role="list"` — you
  never wrap someone else's component in a landmark from the outside. (If it
  needs a landmark, that's the component's job to add.)
- **Colocation.** A page's own supporting components live in its
  `pages/<x>/components/` subdir (CLAUDE.md "Source Layout") — that's also what
  exempts them from `restrict-component-classes`. Shared ones go in
  `src/components/` (feature) or `src/components/ui/` (primitive).

## Pick the simplest state that works

Climb this ladder only as far as you must:

- **`useState`** — component-local UI state.
- **Lifted state** — shared by 2–3 siblings.
- **URL / search params** — filters, pagination, the open tab, *anything
  shareable or reload-surviving*. Default to this for view state a reload should
  preserve (TanStack Router owns our routing).
- **tRPC subscription / query** — remote data. Real-time rides the WebSocket
  (`useWSS`, `events.subscribe` / `turnStream`); request/response is a tRPC
  query. Don't hand-roll fetch or a polling loop.
- **Context** — read-heavy, write-rare app-wide values (theme, current box).

Prop-drilling past ~3 levels is the smell that you skipped a rung — restructure
or lift to context, don't thread the prop.

## The three states are not optional

Every view that loads data ships **loading, empty, and error** — a blank screen
while data resolves is a bug, not a default.

- **Loading:** a skeleton that mirrors the real layout, not a centered spinner;
  mark it `aria-busy`. Consider an optimistic update for actions that should
  feel instant (write to cache, roll back `onError`).
- **Empty:** say what's missing and offer the next action ("No cards yet —
  create one"), not an empty `<ul>`.
- **Error:** a real message + a retry affordance. Our browser forwards console
  errors to `client-debug.log` — a silently-swallowed error still surfaces
  there, so don't swallow it.
- **Forms** get the same care: the field primitives (`<TextField>` and friends)
  already render label + error + helper — use them rather than a bare `<input>`.
  Validate on **blur**, not every keystroke; on a failed submit, put the error
  *below the field* and move focus to the first invalid one; mark required
  fields. A label is not a placeholder.

`<StatusBadge>`, `<Badge>`, and the field primitives already encode the states
they need; reach for them.

## Accessibility baseline (non-negotiable)

- **Keyboard:** every interactive element is reachable and operable by keyboard.
  Use a real `<button>`/`<a>` (`<Button>`, `<Link>`/`<TextLink>`); a
  `<div onClick>` is not focusable. Tab through what you built.
- **Labels:** icon-only controls need an accessible name — our `<Button icon>`
  discriminated union *forces* a `label`; `<ExternalIconLink>` requires one too.
  Don't defeat them.
- **Contrast & not-color-alone:** ≥4.5:1 for body text; never signal state by
  color alone (pair it with text or an icon — a danger Badge says "Failed", it
  isn't just red).
- **Focus:** when a dialog/overlay opens, move focus into it; restore on close.
- **Headings:** one `<h1>` per page; don't skip levels (`<Text as="h2">` then
  `as="h3">`, never `h2`→`h4`). Heading level is structure, not size — pick the
  level for the outline, the `size`/`weight` props for the look.
- **Icons:** an inline SVG icon, never an emoji, for UI affordances.
- **Addressable:** every static interactive control carries a stable
  `id="bbx-<area>-<control>"` (kebab-case, unique app-wide — axe `duplicate-id`
  in the tours enforces it). It is how the box agent points at controls and
  how `bin/browse` acts on them without positional refs; see
  `src/frontend/src/lib/ui-scan/resolve.ts`. Per-row controls get one only when
  a unique derived id is obvious. Never rename an existing id (some are shared
  with iOS).

## Avoid the "AI aesthetic"

Our semantic palette already blocks the worst of it, but the habit matters:
no purple/indigo-everything, no gradient soup, no `rounded-2xl` on everything,
no shadow-stacking, no uniformly oversized padding. Match the design system's
existing rhythm — consistency reads as "designed," novelty reads as "generated."

## Motion, sparingly

Animation should explain a change, not decorate. When you reach for it:

- **Short:** 150–300ms for a micro-interaction; anything past ~500ms feels slow.
- **Cheap:** animate `transform` and `opacity` only — animating `width`/
  `height`/`top`/`left` forces layout reflow and visible jank (the same
  reflow-cost lens bbx-debug uses for perf bugs).
- **Few:** one or two elements per view, not the whole page.
- **Honor `prefers-reduced-motion`** — gate non-essential motion behind it; some
  users have it on for a reason, and the content must be fully usable without
  the animation.

A spinner that could be a skeleton, a card that pulses for no reason, a
500ms page fade — those read as "generated," not "designed." Skip them.

## Performance — measure before you optimize

beebox is an internal app, not a public site chasing Lighthouse scores —
don't pre-optimize. The two web-applicable habits that *do* matter here:

- **Reserve space for images** so the layout doesn't jump as they load
  (Cumulative Layout Shift). When you know an image's dimensions, pass them / set
  an aspect-ratio; `loading="lazy"` anything below the fold. (Heads-up: the
  `<Image>` primitive only fully reserves space for `size="thumb"` today — the
  larger sizes are `max-w`/`max-h` only, so they still shift.)
- **The React Compiler does memoization for us — don't hand-roll it.** The
  compiler is enabled in `vite.config.ts` and auto-memoizes components and hooks,
  more correctly and consistently than reflexive `useCallback`/`useMemo` ever
  did. So **don't reach for `useCallback`/`useMemo`/`React.memo` for render
  performance** — write the plain function/value and let the compiler stabilize
  it. Existing manual memoization is preserved by the compiler
  (`react-hooks/preserve-manual-memoization`) and harmless; it's being removed
  opportunistically, not urgently. The job now is to keep code
  **compiler-compatible** (pure render, no prop/state/context mutation, no
  setState-in-render, refs only in effects/handlers) — the `react-hooks/*` lint
  enforces this; an `exhaustive-deps` array is still the source of truth for
  effects.
- **The compiler only sees React's render graph.** The rare case where you still
  hand-stabilize an identity is a value handed to something *outside* it — a
  third-party imperative API that diffs by reference (e.g. react-virtuoso's
  `context`/`itemContent`), a ref callback whose churn would re-attach DOM
  listeners, or an event listener you add/remove by identity. Reach for
  `useCallback`/`useMemo` there with a one-line comment saying which non-React
  consumer needs it; everywhere else, trust the compiler. SSR (`bbx render`) runs
  uncompiled through tsx — fine, `renderToString` has no re-renders to optimize.

If something is actually slow, that's a **bbx-debug** job — establish a baseline
measurement and bisect; logs lie about performance.

## Verify in a real browser before you're done

Built UI is unverified until you've *looked* at it. Use the `browse` skill
(`bin/browse open /<path>`, `snapshot -i`, `screenshot`):

- [ ] Renders with **no console errors** (check the snapshot / `client-debug.log`).
- [ ] Keyboard-Tab reaches every interactive element.
- [ ] Loading, empty, **and** error states each actually render.
- [ ] Responsive: check a narrow viewport (`set viewport 375 800`) — we have a
      real two-pane mobile layout (`Column hideOnMobile`, `<MobileBackButton>`).
- [ ] If a screenshot shows "Failed to load" or broken UI, **report the URL** —
      don't dismiss a visible error as out of scope.

When screenshots are evidence for the completed UI—before/after, several
states, or desktop/mobile—turn the useful set into one exhibit with labels and
captions, then hand off the exhibit URL. The developer should not have to open
raw `.claude/screenshots/` paths and infer which image proves what. Use an
`fyi` exhibit for verification evidence; if you actually need a choice,
confirmation, or reaction, use that ask instead. Skip the exhibit for an
incidental one-off debug capture with nothing useful to review.

## Common rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll just write the className inline." | If it's appearance, a primitive already owns it and lint will reject it outside `components/`. Reach for the primitive (frontend.md). |
| "`bg-red-500` is close enough." | Raw Tailwind colors aren't the brand palette. Use the semantic role; if none fits, propose a new role — don't one-off it. |
| "Accessibility later." | A `<div onClick>` and an unlabeled icon button are bugs now, not polish. Use the real element; the typed primitives already enforce labels. |
| "Empty/error states later." | They reveal layout problems real data hides, and a blank screen is a shipped bug. Build the three states with the container. |
| "It renders, I'm done." | Rendering isn't verifying. Open it in `bin/browse`, Tab through it, check the console — *then* done. |
| "I'll add a new primitive for this." | Not on the first use. Extend a prop, or keep it local in `pages/<x>/components/`. Abstract at 3+ (frontend.md). |
| "Responsive is a separate pass." | Retrofitting responsive is far harder than building it in. We already have a two-pane mobile layout to honor. |

## Red flags — stop

A `<div onClick>` where a `<button>` belongs · raw `red-*`/`gray-*`/`purple-*`
classes · a component past 300 lines · appearance classes in `className` outside
`components/` · a data view with no empty/error/loading branch · an icon-only
control with no label · "I'll verify by eye later" without ever opening
`bin/browse` · color as the only state indicator.
