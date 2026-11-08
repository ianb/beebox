// # Every Git child gets an allowlisted environment
//
// An agent can write its box's `.git/hooks/*` and `.git/config`, and Git runs
// commands from both with the Git child's environment (`src/lib/git/env.ts`).
// So that environment keeps Git's own identity and repository variables and
// drops everything an agent should not see. The credential matrix
// (`test/credential-visibility/every-consumer.test.ts`) reads it from a real
// hook; this file covers the decisions and the hook's own Git calls.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { gitEnvironment } from "../../../src/lib/git/env.js";
import { commitPaths } from "../../../src/lib/git/core/operations.js";
import { installValidationHooks } from "../../../src/core/install-validation-hooks.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";
import { makeTmpBox, type TmpBox } from "../../helpers/test-helpers.js";

const AMBIENT = {
  GIT_INDEX_FILE: "/ambient/index",
  EMAIL: "someone@example.com",
  BBX_NO_URLCHECK: "1",
  EDITOR: "ambient-editor",
  GIT_CONFIG_GLOBAL: "/ambient/gitconfig",
  OPENAI_API_KEY: "ambient-key",
  SSH_AUTH_SOCK: "/ambient/agent.sock",
};
const NAMES = [...Object.keys(AMBIENT), "GIT_DIR"];

function withAmbient<T>(t: { teardown: (fn: () => void) => void }, fn: () => T): T {
  const saved = Object.fromEntries(Object.keys(AMBIENT).map((name) => [name, process.env[name]]));
  t.teardown(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
  });
  Object.assign(process.env, AMBIENT);
  return fn();
}

function picked(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return Object.fromEntries(NAMES.map((name) => [name, env[name]]));
}

// ## What a Git child keeps
//
// Git's identity and repository variables and the URL-check opt-out pass
// through; editor and config overrides, credentials, and the SSH agent do not.
// A push adds the agent socket; a caller that points Git at its own scratch
// repository drops the inherited index; overrides set or remove names last.
void test("What a Git child keeps", async (t) => {
  const cases = withAmbient(t, () => ({
    plain: picked(gitEnvironment()),
    network: picked(gitEnvironment({ network: true })),
    isolated: picked(gitEnvironment({ repository: "isolated", overrides: { GIT_DIR: "/scratch", EMAIL: undefined } })),
  }));
  const kept = { GIT_INDEX_FILE: "/ambient/index", EMAIL: "someone@example.com", BBX_NO_URLCHECK: "1" };
  const dropped = { EDITOR: undefined, GIT_CONFIG_GLOBAL: undefined, OPENAI_API_KEY: undefined };
  t.check(cases, {
    plain: { ...kept, ...dropped, SSH_AUTH_SOCK: undefined, GIT_DIR: undefined },
    network: { ...kept, ...dropped, SSH_AUTH_SOCK: "/ambient/agent.sock", GIT_DIR: undefined },
    isolated: { ...kept, ...dropped, GIT_INDEX_FILE: undefined, EMAIL: undefined, SSH_AUTH_SOCK: undefined, GIT_DIR: "/scratch" },
  });
});

function git(box: TmpBox, ...args: string[]): string {
  return execFileSync("git", args, { cwd: box.root }).toString().trim();
}

async function catchName(promise: Promise<unknown>): Promise<string> {
  try { await promise; return "committed"; } catch (e) { return e instanceof Error ? e.name : String(e); }
}

// ## The pre-commit hook validates the commit's own index
//
// `git commit -- <paths>` runs pre-commit against a temporary index named by
// GIT_INDEX_FILE. The box's real hook runs `bbx validate --pre-commit`, whose
// Git calls must read that index: a card staged outside the paths does not
// block the commit, and a broken card inside them does.
void test("The pre-commit hook validates the commit's own index", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  const before = process.env.BBX_HOOK_BIN;
  process.env.BBX_HOOK_BIN = join(PACKAGE_ROOT, "bin/bbx");
  t.teardown(() => {
    if (before === undefined) Reflect.deleteProperty(process.env, "BBX_HOOK_BIN");
    else process.env.BBX_HOOK_BIN = before;
  });
  await installValidationHooks(box.root);

  await box.write("_content/Broken.doc.card", "---\ntitle: [unclosed\n---\nbody\n");
  git(box, "add", "_content/Broken.doc.card");
  await box.write("_content/Fine.doc.card", "---\ntitle: Fine\n---\nbody\n");
  git(box, "add", "_content/Fine.doc.card");

  t.check({
    fine: await catchName(commitPaths(box.root, { paths: ["_content/Fine.doc.card"], message: "fine only" })),
    broken: await catchName(commitPaths(box.root, { paths: ["_content/Broken.doc.card"], message: "broken" })),
    head: git(box, "log", "-1", "--format=%s"),
  }, { fine: "committed", broken: "GitCommandError", head: "fine only" });
});

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts")).map((e) => join(e.parentPath, e.name));
}

// ## No raw `git` spawn skips the Git environment
//
// `simple-git` is fenced by eslint.config.ts. A raw spawn whose first argument
// is `"git"` must pass `gitEnvironment(` within the call. `src/dev/`,
// `src/scripts/`, and `src/frontend/` run on the dev checkout or throwaway
// fixtures, not on a box.
void test("No raw git spawn skips the Git environment", async (t) => {
  const src = join(PACKAGE_ROOT, "src");
  const exempt = ["dev/", "scripts/", "frontend/"];
  const offenders: string[] = [];
  for (const file of await sourceFiles(src)) {
    const rel = relative(src, file);
    if (exempt.some((prefix) => rel.startsWith(prefix))) continue;
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(/(?:execFile|execFileSync|execFileAsync|execFileP|spawn|spawnSync|execa|exec)\(\s*"git",/g)) {
      const call = text.slice(match.index, text.indexOf(");", match.index));
      if (!call.includes("gitEnvironment(")) offenders.push(`${rel}:${String(text.slice(0, match.index).split("\n").length)}`);
    }
  }
  t.check(offenders, []);
});
