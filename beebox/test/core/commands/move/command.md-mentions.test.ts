// # `bbx mv` — path mentions in `.md` files
//
// A path that resolves to the moved card is rewritten in any `.md` file, link
// or not: in an `AGENTS.md`, in a code span, in plain text, in a fenced block.
// A relative mention stays relative, an absolute one stays absolute. Only a
// token that resolves exactly to the old location changes; `.ts` files are not
// read.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { executeMove } from "../../../../src/core/commands/move/command.js";
import { createCollectorContext } from "../../../../src/core/command-runner.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

/** Move `from` to `to` in a box built from `files`, then show each of `paths` as `>> <path>` and its contents. */
async function moved({ files, args, paths }: { files: Record<string, string>; args: { from: string; to: string }; paths: string[] }) {
  const box = await makeTmpBox();
  try {
    for (const [file, content] of Object.entries(files)) await box.write(file, content);
    const { ctx } = createCollectorContext(box.root);
    const result = await executeMove(ctx, args);
    const out = [result.success ? "success" : `error: ${result.error}`];
    for (const p of paths) out.push(`>> ${p}`, (await box.read(p)).trimEnd());
    return out.join("\n");
  } finally {
    await box.cleanup();
  }
}

const files = {
  "_content/work/Foo.doc.card": "---\ntype: doc\ntitle: Foo\n---\n",
  "_content/work/Foo.attach/Spec.md": "spec\n",
  "_content/work/sub/AGENTS.md":
    "Read `../Foo.doc.card` first.\nAttachments live in `../Foo.attach/` and `../Foo.attach/Spec.md`.\n" +
    "Scheme: `urn:Foo.doc.card`, https://example.com/_content/work/Foo.doc.card\n" +
    "Longer: `../Foo.doc.card.bak`, `../Other-Foo.doc.card`, `../x/Foo.doc.card`.\n" +
    "```\ncat ../Foo.doc.card\n```\n",
  "_content/work/Notes.md":
    "Plain /_content/work/Foo.doc.card, bare _content/work/Foo.doc.card, and (see _content/work/Foo.doc.card.)\n" +
    "Sibling Foo.doc.card here. Fragment: /_content/work/Foo.doc.card#intro\n",
  "AGENTS.md": "Root note: `_content/work/Foo.doc.card`.\n",
  "src/schemas/foo.ts": "export const hint = \"see /_content/work/Foo.doc.card\";\n",
};

const args = { from: "_content/work/Foo.doc.card", to: "_content/archive/Foo.doc.card" };

void test("Path mentions of a moved card are rewritten in .md files, keeping their form", async (t) => {
  await t.checkText(
    await moved({ files, args, paths: ["_content/work/sub/AGENTS.md", "_content/work/Notes.md", "AGENTS.md"] }),
    `success
>> _content/work/sub/AGENTS.md
Read \`../../archive/Foo.doc.card\` first.
Attachments live in \`../../archive/Foo.attach/\` and \`../../archive/Foo.attach/Spec.md\`.
Scheme: \`urn:Foo.doc.card\`, https://example.com/_content/work/Foo.doc.card
Longer: \`../Foo.doc.card.bak\`, \`../Other-Foo.doc.card\`, \`../x/Foo.doc.card\`.
\`\`\`
cat ../../archive/Foo.doc.card
\`\`\`
>> _content/work/Notes.md
Plain /_content/archive/Foo.doc.card, bare _content/archive/Foo.doc.card, and (see _content/archive/Foo.doc.card.)
Sibling ../archive/Foo.doc.card here. Fragment: /_content/archive/Foo.doc.card#intro
>> AGENTS.md
Root note: \`_content/archive/Foo.doc.card\`.`,
  );
});

void test("A .ts file that names the moved card is left alone", async (t) => {
  await t.checkText(
    await moved({ files, args, paths: ["src/schemas/foo.ts"] }),
    `success
>> src/schemas/foo.ts
export const hint = "see /_content/work/Foo.doc.card";`,
  );
});

void test("Mentions follow a directory move", async (t) => {
  await t.checkText(
    await moved({
      files: { ...files, "_content/work/Bar.doc.card": "---\ntype: doc\ntitle: Bar\n---\n" },
      args: { from: "_content/work", to: "_content/archive" },
      paths: ["AGENTS.md"],
    }),
    `success
>> AGENTS.md
Root note: \`_content/archive/Foo.doc.card\`.`,
  );
});
