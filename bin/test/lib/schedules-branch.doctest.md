# What a schedule's branch carries between runs (bin/lib/schedules-branch.ts)

A worktree schedule's session can end before its work reaches `main`. Two
shapes of that stranded work for weeks in 2026-09:

- **Uncommitted edits.** knip-sweep's session backgrounded the test suite and
  ended its turn to wait. A headless session does not come back, so the edits
  stayed in the tree, and the next run's `git merge main` refused on every run.
- **Unlanded commits.** cross-box-leak-scan's commit was reported "ready to
  land" once, in an `fyi` that closed itself, and then sat for three weeks.

The runner now parks uncommitted edits on a ref of their own, keeps a standing
`unlanded-commits` condition while the branch holds work `main` lacks, tells
the session about both, and can replay a stored handoff.

```ts setup
import { execa } from "execa";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { readAlerts, readRunExit, readScheduleState } from "../../lib/schedules-store.js";
import { replayRun, runSchedule } from "../../lib/schedules-runner.js";
import { unlandedCommits } from "../../lib/schedules-branch.js";
import {
  HANDOFF_RUN,
  REPORTS_DONE,
  launchRig,
  useTempRegistryStateDir,
  withFakeAgent,
  workstreamYaml,
  type Rig,
} from "../../schedules-test-support.js";

await useTempRegistryStateDir();
// The test home has no git identity; the parked commit needs one.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
});

const git = async (cwd: string, ...args: string[]) => (await execa("git", ["-C", cwd, ...args])).stdout;

/** A main checkout that is a real repository, with the schedule's worktree a
 *  real `git worktree` on `worktree-<name>` — the shape `bin/workstreams
 *  create` re-attaches. */
async function realRig(agentExtra: string): Promise<Rig> {
  const rig = await launchRig({
    name: "knip-sweep",
    yaml: workstreamYaml("  worktree: true"),
    run: HANDOFF_RUN,
    liveness: "none",
    agentExit: 0,
    agentExtra,
    check: null,
  });
  const main = rig.fake.deps.mainRoot;
  await git(main, "init", "-q", "-b", "main");
  await writeFile(join(main, ".git", "info", "exclude"), "bin/\n");
  await writeFile(join(main, "f.txt"), "one\n");
  await git(main, "add", "f.txt");
  await git(main, "commit", "-q", "-m", "init");
  await git(main, "worktree", "add", "-q", "-b", "worktree-knip-sweep", rig.worktreePath);
  return rig;
}

let clock = Date.parse("2026-09-23T08:00:00Z");
async function run(rig: Rig) {
  clock += 3600_000;
  rig.fake.setNow(clock);
  return withFakeAgent(rig, async () => runSchedule(rig.fake.deps, { schedule: rig.schedule, dryRun: false }));
}
```

## Uncommitted edits are parked, and the merge goes through

The branch has one commit of its own. A session left `f.txt` edited and a new
file untracked, and `main` has since changed `f.txt`: the exact case that used
to stop the schedule for good.

```ts
const rig = await realRig(REPORTS_DONE);
const wt = rig.worktreePath;
await writeFile(join(wt, "g.txt"), "branch work\n");
await git(wt, "add", "g.txt");
await git(wt, "commit", "-q", "-m", "branch work");
await writeFile(join(wt, "f.txt"), "session edit\n");
await writeFile(join(wt, "new.txt"), "untracked\n");
await writeFile(join(rig.fake.deps.mainRoot, "f.txt"), "main moved\n");
await git(rig.fake.deps.mainRoot, "commit", "-q", "-am", "main moved");

const first = await run(rig);
const parkedRef = `refs/schedules/knip-sweep/parked/${first.kind === "ran" ? first.runId : ""}`;
JSON.stringify({
  f: (await readFile(join(wt, "f.txt"), "utf8")).trim(),
  status: await git(wt, "status", "--porcelain"),
  parkedF: await git(wt, "show", `${parkedRef}:f.txt`),
  parkedNew: await git(wt, "show", `${parkedRef}:new.txt`),
})
=> {"f":"main moved","status":"","parkedF":"session edit","parkedNew":"untracked"}
```

The session is told what was parked and which commits the branch still
carries, and that it is single-shot.

```ts continue
const briefing = await rig.transcript();
[
  briefing.includes(`An earlier run left 2 uncommitted path(s)`),
  briefing.includes(`git merge --squash ${parkedRef}`),
  /^- [0-9a-f]+ branch work$/mu.test(briefing),
  briefing.includes("This session is single-shot"),
].join(" ")
=> true true true true
```

## Unlanded commits are a standing condition until they land

The session reported, so the only alert is the runner's own: the branch holds
a commit `main` lacks.

```ts continue
const unlanded = (await readAlerts(rig.fake.deps.storeRoot, "knip-sweep")).filter((alert) => alert.state === "open");
JSON.stringify(unlanded.map((alert) => ({ condition: alert.condition, priority: alert.priority, names: /branch work/u.test(alert.message) })))
=> [{"condition":"unlanded-commits","priority":"normal","names":true}]
```

Once the branch lands, the next run resolves it.

```ts continue
await git(rig.fake.deps.mainRoot, "merge", "-q", "--no-edit", "worktree-knip-sweep");
await run(rig);
(await readAlerts(rig.fake.deps.storeRoot, "knip-sweep")).filter((alert) => alert.state === "open").length
=> 0
```

