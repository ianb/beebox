---
title: "color contrast wcag aa audit"
workstream: theme-audit
area: beebox
priority: normal
---

`bin/tour --all` surfaces ~18 `color-contrast` violations (serious, per
axe-core) across every routed page. Top failing tokens against white
backgrounds:

- `text-warm-500` (#B8A890, ~2.3:1) — used widely as secondary text
- `text-warm-600` (#9B8E7E, ~3.5:1) — borderline; still fails AA
- `text-warm-400` (#D9CEBD, ~1.4:1) — used on the lightest secondary text
- `text-warning` (#D99A2B, ~2.0:1), `text-primary` (#9B6BA6, ~3.7:1)
  and several `-dark` semantic variants — saturated mid-tones that
  fail AA against white.

Not interesting right now; intentionally deferred. Three plausible
fixes when the time comes:

1. **Re-map the warm scale** so warm-500/600 darken into AA-passing
   territory. Single-file palette change; shifts the visual identity
   of every secondary-text surface.
2. **Move text to warm-700+** by sweeping source and reserving 400–600
   for borders/backgrounds (the conventional Tailwind split).
   Many-file change; preserves visual identity.
3. **Bump the semantic `-dark` variants** (warning-dark, primary-dark,
   success-dark) so error/warning/success text passes AA without
   re-tuning the neutral scale.

To re-enable the rule for one tour run: remove `color-contrast` from
`SUPPRESS_RULES` in `beebox/test/tours/tour-lib/axe.ts`.

When this becomes interesting again, run `bin/tour --all` after
re-enabling and the latest violation inventory will land under
`beebox/test/tours/.artifacts/<tour>/<runId>/*.axe.json`.

## Update, 2026-10-21 - theme-audit

axe's rule stays off because it declines to measure themed text (it marks
text over images and gradients "incomplete"). Every tour checkpoint and
`bin/theme-check` now run a pixel contrast audit instead
(`beebox/test/tours/tour-lib/contrast.ts`; plan
`beebox/docs/implemented-plans/theme-contrast-audit.md`). The theme misses it found are
fixed or presented as decisions. The base warm-scale choice (directions 1
and 2 above) moved to `issues/closed/code-quality/2026-10-21-base-warm-text-scale-contrast.md`.

## Re-encounter, 2026-10-21 - weekly tour check run 20261021-221418

The first weekly tour check with the pixel contrast audit. On the plain app
(`nav-pages`, `browse-walk`, `capture`, `new-chat`, both viewports) these
text misses remain after the warm-700 move:

- `text-warm-400` (#d9cebd) for counts and the filter caret "▾": 1.55:1 on
  white, 1.44:1 on #fbf5ee (Browse row counts, History filter triggers).
- Amber text #b07d1c: diff-stat badges "+1-7 in 1" on #f6e4bc (2.89:1, Chat
  and History); Dashboard "Box warnings" on #fbf3e4 (3.29:1).
- Dashboard "dirty (4 files)" #d99a2b on white (2.44:1).
- Questions note placeholder "Add context for your answer..." #9ca3af on
  white (2.54:1).
- Capture "Tap to start camera" #4b5563 on black (2.78:1).
- Dashboard "Open storage summary →" #9562a1 on #eeedf5 (3.98:1); Admin
  "Logged in as …" #3c7f49 on #d6eadd (3.86:1); History diff removed lines
  #a05a6c on #f9eef0 (4.44:1).

Artifacts: `beebox/test/tours/.artifacts/nav-pages/2026-10-22T03-46-36-926Z/*.contrast.json`
and `browse-walk/2026-10-22T03-22-23-925Z/`.
