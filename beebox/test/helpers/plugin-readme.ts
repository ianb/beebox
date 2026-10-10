import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";

/** The text of `src/plugins/<name>/README.md`. */
export async function readmeText(pluginName: string): Promise<string> {
  return readFile(join(PACKAGE_ROOT, "src/plugins", pluginName, "README.md"), "utf8");
}

/** A plugin README's Setup section, parsed: each fenced block labelled with the box path on the line before it. */
export async function readmeStubs(pluginName: string): Promise<Map<string, string>> {
  const readme = await readmeText(pluginName);
  const stubs = new Map<string, string>();
  const fence = /`<box>\/([^\n`]+)`:\n\n```(?:ts|tsx|json)\n([\S\s]*?)```/g;
  for (const match of readme.matchAll(fence)) stubs.set(match[1]!, match[2]!);
  return stubs;
}
