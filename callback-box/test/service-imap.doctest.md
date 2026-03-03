# IMAP service

Fake IMAP maintains in-memory messages for testing email connectors.

```ts setup
import { createFakeImap } from "../src/services/imap.js";
```

## Connection lifecycle

```
const svc = createFakeImap();
svc.connected
=> false
```

``` continue
await svc.connect();
svc.connected
=> true
```

``` continue
await svc.logout();
svc.connected
=> false
```

## Mailbox locking

```
const svc = createFakeImap();
await svc.connect();
const lock = await svc.getMailboxLock("[Gmail]/All Mail");
svc.lockedMailbox
=> [Gmail]/All Mail
```

``` continue
lock.release();
svc.lockedMailbox
=> null
```

## Searching returns UIDs

```
const svc = createFakeImap({
  messages: [
    { uid: 101, envelope: { messageId: "a@example.com" } },
    { uid: 102, envelope: { messageId: "b@example.com" } },
  ],
});
const uids = await svc.search({ gmraw: "label:inbox" });
JSON.stringify(uids)
=> [101,102]
```

## Fetching messages by UID

```
const svc = createFakeImap({
  messages: [
    { uid: 101, envelope: { messageId: "a@example.com" } },
    { uid: 102, envelope: { messageId: "b@example.com" } },
    { uid: 103, envelope: { messageId: "c@example.com" } },
  ],
});
const fetched = []; for await (const m of svc.fetch([101, 103])) fetched.push(m.envelope.messageId);
JSON.stringify(fetched)
=> ["a@example.com","c@example.com"]
```
