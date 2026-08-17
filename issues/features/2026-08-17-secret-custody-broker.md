---
title: "Secret custody: hold secrets somewhere that discloses on request, logs access, and can share between boxes"
workstream: unattached
area: callback-box
needs: [design]
labels: [security, secrets, hub, connectors]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder asking where secrets should live
---

Secrets currently sit at rest, in the clear, wherever the code that needs them
can read them. The boxholder wants something better: a place that **holds**
them, that **requires asking** rather than leaving them lying around, that can
**log access**, and that can **share a secret between boxes in limited ways** —
along with the ordinary lifecycle of recording, updating, and rotating them.

His own framing, worth keeping: *"I assume there's lots of precedence, and lots
of best practices, but this isn't my wheelhouse."* So this issue is a research
and design item before it is a build item.

## Where secrets live today — at least six places

- **Per-box connector secrets** — `content/config/connectors/*.secret.json`.
  The main store, one copy per box.
- **A machine-global credential store** — `~/.cb-auth.json` (override
  `CB_AUTH_FILE`). Notably *not* per-box: one file behind every local box.
- **Per-box capability tokens** — `.callback-box/scan-tokens.secret.json` via
  `src/core/token-store.ts` (0600, atomic replace).
- **Session secret** — `~/.cb-session-secret`.
- **Server process env** — `/home/callback/.env`, loaded as the hub unit's
  `EnvironmentFile`, and each checkout's `callback-box/.env` in dev.
- **Machine-wide dev credential** — `CB_BROWSE_API_KEY` (`core/browse-key.ts`),
  explicitly whole-machine rather than per-box.

**Sharing between boxes today is a file copy.** `deploy/add-box.sh
--secrets-from <box>` copies `config/connectors/*.secret.json` from one box to
another. That is the "sharing" mechanism, and it means N boxes hold N copies of
the same key, with no record of which boxes hold what and no way to rotate one
without finding all of them.

## The question to settle first: what is this defending against?

The design follows from the threat model, and it has not been written down.
Candidates, which imply very different systems:

- **A leaked repo or backup.** Solved by encryption at rest and keeping
  plaintext out of git — largely already true for `*.secret.json`.
- **Another user on the machine.** Solved by file modes (see
  [connector secret file modes](../bugs/2026-08-07-connector-secret-file-modes.md)).
- **A compromised or prompt-injected box agent.** This is the interesting one,
  and probably the real driver. The box agent runs with the full toolset and no
  mechanical floor — it can read any file the OS user can, which today includes
  every secret above. Related and coupled:
  [agent containment: allowed directories](2026-07-20-agent-containment-allowed-directories.md).

**An honest constraint to state up front:** an agent that can execute arbitrary
code as the box user can eventually obtain anything that box can use. So
"require asking" buys *detection, attribution, and rate-limiting* — not
prevention — unless the secret never enters the box process at all. That
distinction should be explicit in the design rather than discovered later,
because it decides whether the answer is a **vault** (hands out secrets, logs
it) or a **broker** (performs the operation, never hands out the secret).

The broker shape is worth taking seriously: the canonical precedent is
`ssh-agent`, which holds the key and answers challenges rather than disclosing
it. The analogue here would be a connector asking the hub to *make the call*
rather than to *hand over the key*. That is a much larger change, and it is the
only shape that survives a compromised agent.

## Prior art worth reading before designing

The boxholder explicitly asked for best practices rather than invention:

- **`ssh-agent` / GPG agent** — hold-and-operate, never disclose.
- **systemd `LoadCredential=` / `ImportCredential=`** — the hub already runs as
  a systemd unit with an `EnvironmentFile`, so this is the closest thing to a
  free upgrade for process-level secrets.
- **HashiCorp Vault** — leases, dynamic short-lived secrets, audit devices.
  Probably far too much machinery, but the *vocabulary* (lease, renew, revoke,
  audit device) is the right vocabulary.
- **1Password Connect / service accounts**, **AWS Secrets Manager**,
  **Kubernetes Secrets + CSI drivers** — the "sidecar fetches on behalf of the
  workload" pattern.
- **macOS Keychain** — relevant for the dev machine specifically, including its
  per-application ACL model.
- **`sops` / `age`** — encrypted-at-rest files with per-recipient keys; a much
  smaller step that would let secrets live in git.
- **OAuth token exchange / capability tokens** — narrow, expiring, auditable
  grants, which is what the existing scan-token store already approximates.

## What the design has to answer

- **Custody.** Where does the ciphertext live, and what unlocks it? If the hub
  holds it, what protects the hub's own key at rest and on boot (the unattended-
  restart problem every such system has)?
- **Granularity.** Per-box, per-connector, per-secret? Which boxes may ask for
  which secrets, and who writes that policy?
- **Disclosure.** Does the caller get the value, a short-lived derived
  credential, or only the result of an operation?
- **Audit.** What is recorded, where does it go, and who reads it? An access log
  nobody reads is theatre — pair it with something that surfaces anomalies.
- **Rotation.** The property the current copy-the-file model most badly lacks.
  Rotating a shared key today means finding every box that holds a copy.
- **Provisioning a new box**, which is where this started — see
  [per-box secret management](../decisions/2026-03-15-per-box-secret-management.md),
  which already tracks the options and records that the publishing divergence
  was resolved 2026-07-31.
- **Getting secrets in.** Complementary and already filed:
  [write-only secret capture in chat](2026-07-19-write-only-secret-capture-in-chat.md)
  — the model requests a credential and never sees the value.
- **Degradation.** Boxes must still work when the store is unavailable, or the
  whole system becomes a single point of failure for every connector.

## Research (incomplete)
