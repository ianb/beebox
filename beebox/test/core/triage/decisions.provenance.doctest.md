# Recorded triage application

Receipts keep evaluated inputs immutable. Application checks source and instruction
bytes, moves card attachments, scopes its commit, and can retry without a model.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execa } from "execa";
import { pathToFileURL } from "node:url";
import { simpleGit } from "simple-git";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { prepareItem } from "../../../src/core/triage/evidence/core.js";
import { compileInstructionSnapshot } from "../../../src/core/triage/snapshot.js";
import { judgeItem } from "../../../src/core/triage/judge.js";
import { createDecisionReceipt, readDecisionReceipt, saveDecisionReceipt, listDecisionReceipts } from "../../../src/core/triage/decisions/storage.js";
import { applyDecision } from "../../../src/core/triage/decisions/apply.js";
import { confirmDecision, correctDecision } from "../../../src/core/triage/decisions/confirm.js";
import { replayDecisions } from "../../../src/core/triage/decisions/replay.js";
import { createFakeJev } from "../../../src/services/jev.js";
import { getSessionLogPath } from "../../../src/core/chat/session/transcript-paths.js";
import { movePathPreservingAnnexSymlink } from "../../../src/core/card-files/move-phase2.js";
import { parseAnnexPointer } from "../../../src/lib/annex-pointer.js";
async function fixture() {
  const box = await makeTmpBox();
  await box.write("_content/home/Home.landmark.card", "---\nnavigation:\n  label: Home\n  symbol: H\ndestinations:\n  - for: [triage]\n    rules: Household papers.\n---\n");
  await box.write("_content/inbox/staged/Paper.doc.card", "---\ntitle: Paper\n---\nHousehold receipt.");
  await box.write("_content/inbox/staged/Paper.attach/detail.txt", "Household details");
  await simpleGit(box.root).add(".");
  await simpleGit(box.root).commit("Initial admitted paper");
  const evidence = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Paper.doc.card" });
  const instructions = await compileInstructionSnapshot(box.root, {});
  const judgment = await judgeItem(box.root, { evidence, instructions, env: { BBX_JEV_FAKE: "1" } });
  return { box, evidence, instructions, judgment };
}
```

```ts
const { box, evidence, instructions, judgment } = await fixture();
const receipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment });
await box.write("_content/unrelated.md", "Do not claim me");
await simpleGit(box.root).add("_content/unrelated.md");
const applied = await applyDecision({ boxRoot: box.root, decision: receipt });
applied.application.state
=> applied

await fs.readFile(path.join(box.root, "_content/inbox/triaged", "home", "Paper.attach/detail.txt"), "utf8")
=> Household details

const message = await simpleGit(box.root).raw(["log", "-1", "--format=%B"]);
message.includes(`Triage-Decision: ${receipt.id}`) && message.includes("Triage-Probabilities:")
=> true

(await simpleGit(box.root).raw(["diff", "--cached", "--name-only"])).trim()
=> _content/unrelated.md

(await applyDecision({ boxRoot: box.root, decision: receipt.id })).application.state
=> applied

const changed = await readDecisionReceipt(box.root, receipt.id);
changed.evidence.parts[0].text = "Invented replacement";
await saveDecisionReceipt(box.root, changed)
=> throws TriageReceiptError

const before = await fs.readFile(path.join(box.root, `_bookkeeping/triage/decisions/${receipt.id}.json`), "utf8");
const replay = await replayDecisions({ boxRoot: box.root, ids: [receipt.id], instructions, compareOriginal: true, maxCalls: 2, env: { BBX_JEV_FAKE: "1" } });
replay.plannedCalls
=> 2

const reprepared = await replayDecisions({ boxRoot: box.root, ids: [receipt.id], instructions, maxCalls: 1, prepareAgain: true, env: { BBX_JEV_FAKE: "1" } });
reprepared.results[0]?.status
=> evaluated

reprepared.results[0]?.preparationChanged
=> false

await fs.rm(box.path("_content/inbox/triaged/home/Paper.doc.card"));
await fs.rm(box.path("_content/inbox/triaged/home/Paper.attach"), { recursive: true });
const historicalPreparation = await replayDecisions({ boxRoot: box.root, ids: [receipt.id], instructions, maxCalls: 1, prepareAgain: true, env: { BBX_JEV_FAKE: "1" } });
historicalPreparation.results[0]?.status
=> evaluated

