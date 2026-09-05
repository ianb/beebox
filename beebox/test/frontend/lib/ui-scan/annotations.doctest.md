# The annotations themselves: ids, `data-bbx-reveal`, `data-bbx-does`

`scan.doctest.md` checks what the walk does with the attributes. This one checks
the attributes we actually wrote — over the frontend source, not a rendered
page, because these are claims about the code:

- every `data-bbx-reveal` sits on an element that also presents disclosure
  semantics (`aria-expanded` / `aria-haspopup` / `role="tab"`);
- every id in the plan's Track 4 table exists in the source exactly once;
- every `bbx-` id is kebab-case, and no `bbx-` id exists that the table doesn't
  name.

Document-level id *uniqueness* is axe's job in `bin/tour --all`
(`duplicate-id`, `duplicate-id-active`, `duplicate-id-aria`) — this file checks
the source, axe checks the rendered page. The two catch different things: a
component rendered twice on one page is invisible here and obvious there.

```ts setup
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PACKAGE_ROOT } from "../../../../src/lib/package-root.js";

const FRONTEND_SRC = join(PACKAGE_ROOT, "src/frontend/src");
const PLAN = join(PACKAGE_ROOT, "docs/plans/agent-points-at-ui.md");

interface SourceFile { path: string; text: string }

async function frontendSources(dir: string): Promise<SourceFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: SourceFile[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await frontendSources(full));
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      out.push({ path: full.slice(FRONTEND_SRC.length + 1), text: await readFile(full, "utf8") });
    }
  }
  return out;
}

const SOURCES = await frontendSources(FRONTEND_SRC);

/** The ids the plan's Track 4 table names in its web column, in table order. */
function planWebIds(plan: string): string[] {
  const rows = plan.split("\n").filter((line) => /^\| `bbx-/.test(line));
  return rows.flatMap((row) => {
    const cells = row.split("|").slice(1);
    // A cell that opens with an em dash is "no counterpart on this platform",
    // with or without a parenthetical saying why.
    if (cells[1].trim().startsWith("\u2014")) return [];
    return [...cells[0].matchAll(/`(bbx-[\w-]+)`/g)].map((m) => m[1]);
  });
}

const TABLE_IDS = planWebIds(await readFile(PLAN, "utf8"));

function countInSource(id: string): number {
  return SOURCES.reduce((n, f) => n + f.text.split(`id="${id}"`).length - 1, 0);
}

/** Every distinct `bbx-` id literal the frontend source carries. */
const SOURCE_IDS = [...new Set(SOURCES.flatMap((f) => [...f.text.matchAll(/id="(bbx-[^"]*)"/g)].map((m) => m[1])))];

/**
 * The text of every JSX opening tag in a file, innermost tags included.
 *
 * A regex can't do this: an attribute value holds arrow functions (`() =>`),
 * template literals and nested JSX, so the first `>` after `<Dropdown` is
 * routinely not the end of that tag. So walk it — tracking quotes and brace
 * depth — and stop at the first `>` that is neither quoted nor inside `{...}`.
 * Comments are stripped first: an apostrophe in one ("the menu-default") would
 * otherwise open a string that never closes.
 */
function openingTags(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const tags: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "<") continue;
    const next = text[i + 1];
    if (next === undefined || !/[A-Za-z]/.test(next)) continue;
    let depth = 0;
    let quote: string | null = null;
    for (let j = i + 1; j < text.length; j++) {
      const c = text[j];
      if (quote !== null) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "{") { depth++; continue; }
      if (c === "}") { depth--; continue; }
      if (c === ">" && depth === 0) { tags.push(text.slice(i, j + 1)); break; }
    }
  }
  return tags;
}

/**
 * `file:tagname` for each opening tag matching a predicate, narrowed to the
 * innermost match — a `<Dropdown>` tag textually contains its `trigger` prop's
 * `<button>`, and the attribute belongs to the button.
 */
