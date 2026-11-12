# A browser that holds the person's logins and is driven by an agent (2026-10-29)

Question: a box runs a Chromium that the person logs into (email, banking, shops) and the box agent (Claude Code or Codex CLI) then drives. What can go wrong, and which mechanism limits each failure? This note is a dated snapshot. Companion: [site-reality.md](site-reality.md).

Setting: one Linux server at Hetzner, each box a Unix user, a web app for desktop and phone, and an experimental Mac app that runs the beebox image in a VM.

Evidence tags: **[doc]** primary vendor or project document; **[test]** published measurement with stated method; **[claim]** blog or vendor marketing; **[unverified]** no source found, reasoning only.

## 1. Prompt injection through web content

### Published rates

| Source | Setup | Result |
|---|---|---|
| [Anthropic, Claude for Chrome pilot, Aug 2025](https://claude.com/blog/claude-for-chrome) [doc] | 123 test cases, 29 attack scenarios | 23.6% attack success without mitigations; 11.2% with them in autonomous mode. A four-type browser-specific set went from 35.7% to 0% (hidden form fields, injections in URL text and tab titles) |
| [Anthropic, prompt-injection defenses, Nov 2025](https://www.anthropic.com/research/prompt-injection-defenses) [doc] | Internal adaptive Best-of-N attacker, 100 attempts per environment, 2,200 to 3,200 attempts per bar | Opus 4.5: 8.0% model only, 7.6% old safeguards, 1.4% improved safeguards. Sonnet 4.5: 13.8%, 10.8%, 1.9%. Haiku 4.5: 12.0%, 11.1%, 2.4% |
| Opus 4.8 system card, May 2026 (via [secondary summary](https://dev.to/agentshield/anthropic-published-a-315-hijack-rate-most-vendors-wont-even-show-you-a-number-7d6)) [claim, not checked against the card] | 129 held-out web environments, adaptive attacker | 31.5% raw, 0.5% with safeguards. The safeguarded figure applies to Anthropic's own integration, and no number was published for a developer's own agent on the API |

Anthropic's text says no browser agent is immune and that the numbers come from its own attacker, not an external evaluation. A box agent running Claude Code over a browser tool does not get the classifiers that run inside Claude for Chrome, so the "model only" row (8% to 14% in the Nov 2025 table, 31.5% in the 2026 report) is the closer figure. The Nov 2025 and May 2026 numbers differ by model and test set and do not compare directly.

### Findings against other products

- Brave showed that Perplexity Comet passed page text to its model without separating the user's request from page content. Hidden text (white on white, HTML comments, a Reddit comment behind a spoiler tag) made the agent read the user's email address from an account page, start a one-time-password login on a lookalike domain, read the code from the user's logged-in Gmail, and post both back to the attacker. Brave's point: same-origin policy and CORS do not help, because the agent acts with the user's access on every site. Brave later reported that the first fix was incomplete ([Brave](https://brave.com/blog/comet-prompt-injection/), [doc]; follow-up on invisible text in screenshots via [Simon Willison](https://simonwillison.net/2025/Aug/25/agentic-browser-security/)).
- OpenAI states prompt injection is unlikely ever to be fully solved. For Atlas it offers logged-out mode (agent acts without the user's credentials), and watch mode on sensitive sites (the tab must stay in the foreground, and the agent pauses when the user leaves). Simon Willison reported that GitHub and an online banking site did not trigger watch mode, and Atlas kept navigating after he switched applications ([Willison on the OpenAI CISO post](https://feeds.simonwillison.net/2025/Oct/22/openai-ciso-on-atlas/), [Zenity Labs](https://labs.zenity.io/p/hardening-atlas-the-relentless-challenge-of-securing-an-untrusted-browser-agent)). OpenAI trains an automated attacker with reinforcement learning to find injections. Zenity's critique: confirmations are not deterministic, and users face approval fatigue.
- Google describes a layered design for Gemini in Chrome (December 2025): a User Alignment Critic, a second model that sees only metadata about a proposed action and vetoes actions that do not serve the user's goal; Agent Origin Sets, which split origins per task into read-only and read-write sets and check model-generated URLs against a list of public URLs to block exfiltration; a prompt-injection classifier; and explicit user approval for banking, medical sites, stored credentials and purchases ([Google](https://blog.google/security/architecting-security-for-agentic/), [doc]). The Critic pattern follows the dual-LLM idea and Google DeepMind's CaMeL work.

### Mitigations seen in practice, and what each costs

| Mitigation | Who uses it | Limit |
|---|---|---|
| Per-site permission list; blocked categories (finance, adult, piracy) | Claude for Chrome | A person who wants the agent on a bank must override it |
| Confirmation before consequential actions (publish, purchase, share personal data, send mail) | Claude for Chrome, Atlas, Chrome | Fatigue; the model decides what is consequential unless a deterministic rule decides |
| Logged-out mode | Atlas | The agent cannot use the person's accounts, which is the beebox use case |
| Watch mode | Atlas | The agent stops when the person looks away; gaps reported on GitHub and a bank |
| Separate, minimal-permission agent browser, apart from the person's normal browser | Brave's recommendation | The beebox browser is that separate browser already |
| Independent action check by a second model | Google Critic | Added model cost; Google shows no public rate |
| Origin sets: read-only versus read-write origins per task | Google | Needs task scoping logic |
| Agent never sees typed passwords | Password-manager integrations; beebox design choice | Needs the person to type into the browser itself, not through the agent |
| Action log | Common practice | Detects, does not prevent |

Mechanisms that are deterministic (not decided by a model): site allow and deny lists, per-origin read/write sets, egress firewall rules, and a hard confirmation gate on named action types (form submit on a payment host, mail send). Model-based layers (training, classifiers, critics) lower rates but give no guarantee.

## 2. Keeping the browser inside its box

### 2.1 Chromium sandbox under an unprivileged user

- Chromium's Linux sandbox has two layers. Layer 1 isolates resources (PID and network namespaces through user namespaces or a setuid helper). Layer 2 cuts kernel attack surface with seccomp-BPF ([Chromium sandbox README](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/sandbox/linux/README.md), [doc]; the documentation across versions disagrees on the setuid helper's current role, so check the version in use). `chrome://sandbox` reports which layers are active.
- Docker's default seccomp profile blocks the namespace calls the sandbox needs, so people pass `--no-sandbox`, which removes both layers. Guidance on `--no-sandbox`: unsafe for any browser that opens untrusted pages ([Puppeteer sandbox note](https://puppeteer-guide.pages.dev/posts/sandbox/), [claim]). Elastic's Kibana docs take the opposite view for trusted content, since the container supplies its own seccomp and AppArmor ([Elastic](https://www.elastic.co/guide/en/kibana/8.15/reporting-production-considerations.html), [doc], vendor position for trusted pages).
- The alternatives people use: a custom seccomp profile that allows the namespace calls (narrower than `unconfined`), or `--cap-add=SYS_ADMIN` (broader; a commenter notes it undercuts the sandbox).
- beebox browses attacker-influenced pages with the person's logins loaded, so run with the sandbox on. Boxes are Unix users on one host, not containers, so the namespace route applies directly if the kernel allows unprivileged user namespaces. Some distributions restrict them (Ubuntu 23.10 and later add an AppArmor restriction; [unverified] in this pass, from general knowledge). Check `chrome://sandbox` on the real host and record the result.
- A renderer escape under the sandbox lands as the box's Unix user. That user already owns the box's files and secrets, so the Unix user boundary is the second line, and the Chromium sandbox protects the browser profile from the page content.

### 2.2 The browser as an SSRF proxy

A page in the browser can request any URL the browser can reach, and so can an injected agent that is told to navigate. On the server that includes:

- the server's loopback services (the beebox web app, other boxes' ports if they bind loopback);
- other boxes' ports on a shared interface;
- the Hetzner cloud metadata service. Hetzner Cloud servers serve instance metadata at `169.254.169.254` ([unverified] in this pass; confirm in Hetzner's docs and check what it holds);
- private network ranges, and the router or LAN on the Mac app.

Controls, all deterministic:

- Per-uid egress rules: `nftables` or `iptables` owner matching (`meta skuid`) on the box user's browser processes, allowing public addresses only and dropping loopback (except the browser's own sockets), link-local, RFC 1918 and metadata. [unverified] as a beebox design; the mechanism is standard Linux.
- Chromium proxy settings that route traffic through a filtering proxy which resolves DNS itself and blocks private results. This stops DNS rebinding, where a public name later resolves to `127.0.0.1`. A per-uid firewall rule also catches the final connect and covers rebinding.
- On the Mac app, block the VM's access to the host's LAN with the VM network configuration.
- `--host-resolver-rules` and enterprise URL block lists (`URLBlocklist` policy) deny named schemes and hosts. Block `file://` for the box user so the page cannot read the box's files through a file URL.

### 2.3 CDP exposure

- The DevTools protocol has no authentication. A process that can reach the debugging port can read cookies, run scripts in any tab and drive the browser. A browser on localhost is open to every local process; the port is not a security boundary on a multi-user host ([lorca issue](https://github.com/zserge/lorca/issues/43), [Mozilla remote-agent security note](https://github.com/mozilla/gecko-dev/blob/81c32a2ea5605c5cb22bd02d28c362c140b5cfb4/remote/doc/Security.md), [doc]). Binding to `0.0.0.0` exposes the browser to the network. `--remote-allow-origins` controls which web origins can open the WebSocket (Chrome 111 and later); `*` allows any ([claim], search summary).
- Each box is a Unix user on a shared host. A TCP debugging port on loopback is reachable by every other box's user. That crosses the box boundary directly.
- `--remote-debugging-pipe` gives CDP over inherited file descriptors with no listening socket. Only the parent process that spawned Chromium holds the pipe. Chrome documents both switches in its Chrome 136 change ([Chrome for Developers](https://developer.chrome.com/blog/remote-debugging-port), [doc]). For beebox: a per-box broker process owns the pipe and exposes the agent's tool surface over a Unix domain socket with mode 0600, owned by the box user. Chromium has no native CDP-over-Unix-socket switch [unverified: not found in a source]; the broker supplies it.
- If a TCP port is needed (for existing tools), bind `127.0.0.1` on a network namespace unique to the box, or use a port reachable only through a socket proxy the box user owns.
- Chrome 136 ignores the debugging switches on the default profile directory, which stops infostealers from reading Chrome's own profile. beebox uses a dedicated directory, so the switches work ([doc]).

### 2.4 Live-view authentication

The person sees and clicks the browser from the web app (desktop and phone). That stream is an input channel to a browser that holds logged-in sessions.

- Authenticate the stream with the same session as the web app, scoped to one box. A WebSocket upgrade needs an origin check and a per-box token. VNC-style relays without per-session tokens are the usual failure; one write-up states "no public VNC ports" as a rule and uses signed pairing tokens ([rtrvr.ai](https://www.rtrvr.ai/blog/live-vnc-takeover-serverless-chrome), [claim]). Another tool offers a password on the live view and states that takeover does not bypass its network policy ([betterwright docs](https://cdn.jsdelivr.net/npm/betterwright@2.9.0/docs/live-view.md), [claim]).
- Hosted services return a live-view URL at session creation ([Browserbase via MemberJunction docs](https://docs.memberjunction.org/packages/ai/remotebrowser/providers/browserbase/), [claim]). That URL acts as a bearer token; treat any equivalent as one: short-lived, bound to the session, not logged.
- Embedding the live view in a frame needs `frame-ancestors` and `X-Frame-Options` set so only the beebox origin embeds it. No source covered this; [unverified].
- Keyboard input from the person must reach the page, and keystrokes in a password field must not reach the agent's log or context. Send person input to the browser on a path that skips the agent's transcript.

## 3. Profile and secret storage

- A Chromium profile on disk holds cookies, saved logins, local storage and the history. On Linux, Chromium encrypts cookies and passwords with a key from the OS: with the `basic` store the key is a fixed string (v10 prefix, the password `peanuts`), so encryption is obfuscation. With a keyring (libsecret or GNOME Keyring, KWallet) the key lives in the keyring (v11 prefix) ([Chromium docs on Linux password storage](https://chromium.googlesource.com/chromium/src/+/490631eda4ce00a02f5e599b95adfe058493a00a/docs/linux/password_storage.md), [doc]; the key details come from [a walkthrough](https://dev.to/setevoy/chromium-linux-keyrings-secret-service-passwords-encryption-and-store-4m62) and [yt-dlp's decryptor](https://jfr.im/git/yt-dlp.git/commitdiff/b38d4c941d1993ab27e4c0f8e024e23c2ec0f8f8), [claim], and may have changed since).
- On a headless server, a keyring daemon needs an unlocked login session. Unlocking it with a password stored beside the profile gives nothing over `basic`. Anyone who can read the profile files as the box user can decrypt `basic` data; a keyring adds a barrier only against an attacker who reads files without running as that user (a backup copy, a stolen disk).
- Attackers that matter: another box user (blocked by file mode 0700 and separate uids), a backup that leaves the host, a process of the same box (including an injected agent running shell commands as that user: it can read the profile directly).
- The last case needs an explicit decision. The box agent runs shell as the box's Unix user, the same user that owns the profile. An injected agent can `cat` the cookie database. A separate Unix user for the browser (agent user cannot read it) closes this and moves the agent to the broker's tool surface only. That also keeps typed passwords away from the agent. Cost: a second uid per box and a broker that crosses between them.
- Keep the profile out of the box's git repository and out of per-box backups that leave the host: place it under a state directory (for example `~/.local/state/`) listed in the repository's ignore rules and in the backup exclusions. Production boxes live on a volume at `/var/lib/beebox` with snapshots excluding it, per project notes; confirm the profile path sits on the same excluded volume. See [box-backups](../box-backups/) for the existing backup design.
- Disk encryption at rest protects a detached volume or snapshot. It does not protect against a running process. [unverified] whether Hetzner volumes are encrypted for this deployment; LUKS on the volume is the standard control.
- Cookies in the person's real browser use App-Bound Encryption on Windows. Linux Chromium has no equivalent, so a copied profile directory is the entire login state. Chrome's own 136 change targets cookie extraction via debugging, not file copy.
- Session fixation across IPs: a stolen cookie replayed from another IP may trigger re-authentication on some sites ([unverified]). Do not count on it as a control.

## 4. Resource cost of Chromium

Figures differ by method. None comes from beebox's workload.

| Figure | Method | Source |
|---|---|---|
| About 150 MB resident right after launch, before any URL | Production worker description | [rendershot](https://dev.to/rendershot/headless-chromium-at-scale-four-fixes-for-a-fleet-that-kept-eating-ram-1mdp) [claim] |
| Fifty tabs in one browser about 8 GB, about 160 MB per tab | Same author's estimate | same |
| Resident memory creeping to 1.5 GB by hour 8, OOM kills by hour 24; hourly browser restart as the fix | Same fleet | same |
| One 8K full-page screenshot about 2 GB RSS | Same fleet | same |
| Playwright Chromium peak 1,094 MB standard, 706 MB headless, 690 MB minimal | `memory_profiler`, driver process plus browser, idle 5 s after launch, peak | [datawookie, June 2025](https://datawookie.dev/blog/2025/06/playwright-browser-footprint/) [test, small] |
| 50 to 150 MB per idle instance, 200 to 800 MB active, 150 to 300 MB per tab | FAQ-style ranges | [webscraping.ai](https://webscraping.ai/faq/headless-chromium/what-are-the-resource-requirements-for-running-headless-chromium-at-scale) [claim] |
| Idle tab about 50 to 100 MB | Vendor doc | search summary, [claim] |
| Memory Saver frees inactive tabs: "up to 30%" or "up to 40%" in launch coverage | Chrome product claim; Google's post was not located | [TechCrunch](https://techcrunch.com/2022/12/08/chrome-gets-memory-and-energy-saver-modes), [claim] |

Reading, for a headful browser with a person and a handful of tabs: budget 0.5 to 1 GB resident for the browser with two to four tabs, plus Xvfb and the screencast encoder, and 1.5 to 2 GB when a heavy page or screenshot is open. Pages with video, ads and large SPAs sit at the high end. No source measured headful Chromium under Xvfb with a screencast; measure it on the Hetzner host before sizing.

Containers and shared memory: `/dev/shm` at 64 MB crashes renderers; use `--shm-size` of 1 GB or `--ipc=host`. `--disable-dev-shm-usage` moves the data to `/tmp`, and tmpfs `/tmp` returns it to RAM without a size cap ([DEV article](https://dev.to/ironsoftware/playwright-memory-and-performance-issues-issue-fixed-3hnf), [claim]). Boxes as Unix users on one host need a per-uid cgroup memory limit (systemd `MemoryMax` on a user slice) so one box's browser cannot starve the others; there are no cgroup limits per browser context ([claim]).

Idle suspension for beebox: close the browser after a quiet period and relaunch from the persistent profile. Cookies and logins survive. Open tabs need a saved list to restore. Tab discarding inside a running Chromium reclaims inactive tabs but keeps the browser and GPU processes (30 to 40% claim above). Hourly or daily restart handles the creep. One browser per box when active, none when idle, is the lowest-cost shape.

## 5. Threats for beebox and controls

Each control names the mechanism that enforces it.

| # | Threat | Control | Mechanism |
|---|---|---|---|
| 1 | Injected page makes the agent act in the person's logged-in sessions (send mail, read mail, buy, post) | Hard confirmation gate on named action classes; site allow list for agent actions; read-only mode for sensitive origins | Deterministic gate in the broker between agent and CDP (match on URL origin and action type); person approval in the web app on the live view; origin sets as in Chrome's design |
| 2 | Injected agent exfiltrates data (page content, cookies, one-time codes) to an attacker URL | Egress allow list for the box user; block navigation to model-generated URLs outside the task's origin set; no agent access to cookie storage | Per-uid nftables rules; URL check in the broker; CDP `Storage.*` and `Network.getCookies` not exposed through the agent tool surface |
| 3 | Browser or agent reaches loopback services, other boxes or cloud metadata (SSRF) | Per-uid egress deny for loopback, link-local, RFC 1918, metadata; filtering proxy that resolves DNS | `meta skuid` rules; proxy with private-address block; `URLBlocklist` for `file://` |
| 4 | Another box (or any local process) connects to this box's CDP port | CDP over `--remote-debugging-pipe` to a broker; broker exposes a 0600 Unix socket owned by the box user | Inherited file descriptors (no listening socket); filesystem permissions on the socket |
| 5 | Same-box agent or an escaped renderer reads the profile (cookies, saved logins) | Profile under a state directory readable only by a browser Unix user; sandbox on; agent talks to the broker only | Unix uid separation; Chromium user-namespace and seccomp sandbox (`chrome://sandbox` check); no `--no-sandbox` |
| 6 | Profile leaks through git, backup or snapshot | Profile outside the box repo, in ignore rules and backup exclusions; encrypted volume | Path placement under `~/.local/state/` or the excluded volume; LUKS on the data volume |
| 7 | Unauthenticated or cross-box access to the live view | Per-box, short-lived signed token plus origin check on the WebSocket; frame-ancestors limited to the beebox origin | Token verified at the web app's proxy route; CSP `frame-ancestors`; no public VNC/noVNC port |
| 8 | Typed passwords reach the agent's transcript or logs | Person input goes to the browser directly; password fields masked in screenshots and DOM dumps sent to the model | Separate input path from the live view to CDP `Input.*`; redaction of `type=password` values in the broker's page-text and screenshot output |
| 9 | One box's browser exhausts RAM or CPU | Per-uid memory and CPU limit; idle shutdown; hourly restart | systemd `MemoryMax`/`CPUQuota` on the user slice; idle timer in the broker |
| 10 | Account lockout or ban from automation on a shared datacenter IP | Person logs in first in the shared browser; agent actions rate-limited; consider home relay or the Mac path | Order of operations in the handoff flow; broker rate limit; see [site-reality.md](site-reality.md) |
| 11 | Silent misuse with no trace | Action log of every agent step (URL, action, target, outcome) kept outside the profile, shown to the person | Append-only log written by the broker; surfaced in the web app |
| 12 | Browser and extension supply chain (a Chromium build with unpatched bugs, a stealth patch set from a third party) | Track Chromium stable releases; no third-party patched browser binaries | Package updates on the image; pin to upstream builds |

Open questions to answer before design:

1. Does the host allow unprivileged user namespaces for the box users? (run `chrome://sandbox` on the Hetzner host)
2. Does a separate browser Unix user per box fit the Unix-user-per-box model, and who runs the broker?
3. Which action classes get a hard confirmation gate by default (send, post, pay, delete, change credentials), and does the person set the list per site?
4. How much RAM per active box does headful Chromium plus screencast use on the real host?
5. Does the Mac app VM isolate the guest from the host LAN by default?
