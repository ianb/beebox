# Triage Feedback (Agent Tests)

Tests for the `triage-feedback` command, which invokes an agent to categorize
and integrate user feedback on news briefs. Uses a fake agent to verify:
- The prompt and context given to the agent
- Post-agent behavior (commit checking, lock release)
- Handling of agent misbehavior (forgetting to commit, failure)

```ts setup
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { createFakeAgent } from "./helpers/fake-agent.js";
import { initBox } from "../src/core/box.js";
import type { CommandContext } from "../src/core/command-runner.js";
import {
  executeTriageFeedback,
  getTranscribedFeedbackCards,
  buildFeedbackTriagePrompt,
} from "../src/core/commands/triage-feedback.js";
function makeCtx(boxRoot: string): CommandContext {
  return {
    boxRoot,
    write: () => {},
    writeLine: () => {},
  };
}
```

## getTranscribedFeedbackCards

### Finds cards with transcription

Only cards with `<transcription` or text content are returned. Cards with
permanent errors or no content are skipped.

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);

// Card with transcription — should be included
await box.seed("box/inbox/feedback/card1.feedback.card", `<feedback target-ref="store/archive/briefs/2026-02-03_ai.news-brief.card#s1">
  <transcription>This was really interesting</transcription>
</feedback>`);

// Card with text content — should be included
await box.seed("box/inbox/feedback/card2.feedback.card", `<feedback target-ref="store/archive/briefs/2026-02-03_ai.news-brief.card#s2">
  <source>text</source>
  <comment>I liked this section</comment>
</feedback>`);

// Card with permanent error — should be skipped
await box.seed("box/inbox/feedback/card3.feedback.card", `<feedback>
  <transcription-error permanent="true">Failed</transcription-error>
</feedback>`);

// Card with no content yet — should be skipped
await box.seed("box/inbox/feedback/card4.feedback.card", `<feedback>
  <audio src="recording.webm" />
</feedback>`);

const cards = await getTranscribedFeedbackCards(box.root);
cards.sort();
print(cards.join("\n"));
=>
box/inbox/feedback/card1.feedback.card
box/inbox/feedback/card2.feedback.card
```

## buildFeedbackTriagePrompt

### Produces the expected system prompt

The prompt is parameterized only by boxRoot. The full prompt is shown here
as documentation — `«codeblock»` matches triple backticks, `«blankline»`
matches empty lines.

```
print(buildFeedbackTriagePrompt("/test/box"));
=>
You are triaging user feedback on news briefs in a Callback Box.
«blankline»
WORKING DIRECTORY: /test/box
«blankline»
YOUR TASK:
Process feedback cards in box/inbox/feedback/, categorize them, and integrate feedback into briefs.
«blankline»
OVERVIEW:
1. Read each feedback card and its transcription
2. Categorize the content
3. Integrate feedback directly into the target brief
4. Move processed cards to appropriate locations
«blankline»
CATEGORIES:
- **feedback**: Direct commentary on brief content → integrate into brief
- **task**: A reminder, follow-up, or action item → move to box/inbox/unhandled/ (task system not yet built)
- **unhandled**: Unclear intent or doesn't fit other categories → move to box/inbox/unhandled/
«blankline»
SPLIT HANDLING:
If a single feedback card contains MULTIPLE intents (e.g., "This was interesting, I should follow up on Zig later"):
1. The feedback portion ("This was interesting") should be integrated into the brief
2. The task portion ("follow up on Zig later") should be noted
3. Create a new card for the task portion in box/inbox/unhandled/ with a note about what it is
4. Mark the original card's triage-summary attr with what was extracted
«blankline»
STEP-BY-STEP PROCESS:
«blankline»
For each feedback card:
«blankline»
1. READ THE CARD:
   «codeblock»
   cat box/inbox/feedback/<card-name>.feedback.card
   «codeblock»
   Note the target ref (e.g., "store/archive/briefs/2026-02-03_foo.news-brief.card#s1")
   Note the transcription or comment text
«blankline»
2. CATEGORIZE:
   - Is this feedback about the brief content? → feedback
   - Is this a reminder/follow-up/action for later? → task
   - Is this unclear or something else? → unhandled
   - Does it contain multiple intents? → note both
