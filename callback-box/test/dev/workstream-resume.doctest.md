# Workstream resume state

Resume has one state boundary before any filesystem creation or Terminal action.
Unknown liveness never opens a duplicate, and forced removals require an explicit
choice before recreation.

```ts setup
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const resumeLib = resolve(process.cwd(), "../bin/lib/workstream-resume.sh");
const routingLib = resolve(process.cwd(), "../bin/lib/workstream-routing.sh");
const briefingLib = resolve(process.cwd(), "../bin/lib/workstream-briefing.sh");
const workstreams = resolve(process.cwd(), "../bin/workstreams");

async function decide(exists: boolean, agentState: string, record: object | undefined) {
  const result = await execFileAsync("bash", ["-c", '. "$1"; workstream_resume_state "$2" "$3" "$4"', "resume-test", resumeLib, String(exists), agentState, record ? JSON.stringify(record) : ""]);
  return result.stdout.trim();
}
```

## Four-state dispatch is explicit

```ts
JSON.stringify([
  await decide(true, "live", { agent: "claude" }),
  await decide(true, "launching", { agent: "claude" }),
  await decide(true, "none", { agent: "codex" }),
  await decide(true, "unknown", { agent: "claude" }),
  await decide(false, "none", { removed: { merged: true } }),
  await decide(false, "none", { removed: { merged: false } }),
  await decide(false, "launching", { launch: { token: "active" } }),
  await decide(false, "launch-failed", { agent: "claude", launch: { token: "failed" } }),
  await decide(false, "unknown", { launch: { token: "broken" } }),
  await decide(false, "none", undefined),
])
=> ["focus","launch-in-progress","existing","liveness-unknown","culled","removed-unmerged","launch-in-progress","launch-retry","liveness-unknown","unknown"]
```

## Routing state and action stay separate

```ts
async function route(exists: boolean, agent: string, record: object, tip = "", dir = "") {
  const result = await execFileAsync("bash", ["-c", '. "$1"; workstream_routing_json "$2" "$3" "$4" "$5" "$6" 1770000000', "routing-test", routingLib, String(exists), agent, JSON.stringify(record), tip, dir]);
  return JSON.parse(result.stdout);
}
const recent = 1769900000;
const old = 1768000000;
JSON.stringify([
  await route(true, "live", { launchedAt: "2025-01-01T00:00:00Z" }, String(old)),
  await route(true, "launching", { launch: { token: "a", startedAt: "2026-02-02T02:20:00Z" } }, String(old)),
  await route(true, "none", { launch: { token: "a", startedAt: "2026-01-01T00:00:00Z" } }, String(recent)),
  await route(true, "none", {}, String(recent)),
  await route(true, "none", {}, String(old)),
  await route(false, "none", { removed: { at: "2025-01-01T00:00:00Z" } }),
  await route(true, "unknown", {}, String(recent)),
  await route(true, "live", { archived: { at: "2026-01-01T00:00:00Z" } }, String(recent)),
].map(({ state, action }) => [state, action]))
=> [["live","manual-forward"],["launching","wait-for-launch"],["uncertain","investigate"],["dormant","resume-with-briefing"],["stale","new-stream-preferred"],["removed","resume-with-briefing"],["uncertain","investigate"],["uncertain","investigate"]]
```

Directory mtime is a fallback only when registry and commit activity are absent.

```ts continue
const oldTipRecentDir = await route(true, "none", {}, String(old), String(recent));
const noTipRecentDir = await route(true, "none", {}, "", String(recent));
JSON.stringify([oldTipRecentDir.state, noTipRecentDir.state])
=> ["stale","dormant"]
```

## Continuing a conversation is decided before the tab opens

A worktree can be culled and recreated at the same path, and Claude Code keys
transcripts by path — so the conversation is still there. `resume` continues it
when the recorded id has a transcript, and starts fresh, saying which reason,
when it does not. It never picks the newest transcript in the directory: a
workstream that was already resumed fresh once has two, and the newest is not
the one that did the work.

```ts
async function mode(agent: string, fresh: boolean, record: object, projects: string) {
  const result = await execFileAsync("bash", ["-c", '. "$1"; workstream_resume_session_mode "$2" "$3" "$4" "$5"', "mode-test", resumeLib, agent, String(fresh), JSON.stringify(record), projects]);
  return result.stdout.trim();
}
const projectsRoot = await mkdtemp(`${tmpdir()}/workstream-resume-projects-`);
const kept = "40009a22-c9b5-49f8-b166-f16937403e8d";
const pruned = "db662a8d-58b6-4a89-b281-9567aa9c73bf";
await mkdir(`${projectsRoot}/-Users-someone-src-worktrees-chat-scroll`, { recursive: true });
await writeFile(`${projectsRoot}/-Users-someone-src-worktrees-chat-scroll/${kept}.jsonl`, "{}\n");
JSON.stringify([
  await mode("claude", false, { sessionId: kept }, projectsRoot),
  await mode("claude", true, { sessionId: kept }, projectsRoot),
  await mode("claude", false, { sessionId: pruned }, projectsRoot),
  await mode("claude", false, {}, projectsRoot),
  await mode("codex", false, { sessionId: kept }, projectsRoot),
  await mode("claude", false, { sessionId: "../../etc/passwd" }, projectsRoot),
])
=> ["continue 40009a22-c9b5-49f8-b166-f16937403e8d","fresh forced","fresh transcript-missing","fresh no-recorded-session","fresh agent-not-claude","fresh transcript-missing"]
```

