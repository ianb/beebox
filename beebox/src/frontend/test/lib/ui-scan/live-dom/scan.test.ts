// # Walking the screen for controls
//
// `scanControls` walks the document and reports the interactive controls and
// landmarks currently on screen — an address where one was authored, a role, a
// live accessible name, the enclosing landmark, and what the control does.
// `resolveControl` runs the other way, from an address back to the element.
//
// The frontend tests run under plain Node with no jsdom, so the walk is written
// against `ScanElement` — a structural view of an element — rather than `Element`.
// `live-dom.ts` adapts the real document to that view; the fixture helper here
// parses HTML and supplies the two things a parser cannot know, because in the
// browser they come from CSS and layout: `data-test-style` is the computed style,
// `data-test-rect` is `left,top,width,height` of the border box. Everything else
// is markup copied from `InteractiveChat-composer.tsx`,
// `InteractiveChat-voice-button.tsx` and `ui/Dropdown.tsx`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { scanControls, MAX_ENTRIES } from "../../../../src/lib/ui-scan/live-dom/scan.js";
import { controlAddress, resolveControl, resolveVisibleControl } from "../../../../src/lib/ui-scan/resolve.js";
import type { ControlEntry, ScanResult } from "../../../../src/lib/ui-scan/types.js";
import { fixtureLookup, fixtureRoot, type VisibleFixtureLookup } from "../../../../../../test/frontend/lib/ui-scan/fixture.js";

/** An expected entry: a control that points and focuses, unless a field says otherwise. */
function entry(fields: Pick<ControlEntry, "role" | "name"> & Partial<ControlEntry>): ControlEntry {
  return {
    kind: "control", id: null, container: null, does: null, actions: ["point", "focus"],
    disabled: false, offscreen: false, ...fields,
  };
}

/** The default scope: everything on the page, which is what a driver reads. */
function scan(html: string): ScanResult {
  return scanControls(fixtureRoot(html), { viewport: { width: 1024, height: 768 }, scope: "document" });
}

/** What the `bbx chat ui` dump asks for: the app's own controls, without card contents. */
function scanChrome(html: string): ScanResult {
  return scanControls(fixtureRoot(html), { viewport: { width: 1024, height: 768 }, scope: "chrome" });
}

/** One line per address resolved against a fixture document: visible, or why not. */
function outcome(id: string, lookup: VisibleFixtureLookup): string {
  const resolved = resolveVisibleControl(id, lookup);
  return `${id}: ${resolved.ok ? "visible" : resolved.error}`;
}

// ## The composer, as the agent would see it
//
// The composer is a named region (`<section aria-label="Compose message">`), so
// every control inside it reports that as its container. The Add trigger is
// annotated — an address, a `data-bbx-does` for the menu the scan cannot see into,
// and `data-bbx-reveal` — while the capture button beside it is not, and degrades to
// its accessible name with a null address.
void test("The composer is a named region (<section aria-label=\"Compose message\">), so e...", async (t) => {
  const composer = scan(`
  <section aria-label="Compose message">
    <button type="button" id="bbx-composer-add" title="Add" aria-label="Add"
            aria-haspopup="menu" aria-expanded="false"
            data-bbx-reveal
            data-bbx-does="opens the attach menu — capture, attach file, upload files, screenshot, share location">
      <svg viewBox="0 0 24 24"></svg>
    </button>
    <button type="button" title="Capture" aria-label="Capture">
      <svg viewBox="0 0 24 24"></svg>
    </button>
    <textarea id="bbx-composer-input" placeholder="Type a message..."></textarea>
    <button id="bbx-composer-send" disabled title="Send"><svg viewBox="0 0 24 24"></svg></button>
    <button id="bbx-composer-mic" title="Stop recording"
            data-bbx-does="tap to stop dictating and send; say &quot;cancel message&quot; to discard">
      <svg viewBox="0 0 24 24"></svg>
    </button>
  </section>
`);
  // `reveal` comes from the attribute and from nothing else. `aria-haspopup` and
  // `aria-expanded` are on the Add trigger too, but inferring from them would be a
  // guess dressed as a guarantee — `role="tab"` fires real state changes in this app
  // — so the author's opt-in is the only source.
  t.check(composer, {
    entries: [
      entry({ kind: "landmark", role: "region", name: "Compose message" }),
      entry({ id: "bbx-composer-add", role: "button", name: "Add", container: "Compose message", does: "opens the attach menu — capture, attach file, upload files, screenshot, share location", actions: ["point", "focus", "reveal"] }),
      entry({ role: "button", name: "Capture", container: "Compose message" }),
      entry({ id: "bbx-composer-input", role: "textbox", name: "Type a message...", container: "Compose message" }),
      entry({ id: "bbx-composer-send", role: "button", name: "Send", container: "Compose message", disabled: true }),
      entry({ id: "bbx-composer-mic", role: "button", name: "Stop recording", container: "Compose message", does: "tap to stop dictating and send; say \"cancel message\" to discard" }),
    ],
    omittedUnnamed: 0,
    omittedUnknownRole: 0,
    duplicateIds: [],
    truncated: false,
  },
  );
});