«blankline»
3. FOR FEEDBACK ITEMS - INTEGRATE INTO BRIEF:
   a. Parse the target ref to get brief path and element ID
   b. Read the target brief
   c. Find the target element (section or expando by ID)
   d. Add a <user-comment> element as a child of that element:
«blankline»
   «codeblock»xml
   <user-comment timestamp="<from-feedback-card>" source="voice"
                 audio="store/integrated/<feedback-card-basename>.webm"
                 language="en">
     <transcription text here>
   </user-comment>
   «codeblock»
«blankline»
   For text feedback, use source="text" and omit the audio attr.
«blankline»
   e. Save the brief
«blankline»
4. MOVE THE FEEDBACK CARD:
   - For integrated feedback:
     «codeblock»
     cb mv box/inbox/feedback/<card> store/integrated/
     «codeblock»
   - For unhandled items:
     «codeblock»
     mkdir -p box/inbox/unhandled
     cb mv box/inbox/feedback/<card> box/inbox/unhandled/
     «codeblock»
«blankline»
5. UPDATE TRIAGE STATUS:
   Before moving, update the card's triage-status attribute:
   - For feedback: triage-status="integrated"
   - For unhandled: triage-status="unhandled"
«blankline»
EXAMPLE INTEGRATION:
«blankline»
If feedback card has:
- target ref: "store/archive/briefs/2026-02-03_security.news-brief.card#s1"
- transcription: "This hardware angle isn't really my thing"
- timestamp: "2026-02-03T12:38:30Z"
«blankline»
Find section s1 in the brief and add:
«codeblock»xml
<section id="s1" heading="..." user-feedback="thumbs-down">
  <user-comment timestamp="2026-02-03T12:38:30Z" source="voice"
                audio="store/integrated/brief_feedback_2026-02-03T12-38-30.webm"
                language="en">
    This hardware angle isn't really my thing
  </user-comment>
  ... existing content ...
