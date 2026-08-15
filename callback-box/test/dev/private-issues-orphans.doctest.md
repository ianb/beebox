# Private-issue orphan detection

The private-issues CLI uses the same configurable public worktree root as the
rest of the lifecycle tooling. A non-default root must not make a live private
worktree look orphaned.

```ts setup
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");
const privateIssues = join(repoRoot, "bin/private-issues");
const root = await mkdtemp(join(tmpdir(), "private-issues-orphans-doctest-"));
const mono = join(root, "callback-box");
const customWorktrees = join(root, "custom-worktrees");
const worktree = join(customWorktrees, "custom-root");

async function git(cwd: string, ...args: string[]) {
  return execFileAsync("git", args, { cwd });
}

await execFileAsync("mkdir", ["-p", join(mono, "callback-box"), customWorktrees]);
await git(mono, "init", "-b", "main");
await git(mono, "config", "user.email", "test@example.com");
await git(mono, "config", "user.name", "Private Issues Test");
await execFileAsync("bash", ["-c", 'printf content > "$1/file.txt"', "fixture", mono]);
await git(mono, "add", "file.txt");
await git(mono, "commit", "-m", "fixture");
await git(mono, "worktree", "add", "-b", "worktree-custom-root", worktree, "main");

const env = { ...process.env, CALLBACK_WORKTREE_ROOT: customWorktrees };
await execFileAsync(privateIssues, ["init", mono], { env });
await execFileAsync(privateIssues, ["mount", worktree], { env });
```

```ts
(await execFileAsync(privateIssues, ["report-orphans", mono], { env })).stdout.trim().length
=> 0
```

```ts cleanup
await rm(root, { recursive: true, force: true });
```
