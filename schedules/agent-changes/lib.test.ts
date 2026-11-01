import assert from "node:assert/strict";
import test from "node:test";
import { formatBriefing, hasWork, isAgentSurface, issueTitle, OWN_OUTPUT } from "./lib.ts";

test("isAgentSurface: a generator outside docs-gen counts", () => {
  assert.equal(isAgentSurface("beebox/src/core/views/doc/core.ts"), true);
  assert.equal(isAgentSurface("beebox/src/core/chat/voice-doc.ts"), true);
});

test("isAgentSurface: internal code and the frontend do not count", () => {
  assert.equal(isAgentSurface("beebox/src/frontend/src/App.tsx"), false);
  assert.equal(isAgentSurface("beebox/docs/plans/agent-changes.md"), false);
});

test("isAgentSurface: the curator's own doc does not wake it, though its neighbors do", () => {
  assert.equal(isAgentSurface(OWN_OUTPUT), false);
  assert.equal(isAgentSurface("beebox/docs/box/todos.md"), true);
});

test("hasWork: an unlanded branch is work with no new landings", () => {
  assert.equal(hasWork({ landings: [], closedIssues: [], unlanded: [] }), false);
  assert.equal(hasWork({ landings: [], closedIssues: [], unlanded: ["abc entry"] }), true);
});

test("issueTitle: reads a quoted title, and falls back to the path", () => {
  assert.equal(issueTitle({ path: "p.md", source: '---\ntitle: "A thing"\n---\n' }), "A thing");
  assert.equal(issueTitle({ path: "p.md", source: "no frontmatter" }), "p.md");
});

test("formatBriefing: names the unlanded commits only when there are some", () => {
  const base = { landings: [], closedIssues: [], previous: "a".repeat(40), head: "b".repeat(40) };
  assert.equal(formatBriefing({ ...base, unlanded: [] }).includes("bin/land"), false);
  assert.equal(formatBriefing({ ...base, unlanded: ["abc entry"] }).includes("bin/land"), true);
});
