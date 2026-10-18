// # Workstreams application server boundary
//
// The resident app treats the existing `bin/workstreams` command as the sole
// source of joined worktree, liveness, and registry state. The adapter injects
// command execution so tests never inspect real worktrees.

import { test, type Test } from "tap";
import "agent-doctest/tap";
import {
  createWorkstreamsCommandService,
  type CommandRequest,
  type CommandRunner,
} from "../../../src/server/main/workstreams-command.js";
import {
  ROUTER_CAPABILITY_HEADER,
  buildApp,
} from "../../../src/server/main/app.js";
import type { AppServices } from "../../../src/server/services.js";
import type { WorkstreamSummary } from "../../../src/shared/workstreams.js";

async function unconfigured(): Promise<never> {
  throw new Error("not configured");
}

function cliRow(nameOrDefault?: string) {
  const name = nameOrDefault ?? "example";
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
      agent: "codex" as const,
      hasSession: true,
      tty: "/dev/ttys001",
      baseSha: "base123",
      removed: null,
      archived: null,
      description: "Workstream routing",
      launch: { state: "none" as const, startedAt: null, expiresAt: null, failedAt: null, reason: null },
    },
    routing: { state: "live" as const, action: "manual-forward" as const, lastActivityAt: "2026-08-20T00:00:00Z" },
    boxState: { testSetup: false, keepUnmerged: false, pristine: null },
    schedule: null,
  };
}

function fakeServices(workstreams?: WorkstreamSummary[]): AppServices {
  return {
    workstreams: { list: async () => ({ items: workstreams ?? [], warnings: [] }) },
    schedules: { alerts: async () => [], acknowledge: async () => {} },
    documents: {
      listIssues: async () => [],
      issueDetail: unconfigured,
      listPlans: async () => [],
      testingQueue: async () => ({ landed: [], pending: [] }),
      issuesForWorkstream: async () => [],
      saveIssueChanges: async () => 0,
      setIssueNextAction: unconfigured,
      readDocument: unconfigured,
      changedFiles: unconfigured,
      recentFiles: unconfigured,
      pathIndex: unconfigured,
    },
    comments: { forDocument: unconfigured, waiting: unconfigured, add: unconfigured, clear: unconfigured },
    transcribe: { transcribe: unconfigured },
    quotas: { get: async () => [] },
    exhibits: {
      inventory: async () => ({ origin: "http://127.0.0.1:3230", storeProblem: null, entries: [] }),
    },
    actions: {
      run: async () => ({ status: "complete" }),
      job: () => null,
      activeJobs: () => 0,
    },
    related: { related: unconfigured },
  };
}

// ## The command adapter preserves the canonical CLI
//
// The service requests removed registry records as well as live worktrees. Its
// public summary deliberately omits absolute worktree and box paths.
void test("The service requests removed registry records as well as live worktrees.", async (t) => {
  // doctest:L89
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
  t.check(
    {
      command: request?.command,
      args: request?.args,
      cwd: request?.cwd,
      name: items[0]?.name,
      hasPath: "path" in (items[0] ?? {}),
      hasBox: "box" in (items[0] ?? {}),
      warnings: result.warnings.length,
    },
    {
    command: "/repo/bin/workstreams",
    args: [
      "list",
      "--json",
      "--include-removed",
    ],
    cwd: "/repo",
    name: "example",
    hasPath: false,
    hasBox: false,
    warnings: 0,
  },
  );
});

