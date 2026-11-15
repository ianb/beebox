# canvas-loop scene: Stage 0 notes

Evidence for Checkpoint 0 of `beebox/docs/plans/canvas-loop-scene.md`.
Gathered 2026-11-14.

| Note | What it holds |
|---|---|
| [browser-profile.md](browser-profile.md) | Browser frame times, a CPU profile of the inked walker sheet, and the proposed targets |
| [api-inventory.md](api-inventory.md) | Every View call and option with use counts; the 10 `v.ctx` files and their replacements |
| [coverage-matrix.md](coverage-matrix.md) | First draft: every brush, effect and compositing operation, today's code, and Skia and GPU strategies; PROBE rows feed Stage 3 |
| [host-boundaries.md](host-boundaries.md) | How beebox runs figures in the browser and headless; the content security policy |
| [prior-art.md](prior-art.md) | View-as-value APIs, record-and-replay, scene graphs, GPU 2D renderers, WebGPU coverage, painterly techniques, 2D lighting |

## Baselines

Every gallery exercise rendered with today's renderer at commit `570e8ef21`,
with the frames, seed, `every` and events that `gallery check` uses: 39
exercises, none failed. The PNGs are not in git (gallery rule). They live in
`canvas-loop/out/baselines/570e8ef21/`, with `manifest.json` holding a hash
of each frame. To recreate them, check out that commit and run
`node --import tsx ../scratch/stage0/baselines.ts` from `canvas-loop/` (the
script is copied below so it survives scratch cleanup).

<details><summary>baselines.ts</summary>

```ts
// Render every gallery exercise with today's renderer into out/baselines/<commit>/<slug>,
// using the same frames, seed, every and events as gallery check. Writes manifest.json
// with each PNG's sha256 so later renderers can be compared against "before".
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
const root = process.cwd(); // canvas-loop/
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const outBase = join(root, "out", "baselines", commit);
const gallery = join(root, "src", "gallery");
const manifest: Record<string, Record<string, string>> = {};
for (const slug of readdirSync(gallery).sort()) {
  const dir = join(gallery, slug);
  if (!existsSync(join(dir, "meta.yaml"))) continue;
  const meta = parse(readFileSync(join(dir, "meta.yaml"), "utf8")) as { frames: number; seed?: number; every?: number };
  const sketch = existsSync(join(dir, "sketch-tea.ts")) ? "sketch-tea.ts" : readdirSync(dir).find((f) => /^sketch.*-tea\.ts$/.test(f));
  if (!sketch) continue;
  const out = join(outBase, slug);
  mkdirSync(out, { recursive: true });
  const args = ["--import", "tsx", "src/headless/cli.ts", "run", join("src/gallery", slug, sketch), "--frames", String(meta.frames), "--seed", String(meta.seed ?? 42), "--every", String(meta.every ?? 30), "--out", out];
  if (existsSync(join(dir, "events.json"))) args.push("--events", join("src/gallery", slug, "events.json"));
  try {
    execFileSync("node", args, { cwd: root, stdio: "pipe" });
  } catch (e) {
    console.log(`FAIL ${slug}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    continue;
  }
  manifest[slug] = {};
  for (const f of readdirSync(out).filter((f) => f.endsWith(".png")).sort()) manifest[slug][f] = createHash("sha256").update(readFileSync(join(out, f))).digest("hex").slice(0, 16);
  console.log(`ok ${slug} ${Object.keys(manifest[slug]).length} frames`);
}
writeFileSync(join(outBase, "manifest.json"), JSON.stringify({ commit, manifest }, null, 1));
console.log("wrote", join(outBase, "manifest.json"));
```

</details>

## Checkpoint 0: for the boxholder

1. **Targets** (browser-profile.md): 60 fps for the inked walker sheet and a
   lit panning room with two walkers at pixel ratio 2; six figures on a page
   without dropped input; waking under 100 ms; no headless target. Confirm or
   change.
2. **Backend shortlist** (prior-art.md, host-boundaries.md): our own WebGL2
   renderer; our own WebGPU renderer with a WebGL2 fallback; PixiJS v8 as the
   browser renderer; CanvasKit (only if WebAssembly is allowed: production
   `script-src 'self'` and the stated policy direction both say no).
3. **One question for Stage 3**: the `webgpu` npm package (Dawn) may run the
   browser's effect and lighting shaders headless. If its output is
   byte-identical run to run, shaders would be written once.
