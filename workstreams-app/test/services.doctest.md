# Workstreams document and lifecycle services

The resident app owns its issue transaction after cutover, but preserves the
legacy behavior: edits are revision-checked, metadata-only, atomically written,
and committed by selected path without consuming unrelated dirt.

```ts setup
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { createDocumentsService, workstreamIssueIndicators } from "../src/server/documents-service.js";
import { parseIssueFile } from "../src/server/issue-domain.js";
import { mergeOverlaySources } from "../src/server/issue-overlay.js";
import { resolveIssueTarget, saveIssueChanges } from "../src/server/issues-mutation-service.js";
import { issueRelPathSchema } from "../src/shared/documents.js";
import { createActionsService, createResumeMarkerParser, type ActionCommandRequest } from "../src/server/actions-service.js";

async function git(cwd: string, args: string[]) {
  return execa("git", args, { cwd });
}

async function makeRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workstreams-app-"));
  const privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workstreams-private-"));
  const worktreesRoot = path.join(root, "worktrees");
  await Promise.all([
    fs.mkdir(path.join(root, "issues", "bugs"), { recursive: true }),
    fs.mkdir(path.join(privateRoot, "bugs"), { recursive: true }),
    fs.mkdir(path.join(root, "callback-box", "docs", "plans"), { recursive: true }),
    fs.mkdir(path.join(root, "callback-box", "docs", "implemented-plans"), { recursive: true }),
    fs.mkdir(path.join(root, "callback-box", "docs", "unimplemented-plans"), { recursive: true }),
    fs.mkdir(worktreesRoot, { recursive: true }),
  ]);
  const issuePath = path.join(root, "issues", "bugs", "2026-08-13-example.md");
  const secretPath = path.join(root, "secret.md");
  await fs.writeFile(secretPath, "must stay outside issue access\n");
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
  const secondIssuePath = path.join(root, "issues", "bugs", "2026-08-13-second.md");
  await fs.writeFile(secondIssuePath, `---
title: Second issue
workstream: example
needs: []
labels: []
priority: normal
---
Second body.
`);
  await fs.symlink(
    secretPath,
    path.join(root, "issues", "bugs", "2026-08-13-escape.md"),
  );
  const privateIssuePath = path.join(privateRoot, "bugs", "2026-08-13-example.md");
  await fs.writeFile(privateIssuePath, `---
title: Private example
workstream: example
needs: []
labels: [private]
priority: normal
---
Private body.
`);
  await fs.writeFile(path.join(root, "callback-box", "docs", "plans", "example.md"), `---
title: Example plan
status: draft
workstream: example
---
`);
  await fs.writeFile(path.join(root, ".gitignore"), "/private-issues\n");
  await fs.symlink(privateRoot, path.join(root, "private-issues"));
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Workstreams Test"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "fixture"]);
  await git(privateRoot, ["init", "-q"]);
  await git(privateRoot, ["config", "user.email", "test@example.com"]);
  await git(privateRoot, ["config", "user.name", "Workstreams Test"]);
  await git(privateRoot, ["add", "."]);
  await git(privateRoot, ["commit", "-qm", "private fixture"]);
  return { root, privateRoot, worktreesRoot, issuePath, privateIssuePath, secondIssuePath };
}
```

Issue paths are category-relative Markdown files. Closed and private issues use
the same path grammar; visibility selects the root, so `private/` is never a
path prefix supplied by a client.

```ts
JSON.stringify({
  open: issueRelPathSchema.safeParse("bugs/2026-08-13-example.md").success,
  closed: issueRelPathSchema.safeParse("closed/watch/2026-08-13-example.md").success,
  privatePrefix: issueRelPathSchema.safeParse("private/bugs/2026-08-13-example.md").success,
  traversal: issueRelPathSchema.safeParse("bugs/../../secret.md").success,
  wrongExtension: issueRelPathSchema.safeParse("bugs/2026-08-13-example.txt").success,
})
=> {"open":true,"closed":true,"privatePrefix":false,"traversal":false,"wrongExtension":false}
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
  privateIssue: issues.find((issue) => issue.visibility === "private")?.frontmatter.title,
  plan: plans[0]?.title,
  landed: testing.landed.length,
  pending: testing.pending.length,
  body: detail.body?.trim(),
})
=> {"issue":"Example issue","privateIssue":"Private example","plan":"Example plan","landed":1,"pending":0,"body":"# Example issue\n\nBody text."}
```

Workstream associations are derived by the server, including the structured
`discovered-in` convention and worktree activity relative to main. The frontend
receives these indicators instead of parsing provenance itself.

```ts continue
const associated = parseIssueFile({
  relPath: "bugs/2026-08-13-associated.md",
  source: `---
title: Associated issue
workstream: example
discovered-in: worktree-example — investigation
---
`,
});
const previouslyClosed = parseIssueFile({
  relPath: associated.relPath,
  source: `---