A transcript is found by id across every project directory, not by the one
encoding the current worktree path, so a session started elsewhere still
resolves.

```ts continue
const found = await execFileAsync("bash", ["-c", '. "$1"; workstream_claude_transcript "$2" "$3"', "transcript-test", resumeLib, kept, projectsRoot]);
found.stdout.trim().endsWith(`chat-scroll/${kept}.jsonl`)
=> true
```

The two first messages differ in what they assume the reader remembers. A fresh
session is told to go read the tree; a continued one already knows why it is
there and needs only what changed while it was gone.

```ts continue
const record = { removed: { finalSha: "abc1234", merged: true } };
async function prompt(fn: string) {
  const result = await execFileAsync("bash", ["-c", '. "$1"; "$2" chat-scroll "$3" "$4"', "prompt-test", resumeLib, fn, JSON.stringify(record), "def5678 a landed commit"]);
  return result.stdout;
}
const continued = await prompt("workstream_continued_prompt");
const startedFresh = await prompt("workstream_continuation_prompt");
JSON.stringify([
  continued.includes("this conversation resumed"),
  continued.includes("recreated at the same path"),
  continued.includes("def5678 a landed commit"),
  startedFresh.includes("before changing anything"),
  startedFresh.includes("def5678 a landed commit"),
  !startedFresh.includes("prior Claude session id"),
])
=> [true,true,true,true,true,true]
```

```ts cleanup
await rm(projectsRoot, { recursive: true, force: true });
```

## Briefing sources fail loudly and share one wrapper

```ts
const promptRoot = await execFileAsync("bash", ["-c", '. "$1"; workstream_read_briefing test-command "hello world"; workstream_wrap_briefing "$WORKSTREAM_BRIEFING"', "briefing-test", briefingLib]);
JSON.stringify({ wrapped: promptRoot.stdout.includes("<agent-continuation>"), text: promptRoot.stdout.includes("hello world") })
=> {"wrapped":true,"text":true}

const emptyPrompt = await execFileAsync("bash", ["-c", '. "$1"; workstream_read_briefing test-command ""', "briefing-test", briefingLib]).catch((error: unknown) => error as { code: number; stderr: string });
JSON.stringify({ code: emptyPrompt.code, message: emptyPrompt.stderr.trim() })
=> {"code":1,"message":"test-command: supplied briefing is empty"}

const invalidDescription = await execFileAsync("bash", ["-c", '. "$1"; workstream_validate_description "$2"', "briefing-test", briefingLib, "first\nsecond"]).catch((error: unknown) => error as { code: number; stderr: string });
JSON.stringify({ code: invalidDescription.code, oneLine: invalidDescription.stderr.includes("must be one line") })
=> {"code":1,"oneLine":true}

const trimmedDescription = await execFileAsync("bash", ["-c", '. "$1"; workstream_validate_description "$2"; printf "%s" "$WORKSTREAM_DESCRIPTION"', "briefing-test", briefingLib, "  routing scope  "]);
trimmedDescription.stdout
=> routing scope
```

## The command parser is safe on Bash 3.2 and accepts dash-leading briefings

```ts
const commandRoot = await mkdtemp(`${tmpdir()}/workstream-resume-command-`);
const commandState = `${commandRoot}/state`;
const commandWorktrees = `${commandRoot}/worktrees`;
await mkdir(`${commandState}/workstreams`, { recursive: true });
await mkdir(commandWorktrees, { recursive: true });
const commandEnv = { ...process.env, CALLBACK_STATE_DIR: commandState, CALLBACK_WORKTREE_ROOT: commandWorktrees, CALLBACK_BOX_ROOT: `${commandRoot}/boxes` };
const noBriefing = await execFileAsync(workstreams, ["resume", "ghost"], { env: commandEnv }).catch((error: unknown) => error as { code: number; stderr: string });
const dashBriefing = await execFileAsync(workstreams, ["resume", "ghost", "--", "-context"], { env: commandEnv }).catch((error: unknown) => error as { code: number; stderr: string });
JSON.stringify({ noBriefing: noBriefing.stderr.includes("unknown workstream 'ghost'"), dashBriefing: dashBriefing.stderr.includes("unknown workstream 'ghost'") })
=> {"noBriefing":true,"dashBriefing":true}
```

```ts cleanup
await rm(commandRoot, { recursive: true, force: true });
```
