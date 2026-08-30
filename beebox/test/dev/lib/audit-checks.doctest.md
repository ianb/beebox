# Knowledge-audit response checks

Positive regex checks express a required relationship without pinning one
model's exact prose. The temp-file check accepts optional words between the
negation and `host /tmp`, while still rejecting an answer that recommends it.

```ts setup
import { runChecks } from "../../../src/dev/lib/audit-checks.js";
import { auditTestSchema } from "../../../src/dev/lib/test-suite-schema.js";
import type { AgentBehavior, AuditTest } from "../../../src/dev/lib/test-runner.js";

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
  should_read_any: ["docs/generated/card-image.md", "beebox-rule-card-image/SKILL.md"],
}, {
  behavior: { ...behavior("answer"), filesRead: [".agents/skills/beebox-rule-card-image/SKILL.md"] },
  newOrModifiedCards: new Map(),
});
JSON.stringify(alternateSource.shouldReadAnyCheck)
=> {"files":["docs/generated/card-image.md","beebox-rule-card-image/SKILL.md"],"wasRead":true,"matched":"beebox-rule-card-image/SKILL.md"}
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