const substituted = createFakeJev();
const originalJudge = substituted.judge.bind(substituted);
substituted.judge = async (input) => ({ ...await originalJudge(input), model: "provider-substitute" });
const drift = await replayDecisions({ boxRoot: box.root, ids: [receipt.id], instructions, maxCalls: 1, jev: substituted });
drift.results[0]?.status
=> unavailable

drift.results[0]?.error?.includes("substituted")
=> true

const noModelReceipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...judgment, outcome: "unclear", destinationRef: null, requestHash: null, requestedModel: null, returnedModel: null, answer: null } });
await saveDecisionReceipt(box.root, noModelReceipt);
const mixedReplay = await replayDecisions({ boxRoot: box.root, ids: [noModelReceipt.id, receipt.id], instructions, maxCalls: 1, env: { BBX_JEV_FAKE: "1" } });
mixedReplay.plannedCalls
=> 1

JSON.stringify(mixedReplay.results.map((result) => result.status))
=> ["unavailable","evaluated"]

await fs.readFile(path.join(box.root, `_bookkeeping/triage/decisions/${receipt.id}.json`), "utf8") === before
=> true

await replayDecisions({ boxRoot: box.root, ids: [receipt.id], instructions, compareOriginal: true, maxCalls: 1, env: { BBX_JEV_FAKE: "1" } })
=> throws TriageReceiptError
```

```ts cleanup
await box.cleanup();
```

Fixed evidence remains replayable when a Git-annex object is absent, while
repreparation reports that the original bytes cannot be recovered.

```ts
const annexBox = await makeTmpBox({ git: true });
await annexBox.write("_content/home/Home.landmark.card", "---\nnavigation:\n  label: Home\n  symbol: H\ndestinations:\n  - for: [triage]\n    rules: Household papers.\n---\n");
await simpleGit(annexBox.root).add("_content/home/Home.landmark.card");
await simpleGit(annexBox.root).commit("Add triage instructions");
await annexBox.write("_content/inbox/staged/Paper.doc.card", "---\ntitle: Paper\n---\nHousehold receipt.");
await annexBox.write("_content/inbox/staged/Paper.attach/photo.png", Buffer.from("synthetic image bytes"));
await execa("git", ["annex", "add", "--", "_content/inbox/staged/Paper.attach/photo.png"], { cwd: annexBox.root });
await execa("git", ["annex", "unlock", "--", "_content/inbox/staged/Paper.attach/photo.png"], { cwd: annexBox.root });

const annexEvidence = await prepareItem({ boxRoot: annexBox.root, sourceRef: "/_content/inbox/staged/Paper.doc.card" });
const annexInstructions = await compileInstructionSnapshot(annexBox.root, {});
const annexJudgment = await judgeItem(annexBox.root, { evidence: annexEvidence, instructions: annexInstructions, env: { BBX_JEV_FAKE: "1" } });
const heldJudgment = { ...annexJudgment, outcome: "unclear" as const, destinationRef: null };
const annexReceipt = createDecisionReceipt({ boxRoot: annexBox.root, evidence: annexEvidence, instructions: annexInstructions, judgment: heldJudgment });
await saveDecisionReceipt(annexBox.root, annexReceipt);
await applyDecision({ boxRoot: annexBox.root, decision: annexReceipt.id });
const applicationCommit = (await simpleGit(annexBox.root).raw(["rev-parse", "HEAD"])).trim();
Boolean(parseAnnexPointer(await simpleGit(annexBox.root).binaryCatFile(["blob", `${applicationCommit}:_content/inbox/triaged/_unsure/Paper.attach/photo.png`])))
=> true