</section>
«codeblock»
«blankline»
HANDLING EDGE CASES:
«blankline»
**Brief not found**: If the target brief doesn't exist at the path, move feedback to box/inbox/unhandled/
«blankline»
**Element not found**: If the target element (e.g., #s5) doesn't exist in the brief, move to unhandled
«blankline»
**Expando target**: Expandos can also have user-comment children - same process as sections
«blankline»
**No fragment in ref**: If ref has no fragment (just the brief path), the comment is about the brief overall.
In this case, add the user-comment as a child of the <content> element.
«blankline»
OUTPUT FORMAT:
For each card processed, report:
  CARD: [path]
  CATEGORY: feedback | task | unhandled
  ACTION: integrated into [brief#element] | moved to unhandled | split (feedback integrated, task to unhandled)
«blankline»
When done, commit your changes with a detailed message:
«blankline»
«codeblock»bash
git add -A && git commit -m "$(cat <<'EOF'
Triage feedback: <N> integrated, <M> unhandled
«blankline»
Integrated:
- <brief#element>: "<summary of comment>"
- <brief#element>: "<summary of comment>"
«blankline»
Unhandled:
- <card>: <reason>
«blankline»
Triggered-By: cb triage-feedback
EOF
)"
«codeblock»
«blankline»
GIT: Do NOT add Co-Authored-By to commits. The system adds appropriate trailers automatically.
```

## executeTriageFeedback with fake agent

### Happy path — agent receives correct prompt and commits

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("box/inbox/feedback/card1.feedback.card", `<feedback target-ref="store/archive/briefs/2026-02-03_ai.news-brief.card#s1">
  <transcription>This was really interesting</transcription>
</feedback>`);
box.commitAll("add feedback");

const agent = createFakeAgent({
  name: "triage",
  act: async ({ boxRoot }) => {
    // Simulate: agent moves feedback to integrated and commits
    execSync([
      "mkdir -p store/integrated",
      "mv box/inbox/feedback/card1.feedback.card store/integrated/",
      "git add -A",
      'git commit -m "Triage: 1 integrated"',
    ].join(" && "), { cwd: boxRoot, stdio: "pipe" });
    return { success: true };
  },
});

const result = await executeTriageFeedback(makeCtx(box.root), { agent, force: true });
result.success
=> true

// Agent was invoked exactly once
agent.invocations.length
=> 1

// System prompt was provided (first invocation)
const inv = agent.invocations[0];
inv.systemPrompt.startsWith("You are triaging user feedback")
=> true
inv.systemPrompt.includes("WORKING DIRECTORY: " + box.root)
=> true

// User prompt lists the feedback cards
print(inv.prompt);
=>
Please triage and integrate these feedback cards:
  - box/inbox/feedback/card1.feedback.card

// Verify the agent's work took effect
const files = await readdir(join(box.root, "store/integrated"));
files.length > 0
=> true
```

### No feedback cards — skips agent entirely

When there's nothing to triage, the agent should not be invoked at all.

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const agent = createFakeAgent({
  name: "triage",
  act: async () => {
    throw new Error("Should not be called");
  },
});

const result = await executeTriageFeedback(makeCtx(box.root), { agent, force: true });
result.success
=> true
result.data.processed
=> 0

agent.invocations.length
=> 0
```

### Agent fails — returns error

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("box/inbox/feedback/card1.feedback.card", `<feedback>
  <transcription>Some feedback</transcription>
</feedback>`);
box.commitAll("add feedback");

const agent = createFakeAgent({
  name: "triage",
  act: async () => {
    return { success: false, error: "Agent crashed" };
  },
});

const result = await executeTriageFeedback(makeCtx(box.root), { agent, force: true });
result.success
=> false
result.error
=> Agent crashed
```

### Agent doesn't commit — ensureAgentCommitted retries then fallback

When the agent succeeds but forgets to commit, the system retries by
resuming the session. If that also fails, a fallback commit is created.

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("box/inbox/feedback/card1.feedback.card", `<feedback>
  <transcription>Some feedback</transcription>
</feedback>`);
box.commitAll("add feedback");

const agent = createFakeAgent({
  name: "triage",
  act: async ({ boxRoot, invocation }) => {
    if (invocation === 0) {
      // Agent moves files but forgets to commit
      execSync([
        "mkdir -p store/integrated",
        "mv box/inbox/feedback/card1.feedback.card store/integrated/",
      ].join(" && "), { cwd: boxRoot, stdio: "pipe" });
      return { success: true };
    }
    // Second invocation (retry nudge) — also doesn't commit
    return { success: true };
  },
});

const result = await executeTriageFeedback(makeCtx(box.root), { agent, force: true });
result.success
=> true

// Two invocations: original + retry nudge
agent.invocations.length
=> 2

// Second invocation was a resume (no system prompt, continued session)
agent.invocations[1].resumed
=> true
agent.invocations[1].systemPrompt
=> null

// The retry prompt asks the agent to commit
agent.invocations[1].prompt.includes("uncommitted changes")
=> true

// Fallback commit was created (agent failed to commit both times)
const log = execSync("git log --oneline -1", { cwd: box.root, encoding: "utf-8" });
log.includes("Triage")
=> true

// The fallback commit has the Fallback trailer
const fullLog = execSync("git log -1 --format=%B", { cwd: box.root, encoding: "utf-8" });
fullLog.includes("Fallback: true")
=> true
```

### Agent doesn't commit — retry succeeds

When the retry nudge gets the agent to commit, no fallback is needed.

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

await box.seed("box/inbox/feedback/card1.feedback.card", `<feedback>
  <transcription>Some feedback</transcription>
</feedback>`);
box.commitAll("add feedback");

const agent = createFakeAgent({
  name: "triage",
  act: async ({ boxRoot, invocation }) => {
    if (invocation === 0) {
      // Agent moves files but forgets to commit
      execSync([
        "mkdir -p store/integrated",
        "mv box/inbox/feedback/card1.feedback.card store/integrated/",
      ].join(" && "), { cwd: boxRoot, stdio: "pipe" });
      return { success: true };
    }
    // Retry nudge — agent commits this time
    execSync("git add -A && git commit -m 'Triage on retry'", {
      cwd: boxRoot,
      stdio: "pipe",
    });
    return { success: true };
  },
});

const result = await executeTriageFeedback(makeCtx(box.root), { agent, force: true });
result.success
=> true

agent.invocations.length
=> 2

// No fallback — agent committed on retry
const log = execSync("git log --oneline -1", { cwd: box.root, encoding: "utf-8" });
log.includes("retry")
=> true
log.includes("Fallback")
=> false
```
