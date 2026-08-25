# Workstreams application server boundary

The resident app treats the existing `bin/workstreams` command as the sole
source of joined worktree, liveness, and registry state. The adapter injects
command execution so tests never inspect real worktrees.

```ts setup
import {
  createWorkstreamsCommandService,
  type CommandRequest,
  type CommandRunner,
} from "../src/server/workstreams-command.js";
import {
  ROUTER_CAPABILITY_HEADER,
  buildApp,
} from "../src/server/app.js";
import type { AppServices } from "../src/server/services.js";
import type { WorkstreamSummary } from "../src/shared/workstreams.js";

function cliRow(name = "example") {
  return {
    name,
    branch: `worktree-${name}`,
    path: `/private/worktrees/${name}`,
    box: `/private/boxes/${name}/test1`,
    url: `http://localhost:3210/${name}/`,
    git: { ahead: 2, dirty: 1, merged: false, tip: "abc123" },
    runtime: { state: "cold" },
    agent: { state: "live", reason: "signal=cwd" },
    session: {
      agent: "codex",
      hasSession: true,
      tty: "/dev/ttys001",
      emoji: "🔧",
      baseSha: "base123",
      removed: null,
      archived: null,
      description: "Workstream routing",
      launch: { state: "none", startedAt: null, expiresAt: null, failedAt: null, reason: null },
    },
    routing: { state: "live", action: "manual-forward", lastActivityAt: "2026-08-20T00:00:00Z" },
    boxState: { testSetup: false, keepUnmerged: false, pristine: null },
    schedule: null,
  };
}

function fakeServices(workstreams: WorkstreamSummary[] = []): AppServices {
  return {
    workstreams: { list: async () => ({ items: workstreams, warnings: [] }) },
    documents: {
      listIssues: async () => [],
      issueDetail: async () => { throw new Error("not configured"); },
      listPlans: async () => [],
      testingQueue: async () => ({ landed: [], pending: [] }),
      issuesForWorkstream: async () => [],
      saveIssueChanges: async () => 0,
    },
    quotas: { get: async () => [] },
    exhibits: {
      askQueue: async () => ({ origin: "http://127.0.0.1:3230", storeProblem: null, entries: [] }),
    },
    actions: {
      run: async () => ({ status: "complete" }),
      job: () => null,
      activeJobs: () => 0,
    },
  };
}
```

## The command adapter preserves the canonical CLI

The service requests removed registry records as well as live worktrees. Its
public summary deliberately omits absolute worktree and box paths.

```ts
let request: CommandRequest | undefined;
const commandRunner: CommandRunner = async (nextRequest) => {
  request = nextRequest;
  return { stdout: JSON.stringify([cliRow()]), stderr: "" };
};
const service = createWorkstreamsCommandService({
  repoRoot: "/repo",
  commandRunner,
});
const result = await service.list();
const items = result.items;
JSON.stringify({
  command: request?.command,
  args: request?.args,
  cwd: request?.cwd,
  name: items[0]?.name,
  hasPath: "path" in (items[0] ?? {}),
  hasBox: "box" in (items[0] ?? {}),
  warnings: result.warnings.length,
})
=> {"command":"/repo/bin/workstreams","args":["list","--json","--include-removed"],"cwd":"/repo","name":"example","hasPath":false,"hasBox":false,"warnings":0}
```

Invalid JSON and schema drift fail at the boundary with command context. Schema
errors name only the bad field; they do not echo CLI output containing local
paths.

```ts
const invalidJson = createWorkstreamsCommandService({
  repoRoot: "/repo",
  commandRunner: async () => ({ stdout: "not-json", stderr: "" }),
});
await invalidJson.list()
=> throws InvalidWorkstreamsJsonError: bin/workstreams list --json --include-removed returned invalid JSON

const partlyInvalid = createWorkstreamsCommandService({
  repoRoot: "/repo",
  commandRunner: async () => ({
    stdout: JSON.stringify([cliRow("good"), { ...cliRow("bad"), git: { ahead: "secret /private/path" } }]),
    stderr: "",
  }),
});
const partial = await partlyInvalid.list();
JSON.stringify({ names: partial.items.map((item) => item.name), warning: partial.warnings[0] })
=> {"names":["good"],"warning":{"row":1,"name":"bad","fields":["git.ahead","git.dirty","git.merged","git.tip"],"message":"Invalid workstream row 1 (bad): git.ahead, git.dirty, git.merged, git.tip"}}

const invalidTopLevel = createWorkstreamsCommandService({
  repoRoot: "/repo",
  commandRunner: async () => ({ stdout: JSON.stringify({ workstreams: [] }), stderr: "" }),
});
await invalidTopLevel.list()
=> throws InvalidWorkstreamsTopLevelError: bin/workstreams list --json --include-removed returned a non-array top-level value