// An id only becomes an address when it is in the `bbx-` namespace and kebab-case.
// The frontend's own authored ids — `trash-card-title`, `delete-chat-title` — are
// a11y plumbing, not promises, so they report no address:
void test("An id only becomes an address when it is in the bbx- namespace and kebab-case.", async (t) => {
  t.check(
    scan(`
  <button id="trash-card-title" title="Delete"><svg viewBox="0 0 24 24"></svg></button>
  <button id="bbx-Composer-Send" title="Send"><svg viewBox="0 0 24 24"></svg></button>
  <button id="bbx-nav-place" title="Where you are: test1"><svg viewBox="0 0 24 24"></svg></button>
`), {
    entries: [
      entry({ role: "button", name: "Delete" }),
      entry({ role: "button", name: "Send" }),
      entry({ id: "bbx-nav-place", role: "button", name: "Where you are: test1" }),
    ],
    omittedUnnamed: 0,
    omittedUnknownRole: 0,
    duplicateIds: [],
    truncated: false,
  },
  );
});

// ## Visibility
//
// An element is out of the scan when it is `display:none`, `visibility:hidden`,
// fully transparent, `hidden`, `inert`, inside an `aria-hidden` subtree, or
// measures zero — and so is everything inside it.
void test("An element is out of the scan when it is display:none, visibility:hidden, ful...", async (t) => {
  t.check(
    scan(`
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
`), {
    entries: [
      entry({ kind: "landmark", role: "navigation", name: "Primary" }),
      entry({ role: "button", name: "Visible", container: "Primary" }),
    ],
    omittedUnnamed: 0,
    omittedUnknownRole: 0,
    duplicateIds: [],
    truncated: false,
  },
  );
});

// None of those count as omitted-unnamed: they are not on screen at all, which is
// a different fact from "on screen with no name".
void test("None of those count as omitted-unnamed:", async (t) => {
  const unnamed = scan(`
  <main>
    <button title="Named"><svg viewBox="0 0 24 24"></svg></button>
    <button><svg viewBox="0 0 24 24"></svg></button>
    <button><svg viewBox="0 0 24 24"></svg></button>
  </main>
`);
  t.check(unnamed, {
    entries: [
      entry({ role: "button", name: "Named" }),
    ],
    omittedUnnamed: 3,
    omittedUnknownRole: 0,
    duplicateIds: [],
    truncated: false,
  },
  );
});

// The unnamed `<main>` is in that count: a landmark with no name is a real a11y
// gap, and the dump reports the number so the omission is visible rather than
// silent. A bare `<section>` is not — it only becomes a landmark once it is named,
// so an unnamed one is just a box:
void test("The unnamed <main> is in that count:", async (t) => {
  t.check(scan("<section><button title=\"Send\">x</button></section>"), {
    entries: [
      entry({ role: "button", name: "x" }),
    ],
    omittedUnnamed: 0,
    omittedUnknownRole: 0,
    duplicateIds: [],
    truncated: false,
  },
  );
});

