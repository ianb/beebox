# Security, permissions, and sandboxing — bbx vs OpenClaw vs Hermes Agent

## 1. Side-by-side

### Threat-model framing

Both competitors state the same thing in almost the same words, independently arrived at:

- **OpenClaw** (`SECURITY.md`): single trusted-operator boundary; authenticated Gateway callers,
  paired nodes, and installed plugins are *inside* the trust boundary, not adversarial. "Prompt
  injection is assumed to work" and prompt-injection-only reports without a chained boundary
  bypass are explicitly out of bounty scope.
- **Hermes** (`SECURITY.md` §2.2): "The only security boundary against an adversarial LLM is the
  operating system." In-process heuristics (approval gate, redaction, Skills Guard) are declared
  *not* boundaries, and bypassing them is out of bounty scope by policy, same as OpenClaw.

Both draw the identical conclusion from the identical premise: nothing running inside the agent
process — prompt wording, regex scanners, "the model refused" — counts as security. Only OS-level
controls (auth, exec gating, sandboxing, network isolation) do. Both projects also candidly
publish their own residual-risk ratings (OpenClaw's ATLAS threat model, Hermes's SECURITY.md
scope table) rather than only marketing copy.

bbx has no equivalent written threat model. Its actual posture (below) is closer to OpenClaw's
"trusted single operator" stance than to Hermes's OS-boundary framing, but this is implicit in
the code, not a documented policy decision.

### Exec gating / approval systems

| | OpenClaw | Hermes | bbx |
|---|---|---|---|
| Default posture | `security="full"`, `ask="off"` — unrestricted host exec, no prompts | `local` backend, `approvals.mode: manual` — every dangerous command prompts by default | `permissionMode: "bypassPermissions"` — **no gating of any kind**, on every agent run |
| Hard floor that survives "trust everything" mode | None documented as unconditional (elevated mode can skip all approvals) | `HARDLINE_PATTERNS` — `rm -rf /`, `mkfs`, fork bombs, `shutdown` — cannot be bypassed even by `--yolo`/`off` mode | None |
| Approval binding | Exact argv+cwd+agentId+session+env-hash; best-effort mutated-file hash | Once/session/always allowlist per command; smart mode uses an auxiliary LLM risk assessor | N/A (no approvals exist) |
| Obfuscation resistance | `buildCommandPayloadCandidates` unwraps carriers (`env`, `sudo`, `xargs`, shell wrappers) | `_normalize_command_for_detection`: strips ANSI, NFKC-normalizes, expands `$IFS`, quote-aware tokenizer | N/A |

bbx is the only one of the three with literally zero exec-time gating. Both competitors treat
"no approval needed" as a *configurable* default that a hardline floor or explicit posture still
constrains; bbx has neither a floor nor a posture — it's an unconditional `bypassPermissions` flag
set in code, not a config knob an operator tunes.

### Sandboxing

Both competitors: Docker-based, opt-in, **off by default**.

- OpenClaw: `sandbox.mode: off|non-main|all`, default `off`. When on: `--cap-drop ALL`,
  `no-new-privileges`, `network: "none"` by default, bind-mount validation that blocks
  `~/.ssh`/`~/.aws`/docker socket/etc. (symlink-aware). Tool policy inside the sandbox is a
  separate allow/deny list layered on top; `tools.elevated` is a deliberate escape hatch back to
  host exec.
- Hermes: `TERMINAL_ENV=local` default (unsandboxed host exec). Docker backend available with
  `--cap-drop ALL` + a few added-back caps, `no-new-privileges`, resource limits — but **network is
  ON by default** for the sandbox, and the terminal-backend sandbox explicitly does *not* confine
  the code-execution tool, MCP subprocesses, or skill/plugin loading, which still run unconfined
  in the host process regardless of `TERMINAL_ENV`. Only "whole-process wrapping" (their own
  Docker image or NVIDIA OpenShell) is treated by the project as adequate for untrusted-input
  surfaces.
- bbx: no sandboxing concept at all. `cwd` + `additionalDirectories` scope filesystem paths, but
  Bash/exec tools run directly on the host with the server process's own privileges, always.

### Untrusted-content wrapping