const heldPath = annexBox.path("_content/inbox/triaged/_unsure/Paper.doc.card");
const archivePath = annexBox.path("_content/archive/Paper.doc.card");
await fs.mkdir(path.dirname(archivePath), { recursive: true });
await movePathPreservingAnnexSymlink(heldPath, archivePath);
await movePathPreservingAnnexSymlink(annexBox.path("_content/inbox/triaged/_unsure/Paper.attach"), annexBox.path("_content/archive/Paper.attach"));
await simpleGit(annexBox.root).add(".");
await simpleGit(annexBox.root).commit("Handler filed paper after triage");
const selectedAnnexDestination = annexInstructions.destinations[0];
await annexBox.write("_bookkeeping/questions/AnnexConfirm.question.card", `---\nstatus: answered\nanswered-at: '2026-09-28T12:00:00Z'\nanswered-via: web\nanswer:\n  text: Home\n  selected: ${selectedAnnexDestination?.optionId}\n---\n`);
await confirmDecision({ boxRoot: annexBox.root, id: annexReceipt.id, sourceRef: "/_bookkeeping/questions/AnnexConfirm.question.card", label: selectedAnnexDestination?.ref ?? "" });
const annexHistoricalReplay = await replayDecisions({ boxRoot: annexBox.root, ids: [annexReceipt.id], instructions: annexInstructions, maxCalls: 1, prepareAgain: true, env: { BBX_JEV_FAKE: "1" } });
annexHistoricalReplay.results[0]?.status
=> evaluated

annexHistoricalReplay.results[0]?.error ?? "none"
=> none

await execa("git", ["annex", "drop", "--force", "--", "_content/archive/Paper.attach/photo.png"], { cwd: annexBox.root });
const fixedReplay = await replayDecisions({ boxRoot: annexBox.root, ids: [annexReceipt.id], instructions: annexInstructions, maxCalls: 1, env: { BBX_JEV_FAKE: "1" } });
fixedReplay.results[0]?.status
=> evaluated

const missingObjectReplay = await replayDecisions({ boxRoot: annexBox.root, ids: [annexReceipt.id], instructions: annexInstructions, maxCalls: 1, prepareAgain: true, env: { BBX_JEV_FAKE: "1" } });
missingObjectReplay.results[0]?.status
=> unavailable

missingObjectReplay.results[0]?.error?.includes("local Git-annex object is missing")
=> true

```

```ts cleanup
await annexBox.cleanup();
```

Prepare-again can recover an admitted card from its application commit when it
was not present in the preparation revision and has since moved again.

```ts
const freshBox = await makeTmpBox();
await freshBox.write("_content/home/Home.landmark.card", "---\nnavigation:\n  label: Home\n  symbol: H\ndestinations:\n  - for: [triage]\n    rules: Household papers.\n---\n");
await freshBox.write("_content/inbox/staged/New.doc.card", "---\ntitle: New\n---\nNew admitted receipt.");
const freshEvidence = await prepareItem({ boxRoot: freshBox.root, sourceRef: "/_content/inbox/staged/New.doc.card" });
freshEvidence.source.gitRevision
=> null

const freshInstructions = await compileInstructionSnapshot(freshBox.root, {});
const freshJudgment = await judgeItem(freshBox.root, { evidence: freshEvidence, instructions: freshInstructions, env: { BBX_JEV_FAKE: "1" } });
const freshReceipt = createDecisionReceipt({ boxRoot: freshBox.root, evidence: freshEvidence, instructions: freshInstructions, judgment: freshJudgment });
await applyDecision({ boxRoot: freshBox.root, decision: freshReceipt });
await fs.mkdir(freshBox.path("_content/archive"), { recursive: true });
await fs.rename(freshBox.path("_content/inbox/triaged/home/New.doc.card"), freshBox.path("_content/archive/New.doc.card"));
await simpleGit(freshBox.root).add(".");
await simpleGit(freshBox.root).commit("Handler filed new paper");
const freshDestination = freshInstructions.destinations.find((item) => item.ref === freshJudgment.destinationRef);
await freshBox.write("_bookkeeping/questions/FreshConfirm.question.card", `---\nstatus: answered\nanswered-at: '2026-09-28T12:00:00Z'\nanswered-via: web\nanswer:\n  text: Home\n  selected: ${freshDestination?.optionId}\n---\n`);
await confirmDecision({ boxRoot: freshBox.root, id: freshReceipt.id, sourceRef: "/_bookkeeping/questions/FreshConfirm.question.card", label: freshDestination?.ref ?? "" });
const recoveredReplay = await replayDecisions({ boxRoot: freshBox.root, ids: [freshReceipt.id], instructions: freshInstructions, maxCalls: 1, prepareAgain: true, env: { BBX_JEV_FAKE: "1" } });
recoveredReplay.results[0]?.status
=> evaluated

