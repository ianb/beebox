# Name history

On 2026-08-30, **Callback Box** was renamed **Bee Box**. The new name is easier
to read as ordinary words and keeps the product identity distinct from its
implementation vocabulary.

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

Repository documentation, issues, examples, and generated material use the
current vocabulary. This document is the sole in-tree explanation of the old
name; git history preserves the detailed pre-rename record. Temporary migration
code may contain exact retired literals only where it must recognize existing
state.
