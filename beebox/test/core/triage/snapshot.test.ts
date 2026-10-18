// # Triage policy snapshots and judgment
//
// Filesystem snapshots keep canonical references separate from candidate files.
// The classifier never manufactures missing evidence or prose explanations.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { compileInstructionSnapshot } from "../../../src/core/triage/snapshot.js";
import { judgeItem } from "../../../src/core/triage/judge.js";
import { serializeTriageRequest } from "../../../src/core/triage/request.js";
import { JEV_MAX_REQUEST_CHARS } from "../../../src/services/jev-wire.js";
import { createFakeJev } from "../../../src/services/jev.js";
import type { Evidence } from "../../../src/core/triage/evidence/core.js";
import { invariant } from "../../../src/shared/invariant.js";
import { fixedAnswer } from "../../../src/core/judgment/service.js";

void test("line 20", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L21
  const box = await makeTmpBox();
  const landmark = (rule: string) => `---\nsymbol:\n  glyph: 📁\nnavigation:\n  label: Records\ndestinations:\n  - for: [triage]\n    rules: ${rule}\n---\n`;
  await box.write("_content/a/records/Records.landmark.card", landmark("Bank statements."));
  await box.write("_content/b/records/Records.landmark.card", landmark("Repair invoices."));
  const initial = await compileInstructionSnapshot(box.root);
  t.check(initial.destinations.map((d) => d.name).join(","), "records,b-records");

  // doctest:L29
  await t.checkText(new Set(initial.destinations.map((d) => d.optionId)).size, "2");

  // doctest:L32
  await t.checkText(initial.policy.includes("No intake guide exists"), "true");

  // doctest:L35
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
  await t.checkText(normal.policy.includes("basis: user-stated") && normal.policy.includes("Shared household"), "true");

  // doctest:L56
  await t.checkText(normal.policy.includes("Trial financial") || normal.policy.includes("Old irrelevant") || normal.policy.includes("Never classify"), "false");

  // doctest:L59
  const overlay = path.join(box.root, "candidate.guide.card");
  await fs.copyFile(path.join(box.root, "_config/intake.guide.card"), overlay);
  const trial = await compileInstructionSnapshot(box.root, { guideOverlay: overlay });
  await t.checkText(trial.trial && trial.policy.includes("trial hypothesis") && trial.policy.includes("Trial financial"), "true");

  // doctest:L65
  const firstDestination = normal.destinations[0];
  invariant(firstDestination, "fixture compiles destinations");
  const candidate = path.join(box.root, "candidate.landmark.card");
  await fs.writeFile(candidate, landmark("All maintenance invoices."));
  const changed = await compileInstructionSnapshot(box.root, { landmarkOverlays: { [firstDestination.ref]: candidate } });
  await t.checkText(changed.destinations[0]?.optionId === firstDestination.optionId, "true");

  // doctest:L73
  t.check(changed.destinations[0]?.rules, "All maintenance invoices.");

  // doctest:L76
  t.check((await compileInstructionSnapshot(box.root)).destinations[0]?.rules, "Bank statements.");

  // doctest:L79
  await box.write("_content/a/records/Records.landmark.card", "broken landmark");
  await t.checkThrows(async () => (await compileInstructionSnapshot(box.root)), "TriageInstructionsError: Invalid landmark fields: /_content/a/records/Records.landmark.card");

  // doctest:L83
  await box.write("_content/a/records/Records.landmark.card", landmark("Bank statements."));
  await box.write("_config/intake.guide.card", "not a guide");
  await t.checkThrows(async () => (await compileInstructionSnapshot(box.root)), "TriageInstructionsError: Invalid guide fields: /_config/intake.guide.card");

  // ## Pure judgment, ties and reserved outcomes

  // doctest:L92
  const evidence: Evidence = { version: 1, source: { ref: "/_content/inbox/staged/input.txt", digest: "a".repeat(64), gitRevision: null, attachmentRef: null }, status: "ready", parts: [{ ref: "/_content/inbox/staged/input.txt", digest: "a".repeat(64), mediaType: "text/plain", method: "native-text", toolVersion: "1", status: "ready", text: "Bank statement", omissions: [] }], recipe: { adapterVersion: 1, steps: ["native text"], maxTextChars: 1000 } };
  const uncertain = createFakeJev();
  const tied = await judgeItem(box.root, { evidence, instructions: normal, jev: uncertain });
  t.check(tied.outcome, "unclear");

  // doctest:L98
  await t.checkText(tied.reason.kind === "summary" && tied.reason.text.includes("tied leading options"), "true");

  // doctest:L101
  t.check(tied.requestHash?.length, 64);

  // doctest:L104
  await t.checkText(uncertain.judgeCalls.length, "1");

  // doctest:L107
  const decisive = createFakeJev({ answers: (_name, { question }) => fixedAnswer(question, { yes: true }) });
  const selected = await judgeItem(box.root, { evidence, instructions: normal, jev: decisive });
  await t.checkText(selected.destinationRef === firstDestination.ref, "true");

  // doctest:L112
  t.check(selected.outcome, "destination");

  // doctest:L115
  const none = createFakeJev({ answers: (_name, { question }) => ({ type: "choice", choice: "no-match", confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map((key) => [key, key === "no-match" ? 1 : 0])) }) });
  t.check((await judgeItem(box.root, { evidence, instructions: normal, jev: none })).outcome, "no-match");

  // doctest:L119
  await t.checkThrows(async () => (await judgeItem(box.root, { evidence: { ...evidence, status: "unavailable" }, instructions: normal, jev: decisive })), "TriageJudgmentError: Evidence unavailable: prepare or research the source before judging");

  // doctest:L122
  await t.checkText(decisive.judgeCalls.length, "1");

  // doctest:L125
  const budget: { calls: number } = JSON.parse(await fs.readFile(path.join(box.root, ".beebox/jev-budget.json"), "utf8"));
  t.check(budget.calls, 3);

  // doctest:L129
  // Size uses the exact serialized request, including escaped policy and rules,
  // and rejects before the fake provider or daily budget reservation.
  const escapedPolicy = { ...normal, policy: '"'.repeat(40_000) };
  await t.checkText(serializeTriageRequest({ evidence, instructions: escapedPolicy }).length > JEV_MAX_REQUEST_CHARS, "true");

  // doctest:L135
  t.check(await (async () => { const fake = createFakeJev(); let error = ""; try { await judgeItem(box.root, { evidence, instructions: escapedPolicy, jev: fake }); } catch (caught) { error = String(caught); } return error.includes("Serialized Jev request exceeds the supported request size") && fake.judgeCalls.length === 0; })(), true);

  // doctest:L138
  t.check(JSON.parse(await fs.readFile(path.join(box.root, ".beebox/jev-budget.json"), "utf8")).calls, 3);
});
