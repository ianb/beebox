// # Loading the `yaml` package on first use
//
// `src/lib/yaml-package.ts` requires `yaml` only when one of its functions is
// called, so a verb that only reads cards does not pay for loading it
// (`docs/implemented-plans/yaml-lazy-load.md`). One static `import … from "yaml"` on the
// card read path or in a schema module would load it at start again; this
// test catches that.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { makeTmpBox } from "../helpers/test-helpers.js";

const exec = promisify(execFile);
const src = join(import.meta.dirname, "../../src");

// A fresh process (the test runner may load `yaml` itself) builds the schema
// registry, parses a card, and reports whether `yaml` is in the module cache;
// then it writes YAML, which loads it. The card's shell command (`&&`, `[ !`)
// is plain text, so it stays on js-yaml (`read-yaml.ts`).
void test("Reading a card does not load yaml; writing YAML does", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const script = `
    import { createRequire } from "node:module";
    const { buildLoadContext } = await import(${JSON.stringify(join(src, "core/load-context.ts"))});
    const { parseCardText } = await import(${JSON.stringify(join(src, "core/card-io.ts"))});
    const { stringify } = await import(${JSON.stringify(join(src, "lib/yaml-package.ts"))});
    const cache = createRequire(import.meta.url).cache;
    const yamlLoaded = () => Object.keys(cache).some((key) => key.includes("/node_modules/yaml/"));
    const ctx = await buildLoadContext(process.argv[1]);
    const card = parseCardText("---\\ntitle: Hello\\nsummary: test -f x && [ ! -d y ]\\n---\\nBody\\n", { source: "Hello.doc.card", schemas: ctx.cardSchemas });
    const afterRead = yamlLoaded();
    const written = stringify(card.frontmatter);
    console.log(JSON.stringify({ afterRead, written, afterWrite: yamlLoaded() }));
  `;
  const child = await exec(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, box.root], { timeout: 30_000 });
  t.check(JSON.parse(child.stdout), { afterRead: false, written: "title: Hello\nsummary: test -f x && [ ! -d y ]\n", afterWrite: true });
});
