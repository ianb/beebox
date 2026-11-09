// # bbx view render-one: card states and the settled render
//
// After the first frame, each check state renders again in a DOM with effects
// run and `readFile` answered from the box, so a view that crashes once its
// data loads fails. A view that renders card types also renders with one card
// of each type as `params.path`. A state still loading at its budget, or one
// that writes, is reported as partly checked on stdout; it does not fail
// (docs/plans/view-check-settled-render.md;
// issues/closed/bugs/2026-11-09-view-check-passes-views-that-crash-after-load.md).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { makeTmpBox, type TmpBox } from "../../../helpers/test-helpers.js";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const PKG = process.cwd();

/** A box with one view, `src/views/v.tsx`, and the given files. */
async function boxWithView({ view, files }: { view: string; files?: Record<string, string> }): Promise<TmpBox> {
  const box = await makeTmpBox({ deps: true, git: true });
  const full = join(box.root, "src", "views", "v.tsx");
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, view);
  for (const [file, content] of Object.entries(files ?? {})) await box.write(file, content);
  return box;
}

/** Run the built CLI's `view render-one v` in the box. */
function renderOne(boxRoot: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(PKG, "dist/cli.mjs"), "view", "render-one", "v"], { cwd: boxRoot });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("close", (code) => { resolve({ code, stdout, stderr }); });
  });
}

const HEAD = `import { useEffect, useState } from "react";
export const name = "V";
export const dependencies = [];
export const modes = ["page"];
`;

// The reported case: the view reads a file in an effect, shows a loading
// state until then, and reads a `const` before its declaration once loaded.
void test("a view that crashes after readFile resolves fails, naming the state", async (t) => {
  const box = await boxWithView({ view: `${HEAD}
export default function V({ readFile }) {
  const [text, setText] = useState(null);
  useEffect(() => { void readFile("_content/data.txt").then(setText); }, [readFile]);
  if (text === null) return <p aria-busy="true">Loading</p>;
  const count = lines.length;
  const lines = text.split("\\n");
  return <p>{count}</p>;
}
`, files: { "_content/data.txt": "a\nb\n" } });
  t.teardown(() => box.cleanup());
  t.check(await renderOne(box.root), {
    code: 1,
    stdout: "",
    stderr: str`View render failed [no card, after effects]: ReferenceError: Cannot access 'lines' before initialization
ReferenceError: Cannot access 'lines' before initialization
${any(String).includes("views/v.tsx")}
`,
  });
});

// `readFile` takes an HTTP byte range, as in the app: `end` is inclusive, and a
// negative `start` is a tail. The view throws what it read, so the error shows it.
void test("readFile answers byte ranges as the app does", async (t) => {
  const box = await boxWithView({ view: `${HEAD}
export default function V({ readFile }) {
  const [got, setGot] = useState(null);
  useEffect(() => {
    void Promise.all([readFile("_content/data.txt", { start: 1, end: 3 }), readFile("_content/data.txt", { start: -2 })]).then(setGot);
  }, [readFile]);
  if (got !== null) throw new Error(got.join("|"));
  return null;
}
`, files: { "_content/data.txt": "abcdef" } });
  t.teardown(() => box.cleanup());
  const r = await renderOne(box.root);
  t.check(r.stderr.split("\n")[0], "View render failed [no card, after effects]: Error: bcd|ef");
});

// A card-type view's "card not found" branch passes; the same view with a real
// card as `params.path` fails. The sample is the first card of the type by path.
void test("a card-type view also renders with a card of its type, and fails there", async (t) => {
  const box = await boxWithView({ view: `export const name = "V";
export const dependencies = ["_content/**/*.doc.card"];
export const rendersCardTypes = ["doc"];
export const modes = ["page"];
export default function V({ cards, params }) {
  const card = cards.find((c) => c.path === params.path);
  if (card === undefined) return <p>Card not found</p>;
  return <h1>{card.frontmatter.missing.title}</h1>;
}
`, files: {
    "_content/notes/B.doc.card": "---\ntitle: B\n---\nBody\n",
    "_content/notes/A.doc.card": "---\ntitle: A\n---\nBody\n",
  } });
  t.teardown(() => box.cleanup());
  const r = await renderOne(box.root);
  t.check(r.stderr.split("\n")[0], "View render failed [_content/notes/A.doc.card, first frame]: TypeError: Cannot read properties of undefined (reading 'title')");
});

// A view that writes, or renders a card type the box has no card of, rendered
// without error but was not fully checked: it exits 0 and says why on stdout.
// A timer left running does not hold the process to its timeout.
void test("a view that writes, or lacks a sample card, exits 0 and is reported partly checked", async (t) => {
  const box = await boxWithView({ view: `${HEAD}
export const rendersCardTypes = ["menu"];
export default function V({ writeFile }) {
  useEffect(() => { void writeFile("_content/out.txt", { content: "x" }); }, [writeFile]);
  useEffect(() => { setInterval(() => {}, 1000); }, []);
  return <p aria-busy="true">Loading</p>;
}
` });
  t.teardown(() => box.cleanup());
  const started = Date.now();
  const r = await renderOne(box.root);
  t.check({ ...r, quick: Date.now() - started < 20_000 }, {
    code: 0,
    stdout: "bbx-view-check partial: no menu card in the box loads; not checked with one\nbbx-view-check partial: no card: 1 write not performed\n",
    stderr: "",
    quick: true,
  });
});

// The check does not call adapters: `adapterFetch` rejects, and the view's
// error handling runs as it would on a failed call.
void test("adapterFetch rejects, and the view handles it", async (t) => {
  const box = await boxWithView({ view: `${HEAD}
export default function V({ adapterFetch }) {
  const [state, setState] = useState("waiting");
  useEffect(() => { void adapterFetch("openai", { path: "/v1/models" }).catch((e) => { setState(e.name); }); }, [adapterFetch]);
  return <p>{state}</p>;
}
` });
  t.teardown(() => box.cleanup());
  // The adapter rejection settles the render at once: no partial remark.
  t.check(await renderOne(box.root), { code: 0, stdout: "", stderr: "" });
});

// A rejection the view leaves uncaught (here, a read of a path outside the box
// content) is a console error in the app, not a crash. The check reports it as
// partly checked and goes on.
void test("an uncaught readFile rejection is reported, not a crash", async (t) => {
  const box = await boxWithView({ view: `${HEAD}
export default function V({ readFile }) {
  useEffect(() => { void readFile("AGENTS.md"); }, [readFile]);
  return <p>ok</p>;
}
` });
  t.teardown(() => box.cleanup());
  t.check(await renderOne(box.root), {
    code: 0,
    stdout: "bbx-view-check partial: no card: uncaught outside render: PathOutsideBoxError: readFile: AGENTS.md is not a box content path\n",
    stderr: "",
  });
});
