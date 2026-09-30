# Optional destination follow-up questions

A landmark can request a per-item yes/no judgment. Destinations without a
question do not consume binary questions, and every configured question shares
the destination classification call and its immutable evidence.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { compileInstructionSnapshot } from "../../../src/core/triage/snapshot.js";
import { compileTriageInstructions } from "../../../src/core/triage/instructions.js";
import { buildTriageRequest, judgeItem } from "../../../src/core/triage/judge.js";
import { LandmarkDestination } from "../../../src/schemas/landmark.js";
import { createFakeJev } from "../../../src/services/jev.js";
import { fixedAnswer } from "../../../src/core/judgment/service.js";
```

```ts
const box = await makeTmpBox();
await box.write("_content/bills/Bills.landmark.card", `---
destinations:
  - for: [triage]
    rules: Household bills and payment confirmations.
    todo-question: Does this bill still need payment or investigation?
---
`);
await box.write("_content/records/Records.landmark.card", `---
destinations:
  - for: [triage]
    rules: Records kept only for reference.
---
`);
const snapshot = await compileInstructionSnapshot(box.root);
const bills = snapshot.destinations.find((destination) => destination.name === "bills");
const records = snapshot.destinations.find((destination) => destination.name === "records");
bills.todoQuestion
=> Does this bill still need payment or investigation?

records.todoQuestion === undefined
=> true

const compiled = await compileTriageInstructions(box.root);
const category = compiled.categories.find((destination) => destination.name === "bills");
category.todoQuestion === bills.todoQuestion && category.landmarkRef === bills.ref && compiled.doc.includes(bills.todoQuestion)
=> true

LandmarkDestination.safeParse({ for: ["triage"], "todo-question": "   " }).success
=> false

LandmarkDestination.parse({ for: ["triage"], "todo-question": " Does this need attention? " })["todo-question"]
=> Does this need attention?

const evidence = { version: 1, source: { ref: "/_content/inbox/staged/Bill.memo.card", digest: "a".repeat(64), gitRevision: null, attachmentRef: null }, status: "ready", parts: [{ ref: "/_content/inbox/staged/Bill.memo.card", digest: "a".repeat(64), mediaType: "text/plain", method: "native-text", toolVersion: "1", status: "ready", text: "Household utility bill: payment is outstanding.", omissions: [] }], recipe: { adapterVersion: 1, steps: ["native text"], maxTextChars: 1000 } };
const request = buildTriageRequest({ evidence, instructions: snapshot });
Object.keys(request.questions).length
=> 2

request.questions[`todo_${bills.optionId}`].type
=> noul

request.questions[`todo_${records.optionId}`] === undefined
=> true

const yes = createFakeJev({ answers: (name, { question }) => name === "destination" ? fixedAnswer(question, { yes: true }) : { type: "noul", probability: 0.9 } });
const judgment = await judgeItem(box.root, { evidence, instructions: snapshot, jev: yes });
judgment.destinationRef === bills.ref && judgment.todoAnswers[bills.optionId] === 0.9
=> true

yes.judgeCalls.length
=> 1

const no = createFakeJev({ answers: (name, { question }) => name === "destination" ? fixedAnswer(question, { yes: true }) : { type: "noul", probability: 0.1 } });
const negative = await judgeItem(box.root, { evidence, instructions: snapshot, jev: no });
negative.todoAnswers[bills.optionId]
=> 0.1

// Preparation-only judgments may lack answers; an evaluated configured
// question cannot silently disappear from the provider result.
const missing = { ...yes, judge: async (input) => {
  const result = await yes.judge(input);
  delete result.answers[`todo_${bills.optionId}`];
  return result;
} };
await judgeItem(box.root, { evidence, instructions: snapshot, jev: missing })
=> throws TriageJudgmentError: Jev returned a missing or invalid destination todo answer

// Historical/no-question snapshots retain a destination-only request shape.
const withoutQuestions = { ...snapshot, destinations: snapshot.destinations.map(({ todoQuestion, ...destination }) => destination) };
Object.keys(buildTriageRequest({ evidence, instructions: withoutQuestions }).questions).join(",")
=> destination

const old = await judgeItem(box.root, { evidence, instructions: withoutQuestions, jev: createFakeJev({ answers: (_name, { question }) => fixedAnswer(question, { yes: true }) }) });
old.todoAnswers === undefined
=> true
```

```ts cleanup
await box.cleanup();
```
