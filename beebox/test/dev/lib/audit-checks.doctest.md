# Knowledge-audit response checks

Positive regex checks express a required relationship without pinning one
model's exact prose. The temp-file check accepts optional words between the
negation and `host /tmp`, while still rejecting an answer that recommends it.

```ts setup
import { runChecks } from "../../../src/dev/lib/audit-checks.js";
import { auditTestSchema } from "../../../src/dev/lib/test-suite-schema.js";
import type { AgentBehavior, AuditTest } from "../../../src/dev/lib/test-runner/runner.js";

const auditTest: AuditTest = {
  id: "temp",
  prompt: "Where does scratch go?",
  expected_level: "knows_directly",
  watch_for: "Reject host temp",
  correct_matches: ["\\b(?:not|never)\\b(?:\\W+\\w+){0,2}\\W+host\\W+/tmp\\b"],
};

function behavior(responseText: string): AgentBehavior {
  return {
    filesRead: [], searches: [], bashCommands: [], bashRawCommands: [],
    responseText, responseLength: responseText.split(/\s+/).length, context: null,
  };
}
```

```ts
const good = runChecks(auditTest, {
  behavior: behavior("Use box tmp/, not the host `/tmp`."),
  newOrModifiedCards: new Map(),
});
const bad = runChecks(auditTest, {
  behavior: behavior("Use the host /tmp."),
  newOrModifiedCards: new Map(),
});
const misleading = runChecks(auditTest, {
  behavior: behavior("Note that the host /tmp is available but not swept."),
  newOrModifiedCards: new Map(),
});
JSON.stringify({
  good: good.matchesChecks[0],
  bad: bad.matchesChecks[0]?.found,
  misleading: misleading.matchesChecks[0]?.found,
})
=> {"good":{"pattern":"\\b(?:not|never)\\b(?:\\W+\\w+){0,2}\\W+host\\W+/tmp\\b","found":true,"matched":"not the host `/tmp"},"bad":false,"misleading":false}
```

Equivalent generated guidance surfaces can satisfy one navigation check. This
lets Claude read a generated card doc while Codex reads its generated rule
skill without weakening the expected knowledge.

```ts
const alternateSource = runChecks({
  ...auditTest,
  should_read_any: ["node_modules/beebox/box-docs/card-image.md", "beebox-rule-card-image/SKILL.md"],
}, {
  behavior: { ...behavior("answer"), filesRead: [".agents/skills/beebox-rule-card-image/SKILL.md"] },
  newOrModifiedCards: new Map(),
});
JSON.stringify(alternateSource.shouldReadAnyCheck)
=> {"files":["node_modules/beebox/box-docs/card-image.md","beebox-rule-card-image/SKILL.md"],"wasRead":true,"matched":"beebox-rule-card-image/SKILL.md"}
```

Regexes are rejected at the YAML schema boundary before an audit spends an
agent run. Empty patterns are also invalid because they match every response.

```ts
const invalid = auditTestSchema.safeParse({
  ...auditTest,
  correct_matches: ["("],
  response_not_matches: [""],
});
invalid.success
=> false
```

`should_search` asks whether the agent looked something up. A web lookup is a
WebSearch or WebFetch in the recorded searches (the Codex runner records its
provider searches under `WebSearch`), a box lookup is a `bbx search` command,
and `any` takes either. A `grep` is a search but not a lookup either way.

```ts
function searched(where: "web" | "box" | "any", observed: Partial<AgentBehavior>) {
  const check = runChecks({ ...auditTest, correct_matches: [], should_search: where }, {
    behavior: { ...behavior("answer"), ...observed },
    newOrModifiedCards: new Map(),
  }).shouldSearchCheck;
  return check?.found === true ? `yes: ${check.matched ?? ""}` : "no";
}
const web = { searches: [{ tool: "WebFetch", summary: "https://example.com/release" }] };
const box = { bashRawCommands: ["bbx search \"kitchen renovation budget\""] };
const grep = { searches: [{ tool: "Grep", summary: "kitchen in ." }], bashRawCommands: ["grep -r kitchen _content"] };
JSON.stringify({
  webAsWeb: searched("web", web),
  boxAsWeb: searched("web", box),
  boxAsBox: searched("box", box),
  grepAsAny: searched("any", grep),
  webAsAny: searched("any", web),
})
=> {"webAsWeb":"yes: WebFetch https://example.com/release","boxAsWeb":"no","boxAsBox":"yes: bbx search \"kitchen renovation budget\"","grepAsAny":"no","webAsAny":"yes: WebFetch https://example.com/release"}
```

An audit without `should_search` carries no search check, so it cannot fail one.

```ts
runChecks(auditTest, { behavior: behavior("answer"), newOrModifiedCards: new Map() }).shouldSearchCheck
=> undefined
```

## `cards_not_under` refuses a card written under a forbidden prefix

A card that landed under `_tmp/` fails the check even when the response never
names the path; a card under `_content/` passes.

```ts
const tmpTest = auditTestSchema.parse({ ...auditTest, cards_not_under: ["_tmp/"] });
const underTmp = runChecks(tmpTest, {
  behavior: behavior("Saved it."),
  newOrModifiedCards: new Map([["./_tmp/Garden.doc.card", "south fence"]]),
});
const underContent = runChecks(tmpTest, {
  behavior: behavior("Saved it."),
  newOrModifiedCards: new Map([["./_content/Garden.doc.card", "south fence"]]),
});
JSON.stringify({ tmp: underTmp.cardsNotUnderChecks[0], content: underContent.cardsNotUnderChecks[0] })
=> {"tmp":{"prefix":"_tmp/","found":true,"foundAt":"./_tmp/Garden.doc.card"},"content":{"prefix":"_tmp/","found":false}}
```
