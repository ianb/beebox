# The UI dump the agent reads

`formatUiDump` renders one client's scan — the payload of `bbx chat ui` — as the
text the agent sees. It is pure, so the format is fixed here rather than in a
browser: a header naming the surface, the URL and the scan time; what the scan
could and could not reach; every omission as a number; the controls grouped by
the landmark they sit in and presented as the links the agent writes back; and
the closing instruction that teaches it how to use them.

```ts setup
import { formatUiDump } from "../../../src/core/chat/ui-dump.js";
import type { UiScanEntry, UiScanPayload } from "../../../src/shared/ui-scan.js";

// The dump prints the scan time in the reader's own timezone ("14:32 local"),
// so the doctest fixes the zone rather than the expectation. Node re-reads
// process.env.TZ on each Date operation.
process.env.TZ = "UTC";

/** One entry with the boring fields filled in, so each case shows only its point. */
function entry(fields: Partial<UiScanEntry> & { role: string; name: string }): UiScanEntry {
  return {
    kind: "control",
    id: null,
    container: null,
    does: null,
    actions: ["point", "focus"],
    disabled: false,
    offscreen: false,
    ...fields,
  };
}

function payload(fields: Partial<UiScanPayload>): UiScanPayload {
  return {
    entries: [],
    omittedUnnamed: 0,
    omittedUnknownRole: 0,
    duplicateIds: [],
    truncated: false,
    coverage: "dom",
    channel: "web-desktop",
    url: "/main/test1/chat",
    scannedAt: "2026-08-23T14:32:07.000Z",
    ...fields,
  };
}

/** The dump minus its closing instruction, which is identical in every case. */
function withoutInstruction(text: string): string {
  const cut = text.indexOf("To point the user at one of these");
  return text.slice(0, cut).trimEnd();
}
```

## A chat page, as the agent receives it

The realistic case: a nav and a composer, one control with no address, one
annotated disclosure trigger with a `— does` line the scan cannot infer, a
disabled Send, an off-screen row, and the counted omissions.

```ts
const chat = payload({
  omittedUnnamed: 3,
  omittedUnknownRole: 1,
  entries: [
    entry({ role: "navigation", name: "Primary", kind: "landmark" }),
    entry({ role: "button", name: "Place: test1", id: "bbx-nav-place", container: "Primary" }),
    entry({
      role: "button",
      name: "Session: Dinner plans",
      id: "bbx-nav-session",
      container: "Primary",
      actions: ["point", "focus", "reveal"],
      does: "the thread menu: new session, recent chats, model, delete this chat",
    }),
    entry({ role: "button", name: "Open debug log (2 errors)", container: "Primary", offscreen: true }),
    entry({ role: "region", name: "Compose message", kind: "landmark" }),
    entry({
      role: "button",
      name: "Add",
      id: "bbx-composer-add",
      container: "Compose message",
      actions: ["point", "focus", "reveal"],
      does: "the attach menu: capture, attach file, upload files, screenshot, share location",
    }),
    entry({ role: "textbox", name: "Type a message...", id: "bbx-composer-input", container: "Compose message" }),
    entry({ role: "button", name: "Send", id: "bbx-composer-send", container: "Compose message", disabled: true }),
    entry({
      role: "button",
      name: "Stop recording",
      id: "bbx-composer-mic",
      container: "Compose message",
      does: 'tap to stop dictating and send; say "cancel message" to discard',
    }),
  ],
});
formatUiDump(chat)
=>
UI on screen — web-desktop, /main/test1/chat, scanned 14:32 local
Covers: browser DOM only. This surface has no native chrome.
3 controls omitted: no accessible name.
1 element omitted: role not one this scan reports.
«blankline»
navigation "Primary"
  button [Place: test1](control:bbx-nav-place)
  button [Session: Dinner plans](control:bbx-nav-session) [reveal]
    — the thread menu: new session, recent chats, model, delete this chat
  button "Open debug log (2 errors)"                     (no address) (off-screen)
region "Compose message"
  button [Add](control:bbx-composer-add) [reveal]
    — the attach menu: capture, attach file, upload files, screenshot,
      share location
  textbox [Type a message...](control:bbx-composer-input)
  button [Send](control:bbx-composer-send) [disabled]
  button [Stop recording](control:bbx-composer-mic)
    — tap to stop dictating and send; say "cancel message" to discard
«blankline»
To point the user at one of these, write its link into your reply:
[the mic](control:bbx-composer-mic?action=point&description=tap%20and%20talk).
`action` is `point` (default), `focus`, or `reveal` — `reveal` is available
only on a control marked `[reveal]`, and it opens the control; it never acts
for the user. A control shown as `(no address)` is on screen but has no link —
describe it in words instead of inventing an address for it. A control shown as
`(not pointable)` is on screen and named, but this app cannot draw a pointer on
it; describe that one in words too.
```

The three `bbx-` controls the plan's done-when names are all addressable, and
only the annotated one offers `reveal`:

```ts continue
const marks = ["bbx-composer-mic", "bbx-composer-send", "bbx-composer-add"].map((id) => {
  const line = formatUiDump(chat).split("\n").find((row) => row.includes(`control:${id}`)) ?? "missing";
  return `${id}: ${line.includes("[reveal]") ? "reveal" : "no reveal"}`;
});
marks.join(", ")
=> bbx-composer-mic: no reveal, bbx-composer-send: no reveal, bbx-composer-add: reveal
```

## What the scan could not see is said out loud

