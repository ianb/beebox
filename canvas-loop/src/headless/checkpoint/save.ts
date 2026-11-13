// Development checkpoints. With CANVAS_LOOP_CHECKPOINTS=<dir> set, every
// `cli run` also saves what the agent just looked at: the sketch's source files,
// the events file, the rendered frames and transcript, and an optional `--note`.
// `cli checkpoints <dir>` turns the saved runs into one page you can step through.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** The environment variable that switches checkpoints on; its value is the directory. */
export const CHECKPOINT_ENV = "CANVAS_LOOP_CHECKPOINTS";

/** What one checkpoint records about its run. */
export interface CheckpointMeta {
  readonly seq: number;
  readonly at: string;
  readonly sketch: string;
  readonly events: string | undefined;
  readonly args: readonly string[];
  readonly note: string | undefined;
  readonly errors: readonly string[];
}

function nextSeq(dir: string): number {
  if (!existsSync(dir)) return 1;
  const seqs = readdirSync(dir)
    .filter((n) => /^\d{4}$/.test(n))
    .map(Number);
  return seqs.length === 0 ? 1 : Math.max(...seqs) + 1;
}

/**
 * Save one checkpoint: the sketch directory's `.ts` files (the sketch and its
 * helpers), the events file, every file in the run's out directory, and `meta.json`.
 */
export function saveCheckpoint(dir: string, run: { sketchPath: string; eventsPath: string | undefined; outDir: string; args: readonly string[]; note: string | undefined; errors: readonly string[] }): string {
  const seq = nextSeq(dir);
  const target = join(dir, String(seq).padStart(4, "0"));
  const sources = join(target, "sources");
  const frames = join(target, "frames");
  mkdirSync(sources, { recursive: true });
  mkdirSync(frames, { recursive: true });
  const sketchDir = dirname(run.sketchPath);
  for (const name of readdirSync(sketchDir).filter((n) => n.endsWith(".ts"))) copyFileSync(join(sketchDir, name), join(sources, name));
  if (run.eventsPath !== undefined && existsSync(run.eventsPath)) copyFileSync(run.eventsPath, join(sources, basename(run.eventsPath)));
  if (existsSync(run.outDir)) for (const name of readdirSync(run.outDir)) copyFileSync(join(run.outDir, name), join(frames, name));
  const meta: CheckpointMeta = {
    seq,
    at: new Date().toISOString(),
    sketch: run.sketchPath,
    events: run.eventsPath,
    args: run.args,
    note: run.note,
    errors: run.errors,
  };
  writeFileSync(join(target, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return target;
}
