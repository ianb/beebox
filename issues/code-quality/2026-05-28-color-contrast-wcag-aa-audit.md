---
title: "color contrast wcag aa audit"
workstream: unknown
area: callback-box
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
`SUPPRESS_RULES` in `callback-box/test/tours/tour-lib/axe.ts`.

When this becomes interesting again, run `bin/tour --all` after
re-enabling and the latest violation inventory will land under
`callback-box/test/tours/.artifacts/<tour>/<runId>/*.axe.json`.
