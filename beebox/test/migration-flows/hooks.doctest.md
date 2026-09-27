# `hooks-2026-09`: reinstall the managed git hooks

Boxes that predate the rename kept git hooks that look for the former CLI at
a checkout that no longer exists. The migration runs the same installer
`bbx init` runs. See `scripts/migrate/box-hooks.ts`.

```ts setup
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

function runMigration(box, apply) {
  const args = ["--import", "tsx", "scripts/migrate/box-hooks.ts", box.root];
  if (apply) args.push("--apply");
  return execFileSync(process.execPath, args, { cwd: process.cwd(), stdio: "pipe" }).toString().trim();
}
```

## A managed hook pointing at a stale CLI path is replaced; a second run changes nothing

```ts
const box = await makeTmpBox({ git: true });
const hookPath = join(box.root, ".git", "hooks", "pre-commit");
await box.write(".git/hooks/pre-commit", "#!/usr/bin/env bash\n# beebox validation hook (managed)\nexec /nowhere/former-checkout/bin/former-cli validate\n");
const first = runMigration(box, true);
const hook = await readFile(hookPath, "utf8");
const second = runMigration(box, true);
JSON.stringify({
  firstReinstalled: first.startsWith("[box-hooks] reinstalled:"),
  mentionsFormerCli: hook.includes("/nowhere/former-checkout/"),
  managedNow: hook.includes("(managed)"),
  second,
})
=> {"firstReinstalled":true,"mentionsFormerCli":false,"managedNow":true,"second":"[box-hooks] hooks already current; nothing to do."}
```

```ts cleanup
await box.cleanup();
```