// A named `group` heads its controls the way a landmark does, so a "Later" on
// each of two questions is told apart by the question. An unnamed group is a
// box, like a bare `<section>`, and is not counted as a missing name.
void test("A named group is the container of its controls; an unnamed one is not counted.", async (t) => {
  t.check(scan(`
    <div role="group" aria-label="What is this photo?"><button>Later</button></div>
    <div role="group"><button>Later</button></div>
  `), {
    entries: [
      entry({ kind: "landmark", role: "group", name: "What is this photo?" }),
      entry({ role: "button", name: "Later", container: "What is this photo?" }),
      entry({ role: "button", name: "Later" }),
    ],
    omittedUnnamed: 0,
    omittedUnknownRole: 0,
    duplicateIds: [],
    truncated: false,
  });
});

// ## An id outside the grammar is not an address
//
// The scan reports an `id` only when it is a well-formed address
// (`shared/control-address.ts`), because that is the only kind `bin/browse` can
// interpolate into a selector and the app can honour as a `control:` link. This is
// what the app used to put on a workspace tab and a card's properties button: an
// `encodeURIComponent`'d card path and a React `useId` value, both outside the
// grammar, both reported here with no address at all while the control itself was
// still listed.
void test("The scan reports an id only when it is a well-formed address (shared/control-...", async (t) => {
  t.check(
    scan(`
  <nav aria-label="Open files">
    <button role="tab" id="bbx-workspace-tab-_config%2Finterface%2Fbrowse.card" title="Browse"></button>
    <button id="bbx-card-properties-:r0:" title="Properties"></button>
    <button id="${controlAddress("bbx-workspace-tab", "_config/interface/browse.card")}" role="tab" title="Notes"></button>
  </nav>
`), {
    entries: [
      entry({ kind: "landmark", role: "navigation", name: "Open files" }),
      entry({ role: "tab", name: "Browse", container: "Open files" }),
      entry({ role: "button", name: "Properties", container: "Open files" }),
      entry({ id: "bbx-workspace-tab-l5rw63tgnfts62loorsxeztbmnss6ytsn53xgzjomnqxeza", role: "tab", name: "Notes", container: "Open files" }),
    ],
    omittedUnnamed: 0,
    omittedUnknownRole: 0,
    duplicateIds: [],
    truncated: false,
  },
  );

  // A `bbx-` id that is not an address is not reported as a duplicate either, even
  // when it genuinely repeats. The warning exists because a duplicate sends an
  // id-addressed action to the wrong control, which is not a risk for an id nothing
  // can be addressed by — and a non-address in that list is a string the wire schema
  // rejects, which would fail the whole dump over internal a11y wiring.

  t.check(
    scan(`
  <button id="bbx-card-properties-:r0:" title="Properties"></button>
  <button id="bbx-card-properties-:r0:" title="Properties"></button>
`), {
    entries: [
      entry({ role: "button", name: "Properties" }),
      entry({ role: "button", name: "Properties" }),
    ],
    omittedUnnamed: 0,
    omittedUnknownRole: 0,
    duplicateIds: [],
    truncated: false,
  },
  );
});

