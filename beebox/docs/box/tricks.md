---
read-when: Writing, changing, or debugging a trick (a box-local script run with `bbx trick`), or deciding whether an operation should become one.
---

# Tricks

A trick is a TypeScript script the box owns, run with `bbx trick <name>`. It
packages an operation the box repeats: a fetch, an export, a conversion, a
search-and-summarize. Tricks live under `src/tricks/scripts/<name>/index.ts`
and run as child processes of the engine with their own npm dependencies.

Every trick is a directory with an `index.ts`. A `.ts` file placed directly in
`scripts/` is not a trick and does not list. The box's
`src/tricks/scripts/AGENTS.md` shows the directory layout and holds this box's
own conventions for tricks.

## Script interface

A trick is a standalone program. The engine provides context through the
environment and the argument list:

- `BBX_BOX_ROOT`: absolute path to the box root.
- `BBX_TRICK_NAME`: the trick's name, for usage and help output.
- Declared secrets, under the environment name each declaration chooses.
- `process.argv.slice(2)`: the arguments after the trick name.

```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const description = "Short description shown in bbx trick list";

const boxRoot = process.env.BBX_BOX_ROOT!;
const trickName = process.env.BBX_TRICK_NAME!;
const args = process.argv.slice(2);

const inboxDir = path.join(boxRoot, "_content/inbox");
console.log("Done!");
```

`bbx trick` reads the `export const description` line without executing the
file, so keep it a plain string literal.

Use `node:fs/promises` and `node:path` for files. For card operations, run
`bbx` commands through `child_process`; a trick does not import engine
internals. The subprocess cwd is `src/tricks/`, so package resolution and
relative imports of `lib/` work without configuration. There is no build step.

## Running

- `bbx trick`: list every trick with its description.
- `bbx trick <name>`: run one.
- `bbx trick <name> arg1 arg2`: pass arguments.
- `bbx trick <name> --no-commit`: run one and leave its changes uncommitted.
- `bbx trick --check-secrets`: validate every trick's secret declarations
  without running anything.

## How the engine runs a trick

Facts a trick author needs and cannot see from inside the script:

- **The trick is a child process.** `bbx trick` spawns Node running the `tsx`
  CLI on `index.ts`, and the `tsx` CLI starts the trick in its own Node
  process. The trick's direct parent process is that `tsx` wrapper, not the
  `bbx` process. A trick that checks its parent's liveness, or asks "am I
  being run by bbx", has to look at the grandparent.
- **The engine commits after the trick exits, and only on exit code 0.**
  Before it starts the trick, the engine records every dirty path in the box
  and a hash of its content. Once the child closes with status 0, it records
  them again and commits only the paths the trick changed: paths that were
  clean before the run, and already-dirty paths whose content the trick
  changed. The commit has the trailer `Run-By: trick/<name>`. An edit that
  was uncommitted before the run and that the trick did not touch stays
  uncommitted. If the trick changes an already-dirty file, the commit holds
  the whole file, including the earlier edit. Output that git ignores is
  never committed. A non-zero exit, or a trick that fails to start, leaves
  the tree as the trick left it. The trick's own `finally` blocks and exit
  handlers all run before that commit, so a trick cannot observe or guard
  the engine's commit from inside its own process.
- **`bbx trick <name> --no-commit` skips the engine's commit.** Use it to test
  a trick and look at its output before it becomes history. `bbx` reads the
  flag wherever it appears, so the trick does not receive it.
- **Concurrent runs are not isolated from each other.** The engine sees file
  changes, not which process made them. A file that another trick or a chat
  session writes while this trick runs is committed under this trick's
  trailer. A trick that writes files and can run concurrently should commit
  its own paths before exiting.

## Secrets

If the trick needs a credential, declare it in a `secrets.json` beside
`index.ts`:

```json
[{"name":"openai-images","reason":"image-generation","env":"OPENAI_API_KEY"}]
```

The boxholder supplies and grants the secret; you never see the value in the
tree. `bbx trick <name>` resolves each declaration at launch and injects the
value only into that trick process under the declared environment name. Every
resolve is logged with the reason. A refusal or unreachable server is reported
without the value; relay the message rather than trying a raw `curl` (which
prints the credential into the transcript). Never write a resolved value to a
file, an argument, or a log. How secrets are
granted and why they never live in the box is in the agent guide's "API keys &
secrets" section.

## Dependencies and shared code

Install packages into the tricks directory, where every trick can import
them:

```bash
cd src/tricks && pnpm add <package>
```

Put reusable helpers in `src/tricks/lib/` and import them by relative path:

```typescript
import { helper } from "../../lib/helper.js";
```

## Keeping a trick small

A trick does one task. When a trick grows a second job, split it. When an
operation is one-off, run it by hand instead.
