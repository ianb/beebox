# Box Init Command

Tests that `cb init` creates the full box structure and commits everything in one initial commit — including schedules, procedures, guides, and personality cards.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { initBox, installProcedures, installGuides, installSchedules, installPersonality } from "../src/core/box.js";
import { stageAll, commit, getLog, getStatus, isRepo } from "../src/cli/lib/git.js";

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "cb-init-test-"));
}

// Simulate what `cb init` does: initBox + installs + single commit
async function fullInit(target) {
  await initBox(target);
  await installProcedures(target);
  await installGuides(target);
  await installSchedules(target);
  await installPersonality(target);
  await stageAll(target);
  await commit(target, {
    message: "Initialize callback box",
    trailers: { "Created-By": "cb init" },
  });
  return target;
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

```
const tmp = await makeTmpDir();
await fullInit(tmp);

await listFiles(tmp, "config/schedules")
=>
check-calendar.scheduled-script.card
check-email.scheduled-script.card
refresh-maps.scheduled-script.card
```

The working tree is clean — everything is committed, nothing left untracked:

``` continue
const status = await getStatus(tmp);
status.clean
=> true
```

There's exactly one commit with the right subject:

``` continue
const log = await getLog(tmp, 5);
log.length
=> 1

log[0].subject
=> Initialize callback box
```

``` cleanup
await fs.rm(tmp, { recursive: true, force: true });
```

## Procedures and guides are also committed

```
const tmp = await makeTmpDir();
await fullInit(tmp);

await listFiles(tmp, "config/procedures")
=>
process-captures.procedure.card
process-guidance.procedure.card
process-pages.procedure.card
refresh-maps.procedure.card
```

``` continue
await listFiles(tmp, "config")
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

``` continue
const status = await getStatus(tmp);
status.clean
=> true
```

``` cleanup
await fs.rm(tmp, { recursive: true, force: true });
```

## Git repo is initialized

```
const tmp = await makeTmpDir();
await fullInit(tmp);

await isRepo(tmp)
=> true
```

``` cleanup
await fs.rm(tmp, { recursive: true, force: true });
```