// ## Content is not chrome, when the caller asks for chrome
//
// `scope` decides how much of the page one scan covers. The `bbx chat ui` dump
// asks for `chrome`, and a subtree marked `data-bbx-scan="exclude"` is then pruned
// the way an `aria-hidden` one is — the chat transcript, the card open in the
// companion pane, an embed. Not as a privacy boundary: the agent can open any of
// that content directly. It is editorial — the dump answers "what controls does
// the app offer", and a rendered card's own links would bury the answer.
void test("scope decides how much of the page one scan covers.", async (t) => {
  const boundary = scanChrome(`
  <main aria-label="Chat">
    <button title="Show earlier messages"></button>
    <div data-bbx-scan="exclude">
      <a href="/notes/Rent.card" title="Rent">Rent</a>
      <button title="Retry this turn"></button>
      <div><button id="bbx-nested-deep" title="Buried three levels down"></button></div>
    </div>
    <button id="bbx-panel-close" title="Close companion view"></button>
  </main>
`);
  // Nothing inside the boundary is counted, either. An omission the dump reports is
  // one the agent might otherwise be misled by; "3 controls you may not see" would
  // invite exactly the guessing a narrowed list exists to prevent.
  t.check(boundary, {
    entries: [
      entry({ kind: "landmark", role: "main", name: "Chat" }),
      entry({ role: "button", name: "Show earlier messages", container: "Chat" }),
      entry({ id: "bbx-panel-close", role: "button", name: "Close companion view", container: "Chat" }),
    ],
    omittedUnnamed: 0,
    omittedUnknownRole: 0,
    duplicateIds: [],
    truncated: false,
  },
  );

  // The default scope reads the same page whole. A driver needs this: the controls
  // inside a card are the ones it is there to click, and a scan that skipped them
  // would print their snapshot lines with no id, which reads as "the app never
  // annotated this" rather than "you asked for the other scope".

  t.check(
    scan(`
  <main aria-label="Chat">
    <button title="Show earlier messages"></button>
    <div data-bbx-scan="exclude">
      <a href="/notes/Rent.card" title="Rent">Rent</a>
      <button title="Retry this turn"></button>
      <div><button id="bbx-nested-deep" title="Buried three levels down"></button></div>
    </div>
    <button id="bbx-panel-close" title="Close companion view"></button>
  </main>
`), {
    entries: [
      entry({ kind: "landmark", role: "main", name: "Chat" }),
      entry({ role: "button", name: "Show earlier messages", container: "Chat" }),
      entry({ role: "link", name: "Rent", container: "Chat" }),
      entry({ role: "button", name: "Retry this turn", container: "Chat" }),
      entry({ id: "bbx-nested-deep", role: "button", name: "Buried three levels down", container: "Chat" }),
      entry({ id: "bbx-panel-close", role: "button", name: "Close companion view", container: "Chat" }),
    ],
    omittedUnnamed: 0,
    omittedUnknownRole: 0,
    duplicateIds: [],
    truncated: false,
  },
  );
});

// Duplicate detection ignores the scope: it covers the whole document either way,
// because a repeated `bbx-` id anywhere is a repeated id `getElementById` will
// resolve to the wrong one of.
void test("Duplicate detection ignores the scope:", async (t) => {
  t.check(
    scanChrome(`
  <button id="bbx-panel-close" title="Close companion view"></button>
  <div data-bbx-scan="exclude"><button id="bbx-panel-close" title="Close"></button></div>
`), {
    entries: [
      entry({ id: "bbx-panel-close", role: "button", name: "Close companion view" }),
    ],
    omittedUnnamed: 0,
    omittedUnknownRole: 0,
    duplicateIds: [
      "bbx-panel-close",
    ],
    truncated: false,
  },
  );
});

// ## A landmark is never named by its contents
//
// ARIA does not let a region take its name from what is inside it, and the scan
// must not either: `<main>` holding the chat transcript would otherwise report the
// whole conversation as its "name" — user content in a dump that is meant to be
// chrome only. An unnamed `<main>` is a real a11y gap, so it lands in the
// omitted-unnamed count instead.
void test("ARIA does not let a region take its name from what is inside it, and the scan...", async (t) => {
  const transcript = scan(`
  <main>
    <p>Please reply with just the word ok.</p>
    <button title="Retry"><svg viewBox="0 0 24 24"></svg></button>
  </main>
`);
  t.check(transcript, {
    entries: [
      entry({ role: "button", name: "Retry" }),
    ],
    omittedUnnamed: 1,
    omittedUnknownRole: 0,
    duplicateIds: [],
    truncated: false,
  },
  );
});

// ## An unrecognised explicit role is counted too
//
// Every omission gets a number. An element carrying an explicit `role` the scan
// does not report — a `dialog`, a `list`, or an author's typo, which look identical
// from here — is left out of the entries and counted, so the dump can say the list
// is not everything. `presentation`/`none` are excluded: those are the author
// saying "this is not a control", which is a decision, not an omission.
void test("Every omission gets a number.", async (t) => {
  const roles = scan(`
  <main aria-label="Everything">
    <button title="Send">x</button>
    <div role="dialog" aria-label="Settings">…</div>
    <div role="buton" aria-label="Typo">…</div>
    <div role="presentation">…</div>
  </main>
`);
  t.check(roles, {
    entries: [
      entry({ kind: "landmark", role: "main", name: "Everything" }),
      entry({ role: "button", name: "x", container: "Everything" }),
    ],
    omittedUnnamed: 0,
    omittedUnknownRole: 2,
    duplicateIds: [],
    truncated: false,
  },
  );

  // A zero-sized element with an unknown role is not on screen in any sense the user
  // would recognise, so it is not counted either:

  t.check(scan("<div role=\"dialog\" data-test-rect=\"0,0,0,0\">…</div>"), {
    entries: [],
    omittedUnnamed: 0,
    omittedUnknownRole: 0,
    duplicateIds: [],
    truncated: false,
  },
  );
});

