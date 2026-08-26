# Transcript state — expired, elsewhere, or never recorded

A chat's transcript lives in one engine store on one machine and expires there,
so "the transcript isn't here" has three different meanings. The husk's
`origin` field is the only durable record of which one applies
(`docs/plans/chat-session-identity.md`, Track 3): compared against this
machine's id, it separates *this machine's chat whose transcript aged out* from
*a chat that ran somewhere else*, and its absence is reported as `unknown`
rather than guessed at.

```ts setup
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { deriveTranscriptState } from "../../../../src/core/chat/session/availability.js";
import { localOrigin } from "../../../../src/core/chat/session/origin.js";

/** The husk fields the derivation reads; the rest of the card is irrelevant. */
function husk(fields) {
  return { path: "store/chat/web/2026-08-26_aaaaaaaa.chat.card", session: "s", ...fields };
}
```

## A readable transcript is `present`, whoever's it is

```ts
const box = await makeTmpBox();
process.env["CB_ORIGIN_ID_FILE"] = box.path("origin-id");
const here = (await localOrigin()).id;

JSON.stringify(await deriveTranscriptState({ husk: husk({ origin: "some-other-machine" }), present: true }))
=> {"state":"present"}
```

## This machine's own chat, with no transcript left, is `expired`

```ts continue
JSON.stringify(await deriveTranscriptState({ husk: husk({ origin: here, originName: "this-laptop" }), present: false }))
=> {"state":"expired"}
```

## Another machine's chat is `elsewhere`, named by its label

The hostname is a label written when the husk was stamped, and a machine can be
renamed after the fact — so when the husk carries none, the id itself stands in
rather than the row going nameless.

```ts continue
JSON.stringify(await deriveTranscriptState({ husk: husk({ origin: "prod-machine-id", originName: "prod" }), present: false }))
=> {"state":"elsewhere","originName":"prod"}

JSON.stringify(await deriveTranscriptState({ husk: husk({ origin: "prod-machine-id" }), present: false }))
=> {"state":"elsewhere","originName":"prod-machine-id"}
```

## No recorded origin — and no husk at all — is `unknown`

A husk written before the provenance fields existed says nothing about where it
ran, and calling that `expired` would report another machine's live chat as
this machine's dead one. Reconcile backfills `origin`, so the state decays.

```ts continue
JSON.stringify(await deriveTranscriptState({ husk: husk({}), present: false }))
=> {"state":"unknown"}

JSON.stringify(await deriveTranscriptState({ husk: null, present: false }))
=> {"state":"unknown"}
```

```ts continue cleanup
delete process.env["CB_ORIGIN_ID_FILE"];
await box.cleanup();
```
