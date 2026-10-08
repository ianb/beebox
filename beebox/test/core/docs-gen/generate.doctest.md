# `generateDocs`'s template-sync commit

`commitTemplateSyncChanges` (in `src/core/docs-gen/generate/core.ts`) runs at the box
root and filters `git status` output through `isTemplateManagedPath`
(`src/core/install-template-file.ts`) before committing — so only files the
`install*`/`generateRules` helpers actually manage get swept up, leaving any
other in-progress user work untouched.

shapeVersion 3 has one root, so every git-status path `getStatus` reports is
already box-root-relative — no prefix normalization needed. This doctest
exercises the sync commit directly against a minimal fixture, without also
going through the full `generateDocs` pipeline (which would also install a
real, executable `.git/hooks/pre-commit` that shells out to a `bbx` binary —
an unrelated hazard in a repo-in-a-repo dev/test environment).

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { commitTemplateSyncChanges, generateDocs } from "../../../src/core/docs-gen/generate/core.js";
import { isTemplateManagedPath } from "../../../src/core/install-template-file.js";
import { getStatus, getLog } from "../../../src/lib/git/core/operations.js";
```

## Template-managed files get committed; an unrelated dirty file doesn't

Simulate what the `install*` helpers would have dirtied: a box-root template
(`_config/template-versions.json`, already tracked by the scaffold's init
commit) — plus one unrelated new file a boxholder is mid-edit on.

```ts
const box = await makeTmpBox({ git: true });
await box.write("_config/template-versions.json", '{"changed":true}\n');
await box.write("notes.md", "unrelated dirty file\n");

const before = await getStatus(box.root);
JSON.stringify(before.modified)
=> ["_config/template-versions.json"]

JSON.stringify(before.untracked)
=> ["notes.md"]
```

`commitTemplateSyncChanges` commits the modified template file and leaves the
unrelated one untouched — untracked, uncommitted:

```ts continue
await commitTemplateSyncChanges(box.root);

const status = await getStatus(box.root);
status.clean
=> false

JSON.stringify(status.modified)
=> []

JSON.stringify(status.untracked)
=> ["notes.md"]
```

The commit lands with the expected subject and trailer:

```ts continue
const log = await getLog(box.root, 1);
log[0].subject
=> Sync templates from upstream

JSON.stringify(log[0].trailers)
=> {"Triggered-By":"generateDocs"}
```

```ts cleanup
await box.cleanup();
```

## One generation commits all of its tracked output

`generateDocs` writes tracked output after the template sync: the guide
rules, the exposition rules, `_content/briefing.md`, `AGENTS.md`, the
`.agents/skills/` mirrors, and `.codex/hooks.json`. The commit runs once, after
the last of these, so none is left dirty or untracked
(`issues/closed/bugs/2026-10-08-template-sync-commit-precedes-agent-skill-mirrors.md`).
A briefing card edit is the case journey walks hit: the compiled
`_content/briefing.md` changed and stayed uncommitted.

```ts
const genBox = await makeTmpBox({ git: true });
await generateDocs(genBox.root, { force: true });
const card = await genBox.read("_content/briefing.briefing.card");
await genBox.write("_content/briefing.briefing.card", `${card}\n- Lending reminders go out on Fridays.\n`);
genBox.commitAll("edit briefing");
await generateDocs(genBox.root, { force: true });

const after = await getStatus(genBox.root);
[...after.staged, ...after.modified, ...after.untracked].filter((p) => isTemplateManagedPath(p))
=> []

(await getLog(genBox.root, 1))[0].subject
=> Sync templates from upstream
```

```ts cleanup
await genBox.cleanup();
```