// Invalid JSON and schema drift fail at the boundary with command context. Schema
// errors name only the bad field; they do not echo CLI output containing local
// paths.
void test("Invalid JSON and schema drift fail at the boundary with command context.", async (t) => {
  // doctest:L117
  const invalidJson = createWorkstreamsCommandService({
    repoRoot: "/repo",
    commandRunner: async () => ({ stdout: "not-json", stderr: "" }),
  });
  await t.checkThrows(async () => (await invalidJson.list()), "InvalidWorkstreamsJsonError: bin/workstreams list --json --include-removed returned invalid JSON");

  // doctest:L124
  const partlyInvalid = createWorkstreamsCommandService({
    repoRoot: "/repo",
    commandRunner: async () => ({
      stdout: JSON.stringify([cliRow("good"), { ...cliRow("bad"), git: { ahead: "secret /private/path" } }]),
      stderr: "",
    }),
  });
  const partial = await partlyInvalid.list();
  t.check({ names: partial.items.map((item) => item.name), warning: partial.warnings[0] }, {
    names: [
      "good",
    ],
    warning: {
      row: 1,
      name: "bad",
      fields: [
        "git.ahead",
        "git.dirty",
        "git.merged",
        "git.tip",
      ],
      message: "Invalid workstream row 1 (bad): git.ahead, git.dirty, git.merged, git.tip",
    },
  });

  // doctest:L135
  const invalidTopLevel = createWorkstreamsCommandService({
    repoRoot: "/repo",
    commandRunner: async () => ({ stdout: JSON.stringify({ workstreams: [] }), stderr: "" }),
  });
  await t.checkThrows(async () => (await invalidTopLevel.list()), "InvalidWorkstreamsTopLevelError: bin/workstreams list --json --include-removed returned a non-array top-level value");

  // doctest:L142
  const manyInvalid = createWorkstreamsCommandService({
    repoRoot: "/repo",
    commandRunner: async () => ({ stdout: JSON.stringify(Array.from({ length: 10 }, (_, index) => ({ ...cliRow(`bad-${index}`), branch: "" }))), stderr: "inventory anomaly" }),
  });
  const bounded = await manyInvalid.list();
  t.check({ warnings: bounded.warnings.length, omitted: bounded.warnings.at(-2)?.message, stderr: bounded.warnings.at(-1)?.message }, {
    warnings: 10,
    omitted: "2 additional invalid workstream rows were omitted",
    stderr: "inventory anomaly",
  });
});

// Execution failures contain a bounded, path-scrubbed detail instead of exposing
// the checkout location.
void test("Execution failures contain a bounded, path-scrubbed detail instead of exposin...", async (t) => {
  // doctest:L155
  const failed = createWorkstreamsCommandService({
    repoRoot: "/Users/me/src/beebox",
    commandRunner: async () => {
      throw Object.assign(new Error("command failed"), {
        stderr: "fatal: /Users/me/src/beebox/bin/workstreams is unavailable",
      });
    },
  });
  await t.checkThrows(async () => (await failed.list()), "WorkstreamsExecutionError: bin/workstreams list --json --include-removed failed: fatal: <repo>/bin/workstreams is unavailable");
});

// ## Router capability and health
//
// Every route, including health, requires the router-minted per-process
// capability. Health reports the build generation and all activity that makes a
// restart unsafe: detached lifecycle jobs plus in-flight mutating procedures.
void test("Every route, including health, requires the router-minted per-process capabil...", async (t) => {
  await checkHealthCapability(t);
  await checkTrpcList(t);
  await checkExhibitJoin(t);
  await checkProblemStore(t);
  await checkMutationActivity(t);
});

async function checkHealthCapability(t: Test): Promise<void> {
  // doctest:L174
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
  t.check(
    {
      denied: { status: denied.statusCode, body: denied.json() },
      healthy: { status: healthy.statusCode, body: healthy.json() },
    },
    {
    denied: {
      status: 401,
      body: {
        error: "router-capability-required",
      },
    },
    healthy: {
      status: 200,
      body: {
        status: "ready",
        activeJobs: 3,
        buildId: "build-42",
      },
    },
  },
  );
  await app.close();
}

async function checkTrpcList(t: Test): Promise<void> {
  // The tRPC query uses the same injected service and capability wall. Batching is
  // disabled so the outer router can classify each read or mutation independently.

  // doctest:L201
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
  t.check(
    {
      status: apiResponse.statusCode,
      name: apiResponse.json().result.data.items[0].name,
    },
    {
    status: 200,
    name: "from-api",
  },
  );
  await apiApp.close();
}

