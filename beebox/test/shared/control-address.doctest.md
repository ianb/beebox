# `control-address.ts` — minting an address the tooling can honour

A `bbx-` control address is an HTML `id` that three different things have to
agree on: `getElementById` in the app, a `#…` CSS selector in `bin/browse`, and
a `control:` link in agent-facing text. The grammar is narrow so none of them
needs an escaping scheme — and narrow means a component cannot interpolate
runtime data into an id and hope.

```ts setup
import { controlAddress, isControlAddress, MAX_CONTROL_ID_LENGTH } from "../../src/shared/control-address.js";
```

## What the grammar admits

Lowercase kebab-case under `bbx-`, and nothing else. The rejections are the
shapes the app used to mint: a URL-encoded card path (`%`, uppercase, a dot)
and a React `useId` value (colons).

```ts
["bbx-nav-profile", "bbx-pane-left-move", "bbx-composer-send-2"].map(isControlAddress)
=>
[
  true,
  true,
  true
]

[
  "nav-profile",
  "bbx-Nav-Profile",
  "bbx-workspace-tab-_config%2Finterface%2Fbrowse.card",
  "bbx-card-properties-:r0:",
  "bbx-",
  "",
].map(isControlAddress)
=>
[
  false,
  false,
  false,
  false,
  false,
  false
]
```

A `#`-selector is the reason: `querySelector("#bbx-composer.mic")` reads the
dot as a class, and `#bbx-card-properties-:r0:` is not a selector at all —
Chrome refuses it outright rather than matching the element `getElementById`
would have found.

## Encoding carries identity the grammar has no room for

`controlAddress` base32-encodes the value, so two identities that differ only
in case, or only in a character outside the grammar, stay two addresses.
Slugifying would collapse them onto one, and an address that names two controls
is worse than none.

```ts
controlAddress("bbx-workspace-tab", "_config/interface/browse.card")
=> bbx-workspace-tab-l5rw63tgnfts62loorsxeztbmnss6ytsn53xgzjomnqxeza

controlAddress("bbx-card-properties", ":r0:")
=> bbx-card-properties-hjzdaoq

controlAddress("bbx-settings-drive-unmount-id", "Folder_A-1")
  === controlAddress("bbx-settings-drive-unmount-id", "folder_a-1")
=> false
```

Whatever goes in, what comes out is an address — that is the whole contract, so
it is checked over the characters that motivated the encoder rather than over a
tidy sample.

```ts continue
[
  "_config/interface/browse.card",
  ":r0:",
  "Folder_A-1",
  "a card with spaces & punctuation!.card",
  "café/naïve.card",
  "",
].every((value) => isControlAddress(controlAddress("bbx-probe", value)))
=> true
```

The empty string is the one value base32 spells as nothing, so it gets a
character the alphabet does not use — an address either way, and still distinct
from every encoded value.

```ts continue
controlAddress("bbx-workspace-tab", "")
=> bbx-workspace-tab-0
```

## The length cap is where an address stops being one

Encoding costs 1.6 characters per byte, so a pathological path can outgrow the
cap the wire schema enforces. That is a control with no address — described in
words, not handed out as a link — rather than a payload the boundary rejects
whole.

```ts continue
const long = controlAddress("bbx-workspace-tab", "x".repeat(400));
[long.length > MAX_CONTROL_ID_LENGTH, isControlAddress(long)]
=>
[
  true,
  false
]
```

A path long enough to hit it is well past anything a box carries: the cap
leaves room for roughly 170 bytes under a prefix.

```ts continue
isControlAddress(controlAddress("bbx-workspace-tab", "deeply/nested/".repeat(10) + "some-card.card"))
=> true
```
