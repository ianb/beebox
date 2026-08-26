# Dead husks — the chats that are still cards but no longer conversations

`loadAllSessions` lists what can be *resumed*, and skips a husk whose
transcript is gone — so a chat whose transcript expired simply disappears from
every list, and the boxholder never sees the state the box is in.
`loadDeadHusks` is its sibling: the same husk-read-and-stat pass, reporting the
other half of the answer (`docs/plans/chat-session-identity.md`, Track 3).

```ts setup
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { loadDeadHusks, listSessionEntries } from "../../../../src/core/chat/session/list.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";
import { localOrigin } from "../../../../src/core/chat/session/origin.js";

const LIVE = "11111111-1111-4111-8111-111111111111";
const EXPIRED = "22222222-2222-4222-8222-222222222222";
const ELSEWHERE = "33333333-3333-4333-8333-333333333333";
const LEGACY = "44444444-4444-4444-8444-444444444444";

/** Write a husk card by hand, so each one's provenance is exactly stated. */
async function writeHusk(box, opts) {
  const lines = [`session: ${opts.session}`];
  if (opts.title !== undefined) lines.push(`title: ${opts.title}`);
  if (opts.origin !== undefined) lines.push(`origin: ${opts.origin}`);
  if (opts.originName !== undefined) lines.push(`origin-name: ${opts.originName}`);
  await writeFile(box.path(`store/chat/web/${opts.name}.chat.card`), `---\n${lines.join("\n")}\n---\n`);
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
await mkdir(box.path("store/chat/web"), { recursive: true });
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
=> [{"sessionId":"22222222-2222-4222-8222-222222222222","huskPath":"store/chat/web/2026-08-19_22222222.chat.card","title":"Trip planning","transcript":{"state":"expired"}},{"sessionId":"33333333-3333-4333-8333-333333333333","huskPath":"store/chat/web/2026-08-18_33333333.chat.card","transcript":{"state":"elsewhere","originName":"prod"}},{"sessionId":"44444444-4444-4444-8444-444444444444","huskPath":"store/chat/web/2026-08-17_44444444.chat.card","transcript":{"state":"unknown"}}]
```

A dead husk keeps its binding, so the lists can still say where the chat lived.

```ts continue
await writeHusk(box, { name: "2026-08-16_55555555", session: "55555555-5555-4555-8555-555555555555", origin: here.id });
await writeFile(box.path("store/chat/web/2026-08-16_55555555.chat.card"), `---\nsession: 55555555-5555-4555-8555-555555555555\ncontext-dir: store/projects\norigin: ${here.id}\n---\n`);
(await loadDeadHusks(box.root)).map((h) => `${h.sessionId.slice(0, 8)} ${h.contextDir ?? "(unbound)"} ${h.transcript.state}`).join(", ")
=> 22222222 (unbound) expired, 33333333 (unbound) elsewhere, 44444444 (unbound) unknown, 55555555 store/projects expired
```

```ts continue cleanup
await box.cleanup();
```
