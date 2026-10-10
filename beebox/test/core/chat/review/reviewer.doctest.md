# The chat reviewer's model calls have no tools

The title pass and the full review read one chat transcript, which is in the
prompt, and return structured output. They need nothing else. When they ran
as full Claude Code sessions, a title run called `Read` and `Bash` on the box,
then continued the chat's lesson instead of naming it
(`issues/closed/bugs/2026-10-09-chat-title-run-is-a-full-agent-session.md`).
The prompt embeds the transcript, which can carry text from outside, so the
guard is in the options and not only in the prompt's "Do not use any tools".

Both passes run with no tools and no box context. This test records the
options each pass hands its agent, then shows the SDK options they become.

```ts setup
import { createSdkChatReviewer } from "../../../../src/core/chat/review/reviewer.js";
import { buildQueryOptions } from "../../../../src/core/agent/invoke/run.js";
import { createFakeAgent } from "../../fake-agent.js";

const agents = [];
const reviewer = createSdkChatReviewer({
  boxRoot: "/box",
  model: "haiku",
  createAgent: ({ name }) => {
    const agent = createFakeAgent({
      name,
      act: async () => ({ success: true }),
      structuredResult: () => ({ title: "Balancing equations", contains: "A chemistry lesson.", notes: [] }),
    });
    agents.push(agent);
    return agent;
  },
});

/** The SDK options a recorded invocation becomes, cut to the access fields. */
function sdkAccess(agent) {
  const opts = agent.invocations[0].options;
  const sdk = buildQueryOptions(
    { ...opts, systemPrompt: opts.systemPrompt ?? "" },
    { env: {}, maxTurns: opts.maxTurns, binaryPath: null, appendedSystem: "" },
  );
  return { tools: sdk.tools, settingSources: sdk.settingSources, maxTurns: sdk.maxTurns };
}
```

The title pass gets an empty tool list and loads no filesystem settings: no
box `AGENTS.md`, rules, skills, or hooks.

```ts
await reviewer.title({ sessionId: "s1", currentTitle: null, span: "**User**\nHow do I balance this?" })
=> { title: "Balancing equations" }

agents.at(-1).name
=> chat-title:s1

sdkAccess(agents.at(-1))
=> { tools: [], settingSources: [], maxTurns: 4 }
```

The full review writes `contains` and the account from the same prompt-only
input, so it gets the same options.

```ts
(await reviewer.review({
  sessionId: "s2", currentTitle: null, currentAccount: null, span: "**User**\nHi", bootstrap: true,
})).contains
=> A chemistry lesson.

agents.at(-1).name
=> chat-review:s2

sdkAccess(agents.at(-1))
=> { tools: [], settingSources: [], maxTurns: 4 }
```

A run that does not pass `tools` keeps the harness default: the SDK options
carry no `tools` key.

```ts
"tools" in buildQueryOptions(
  { boxRoot: "/box", systemPrompt: "", prompt: "hi" },
  { env: {}, maxTurns: 4, binaryPath: null, appendedSystem: "" },
)
=> false
```
