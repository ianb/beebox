# Resumable capture selection

The REST route delegates to `selectResumableCaptures`. The selector returns
only open, non-empty sessions owned by the requesting user and matched by the
visible chat or exact client-held staging id.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createStagingSession, addPhoto, setStagingState, listStagingSessions } from "../../src/core/capture/staging-store.js";
import { selectResumableCaptures } from "../../src/core/capture/pending.js";

async function addPhotoTo(boxRoot, id) {
  await addPhoto({ boxRoot, id, filename: `photo-${id}.jpg`, capturedAt: "2026-07-09T14:00:00.000Z", source: "camera-user", buffer: Buffer.from("IMG") });
}
```

## Lifecycle, chat matching, and owner isolation

```ts
const box = await makeTmpBox();
const owned = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: "owner@example.com" });
await addPhotoTo(box.root, owned.id);
const standalone = await createStagingSession({ boxRoot: box.root, targetSessionId: null, createdBy: "owner@example.com" });
await addPhotoTo(box.root, standalone.id);
const empty = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: "owner@example.com" });
const sealed = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: "owner@example.com" });
await addPhotoTo(box.root, sealed.id);
await setStagingState({ boxRoot: box.root, id: sealed.id, state: "sealed" });
const sessions = await listStagingSessions({ boxRoot: box.root });
const byChat = selectResumableCaptures({
  sessions,
  targetSessionId: "chat-1",
  clientSessionId: null,
  requestingUser: "owner@example.com",
});
JSON.stringify({ idsMatch: byChat.length === 1 && byChat[0].id === owned.id, counts: byChat[0].counts })
=> {"idsMatch":true,"counts":{"photos":1,"files":0,"audioSegments":0}}
```

An exact client-held id finds a standalone capture:

```ts continue
const byId = selectResumableCaptures({
  sessions,
  targetSessionId: null,
  clientSessionId: standalone.id,
  requestingUser: "owner@example.com",
});
byId[0].id === standalone.id
=> true
```

The same chat and ids reveal nothing to another user; empty and sealed sessions
are absent for the owner too:

```ts continue
const otherUser = selectResumableCaptures({
  sessions,
  targetSessionId: "chat-1",
  clientSessionId: standalone.id,
  requestingUser: "other@example.com",
});
const ownerAll = selectResumableCaptures({
  sessions,
  targetSessionId: "chat-1",
  clientSessionId: sealed.id,
  requestingUser: "owner@example.com",
});
JSON.stringify({ other: otherUser.length, hasEmpty: ownerAll.some((item) => item.id === empty.id), hasSealed: ownerAll.some((item) => item.id === sealed.id) })
=> {"other":0,"hasEmpty":false,"hasSealed":false}
```

```ts cleanup
await box.cleanup();
```
