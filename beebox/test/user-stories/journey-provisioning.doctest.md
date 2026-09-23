# Journey fixture boundaries

A collected but unreported walk still blocks a new run, without deleting its evidence.
Even notes from a failed preparation (no before snapshot) must be read first.

```ts setup
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeProjectDir } from '../../src/core/chat/session/transcript-paths.ts';
import { assertPreviousRunsReported, allocateRun } from '../../user-stories/journeys/provisioning.ts';
```

```ts
const root = mkdtempSync(join(tmpdir(), 'journey-provision-'));
const previousProjects = process.env.BBX_CLAUDE_PROJECTS_DIR;
const projects = join(root, 'claude-projects');
process.env.BBX_CLAUDE_PROJECTS_DIR = projects;
const work = join(root, 'work');
const boxes = join(root, 'boxes');
const spec = join(root, 'C-reconnection');
const prior = join(work, 'C-reconnection-2026-09-20');
mkdirSync(prior, { recursive: true });
mkdirSync(join(spec, 'reports'), { recursive: true });
writeFileSync(join(prior, 'notes.md'), 'I tried it.');
writeFileSync(join(prior, 'after.json'), '{}');
assertPreviousRunsReported({ work, journeyDir: spec, id: 'C-reconnection' })
=> throws UnreportedJourneyError

existsSync(join(prior, 'notes.md'))
=> true

writeFileSync(join(spec, 'reports', '2026-09-20.md'), '');
assertPreviousRunsReported({ work, journeyDir: spec, id: 'C-reconnection' })
=> throws UnreportedJourneyError

writeFileSync(join(spec, 'reports', '2026-09-20.md'), 'Reviewed the evidence.');
assertPreviousRunsReported({ work, journeyDir: spec, id: 'C-reconnection' });
mkdirSync(join(boxes, 'c-reconnection-2026-09-20-2'), { recursive: true });
const allocated = allocateRun({ work, boxes, id: 'C-reconnection', date: '2026-09-20' });
allocated.boxSlug
=> c-reconnection-2026-09-20-3

existsSync(allocated.boxDir)
=> false

// A transcript can survive a deleted box; its directory must also reserve the slug.
const retainedTranscript = join(projects, encodeProjectDir(allocated.boxDir));
mkdirSync(retainedTranscript, { recursive: true });
writeFileSync(join(retainedTranscript, 'old-session.jsonl'), '{"type":"user"}');
allocateRun({ work, boxes, id: 'C-reconnection', date: '2026-09-20' }).boxSlug
=> c-reconnection-2026-09-20-4

existsSync(join(retainedTranscript, 'old-session.jsonl'))
=> true

allocateRun({ work, boxes, id: '../real-box' })
=> throws InvalidJourneyIdError
```

```ts cleanup
if (previousProjects === undefined) delete process.env.BBX_CLAUDE_PROJECTS_DIR;
else process.env.BBX_CLAUDE_PROJECTS_DIR = previousProjects;
rmSync(root, { recursive: true, force: true });
```