await freshBox.cleanup();
```

```ts cleanup
await freshBox.cleanup();
```

Changed attachments cannot be silently admitted by an old receipt.

```ts
const { box, evidence, instructions, judgment } = await fixture();
const receipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment });
await box.write("_content/inbox/staged/Paper.attach/new.txt", "Added after judgment");
await applyDecision({ boxRoot: box.root, decision: receipt })
=> throws InvariantError

await fs.readFile(path.join(box.root, "_content/inbox/staged/Paper.doc.card"), "utf8") === evidence.parts[0].text
=> true
```

```ts cleanup
await box.cleanup();
```

An answered CLI question is an agent assertion. Missing legacy channel is unknown;
only an actual web answer or cited user turn can enter the confirmed set.

```ts
const { box, evidence, instructions, judgment } = await fixture();
const held = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...judgment, outcome: "unclear", destinationRef: null } });
await applyDecision({ boxRoot: box.root, decision: held });
const questionRef = held.application.questionRef;
const destination = instructions.destinations[0];
await box.write(questionRef.slice(1), `---\nstatus: answered\nanswered-at: '2026-09-28T12:00:00Z'\nanswered-via: cli\nanswer:\n  text: Home\n  selected: ${destination.optionId}\n---\n`);
const corrected = await correctDecision({ boxRoot: box.root, id: held.id, questionRef });
corrected.outcomes[0].actor
=> agent

(await correctDecision({ boxRoot: box.root, id: held.id, questionRef })).id === corrected.id
=> true

corrected.judgment.outcome
=> unclear

corrected.resolution.destinationRef === destination.ref
=> true

(await listDecisionReceipts(box.root, { outcome: "user-confirmed" })).length
=> 0

await box.write("_bookkeeping/questions/Legacy.question.card", `---\nstatus: answered\nanswered-at: '2026-09-28T12:00:00Z'\nanswer:\n  text: Home\n  selected: ${destination.optionId}\n---\n`);
const legacy = await confirmDecision({ boxRoot: box.root, id: corrected.id, sourceRef: "/_bookkeeping/questions/Legacy.question.card", label: destination.ref });
legacy.outcomes.at(-1).actor
=> unknown

await box.write("_bookkeeping/questions/Web.question.card", `---\nstatus: answered\nanswered-at: '2026-09-28T12:00:00Z'\nanswered-via: web\nanswer:\n  text: Home\n  selected: ${destination.optionId}\n---\n`);
await box.write("_bookkeeping/questions/Mismatch.question.card", `---\nstatus: answered\nanswered-at: '2026-09-28T12:00:00Z'\nanswered-via: web\nanswer:\n  text: Not home\n  selected: some-other-option\n---\n`);
await confirmDecision({ boxRoot: box.root, id: corrected.id, sourceRef: "/_bookkeeping/questions/Mismatch.question.card", label: destination.ref })
=> throws TriageReceiptError
await confirmDecision({ boxRoot: box.root, id: corrected.id, sourceRef: "/_bookkeeping/questions/Web.question.card", label: destination.ref });
(await listDecisionReceipts(box.root, { outcome: "user-confirmed" })).length
=> 1

const previousProjectsDir = process.env["BBX_CLAUDE_PROJECTS_DIR"];
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("projects");
const sessionId = "78787878-7878-4787-8787-787878787878";
const turnId = "87878787-8787-4878-8787-878787878787";
const chatRef = `/_content/chat/web/2026-09-28_${sessionId.slice(0, 8)}.chat.card`;
await box.write(chatRef.slice(1), `---\ntype: chat\nsession: ${sessionId}\ntitle: Placement decision\n---\n`);
const transcript = getSessionLogPath(box.root, sessionId);
await fs.mkdir(path.dirname(transcript), { recursive: true });
await fs.writeFile(transcript, `${JSON.stringify({ type: "user", uuid: turnId, timestamp: "2026-09-28T12:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "<typed>Please put this in Home.</typed>" }] } })}\n`);
const humanRef = `${chatRef}#${turnId}`;
(await confirmDecision({ boxRoot: box.root, id: corrected.id, sourceRef: humanRef, label: destination.ref })).outcomes.at(-1)?.actor
=> user

await fs.writeFile(transcript, `${JSON.stringify({ type: "user", uuid: turnId, timestamp: "2026-09-28T12:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "<typed>Yes.</typed>" }] } })}\n`);
await confirmDecision({ boxRoot: box.root, id: corrected.id, sourceRef: humanRef, label: destination.ref })
=> throws TriageReceiptError