title: Associated issue
workstream: example
---
`,
});
previouslyClosed.closed = true;
JSON.stringify({
  reopened: workstreamIssueIndicators({
    workstream: "example", issue: associated, main: previouslyClosed, changedHere: true,
  }),
  opened: workstreamIssueIndicators({
    workstream: "example", issue: associated, changedHere: true,
  }),
})
=> {"reopened":{"owned":true,"discovered":true,"activity":"reopened"},"opened":{"owned":true,"discovered":true,"activity":"opened"}}
```

The detail boundary rejects traversal even when called below tRPC, and public
and private visibility cannot cross-read the same relative path.

```ts continue
await documents.issueDetail("../secret.md", "public")
=> throws InvalidIssuePathError: invalid issue path: ../secret.md

await documents.issueDetail("bugs/2026-08-13-escape.md", "public")
=> throws InvalidIssuePathError: invalid issue path: bugs/2026-08-13-escape.md

await documents.saveIssueChanges([{
  relPath: "closed/bugs/../../secret.md",
  visibility: "public",
  priority: "backlog",
  nextAction: null,
  originalPriority: "normal",
  originalNextAction: null,
}])
=> throws InvalidIssuePathError: invalid issue path: closed/bugs/../../secret.md

const privateDetail = await documents.issueDetail("bugs/2026-08-13-example.md", "private");
JSON.stringify({ title: privateDetail.frontmatter.title, body: privateDetail.body?.trim() })
=> {"title":"Private example","body":"Private body."}
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

A conflict in any member preflights the whole batch. Earlier valid members are
not written, and a failure during a later atomic rename restores already-renamed
members and cleans temporary files.

```ts continue
const sourceBeforeBatch = await fs.readFile(fixture.issuePath, "utf8");
const batchConflict = await documents.saveIssueChanges([
  {
    relPath: "bugs/2026-08-13-example.md",
    visibility: "public",
    priority: "backlog",
    nextAction: null,
    originalPriority: "important",
    originalNextAction: null,
  },
  {
    relPath: "bugs/2026-08-13-second.md",
    visibility: "public",
    priority: "backlog",
    nextAction: null,
    originalPriority: "important",
    originalNextAction: null,
  },
]).catch((error: unknown) => error instanceof Error ? error.message : String(error));
JSON.stringify({
  conflict: batchConflict,
  firstUnchanged: (await fs.readFile(fixture.issuePath, "utf8")) === sourceBeforeBatch,
  secondUnchanged: (await fs.readFile(fixture.secondIssuePath, "utf8")).includes("priority: normal"),
})
=> {"conflict":"issue priority changed since the page loaded: bugs/2026-08-13-second.md","firstUnchanged":true,"secondUnchanged":true}

const secondBeforeBatch = await fs.readFile(fixture.secondIssuePath, "utf8");
let renameCalls = 0;
const renameFailure = await saveIssueChanges({
  mainRoot: fixture.root,
  worktreesRoot: fixture.worktreesRoot,
  changes: [
    {
      relPath: "bugs/2026-08-13-example.md",
      visibility: "public",
      priority: "backlog",
      nextAction: null,
      originalPriority: "important",
      originalNextAction: null,
    },
    {
      relPath: "bugs/2026-08-13-second.md",
      visibility: "public",
      priority: "backlog",
      nextAction: null,
      originalPriority: "normal",
      originalNextAction: null,
    },
  ],
  operations: {
    renameFile: async (source, target) => {
      renameCalls += 1;
      if (renameCalls === 2) throw new Error("simulated rename failure");
      await fs.rename(source, target);
    },
  },
}).catch((error: unknown) => error instanceof Error ? error.message : String(error));
const issueDirEntries = await fs.readdir(path.dirname(fixture.issuePath));
JSON.stringify({
  renameCalls,
  failure: renameFailure,
  firstRestored: (await fs.readFile(fixture.issuePath, "utf8")) === sourceBeforeBatch,
  secondRestored: (await fs.readFile(fixture.secondIssuePath, "utf8")) === secondBeforeBatch,
  temporaries: issueDirEntries.filter((name) => name.endsWith(".tmp")).length,
})
=> {"renameCalls":2,"failure":"simulated rename failure","firstRestored":true,"secondRestored":true,"temporaries":0}
```

Saving the private record commits only in the private repository and leaves the
public issue with the same relative path untouched.

```ts continue
const privateSaved = await documents.saveIssueChanges([{
  relPath: "bugs/2026-08-13-example.md",
  visibility: "private",
  priority: "backlog",
  nextAction: null,
  originalPriority: "normal",
  originalNextAction: null,
}]);
const publicAfterPrivateSave = await fs.readFile(fixture.issuePath, "utf8");
const privateAfterSave = await fs.readFile(fixture.privateIssuePath, "utf8");
JSON.stringify({
  privateSaved,
  publicImportant: publicAfterPrivateSave.includes("priority: important"),
  privateBacklog: privateAfterSave.includes("priority: backlog"),
  privateSubject: (await git(fixture.privateRoot, ["log", "-1", "--pretty=%s"])).stdout,
})
=> {"privateSaved":1,"publicImportant":true,"privateBacklog":true,"privateSubject":"Update issue metadata"}
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
path.relative(await fs.realpath(overlayRoot), overlayTarget)
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
await fs.rm(fixture.privateRoot, { recursive: true, force: true });
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
