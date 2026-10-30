# G1 acceptance walkthrough: logging in through the dashboard (2026-10-30)

Gate G1 of [the shared-browser plan](../../beebox/docs/plans/shared-browser.md#implementation-order). Question: with the pinned agent-browser (0.39.2) and no beebox code, can a person log in to a site through the dashboard, can the agent then read the logged-in page, and does the login survive a restart? Run on the dev Mac with Chrome for Testing 150, headless.

## Setup

- A throwaway local server (`127.0.0.1:4870`): a sign-in form; a correct password sets a persistent cookie (`Max-Age=86400`, `HttpOnly`) and redirects to `/home`, which shows "Logged in as <name>".
- The box session: `AGENT_BROWSER_SESSION=box`, a fresh `AGENT_BROWSER_PROFILE` directory, its own `AGENT_BROWSER_SOCKET_DIR`, and `AGENT_BROWSER_CONFIG` pointing at an empty `{}` file. `agent-browser open http://127.0.0.1:4870/`, then `agent-browser dashboard start --port 4849`.
- The person: a second, separate agent-browser session opened `http://localhost:4849/`, clicked on the dashboard's live-view canvas with `mouse move`, `mouse down` and `mouse up` at the canvas position of each form field, and typed with `press`, one key per character.

## Result

| Step | Result |
|---|---|
| Dashboard shows the box session's page | yes: session "box", tab `127.0.0.1:4870`, a live canvas |
| Click into the username field through the canvas | yes: the remote page received `mousedown`/`mouseup`/`click` at the mapped point |
| Type username and password | yes: `#u` = `priya`, password length 14 |
| Click Sign in through the canvas | yes: the server logged `login attempt user=priya passLength=14` |
| Agent reads the result | `snapshot -i` gave `heading "Logged in as priya"` |
| `close`, `dashboard stop`, then `open http://127.0.0.1:4870/home` with the same profile | "Logged in as priya": the cookie survived. No process held the profile after `close`. |

The gate passes.

## What the run showed

- **Typing must be key events.** The dashboard forwards `keydown`/`keyup` while its canvas has focus (`viewport.tsx`). `press` (one key event per character, like a person typing) arrived. agent-browser's own `keyboard type` sent nothing to the remote page; it inserts text without the key events the dashboard listens for. A person typing on a keyboard produces key events, so this affects test drivers, not people. It is the same gap that blocks paste and IME composition (accepted limit).
- **Persistent cookies only.** The test cookie had an expiry. A site that keeps a login in a session cookie (no expiry) loses it when Chrome restarts, for example after the daemon's idle timeout. Most "remember me" logins use persistent cookies. Not tested.
- **The dev reaper kills box browsers.** The first attempt drove the dashboard with `bin/browse`. Its reaper (`bin/process-cleanup.ts`, `reclaimWorktreeBrowsers`) killed the box session's daemon and the dashboard as unvouched agent-browser processes from this worktree's `node_modules`. The next command started a fresh daemon on `about:blank`. Added to the plan, Track B: the reaper vouches for box browser pid files.
- **Chrome flags on macOS** include `--password-store=basic --use-mock-keychain`: the profile's cookies are not encrypted with the OS keychain. This matches [security.md](security.md) §3 for Linux.
- **Canvas size changes** with the dashboard layout (577 px tall in one run, 720 in another); the dashboard scales input by the canvas's current size, so clicks landed correctly in both.

Not covered here, and left to G2: a real site, the app's Browser menu item, the beebox proxy, and a person at a real keyboard.