async function checkExhibitJoin(t: Test): Promise<void> {
  // The list joins each workstream's exhibits by directory name == row name,
  // newest first with broken rows last, and the detail procedure returns the same
  // rows. A store the service could not read becomes a warning, so it never reads
  // as "no exhibits".

  // doctest:L238
  const joinServices = fakeServices([summary("with-exhibits"), summary("without")]);
  joinServices.exhibits.inventory = async () => ({
    origin: "http://127.0.0.1:3230",
    storeProblem: null,
    entries: [
      entry({ workstream: "with-exhibits", slug: "old", title: "Old one", created: "2026-08-01T00:00:00Z", problem: null }),
      entry({ workstream: "with-exhibits", slug: "broken", title: null, created: null, problem: "broken manifest: created: Invalid input" }),
      entry({ workstream: "with-exhibits", slug: "new", title: "New one", created: "2026-09-01T00:00:00Z", problem: null }),
      entry({ workstream: "orphaned", slug: "x", title: "No worktree", created: "2026-09-02T00:00:00Z", problem: null }),
    ],
  });
  const joinApp = await buildApp({
    services: joinServices,
    routerCapability: "correct-capability",
    basePath: "/workstreams",
    buildId: "build-42",
    activeJobs: () => 0,
  });
  const joined = (await joinApp.inject({ method: "GET", url: "/workstreams/api/trpc/workstreams.list", headers: trpcHeaders })).json().result.data;
  const detailUrl = `/workstreams/api/trpc/workstreams.detail?input=${encodeURIComponent(JSON.stringify({ name: "with-exhibits" }))}`;
  const detail = (await joinApp.inject({ method: "GET", url: detailUrl, headers: trpcHeaders })).json().result.data;
  t.check(
    {
      origin: joined.exhibitsOrigin,
      withSlugs: joined.items[0].exhibits.map((exhibit: { slug: string }) => exhibit.slug),
      withoutSlugs: joined.items[1].exhibits.map((exhibit: { slug: string }) => exhibit.slug),
      warnings: joined.warnings.length,
      detailSlugs: detail.exhibits.map((exhibit: { slug: string }) => exhibit.slug),
      detailOrigin: detail.exhibitsOrigin,
    },
    {
    origin: "http://127.0.0.1:3230",
    withSlugs: [
      "new",
      "old",
      "broken",
    ],
    withoutSlugs: [],
    warnings: 0,
    detailSlugs: [
      "new",
      "old",
      "broken",
    ],
    detailOrigin: "http://127.0.0.1:3230",
  },
  );
  await joinApp.close();
}

async function checkProblemStore(t: Test): Promise<void> {
  // doctest:L279
  const problemServices = fakeServices([summary("with-exhibits")]);
  problemServices.exhibits.inventory = async () => ({
    origin: "http://127.0.0.1:3230",
    storeProblem: "No exhibit store yet: /store has no marker file. Run bin/exhibits to create one.",
    entries: [],
  });
  const problemApp = await buildApp({
    services: problemServices,
    routerCapability: "correct-capability",
    basePath: "/workstreams",
    buildId: "build-42",
    activeJobs: () => 0,
  });
  const problemList = (await problemApp.inject({ method: "GET", url: "/workstreams/api/trpc/workstreams.list", headers: trpcHeaders })).json().result.data;
  t.check({ exhibits: problemList.items[0].exhibits.length, warnings: problemList.warnings.map((warning: { message: string }) => warning.message) }, {
    exhibits: 0,
    warnings: [
      "No exhibit store yet: /store has no marker file. Run bin/exhibits to create one.",
    ],
  });
  await problemApp.close();
}

async function checkMutationActivity(t: Test): Promise<void> {
  // Every mutating procedure contributes to the health activity count until it
  // settles. This includes issue commits, not only long-running resume jobs, so the
  // supervisor cannot replace the backend during a write transaction.

  // doctest:L302
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
  t.check(
    {
      during: duringSave.json().activeJobs,
      after: afterSave.json().activeJobs,
    },
    {
    during: 3,
    after: 2,
  },
  );
  await mutationApp.close();
}

const summary = (name: string): WorkstreamSummary => {
  const source = cliRow(name);
  return {
    name: source.name, branch: source.branch, url: source.url, git: source.git, runtime: source.runtime,
    agent: source.agent, session: source.session, routing: source.routing, boxState: source.boxState, schedule: source.schedule,
  };
};
function entry({ workstream, slug, title, created, problem }: { workstream: string; slug: string; title: string | null; created: string | null; problem: string | null }) {
  return { workstream, slug, path: `/${workstream}/${slug}/`, title, created, problem };
}
const trpcHeaders = { [ROUTER_CAPABILITY_HEADER]: "correct-capability" };
