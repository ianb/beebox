# Jev triage orchestration

The harness uses the same preparation, judgment, research, and application
operations as the CLI. These tests inject deterministic fakes around a real
temporary box; they make no model calls and use only synthetic content.

```ts setup
import * as fs from "node:fs/promises";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { prepareItem } from "../../../../src/core/triage/evidence.js";
import { runJevTriage } from "../../../../src/core/triage/auto/core.js";
import { TriageBudgetError } from "../../../../src/core/triage/judge.js";
import { InvariantError } from "../../../../src/shared/invariant.js";
import type { TriageJudgment } from "../../../../src/core/triage/judge.js";
import type { Evidence } from "../../../../src/core/triage/evidence.js";
import type { InstructionSnapshot } from "../../../../src/core/triage/snapshot.js";

const LANDMARK = `---\nnavigation:\n  label: Records\n  symbol: 📁\ndestinations:\n  - for: [triage]\n    rules: Original filing boundary.\n---\n`;
async function harnessBox(extension = "txt") {
  const box = await makeTmpBox({ git: true });
  await box.write("_content/inbox/staged/Document." + extension, "Initial synthetic evidence.");
  await box.write("_content/records/Records.landmark.card", LANDMARK);
  box.commitAll("synthetic triage fixture");
  return box;
}
async function withoutConsoleError<T>(action: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try { return await action(); }
  finally { console.error = original; }
}
function destinationJudgment(evidence: Evidence, instructions: InstructionSnapshot, outcome: "destination" | "unclear" = "destination"): TriageJudgment {
  const destination = instructions.destinations[0];
  const probabilities = Object.fromEntries([...instructions.destinations.map((item) => [item.optionId, outcome === "destination" && item === destination ? 0.9 : 0]), ["no-match", outcome === "unclear" ? 0.05 : 0.05], ["unclear", outcome === "unclear" ? 0.9 : 0.05]]);
  return { outcome, destinationRef: outcome === "destination" ? destination.ref : null, requestHash: "a".repeat(64), requestedModel: "jev-test", returnedModel: "jev-test",
    answer: { type: "choice", choice: outcome === "destination" ? destination.optionId : "unclear", confidence: outcome === "destination" ? 0.9 : 0.9, probabilities },
    reason: { kind: "summary", text: "Synthetic classifier summary.", evidenceRefs: evidence.parts.map((part) => part.ref) } };
}
```

## Dry run does not research or move

```ts
const box = await harnessBox();
let researchCalls = 0;
const result = await runJevTriage({ boxRoot: box.root, dryRun: true,
  prepare: prepareItem,
  judge: async (_root, input) => destinationJudgment(input.evidence, input.instructions),
  research: async () => { researchCalls += 1; return null; },
});
JSON.stringify({ empty: result.empty, decisions: result.decisions.length, researchCalls, staged: await fs.readFile(box.path("_content/inbox/staged/Document.txt"), "utf8") })
=> {"empty":false,"decisions":1,"researchCalls":0,"staged":"Initial synthetic evidence."}

await box.cleanup();
```

## Research changes evidence and rules, then receives exactly one rejudge

The harness recompiles both inputs after research, judges once more, and only
then applies the decision. This bounds the repair loop and makes the receipt
describe the final evidence and rule snapshot.

```ts
const box = await harnessBox();
const judged: Array<{ text: string; rules: string }> = [];
let researchCalls = 0;
const result = await runJevTriage({ boxRoot: box.root,
  prepare: prepareItem,
  judge: async (_root, input) => {
    judged.push({ text: input.evidence.parts[0].text, rules: input.instructions.destinations[0].rules });
    return destinationJudgment(input.evidence, input.instructions, judged.length === 1 ? "unclear" : "destination");
  },
  research: async () => {
    researchCalls += 1;
    await fs.writeFile(box.path("_content/inbox/staged/Document.txt"), "Researched synthetic evidence.");
    await fs.writeFile(box.path("_content/records/Records.landmark.card"), LANDMARK.replace("Original filing boundary.", "Repaired filing boundary."));
    return { reason: "Research remained unresolved.", evidenceRefs: ["/_content/records/Records.landmark.card"] };
  },
});
JSON.stringify({ judgeCalls: judged.length, researchCalls, firstEvidence: judged[0]?.text, lastEvidence: judged[1]?.text, lastRules: judged[1]?.rules, applied: result.decisions[0]?.application.state,
  reason: result.decisions[0]?.judgment.reason.text, reasonKind: result.decisions[0]?.judgment.reason.kind, evidenceRefs: result.decisions[0]?.judgment.reason.evidenceRefs,
  moved: await fs.readFile(box.path("_content/inbox/triaged/records/Document.txt"), "utf8") })
=> {"judgeCalls":2,"researchCalls":1,"firstEvidence":"Initial synthetic evidence.","lastEvidence":"Researched synthetic evidence.","lastRules":"Repaired filing boundary.","applied":"applied","reason":"Synthetic classifier summary.\n\nResearch note: Research remained unresolved.","reasonKind":"summary","evidenceRefs":["/_content/inbox/staged/Document.txt","/_content/records/Records.landmark.card"],"moved":"Researched synthetic evidence."}

await box.cleanup();
```

