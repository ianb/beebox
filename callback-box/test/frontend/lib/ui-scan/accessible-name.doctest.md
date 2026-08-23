# Computing an accessible name in the page

The scan has to name every control it reports, and no browser exposes a computed
accessible name to page JavaScript. So `computeAccessibleName` approximates the
accname fallback chain, stopping at the first non-empty result:

`aria-labelledby` → `aria-label` → `alt` → visible text content (excluding
`aria-hidden` subtrees) → `title` → `placeholder`.

Every example below is markup copied from the chat surface, because the order
of that chain is a claim about *this* app: the send/dictation cluster is
`title`-only, the menu items are icon-plus-text, and the composer textarea has
nothing but a placeholder.

```ts setup
import { computeAccessibleName } from "../../../../src/frontend/src/lib/ui-scan/accessible-name.js";
import type { ScanElement } from "../../../../src/frontend/src/lib/ui-scan/types.js";
import { fixtureRoot } from "../../../helpers/ui-scan-fixture.js";

function indexIds(root: ScanElement, index: Map<string, ScanElement>): void {
  const id = root.attributes["id"];
  if (id !== undefined && !index.has(id)) index.set(id, root);
  for (const child of root.children) if (child.kind === "element") indexIds(child, index);
}

/** Name the first element of an HTML fragment; later siblings are label targets. */
function nameOf(html: string): string {
  const root = fixtureRoot(html);
  const index = new Map<string, ScanElement>();
  indexIds(root, index);
  const first = root.children.find((child) => child.kind === "element");
  if (first === undefined || first.kind !== "element") return "";
  return computeAccessibleName(first, { byId: (id) => index.get(id) ?? null });
}
```

## `aria-label` beats `title`

The composer's Add trigger carries both — `title="Add"` for the tooltip and
`aria-label="Add"` for assistive tech — and so does the mobile capture button,
where the two deliberately differ: `title` explains why it is disabled while
`aria-label` names the control. The name is the label, not the tooltip.

```ts
nameOf(`
  <button type="button" title="Capture (send a message first)" aria-label="Capture"
          aria-haspopup="menu" aria-expanded="false">
    <svg viewBox="0 0 24 24"><path d="M3 9a2 2 0 012-2h.93" /></svg>
  </button>
`)
=> Capture
```

## `title` alone names the send button

`InteractiveChat-composer.tsx` gives send an icon and a state-dependent `title`
and nothing else. Without `title` in the chain this control would be nameless
and dropped, which is why it sits above `placeholder` rather than last.

```ts
nameOf(`
  <button disabled title="Queue message (agent is busy)">
    <svg viewBox="0 0 24 24"><path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
  </button>
`)
=> Queue message (agent is busy)
```

The voice button is the same shape, and its `title` is a four-way computed
expression — one element, one id, four names. The scan reads whichever is
current, so the dump reports this moment rather than a static catalogue:

```ts
nameOf(`<button title="Stop recording"><svg viewBox="0 0 24 24"></svg></button>`)
=> Stop recording
```

## Text content, with the icon left out

`MenuItem` renders `<span aria-hidden="true">{icon}</span>` beside the label. The
icon is hidden from assistive tech, so it is hidden from the name too — the item
is "Attach file…", not "📎 Attach file…". Whitespace across the wrapping spans
collapses to single spaces.

```ts
nameOf(`
  <button type="button" role="menuitem">
    <span class="inline-flex items-center gap-2">
      <span aria-hidden="true">📎</span>
      <span>Attach file…</span>
    </span>
  </button>
`)
=> Attach file…
```

Text content also beats a `title` on the same element, which is what keeps a
tooltip from overriding the words the user can actually read:

```ts
nameOf(`<button title="Send the message">Send</button>`)
=> Send
```

## Placeholder is the last resort

The composer textarea has no label of any kind — only its placeholder, which
changes while dictation is running.

```ts
[
  nameOf(`<textarea placeholder="Type a message..."></textarea>`),
  nameOf(`<textarea readonly placeholder="Listening..."></textarea>`),
].join(" | ")
=> Type a message... | Listening...
```

## `aria-labelledby` wins over everything

It is first in the chain, and the referenced element's own name is what counts —
here the tab's visible text, not its id.

```ts
nameOf(`
  <button role="tab" aria-labelledby="tab-label-1" aria-label="ignored" title="ignored too"></button>
  <span id="tab-label-1">Dinner_Plans.doc.card</span>
`)
=> Dinner_Plans.doc.card
```

A reference that points at nothing falls through to the next step rather than
naming the control after a dangling id:

```ts
nameOf(`<button aria-labelledby="gone" title="Stop speaking"></button>`)
=> Stop speaking
```

## `alt` names an image

`alt` applies only where it means something — an `<img>`, an `<area>`, or
`<input type="image">`. On anything else it is markup noise and is skipped.

```ts
[
  nameOf(`<img src="/avatar.png" alt="Dana Whitfield" />`),
  nameOf(`<button alt="not a real name" title="Open debug log (2 errors)"></button>`),
].join(" | ")
=> Dana Whitfield | Open debug log (2 errors)
```

## Nothing at all is an empty name

An icon-only button with no label, no title and no text yields `""`. The scan
drops it rather than emitting an empty name — it has no name the agent could use
in prose and none the user would recognise — and counts the drop in the header so
the omission is visible rather than silent.

```ts
nameOf(`
  <button type="button">
    <svg viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
  </button>
`)
=> «blankline»
```

Whitespace-only content counts as nothing, too:

```ts
JSON.stringify(nameOf(`<button aria-label="   ">   </button>`))
=> ""
```
