# Exhibits: the page contract

An **exhibit** is a directory you create; the app renders it. It is how an agent
shows work to the developer — rendered documents, labeled screenshots, small
interactive pages — with an explicit **ask** on every item. Design and
vocabulary: `callback-box/docs/plans/workstream-exhibits.md`.

## Create one

```
<worktree>/exhibits/<name>/        # a symlink into the persistent store
  exhibit.json                     # required
  doc.md                           # optional prose, rendered with Markdoc
  shot.png                         # figures, referenced from the manifest
  index.tsx                        # optional: your own page
  index.html                       # optional: a vanilla page instead
```

`<worktree>/exhibits` is a symlink to `<parent>/workstream-exhibits/<workstream>/`.
Content survives a worktree cull; removing the worktree removes only the link.

`bin/exhibits add --title <t> --ask <type> --prose <p> [--option <label>]…
[files…]` does all of that: it derives the workstream from the checkout you run
it in, copies the files in, labels the figures `A1`, `A2`, … in argument order,
and prints the URL — one line on stdout, so it pastes straight into chat. Write
the directory by hand when you want something the CLI does not do; the contract
is the files, not the tool.

`exhibit.json`:

```json
{
  "title": "Dashboard density options",
  "ask": {
    "type": "decide",
    "prose": "Pick a density; I will apply it to every card list and delete the others.",
    "options": ["Comfortable (A1)", "Compact (A2)"]
  },
  "created": "2026-08-15T18:00:00Z",
  "figures": [
    { "label": "A1", "file": "comfortable.png", "caption": "Current spacing" },
    { "label": "A2", "file": "compact.png", "caption": "Two lines tighter" }
  ]
}
```

The manifest is Zod-validated. A directory with content but no usable manifest
renders an error page naming the file and the issues — never a bare listing.
Every exhibit carries exactly one ask.

## Ask types, and using them honestly

| Type | Means | The developer does |
|---|---|---|
| `decide` | Pick among the enumerated `options` | Chooses one |
| `confirm` | You are proceeding unless told otherwise | Vetoes if wrong |
| `react` | You want impressions | Writes freeform |
| `fyi` | Nothing is needed | Reads, or does not |

The queue only works if the type is honest — `fyi` is not a dumping ground and a
real decision tagged `fyi` is a decision that never gets made. The ask's prose
says what happens *after* each answer. Figures get short labels (`A1`, `B3`) so
feedback in chat can address them precisely.

## Writing a good exhibit

- **The ask is honest, and it says what happens next.** The prose states the
  consequence of each answer ("pick a density; I apply it everywhere and delete
  the other"), not just the question. An over-applied tag rots the queue it
  feeds — the `manual-testing` flag did exactly that
  ([2026-07-29](../../issues/decisions/2026-07-29-manual-testing-flag-overuse.md)):
  once a marker stops meaning anything, the human stops reading it. `fyi` is the
  one with no cost to the developer, so it is the one that tempts.
- **Figures get labels and captions.** The label is the handle feedback uses;
  the caption says what to look at. Two screenshots with no captions are a
  spot-the-difference puzzle you are asking the developer to solve.
- **Present it live, in label terms.** When the developer is in chat, run
  `bin/exhibits add --open`: they get the page, you get to say "A3 has too much
  white space" and be understood. `bin/exhibits list` is the other half — a
  later session runs it to find which asks came back answered.

## The three page tiers

One mechanism, three levels of effort:

1. **No `index.tsx` / `index.html`** — the default renderer: the ask header,
   `doc.md`, the manifest's figures as labeled images, and a working
   disposition control (it writes `data/disposition.json` and appends an
   event). Most exhibits want exactly this.
2. **`index.html`** — served as-is, scripts allowed. Sibling files (`data.json`,
   images) are served from the directory, so relative `fetch` works. Namespace
   your `localStorage` keys: the whole origin shares them.
3. **`index.tsx`** — default-export a React component. It renders inside the
   container (shell, breadcrumb, ask header), with React 18, Tailwind, and the
   client below already provided. Drop the file in; no build step, no
   registration, HMR picks up edits.

Page *source* is never served as content: `.ts`/`.tsx`/`.jsx` requests are
refused, and paths cannot leave the exhibit directory.

## The client

```tsx
import { EventLog, Storage, postCapture } from "@exhibits/client";

const settings = new Storage<Settings>("settings");   // data/settings.json
await settings.save({ threshold: 0.4 });
const current = await settings.load();                // null if never saved

const ratings = new EventLog<Rating>("ratings");      // appended to events.jsonl
await ratings.append({ figure: "A1", verdict: "too sparse" });

await postCapture("sample-01.webm", blob);            // captures/sample-01.webm
```

The type parameter is **compile-time only** — the server stores schema-agnostic
JSON. Pass a schema when a page needs a runtime guarantee:
`new Storage("settings", { schema })`.

Documents are replaced atomically, so a reader never sees half a file. Events
are append-only and the server stamps each line with `at`; the server never
reads the log back. Captures are written once — posting the same name again is a
409, because a capture is a record of a moment rather than a mutable slot.

Refusals are JSON with a message worth showing the developer, and the client
raises them as `ExhibitApiError` (with `.status` and `.detail`). The limits:

| | Cap | Names |
|---|---|---|
| documents, events | 1 MB | key: one segment, no extension (the server appends `.json`) |
| captures | 25 MB | name: one segment ending in png, jpg, jpeg, gif, webp, svg, webm, mp4, mp3, wav, ogg, json, csv, txt, md, pdf |

Nothing the origin would execute is capturable — `.html`, `.js`, `.ts`, `.tsx`
are refused — and no path can leave the exhibit directory.

Everything a page writes lands as files in the exhibit directory, which is the
point: a later agent session reads `data/`, `events.jsonl`, and `captures/`
straight from disk. The developer's answer is not special: the default renderer
writes `data/disposition.json` as
`{ askType, choice?, comment?, decidedAt }` and appends a `disposition` event.

## Committed apps

A durable tool belongs in the main checkout at `dev/apps/<name>/`, served at
`/apps/<name>/`. Same manifest, same tiers, same client — but the code is
tracked and merges to main, while its runtime data still lands in the store
(`apps/<name>/`), so using an app never dirties a checkout. A committed app may
omit `ask`: it appears in the app list, not the ask queue.

## Access

The exhibits surface is a second origin on `http://127.0.0.1:<EXHIBITS_PORT>/`
(default 3230), loopback only, and the router does not proxy it. It is not the
workstreams origin: pages here script freely and hold no workstreams authority.

A request needs the machine-scoped token, once, as `?token=<t>`; the origin
exchanges it for a session cookie and redirects to the clean URL. The token is
minted by the supervisor and persisted at `$CALLBACK_STATE_DIR/exhibits-token`.
`bin/exhibits url <workstream>/<exhibit>` prints an authorized URL (Track D).

## Writing pages the checks will not see

Store pages live outside every checkout, so the repo's lint and typecheck never
run on them, by construction. The expectations are deliberately minimal:
correctness, not house style — parse cleanly, type-check under the shipped
fragment, and default-export one component.

Point an editor at `workstreams-app/exhibits-page.tsconfig.json` (extend it by
absolute path from a `tsconfig.json` in your page directory) to get the same
compiler settings the container compiles pages with, including the
`@exhibits/client` mapping.
