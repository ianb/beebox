# Exhibits: the page contract

An **exhibit** is a directory you create; the app renders it. It is how an agent
shows work to the developer — rendered documents, labeled screenshots, small
interactive pages. An exhibit shows; it asks nothing. Questions go in chat.
History and the original design (which still describes asks, dispositions, and the queue):
`beebox/docs/implemented-plans/workstream-exhibits.md`. The current contract is
this document and `beebox/docs/plans/exhibits-rethink.md`.

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
A sibling `coding-feedback/` directory holds CODING_FEEDBACK notes (`bin/coding-feedback`); the app never lists or serves it.

`bin/exhibits add --title <t> [--prose <p>] [--caption <text>]… [files…]`
does all of that: it derives the workstream from the checkout you run
it in, copies the files in under names the app can route to (`Screen Shot
2026-08-15.png` lands as `screen-shot-2026-08-15.png`), labels the figures `A1`,
`A2`, … in argument order, puts the n-th `--caption` on the n-th figure file
(more captions than figures is refused before anything is created), maps one `.md` or `.markdown` argument to the
renderer-required `doc.md` name (and refuses multiple documents), and prints
the URL — one line on stdout, so it pastes straight into chat. Write the
directory by hand when you want something the CLI does not do; the contract is
the files, not the tool.

`exhibit.json`:

```json
{
  "title": "Dashboard density options",
  "prose": "Two densities for the card list. **Comfortable** is today; compact fits two more cards on a phone screen.",
  "created": "2026-08-15T18:00:00Z",
  "figures": [
    { "label": "A1", "file": "comfortable.png", "caption": "Current spacing" },
    { "label": "A2", "file": "compact.png", "caption": "Two lines tighter" }
  ]
}
```

The manifest is Zod-validated. A directory with content but no usable manifest
renders an error page naming the file and the issues — never a bare listing.
The manifest is `{ title, created, prose?, figures? }`. `prose` is optional and
rendered as Markdown under the title. Manifests written before the ask was
removed keep rendering: their old ask prose shows as `prose`, and the rest of
the ask is ignored.

## Writing a good exhibit

- **Figures get labels and captions.** The label (`A1`, `B3`) is the handle
  the developer uses to name a figure in chat; the caption says what to look
  at. Two screenshots with no captions are a spot-the-difference puzzle you
  are asking the developer to solve. Supply captions with `--caption`.
- **Present it live.** Run `bin/exhibits add --open` when the developer is in
  chat, and put the URL on the first line of your message.

## Writing for someone who did not read the plan

The developer opens an exhibit cold. Write every sentence for that reader.

- **Say where you are and what you see.** A caption names the page or control
  in the app as a person using the box would ("the Properties panel of a
  recipe card, after tapping Appearance"), then what to look at. Not "B2:
  Properties now; Appearance is folded".
- **Say what changes for a person using the box.** When the figures show a
  choice, each one is described by what the person gets, not by its
  implementation ("the list stays readable at phone width" rather than
  "stack-as-flex-column").
- **No plan vocabulary.** Track names, slice numbers, field names, branch
  names, and nouns the plan introduced do not appear unless the figure shows
  them on screen. If a noun needs the plan to decode, define it in one clause
  or drop it.
- **Ask in chat, decide in chat.** The exhibit shows what is; it does not
  propose, default, or ask. What you will do next and any question go in your
  final message, with the exhibit URL on its first line. Several choices are
  several labeled figures; the developer replies naming a label.

## The three page tiers

One mechanism, three levels of effort:

1. **No `index.tsx` / `index.html`** — the default renderer: `doc.md` and the
   manifest's figures as labeled images. Most exhibits want exactly this.
2. **`index.html`** — served as-is, scripts allowed. Sibling files (`data.json`,
   images) are served from the directory, so relative `fetch` works. Namespace
   your `localStorage` keys: the whole origin shares them.
3. **`index.tsx`** — default-export a React component. It renders inside the
   container (shell, breadcrumb, title and prose), with React 18, Tailwind, and the
   client below already provided. Drop the file in; no build step, no
   registration, HMR picks up edits.

**The container adds a "Reply in the session" button for the default and
module tiers.** Store exhibits on those two tiers get the button under the
title. It calls the focus route (see Access) and brings the workstream's live
terminal tab forward, so a reaction is typed where the agent is listening. When
there is no live session the page shows the reason. Raw `index.html` is served
unchanged and receives no container, so it gets no button; it may call the
route itself. A page that wants richer interaction writes through the client
below.

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
straight from disk.

## Committed apps

A durable tool belongs in the main checkout at `dev/apps/<name>/`, served at
`/apps/<name>/`. Same manifest, same tiers, same client — but the code is
tracked and merges to main, while its runtime data still lands in the store
(`apps/<name>/`), so using an app never dirties a checkout. It appears in the
app list.

## Access

The exhibits surface is a second origin on `http://127.0.0.1:<EXHIBITS_PORT>/`
(default 3230), loopback only, and the router does not proxy it. It is not the
workstreams origin: pages here script freely and hold one workstreams authority, the focus route.

A request needs the machine-scoped token, once, as `?token=<t>`; the origin
exchanges it for a session cookie and redirects to the clean URL. The token is
persisted at `$BBX_STATE_DIR/exhibits-token`; the supervisor mints it, and
so does `bin/exhibits` when the app has never run — both reuse an existing file,
so a printed URL always carries a token that works.
`bin/exhibits url <workstream>/<exhibit>` prints an authorized URL (Track D).

The cookie is not the whole gate for writes. Every loopback port is one "site"
to a browser, so `SameSite` separates nothing between local servers: a mutating
request (`PUT`, `POST`) that declares an `Origin` must declare this one, or it
is refused with a 403. A request with no `Origin` — curl, an agent, a script —
is allowed, because a browser always sends it on a cross-origin write. Pages on
this origin need do nothing: their own `fetch` carries the right `Origin`.

The focus route is `POST /api/<ws>/<exhibit>/focus`, with no body. It runs
`bin/workstreams focus <ws>` and brings that workstream's live terminal tab
forward. It answers 204, or 409 `{ message, detail }` when there is no live
session (`detail` is the CLI's last stderr line). This is the one authority the
exhibits origin holds, granted 2026-10-10. It cannot resume, close, or archive a
workstream and takes no text. The `Origin` check keeps other origins out but
cannot tell a click from a page's own script, so an agent-written page can
trigger it. The container button uses it; raw `index.html` pages get no button
and may call the route themselves.

## Writing pages the checks will not see

Store pages live outside every checkout, so the repo's lint and typecheck never
run on them, by construction. The expectations are deliberately minimal:
correctness, not house style — parse cleanly, type-check under the shipped
fragment, and default-export one component.

Point an editor at `workstreams-app/exhibits-page.tsconfig.json` (extend it by
absolute path from a `tsconfig.json` in your page directory) to get the same
compiler settings the container compiles pages with, including the
`@exhibits/client` mapping.

Committed apps (`dev/apps/`) get exactly one check more, because they merge to
main and live forever: a **this-will-build gate**. When a commit stages
`dev/apps/**/*.ts(x)`, pre-commit runs `pnpm dev-apps-typecheck` — `tsc
--noEmit` under `dev/apps/tsconfig.json`, which extends the same fragment the
container serves with. No lint, no style rules; a page that compiles passes.
`index.html`-tier apps never trigger it, and editors pick up
`dev/apps/tsconfig.json` automatically (no per-page config needed there).
