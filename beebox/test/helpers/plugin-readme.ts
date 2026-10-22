import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";
import { isRecord } from "../../src/shared/is-record.js";
import { makeTmpBox, type TmpBox } from "./test-helpers.js";

const exec = promisify(execFile);

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

/** A temp box with the plugin's README stubs written, character for character. */
export async function stubbedBox(pluginName: string): Promise<TmpBox> {
  const box = await makeTmpBox({ deps: true, git: true });
  for (const [path, content] of await readmeStubs(pluginName)) await box.write(path, content);
  return box;
}

/** `bbx <args>` in the box: exit code, raw stdout, and the report (box-relative, blank lines dropped). */
export async function bbx(box: TmpBox, args: string[]): Promise<{ code: number; stdout: string; report: string[] }> {
  // The CLI prints real paths; on macOS the temp root is reached through `/private`,
  // and that longer spelling must go first or the shorter one leaves `/private` behind.
  const roots = [await realpath(box.root), box.root].toSorted((a, b) => b.length - a.length);
  const lines = (text: string) =>
    roots.reduce((acc, root) => acc.replaceAll(`${root}/`, ""), text).split("\n").filter((line) => line.trim() !== "");
  try {
    const { stdout } = await exec(process.execPath, ["--import", import.meta.resolve("tsx"), join(PACKAGE_ROOT, "src/cli/entry/run.ts"), ...args], { cwd: box.root });
    return { code: 0, stdout, report: lines(stdout) };
  } catch (e) {
    // execFile rejects with the exit code and both streams on a nonzero exit.
    if (!isRecord(e)) throw e;
    const code = typeof e["code"] === "number" ? e["code"] : 1;
    const out = typeof e["stdout"] === "string" ? e["stdout"] : "";
    const err = typeof e["stderr"] === "string" ? e["stderr"] : "";
    return { code, stdout: out, report: lines(`${out}${err}`) };
  }
}
