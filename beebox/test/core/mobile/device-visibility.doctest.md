# Who may see and unpair a mobile device

Minting a pairing ticket needs only box access — you pair your own phone. Seeing
and unpairing follow it: a person reaches the devices they paired, and the owner
reaches every device on the box. `mayManageMobileDevice` is the single rule both
`pairing.devices` and `pairing.revokeDevice` consult, so the list and the
mutation cannot disagree about whose device it is.

```ts setup
import { mayManageMobileDevice } from "../../../src/core/mobile/pairing.js";

const devices = {
  "priya's phone": { createdBy: "priya@example.com" },  // the owner's
  "tomas's phone": { createdBy: "tomas@example.com" },  // a member's
  "an orphan": { createdBy: null },                     // paired before the pairer was recorded
};

const owner = { isOwner: true, email: "priya@example.com" };
const member = { isOwner: false, email: "tomas@example.com" };
const machine = { isOwner: false, email: null };        // agent bearer / browse key

/** What this viewer reaches, named, so a wrong answer says which device it is. */
function reaches(viewer: { isOwner: boolean; email: string | null }): string {
  const names = Object.entries(devices)
    .filter(([, device]) => mayManageMobileDevice(device, viewer))
    .map(([name]) => name);
  return names.length > 0 ? names.join(", ") : "nothing";
}
```

## The owner reaches every device on the box

```ts
reaches(owner)
=> priya's phone, tomas's phone, an orphan
```

## A member reaches their own device and nobody else's

This is the point of the change: a member who loses a phone can unpair it
themselves instead of asking the owner to do it for them.

```ts continue
reaches(member)
=> tomas's phone
```

## A machine caller is not a person, so it reaches nothing

An agent bearer, or the browse key on a box that did not opt in, authenticates
as nobody. It clears the auth wall and reaches the procedure — and must get an
empty list rather than somebody's phone.

Note which device this pins hardest: the orphan. `createdBy: null` means the
store predates the field, so the device belongs to nobody. Matching null against
a caller with no email would hand every such device to exactly this caller, so
the rule requires a real address on both sides.

```ts continue
reaches(machine)
=> nothing
```
