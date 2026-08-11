# Workstream resume state

Resume has one state boundary before any filesystem creation or Terminal action.
Unknown liveness never opens a duplicate, and forced removals require an explicit
choice before recreation.

```ts setup
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const resumeLib = resolve(process.cwd(), "../bin/lib/workstream-resume.sh");

async function decide(exists: boolean, agentState: string, record: object | undefined) {
  const result = await execFileAsync("bash", ["-c", '. "$1"; workstream_resume_state "$2" "$3" "$4"', "resume-test", resumeLib, String(exists), agentState, record ? JSON.stringify(record) : ""]);
  return result.stdout.trim();
}
```

## Four-state dispatch is explicit

```ts
JSON.stringify([
  await decide(true, "live", { agent: "claude" }),
  await decide(true, "none", { agent: "codex" }),
  await decide(true, "unknown", { agent: "claude" }),
  await decide(false, "none", { removed: { merged: true } }),
  await decide(false, "none", { removed: { merged: false } }),
  await decide(false, "none", undefined),
])
=> ["focus","existing","liveness-unknown","culled","removed-unmerged","unknown"]
```
