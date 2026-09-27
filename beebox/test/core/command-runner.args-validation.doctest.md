# commands: the parseCommandArgs boundary rejects wrong-typed args loudly

Every command validates its untyped `args` bag through `parseCommandArgs`
(`command-runner.ts`) — the dispatch boundary. A wrong-typed field is a
`CommandArgsError`, surfaced by `runCommand` as a clean `{ success: false }`
result naming the field — never silently dropped, never a stack trace.
Presence checks stay with the command (friendlier error text), so a missing
field gets the command's own message, not a schema failure.

```ts setup
import { runCommand, createCollectorContext, getCommand, listCommands } from "../../src/core/command-runner.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

## A lookup loads every command with no other import

`getCommand`/`listCommands` read `commands.ts`'s registry directly, and
`command-runner.ts` imports that registry at its own load — so importing a
lookup above (with no side-effect `import "../../src/core/commands.js"`
alongside it) is sufficient to have every command registered:

```ts
getCommand("search")?.name
=> search

listCommands().length > 15
=> true
```

## Wrong-typed fields fail loudly, naming the field

```ts
const box = await makeTmpBox();
const badLimit = await runCommand({
  name: "search",
  args: { query: "dentist", limit: "5" },
  ctx: createCollectorContext(box.root),
});
badLimit.success
=> false

badLimit.error
=> invalid command arguments: limit: Invalid input: expected number, received string

const badPaths = await runCommand({
  name: "ls",
  args: { paths: "_content/inbox" },
  ctx: createCollectorContext(box.root),
});
badPaths.error
=> invalid command arguments: paths: Invalid input: expected array, received string
```

## Enum fields enumerate their valid values in the error

```ts continue
const badMode = await runCommand({
  name: "search",
  args: { query: "dentist", mode: "fuzzy" },
  ctx: createCollectorContext(box.root),
});
badMode.success
=> false

badMode.error
=> invalid command arguments: mode: Invalid option: expected one of "text"|"hybrid"
```

## Presence checks keep the command's own friendlier error

```ts continue
const noQuery = await runCommand({
  name: "search",
  args: {},
  ctx: createCollectorContext(box.root),
});
noQuery.error
=> a search query is required — e.g. bbx search "dentist appointment"
```

```ts cleanup
await box.cleanup();
```