// ## Off-screen but mounted is included, and marked
//
// A control scrolled out of view is exactly what `point` exists to scroll to, so
// it stays in the list with a flag rather than disappearing from it.
void test("A control scrolled out of view is exactly what point exists to scroll to, so...", async (t) => {
  t.check(
    scan(`
  <nav aria-label="Primary">
    <button title="In view" data-test-rect="10,10,120,32"><svg viewBox="0 0 24 24"></svg></button>
    <button title="Below the fold" data-test-rect="10,900,120,32"><svg viewBox="0 0 24 24"></svg></button>
    <button title="Scrolled off the left" data-test-rect="-300,10,120,32"><svg viewBox="0 0 24 24"></svg></button>
  </nav>
`), {
    entries: [
      entry({ kind: "landmark", role: "navigation", name: "Primary" }),
      entry({ role: "button", name: "In view", container: "Primary" }),
      entry({ role: "button", name: "Below the fold", container: "Primary", offscreen: true }),
      entry({ role: "button", name: "Scrolled off the left", container: "Primary", offscreen: true }),
    ],
    omittedUnnamed: 0,
    omittedUnknownRole: 0,
    duplicateIds: [],
    truncated: false,
  },
  );
});

// ## Duplicate addresses are reported, hidden ones included
//
// `DesktopComposerRow` (`hidden sm:flex`) and the mobile row (`sm:hidden`) render
// the same controls and are *both mounted* — CSS-hidden by breakpoint, not
// DOM-exclusive. A shared id there breaks `getElementById`, `<label for>` and every
// `aria-*` reference, so the duplicate pass covers the whole document rather than
// only the visible part, and reports what a visibility-limited walk would miss.
void test("DesktopComposerRow (hidden sm:flex) and the mobile row (sm:hidden) render the...", async (t) => {
  const rows = scan(`
  <section aria-label="Compose message">
    <div data-test-style="display:none">
      <button id="bbx-composer-send" title="Send">desktop</button>
    </div>
    <div>
      <button id="bbx-composer-send" title="Send">mobile</button>
    </div>
  </section>
`);
  t.check(rows, {
    entries: [
      entry({ kind: "landmark", role: "region", name: "Compose message" }),
      entry({ id: "bbx-composer-send", role: "button", name: "mobile", container: "Compose message" }),
    ],
    omittedUnnamed: 0,
    omittedUnknownRole: 0,
    duplicateIds: [
      "bbx-composer-send",
    ],
    truncated: false,
  },
  );
});

// Resolution cannot see it — `getElementById` returns the first in document order
// — which is why uniqueness is enforced upstream by axe in the tours and reported
// here as a second line of defence.
//
// ## The entry cap
//
// A page with more chrome than the cap produces a truncated list, and says so. The
// alternative is a payload that quietly costs more context than the answer is
// worth.
void test("Resolution cannot see it — getElementById returns the first in document order...", async (t) => {
  const many = Array.from({ length: MAX_ENTRIES + 50 }, (_, i) => `<button title="Item ${i}">x</button>`).join("");
  const capped = scan(`<main aria-label="Everything">${many}</main>`);
  t.check({ entries: capped.entries.map((found) => found.name), truncated: capped.truncated, cap: MAX_ENTRIES }, {
    entries: ["Everything", ...Array.from({ length: 299 }, () => "x")],
    truncated: true,
    cap: 300,
  });

  // A document that fits reports `truncated: false`:

  t.check(scan("<button title=\"Send\">x</button>"), {
    entries: [
      entry({ role: "button", name: "x" }),
    ],
    omittedUnnamed: 0,
    omittedUnknownRole: 0,
    duplicateIds: [],
    truncated: false,
  },
  );
});

