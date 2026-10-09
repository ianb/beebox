# third-person check: "the user" on a card the person reads

The card-write hook (`cardValidatorHook`) points out "the user" and "the
boxholder" in text the agent just wrote to a card under `_content/`, where the
person reads it. The guide already forbids the third person; this puts the
reminder at the moment of writing. It reads only the new text, so a card that
already quotes "the user" from a web page stays quiet unless the agent writes
the phrase itself.

```ts setup
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cardValidatorHook } from "../../src/core/sdk-hooks.js";
import { thirdPersonPhrases } from "../../src/core/card-lint/third-person.js";

const box = await mkdtemp(join(tmpdir(), "third-person-"));
await mkdir(join(box, ".beebox"), { recursive: true });
await writeFile(join(box, ".beebox/box.json"), JSON.stringify({ shapeVersion: 3 }));
await mkdir(join(box, "_content"), { recursive: true });
await mkdir(join(box, "_bookkeeping/jobs"), { recursive: true });
const { hooks } = cardValidatorHook();

// Write a card, run the hook as if the agent had just written it, and return
// the injected context (null when the hook stays quiet).
async function afterWrite(rel, toolInput) {
  const file_path = join(box, rel);
  const text = toolInput.content ?? `---\ntype: memo\n---\n${toolInput.new_string ?? ""}\n`;
  await writeFile(file_path, text);
  const out = await hooks[0]?.({
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: { file_path, ...toolInput },
    tool_response: {},
    tool_use_id: "t",
    cwd: box,
  });
  return out?.hookSpecificOutput?.additionalContext ?? null;
}
const memo = (body) => `---\ntype: memo\n---\n${body}\n`;
```

A card in the person's area that says "the user confirmed" gets the reminder,
naming the phrase and the fix:

```ts
const note = await afterWrite("_content/Drill.memo.card", { content: memo("The user confirmed the drill is with Sam.") });
[note?.includes('"the user"'), note?.includes('Write "you"')]
=> [true, true]
```

"The boxholder" and its possessive count too, and an Edit is checked by its
new text:

```ts
(await afterWrite("_content/Tools.memo.card", { old_string: "x", new_string: "Listed from the boxholder's memory." }))?.includes("boxholder's")
=> true
```

Text that says "you" gets no reminder, and neither does agent-facing text
outside `_content/`, where "the user" is the right word. (The card linter may
still add its own notes for these bare test cards.)

```ts
const voiced = (note) => note?.includes("calls them") ?? false;
voiced(await afterWrite("_content/Drill2.memo.card", { content: memo("You confirmed the drill is with Sam.") }))
=> false

voiced(await afterWrite("_bookkeeping/jobs/Followup.memo.card", { content: memo("Ask the user about the drill.") }))
=> false
```

The phrase finder lowercases and folds whitespace, and does not match words
that merely contain "user":

```ts
thirdPersonPhrases("The  User said so; the boxholders agreed; a username; reuser")
=> ["the user", "the boxholders"]
```