Inside the native shell the composer, mic, capture and box switcher are native
chrome the web scan cannot reach. A dump that just omitted them would read as
"this surface has no such controls", which is the failure this feature exists
to avoid — so the sentence names them.

```ts
withoutInstruction(formatUiDump(payload({ coverage: "dom-native-unavailable", channel: "ios-native" })))
=>
UI on screen — ios-native, /main/test1/chat, scanned 14:32 local
Covers: browser DOM only — the native app did not answer. The composer,
the mic, capture and the box switcher are native controls on this surface
and are missing from this list; describe them in words rather than
pointing at them.
«blankline»
No controls were found on screen — the page may still be loading.
```

Once Track 5's bridge answers, the same dump reports both halves:

```ts continue
formatUiDump(payload({ coverage: "dom+native", channel: "ios-native" })).split("\n")[1]
=> Covers: browser DOM and the native app's own controls.
```

## Truncation and duplicate addresses are stated, not implied

A duplicated `bbx-` id resolves to whichever element comes first in the document,
which no pointer can detect at click time — so the dump names it, and a
truncated list says it is short.

```ts
withoutInstruction(
  formatUiDump(
    payload({
      truncated: true,
      duplicateIds: ["bbx-composer-send"],
      entries: [entry({ role: "button", name: "Send", id: "bbx-composer-send" })],
    })
  )
)
=>
UI on screen — web-desktop, /main/test1/chat, scanned 14:32 local
Covers: browser DOM only. This surface has no native chrome.
List truncated: there is more chrome on screen than is shown below.
Duplicate addresses — bbx-composer-send — each appears on more than one
element, so a pointer to it may reach the wrong one.
«blankline»
button [Send](control:bbx-composer-send)
```

## Two breakpoints, one control

Track 4a could not unify the desktop and mobile composer rows, so the mobile
copies carry their own ids. When both are listed the dump says which one the
user can actually reach — off-screen loses; if both are on screen, the channel
decides.

```ts
const bothRows = [
  entry({ role: "textbox", name: "Type a message...", id: "bbx-composer-input" }),
  entry({ role: "textbox", name: "Type a message...", id: "bbx-composer-input-mobile" }),
];
const reachable = (fields: Partial<UiScanPayload>): string => {
  const text = formatUiDump(payload({ entries: bothRows, ...fields })).replace(/\s+/g, " ");
  const match = /At this viewport (\S+) is the one/.exec(text);
  return match === null ? "no note" : match[1];
};
print(`desktop: ${reachable({ channel: "web-desktop" })}`);
print(`mobile: ${reachable({ channel: "web-mobile" })}`);
=>
desktop: bbx-composer-input
mobile: bbx-composer-input-mobile
```

An off-screen row loses regardless of the channel — that is the case where the
layout has already made the decision:

```ts continue
const offscreenDesktop = [
  entry({ role: "textbox", name: "Type a message...", id: "bbx-composer-input", offscreen: true }),
  entry({ role: "textbox", name: "Type a message...", id: "bbx-composer-input-mobile" }),
];
formatUiDump(payload({ entries: offscreenDesktop, channel: "web-desktop" }))
  .replace(/\s+/g, " ")
  .includes("At this viewport bbx-composer-input-mobile is the one")
=> true
```

## Native chrome, pointable like anything else

On the phone the shell answers with its own registry, and those entries are
grouped under the native surface they belong to. They carry their shared `bbx-`
address and the actions the shell says it can perform, so they print as the same
`control:` links a DOM control does — the composer's text field takes a `focus`,
the Add button is marked `[reveal]`, and the mic takes neither.

```ts
const nativeEntries: UiScanEntry[] = [
  entry({ kind: "landmark", role: "native", name: "Composer", actions: [] }),
  entry({
    role: "button",
    name: "Add",
    id: "bbx-composer-add",
    container: "Composer",
    does: "opens the attach menu",
    actions: ["point", "reveal"],
  }),
  entry({
    role: "textbox",
    name: "Type a message",
    id: "bbx-composer-input",
    container: "Composer",
    actions: ["point", "focus"],
  }),
  entry({
    role: "button",
    name: "Start dictation",
    id: "bbx-composer-mic",
    container: "Composer",
    does: "hold to dictate; tap for continuous dictation",
    actions: ["point"],
  }),
];
withoutInstruction(formatUiDump(payload({
  entries: nativeEntries,
  coverage: "dom+native",
  channel: "ios-native",
})))
=>
UI on screen — ios-native, /main/test1/chat, scanned 14:32 local
Covers: browser DOM and the native app's own controls.
«blankline»
native "Composer"
  button [Add](control:bbx-composer-add) [reveal]
    — opens the attach menu
  textbox [Type a message](control:bbx-composer-input)
  button [Start dictation](control:bbx-composer-mic)
    — hold to dictate; tap for continuous dictation
```

An installed shell too old to act on anything reports no actions at all, and the
dump refuses to hand out a link it knows would break on click.

```ts
withoutInstruction(formatUiDump(payload({
  entries: [
    entry({ kind: "landmark", role: "native", name: "Composer", actions: [] }),
    entry({ role: "button", name: "Send", id: "bbx-composer-send", container: "Composer", actions: [], disabled: true }),
  ],
  coverage: "dom+native",
  channel: "ios-native",
})))
=>
UI on screen — ios-native, /main/test1/chat, scanned 14:32 local
Covers: browser DOM and the native app's own controls.
«blankline»
native "Composer"
  button "Send"                                          (not pointable) [disabled]
```
