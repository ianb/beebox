# `bbx query <collection>` — the agent's read surface over a collection

CLI-tier doctests for `docs/plans/todo-collection.md` Track 4. `bbx query`
and the web list run the same query through the same runner, so what the
agent is told matches what the boxholder sees.

A terminal has no nesting to lean on, so the three things that make an
undated todo legible each get an explicit spelling: a card header names the
card, a `§` line names the section when it changes, indentation follows the
parent chain, and an annotation gets its own `—` line.
`runQueryForBox(boxRoot, { collection, options })` is exercised directly,
same approach as `test/cli/todos.doctest.md`.

```ts setup
import { runQueryForBox } from "../../src/cli/commands/query.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

process.env.BBX_TIME = "2026-07-28T12:00:00.000Z";

const box = await makeTmpBox();
await box.write("_config/box.json", JSON.stringify({ timezone: "America/Chicago" }));

async function run(options) {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => { logs.push(args.join(" ")); };
  try {
    await runQueryForBox(box.root, { collection: "todos", options: options ?? {} });
  } finally {
    console.log = origLog;
  }
  return logs.join("\n");
}

function doc(title, body) {
  return `---\ntitle: ${title}\n---\n${body}`;
}

const PORCH = "_content/projects/Porch";

await box.write(`${PORCH}/Plan.doc.card`, doc("Porch plan", [
  "Rough budget first.",
  "",
  "## Demolition",
  "",
  '- {% todo status="done" %}Pull the permit{% /todo %}',
  "  - {% todo %}File the copy{% /todo %} — Sofia has the scanner",
  "",
  "## Decking",
  "",
  '- {% todo due="2026-08-10" %}Order lumber{% /todo %}',
  "",
].join("\n")));

// Outside the Porch subtree, pointing into it.
await box.write("_content/Errands.doc.card", doc("Errands", [
  "- {% todo %}Hardware run{% /todo %} — for [the porch](/_content/projects/Porch)",
  "- {% todo %}Water the beans{% /todo %}",
  "",
].join("\n")));
```

## `--here` scopes to a place, and picks up what links into it

The card header is the card's own summary plus its path and what it amounts
to. A card that is in the list only because its todos point here says so.

```ts
await run({ here: PORCH })
=>
Errands  _content/Errands.doc.card (refers here)  — 1 open, 0 done
  _content/Errands.doc.card:4  Hardware run
      — for the porch
Porch plan  _content/projects/Porch/Plan.doc.card  — 2 open, 1 done, next 2026-08-10
 § Demolition
  _content/projects/Porch/Plan.doc.card:8  Pull the permit  (context)
    _content/projects/Porch/Plan.doc.card:9  File the copy
        — Sofia has the scanner
 § Decking
  _content/projects/Porch/Plan.doc.card:13  Order lumber  (due=2026-08-10)
```

"Pull the permit" is `done`, so the default filter does not match it — but its
open child does, and a child floating with no parent would lose the thing that
gives it meaning. It comes along marked `(context)`.

"Water the beans" points nowhere near the porch, so it stays out even though
its card is in the list.

`--no-referring` restores the subtree-only scan, which is what a large box
pays for when it does not want the box-wide read.

```ts continue
await run({ here: PORCH, referring: false })
=>
Porch plan  _content/projects/Porch/Plan.doc.card  — 2 open, 1 done, next 2026-08-10
 § Demolition
  _content/projects/Porch/Plan.doc.card:8  Pull the permit  (context)
    _content/projects/Porch/Plan.doc.card:9  File the copy
        — Sofia has the scanner
 § Decking
  _content/projects/Porch/Plan.doc.card:13  Order lumber  (due=2026-08-10)
```

## No `--here` is the whole box

```ts continue
await run({ glob: "_content/Errands.doc.card" })
=>
Errands  _content/Errands.doc.card  — 2 open, 0 done
  _content/Errands.doc.card:4  Hardware run
      — for the porch
  _content/Errands.doc.card:5  Water the beans
```

## `--group plate` labels the groups and counts them

Only `plate` gets group headings: `place` is a single group whose label would
just repeat the command.

```ts continue
await run({ here: PORCH, referring: false, group: "plate", status: ["open", "done"] })
=>
On the plate (2)
Porch plan  _content/projects/Porch/Plan.doc.card  — 2 open, 1 done, next 2026-08-10
 § Demolition
  _content/projects/Porch/Plan.doc.card:8  Pull the permit  (context)
    _content/projects/Porch/Plan.doc.card:9  File the copy
        — Sofia has the scanner
 § Decking
  _content/projects/Porch/Plan.doc.card:13  Order lumber  (due=2026-08-10)
Done (1)
Porch plan  _content/projects/Porch/Plan.doc.card  — 2 open, 1 done, next 2026-08-10
 § Demolition
  _content/projects/Porch/Plan.doc.card:8  Pull the permit
```

## Params

```ts continue
await run({ here: PORCH, referring: false, status: ["done"] })
=>
Porch plan  _content/projects/Porch/Plan.doc.card  — 2 open, 1 done, next 2026-08-10
 § Demolition
  _content/projects/Porch/Plan.doc.card:8  Pull the permit

await run({ here: PORCH, referring: false, assigned: "nobody" })
=> No todos match.
```

## `--json` is the whole `CollectionResult`

The structured form carries what the text form summarizes — including the
position and reference fields that make an undated todo legible.

```ts continue
const parsed = JSON.parse(await run({ here: PORCH, referring: false, json: true }));

JSON.stringify(parsed.query)
=> {"here":"_content/projects/Porch","glob":"_content/projects/Porch/**","includeReferring":false,"group":"place"}

JSON.stringify(parsed.reduction)
=> {"open":2,"done":1,"dropped":0,"parked":0,"onPlate":2,"escalated":0,"next":"2026-08-10"}

const child = parsed.groups[0].rows[0].items.find((i) => i.text === "File the copy");
JSON.stringify([child.sectionPath, child.parent, child.annotation, child.matching])
=> [["Demolition"],{"kind":"body","line":8},"Sofia has the scanner",true]
```

## An unknown collection names the ones that exist

```ts continue
const origError = console.error;
const origExit = process.exit;
const errors = [];
let exitCode = null;
console.error = (...args) => { errors.push(args.join(" ")); };
process.exit = (code) => { exitCode = code; throw new Error("exit"); };
try {
  await runQueryForBox(box.root, { collection: "questions", options: {} });
} catch (e) {
  // the fake process.exit
} finally {
  console.error = origError;
  process.exit = origExit;
}

`${errors.join("\n")} [exit ${exitCode}]`
=> Error: unknown collection "questions" — valid names: todos [exit 1]
```

## Issues print in a trailing block, exactly as `bbx todos` prints them

```ts continue
await box.write(`${PORCH}/Broken.doc.card`, "---\ntitle: 7\n---\n{% todo %}Lost{% /todo %}\n");

(await run({ here: PORCH, referring: false })).split("\n").slice(-3).join("\n")
=>
1 cards could not be read for todos:
  [load] _content/projects/Porch/Broken.doc.card: _content/projects/Porch/Broken.doc.card: invalid doc frontmatter:
  - title: expected string, got number
```

```ts cleanup
await box.cleanup();
```
