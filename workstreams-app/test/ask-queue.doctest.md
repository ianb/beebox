# The ask queue

The workstreams origin reads the exhibit store to answer "what is waiting on
me". It never writes: answering happens on the exhibits origin. Every failure
mode — a manifest that does not parse, a disposition that does not parse, a
store that was never created — becomes something the developer can see.

```ts setup
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ROUTER_CAPABILITY_HEADER, buildApp } from "../src/server/app.js";
import { createExhibitsQueueService } from "../src/server/exhibits-queue-service.js";
import { STORE_MARKER } from "../src/server/exhibits/store.js";
import type { AppServices } from "../src/server/services.js";
import { groupAskQueue } from "../src/frontend/lib/ask-queue.js";

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
}

function manifest(overrides: Record<string, unknown>) {
  return { title: "A title", created: "2026-08-15T00:00:00Z", ask: { type: "fyi", prose: "Nothing needed." }, ...overrides };
}

/** A store with one exhibit per interesting state, plus two committed apps. */
async function makeFixture(options: { marker?: boolean } = {}) {
  // realpath: containment answers in canonical paths, and macOS tmpdir is a symlink.
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ask-queue-")));
  const storeRoot = path.join(root, "workstream-exhibits");
  const appsRoot = path.join(root, "dev", "apps");
  await fs.mkdir(appsRoot, { recursive: true });
  await fs.mkdir(storeRoot, { recursive: true });
  if (options.marker !== false) await fs.writeFile(path.join(storeRoot, STORE_MARKER), "");

  const alpha = path.join(storeRoot, "alpha");
  await writeJson(path.join(alpha, "layout/exhibit.json"), manifest({
    title: "Six screenshots",
    ask: { type: "decide", prose: "Which layout ships?", options: ["A", "B"] },
  }));
  await writeJson(path.join(alpha, "copy/exhibit.json"), manifest({
    title: "Error copy",
    ask: { type: "confirm", prose: "Veto if this reads wrong." },
  }));
  await writeJson(path.join(alpha, "copy/data/disposition.json"), {
    askType: "confirm",
    choice: "ok",
    decidedAt: "2026-08-15T12:00:00Z",
  });
  await writeJson(path.join(alpha, "vibes/exhibit.json"), manifest({
    title: "Motion study",
    ask: { type: "react", prose: "How does this feel?" },
  }));
  await writeJson(path.join(alpha, "vibes/data/disposition.json"), { askType: "react" });
  await writeJson(path.join(alpha, "notes/exhibit.json"), manifest({ title: "Run notes" }));
  await writeJson(path.join(alpha, "busted/exhibit.json"), '{"title": "no ask, bad json"');

  await writeJson(path.join(storeRoot, "beta/rollout/exhibit.json"), manifest({
    title: "Rollout plan",
    ask: { type: "confirm", prose: "Veto if the order is wrong." },
  }));

  await writeJson(path.join(appsRoot, "story-eval/exhibit.json"), manifest({
    title: "Story eval",
    ask: { type: "confirm", prose: "Did the rescore land?" },
  }));
  await writeJson(path.join(storeRoot, "apps/story-eval/data/disposition.json"), {
    askType: "confirm",
    decidedAt: "2026-08-14T09:00:00Z",
  });
  await writeJson(path.join(appsRoot, "toolbox/exhibit.json"), { title: "Toolbox", created: "2026-08-15T00:00:00Z" });
  await fs.mkdir(path.join(appsRoot, "scratch"), { recursive: true });

  return { storeRoot, appsRoot };
}

async function queueFor(fixture: { storeRoot: string; appsRoot: string }) {
  return createExhibitsQueueService({ ...fixture, origin: "http://127.0.0.1:3230" }).askQueue();
}
```

## The scan reports every exhibit's ask, answer, and tier

Workstream exhibits come first, then committed apps under the reserved `apps`
segment. An app with no ask is a durable tool rather than a question, and a
directory with no manifest at all is not an exhibit — neither reaches the queue.

```ts
const fixture = await makeFixture();
const queue = await queueFor(fixture);
JSON.stringify(queue.entries.map((entry) => [entry.workstream, entry.slug, entry.ask?.type ?? null, entry.answered, entry.permanent]))
=> [["alpha","busted",null,false,false],["alpha","copy","confirm",true,false],["alpha","layout","decide",false,false],["alpha","notes","fyi",false,false],["alpha","vibes","react",false,false],["beta","rollout","confirm",false,false],["apps","story-eval","confirm",true,true]]
```

Links are built from the origin the exhibits listener binds, so the port travels
with the data instead of being hardcoded in the page. Answered entries carry the
timestamp the developer's disposition recorded.

