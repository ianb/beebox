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
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { installBoxAdmission } from "../../../src/cli/lib/box-admission.js";

/**
 * Run `bbx <name>` through the real admission hook from a directory with no
 * box, with a stub action standing in for the command. Reports whether the
 * action ran or admission threw.
 */
async function runWhereNoBoxExists(name: string): Promise<string> {
  const cwd = process.cwd();
  const empty = await realpath(await mkdtemp(join(tmpdir(), "bbx-no-box-")));
  const saved = { url: process.env.BBX_SERVER_URL, name: process.env.BBX_BOX_NAME };
  delete process.env.BBX_SERVER_URL;
  delete process.env.BBX_BOX_NAME;
  process.chdir(empty);
  try {
    const program = new Command().exitOverride();
    let ran = false;
    installBoxAdmission(program);
    program.command(name).action(() => { ran = true; });
    try {
      await program.parseAsync(["node", "bbx", name]);
    } catch (error) {
      return error instanceof Error ? error.name : "unknown error";
    }
    return ran ? "ran" : "did not run";
  } finally {
    process.chdir(cwd);
    if (saved.url !== undefined) process.env.BBX_SERVER_URL = saved.url;
    if (saved.name !== undefined) process.env.BBX_BOX_NAME = saved.name;
  }
}
```

## `agent-context` is exempt

It reads a box and writes to stdout; there is nothing to admit, and it must
survive running where no box exists. Admission lets its action run:

```ts
await runWhereNoBoxExists("agent-context")
=> ran
```

## Other exempt commands reach their own handler

One more read-only command and one lifecycle owner, each from the two exemption
sets, also run without a box:

```ts
[await runWhereNoBoxExists("status"), await runWhereNoBoxExists("auth")]
=> ["ran", "ran"]
```

## Ordinary box work still requires a box

A command in neither set is refused before its action runs. This keeps the
exemptions from silently covering everything:

```ts
await runWhereNoBoxExists("card")
=> CliBoxRequiredError
```
