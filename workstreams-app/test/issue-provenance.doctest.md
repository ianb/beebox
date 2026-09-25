# Provenance is shown as where, not who

`discovered-in:` records where an issue was noticed and what was happening; the
browser used to show `discovered-by:` instead, so every agent-filed issue read
`discovered:agent` and the informative half of the provenance — 139 values at the
time — appeared nowhere at all.

`issueProvenance` splits a value into the place (short enough for a pill) and the
context clause (a sentence, for the detail pane).

```ts setup
import { issueProvenance } from "../src/shared/issue-provenance.js";
```

The documented form names a worktree. It is displayed bare, because `foo` is what
the router prefix, the `workstream:` field and `bin/workstreams` all call it —
a pill spelling it `worktree-foo` would be the only place that differs.

```ts
JSON.stringify(issueProvenance("worktree-pub-setup-wrangler — Codex cross-review surfaced these as pre-existing"))
=> {"source":"pub-setup-wrangler","context":"Codex cross-review surfaced these as pre-existing"}
```

The most common value in practice is `main session`, because anything filed from
the primary session has no worktree to name. It is a source like any other — the
split is on the dash, not on a prefix.

```ts
JSON.stringify(issueProvenance("main session — \"It would be jarring to go into another person's conversation\""))
=> {"source":"main session","context":"\"It would be jarring to go into another person's conversation\""}
```

A value that names only a place carries no context, and the detail line then has
nothing to add:

```ts
JSON.stringify(issueProvenance("knip-sweep schedule, run 20260908-191814"))
=> {"source":"knip-sweep schedule, run 20260908-191814","context":null}
```

Absent, empty, and the one value in the queue wrapped in a stray quote:

```ts
JSON.stringify([
  issueProvenance(undefined),
  issueProvenance("   "),
  issueProvenance("\"worktree-beads-vs-issues — comparing Beads' claim protocol"),
])
=> [null,null,{"source":"beads-vs-issues","context":"comparing Beads' claim protocol"}]
```

A hand-typed double hyphen splits too, and a context holding its own dash keeps it:

```ts
JSON.stringify([
  issueProvenance("worktree-foo -- typed by hand"),
  issueProvenance("main session — the fix — and its follow-up"),
])
=> [{"source":"foo","context":"typed by hand"},{"source":"main session","context":"the fix — and its follow-up"}]
```
