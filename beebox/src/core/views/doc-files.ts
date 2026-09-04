/**
 * The file-access chapter of the generated views doc: dependency globs,
 * reading attachments (metadata + readFile/fileUrl), and conflict-safe
 * writes + commit semantics. Split from views-doc.ts for the line cap.
 */

export const dependenciesAndParamsSection = `## Dependencies

The \`dependencies\` array controls two things:
1. **Which data is loaded** — matching \`.card\` files arrive parsed in \`cards\`;
   any other matching file arrives as metadata in \`files\`
   (\`{path, size, mtimeMs}\` — fetch content with \`readFile\`/\`fileUrl\`)
2. **When to re-render** — the view refreshes automatically when matching files change

Use glob patterns relative to the box root:
- \`"box/inbox/**/*.card"\` — all cards in the inbox
- \`"store/archive/**/*.record.card"\` — all record cards in the archive
- \`"store/todos/**/*.card"\` — all todo cards
- \`"box/**/*.card"\` — everything in box/
- \`"store/playground/Playground.attach/**/*.jsonl"\` — a card's attachment files

### Reading a card's attachments

A card's extra data usually lives in its attach scope. The card's
\`attachments\` listing (or a dependency glob into the \`.attach/\` dir) tells
you what exists; \`readFile\` fetches content on demand. Attachments can be
very large — fetch only what you render. A byte-range tail is the right way
to show "recent entries" from an append-only log:

\`\`\`tsx
export const dependencies = [
  "store/playground/*.card",
  "store/playground/Playground.attach/**/*.jsonl",
];

export default function PlaygroundHistory({ files, readFile }) {
  const [entries, setEntries] = useState([]);
  const log = files.find((f) => f.path.endsWith("sessions/history.jsonl"));
  useEffect(() => {
    if (!log) return;
    // Tail the last 64KB — enough for recent entries, cheap for a huge log.
    readFile(log.path, { start: -65536 }).then((text) => {
      const lines = text.split("\\n").filter(Boolean);
      // A tail can start mid-line; drop the first line unless we read from byte 0.
      if (log.size > 65536) lines.shift();
      setEntries(lines.map((line) => JSON.parse(line)));
    });
  }, [log && log.path, log && log.mtimeMs]);
  return <ul>{entries.map((e, i) => <li key={i}>{e.summary}</li>)}</ul>;
}
\`\`\`

\`mtimeMs\` in the effect deps makes the view re-fetch when the log grows.
For images and audio, don't fetch. Render a bounded image with
\`<img src={imageUrl(f.path, { width: 960, format: "auto" })} />\`; use
\`fileUrl(f.path)\` for audio and for a link to the full-resolution image. Image
variants are generated on demand and cached, so do not make a small display
download the original.

\`imageUrl\` requires \`width\` or \`height\`. It uses \`fit: "scale-down"\` and
\`quality: 85\` by default; \`format: "auto"\` negotiates AVIF/WebP/JPEG. Other
fits are \`contain\`, \`cover\`, \`crop\`, and \`pad\`. \`quality\` is 1–100 and \`dpr\` is
at most 2. If adapting to \`window.devicePixelRatio\`, clamp it with
\`Math.min(window.devicePixelRatio, 2)\`. Invalid options fail clearly instead of
falling back to the original.

### Writing files from a view

Views can create, overwrite, and append to box files (everything except
\`.card\` files — cards validate, so they go through the card API or
\`bbx create\`). A ViewFile is an identity + version: its \`etag\` is the
version token. The conflict-safe pattern — assert the version you read,
and refresh instead of clobbering when someone else changed the file:

\`\`\`tsx
export default function Notes({ files, readFile, writeFile, commitFile }) {
  const [file, setFile] = useState(files.find((f) => f.path.endsWith("notes.md")));
  const [text, setText] = useState("");
  useEffect(() => { if (file) readFile(file.path).then(setText); }, [file && file.etag]);

  async function save() {
    try {
      // expect: file → the write fails (412) if the file changed since we read it
      const next = await writeFile(file.path, { content: text, expect: file });
      setFile(next); // the returned ViewFile is the new version — chain saves from it
    } catch (e) {
      if (e.name === "ViewFileConflictError") {
        setFile(e.current); // someone else wrote — e.current is the fresh version; reload
        return;
      }
      throw e;
    }
  }

  return <div>
    <textarea value={text} onChange={(e) => setText(e.target.value)} />
    <button onClick={save}>Save</button>
    <button onClick={() => commitFile(file.path, "Edited notes from view")}>Commit</button>
  </div>;
}
\`\`\`

- \`expect: someViewFile\` — overwrite only if unchanged since you read it.
- \`expect: "absent"\` — create-only; conflicts if the file appeared meanwhile.
- Omit \`expect\` for unconditional writes (append-only logs rarely need it).

### Calling external APIs (LLMs) from a view

Browsers can't call provider APIs directly: providers (correctly) refuse
CORS so API keys never live in pages. Views go through the box's **API
adapters** instead — \`adapterFetch(adapter, {path, ...init})\` hits
\`/api/adapters/<adapter>/<path>\`, where the server injects the key it
resolves from the machine-level secret store under the adapter's own name.
Adapters: \`replicate\`, \`mistral\`, \`anthropic\`, \`openai\`.

A key is never a file you write: the boxholder grants the adapter's secret
to this box (\`bbx secrets status <this box>\` shows what is granted and what is
missing; \`bbx secrets declare\` names one you need). An in-tree
\`config/connectors/<adapter>.secret.json\` is a deprecated fallback that is
being retired — do not create one.

\`\`\`tsx
const resp = await adapterFetch("replicate", {
  path: "/v1/models/meta/llama-2-7b-chat/predictions",
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ input: { prompt } }),
});
const prediction = await resp.json();
// Polling URLs from the provider are absolute; pass them straight back —
// the origin is stripped and routed through the adapter:
const poll = await adapterFetch("replicate", { path: prediction.urls.get });
\`\`\`

Never read a \`*.secret.json\` into the browser with \`readFile\` and never
put an API key in view source — the adapter exists so keys stay
server-side.

**Git semantics.** Writes never auto-commit — interactive saves are chatty
and a commit per keystroke would spam history. \`gitStatus\` on each
ViewFile shows working-tree state (\`"dirty"\`, \`"untracked"\`, absent =
committed clean) so a view can render an unsaved-changes indicator. Call
\`commitFile(path, message)\` at meaningful boundaries — it commits the
file's card and attach scope (and nothing else); a card path sweeps its
scope, an attachment path sweeps its owning card + scope. Anything left
uncommitted is safe: box housekeeping sweeps stray changes on wakeup.

## Query Parameters (path and others)

Views receive query parameters via \`params\`. \`params.path\` is **the card this view is rendering** — set automatically to the card's own path (the view is that card type's interface). Read the card from \`cards\` with it:

\`\`\`tsx
export default function MyView({ cards, params }) {
  const card = cards.find(c => c.path === params.path);
  // ...render card.frontmatter / card.body...
}
\`\`\`

Any extra query params on the link/embed — \`![x](/store/Foo.dash.card?tab=costs&range=90d)\` — arrive alongside \`path\` in \`params\` for filtering, sorting, selecting a tab, etc.

## React

React is provided automatically. **Do NOT import React** — the build system handles it. If you do write \`import React from "react"\`, it will still work (the compiler intercepts it), but it's unnecessary.

You can use all standard React hooks: \`useState\`, \`useEffect\`, \`useMemo\`, \`useCallback\`, \`useRef\`, etc.

## Card-aware widgets

To point at another card from a view — a link, or an embedded card — import the widgets from \`beebox/view-widgets\` instead of hand-rolling an \`<a>\`. They open the card **in whatever surface the view is shown in** (the chat companion pane, browse, or a full page); you don't pick a navigation target.

\`\`\`tsx
import { CardLink, CardRef } from "beebox/view-widgets";
\`\`\`

**\`<CardLink cardRef="…">\`** — a lightly-styled inline link. Clicking opens the card in the current surface. The link text falls back to the card's title when you omit children:

\`\`\`tsx
<CardLink cardRef="/store/notes/Plan.memo.card">the plan</CardLink>
<CardLink cardRef="/store/notes/Plan.memo.card" />
\`\`\`

**\`<CardRef cardRef="…">\`** — a styled reference chip with two controls: **Open** (same as CardLink) and **Expand** (renders the card inline, in place). Use it when a card is worth showing, not just linking:

\`\`\`tsx
<CardRef cardRef="/store/recipes/Pasta.recipe.card" />
\`\`\`

The reference attribute is \`cardRef\`, **not** \`ref\` (React reserves \`ref\` on components). Write box-absolute refs (\`/store/…\`). A \`cardRef\` is tracked like any card ref, so \`bbx validate\` flags a broken one and \`bbx mv\` rewrites it when the target moves.`;