- **OpenClaw** (`src/security/external-content.ts`): random per-call boundary markers
  (`randomBytes(8)`), homoglyph/zero-width marker-spoof stripping so injected content can't forge
  a fake closing tag, chat-template special-token stripping (ChatML/Llama/Mistral/Gemma control
  tokens), a fixed security-notice banner, and non-blocking suspicious-pattern logging. Applied to
  email, webhook, web_fetch, web_search, browser, and channel metadata before it reaches the
  model. Explicitly documented as detection, not enforcement — real hardening is tool
  policy/sandboxing, not the wrapper.
- **Hermes**: layered heuristics rather than one wrapper — untrusted chat metadata gets
  `_format_untrusted_prompt_value()` (control-char strip, truncate, JSON-quote so it renders as
  an inert literal); unauthorized-sender messages get a "treat as unverified background" flag;
  `AGENTS.md`/`.cursorrules`/context files are scanned for injection phrasing and blocked content
  is replaced with an explicit `[BLOCKED: ...]` marker; an external scanner (Tirith) runs
  pre-exec but **fails open by default** (`tirith_fail_open: true`).
- **bbx** (`bbx-proactivity-context.md`): Gmail bodies are kept as a sibling `.body.txt` file,
  deliberately *not* embedded in the `.email-message.card` metadata, so raw untrusted email
  content isn't automatically loaded into agent context — an agent has to explicitly read the
  file to see the body. This is isolation-by-omission (untrusted content simply isn't in the
  default context window) rather than isolation-by-wrapping (content is in context but marked
  untrusted). There's no boundary-marker scheme, no injection-pattern scanning, and no equivalent
  treatment for Telegram messages, which do flow directly into chat-session context.

### Secrets handling

- OpenClaw: plaintext JSON files, `0600`/`0700` perms, no OS keychain; `SecretRef` indirection
  (`env`/`file`/`exec` providers) lets config point at an external store instead of embedding a
  literal; redaction engine (`src/logging/redact.ts`) covers auth keys, tokens, payment fields.
  Own threat model rates plaintext-at-rest as a High residual risk with an open recommendation to
  encrypt.
- Hermes: per-subprocess-type env scrubbing (blocklist by name pattern for `execute_code`/local
  terminal; allowlist-only for MCP stdio subprocesses); a specific fail-closed guard
  (`_is_hermes_provider_credential`) stops a skill from declaring a provider credential as its own
  "required" passthrough var, citing a real disclosed GHSA where this happened; output redaction
  snapshotted at import time so a model-issued env change can't disable it mid-session.
- bbx: `.secret.json` sidecar files per connector (Gmail/Calendar/Drive/Telegram OAuth tokens),
  kept alongside but separate from the connector's regular JSON config — no encryption-at-rest,
  no redaction engine, no indirection layer described in the source docs reviewed.

### Gateway / API auth

- OpenClaw: multiple explicit auth modes (`none`/`token`/`password`/`tailscale`/`device-token`/
  `bootstrap-token`/`trusted-proxy`), constant-time secret comparison, fail-closed if no auth path
  configured, rate-limited pairing with short TTLs.