function tagsWhere(predicate: (tag: string) => boolean): { site: string; tag: string }[] {
  const found: { site: string; tag: string }[] = [];
  for (const file of SOURCES) {
    const matches = openingTags(file.text).filter(predicate);
    const innermost = matches.filter((tag) => !matches.some((other) => other !== tag && tag.includes(other)));
    for (const tag of innermost) {
      const name = /^<([A-Za-z][\w.]*)/.exec(tag);
      found.push({ site: `${file.path}:${name === null ? "?" : name[1]}`, tag });
    }
  }
  return found;
}
```

## Every `data-bbx-reveal` presents disclosure semantics

`reveal` is the one action that dispatches a synthetic click, and the attribute
is the author's assertion that clicking only changes what is disclosed. That
assertion is *not* inferred from ARIA — `role="tab"` fires real state changes in
this codebase (`TabBar.tsx`, the companion-pane tabs), so ARIA can't classify an
action as safe. The check runs the other way: a control that opted in must at
least *have* disclosure semantics, which catches tagging something that discloses
nothing.

Our four triggers are all `Dropdown` triggers, and a `Dropdown` hands its
trigger the ARIA through `ariaProps` rather than literal attributes — so a
spread of that object counts, and the next section pins down what it contains.

```ts
const reveals = tagsWhere((tag) => tag.includes("data-bbx-reveal"));
reveals.map((r) => r.site).sort().join("\n")
=> components/AppNav.tsx:button
components/chat/InteractiveChat-composer.tsx:button
components/chat/SessionChip.tsx:button
components/chat/VoiceChip.tsx:button

const DISCLOSURE = /aria-expanded|aria-haspopup|role="tab"|\{\.\.\.ariaProps\}/;
reveals.filter((r) => !DISCLOSURE.test(r.tag)).map((r) => r.site)
=> []
```

## …and `ariaProps` really is that ARIA

The spread above is only evidence if `Dropdown` puts the attributes in it. It
does, and the type says so, so a rename breaks this test rather than silently
hollowing out the check.

```ts
const dropdown = SOURCES.find((f) => f.path === "components/ui/Dropdown.tsx")!;
const ariaPropsType = /ariaProps: \{[^}]*\}/.exec(dropdown.text)![0];
ariaPropsType.includes("aria-haspopup") && ariaPropsType.includes("aria-expanded")
=> true
```

## Every id in the plan's table exists exactly once

The table in `docs/plans/agent-points-at-ui.md` (Track 4) is the contract — the
same strings are the iOS `accessibilityIdentifier`s — so this reads the plan
rather than restating it. A `—` in the web column means the platform has no
counterpart and is skipped here; the iOS column is Track 5's to check.

```ts
TABLE_IDS.join("\n")
=> bbx-nav-place
bbx-nav-session
bbx-nav-voice
bbx-nav-profile
bbx-nav-todo
bbx-nav-errors
bbx-composer-add
bbx-composer-input
bbx-composer-send
bbx-composer-input-mobile
bbx-composer-send-mobile
bbx-composer-mic
bbx-composer-capture
bbx-chat-stop-agent
bbx-chat-stop-speech
bbx-panel-tabs
bbx-panel-close
```

```ts continue
TABLE_IDS.filter((id) => countInSource(id) !== 1).map((id) => id + ": " + countInSource(id))
=> []
```

Note what "exactly once" is buying: a send button rendered in two branches of a
ternary is the same control in the interface, and appears once here because the
branches share one `ComposerSendButton` element. If a second literal shows up,
that is the signal to ask whether the two really can't coexist in the DOM — the
desktop and mobile composer rows can, which is why they carry different ids.

## Every `bbx-` id is kebab-case, and no literal is authored twice

Kebab-case is not cosmetic: `querySelector("#a.b")` parses a dotted id as
id `a` plus class `b`, so the address form has to stay selector-safe.

The table above is the *shared* contract, not the inventory: since the
2026-08-23 pass every static control in the frontend carries an id (the
`bbx-frontend` skill's accessibility baseline), so the source holds far more ids
than iOS mirrors, and the check that used to require the table to name them
all would only ever be satisfied by a table nobody reads. What still has to
hold for every id is that it is authored once — two literals with the same
string are two elements answering one `getElementById`, and the runtime
duplicate check (axe in the tours) only sees the pages a tour visits.

```ts
SOURCE_IDS.filter((id) => !/^bbx-[a-z0-9]+(-[a-z0-9]+)*$/.test(id))
=> []

SOURCE_IDS.filter((id) => countInSource(id) !== 1).map((id) => id + ": " + countInSource(id))
=> []
```
