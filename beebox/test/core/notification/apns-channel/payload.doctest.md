# The APNs request for a notification

`buildApnsRequest` turns one intent into the APNs body and headers. Pure. The
keys beside `aps` are read by the iOS client (contract §5.10): `box` is the
sending box's slug, so a phone paired to several boxes opens the target on the
right one. The
per-loudness vectors are also shared fixtures under
`test/mobile-contract/fixtures/apns-payload/`.

```ts setup
import { buildApnsRequest } from "../../../../src/core/notification/apns-channel/payload.js";

function intent(loudness, extra) {
  return {
    id: "nAbc123",
    title: "Field trip form due Friday",
    body: "The school emailed the form.",
    target: { kind: "card", path: "_content/inbox/field-trip.email.card" },
    loudness,
    source: "doctest",
    ...extra,
  };
}
const show = (loudness, extra) => JSON.stringify(buildApnsRequest(intent(loudness, extra), { bundleId: "app.example", box: "home" }));
```

## `dot`: a badge and nothing else

No `alert` and no `sound`, so the phone shows no banner. The payload carries no
`loudness`.

```ts
show("dot")
=> {"payload":{"aps":{"badge":1},"target":"card:_content/inbox/field-trip.email.card","notificationId":"nAbc123","box":"home"},"headers":{"apns-push-type":"alert","apns-topic":"app.example"}}
```

## `quiet`: a passive banner

```ts
show("quiet")
=> {"payload":{"aps":{"alert":{"title":"Field trip form due Friday","body":"The school emailed the form."},"interruption-level":"passive","badge":1},"target":"card:_content/inbox/field-trip.email.card","loudness":"quiet","notificationId":"nAbc123","box":"home"},"headers":{"apns-push-type":"alert","apns-topic":"app.example"}}
```

## `loud`: an active banner with sound

```ts
show("loud")
=> {"payload":{"aps":{"alert":{"title":"Field trip form due Friday","body":"The school emailed the form."},"interruption-level":"active","badge":1,"sound":"default"},"target":"card:_content/inbox/field-trip.email.card","loudness":"loud","notificationId":"nAbc123","box":"home"},"headers":{"apns-push-type":"alert","apns-topic":"app.example"}}
```

## The tag becomes the collapse id

APNs refuses a collapse id over 64 bytes, so a longer tag collapses by its
SHA-256 hex instead: still one id per tag.

```ts
const short = buildApnsRequest(intent("quiet", { tag: "field-trip" }), { bundleId: "app.example", box: "home" }).headers;
const long = buildApnsRequest(intent("quiet", { tag: "x".repeat(80) }), { bundleId: "app.example", box: "home" }).headers["apns-collapse-id"];
JSON.stringify([short["apns-collapse-id"], long.length, /^[\da-f]+$/.test(long)])
=> ["field-trip",64,true]
```
