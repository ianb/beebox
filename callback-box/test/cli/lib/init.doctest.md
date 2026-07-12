# Box Init Command

Tests that `cb init` creates the full box structure and commits everything in one initial commit — including schedules, procedures, guides, and personality cards.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { installProcedures, installGuides, installSchedules, installPersonality } from "../../../src/core/box/index.js";
import { scaffoldV2Box } from "../../../src/core/box/package.js";
import { stageAll, commit, getLog, getStatus, isRepo, initRepo } from "../../../src/lib/git.js";

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "cb-init-test-"));
}

// Simulate what `cb init` does on a fresh path: scaffold the v2 package +
// operational box, run the card installers on the box root, then git init +
// single commit at the PACKAGE root (the git root for a v2 box). Returns both
// roots — content-level files live under `boxRoot`, git lives at `packageRoot`.
async function fullInit(target) {
  const { packageRoot, boxRoot } = await scaffoldV2Box(target);
  await installProcedures(boxRoot);
  await installGuides(boxRoot);
  await installSchedules(boxRoot);
  await installPersonality(boxRoot);
  await initRepo(packageRoot, "main");
  await stageAll(packageRoot);
  await commit(packageRoot, {
    message: "Initialize callback box",
    trailers: { "Created-By": "cb init" },
  });
  return { packageRoot, boxRoot };
}

async function listFiles(root, subdir) {
  const dir = path.join(root, subdir);
  try {
    const entries = await fs.readdir(dir);
    return entries.filter(e => !e.startsWith(".")).sort().join("\n");
  } catch {
    return "(not found)";
  }
}
```

## Full init includes schedules in the commit

After a fresh init, schedule files should be committed (not just on disk):

```ts
const tmp = await makeTmpDir();
const { packageRoot, boxRoot } = await fullInit(tmp);

await listFiles(boxRoot, "config/schedules")
=>
check-calendar.scheduled-script.card
check-email.scheduled-script.card
gc-procedure-runs.scheduled-script.card
process-retrospective.scheduled-script.card
refresh-maps.scheduled-script.card
```

The working tree is clean — everything is committed, nothing left untracked:

```ts continue
const status = await getStatus(packageRoot);
status.clean
=> true
```

There's exactly one commit with the right subject:

```ts continue
const log = await getLog(packageRoot, 5);
log.length
=> 1

log[0].subject
=> Initialize callback box
```

```ts cleanup
await fs.rm(tmp, { recursive: true, force: true });
```

## Procedures and guides are also committed

```ts
const tmp = await makeTmpDir();
const { packageRoot, boxRoot } = await fullInit(tmp);

await listFiles(boxRoot, "config/procedures")
=>
process-pages.procedure.card
process-retrospective.procedure.card
refresh-maps.procedure.card
view-card-shape.procedure.card
```

```ts continue
await listFiles(boxRoot, "config")
=>
calendar.guide.card
connectors
intake.guide.card
main.personality.card
migrations.jsonl
procedures
schedules
schemas
template-versions.json
transcription.json
```

```ts continue
const status = await getStatus(packageRoot);
status.clean
=> true
```

```ts cleanup
await fs.rm(tmp, { recursive: true, force: true });
```

## Git repo is initialized

```ts
const tmp = await makeTmpDir();
const { packageRoot } = await fullInit(tmp);

await isRepo(packageRoot)
=> true
```

```ts cleanup
await fs.rm(tmp, { recursive: true, force: true });
```
