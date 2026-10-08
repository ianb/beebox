# What a small pass does not load

The SDK loads a box's own agent context by default — `CLAUDE.md`, the generated
agent guide, `.claude/rules/`. For the reactor, procedure runs and chat that is
the design. For the small structured passes (chat review, retro observation,
triage, the procedure judge) it is pure cost: measured on the test box it is
**~9,700 always-loaded words on every invocation**, and a pass emitting a title
or a yes/no verdict cannot use any of it
(`issues/code-quality/2026-07-30-structured-output-passes-load-full-box-context.md`).

`loadBoxContext: false` is how a call site opts out. It reaches the SDK as an
empty `settingSources`. Every other run loads the box's project settings
(`CLAUDE.md`, `.claude/rules/`, `.claude/skills/`, the box hooks) and nothing
from the host user's `~/.claude`.

```ts setup
import { buildQueryOptions } from "../../../../src/core/agent/invoke/run.js";

const CONTEXT = { env: {}, maxTurns: 4, binaryPath: null, appendedSystem: "" };
const RUN = { boxRoot: "/box", systemPrompt: "", prompt: "hi" };

function optionsFor(extra: Record<string, unknown>): Record<string, unknown> {
  return buildQueryOptions({ ...RUN, ...extra }, CONTEXT);
}
```

Opting out sets an empty `settingSources`; the default and an explicit `true`
load only the `project` source.

```ts
optionsFor({ loadBoxContext: false }).settingSources
=> []

optionsFor({}).settingSources
=> ["project"]

optionsFor({ loadBoxContext: true }).settingSources
=> ["project"]
```

The server's Claude login can carry claude.ai connectors (Gmail, Calendar,
Drive) for one person's account. A box agent must never get them
(`issues/closed/bugs/2026-10-08-box-chat-agent-inherits-host-claude-account-connectors.md`),
so every run turns them off with a flag-level setting. The CLI also loads every
`CLAUDE.md` in the directories above its working directory, which for a box
under the host's home directory includes `~/.claude/CLAUDE.md`; those files are
excluded by path.

```ts
optionsFor({}).settings
=> {
  disableClaudeAiConnectors: true,
  claudeMdExcludes: ["/CLAUDE.md", "/CLAUDE.local.md", "/.claude/CLAUDE.md", "/.claude/rules/**"],
}

optionsFor({ loadBoxContext: false }).settings.disableClaudeAiConnectors
=> true
```

Opting out changes nothing else about the run — the working directory is still
the box, so a pass that reads a file still can.

```ts
optionsFor({ loadBoxContext: false }).cwd
=> /box
```
