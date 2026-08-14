# Workstreams document and lifecycle services

The resident app owns its issue transaction after cutover, but preserves the
legacy behavior: edits are revision-checked, metadata-only, atomically written,
and committed by selected path without consuming unrelated dirt.

```ts setup
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { createDocumentsService } from "../src/server/documents-service.js";
import { mergeOverlaySources } from "../src/server/issue-overlay.js";
import { resolveIssueTarget } from "../src/server/issues-mutation-service.js";
import { createActionsService, createResumeMarkerParser, type ActionCommandRequest } from "../src/server/actions-service.js";

async function git(cwd: string, args: string[]) {
  return execa("git", args, { cwd });
}

async function makeRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workstreams-app-"));
  const worktreesRoot = path.join(root, "worktrees");
  await Promise.all([
    fs.mkdir(path.join(root, "issues", "bugs"), { recursive: true }),
    fs.mkdir(path.join(root, "callback-box", "docs", "plans"), { recursive: true }),
    fs.mkdir(path.join(root, "callback-box", "docs", "implemented-plans"), { recursive: true }),
    fs.mkdir(path.join(root, "callback-box", "docs", "unimplemented-plans"), { recursive: true }),
    fs.mkdir(worktreesRoot, { recursive: true }),
  ]);
  const issuePath = path.join(root, "issues", "bugs", "2026-08-13-example.md");
  await fs.writeFile(issuePath, `---
title: Example issue
workstream: example
needs: [manual-testing]
labels: [router]
priority: normal
next-action: reconfirm
---
# Example issue

Body text.
`);
  await fs.writeFile(path.join(root, "callback-box", "docs", "plans", "example.md"), `---
title: Example plan
status: draft
workstream: example
---
`);
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Workstreams Test"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "fixture"]);
  return { root, worktreesRoot, issuePath };
}
```

## Documents retain issue, plan, body, and testing semantics

```ts
const fixture = await makeRepo();
const documents = createDocumentsService({
  mainRoot: fixture.root,
  worktreesRoot: fixture.worktreesRoot,
});
const [issues, plans, testing, detail] = await Promise.all([
  documents.listIssues(),
  documents.listPlans(),
  documents.testingQueue(),
  documents.issueDetail("bugs/2026-08-13-example.md", "public"),
]);
JSON.stringify({
  issue: issues[0]?.frontmatter.title,
  plan: plans[0]?.title,
  landed: testing.landed.length,
  pending: testing.pending.length,
  body: detail.body?.trim(),
})
=> {"issue":"Example issue","plan":"Example plan","landed":1,"pending":0,"body":"# Example issue\n\nBody text."}
```

Saving changes updates both fields and makes exactly one path-scoped commit.
An unrelated dirty file remains uncommitted.

```ts continue
await fs.writeFile(path.join(fixture.root, "notes.txt"), "unrelated\n");
const saved = await documents.saveIssueChanges([{
  relPath: "bugs/2026-08-13-example.md",
  visibility: "public",
  priority: "important",
  nextAction: null,
  originalPriority: "normal",
  originalNextAction: "reconfirm",
}]);
const source = await fs.readFile(fixture.issuePath, "utf8");
const status = (await git(fixture.root, ["status", "--short"])).stdout;
const subject = (await git(fixture.root, ["log", "-1", "--pretty=%s"])).stdout;
JSON.stringify({
  saved,
  important: source.includes("priority: important"),
  actionRemoved: !source.includes("next-action:"),
  status,
  subject,
})
=> {"saved":1,"important":true,"actionRemoved":true,"status":"?? notes.txt","subject":"Update issue metadata"}
```

A stale browser revision fails before writing or committing.

```ts continue
await documents.saveIssueChanges([{
  relPath: "bugs/2026-08-13-example.md",
  visibility: "public",
  priority: "backlog",
  nextAction: null,
  originalPriority: "normal",
  originalNextAction: null,
}])
=> throws IssueMutationError: issue priority changed since the page loaded: bugs/2026-08-13-example.md
```

