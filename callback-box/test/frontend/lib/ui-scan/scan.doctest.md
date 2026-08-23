# Walking the screen for controls

`scanControls` walks the document and reports the interactive controls and
landmarks currently on screen — an address where one was authored, a role, a
live accessible name, the enclosing landmark, and what the control does.
`resolveControl` runs the other way, from an address back to the element.

The frontend doctests run under plain Node with no jsdom, so the walk is written
against `ScanElement` — a structural view of an element — rather than `Element`.
`live-dom.ts` adapts the real document to that view; the fixture helper here
parses HTML and supplies the two things a parser cannot know, because in the
browser they come from CSS and layout: `data-test-style` is the computed style,
`data-test-rect` is `left,top,width,height` of the border box. Everything else
is markup copied from `InteractiveChat-composer.tsx`,
`InteractiveChat-voice-button.tsx` and `ui/Dropdown.tsx`.

```ts setup
import { scanControls, MAX_ENTRIES } from "../../../../src/frontend/src/lib/ui-scan/scan.js";
import { resolveControl } from "../../../../src/frontend/src/lib/ui-scan/resolve.js";
import type { ControlEntry, ScanResult } from "../../../../src/frontend/src/lib/ui-scan/types.js";
import { fixtureRoot } from "../../../helpers/ui-scan-fixture.js";

function scan(html: string): ScanResult {
  return scanControls(fixtureRoot(html), { viewport: { width: 1024, height: 768 } });
}

/** One line per entry, in the tours' `role "name"` idiom the dump also uses. */
function lines(result: ScanResult): string {
  return result.entries.map(describe).join("\n");
}

function describe(entry: ControlEntry): string {
  const address = entry.id === null ? "(no address)" : entry.id;
  const marks = [
    entry.actions.includes("reveal") ? "[reveal]" : "",
    entry.disabled ? "[disabled]" : "",
    entry.offscreen ? "[offscreen]" : "",
    entry.does === null ? "" : `— ${entry.does}`,
  ].filter((mark) => mark !== "");
  return [`${entry.container ?? "-"} / ${entry.role} "${entry.name}" ${address}`, ...marks].join(" ");
}
```

## The composer, as the agent would see it

The composer is a named region (`<section aria-label="Compose message">`), so
every control inside it reports that as its container. The Add trigger is
annotated — an address, a `data-cb-does` for the menu the scan cannot see into,
and `data-cb-reveal` — while the capture button beside it is not, and degrades to
its accessible name with a null address.

```ts
const composer = scan(`
  <section aria-label="Compose message">
    <button type="button" id="cb-composer-add" title="Add" aria-label="Add"
            aria-haspopup="menu" aria-expanded="false"
            data-cb-reveal
            data-cb-does="opens the attach menu — capture, attach file, upload files, screenshot, share location">
      <svg viewBox="0 0 24 24"></svg>
    </button>
    <button type="button" title="Capture" aria-label="Capture">
      <svg viewBox="0 0 24 24"></svg>
    </button>
    <textarea id="cb-composer-input" placeholder="Type a message..."></textarea>
    <button id="cb-composer-send" disabled title="Send"><svg viewBox="0 0 24 24"></svg></button>
    <button id="cb-composer-mic" title="Stop recording"
            data-cb-does="tap to stop dictating and send; say &quot;cancel message&quot; to discard">
      <svg viewBox="0 0 24 24"></svg>
    </button>
  </section>
`);
lines(composer)
=>
- / region "Compose message" (no address)
Compose message / button "Add" cb-composer-add [reveal] — opens the attach menu — capture, attach file, upload files, screenshot, share location
Compose message / button "Capture" (no address)
Compose message / textbox "Type a message..." cb-composer-input
Compose message / button "Send" cb-composer-send [disabled]
Compose message / button "Stop recording" cb-composer-mic — tap to stop dictating and send; say "cancel message" to discard
```

Nothing was dropped, no address is duplicated, and the list is complete:

```ts continue
JSON.stringify({
  omittedUnnamed: composer.omittedUnnamed,
  duplicateIds: composer.duplicateIds,
  truncated: composer.truncated,
})
=> {"omittedUnnamed":0,"duplicateIds":[],"truncated":false}
```

`reveal` comes from the attribute and from nothing else. `aria-haspopup` and
`aria-expanded` are on the Add trigger too, but inferring from them would be a
guess dressed as a guarantee — `role="tab"` fires real state changes in this app
— so the author's opt-in is the only source:

```ts continue
composer.entries.map((entry) => `${entry.name}: ${entry.actions.join("+")}`).join("\n")
=>
Compose message: point+focus
Add: point+focus+reveal
Capture: point+focus
Type a message...: point+focus
Send: point+focus
Stop recording: point+focus
```

An id only becomes an address when it is in the `cb-` namespace and kebab-case.
The frontend's own authored ids — `password-current`, `trash-card-title` — are
a11y plumbing, not promises, so they report no address:

```ts
lines(scan(`
  <button id="trash-card-title" title="Delete"><svg viewBox="0 0 24 24"></svg></button>
  <button id="cb-Composer-Send" title="Send"><svg viewBox="0 0 24 24"></svg></button>
  <button id="cb-nav-place" title="Place: test1"><svg viewBox="0 0 24 24"></svg></button>
`))
=>
- / button "Delete" (no address)
- / button "Send" (no address)
- / button "Place: test1" cb-nav-place
```

## Visibility

An element is out of the scan when it is `display:none`, `visibility:hidden`,
fully transparent, `hidden`, `inert`, inside an `aria-hidden` subtree, or
measures zero — and so is everything inside it.

```ts
lines(scan(`
  <nav aria-label="Primary">
    <button title="Visible"><svg viewBox="0 0 24 24"></svg></button>
    <button title="Display none" data-test-style="display:none"><svg viewBox="0 0 24 24"></svg></button>
    <button title="Invisible" data-test-style="visibility:hidden"><svg viewBox="0 0 24 24"></svg></button>
    <button title="Transparent" data-test-style="opacity:0"><svg viewBox="0 0 24 24"></svg></button>
    <button title="Hidden attribute" hidden><svg viewBox="0 0 24 24"></svg></button>
    <button title="Zero sized" data-test-rect="0,0,0,0"><svg viewBox="0 0 24 24"></svg></button>
    <div inert><button title="Inside inert"><svg viewBox="0 0 24 24"></svg></button></div>
    <div aria-hidden="true"><button title="Inside aria-hidden"><svg viewBox="0 0 24 24"></svg></button></div>
  </nav>
`))
=>
- / navigation "Primary" (no address)
Primary / button "Visible" (no address)
```

None of those count as omitted-unnamed: they are not on screen at all, which is
a different fact from "on screen with no name".

```ts
const unnamed = scan(`
  <main>
    <button title="Named"><svg viewBox="0 0 24 24"></svg></button>
    <button><svg viewBox="0 0 24 24"></svg></button>
    <button><svg viewBox="0 0 24 24"></svg></button>
  </main>
`);
JSON.stringify({ entries: lines(unnamed), omittedUnnamed: unnamed.omittedUnnamed })
=> {"entries":"- / button \"Named\" (no address)","omittedUnnamed":3}
```

The unnamed `<main>` is in that count: a landmark with no name is a real a11y
gap, and the dump reports the number so the omission is visible rather than
silent. A bare `<section>` is not — it only becomes a landmark once it is named,
so an unnamed one is just a box:

```ts
JSON.stringify(scan(`<section><button title="Send">x</button></section>`).omittedUnnamed)
=> 0
```

## A landmark is never named by its contents

ARIA does not let a region take its name from what is inside it, and the scan
must not either: `<main>` holding the chat transcript would otherwise report the
whole conversation as its "name" — user content in a dump that is meant to be
chrome only. An unnamed `<main>` is a real a11y gap, so it lands in the
omitted-unnamed count instead.

```ts
const transcript = scan(`
  <main>
    <p>Please reply with just the word ok.</p>
    <button title="Retry"><svg viewBox="0 0 24 24"></svg></button>
  </main>
`);
JSON.stringify({ entries: lines(transcript), omittedUnnamed: transcript.omittedUnnamed })
=> {"entries":"- / button \"Retry\" (no address)","omittedUnnamed":1}
```

Labelling it works, and that name is what groups the controls under it:

```ts continue
lines(scan(`
  <main aria-label="Chat">
    <p>Please reply with just the word ok.</p>
    <button title="Retry"><svg viewBox="0 0 24 24"></svg></button>
  </main>
`))
=>
- / main "Chat" (no address)
Chat / button "Retry" (no address)
```

## An unrecognised explicit role is counted too

Every omission gets a number. An element carrying an explicit `role` the scan
does not report — a `dialog`, a `list`, or an author's typo, which look identical
from here — is left out of the entries and counted, so the dump can say the list
is not everything. `presentation`/`none` are excluded: those are the author
saying "this is not a control", which is a decision, not an omission.

