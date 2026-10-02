# `installGuides` — stock guides from before experiments lost `status`, and before `basis`

Stock guides used to mark their seed experiment `status: active`; they now
write `active: true`, last in the entry, where the `status-fields-2026-09`
migration puts it. Their triage rules then said `source: default`; they now
say `basis: default`, where the `source-fields-2026-09` migration puts it. An
untracked box (no `_config/template-versions.json` entry) still holding either
old stock copy takes the update in place instead of parking it. A tracked box
whose copy differs from its recorded version keeps its copy: that is an edit.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { installGuides } from "../../../../src/core/box/structure/core.js";
import { createInitialGuideTemplate } from "../../../../src/schemas/guide/templates.js";

/** The stock form before triage rules' `source` became `basis`. */
function preBasisStock(name: string): string {
  return createInitialGuideTemplate({ name }).replaceAll("\n    basis: ", "\n    source: ");
}

/** The pre-2026-09 stock form: `status: active` right after the experiment id. */
function oldStock(name: string): string {
  const current = preBasisStock(name);
  const withoutActive = current.replace("\n    active: true\n", "\n");
  const match = /\n {2}- id: [^\n]+\n/.exec(withoutActive);
  if (match === null) throw new Error("no experiment id line");
  const at = match.index + match[0].length;
  return `${withoutActive.slice(0, at)}    status: active\n${withoutActive.slice(at)}`;
}

async function boxWith(files: Record<string, string>) {
  const box = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-install-guides-"));
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(box, rel)), { recursive: true });
    await fs.writeFile(path.join(box, rel), content);
  }
  return box;
}
```

## An untracked box's old stock guides update in place

```ts
const box = await boxWith({
  "_config/intake.guide.card": oldStock("intake"),
  "_config/calendar.guide.card": oldStock("calendar"),
});
JSON.stringify(await installGuides(box))
=> ["intake.guide.card (updated)","calendar.guide.card (updated)"]

(await fs.readFile(path.join(box, "_config/intake.guide.card"), "utf-8")) === createInitialGuideTemplate({ name: "intake" })
=> true
```

## An untracked box's pre-`basis` stock guide updates in place

```ts continue
const preBasis = await boxWith({ "_config/intake.guide.card": preBasisStock("intake") });
JSON.stringify((await installGuides(preBasis)).filter((entry) => entry.includes("intake.guide.card")))
=> ["intake.guide.card (updated)"]

(await fs.readFile(path.join(preBasis, "_config/intake.guide.card"), "utf-8")) === createInitialGuideTemplate({ name: "intake" })
=> true
```

## A tracked box that diverged from its recorded version parks the update

```ts continue
const tracked = await boxWith({
  "_config/intake.guide.card": oldStock("intake"),
  "_config/template-versions.json": JSON.stringify({ "_config/intake.guide.card": { sha256: "0".repeat(64), "installed-at": "2026-09-01T00:00:00Z" } }),
});
JSON.stringify((await installGuides(tracked)).filter((entry) => entry.includes("intake.guide.card")).map((entry) => entry.endsWith("(update available)")))
=> [true]

(await fs.readFile(path.join(tracked, "_config/intake.guide.card"), "utf-8")) === oldStock("intake")
=> true
```

```ts cleanup
await fs.rm(box, { recursive: true, force: true });
await fs.rm(tracked, { recursive: true, force: true });
await fs.rm(preBasis, { recursive: true, force: true });
```
