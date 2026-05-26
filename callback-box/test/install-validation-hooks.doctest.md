# Install Validation Hooks

`installValidationHooks` writes two managed hooks into a box:

- `.claude/settings.json` — a `PostToolUse` entry that runs `cb validate --hook` after Edit/Write/MultiEdit on `.card` files (warns the agent, doesn't block)
- `.git/hooks/pre-commit` — runs `cb validate --staged` and blocks the commit if any staged card fails validation

Both writes are idempotent and merge-aware. The settings file preserves unrelated keys and unrelated `PostToolUse` entries. A foreign pre-commit hook (one we didn't write) is left alone with a warning.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { installValidationHooks } from "../src/core/install-validation-hooks.js";

async function makeBox() {
  const box = await fs.mkdtemp(path.join(os.tmpdir(), "cb-hooks-"));
  // Pretend it's a git repo so pre-commit can be written.
  await fs.mkdir(path.join(box, ".git/hooks"), { recursive: true });
  return box;
}
```

## Fresh install — writes both files

```
const box = await makeBox();
const changed = await installValidationHooks(box);
changed.sort()
=> [
  ".claude/settings.json",
  ".git/hooks/pre-commit"
]
```

The settings file has a single PostToolUse entry with the cb path embedded:

``` continue
const settings = JSON.parse(
  await fs.readFile(path.join(box, ".claude/settings.json"), "utf-8")
);
settings.hooks.PostToolUse.length
=> 1

settings.hooks.PostToolUse[0].matcher
=> Edit|Write|MultiEdit

settings.hooks.PostToolUse[0].hooks[0].command.endsWith(" validate --hook")
=> true
```

The pre-commit hook is executable and includes the manager marker:

``` continue
const hookPath = path.join(box, ".git/hooks/pre-commit");
const hookBody = await fs.readFile(hookPath, "utf-8");
hookBody.includes("# callback-box validation hook (managed)")
=> true

const stat = await fs.stat(hookPath);
(stat.mode & 0o111) !== 0
=> true
```

## Idempotent — second run changes nothing

```
const box = await makeBox();
await installValidationHooks(box);
const second = await installValidationHooks(box);
second
=> []
```

## Merge — preserves unrelated settings keys

Existing user settings under unrelated top-level keys are preserved verbatim:

```
const box = await makeBox();
await fs.mkdir(path.join(box, ".claude"), { recursive: true });
await fs.writeFile(
  path.join(box, ".claude/settings.json"),
  JSON.stringify({
    permissions: { allow: ["Bash(npm test)"] },
    model: "claude-sonnet-4-6",
  }, null, 2)
);

await installValidationHooks(box);

const settings = JSON.parse(
  await fs.readFile(path.join(box, ".claude/settings.json"), "utf-8")
);
JSON.stringify(settings.permissions)
=> {"allow":["Bash(npm test)"]}

settings.model
=> claude-sonnet-4-6
```

The validation hook was added alongside:

``` continue
settings.hooks.PostToolUse[0].matcher
=> Edit|Write|MultiEdit
```

## Merge — preserves unrelated PostToolUse entries

A user-installed PostToolUse hook for a different matcher (or different command) stays alongside ours:

```
const box = await makeBox();
await fs.mkdir(path.join(box, ".claude"), { recursive: true });
await fs.writeFile(
  path.join(box, ".claude/settings.json"),
  JSON.stringify({
    hooks: {
      PostToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "/usr/bin/true" }] },
      ],
    },
  }, null, 2)
);

await installValidationHooks(box);

const settings = JSON.parse(
  await fs.readFile(path.join(box, ".claude/settings.json"), "utf-8")
);
settings.hooks.PostToolUse.length
=> 2
```

User's entry is still there, untouched:

``` continue
const userEntry = settings.hooks.PostToolUse.find((e) => e.matcher === "Bash");
userEntry.hooks[0].command
=> /usr/bin/true
```

## Cb path drift — updates command when callback-box moves

If the existing settings file references a stale cb path (the old `validate "$f"` style), `installValidationHooks` rewrites the command in place rather than duplicating the entry:

```
const box = await makeBox();
await fs.mkdir(path.join(box, ".claude"), { recursive: true });
await fs.writeFile(
  path.join(box, ".claude/settings.json"),
  JSON.stringify({
    hooks: {
      PostToolUse: [
        {
          matcher: "Edit|Write|MultiEdit",
          hooks: [{ type: "command", command: "/old/path/cb validate \"$f\"" }],
        },
      ],
    },
  }, null, 2)
);

await installValidationHooks(box);

const settings = JSON.parse(
  await fs.readFile(path.join(box, ".claude/settings.json"), "utf-8")
);
settings.hooks.PostToolUse.length
=> 1

settings.hooks.PostToolUse[0].hooks[0].command.endsWith(" validate --hook")
=> true
```

## Not a git repo — skips pre-commit install silently

If `.git/` doesn't exist (e.g. a `--skip-git` box, or a non-box directory), only the settings file gets written; the pre-commit step is skipped instead of bootstrapping a stray `.git/hooks/` directory:

```
const box = await fs.mkdtemp(path.join(os.tmpdir(), "cb-hooks-no-git-"));
const changed = await installValidationHooks(box);
changed
=> [
  ".claude/settings.json"
]
```

No phantom `.git/` directory was created:

``` continue
await fs.access(path.join(box, ".git")).then(() => true).catch(() => false)
=> false
```

## Foreign pre-commit hook — left alone

A pre-commit hook that doesn't carry our marker is the user's own and stays put:

```
const box = await makeBox();
const hookPath = path.join(box, ".git/hooks/pre-commit");
await fs.writeFile(hookPath, "#!/bin/sh\necho user hook\n");
await fs.chmod(hookPath, 0o755);

const origConsoleWarn = console.warn;
console.warn = () => {};
const changed = await installValidationHooks(box);
console.warn = origConsoleWarn;

changed.includes(".git/hooks/pre-commit")
=> false
```

The user's hook is unchanged:

``` continue
await fs.readFile(hookPath, "utf-8")
=> #!/bin/sh
echo user hook
```

