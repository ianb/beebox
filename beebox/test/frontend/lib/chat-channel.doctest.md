# Which surface the client says it's sending from

The `<chat-app channel>` attribute is decided by the browser, not guessed from
the User-Agent, because the UA cannot see the one distinction that changes what
the agent should say: inside the iOS shell the WebView carries an ordinary
iPhone UA, so a server-side guess reports the native app as mobile web and the
agent goes on to describe a composer that isn't in the page.

`chatChannelFor` is the whole decision, as a pure function of two observations:
is the native bridge present, and is the viewport at or above the `sm`
breakpoint the layouts switch on.

```ts setup
import { chatChannelFor } from "../../../src/frontend/src/lib/chat-channel.js";
```

The native shell wins over the viewport — an iPad-width native window is still
the app, with native chrome around the page:

```ts
[
  chatChannelFor({ nativeShell: true, wideViewport: false }),
  chatChannelFor({ nativeShell: true, wideViewport: true }),
].join(" ")
=> ios-native ios-native
```

Plain web splits on the breakpoint:

```ts
[
  chatChannelFor({ nativeShell: false, wideViewport: true }),
  chatChannelFor({ nativeShell: false, wideViewport: false }),
].join(" ")
=> web-desktop web-mobile
```
