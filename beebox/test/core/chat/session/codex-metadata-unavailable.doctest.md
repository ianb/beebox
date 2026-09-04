# When Codex can't be asked about its own chats

A codex chat's metadata lives in Codex, not on our disk: `enumerateChats` asks
the Codex CLI for the thread list, and for a codex husk that answer carries the
chat's existence, not just its date. So a broken Codex — the CLI missing, or
its plugin marketplace pointing at a checkout that has been deleted — used to
reject the whole enumeration, and `chat.placeMenu` with it, taking the app
bar's Switch-to panel down over metadata the menu only uses for counts.

Now the failure is contained to the chats it's actually about.

```ts setup
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { loadDeadHusks, listSessionEntries } from "../../../../src/core/chat/session/list.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { localOrigin } from "../../../../src/core/chat/session/origin.js";

const CLAUDE_CHAT = "11111111-1111-4111-8111-111111111111";
const CODEX_CHAT = "22222222-2222-4222-8222-222222222222";

async function writeHusk(box, opts: { name: string; session: string; engine?: string }) {
  const here = await localOrigin();
  const lines = [`session: ${opts.session}`, `origin: ${here.id}`, `origin-name: ${here.name}`];
  if (opts.engine !== undefined) lines.push(`engine: ${opts.engine}`);
  await writeFile(box.path(`_content/chat/web/${opts.name}.chat.card`), `---\n${lines.join("\n")}\n---\n`);
}

async function writeTranscript(box, sessionId: string) {
  const logPath = getSessionLogPath(box.root, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, "{}\n");
}
```

Two husks, one per engine. Codex is then made unreachable by emptying `PATH`
for this process — the bluntest honest stand-in for "the CLI is broken", and
the same failure the dangling-marketplace bug produced, since the installer
runs before any thread can be listed.

```ts
const box = await makeTmpBox();
await mkdir(box.path("_content/chat/web"), { recursive: true });
await writeTranscript(box, CLAUDE_CHAT);
await writeHusk(box, { name: "2026-08-20_11111111", session: CLAUDE_CHAT });
await writeHusk(box, { name: "2026-08-19_22222222", session: CODEX_CHAT, engine: "codex" });

const realPath = process.env["PATH"];
process.env["PATH"] = "/nonexistent";

// The claude chat is still listed. Before this change, the codex husk's
// unreachable metadata rejected the whole call and this threw.
JSON.stringify((await listSessionEntries(box.root)).map((e) => e.sessionId))
=> ["11111111-1111-4111-8111-111111111111"]
```

The codex chat is reported as neither live nor dead. "Codex couldn't be asked"
and "Codex has no such thread" are different facts, and only the second one
means the chat is gone — claiming the first as expired would tell the
boxholder a transcript was lost when it is sitting there, readable again as
soon as the CLI works.

```ts continue
JSON.stringify(await loadDeadHusks(box.root))
=> []
```

```ts cleanup
process.env["PATH"] = realPath;
```