```ts continue
JSON.stringify({
  origin: queue.origin,
  storeProblem: queue.storeProblem,
  paths: queue.entries.filter((entry) => entry.answered).map((entry) => `${queue.origin}${entry.path}`),
  decidedAt: queue.entries.filter((entry) => entry.answered).map((entry) => entry.decidedAt),
})
=> {"origin":"http://127.0.0.1:3230","storeProblem":null,"paths":["http://127.0.0.1:3230/alpha/copy/","http://127.0.0.1:3230/apps/story-eval/"],"decidedAt":["2026-08-15T12:00:00Z","2026-08-14T09:00:00Z"]}
```

## Broken manifests and unparseable answers are reported, never thrown

A manifest that does not parse becomes an explicit row with no ask; a
disposition that does not parse leaves the ask unanswered and states why, so a
corrupt answer file can never quietly retire a question.

```ts continue
// The engine's parser wording varies by Node version; the sentence that names
// the failure is ours, so only that part is asserted.
const stable = (problem: string | null) => problem?.replace(/(not valid JSON): .*/u, "$1: <parser detail>") ?? null;
JSON.stringify(
  queue.entries.filter((entry) => entry.problem !== null).map((entry) => [entry.slug, entry.answered, stable(entry.problem)]),
)
=> [["busted",false,"broken manifest: not valid JSON: <parser detail>"],["vibes",false,"disposition is invalid: decidedAt: Invalid input: expected string, received undefined"]]
```

A store that was never created is a normal fresh-checkout state, but the queue
says so — and committed apps still list, because their manifests live in the
checkout.

```ts
const bare = await makeFixture({ marker: false });
const queue = await queueFor(bare);
JSON.stringify({
  hasProblem: queue.storeProblem !== null,
  mentionsMarker: queue.storeProblem?.includes("no marker file") ?? false,
  slugs: queue.entries.map((entry) => entry.slug),
  answered: queue.entries.map((entry) => entry.answered),
})
=> {"hasProblem":true,"mentionsMarker":true,"slugs":["story-eval"],"answered":[true]}
```

## The panel groups by cost and collapses FYI

`decide`, `confirm`, `react` are the queue; FYI is shown but never counted as
waiting, and broken and answered entries are their own lists.

```ts
const fixture = await makeFixture();
const grouped = groupAskQueue(await queueFor(fixture));
JSON.stringify({
  groups: grouped.groups.map((group) => [group.type, group.entries.length]),
  waitingCount: grouped.waitingCount,
  fyi: grouped.fyi.map((entry) => entry.slug),
  broken: grouped.broken.map((entry) => entry.slug),
  answered: grouped.answered.map((entry) => entry.slug),
})
=> {"groups":[["decide",1],["confirm",1],["react",1]],"waitingCount":3,"fyi":["notes"],"broken":["busted"],"answered":["copy","story-eval"]}
```

## The procedure is read-only and behind the capability wall

```ts
const fixture = await makeFixture();
const services = {
  workstreams: { list: async () => ({ items: [], warnings: [] }) },
  documents: {
    listIssues: async () => [],
    issueDetail: async () => { throw new Error("not configured"); },
    listPlans: async () => [],
    testingQueue: async () => ({ landed: [], pending: [] }),
    issuesForWorkstream: async () => [],
    saveIssueChanges: async () => 0,
  },
  quotas: { get: async () => [] },
  actions: { run: async () => ({ status: "complete" as const }), job: () => null, activeJobs: () => 0 },
  exhibits: createExhibitsQueueService({ ...fixture, origin: "http://127.0.0.1:3230" }),
} satisfies AppServices;
const app = await buildApp({
  services,
  routerCapability: "correct-capability",
  basePath: "/workstreams",
  buildId: "build-42",
  activeJobs: () => 0,
});
const response = await app.inject({
  method: "GET",
  url: "/workstreams/api/trpc/exhibits.askQueue",
  headers: { [ROUTER_CAPABILITY_HEADER]: "correct-capability" },
});
const mutation = await app.inject({
  method: "POST",
  url: "/workstreams/api/trpc/exhibits.askQueue",
  headers: { [ROUTER_CAPABILITY_HEADER]: "correct-capability" },
  payload: {},
});
const data = response.json().result.data;
JSON.stringify({
  status: response.statusCode,
  origin: data.origin,
  count: data.entries.length,
  first: { ...data.entries[0], problem: data.entries[0].problem === null ? null : "stated" },
  mutationStatus: mutation.statusCode,
})
=> {"status":200,"origin":"http://127.0.0.1:3230","count":7,"first":{"workstream":"alpha","slug":"busted","path":"/alpha/busted/","permanent":false,"title":null,"ask":null,"answered":false,"decidedAt":null,"problem":"stated"},"mutationStatus":405}
```