```ts
const roles = scan(`
  <main aria-label="Everything">
    <button title="Send">x</button>
    <div role="dialog" aria-label="Settings">…</div>
    <div role="buton" aria-label="Typo">…</div>
    <div role="presentation">…</div>
  </main>
`);
JSON.stringify({ entries: roles.entries.length, omittedUnknownRole: roles.omittedUnknownRole })
=> {"entries":2,"omittedUnknownRole":2}
```

A zero-sized element with an unknown role is not on screen in any sense the user
would recognise, so it is not counted either:

```ts continue
JSON.stringify(scan(`<div role="dialog" data-test-rect="0,0,0,0">…</div>`).omittedUnknownRole)
=> 0
```

## Off-screen but mounted is included, and marked

A control scrolled out of view is exactly what `point` exists to scroll to, so
it stays in the list with a flag rather than disappearing from it.

```ts
lines(scan(`
  <nav aria-label="Primary">
    <button title="In view" data-test-rect="10,10,120,32"><svg viewBox="0 0 24 24"></svg></button>
    <button title="Below the fold" data-test-rect="10,900,120,32"><svg viewBox="0 0 24 24"></svg></button>
    <button title="Scrolled off the left" data-test-rect="-300,10,120,32"><svg viewBox="0 0 24 24"></svg></button>
  </nav>
`))
=>
- / navigation "Primary" (no address)
Primary / button "In view" (no address)
Primary / button "Below the fold" (no address) [offscreen]
Primary / button "Scrolled off the left" (no address) [offscreen]
```

## Duplicate addresses are reported, hidden ones included

`DesktopComposerRow` (`hidden sm:flex`) and the mobile row (`sm:hidden`) render
the same controls and are *both mounted* — CSS-hidden by breakpoint, not
DOM-exclusive. A shared id there breaks `getElementById`, `<label for>` and every
`aria-*` reference, so the duplicate pass covers the whole document rather than
only the visible part, and reports what a visibility-limited walk would miss.

```ts
const rows = scan(`
  <section aria-label="Compose message">
    <div data-test-style="display:none">
      <button id="cb-composer-send" title="Send">desktop</button>
    </div>
    <div>
      <button id="cb-composer-send" title="Send">mobile</button>
    </div>
  </section>
`);
JSON.stringify({ duplicateIds: rows.duplicateIds, entries: rows.entries.length })
=> {"duplicateIds":["cb-composer-send"],"entries":2}
```

Resolution cannot see it — `getElementById` returns the first in document order
— which is why uniqueness is enforced upstream by axe in the tours and reported
here as a second line of defence.

## The entry cap

A page with more chrome than the cap produces a truncated list, and says so. The
alternative is a payload that quietly costs more context than the answer is
worth.

```ts
const many = Array.from({ length: MAX_ENTRIES + 50 }, (_, i) => `<button title="Item ${i}">x</button>`).join("");
const capped = scan(`<main aria-label="Everything">${many}</main>`);
JSON.stringify({ entries: capped.entries.length, truncated: capped.truncated, cap: MAX_ENTRIES })
=> {"entries":200,"truncated":true,"cap":200}
```

A document that fits reports `truncated: false`:

```ts continue
JSON.stringify(scan(`<button title="Send">x</button>`).truncated)
=> false
```

## Resolving an address back to an element

`resolveControl` fails closed, like `resolveRefPath`: an id that is not a
well-formed `cb-` address is rejected without touching the document at all, so a
malformed address can never reach `getElementById`.

```ts
const document = {
  getElementById: (id: string) => (id === "cb-composer-mic" ? { name: "the mic" } : null),
};
JSON.stringify([
  resolveControl("cb-composer-mic", document),
  resolveControl("cb-composer-gone", document),
  resolveControl("composer-mic", document),
  resolveControl("cb-Composer-Mic", document),
  resolveControl("cb-composer.mic", document),
  resolveControl("", document),
])
=>
[{"ok":true,"value":{"name":"the mic"}},{"ok":false,"error":"not-found"},{"ok":false,"error":"bad-id"},{"ok":false,"error":"bad-id"},{"ok":false,"error":"bad-id"},{"ok":false,"error":"bad-id"}]
```

`bad-id` and `not-found` stay distinct because the two read differently to the
user: a wrong address is a mistake in the message, while a missing element is
the *normal* case here — the control unmounted, or the user navigated away.
```
