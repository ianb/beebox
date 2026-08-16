# Retired Claude quota status line

The SDK collector replaces an older user-level status-line command. Cleanup is
deliberately narrow: it removes only that retired command and preserves every
other Claude setting.

```ts setup
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(process.cwd(), "..");
const workstreams = path.join(repoRoot, "bin/workstreams");
```

```ts
const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-quota-cleanup-"));
t.teardown(async () => await fs.rm(configDir, { recursive: true, force: true }));
const settings = path.join(configDir, "settings.json");
await fs.writeFile(settings, JSON.stringify({
  theme: "dark",
  statusLine: {
    type: "command",
    command: "/some/checkout/bin/claude-quota-statusline",
  },
}));
await execFileAsync(workstreams, ["unset-claude-quota"], {
  cwd: repoRoot,
  env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
});
const cleaned = JSON.parse(await fs.readFile(settings, "utf8"));
JSON.stringify({ cleaned, mode: ((await fs.stat(settings)).mode & 0o777).toString(8) })
=> {"cleaned":{"theme":"dark"},"mode":"600"}
```

An unrelated status line is user-owned configuration and is refused unchanged.

```ts
const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-quota-cleanup-"));
t.teardown(async () => await fs.rm(configDir, { recursive: true, force: true }));
const settings = path.join(configDir, "settings.json");
const original = JSON.stringify({
  statusLine: { type: "command", command: "/usr/local/bin/my-status" },
});
await fs.writeFile(settings, original);
await assert.rejects(
  execFileAsync(workstreams, ["unset-claude-quota"], {
    cwd: repoRoot,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
  }),
  /refusing to remove unrelated statusLine command/,
);
(await fs.readFile(settings, "utf8")) === original
=> true
```
