# `bin/browse` control addressing

`browse/src/controls.ts` is the pure half of the wrapper's control addressing:
how a target argument is read, how a snapshot gets its `id=` annotations from
the app's own scan, what the in-page actionability check returns, and the
warning for a ref number that changed hands between snapshots. Why it exists is
in that file's header; this exercises the contract.

```ts setup
import assert from "node:assert/strict";
import {
  annotateSnapshot, applyLiveIds, boxCenter, judgeBox, parseCheckResult, parseTarget, refRenumbered, upstreamSelector,
} from "../../../browse/src/controls.js";

const SNAPSHOT = [
  '- navigation "Primary" [ref=e1]',
  '  - button "Where you are: Chat" [expanded=false, ref=e7]',
  "  - generic [ref=e2] clickable [onclick]",
  '    - button "Close" [ref=e9]',
  '  - button "User" [expanded=false, ref=e8]',
  '- button "Close" [ref=e4]',
  '- region "Compose message" [ref=e6]',
  '  - textbox "Type a message..." [ref=e11]',
  '  - button "Send" [disabled, ref=e12]',
].join("\n");

const ENTRIES = [
  { id: null, role: "navigation", name: "Primary" },
  { id: "bbx-nav-place", role: "button", name: "Where you are: Chat" },
  { id: "bbx-nav-profile", role: "button", name: "Menu" },
  { id: "bbx-panel-close", role: "button", name: "Close" },
  { id: "bbx-composer-input", role: "textbox", name: "Type a message..." },
  { id: "bbx-composer-send", role: "button", name: "Send" },
];
```

## Targets: bbx- ids in either spelling, refs, and everything else untouched

```ts
assert.deepEqual(parseTarget("bbx-nav-profile"), { kind: "id", id: "bbx-nav-profile" });
assert.deepEqual(parseTarget("#bbx-nav-profile"), { kind: "id", id: "bbx-nav-profile" });
assert.deepEqual(parseTarget("@e12"), { kind: "ref", ref: "e12" });
assert.deepEqual(parseTarget("button.primary"), { kind: "css", selector: "button.primary" });
assert.deepEqual(parseTarget("#trash-card-title"), { kind: "css", selector: "#trash-card-title" });
assert.deepEqual(parseTarget("bbx-Nav"), { kind: "css", selector: "bbx-Nav" }, "not an address: bad case");
assert.deepEqual(parseTarget("//button[@type='submit']"), { kind: "opaque", selector: "//button[@type='submit']" });
assert.deepEqual(parseTarget("text=Send"), { kind: "opaque", selector: "text=Send" });
assert.equal(upstreamSelector({ kind: "id", id: "bbx-x" }), "#bbx-x");
assert.equal(upstreamSelector({ kind: "ref", ref: "e3" }), "@e3");
assert.equal(upstreamSelector({ kind: "opaque", selector: "text=Send" }), "text=Send");
```

## Annotate: unique role+name matches get their id appended; ambiguous and unnamed-by-this-engine do not

```ts
const out = annotateSnapshot(SNAPSHOT, ENTRIES);
const lines = out.text.split("\n");
assert.equal(lines[1], '  - button "Where you are: Chat" [expanded=false, ref=e7, id=bbx-nav-place]');
assert.equal(lines[2], "  - generic [ref=e2] clickable [onclick]", "non-control line untouched, trailing text preserved");
assert.equal(lines[3], '    - button "Close" [ref=e9]', "two Close buttons in the snapshot: not guessed");
assert.equal(lines[4], '  - button "User" [expanded=false, ref=e8]', "engines disagree on the name: left for the live lookup");
assert.equal(lines[7], '  - textbox "Type a message..." [ref=e11, id=bbx-composer-input]');
assert.equal(lines[8], '  - button "Send" [disabled, ref=e12, id=bbx-composer-send]');
assert.deepEqual(out.refs["e8"], { role: "button", name: "User", id: null });
assert.deepEqual(out.refs["e12"], { role: "button", name: "Send", id: "bbx-composer-send" });
assert.deepEqual(out.unmatched.sort(), ["e1", "e2", "e4", "e6", "e8", "e9"]);
```

## Annotate: live lookups fill the gaps and update the ref table

```ts
const out = annotateSnapshot(SNAPSHOT, ENTRIES);
const text = applyLiveIds(out, { e8: "bbx-nav-profile", e9: "bbx-panel-close", e1: "not-a-bbx-id" });
const lines = text.split("\n");
assert.equal(lines[4], '  - button "User" [expanded=false, ref=e8, id=bbx-nav-profile]');
assert.equal(lines[3], '    - button "Close" [ref=e9, id=bbx-panel-close]');
assert.equal(lines[0], '- navigation "Primary" [ref=e1]');
assert.equal(out.refs["e8"]?.id, "bbx-nav-profile");
```

## Renumbering: a ref that changed hands between the last two snapshots is described both ways

```ts
const user = { role: "button", name: "User", id: "bbx-nav-profile" };
const heading = { role: "heading", name: "Chat", id: null };
assert.equal(refRenumbered(user, user), null);
assert.equal(refRenumbered(undefined, user), null, "first snapshot: nothing to compare");
assert.equal(refRenumbered(user, undefined), null, "ref gone from the latest snapshot: upstream reports that itself");
assert.match(refRenumbered(user, heading) ?? "", /named bbx-nav-profile in the snapshot before last and names heading "Chat" now/);
assert.match(refRenumbered(heading, user) ?? "", /named heading "Chat" .* names bbx-nav-profile now/);
```

## Check result: anything that is not a well-formed pass is a failure

```ts
assert.deepEqual(parseCheckResult('"{\\"ok\\":true,\\"scrolled\\":false}"'), { ok: true, scrolled: false });
assert.deepEqual(parseCheckResult('{"ok":false,"reason":"disabled","detail":"button#bbx-composer-send"}'), { ok: false, reason: "disabled", detail: "button#bbx-composer-send" });
assert.deepEqual(parseCheckResult('"{\\"ok\\":true,\\"scrolled\\":true,\\"clickAt\\":{\\"x\\":12.5,\\"y\\":40}}"'), { ok: true, scrolled: true, clickAt: { x: 12.5, y: 40 } });
assert.equal(parseCheckResult("undefined").ok, false);
assert.equal(parseCheckResult("").ok, false);
assert.equal(parseCheckResult('"true"').ok, false);
```

## Geometry: zero-size and off-screen boxes are refused, on-screen passes

```ts
const vp = { width: 1280, height: 800 };
assert.equal(judgeBox({ x: 10, y: 10, width: 0, height: 20 }, vp).ok, false);
assert.equal(judgeBox({ x: -9999, y: 10, width: 50, height: 20 }, vp).ok, false);
assert.equal(judgeBox({ x: 10, y: 900, width: 50, height: 20 }, vp).ok, false);
assert.equal(judgeBox({ x: 1084, y: 513, width: 56, height: 56 }, vp).ok, true);
assert.deepEqual(boxCenter({ x: 1084, y: 513, width: 56, height: 56 }, vp), { x: 1112, y: 541 });
assert.deepEqual(boxCenter({ x: 1270, y: 790, width: 40, height: 40 }, vp), { x: 1279, y: 799 }, "clamped into the viewport");
```