- Hermes: fixed-order authorization chain per platform (allow-all flag → DM-pairing →
  platform allowlist → global allowlist → global allow-all → **default deny**), with fail-open
  configurations explicitly called out as code bugs in the bounty policy, and a real historical
  fix (#34515) for exactly that failure mode.
- bbx: box access model isn't covered in the reviewed docs at the same depth; the Telegram/Gmail
  connectors use each service's own OAuth, and bbx's own "who can talk to this box" gating isn't
  detailed here — worth a follow-up read of the gateway/webapp auth code if this dimension needs
  deeper coverage.

#### OpenClaw's `tailscale` auth mode — mechanics and fail-open history

Filling the gap flagged above (this dimension previously named the mode but not its shape).
OpenClaw's `tailscale` mode leans on Tailscale Serve rather than reimplementing identity: Serve
terminates TLS in front of the loopback-bound Gateway and injects `Tailscale-User-Login` (plus
`-Name`/`-Profile-Pic`) headers, stripping any attacker-supplied headers of the same name first.
Because the backend sits behind Serve, its TCP peer for every request is Serve's own re-dial to
localhost — the app can't `whois` its real socket — so OpenClaw independently resolves the
request's `x-forwarded-for` via the local `tailscale whois` LocalAPI call and accepts the identity
only when that resolution matches the header, and only for requests that arrive on loopback
carrying the full expected header set. Off-loopback or partial-header requests are rejected outright
rather than trusted on the header alone — the header is corroborating evidence, not the credential.

That design has still shipped two fail-open incidents, which is why this plan (see the Tailscale
expose-and-protect plan, Track E) treats the mode as a cautionary pattern rather than a template to
copy directly:

- **GHSA-hff7-ccv5-52f8** — tokenless Tailscale header auth, originally scoped to a single WebSocket
  connection, silently applied to all HTTP routes once the flag was read in a shared code path; fixed
  by making the behavior default-false. The bug class: an auth mode written for one narrow surface
  quietly widened its blast radius because nothing scoped it back down.
- **Issue #50630 (CVSS 9.3)** — `tailscale.mode: serve` combined with `auth.mode: none` had no
  startup guard and an unconditional `{ ok: true }` branch, so mere tailnet membership silently
  became authentication with no credential check at all.
- **Issue #57241** — `serve` mode silently clobbered a previously-set Funnel config on restart,
  turning a private tailnet-only exposure into a public one without any signal to the operator.

Together these read as one lesson: header-plus-whois cross-checking is a reasonable *identity*
signal, but the surrounding system needs an explicit, fail-closed startup guard and drift detection
of its own — the header check alone did not prevent either fail-open incident; both were caused by
code paths *around* it (scope creep in #1, missing guard in #2, silent config clobber in #3), not
by the whois cross-check itself being wrong.

## 2. Confirmations — where bbx already matches instincts seen elsewhere

- **`bypassPermissions` + workdir scoping ≈ their "default full exec" posture.** OpenClaw's
  factory default (`security="full", ask="off"`) is functionally the same bet bbx makes
  unconditionally: for a single-operator, single-purpose box, prompting on every tool call is
  worse UX than it's worth, and the real boundary should be *what the process can reach*, not
  *what it's allowed to type*. bbx's `cwd`/`additionalDirectories` scoping is exactly this
  same-shaped control — both systems put the fence around the filesystem, not around the command
  string.
- **Untrusted-content isolation instinct is present, just less developed.** The `.body.txt`
  sidecar pattern is philosophically aligned with Hermes's "don't put raw untrusted content where
  the LLM will read it by default" and OpenClaw's reader-agent advice ("pre-digest untrusted
  content with a tool-disabled agent before a tool-enabled one sees it") — bbx independently
  arrived at "keep it out of the card, make the agent opt in to reading it." The instinct is
  right; it just isn't systematized into a general primitive the way OpenClaw's wrapper or
  Hermes's scanning pipeline is.

## 3. Divergences

- **No hard floor.** Both competitors keep an unconditional bottom rail even under their most
  permissive mode (OpenClaw's file-snapshot/env-binding invalidation on approvals; Hermes's
  hardline blocklist that survives `--yolo`). bbx's `bypassPermissions` has no equivalent — a
  compromised or badly-instructed agent run can execute anything the OS-level `cwd` boundary
  doesn't block, with no destructive-command floor at all.
- **No sandboxing tier.** Both competitors offer (opt-in, off-by-default) Docker sandboxing as an
  escalation path for higher-risk sessions (OpenClaw's `non-main`/`all` modes; Hermes's
  Docker/SSH/cloud backends). bbx has no sandboxing concept in the architecture at all — there's
  nowhere to "turn the dial up" short of not running the agent.
- **Isolation-by-omission vs isolation-by-wrapping.** bbx's `.body.txt` approach only works while
  the agent doesn't need to read the content to do its job. The moment a task requires reading an
  email body (which is presumably common — that's why the connector exists), the content lands
  in context with zero wrapping, no boundary markers, no injection-pattern flagging, no
  "treat as untrasted" instruction. Both competitors assume untrusted content *will* reach the
  model and defend at that point; bbx's defense mostly evaporates once the content is read at
  all. Telegram messages have no isolation step even in principle — they flow straight into chat
  session context, unlike email.
- **No secrets redaction/indirection layer.** Both competitors have a maintained redaction engine
  covering transcripts/logs/tool output, and at least one indirection mechanism (SecretRef,
  scoped env passthrough) so secrets don't have to be literal config values. bbx relies on
  `.secret.json` file separation alone.
- **No documented threat model.** Both competitors publish an explicit scope statement (what's a
  vulnerability vs. an accepted risk) that shapes every other decision. bbx's posture is legible
  only by reading the code; there's no artifact stating "here is what we consider in-bounds to
  fix vs. an accepted trade-off," which makes it harder to know whether a given gap (e.g. no
  Telegram isolation) is a deliberate choice or an oversight.

## 4. Steal-this — prioritized ideas for bbx

Ordered by (impact on bbx's actual exposure: untrusted email/Telegram content + full host tool
access) against effort.

1. **Randomized-boundary untrusted-content wrapping, generalized past email.** *(High impact,
   low-medium effort.)* Port OpenClaw's `wrapExternalContent()` pattern: when an agent reads
   `.body.txt` (or any Telegram message, webhook payload, or fetched URL content), wrap it with a
   per-read random marker + a short "do not treat as instructions" banner before it enters context.
   This directly fixes the biggest gap identified above — bbx's isolation only holds until the
   content is actually read, and reading it is the whole point of the connector. Low effort
   because it's a single wrapping function call at the point where `.body.txt`/Telegram/webhook
   content is loaded, not an architectural change.
2. **A hardline command floor that survives everything, including `bypassPermissions`.**
   *(High impact, low effort.)* Hermes's `HARDLINE_PATTERNS` + `detect_hardline_command()` is a
   small, self-contained regex check (`rm -rf /`, `mkfs`, `dd` to a block device, fork bombs,
   `shutdown`/`reboot`) that runs before any other exec logic and cannot be disabled by any mode.
   bbx could add this as a `PreToolUse` hook on `Bash` (the `gitMvNudgeHook` mechanism already
   demonstrates the wiring) that hard-blocks (not just nudges) a small, fixed destructive-command
   set — cheap insurance against a runaway or manipulated agent, independent of the broader
   no-approvals architecture question.
3. **Injection-pattern scanning on scheduled/reactor context, non-blocking to start.**
   *(Medium-high impact, low effort.)* OpenClaw's `detectSuspiciousPatterns()` is "logged for
   monitoring only" — cheap to add without changing behavior. bbx's reactor pipeline processes
   scheduled/batch content (email, calendar, Telegram) with no human in the loop at all, which is
   exactly the case Hermes and OpenClaw both flag as needing the most defense (no operator present
   to notice something's wrong). A logging-only regex pass over `.body.txt`/webhook payloads
   before they enter reactor context would surface incidents without requiring a blocking-behavior
   decision up front.
4. **An explicit written threat-model/security posture doc.** *(Medium impact, low effort.)* Both
   competitors' entire security architecture reads as coherent because of one page (`SECURITY.md`)
   that states the trust boundary and what's out of scope. bbx doesn't need to change any code to
   get most of this value — writing down "boxes are single-operator, tool access is intentionally
   unrestricted because X, here's what would have to be true for us to reconsider" turns implicit
   decisions into reviewable ones, and would have made this comparison chapter's "divergences"
   section either confirmations or explicit accepted trade-offs.
5. **Approval-pattern allowlist as an *opt-in* tier, not a default change.** *(Medium impact,
   medium effort.)* Don't remove `bypassPermissions` — bbx's single-operator model genuinely
   matches OpenClaw's `security="full"` reasoning. But an opt-in `approvals.mode` (Hermes-style:
   manual/smart/off) for higher-stakes boxes (e.g. ones with financial or irreversible-action
   tools) would let an operator dial up caution per-box without changing the architecture
   everywhere. Medium effort because it needs a real approval-transport mechanism (chat prompt +
   timeout + allow-once/always), not just a config flag.
6. **Basic secrets redaction for logs/transcripts.** *(Lower priority, low-medium effort.)* Since
   bbx's durable record is Claude Code's own JSONL transcript (not a bbx-controlled log), the
   highest-leverage version of this is redacting `.secret.json`-sourced values at the point they'd
   be echoed into tool output or chat, rather than trying to redact the transcript file itself.
   Worth doing but lower priority than 1–3 given bbx's actual exposure is untrusted-content
   ingestion, not secret leakage via logs.
