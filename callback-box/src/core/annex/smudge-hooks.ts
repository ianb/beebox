import * as fs from "node:fs/promises";
import * as path from "node:path";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { errnoCode } from "../../lib/error-guards.js";

/** The command git-annex installs for checkout/merge content refreshes. */
export const ANNEX_SMUDGE_LINE = "git annex smudge --update";

const ANNEX_SMUDGE_HOOK = `#!/bin/sh
# automatically configured by git-annex
${ANNEX_SMUDGE_LINE}
`;

const SMUDGE_HOOK_NAMES = ["post-checkout", "post-merge"] as const;
type SmudgeHookName = (typeof SMUDGE_HOOK_NAMES)[number];

export interface SmudgeHooksResult {
  status: "ok" | "repaired" | "failed";
  message: string;
}

function invokesAnnexSmudge(hook: string): boolean {
  return hook
    .split("\n")
    .some((line) => !line.trimStart().startsWith("#") && line.includes(ANNEX_SMUDGE_LINE));
}

async function readHook(
  repoRoot: string,
  hookName: SmudgeHookName
): Promise<{ content: string; executable: boolean } | null> {
  const hookPath = path.join(repoRoot, ".git", "hooks", hookName);
  try {
    const [content, stat] = await Promise.all([fs.readFile(hookPath, "utf-8"), fs.stat(hookPath)]);
    return { content, executable: (stat.mode & 0o111) !== 0 };
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

async function installHook(repoRoot: string, hookName: SmudgeHookName): Promise<void> {
  const hookPath = path.join(repoRoot, ".git", "hooks", hookName);
  await writeFileAtomic(hookPath, { content: ANNEX_SMUDGE_HOOK, mode: 0o755 });
}

export async function checkAnnexSmudgeHooks(
  repoRoot: string,
  readOnly: boolean
): Promise<SmudgeHooksResult> {
  const hooks = await Promise.all(
    SMUDGE_HOOK_NAMES.map(async (hookName) => ({ hookName, hook: await readHook(repoRoot, hookName) }))
  );
  const broken = hooks.filter(
    ({ hook }) => hook === null || !hook.executable || !invokesAnnexSmudge(hook.content)
  );
  if (broken.length === 0) {
    return {
      status: "ok",
      message: "post-checkout and post-merge hooks invoke git annex smudge --update",
    };
  }

  const names = broken.map(({ hookName }) => hookName).join(" and ");
  if (readOnly) {
    return {
      status: "failed",
      message:
        `${names} ${broken.length === 1 ? "does" : "do"} not invoke \`git annex smudge --update\`. ` +
        "Run `cb doctor annex` without `--check` to reinstall the damaged annex hook(s).",
    };
  }

  await Promise.all(broken.map(async ({ hookName }) => installHook(repoRoot, hookName)));
  return { status: "repaired", message: `reinstalled annex ${names} hook(s)` };
}
