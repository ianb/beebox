# Commit blocklists in linked worktrees

A linked worktree tries its own gitignored blocklist first, then shares the
main checkout's machine-local list beside Git's common directory.

```ts setup
import path from "node:path";
import { blocklistCandidates } from "../../../bin/commit-blocklist-check.js";
```

```ts
JSON.stringify(blocklistCandidates({
  repoRoot: "/src/worktrees/topic",
  rel: ".commit-blocklist",
  commonDir: "/src/main/.git",
}))
=> ["/src/worktrees/topic/.commit-blocklist","/src/main/.commit-blocklist"]

JSON.stringify(blocklistCandidates({
  repoRoot: "/src/main",
  rel: ".commit-blocklist",
  commonDir: "/src/main/.git",
}))
=> ["/src/main/.commit-blocklist"]

JSON.stringify(blocklistCandidates({
  repoRoot: "/src/main",
  rel: path.resolve("/private/list"),
  commonDir: "/src/main/.git",
}))
=> ["/private/list"]
```
