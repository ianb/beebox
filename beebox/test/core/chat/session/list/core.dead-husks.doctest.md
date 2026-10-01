# Dead husks — the chats that are still cards but no longer conversations

`loadAllSessions` lists what can be *resumed*, and skips a husk whose
transcript is gone — so a chat whose transcript expired simply disappears from
every list, and the boxholder never sees the state the box is in.
`loadDeadHusks` is its sibling: the same husk-read-and-stat pass, reporting the
other half of the answer (`docs/implemented-plans/chat-session-identity.md`, Track 3).

```ts setup
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../../../helpers/doctest-helpers.js";
import { loadDeadHusks, listSessionEntries, deadHuskLabel } from "../../../../../src/core/chat/session/list/core.js";
import { getSessionLogPath } from "../../../../../src/core/chat/session/transcript-paths.js";
import { localOrigin } from "../../../../../src/core/chat/session/origin.js";

const LIVE = "11111111-1111-4111-8111-111111111111";
const EXPIRED = "22222222-2222-4222-8222-222222222222";
const ELSEWHERE = "33333333-3333-4333-8333-333333333333";
const LEGACY = "44444444-4444-4444-8444-444444444444";

/** Write a husk card by hand, so each one's provenance is exactly stated. */
async function writeHusk(box, opts) {
  const lines = [`session: ${opts.session}`];
  if (opts.title !== undefined) lines.push(`title: ${opts.title}`);
  if (opts.firstMessage !== undefined) lines.push(`first-message: ${opts.firstMessage}`);
  if (opts.origin !== undefined) lines.push(`origin: ${opts.origin}`);
  if (opts.originName !== undefined) lines.push(`origin-name: ${opts.originName}`);
  await writeFile(box.path(`_content/chat/web/${opts.name}.chat.card`), `---\n${lines.join("\n")}\n---\n`);
}

async function writeTranscript(box, sessionId) {
  const logPath = getSessionLogPath(box.root, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, "{}\n");
}
```

## One pass, two lists: what resumes and what doesn't

Four husks, one transcript. The live chat is the only one `listSessionEntries`
reports, and the only one `loadDeadHusks` leaves out.

```ts
const box = await makeTmpBox();
await mkdir(box.path("_content/chat/web"), { recursive: true });
const here = await localOrigin();

await writeTranscript(box, LIVE);
await writeHusk(box, { name: "2026-08-20_11111111", session: LIVE, origin: here.id, originName: here.name });
await writeHusk(box, { name: "2026-08-19_22222222", session: EXPIRED, title: "Trip planning", origin: here.id, originName: here.name });
await writeHusk(box, { name: "2026-08-18_33333333", session: ELSEWHERE, origin: "prod-machine-id", originName: "prod" });
await writeHusk(box, { name: "2026-08-17_44444444", session: LEGACY });

JSON.stringify((await listSessionEntries(box.root)).map((e) => e.sessionId))
=> ["11111111-1111-4111-8111-111111111111"]
```

A husk stamped with *this* machine's id whose transcript is gone is `expired`;
one stamped with another machine's is `elsewhere`, named by its label; one
stamped with nothing at all is `unknown` rather than a guess. Newest first —
husk filenames lead with the chat's date, and there is no mtime left to sort on.

```ts continue
JSON.stringify(await loadDeadHusks(box.root))
=> [{"sessionId":"22222222-2222-4222-8222-222222222222","huskPath":"_content/chat/web/2026-08-19_22222222.chat.card","title":"Trip planning","transcript":{"state":"expired"}},{"sessionId":"33333333-3333-4333-8333-333333333333","huskPath":"_content/chat/web/2026-08-18_33333333.chat.card","transcript":{"state":"elsewhere","originName":"prod"}},{"sessionId":"44444444-4444-4444-8444-444444444444","huskPath":"_content/chat/web/2026-08-17_44444444.chat.card","transcript":{"state":"unknown"}}]
```

A dead husk keeps its binding, so the lists can still say where the chat lived.

```ts continue
await writeHusk(box, { name: "2026-08-16_55555555", session: "55555555-5555-4555-8555-555555555555", origin: here.id });
await writeFile(box.path("_content/chat/web/2026-08-16_55555555.chat.card"), `---\nsession: 55555555-5555-4555-8555-555555555555\ncontext-dir: _content/projects\norigin: ${here.id}\n---\n`);
(await loadDeadHusks(box.root)).map((h) => `${h.sessionId.slice(0, 8)} ${h.contextDir ?? "(unbound)"} ${h.transcript.state}`).join(", ")
=> 22222222 (unbound) expired, 33333333 (unbound) elsewhere, 44444444 (unbound) unknown, 55555555 _content/projects expired
```

## A dead husk's label: title unquoted, opening snippet quoted

With the transcript gone, `first-message` is the only surviving trace of what
the conversation opened with — so it renders as a snippet, visibly not a title.

```ts continue
await writeHusk(box, { name: "2026-08-15_66666666", session: "66666666-6666-4666-8666-666666666666", origin: here.id, firstMessage: "All right. I want to get the guest room ready…" });
const dead = (await loadDeadHusks(box.root)).find((h) => h.sessionId.startsWith("66666666")) ?? null;
const titled = (await loadDeadHusks(box.root)).find((h) => h.sessionId.startsWith("22222222")) ?? null;
JSON.stringify({ snippet: dead === null ? null : deadHuskLabel(dead), title: titled === null ? null : deadHuskLabel(titled) })
=> {"snippet":"“All right. I want to get the guest room ready…”","title":"Trip planning"}
```

A dead husk with neither field falls back to the id prefix, same as a live
one with no transcript snippet.

```ts continue
await writeHusk(box, { name: "2026-08-14_77777777", session: "77777777-7777-4777-8777-777777777777", origin: here.id });
const bare = (await loadDeadHusks(box.root)).find((h) => h.sessionId.startsWith("77777777")) ?? null;
deadHuskLabel(bare ?? { sessionId: "", huskPath: "", contextDir: undefined, title: undefined, firstMessage: undefined, transcript: { state: "expired" } })
=> 77777777
```

```ts continue cleanup
await box.cleanup();
```