An authoritative worktree overlay resolves beneath that checkout's `issues/`
directory, not at the checkout root.

```ts continue
const overlayRoot = path.join(fixture.worktreesRoot, "example");
const relPath = "bugs/2026-08-13-example.md";
await fs.mkdir(path.join(overlayRoot, "issues", "bugs"), { recursive: true });
await fs.copyFile(fixture.issuePath, path.join(overlayRoot, "issues", relPath));
const overlayTarget = await resolveIssueTarget({
  relPath,
  visibility: "public",
  mainRoot: fixture.root,
  overlay: {
    byPath: new Map([[relPath, [{ worktree: "example", status: "modified", committed: true }]]]),
    byPathPrivate: new Map(),
    worktreeRoots: new Map([["example", overlayRoot]]),
  },
});
path.relative(overlayRoot, overlayTarget)
=> issues/bugs/2026-08-13-example.md
```

Committed, working-copy, renamed, and untracked overlays retain the same
precedence metadata the workstreams page uses to choose an issue source.

```ts continue
const merged = mergeOverlaySources({
  worktree: "example",
  committed: "M\0issues/bugs/committed.md\0R100\0issues/bugs/old.md\0issues/bugs/new.md\0",
  uncommitted: "M\0issues/bugs/working.md\0",
  untracked: "issues/bugs/new-file.md\0",
});
JSON.stringify(Object.fromEntries(
  [...merged].toSorted(([left], [right]) => left.localeCompare(right)),
))
=> {"bugs/committed.md":[{"worktree":"example","status":"modified","committed":true}],"bugs/new-file.md":[{"worktree":"example","status":"added","committed":false}],"bugs/new.md":[{"worktree":"example","status":"renamed","committed":true,"oldPath":"bugs/old.md"}],"bugs/old.md":[{"worktree":"example","status":"renamed","committed":true,"oldPath":"bugs/old.md"}],"bugs/working.md":[{"worktree":"example","status":"modified","committed":false}]}
```

```ts cleanup
await fs.rm(fixture.root, { recursive: true, force: true });
```

## Resume jobs expose meaningful phases and deduplicate active work

Progress markers can straddle stderr chunks without losing or inventing a
stage.

```ts
const stages: string[] = [];
const parseMarker = createResumeMarkerParser((stage) => stages.push(stage));
parseMarker("noise\nWORKSTREAM_RESUME_STATUS:rest");
parseMarker("oring\nWORKSTREAM_RESUME_STATUS:opened\n");
JSON.stringify(stages)
=> ["restoring","opened"]
```

```ts
let finishResume: (() => void) | undefined;
const calls: ActionCommandRequest[] = [];
const actions = createActionsService({
  runCommand: async (request) => {
    calls.push(request);
    if (request.verb !== "resume") return;
    request.onProgress?.("checking");
    await new Promise<void>((resolve) => { finishResume = resolve; });
  },
  setExpiry: () => undefined,
});
const first = await actions.run("resume", "example");
const second = await actions.run("resume", "example");
JSON.stringify({
  first: first.status === "started" ? first.job.stage : "wrong",
  same: first.status === "started" && second.status === "started" && first.job.id === second.job.id,
  calls: calls.length,
  active: actions.activeJobs(),
})
=> {"first":"checking","same":true,"calls":1,"active":1}
```

Completing the command advances a non-terminal job to `ready`; ordinary actions
run synchronously and never create jobs.

```ts continue
finishResume?.();
await new Promise((resolve) => setImmediate(resolve));
const job = first.status === "started" ? actions.job(first.job.id) : null;
await actions.run("archive", "example");
JSON.stringify({ stage: job?.stage, active: actions.activeJobs(), verbs: calls.map((call) => call.verb) })
=> {"stage":"ready","active":0,"verbs":["resume","archive"]}
```
