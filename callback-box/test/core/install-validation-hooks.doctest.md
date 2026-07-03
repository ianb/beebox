# Install Validation Hooks

`installValidationHooks` writes two managed hooks into a box:

- `.claude/settings.json` — a `PostToolUse` entry that runs `cb validate --hook` after Edit/Write/MultiEdit on `.card` files (warns the agent, doesn't block)
- `.git/hooks/pre-commit` — runs `cb validate --staged` and blocks the commit if any staged card fails validation
- `.git/hooks/post-commit` — a marker-delimited managed block that fires `cb validate --urls --urls-since HEAD~1` in the background (non-blocking external-URL check)

Both writes are idempotent and merge-aware. The settings file preserves unrelated keys and unrelated `PostToolUse` entries. A foreign pre-commit hook (one we didn't write) is left alone with a warning. The post-commit block is spliced into whatever already exists there (e.g. a git-lfs hook), preserving it.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { installValidationHooks } from "../../src/core/install-validation-hooks.js";

async function makeBox() {
  const box = await fs.mkdtemp(path.join(os.tmpdir(), "cb-hooks-"));
  // Pretend it's a git repo so pre-commit can be written.
  await fs.mkdir(path.join(box, ".git/hooks"), { recursive: true });
  return box;
}
```

## Fresh install — writes both files

```ts
const box = await makeBox();
const changed = await installValidationHooks(box);
changed.sort()
=> [
  ".claude/rules/cb-validate-ignore.md",
  ".claude/settings.json",
  ".git/hooks/post-commit",
  ".git/hooks/pre-commit",
  "config/cb-validate.ignore"
]
```

The settings file has a single PostToolUse entry with the cb path embedded:

```ts continue
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

```ts continue
const hookPath = path.join(box, ".git/hooks/pre-commit");
const hookBody = await fs.readFile(hookPath, "utf-8");
hookBody.includes("# callback-box validation hook (managed)")
=> true

const stat = await fs.stat(hookPath);
(stat.mode & 0o111) !== 0
=> true
```

## Idempotent — second run changes nothing

```ts
const box = await makeBox();
await installValidationHooks(box);
const second = await installValidationHooks(box);
second
=> []
```

## Merge — preserves unrelated settings keys

Existing user settings under unrelated top-level keys are preserved verbatim:

```ts
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

```ts continue
settings.hooks.PostToolUse[0].matcher
=> Edit|Write|MultiEdit
```

## Merge — preserves unrelated PostToolUse entries

A user-installed PostToolUse hook for a different matcher (or different command) stays alongside ours:

```ts
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

```ts continue
const userEntry = settings.hooks.PostToolUse.find((e) => e.matcher === "Bash");
userEntry.hooks[0].command
=> /usr/bin/true
```

## Cb path drift — updates command when callback-box moves

If the existing settings file references a stale cb path (the old `validate "$f"` style), `installValidationHooks` rewrites the command in place rather than duplicating the entry:

```ts
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

```ts
const box = await fs.mkdtemp(path.join(os.tmpdir(), "cb-hooks-no-git-"));
const changed = await installValidationHooks(box);
changed.sort()
=> [
  ".claude/rules/cb-validate-ignore.md",
  ".claude/settings.json",
  "config/cb-validate.ignore"
]
```

No phantom `.git/` directory was created:

```ts continue
await fs.access(path.join(box, ".git")).then(() => true).catch(() => false)
=> false
```

## Foreign pre-commit hook — left alone

A pre-commit hook that doesn't carry our marker is the user's own and stays put:

```ts
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

```ts continue
await fs.readFile(hookPath, "utf-8")
=> #!/bin/sh
echo user hook
```

## Post-commit — managed block, fresh file

With no existing post-commit hook, one is created with our marker block and the
non-blocking `--urls-since HEAD~1` command, and it's executable:

```ts
const box = await makeBox();
await installValidationHooks(box);
const body = await fs.readFile(path.join(box, ".git/hooks/post-commit"), "utf-8");
[
  body.includes("# >>> callback-box url-check (managed) >>>"),
  body.includes("validate --urls --urls-since HEAD~1"),
  (await fs.stat(path.join(box, ".git/hooks/post-commit"))).mode & 0o111 ? true : false,
]
=> [
  true,
  true,
  true
]
```

## Post-commit — coexists with a foreign hook (git-lfs)

A pre-existing post-commit (e.g. git-lfs) is preserved verbatim; our block is
appended after it. A second install is idempotent — the foreign hook stays and
nothing changes:

```ts
const box = await makeBox();
const postPath = path.join(box, ".git/hooks/post-commit");
const lfs = "#!/bin/sh\ngit lfs post-commit \"$@\"\n";
await fs.writeFile(postPath, lfs);

await installValidationHooks(box);
const merged = await fs.readFile(postPath, "utf-8");
[merged.startsWith(lfs), merged.includes("callback-box url-check (managed)")]
=> [
  true,
  true
]
```

```ts continue
const again = await installValidationHooks(box);
[again.includes(".git/hooks/post-commit"), (await fs.readFile(postPath, "utf-8")) === merged]
=> [
  false,
  true
]
```

## Validation-ignore scaffold — seed file + operator guardrail rule

`installValidationHooks` also seeds the operator-owned `config/cb-validate.ignore`
(a commented template — no active entries, since the builtin skips already cover
cb's generated docs) and installs a path-conditional `.claude/rules/` rule that
fires only when an agent opens that file, warning it off. The seed is commented
out; the rule is scoped to the ignore file's path and is blunt about not
silencing errors:

```ts
const box = await makeBox();
await installValidationHooks(box);

const seed = await fs.readFile(path.join(box, "config/cb-validate.ignore"), "utf-8");
// Every non-blank line is a comment — nothing is actively ignored out of the box.
seed.split("\n").filter((l) => l.trim() !== "").every((l) => l.trimStart().startsWith("#"))
=> true
```

```ts continue
const rule = await fs.readFile(path.join(box, ".claude/rules/cb-validate-ignore.md"), "utf-8");
[
  rule.includes(`- "config/cb-validate.ignore"`),  // path-conditional scope
  rule.includes("operator-owned") || rule.includes("boxholder"),
  rule.includes("Never add an entry here to silence"),
]
=> [
  true,
  true,
  true
]
```

An operator's edits to the ignore file are never clobbered — the seed is written
only when the file is absent, so a second install (or a deploy-sync) leaves a
customized file untouched:

```ts continue
await fs.writeFile(path.join(box, "config/cb-validate.ignore"), "vendor/**\n");
const again = await installValidationHooks(box);
again.includes("config/cb-validate.ignore")
=> false
```

```ts continue
(await fs.readFile(path.join(box, "config/cb-validate.ignore"), "utf-8")).trim()
=> vendor/**
```

