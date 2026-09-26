# channelsToTry: loudness by presence

`channelsToTry` decides, for one intent, which channels to send on and which
to log as skipped. It is pure: the caller supplies who each channel can reach
(the audience) and how many web sessions have a person active (presence).

```ts setup
import { channelsToTry } from "../../../src/core/notification/channels.js";

const ALL = { apns: true, "web-push": true, telegram: true };
const NONE = { apns: false, "web-push": false, telegram: false };
// The audience this chunk can have: no APNs yet, a subscribed browser, a Telegram chat.
const NO_APNS = { apns: false, "web-push": true, telegram: true };

function row(loudness, audience, activeWeb) {
  const plan = channelsToTry({ intent: { loudness }, audience, presence: { activeWeb } });
  const skipped = plan.skipped.map((d) => `${d.channel}:${d.detail}`).join(" ");
  return `${loudness.padEnd(5)} present=${activeWeb}  try [${plan.channels.join(" ")}]  skip [${skipped}]`;
}

function matrix(audience) {
  return ["loud", "quiet", "dot"].flatMap((loudness) => [0, 1].map((activeWeb) => row(loudness, audience, activeWeb))).join("\n");
}
```

## Every channel reachable

`loud` goes everywhere whatever the presence. `quiet` goes everywhere only
when nobody is present; an open app shows it instead. `dot` is a badge, so
only `apns` is a candidate, and presence never suppresses it.

```ts
matrix(ALL)
=>
loud  present=0  try [apns web-push telegram]  skip []
loud  present=1  try [apns web-push telegram]  skip []
quiet present=0  try [apns web-push telegram]  skip []
quiet present=1  try []  skip [apns:present web-push:present telegram:present]
dot   present=0  try [apns]  skip []
dot   present=1  try [apns]  skip []
```

## No APNs audience (today's boxes)

A channel with nobody to reach is a `no-audience` skip. For a `dot` that is
the only line, since `apns` is its only candidate.

```ts
matrix(NO_APNS)
=>
loud  present=0  try [web-push telegram]  skip [apns:no-audience]
loud  present=1  try [web-push telegram]  skip [apns:no-audience]
quiet present=0  try [web-push telegram]  skip [apns:no-audience]
quiet present=1  try []  skip [apns:present web-push:present telegram:present]
dot   present=0  try []  skip [apns:no-audience]
dot   present=1  try []  skip [apns:no-audience]
```

## Nobody reachable

With no audience and nobody present, nothing is tried and every candidate
is `no-audience`. The notification health check reports that outcome. A
present person turns a `quiet` into `present` skips: the open app showed it.

```ts
matrix(NONE)
=>
loud  present=0  try []  skip [apns:no-audience web-push:no-audience telegram:no-audience]
loud  present=1  try []  skip [apns:no-audience web-push:no-audience telegram:no-audience]
quiet present=0  try []  skip [apns:no-audience web-push:no-audience telegram:no-audience]
quiet present=1  try []  skip [apns:present web-push:present telegram:present]
dot   present=0  try []  skip [apns:no-audience]
dot   present=1  try []  skip [apns:no-audience]
```
