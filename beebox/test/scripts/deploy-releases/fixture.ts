// A throwaway host for the release helper: an install dir, its releases dir,
// and boxes, all under one temporary directory.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface Host {
  root: string;
  layout: { installDir: string; releasesDir: string; previousLink: string };
  boxesRoot: string;
  cleanup: () => void;
}

export function makeHost(): Host {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bbx-releases-")));
  // The helper's layout (layoutFor in layout.ts), spelled out so this helper
  // imports nothing from the unit under test.
  const installDir = path.join(root, "opt", "beebox");
  const layout = { installDir, releasesDir: `${installDir}.releases`, previousLink: `${installDir}.releases/previous` };
  fs.mkdirSync(layout.releasesDir, { recursive: true });
  const boxesRoot = path.join(root, "boxes");
  fs.mkdirSync(boxesRoot);
  return { root, layout, boxesRoot, cleanup: () => { fs.rmSync(root, { recursive: true, force: true }); } };
}

/** A complete release whose engine knows `migrations`. */
export function makeRelease(host: Host, { name, migrations }: { name: string; migrations: string[] }): string {
  const release = path.join(host.layout.releasesDir, name);
  fs.mkdirSync(path.join(release, "beebox", "dist"), { recursive: true });
  fs.mkdirSync(path.join(release, "beebox", "src", "core"), { recursive: true });
  fs.mkdirSync(path.join(release, "node_modules"));
  fs.writeFileSync(path.join(release, "beebox", "dist", "cli.mjs"), "");
  const entries = migrations.map((m) => `  { name: "${m}", script: "x.ts" },`).join("\n");
  fs.writeFileSync(path.join(release, "beebox", "src", "core", "migrations.ts"), `export const MIGRATIONS = [\n${entries}\n];\n`);
  return release;
}

/** A box whose manifest records `applied`, or holds `raw` verbatim. */
export function makeBox(host: Host, { slug, manifest }: { slug: string; manifest: { applied: string[] } | { raw: string } }): void {
  const dir = path.join(host.boxesRoot, slug, "box", "_config");
  fs.mkdirSync(dir, { recursive: true });
  const text = "raw" in manifest ? manifest.raw
    : manifest.applied.map((name) => `${JSON.stringify({ name, "applied-at": "2026-11-01T00:00:00Z" })}\n`).join("");
  fs.writeFileSync(path.join(dir, "migrations.jsonl"), text);
}

/** Where a link points, relative to the host root; null when it is not a link. */
export function linkTarget(host: Host, link: string): string | null {
  if (!fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) return null;
  return path.relative(host.root, fs.readlinkSync(link));
}
