---
needs: [design]
area: callback-box
---

# Review the representation of `<card-activity>` kinds

The `<card-activity>` children of the `<chat-app>` snapshot currently use ONE
uniform channel: `kind` is an attribute, and the per-kind **detail rides as
element text** (`<card-activity kind="scrolled">0.6</card-activity>`). Commit
`8fde2281` deliberately moved details from attributes → element text because
some are long/multi-line — `explored` carries a query (`boat-water+road ->
boats`), `modified` a path — and to avoid an ever-widening attribute set as
kinds grow (`src/core/chat-card-activity.ts`).

But the kinds aren't uniform in shape: `scrolled`'s detail is now a **short
scalar** (a `0.0`–`1.0` read fraction), where neither reason applies — a scalar
reads more naturally as an attribute (`<card-activity kind="scrolled"
pos="0.6"/>`, which also self-closes, matching the "nothing happened"
convention). So the representation is worth a deliberate pass:

- **Per-kind shape.** Which activity details are genuinely free-text/long
  (`explored`, `modified` → element text) vs. structured scalars (`scrolled`,
  and any future numeric/enum kind → attribute)? A mixed model (scalars as
  attributes, free-text as element text) fits the data better but **forks the
  mechanism** — the renderer (`renderActivityChildren`), the frontend
  detail-reporting, and the prompt (`chat-session-prompts.ts`) all grow a
  per-kind branch. Weigh semantic-fit vs. the one-uniform-channel simplicity.
- **Not a bug, just cleanliness.** The agent reads either form fine; this is
  about the representation being honest and easy to extend, not correctness.
- **Do it once, across the surface.** Any change has to move together: the
  vocabulary/renderer (`chat-card-activity.ts`), the frontend reporters
  (`InteractiveChat-controls.tsx` scroll, `FileView`/`ViewRenderer` explored),
  and the agent-facing prompt description + example. (This is exactly the
  drift that just bit us — the scroll-position detail landed in code before the
  prompt was updated.)
