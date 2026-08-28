# Unmounting asks twice, on the page

`UnmountControl` (`components/settings/DriveMountRow.tsx`) is the settings
page's unmount affordance. Unmounting is not destructive — children stay where
they are and the card is recoverable from `store/trash/` — but it silently
stops something the box was doing, and a mis-click is invisible until a sync
that should have happened doesn't. So it is two steps.

The second step is inline, not a browser `confirm()`: that dialog cannot say
what unmounting does, and this is the one control on the page whose sentence a
boxholder should read before answering.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  driveControlId,
  UnmountControl,
} from "../../../src/frontend/src/components/settings/DriveMountRow.js";
import { isControlAddress } from "../../../src/frontend/src/lib/ui-scan/resolve.js";

globalThis.React = React;

const noop = () => {};

function render(state: { confirming: boolean; busy?: boolean; pending?: boolean }): string {
  return renderToStaticMarkup(
    React.createElement(UnmountControl, {
      driveId: "folder-1",
      confirming: state.confirming,
      busy: state.busy ?? false,
      pending: state.pending ?? false,
      onAsk: noop,
      onCancel: noop,
      onConfirm: noop,
    }),
  );
}
```

Drive IDs are case-sensitive and may contain characters outside the control
scan's lowercase address grammar. The row encodes the complete ID rather than
lowercasing it, so distinct Drive IDs stay distinct and every control remains
addressable.

```ts
const encoded = driveControlId("unmount", "Folder_A-1");
encoded
=> cb-settings-drive-unmount-id-00004600006f00006c00006400006500007200005f00004100002d000031

isControlAddress(encoded)
=> true

driveControlId("unmount", "Folder_A-1") === driveControlId("unmount", "folder_a-1")
=> false
```

## Step one is a single button that commits to nothing

```ts
const idle = render({ confirming: false });
idle.includes(">Unmount<")
=> true

idle.includes("Yes, unmount")
=> false
```

## Step two says what will happen, and offers a way back

```ts
const asked = render({ confirming: true });
asked.includes("Stop mirroring? Children stay where they are.")
=> true

asked.includes("Yes, unmount")
=> true

asked.includes(">Cancel<")
=> true
```

The confirming button carries the destructive styling, so the two answers do
not look interchangeable.

```ts continue
asked.includes("bg-danger")
=> true
```

## A running unmount says so rather than looking untouched

Principle 13: a control shows real state. While the mutation is in flight the
confirm button reads as working and Cancel is unavailable — the request is
already out.

```ts continue
const running = render({ confirming: true, busy: true, pending: true });
running.includes("Unmounting…")
=> true

running.includes("disabled")
=> true
```
