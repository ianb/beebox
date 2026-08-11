# Terminal tab safety adapter

Registry tty values are untrusted hints. The adapter validates their shape and
requires a live Claude or Codex process on that tty before focus or close may
target it.

```ts setup
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const terminalLib = resolve(process.cwd(), "../bin/lib/terminal-tabs.sh");

async function terminalCheck(body: string) {
  return execFileAsync("bash", ["-c", `. "$1"; ${body}`, "terminal-test", terminalLib]);
}
```

## Invalid and dead ttys never count as live agents

```ts
const invalid = await terminalCheck('terminal_agent_on_tty "not-a-tty"; printf "%s" "$?"');
invalid.stdout
=> 1

const dead = await terminalCheck('terminal_agent_on_tty "/dev/ttys999"; printf "%s" "$?"');
dead.stdout
=> 1
```
