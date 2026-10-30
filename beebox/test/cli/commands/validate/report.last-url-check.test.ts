// # `bbx validate` shows the last commit's URL check
//
// The post-commit hook writes its background URL check to
// `.beebox/url-check.log`. Validate prints it only when it names a broken link.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { printLastUrlCheck } from "../../../../src/cli/commands/validate/report.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

async function printed(log: string | null): Promise<string[]> {
  const box = await makeTmpBox();
  try {
    if (log !== null) await box.write(".beebox/url-check.log", log);
    const lines: string[] = [];
    const original = console.log;
    console.log = (line: string) => {
      lines.push(line);
    };
    try {
      await printLastUrlCheck(box.root);
    } finally {
      console.log = original;
    }
    return lines;
  } finally {
    await box.cleanup();
  }
}

void test("A broken link in the last URL check is printed; a clean or missing log is not", async (t) => {
  const broken = "broken  https://example.com/gone  [404]  (_content/a.doc.card)\n\n1 broken external URL (warning — not blocking; fix or remove the link)\n";
  t.check(await printed(broken), [
    "\nThe URL check of the last commit found broken links (.beebox/url-check.log):\nbroken  https://example.com/gone  [404]  (_content/a.doc.card)\n\n1 broken external URL (warning — not blocking; fix or remove the link)",
  ]);
  t.check(await printed("Checked 3 external URL(s); none broken.\n"), []);
  t.check(await printed(null), []);
});