const manyInvalid = createWorkstreamsCommandService({
  repoRoot: "/repo",
  commandRunner: async () => ({ stdout: JSON.stringify(Array.from({ length: 10 }, (_, index) => ({ ...cliRow(`bad-${index}`), branch: "" }))), stderr: "inventory anomaly" }),
});
const bounded = await manyInvalid.list();
JSON.stringify({ warnings: bounded.warnings.length, omitted: bounded.warnings.at(-2)?.message, stderr: bounded.warnings.at(-1)?.message })
=> {"warnings":10,"omitted":"2 additional invalid workstream rows were omitted","stderr":"inventory anomaly"}
```

Execution failures contain a bounded, path-scrubbed detail instead of exposing
the checkout location.

```ts
const failed = createWorkstreamsCommandService({
  repoRoot: "/Users/me/src/callback-box",
  commandRunner: async () => {
    throw Object.assign(new Error("command failed"), {
      stderr: "fatal: /Users/me/src/callback-box/bin/workstreams is unavailable",
    });
  },
});
await failed.list()
=> throws WorkstreamsExecutionError: bin/workstreams list --json --include-removed failed: fatal: <repo>/bin/workstreams is unavailable
```

## Router capability and health

Every route, including health, requires the router-minted per-process
capability. Health reports the build generation and all activity that makes a
restart unsafe: detached lifecycle jobs plus in-flight mutating procedures.

```ts
const app = await buildApp({
  services: fakeServices(),
  routerCapability: "correct-capability",
  basePath: "/workstreams/",
  buildId: "build-42",
  activeJobs: () => 3,
});
const denied = await app.inject({
  method: "GET",
  url: "/workstreams/__internal/health",
});
const healthy = await app.inject({
  method: "GET",
  url: "/workstreams/__internal/health",
  headers: { [ROUTER_CAPABILITY_HEADER]: "correct-capability" },
});
JSON.stringify({
  denied: { status: denied.statusCode, body: denied.json() },
  healthy: { status: healthy.statusCode, body: healthy.json() },
})
=> {"denied":{"status":401,"body":{"error":"router-capability-required"}},"healthy":{"status":200,"body":{"status":"ready","activeJobs":3,"buildId":"build-42"}}}
```

The tRPC query uses the same injected service and capability wall. Batching is
disabled so the outer router can classify each read or mutation independently.

```ts continue
const row = cliRow("from-api");
const apiApp = await buildApp({
  services: fakeServices([{
        name: row.name,
        branch: row.branch,
        url: row.url,
        git: row.git,
        runtime: row.runtime,
        agent: row.agent,
        session: row.session,
        routing: row.routing,
        boxState: row.boxState,
        schedule: row.schedule,
  }]),
  routerCapability: "correct-capability",
  basePath: "/workstreams",
  buildId: "build-42",
  activeJobs: () => 0,
});
const apiResponse = await apiApp.inject({
  method: "GET",
  url: "/workstreams/api/trpc/workstreams.list",
  headers: { [ROUTER_CAPABILITY_HEADER]: "correct-capability" },
});
JSON.stringify({
  status: apiResponse.statusCode,
  name: apiResponse.json().result.data.items[0].name,
})
=> {"status":200,"name":"from-api"}
```

Every mutating procedure contributes to the health activity count until it
settles. This includes issue commits, not only long-running resume jobs, so the
supervisor cannot replace the backend during a write transaction.

```ts continue
let saveStarted: (() => void) | undefined;
let finishSave: (() => void) | undefined;
const startedSaving = new Promise<void>((resolve) => { saveStarted = resolve; });
const saving = new Promise<void>((resolve) => { finishSave = resolve; });
const mutationServices = fakeServices();
mutationServices.documents.saveIssueChanges = async () => {
  saveStarted?.();
  await saving;
  return 0;
};
const mutationApp = await buildApp({
  services: mutationServices,
  routerCapability: "correct-capability",
  basePath: "/workstreams",
  buildId: "build-42",
  activeJobs: () => 2,
});
const saveRequest = mutationApp.inject({
  method: "POST",
  url: "/workstreams/api/trpc/issues.save",
  headers: {
    [ROUTER_CAPABILITY_HEADER]: "correct-capability",
    "content-type": "application/json",
  },
  payload: { changes: [] },
});
await startedSaving;
const duringSave = await mutationApp.inject({
  method: "GET",
  url: "/workstreams/__internal/health",
  headers: { [ROUTER_CAPABILITY_HEADER]: "correct-capability" },
});
finishSave?.();
await saveRequest;
const afterSave = await mutationApp.inject({
  method: "GET",
  url: "/workstreams/__internal/health",
  headers: { [ROUTER_CAPABILITY_HEADER]: "correct-capability" },
});
JSON.stringify({
  during: duringSave.json().activeJobs,
  after: afterSave.json().activeJobs,
})
=> {"during":3,"after":2}
```

```ts cleanup
await app.close();
await apiApp.close();
await mutationApp.close();
```
