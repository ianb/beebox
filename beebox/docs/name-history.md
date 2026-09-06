# Name history

On 2026-08-30, **Callback Box** was renamed **Bee Box**. The new name is easier
to read as ordinary words and keeps the product identity distinct from its
implementation vocabulary.

**The former name was entirely an early, internal development name. No public
release was ever made under it.** Retired names remain in git history and
temporary compatibility code because development boxes and infrastructure
already carried them, not because there is a publicly released predecessor
product or a public compatibility promise to preserve.

The coordinated machine-name changes were:

| Before | After |
| --- | --- |
| `CallbackBox` / `callbackBox` | `BeeBox` / `beeBox` |
| `callback-box` | `beebox` |
| `cb` command | `bbx` command |
| `CB_*` and `CALLBACK_*` product variables | `BBX_*` variables |
| `.callback-box`, `.config/cb`, and related persisted paths | `.beebox`, `.config/beebox`, and corresponding Bee Box paths |
| `cb.ianbicking.org` | `beebox.run` |
| `ianb/callback-box` | `ianb/beebox` |

The retired command still exists as a tombstone (`beebox/bin/cb`), installed
wherever `bbx` is: it prints the rename and exits nonzero, and never forwards or
translates. Stale agent context and old scripts reach for the old name long
after the rename, and a bare command-not-found does not say where the interface
went. Forwarding would have kept those callers working indefinitely, so the
failure is deliberate. The tombstone can be removed once such calls stop
appearing.

Repository documentation, issues, examples, and generated material use the
current vocabulary. This document is the sole in-tree explanation of the old
name; git history preserves the detailed pre-rename record. Temporary migration
code may contain exact retired literals only where it must recognize existing
state.
