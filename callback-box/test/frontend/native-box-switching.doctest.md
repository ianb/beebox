# Native-shell box switching

The native app pairs each WebView to one box. The place menu still names that
box and supports navigation inside it, but it must not offer the web root's
cross-box selector. The native shell's own box menu owns that operation.

```ts setup
import { webBoxSwitchingAvailable } from "../../src/frontend/src/lib/native-shell-navigation.js";
```

In a normal browser, the box panel offers the root box selector:

```ts
webBoxSwitchingAvailable(false)
=> true
```

Inside a native shell, that cross-box row is absent:

```ts
webBoxSwitchingAvailable(true)
=> false
```
