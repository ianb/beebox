# Chat history

## Photos in a replayed conversation

A photo attached in chat is written by the SDK into the transcript's own JSONL
line as base64, and stored nowhere else in the box. That is what makes an
image-bearing line 0.7–1.3 MB, and why the history read strips those payloads
textually as it scans rather than parsing them (`cli/lib/session-oversize.ts` —
carrying them per request is what OOM'd production in 2026-08).

Stripping loses the bytes from the *read*, not from the *transcript*. So a
stripped image block comes back carrying its coordinates instead of a
placeholder — `<sessionId>/<entryUuid>/<index>`, defined in
`shared/session-media.ts` — and `GET /api/session-media/<ref>` reads that one
line back out and serves that one photo (`webapp/routes/api-session-media.ts`).
The client renders it as a lazily-loaded `<img>`, so scrolling back through an
old conversation fetches a photograph at a time and never fetches the ones
nobody scrolls to.

Two pieces have to enumerate image blocks identically for a reference to
resolve: `transformContent` (`cli/lib/session-content.ts`), which mints it, and
`session-media-extract.ts`, which follows it back. Both count blocks of type
`image` in `message.content`, in document order.

A reference is minted only for an image the guard actually stripped. The strip
leaves `STRIPPED_MEDIA_MARKER` where the payload was rather than an empty
string, so the reader can tell a photo it can go and fetch from an upload that
failed and has nothing behind it — one turn can carry both, and only the first
gets a URL. The second still reads `[image not displayed]`, which is true.

## Two records of a message, and which one each reader sees

A send is answered 200 once it is **durably recorded**: `POST /api/chat/send`
emits the persisted `chat-user-message` onto the box's event bus and takes the
durable claim, and only then starts the engine — *"recording it IS acceptance"*
(`webapp/routes/chat-send-routes.ts`). The **transcript** is written later, by
the agent subprocess.

So the box holds two records, and they are not in step. `chat.history` and
`chat.bootstrap`'s `entries` read the transcript: that is what is durable.
`chat.bootstrap`'s `pending` reads the acceptance record: that is what is owed
(`core/chat/session/accepted-messages.ts`). A live client never notices the gap
— it holds its own optimistic copy and sees the bus event over the WebSocket —
but a reloaded page has neither, and for a message that opened a *new* chat the
gap lasts until the engine assigns a session id.

The two are kept separate on the wire and joined on the client, where
`reconcilePending` already knows how to retire a pending message once the
transcript catches up. Nothing server-side compares them; one comparison, in one
place.
