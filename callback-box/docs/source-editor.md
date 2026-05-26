# Source Editor Plan

## Overview

A web-frontend editor that edits a file's raw text source. Surfaces alongside the existing "Plaintext" view as another renderer in the FileView toggle. Works for any text file in the box, including `.card` XML.

The editor is decoupled from the save pipeline: the view is just a buffer; **Stage** and **Save** are the only ways content reaches disk.

## Key Design Decisions

### Editor library: textarea first, CodeMirror later

- Start with a styled `<textarea>`. Plaintext editing covers the immediate need; textarea is trivial to control, accessible, SSR-safe, no bundle cost.
- Promote to CodeMirror 6 once syntax highlighting (XML for `.card`, markdown bodies) becomes worth the weight. The renderer interface stays the same — only the inner widget changes.
- Word wrap is required in both:
  - textarea: default `wrap="soft"`; ensure no `white-space: pre` rule overrides it; set `overflow-wrap: anywhere` so long unbroken tokens (URLs, base64) don't blow out the layout.
  - CodeMirror 6: include `EditorView.lineWrapping` in extensions.

### Two save semantics: Stage and Save

Two buttons, distinct on-disk effects.

| Action | Writes to disk | Commits | Validation behavior |
|--------|----------------|---------|---------------------|
| **Stage** | yes | no | warning only; never blocks |
| **Save**  | yes | yes | for `.card`: blocks on validation failure (errors inline, draft preserved). For non-card text: just writes + commits. |

Stage exists so the user can write something invalid or unfinished, leave it on disk, and hand it off to a chat agent to fix and finish. The user explicitly triggers that chat — Stage itself does not notify any agent.

A Staged file lives as a normal dirty working-tree change. The agent picks it up the next time it commits in that directory; no special queue.

### "Save" really means save

No autosave-and-commit. The buffer is purely client-side until Stage or Save is clicked. The page can be closed without ever touching disk.

### Crash cache (browser-local draft)

- Keyed on `${boxSlug}:${path}` in `localStorage`.
- Stored as `{ baseHash, draft, savedAt }` where `baseHash` is the hash of the file content at the time the buffer was opened.
- Updated on every keystroke (debounced, e.g. 250ms).
- Cleared on successful Stage or Save, and on explicit Discard.
- On open, if a draft exists for the current path:
  - If `draft.baseHash` matches the loaded file's hash → offer "Restore unsaved changes from \<time\>?".
  - If it doesn't match (file changed under us) → still offer restore, but mark conflict explicitly: "The file has changed since these edits were made. Restore anyway? View original?"
- IndexedDB is overkill — drafts are small, one per path.

### Conflict detection on Stage / Save

- When the buffer is opened, capture `baseHash` (and `version` for cards).
- Send `baseHash` (and `baseVersion`) to the server with Stage/Save.
- If the server's current hash/version disagrees, refuse the write and surface the diff to the user. They pick: discard mine, overwrite, or merge by hand.
- `useFileData` already subscribes to file-change SSE; the editor uses that to show a "file changed on disk" banner *while* editing, before the user even hits Stage.

### Validation flow for cards

1. Client-side, on Save click: parse XML in the browser. If parse fails, show the error inline and bail — no round-trip.
2. POST to server. Server runs full schema validation via the loader.
3. On Save with validation failure: response is `{ ok: false, error }`; nothing is written; the editor shows the error and keeps the draft.
4. On Stage with validation failure: response is `{ ok: true, warning }`; the file is written; the editor shows the warning but the buffer is now considered clean.

### Visible "staged, not committed" state

A file with uncommitted working-tree changes needs a UI marker so users don't lose track. Add a small badge ("Staged") to FileView headers and the file browser when the working tree is dirty for that path. SSE file-change events get a `dirty: boolean` field, or a separate query backed by `git status`.

## Endpoints

One mutation per file kind, both with `mode: "stage" | "save"`.

### Cards

```
card.write({ path, source, baseVersion, mode })
  → { ok: true, version, status, warning? }
  | { ok: false, error: ValidationError, currentVersion? }
```

- Reuses the existing loader/save path for the commit step.
- Distinct from `card.patch` (which stays op-based for renderer-driven edits).
- On `mode: "save"` + validation failure → `{ ok: false }`, no write.
- On `mode: "stage"` + validation failure → `{ ok: true, warning }`, written, not committed.
- `baseVersion` mismatch → `{ ok: false, error: "version-conflict", currentVersion }`.

### Non-card files

```
files.write({ path, content, baseHash, mode })
  → { ok: true, hash, warning? }
  | { ok: false, error, currentHash? }
```

- New tRPC mutation (not `PUT /api/files/*`) so error surfaces and auth match the rest of tRPC.
- `mode: "save"` writes + commits via the same commit helper used elsewhere.
- `mode: "stage"` writes only.
- `baseHash` mismatch → version-conflict error.

## Renderer registration

A new renderer named `Edit` (or `Source (edit)`) registers for the same set of paths the Plaintext renderer matches, plus `.card`. Priority is below the default view but above plaintext, so the user opts in by selecting it from the toggle — it does not become the default.

```
registerFileRenderer(
  matchEditableTextOrCard,
  { name: "Edit", Component: SourceEditor, priority: 5 },
);
```

## Component sketch

```
SourceEditor({ data, onNavigate })
  buffer, setBuffer            // uncommitted text
  baseHash, baseVersion        // captured on mount
  draft = useDraft(path)       // localStorage hook
  validation = useCardValidation(buffer, isCard)  // client-side parse for warnings
  dirty = buffer !== data.content/xml

  Stage button:  disabled if !dirty,  shows warnings if validation fails
  Save button:   disabled if !dirty,  blocks (with error) if isCard && !validation.ok
  Discard button: clears draft, resets buffer to data
```

Outer chrome (Stage/Save/Discard buttons, draft-restore banner, conflict banner, validation messages) is the editor's job. The textarea/CodeMirror is the inner widget.

## Phased build order

1. **Non-card text editor only.** New `Edit` renderer for non-card text files. `files.write` mutation. Stage + Save buttons. Crash cache. Word-wrapped textarea.
2. **Conflict detection.** `baseHash` checks server-side; "file changed on disk" banner via existing SSE.
3. **Cards.** `card.write` mutation. Client-side XML parse for inline warnings. Server-side schema validation. Save-blocks-on-error / Stage-warns-only.
4. **Staged-state badge.** Surface "Staged" in FileView headers and the file browser.
5. **CodeMirror upgrade (optional).** Swap the inner widget for CodeMirror 6 when syntax highlighting is wanted. Editor outer chrome stays the same.

## Open Questions

- **Keyboard shortcuts.** ⌘S → Save? ⇧⌘S → Stage? Or only buttons, to keep semantics deliberate? Probably buttons-only at first; revisit once usage settles.
- **Discard behavior.** Does Discard also clear the crash-cache draft (yes), and does it confirm first if the draft is non-trivial?
- **Stage of brand-new files.** Out of scope for v1 — editor only edits files that already exist. Creation flows live elsewhere.
- **Multiple editors open on the same file.** Last-write-wins per the conflict-detection rules above; no realtime collaboration.
