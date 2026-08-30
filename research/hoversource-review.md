# HoverSource — element→source provenance, and what it offers our selection standard

*Reviewed 2026-07-08. Snapshot of HoverSource as pitched at https://loerei.github.io/HoverSource/ and of beebox's `data-bbx-source` / selection-capture standard on this date.*

## What it is

A dev tool that maps a **rendered DOM element → its exact source `file:line:column`**, for handing to a coding agent. You hover an element, press `Alt+C`, and the component's source location lands on your clipboard to paste into the agent. "Translate what you see to what your agent needs" / "Hover, Copy, Done." Auto-detects React/Vue/Next/Svelte/Webpack/Vite with no config; claims −73.9% agent steps and −94.5% tokens by giving the agent the location up front instead of making it grep.

## Why it's relevant to us

We already have the *same shape* of idea, aimed at **cards instead of code**:

- **`data-bbx-source`** (`src/frontend/src/lib/source-tag.ts`, `docs/data-source-tagging.md`) tags rendered elements with `type:identifier` provenance — `card:path`, `commit:hash`, `api:proc`, `dir:path`, `session:id`, `schedule:name` — plus `data-bbx-source-item` for a natural-language sub-part. Its stated purpose is literally HoverSource's: "trace what's on screen back to its origin" for "view-source overlays or context-aware interactions."
- **Selection capture** (`SelectionCapture.tsx` + `lib/selection/position.ts`'s `extractSelection`) surfaces a floating "+" on a text selection and hands `{ verbatim text, a rough position locator }` to the chat companion pane (`chat/ChatSelections.tsx`, `chat/InteractiveChat-selections.ts`).

So HoverSource is the coding-agent cousin of the standard the boxholder is extending: **select/point at something on screen → give the agent a precise, re-resolvable anchor to it.** The value framing (surgical anchor beats agent grep; big token/step savings) is the *why* our standard should state out loud.

## The transferable ideas — dispositions

| Idea from HoverSource | Disposition | Trace to beebox |
|---|---|---|
| **Precise, canonical anchor** (exact `file:line:col`, unambiguous, re-resolvable) vs. our "rough position locator" | **Adapt** | `lib/selection/position.ts` hands chat a *rough* locator; the agent can't reliably re-find the exact span later. Move to a canonical anchor — a **text-fragment** (`#:~:text=…`, which we already use in `WebpageView.tsx`/`CommentaryView.tsx`) or a card-relative quote+offset — so a captured selection resolves back to the exact bytes in the card. |
| **Hover-to-grab affordance** (point at a whole element, not just select text) | **Adapt** | We tag every element with `data-bbx-source` but only *text selections* are capturable. A hover/point affordance that surfaces the element's existing `data-bbx-source` would let the user hand the agent "*this card / this list item*" (via `data-bbx-source-item`) without selecting prose. Complements `SelectionCapture`, reuses `source-tag.ts`. |
| **Zero-config, comprehensive coverage** (every element resolves) | **Adopt (as discipline)** | The standard is only as good as its coverage — keep `cbSource()` applied at render everywhere data is shown, so capture never hits an untagged element. Worth a lint/audit like the `restrict-component-classes` style checks. |
| **The "surgical anchor beats grep" value prop + token framing** | **Adopt (as rationale)** | `docs/data-source-tagging.md` lists uses but doesn't state the payoff. Bake in the framing: a selection that carries `card:path` + a text-fragment lets the agent open the exact card at the exact quote — no search, no ambiguity — which is the whole point of the standard. |
| The literal **code `file:line:column` mapping** | **Reject (for the product)** | Our agents operate on *cards*, not the frontend source, so element→source-file is the wrong altitude for the box. (It IS `bin/browse`-adjacent for *debugging our own frontend* — a separate, minor tooling idea, not product surface.) |

## Recommendation

The one worth pursuing: **make the selection locator canonical and re-resolvable** — adopt a text-fragment-style anchor so a captured selection round-trips (agent can re-open the exact span, and later agent edits can land back at it). Second: **a hover/point affordance that hands the agent an element's `data-bbx-source`**, extending capture beyond text selection. Both trace directly to `source-tag.ts` + `SelectionCapture.tsx` and strengthen the "provenance standard" the boxholder is already building.

## Follow-ups worth filing

- *Selection anchors should be canonical/re-resolvable* (text-fragment or card-relative quote), replacing the rough locator — `lib/selection/position.ts`.
- *Hover-to-capture affordance surfacing `data-bbx-source`* — complements `SelectionCapture`.

(Not auto-filed — flag if you want these in `issues/`.)
