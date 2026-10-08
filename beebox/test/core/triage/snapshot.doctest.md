# Triage policy snapshots and judgment

Filesystem snapshots keep canonical references separate from candidate files.
The classifier never manufactures missing evidence or prose explanations.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { compileInstructionSnapshot } from "../../../src/core/triage/snapshot.js";
import { judgeItem } from "../../../src/core/triage/judge.js";
import { serializeTriageRequest } from "../../../src/core/triage/request.js";
import { JEV_MAX_REQUEST_CHARS } from "../../../src/services/jev-wire.js";
import { createFakeJev } from "../../../src/services/jev.js";
import { fixedAnswer } from "../../../src/core/judgment/service.js";
```

```ts
const box = await makeTmpBox();
const landmark = (rule) => `---\nnavigation:\n  label: Records\n  symbol: 📁\ndestinations:\n  - for: [triage]\n    rules: ${rule}\n---\n`;
await box.write("_content/a/records/Records.landmark.card", landmark("Bank statements."));
await box.write("_content/b/records/Records.landmark.card", landmark("Repair invoices."));
const initial = await compileInstructionSnapshot(box.root);
initial.destinations.map((d) => d.name).join(",")
=> records,b-records

new Set(initial.destinations.map((d) => d.optionId)).size
=> 2

initial.policy.includes("No intake guide exists")
=> true

await box.write("_config/intake.guide.card", `---
triage-rules:
  - text: Always prefer user boundaries.
    basis: user-stated
    confidence: high
  - text: Trial financial priority.
    confidence: hypothesis
context-notes:
  - text: Shared household administration.
    duration: ongoing
  - text: Old irrelevant fact.
    duration: past
actions:
  - name: Unrelated task
    instructions: Never classify with this text.
---
`);
const normal = await compileInstructionSnapshot(box.root);
normal.policy.includes("basis: user-stated") && normal.policy.includes("Shared household")
=> true

normal.policy.includes("Trial financial") || normal.policy.includes("Old irrelevant") || normal.policy.includes("Never classify")
=> false

const overlay = path.join(box.root, "candidate.guide.card");
await fs.copyFile(path.join(box.root, "_config/intake.guide.card"), overlay);
const trial = await compileInstructionSnapshot(box.root, { guideOverlay: overlay });
trial.trial && trial.policy.includes("trial hypothesis") && trial.policy.includes("Trial financial")
=> true

const candidate = path.join(box.root, "candidate.landmark.card");
await fs.writeFile(candidate, landmark("All maintenance invoices."));
const changed = await compileInstructionSnapshot(box.root, { landmarkOverlays: { [normal.destinations[0].ref]: candidate } });
changed.destinations[0].optionId === normal.destinations[0].optionId
=> true

changed.destinations[0].rules
=> All maintenance invoices.

(await compileInstructionSnapshot(box.root)).destinations[0].rules
=> Bank statements.

await box.write("_content/a/records/Records.landmark.card", "broken landmark");
await compileInstructionSnapshot(box.root)
=> throws TriageInstructionsError: Invalid landmark fields: /_content/a/records/Records.landmark.card

await box.write("_content/a/records/Records.landmark.card", landmark("Bank statements."));
await box.write("_config/intake.guide.card", "not a guide");
await compileInstructionSnapshot(box.root)
=> throws TriageInstructionsError: Invalid guide fields: /_config/intake.guide.card
```

## Pure judgment, ties and reserved outcomes

```ts continue
const evidence = { version: 1, source: { ref: "/_content/inbox/staged/input.txt", digest: "a".repeat(64), gitRevision: null, attachmentRef: null }, status: "ready", parts: [{ ref: "/_content/inbox/staged/input.txt", digest: "a".repeat(64), mediaType: "text/plain", method: "native-text", toolVersion: "1", status: "ready", text: "Bank statement", omissions: [] }], recipe: { adapterVersion: 1, steps: ["native text"], maxTextChars: 1000 } };
const uncertain = createFakeJev();
const tied = await judgeItem(box.root, { evidence, instructions: normal, jev: uncertain });
tied.outcome
=> unclear

tied.reason.kind === "summary" && tied.reason.text.includes("tied leading options")
=> true

tied.requestHash.length
=> 64

uncertain.judgeCalls.length
=> 1

const decisive = createFakeJev({ answers: (_name, { question }) => fixedAnswer(question, { yes: true }) });
const selected = await judgeItem(box.root, { evidence, instructions: normal, jev: decisive });
selected.destinationRef === normal.destinations[0].ref
=> true

selected.outcome
=> destination

const none = createFakeJev({ answers: (_name, { question }) => ({ type: "choice", choice: "no-match", confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map((key) => [key, key === "no-match" ? 1 : 0])) }) });
(await judgeItem(box.root, { evidence, instructions: normal, jev: none })).outcome
=> no-match

await judgeItem(box.root, { evidence: { ...evidence, status: "unavailable" }, instructions: normal, jev: decisive })
=> throws TriageJudgmentError: Evidence unavailable: prepare or research the source before judging

decisive.judgeCalls.length
=> 1

const budget = JSON.parse(await fs.readFile(path.join(box.root, ".beebox/jev-budget.json"), "utf8"));
budget.calls
=> 3

// Size uses the exact serialized request, including escaped policy and rules,
// and rejects before the fake provider or daily budget reservation.
const escapedPolicy = { ...normal, policy: '"'.repeat(40_000) };
serializeTriageRequest({ evidence, instructions: escapedPolicy }).length > JEV_MAX_REQUEST_CHARS
=> true

await (async () => { const fake = createFakeJev(); let error = ""; try { await judgeItem(box.root, { evidence, instructions: escapedPolicy, jev: fake }); } catch (caught) { error = String(caught); } return error.includes("Serialized Jev request exceeds the supported request size") && fake.judgeCalls.length === 0; })()
=> true

JSON.parse(await fs.readFile(path.join(box.root, ".beebox/jev-budget.json"), "utf8")).calls
=> 3
```

```ts cleanup
await box.cleanup();
```
