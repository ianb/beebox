# /pair-agent — share your browser with another AI agent

Honestly, less novel than I expected from the triage. Let me explain what it actually is, then say why.

## What it does

You have gstack's `$B` browser daemon running locally — a long-lived Puppeteer/Playwright session. You also have another AI agent open in a different window/runtime (OpenClaw, Codex, Cursor, Hermes, or another Claude Code session). You want that other agent to be able to drive YOUR browser.

`/pair-agent` is the handshake:

1. Creates a **one-time setup key**, 5-minute expiry, single use.
2. Prints an instruction block. **You paste it into the other agent's chat.**
3. The other agent runs the embedded commands to exchange the key for a **24-hour session token**.
4. The other agent now owns its **own tab** in your browser. Tabs are isolated — agents can't see or interfere with each other's tabs.
5. Default permissions: navigate, click, fill, snapshot, read content. **Admin permissions** (only via explicit `--admin` flag): JS execution, cookie access, storage access.

Three connection modes:
- **Same machine, supported host** (OpenClaw, Codex, Cursor, Claude): skips the copy-paste ceremony — credentials are written directly to the other agent's config directory.
- **Same machine, generic**: prints the instruction block; you paste it.
- **Different machine**: needs ngrok. Auto-detects whether ngrok is installed + authed; walks the user through install/auth if not.

## What this is *not*

It is **not** a multi-agent coordination protocol. Agents don't reason together. They don't share state. They don't divide labor. /pair-agent is just **infrastructure for sharing a browser session across agent runtimes** — agent A authorizes agent B to use a resource agent A owns.

The triage tagged it as "multi-agent coordination" which oversold it. It's closer to "OAuth device-code flow, repurposed for AI-agent-to-AI-agent handoff."

## What's worth keeping

**1. The credential handoff UX gesture.** Short-lived single-use setup key → AI prints a paste-block → user relays it to another AI → exchange for a scoped session token. The underlying flow is textbook OAuth; the novelty is the UX framing: *the human is the courier between two AIs.* That's a real pattern, even if the security model isn't novel.

**2. Capability scoping by flag.** Default = read+write but no JS/cookies/storage. `--admin` opens the rest. "Use sparingly. Only for agents you fully trust." Worth remembering as a general principle for any AI-to-AI delegation: default minimal, escalate explicitly.

**3. Tab isolation.** Each paired agent gets its own tab; agents can't observe or manipulate each other's tabs. The shared resource (browser daemon) is multi-tenant but the agents are blind to each other. Right default for cross-runtime AI handoffs.

**4. Same-machine shortcut.** If the other agent is local AND its config layout is known, write credentials directly instead of making the user copy-paste. Small UX win, but worth borrowing — when you can detect that the manual handoff is unnecessary, skip it.

## What's not worth porting

Everything tied to `$B`. Same conclusion as scrape/skillify: the whole skill is built around gstack's browser daemon as the shared resource. Without the daemon, there's no resource to share.

## Ian's take

(to be filled in — given that you've already decided against `$B`, this is probably a `skip` in practice. The credential-handoff UX gesture is the only piece worth absorbing as a general concept.)