await fs.writeFile(transcript, `${JSON.stringify({ type: "user", uuid: turnId, timestamp: "2026-09-28T12:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "<typed>Homeward is the direction I was thinking.</typed>" }] } })}\n`);
await confirmDecision({ boxRoot: box.root, id: corrected.id, sourceRef: humanRef, label: destination.ref })
=> throws TriageReceiptError

if (previousProjectsDir === undefined) delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
else process.env["BBX_CLAUDE_PROJECTS_DIR"] = previousProjectsDir;
```

```ts cleanup
await box.cleanup();
```

Cards without an attachment directory can be applied and corrected; the absent
scope does not turn either operation into an incomplete receipt.

```ts
const { box, instructions } = await fixture();
await fs.rm(box.path("_content/inbox/staged/Paper.attach"), { recursive: true });
await simpleGit(box.root).add(".");
await simpleGit(box.root).commit("Remove optional attachment scope");
const evidence = await prepareItem({ boxRoot: box.root, sourceRef: "/_content/inbox/staged/Paper.doc.card" });
const judgment = await judgeItem(box.root, { evidence, instructions, env: { BBX_JEV_FAKE: "1" } });
const held = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment: { ...judgment, outcome: "unclear", destinationRef: null } });
(await applyDecision({ boxRoot: box.root, decision: held })).application.state
=> applied

const selected = instructions.destinations[0];
await box.write(held.application.questionRef?.slice(1) ?? "", `---\nstatus: answered\nanswered-at: '2026-09-28T12:00:00Z'\nanswered-via: cli\nanswer:\n  text: Home\n  selected: ${selected?.optionId}\n---\n`);
(await correctDecision({ boxRoot: box.root, id: held.id, questionRef: held.application.questionRef ?? "" })).application.state
=> applied

await fs.access(box.path("_content/inbox/triaged/home/Paper.doc.card"))
=> undefined
```

```ts cleanup
await box.cleanup();
```

Interrupted attachment moves and failed commits are explicit and retryable. A
raw sweep without trailers gets a nonempty provenance completion commit.

```ts
const { box, evidence, instructions, judgment } = await fixture();
const receipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment });
await saveDecisionReceipt(box.root, receipt);
await fs.mkdir(path.dirname(box.path(receipt.application.to.slice(1))), { recursive: true });
await fs.rename(box.path(receipt.application.from.slice(1)), box.path(receipt.application.to.slice(1)));
const hook = box.path(".git/hooks/pre-commit");
await fs.writeFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
await applyDecision({ boxRoot: box.root, decision: receipt.id })
=> throws TriageReceiptError

(await readDecisionReceipt(box.root, receipt.id)).application.state
=> incomplete

await fs.rm(hook);
(await applyDecision({ boxRoot: box.root, decision: receipt.id })).application.state
=> applied

await simpleGit(box.root).raw(["commit", "--amend", "-m", "Raw sweep without provenance"]);
await applyDecision({ boxRoot: box.root, decision: receipt.id });
Boolean((await readDecisionReceipt(box.root, receipt.id)).provenanceRepair)
=> true

(await simpleGit(box.root).raw(["log", "-1", "--format=%B"])).includes(`Triage-Decision: ${receipt.id}`)
=> true
```

```ts cleanup
await box.cleanup();
```

Independent processes applying the same decision serialize on the item lock,
produce one application commit, and both observe the completed receipt.

```ts
const { box, evidence, instructions, judgment } = await fixture();
const receipt = createDecisionReceipt({ boxRoot: box.root, evidence, instructions, judgment });
await saveDecisionReceipt(box.root, receipt);
const moduleUrl = pathToFileURL(path.resolve("src/core/triage/decisions/apply.ts")).href;
const script = `import { applyDecision } from ${JSON.stringify(moduleUrl)}; await applyDecision({boxRoot:process.argv[1],decision:process.argv[2]});`;
const results = await Promise.allSettled([1, 2].map(() => execa(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, box.root, receipt.id])));
JSON.stringify(results.map((result) => result.status))
=> ["fulfilled","fulfilled"]

const messages = await simpleGit(box.root).raw(["log", "--format=%B"]);
messages.split(`Triage-Decision: ${receipt.id}`).length - 1
=> 1
```

```ts cleanup
await box.cleanup();
```