// ## Resolving an address back to an element
//
// `resolveControl` fails closed, like `resolveRefPath`: an id that is not a
// well-formed `bbx-` address is rejected without touching the document at all, so a
// malformed address can never reach `getElementById`.
void test("resolveControl fails closed, like resolveRefPath:", async (t) => {
  const document = {
    getElementById: (id: string) => (id === "bbx-composer-mic" ? { name: "the mic" } : null),
  };
  t.check(
    [
      resolveControl("bbx-composer-mic", document),
      resolveControl("bbx-composer-gone", document),
      resolveControl("composer-mic", document),
      resolveControl("bbx-Composer-Mic", document),
      resolveControl("bbx-composer.mic", document),
      resolveControl("", document),
    ],
    [
    {
      ok: true,
      value: {
        name: "the mic",
      },
    },
    {
      ok: false,
      error: "not-found",
    },
    {
      ok: false,
      error: "bad-id",
    },
    {
      ok: false,
      error: "bad-id",
    },
    {
      ok: false,
      error: "bad-id",
    },
    {
      ok: false,
      error: "bad-id",
    },
  ],
  );
});

// `bad-id` and `not-found` stay distinct because the two read differently to the
// user: a wrong address is a mistake in the message, while a missing element is
// the *normal* case here — the control unmounted, or the user navigated away.
//
// ## Resolving to something the user can actually see
//
// Existing is not enough to act on. Both composer rows are mounted at every
// width — the desktop one is `hidden sm:flex`, the mobile one `sm:hidden` — so at
// a phone width `bbx-composer-send` resolves to a `display:none` button. Pointing
// at it would ring a box nobody can see, and `reveal` would synthetically click a
// hidden control. `resolveVisibleControl` applies the same visibility rules the
// scan walks with (`visibility.ts`, shared by both so they cannot disagree) and
// reports a found-but-hidden element as its own failure.
void test("bad-id and not-found stay distinct because the two read differently to the user:", async (t) => {
  /** The document at a phone width: the desktop row is the CSS-hidden one. */
  const mobileViewport = fixtureLookup(`
  <section aria-label="Compose message">
    <div data-test-style="display:none">
      <textarea id="bbx-composer-input" placeholder="Type a message..."></textarea>
      <button id="bbx-composer-send" title="Send"></button>
    </div>
    <div>
      <textarea id="bbx-composer-input-mobile" placeholder="Type a message..."></textarea>
      <button id="bbx-composer-send-mobile" title="Send"></button>
    </div>
  </section>
`);
  t.check(
    ["bbx-composer-send", "bbx-composer-send-mobile", "bbx-composer-gone", "bbx-Composer-Send"]
      .map((id) => outcome(id, mobileViewport)),
    [
      "bbx-composer-send: hidden",
      "bbx-composer-send-mobile: visible",
      "bbx-composer-gone: not-found",
      "bbx-Composer-Send: bad-id",
    ],
  );

  // `hidden` stays distinct from `not-found` because the two are different answers:
  // the control exists, it is simply not on this screen right now, and the pointer
  // says so rather than claiming the app has no such control.
  //
  // Hiding is inherited, and a zero-sized element is not on screen either — the same
  // two rules the walk descends with:

  const kinds = fixtureLookup(`
  <div aria-hidden="true"><button id="bbx-nav-todo" title="To do"></button></div>
  <button id="bbx-nav-errors" title="Errors" data-test-rect="0,0,0,0"></button>
  <button id="bbx-nav-place" title="Place" data-test-style="visibility:hidden"></button>
  <button id="bbx-nav-voice" title="Voice" data-test-rect="10,900,120,32"></button>
`);
  t.check(
    ["bbx-nav-todo", "bbx-nav-errors", "bbx-nav-place", "bbx-nav-voice"]
      .map((id) => outcome(id, kinds)),
    [
      "bbx-nav-todo: hidden",
      "bbx-nav-errors: hidden",
      "bbx-nav-place: hidden",
      "bbx-nav-voice: visible",
    ],
  );
});

// The last one is the deliberate case: scrolled below the fold is *visible*. A
// control out of view is what `point` exists to scroll to, so it resolves and the
// pointer scrolls to it — unlike a `display:none` one, which nothing can bring
// into view.
