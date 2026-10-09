# Migration plan: CLAUDE.md becomes AGENTS.md

`agents-md-2026-10` renames every box `CLAUDE.md` to `AGENTS.md` and moves its
template-ledger entry and parked update with it
(`docs/plans/box-agents-md.md`, Track B). `planAgentsMd` is the whole
decision, as a pure function of what the runner scanned. It fails closed on
any conflict, orders parents before descendants, and is computed from a fresh
scan, so a retry after an interruption plans only what is left.

```ts setup
import { planAgentsMd, rekeyLedger, describeStep, type DirectoryInput } from "../../../src/scripts/migrate/agents-md/plan.js";
import { MIGRATIONS } from "../../../src/core/migrations.js";
import { AGENTS_MD_MIGRATION } from "../../../src/core/agent-instruction-files.js";

const FILE = { kind: "file" } as const;
const ABSENT = { kind: "absent" } as const;
const LINK = { kind: "symlink" } as const;
const AUTHORED = { kind: "file", generated: false } as const;
const GENERATED = { kind: "file", generated: true } as const;
const entry = { sha256: "abc", "installed-at": "2026-09-01T00:00:00Z", stock: "# stock\n" };

/** Plan with defaults; show steps as their log lines. */
function plan(input: { directories?: DirectoryInput[]; localFiles?: string[]; ledger?: Record<string, typeof entry>; parks?: Record<string, string> }) {
  const result = planAgentsMd({ directories: input.directories ?? [], localFiles: input.localFiles ?? [], ledger: input.ledger ?? {}, parks: input.parks ?? {} });
  return { steps: result.steps.map(describeStep), conflicts: result.conflicts.map((c) => `${c.kind}: ${c.path}`) };
}
const dir = (d: string, claude: DirectoryInput["claude"], agents: DirectoryInput["agents"]): DirectoryInput => ({ dir: d, claude, agents });
```

The registry entry uses the name the resolver checks:

```ts
MIGRATIONS.at(-1)?.name === AGENTS_MD_MIGRATION
=> true
```

## Every directory state

A real `CLAUDE.md` is renamed onto `AGENTS.md`, replacing nothing, the old
symlink mirror, or a legacy generated mirror (the marker file).

```ts
[ABSENT, LINK, GENERATED].map((agents) => plan({ directories: [dir("src/schemas", FILE, agents)] }).steps)
=> [
  ["rename src/schemas/CLAUDE.md -> src/schemas/AGENTS.md"],
  ["rename src/schemas/CLAUDE.md -> src/schemas/AGENTS.md (replaces symlink)"],
  ["rename src/schemas/CLAUDE.md -> src/schemas/AGENTS.md (replaces generated mirror)"],
]
```

A `CLAUDE.md` that is a symlink to the sibling real `AGENTS.md` (the reverse
mirror some people make by hand) is removed. A symlink elsewhere is renamed like
a file; the link keeps its target.

```ts
({
  reverse: plan({ directories: [dir("", { kind: "symlink", target: "./AGENTS.md" }, AUTHORED)] }).steps,
  elsewhere: plan({ directories: [dir("", { kind: "symlink", target: "docs/notes.md" }, LINK)] }).steps,
})
=> {
  reverse: ["remove CLAUDE.md (symlink to the sibling AGENTS.md)"],
  elsewhere: ["rename CLAUDE.md -> AGENTS.md (replaces symlink)"],
}
```

Already converted: a real `AGENTS.md` alone, or a leftover symlink alone, needs
nothing. A second run plans nothing.

```ts
plan({ directories: [dir("", ABSENT, AUTHORED), dir("_content/x", ABSENT, LINK)], ledger: { "src/schemas/AGENTS.md": entry }, parks: { "src/schemas/AGENTS.md": "# new\n" } })
=> { steps: [], conflicts: [] }
```

## Conflicts stop the run before any write

Each kind names its path. When any conflict exists, no steps are returned,
even for unrelated directories.

```ts
plan({
  directories: [
    dir("", FILE, ABSENT),
    dir("_content/people", FILE, AUTHORED),
    dir(".claude", FILE, ABSENT),
    dir("_content/loop", { kind: "symlink", target: "AGENTS.md" }, ABSENT),
  ],
  localFiles: ["_content/CLAUDE.local.md"],
  ledger: { "src/views/CLAUDE.md": entry, "src/views/AGENTS.md": { ...entry, sha256: "def" } },
  parks: { "src/schemas/CLAUDE.md": "# one\n", "src/schemas/AGENTS.md": "# two\n" },
})
=> {
  steps: [],
  conflicts: [
    "local-file: _content/CLAUDE.local.md",
    "local-file: .claude/CLAUDE.md",
    "dangling-link: _content/loop/CLAUDE.md",
    "both-files: _content/people/CLAUDE.md",
    "park: src/schemas/CLAUDE.md",
    "ledger: src/views/CLAUDE.md",
  ],
}
```

