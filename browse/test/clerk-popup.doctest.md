# `browse clerk-popup` and bounded `wait`

`clerk-popup` opens the Clerk's popup page by URL, so it needs the extension's
id. Chrome derives an unpacked extension's id from its absolute path: the
first 32 hex digits of the path's SHA-256, each spelled with the letters a–p.
The formula was checked against the id a real Chrome profile recorded for a
worktree's build (in its Secure Preferences); the path below is made up.

```ts setup
import { unpackedExtensionId, frontTargetScript, waitTimeoutMs } from "../src/clerk-popup.ts";
```

```ts
unpackedExtensionId("/srv/beebox/beebox-clerk/dist-browse/chrome-mv3")
=> aefhjangknhldlihokiojaajoegnlaoh
```

The script that fronts the target embeds its URL as a JSON string, so a
quote in the URL cannot end the string early.

```ts
frontTargetScript('http://localhost/a"b').split("\n")[1].trim()
=> const target = tabs.find((tab) => tab.url === "http://localhost/a\"b" && !tab.url.startsWith("chrome-extension://"));
```

A `wait` always ends: upstream ignores `wait --timeout` outside download mode
and would poll forever, wedging the daemon. The wrapper turns `--timeout`, or
30 seconds, into the default action timeout that does bound it.

```ts
[waitTimeoutMs(["--text", "Filed"]), waitTimeoutMs(["--text", "Filed", "--timeout", "180000"])]
=> [30000, 180000]
```

```ts
(() => { try { return waitTimeoutMs(["--timeout", "3s"]); } catch (error) { return error.message; } })()
=> wait --timeout is not a positive integer: 3s
```