## A bailed session names its leftovers and the replay command

This agent writes a file and ends without reporting on its first session; on a
replay it reports.

```ts
const flaky = await realRig([
  'if grep -q "This is a replay" "$(dirname "$0")/transcript.txt"; then',
  REPORTS_DONE,
  "else echo wip > wip.txt; fi",
].join("\n"));
const bailed = await run(flaky);
const bailedId = bailed.kind === "ran" ? bailed.runId : "";
const [bailAlert] = await readAlerts(flaky.fake.deps.storeRoot, "knip-sweep");
JSON.stringify({
  title: bailAlert?.title,
  dirty: bailAlert?.message.includes("The worktree has 1 uncommitted path(s)"),
  replay: bailAlert?.message.includes(`bin/schedules run knip-sweep --replay ${bailedId}`),
})
=> {"title":"session ended without reporting","dirty":true,"replay":true}
```

The replay is a run of its own. It re-delivers the stored handoff without
running `run` again (so `lastRunAt` stays put), parks the bailed session's
file, and the session's report closes it out.

```ts continue
const before = (await readScheduleState(flaky.fake.deps.storeRoot, "knip-sweep")).lastRunAt;
clock += 3600_000;
flaky.fake.setNow(clock);
const replayed = await withFakeAgent(flaky, async () => replayRun(flaky.fake.deps, { schedule: flaky.schedule, replayOf: bailedId }));
const replayId = replayed.kind === "ran" ? replayed.runId : "";
const seen = await flaky.transcript();
JSON.stringify({
  body: seen.includes("remove them"),
  note: seen.includes(`This is a replay of run \`${bailedId}\``),
  parked: seen.includes(`refs/schedules/knip-sweep/parked/${replayId}`),
  lastRunAtKept: (await readScheduleState(flaky.fake.deps.storeRoot, "knip-sweep")).lastRunAt === before,
  exit: await readRunExit(flaky.fake.deps.storeRoot, { name: "knip-sweep", runId: replayId }).then((e) => [e?.runExit, e?.sessionLaunched]),
  bailedAgain: (await readAlerts(flaky.fake.deps.storeRoot, "knip-sweep")).filter((alert) => alert.runId === replayId).length,
})
=> {"body":true,"note":true,"parked":true,"lastRunAtKept":true,"exit":[null,true],"bailedAgain":0}
```

## A refusal says which liveness signal fired

The 2026-09-04 refusal said only "(live)", so nobody could tell afterwards what
the guard had seen. The guard's reason now travels in the alert.

```ts
const busy = await launchRig({
  name: "knip-sweep",
  yaml: workstreamYaml("  worktree: true"),
  run: HANDOFF_RUN,
  liveness: "live",
  agentExit: 0,
  agentExtra: REPORTS_DONE,
  check: null,
});
await withFakeAgent(busy, async () => runSchedule(busy.fake.deps, { schedule: busy.schedule, dryRun: false }));
const [refusal] = await readAlerts(busy.fake.deps.storeRoot, "knip-sweep");
JSON.stringify({ title: refusal?.title, details: refusal?.details })
=> {"title":"work waiting, session already live","details":"agent-liveness: fake"}
```

## A merge conflict after parking still names the parked edits

The branch's own commit conflicts with `main`, so no session starts. The next
run would find a clean tree, so this alert is the only place the parked ref
is mentioned.

```ts
const stuck = await realRig(REPORTS_DONE);
await writeFile(join(stuck.worktreePath, "f.txt"), "branch says\n");
await git(stuck.worktreePath, "commit", "-q", "-am", "branch says");
await writeFile(join(stuck.worktreePath, "wip.txt"), "unfinished\n");
await writeFile(join(stuck.fake.deps.mainRoot, "f.txt"), "main says\n");
await git(stuck.fake.deps.mainRoot, "commit", "-q", "-am", "main says");
const blocked = await run(stuck);
const blockedId = blocked.kind === "ran" ? blocked.runId : "";
const failure = (await readAlerts(stuck.fake.deps.storeRoot, "knip-sweep")).find((alert) => alert.priority === "important");
JSON.stringify({
  started: (await stuck.transcript()) !== "",
  title: failure?.title,
  names: failure?.message.includes(`refs/schedules/knip-sweep/parked/${blockedId}`),
})
=> {"started":false,"title":"could not bring the worktree up to date with main","names":true}
```

## Work landed under other hashes is not reported

`main` took the branch's change as a different commit with the same content,
and the branch has not merged `main` since. Landing it would change nothing.

```ts
const twin = await realRig(REPORTS_DONE);
await writeFile(join(twin.worktreePath, "h.txt"), "same work\n");
await git(twin.worktreePath, "add", "h.txt");
await git(twin.worktreePath, "commit", "-q", "-m", "same work");
await writeFile(join(twin.fake.deps.mainRoot, "h.txt"), "same work\n");
await git(twin.fake.deps.mainRoot, "add", "h.txt");
await git(twin.fake.deps.mainRoot, "commit", "-q", "-m", "same work, landed by hand");
await writeFile(join(twin.fake.deps.mainRoot, "later.txt"), "main moved on\n");
await git(twin.fake.deps.mainRoot, "add", "later.txt");
await git(twin.fake.deps.mainRoot, "commit", "-q", "-m", "later");
JSON.stringify(await unlandedCommits(twin.fake.deps.mainRoot, "worktree-knip-sweep"))
=> []
```