Each message carries the fix:

```ts
planAgentsMd({ directories: [dir("_content/people", FILE, AUTHORED)], localFiles: [], ledger: {}, parks: {} }).conflicts[0]?.message
=> _content/people/CLAUDE.md and _content/people/AGENTS.md are both instruction files. Merge them into _content/people/AGENTS.md by hand and delete _content/people/CLAUDE.md.
```

## Identical duplicates drop the legacy copy

A ledger entry or park under both sibling keys with equal contents is not a
conflict.

```ts
plan({ ledger: { "src/views/CLAUDE.md": entry, "src/views/AGENTS.md": { ...entry } }, parks: { "src/views/CLAUDE.md": "# same\n", "src/views/AGENTS.md": "# same\n" } }).steps
=> [
  "ledger src/views/CLAUDE.md -> src/views/AGENTS.md (equal entry already there; drop legacy)",
  "park src/views/CLAUDE.md -> src/views/AGENTS.md (equal park already there; drop legacy)",
]
```

## Parents before descendants; file, then ledger, then park

The walk lists children before their parent; the plan sorts by depth, root
first. A directory known only from the ledger or a park still gets its steps.

```ts
plan({
  directories: [dir("src/schemas", FILE, LINK), dir("_content/a/b", FILE, ABSENT), dir("", FILE, LINK)],
  ledger: { "src/schemas/CLAUDE.md": entry, "_config/feedback/CLAUDE.md": entry },
  parks: { "src/schemas/CLAUDE.md": "# parked\n" },
}).steps
=> [
  "rename CLAUDE.md -> AGENTS.md (replaces symlink)",
  "ledger _config/feedback/CLAUDE.md -> _config/feedback/AGENTS.md",
  "rename src/schemas/CLAUDE.md -> src/schemas/AGENTS.md (replaces symlink)",
  "ledger src/schemas/CLAUDE.md -> src/schemas/AGENTS.md",
  "park src/schemas/CLAUDE.md -> src/schemas/AGENTS.md",
  "rename _content/a/b/CLAUDE.md -> _content/a/b/AGENTS.md",
]
```

## The ledger entry moves whole

`stock` and `pending` move with the hash, so a later template update still
merges against the recorded stock instead of parking.

```ts
rekeyLedger({ "src/schemas/CLAUDE.md": { ...entry, pending: "p1" }, "src/views/CLAUDE.md": entry }, { from: "src/schemas/CLAUDE.md", to: "src/schemas/AGENTS.md", drop: false })
=> {
  "src/views/CLAUDE.md": { sha256: "abc", "installed-at": "2026-09-01T00:00:00Z", stock: "# stock\n" },
  "src/schemas/AGENTS.md": { sha256: "abc", "installed-at": "2026-09-01T00:00:00Z", stock: "# stock\n", pending: "p1" },
}
```

## Each interruption point plans the rest

File renamed, ledger and park not moved:

```ts
plan({ directories: [dir("src/schemas", ABSENT, AUTHORED)], ledger: { "src/schemas/CLAUDE.md": entry }, parks: { "src/schemas/CLAUDE.md": "# parked\n" } }).steps
=> [
  "ledger src/schemas/CLAUDE.md -> src/schemas/AGENTS.md",
  "park src/schemas/CLAUDE.md -> src/schemas/AGENTS.md",
]
```

Ledger moved, park not:

```ts
plan({ directories: [dir("src/schemas", ABSENT, AUTHORED)], ledger: { "src/schemas/AGENTS.md": entry }, parks: { "src/schemas/CLAUDE.md": "# parked\n" } }).steps
=> ["park src/schemas/CLAUDE.md -> src/schemas/AGENTS.md"]
```

Root renamed, a subdirectory not:

```ts
plan({ directories: [dir("", ABSENT, AUTHORED), dir("_content/people", FILE, LINK)] }).steps
=> ["rename _content/people/CLAUDE.md -> _content/people/AGENTS.md (replaces symlink)"]
```
