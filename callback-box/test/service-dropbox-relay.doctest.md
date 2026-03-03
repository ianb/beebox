# Dropbox Relay service

Fake Dropbox Relay maintains in-memory messages and tracks operations.

```ts setup
import { createFakeDropboxRelay } from "../src/services/dropbox-relay.js";
```

## Creating channels

```
const svc = createFakeDropboxRelay();
const creds = await svc.createChannel("https://relay.example.com");
creds.channelId.startsWith("ch-")
=> true
```

``` continue
svc.channels.length
=> 1
```

## Generating pairing codes

```
const svc = createFakeDropboxRelay();
const result = await svc.generatePairingCode({
  workerUrl: "https://relay.example.com",
  apiKey: "key",
  channelId: "ch-1",
  channelKey: "ckey",
});
result.code
=> 123456
```

``` continue
svc.pairingCodes.length
=> 1
```

## Polling drains messages

```
const svc = createFakeDropboxRelay({
  messages: [
    { id: "m1", type: "memo", data: { text: "hello" } },
    { id: "m2", type: "memo", data: { text: "world" } },
  ],
});
const msgs = await svc.poll();
msgs.length
=> 2
```

``` continue
// Messages are drained after poll
(await svc.poll()).length
=> 0
```

## Deleting messages

```
const svc = createFakeDropboxRelay();
await svc.deleteMessage("m1");
await svc.deleteMessage("m2");
JSON.stringify(svc.deleted)
=> ["m1","m2"]
```