## A deterministic item failure is recorded and the next item still runs

```ts
const box = await harnessBox();
await box.write("_content/inbox/staged/Later.txt", "Later synthetic evidence.");
box.commitAll("second staged item");
const result = await withoutConsoleError(() => runJevTriage({ boxRoot: box.root,
  prepare: async (input) => {
    if (input.sourceRef.endsWith("Document.txt")) throw new InvariantError("synthetic stranded attachment scope");
    return prepareItem(input);
  },
  judge: async (_root, input) => destinationJudgment(input.evidence, input.instructions),
  research: async () => null,
}));
JSON.stringify({ failed: result.failed, applied: result.decisions.map((decision) => decision.application.state),
  firstStillStaged: await fs.readFile(box.path("_content/inbox/staged/Document.txt"), "utf8"),
  laterMoved: await fs.readFile(box.path("_content/inbox/triaged/records/Later.txt"), "utf8") })
=> {"failed":[{"file":"Document.txt","error":"synthetic stranded attachment scope"}],"applied":["applied"],"firstStillStaged":"Initial synthetic evidence.","laterMoved":"Later synthetic evidence."}

await box.cleanup();
```

## Wholly unavailable evidence skips Jev and remains held

```ts
const box = await harnessBox("bin");
let judgeCalls = 0;
let researchCalls = 0;
const result = await runJevTriage({ boxRoot: box.root,
  prepare: prepareItem,
  judge: async () => { judgeCalls += 1; throw new Error("unavailable evidence must skip Jev"); },
  research: async () => { researchCalls += 1; return null; },
});
JSON.stringify({ judgeCalls, researchCalls, status: result.decisions[0]?.evidence.status, outcome: result.decisions[0]?.judgment.outcome,
  application: result.decisions[0]?.application.state, held: await fs.readFile(box.path("_content/inbox/triaged/_unsure/Document.bin"), "utf8"), question: await fs.readFile(box.path(result.decisions[0]!.application.questionRef!.slice(1)), "utf8").then((text) => text.includes("no readable evidence")) })
=> {"judgeCalls":0,"researchCalls":1,"status":"unavailable","outcome":"unclear","application":"applied","held":"Initial synthetic evidence.","question":true}

await box.cleanup();
```

## Only quota failures defer; operational errors remain visible

```ts
const quotaBox = await harnessBox();
const quota = await runJevTriage({ boxRoot: quotaBox.root, prepare: prepareItem,
  judge: async () => { throw new TriageBudgetError(); }, research: async () => null,
});
const quotaState = { deferred: quota.deferred.length, decisions: quota.decisions.length,
  sourceRemains: await fs.readFile(quotaBox.path("_content/inbox/staged/Document.txt"), "utf8") };
await quotaBox.cleanup();

const errorBox = await harnessBox();
const operational = await runJevTriage({ boxRoot: errorBox.root, prepare: prepareItem,
  judge: async () => { throw new Error("provider unavailable"); }, research: async () => null,
}).then(() => "unexpected success", (error: Error) => error.message);
const errorSourceRemains = await fs.readFile(errorBox.path("_content/inbox/staged/Document.txt"), "utf8");
await errorBox.cleanup();
JSON.stringify({ quotaState, operational, errorSourceRemains })
=> {"quotaState":{"deferred":1,"decisions":0,"sourceRemains":"Initial synthetic evidence."},"operational":"provider unavailable","errorSourceRemains":"Initial synthetic evidence."}
```
