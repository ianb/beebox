import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getTitle, getUrl, screenshot as runScreenshot } from "agent-browser-typed";
import type { WorktreeContext } from "./worktree.js";

const DEFAULT_DIR_FROM_REPO = ".claude/screenshots";
const SLUG_DEFAULT = "shot";
const INDEX_DIGITS = 4;

export interface ScreenshotInvocation {
  path: string | null;
  slug: string;
  full: boolean;
  annotate: boolean;
}

export interface ScreenshotSidecar {
  url: string;
  title: string;
  timestamp: string;
  takenInWorktree: string;
}

export async function runEnhancedScreenshot(invocation: ScreenshotInvocation, ctx: WorktreeContext): Promise<{ imagePath: string; sidecarPath: string; sidecar: ScreenshotSidecar }> {
  const imagePath = invocation.path !== null ? invocation.path : await defaultScreenshotPath(invocation.slug, ctx);
  await mkdir(dirOf(imagePath), { recursive: true });
  const optsForCall = invocation.full ? { path: imagePath, full: true } : { path: imagePath };
  const optsFinal = invocation.annotate ? { ...optsForCall, annotate: true } : optsForCall;
  await runScreenshot(optsFinal);
  const [url, title] = await Promise.all([getUrl(), getTitle()]);
  const sidecar: ScreenshotSidecar = {
    url,
    title,
    timestamp: new Date().toISOString(),
    takenInWorktree: ctx.worktree,
  };
  const sidecarPath = `${imagePath}.json`;
  await writeFile(sidecarPath, JSON.stringify(sidecar, null, 2) + "\n", "utf8");
  return { imagePath, sidecarPath, sidecar };
}

async function defaultScreenshotPath(slug: string, ctx: WorktreeContext): Promise<string> {
  const dir = join(ctx.repoDir, DEFAULT_DIR_FROM_REPO);
  await mkdir(dir, { recursive: true });
  const index = await nextIndex(dir);
  const indexStr = String(index).padStart(INDEX_DIGITS, "0");
  const safeSlug = sanitizeSlug(slug);
  return join(dir, `${indexStr}-${safeSlug}.png`);
}

async function nextIndex(dir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (_e) {
    return 1;
  }
  let max = 0;
  for (const entry of entries) {
    const m = entry.match(/^(\d+)-/);
    if (m === null || m[1] === undefined) continue;
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

function sanitizeSlug(slug: string): string {
  const trimmed = slug.trim().toLowerCase().replace(/[^\da-z-]+/g, "-").replace(/^-+|-+$/g, "");
  return trimmed.length > 0 ? trimmed : SLUG_DEFAULT;
}

function dirOf(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx === -1 ? "." : filePath.slice(0, idx);
}
