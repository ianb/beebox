# CLI admission exemptions

Box admission runs in a Commander `preAction` hook, so it decides before a
command's own handler ever runs. A command left out of the exemption sets can
therefore never handle "no box here" for itself, however carefully it tries.

That is not hypothetical: `agent-context --hook` resolves a *nullable* box root
and exits quietly precisely because a harness hook fires in every session,
including dev worktrees with no box. Admission threw first, and every Codex
worktree session reported `hook exited with code 1` with its Bee Box context
never loaded.

```ts setup
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../../src/cli/lib/box-admission.ts", import.meta.url), "utf8");
function setEntries(name) {
  const match = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(source);
  return match === null ? [] : [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}
```

## `agent-context` is exempt

It reads a box and writes to stdout; there is nothing to admit, and it must
survive running where no box exists.

```ts
setEntries("inspection").includes("agent-context")
=> true
```

## The two sets stay disjoint

A command in both would be ambiguous about which rule applied.

```ts
const owned = new Set(setEntries("independentlyOwned"));
setEntries("inspection").filter((name) => owned.has(name))
=> []
```

## Both sets are non-empty

A regex that stopped matching would silently exempt nothing and make every
command require a box — the failure this file exists to catch.

```ts
setEntries("independentlyOwned").length > 0 && setEntries("inspection").length > 0
=> true
```
