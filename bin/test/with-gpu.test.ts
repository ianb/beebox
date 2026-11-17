// # with-gpu (bin/with-gpu, bin/with-slot.ts --gpu)
//
// One GPU-heavy process at a time on a machine: a second holder waits until
// the first exits, a command nested inside a holder runs without queueing
// behind its own parent, and the wrapped command's exit code passes through.
// Each case uses its own BBX_GPU_LOCK_DIR, so the real machine lock is untouched.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(process.cwd(), "../bin/with-gpu");

interface Ran {
  code: number | null;
  out: string;
  endedAt: number;
}

/** Runs bin/with-gpu with a private state dir. tap's NODE_OPTIONS hook is dropped, as the hooks run it. */
function withGpu(dir: string, run: { command: string[]; heldBy?: string }): Promise<Ran> {
  const { command, heldBy } = run;
  return new Promise((done) => {
    const env: NodeJS.ProcessEnv = { ...process.env, BBX_GPU_LOCK_DIR: dir };
    delete env.NODE_OPTIONS;
    if (heldBy === undefined) delete env.BBX_GPU_LOCK_HELD;
    else env.BBX_GPU_LOCK_HELD = heldBy;
    const child = spawn("bash", [script, "--", ...command], { env });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    child.on("close", (code) => done({ code, out, endedAt: Date.now() }));
  });
}

async function stateDir(t: { teardown: (fn: () => Promise<void>) => void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "with-gpu-"));
  t.teardown(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

void test("a second holder waits for the first, then runs; the lock file is gone after", async (t) => {
  const dir = await stateDir(t);
  const first = withGpu(dir, { command: ["sh", "-c", "sleep 2; echo first"] });
  // Let the first claim the lock before the second asks.
  await new Promise((r) => setTimeout(r, 1200));
  const second = withGpu(dir, { command: ["echo", "second"] });
  const [a, b] = await Promise.all([first, second]);
  t.check(
    {
      firstOut: a.out.trim(),
      secondWaited: /with-gpu: waiting for the GPU \(held by pid \d+/u.test(b.out),
      secondRan: b.out.includes("second"),
      order: a.endedAt <= b.endedAt,
      released: existsSync(join(dir, "gpu")),
    },
    { firstOut: "first", secondWaited: true, secondRan: true, order: true, released: false },
  );
});

// Without the BBX_GPU_LOCK_HELD bypass, `with-gpu pnpm test` whose test
// script itself runs `with-gpu` would wait on its own parent forever.
void test("a wrapped command nested in a holder runs without waiting", async (t) => {
  const dir = await stateDir(t);
  const nested = await withGpu(dir, { command: ["bash", script, "--", "echo", "inner"] });
  t.check({ code: nested.code, out: nested.out.trim() }, { code: 0, out: "inner" });
});

void test("the wrapped command's exit code passes through", async (t) => {
  const dir = await stateDir(t);
  const failed = await withGpu(dir, { command: ["sh", "-c", "exit 3"] });
  t.check(failed.code, 3);
});

// A child that outlives its holder (or an inherited variable naming a pid that
// does not hold the lock) gets no free pass: it queues like anyone.
void test("a stale BBX_GPU_LOCK_HELD does not bypass a held lock", async (t) => {
  const dir = await stateDir(t);
  const first = withGpu(dir, { command: ["sh", "-c", "sleep 2; echo first"] });
  await new Promise((r) => setTimeout(r, 1200));
  const second = await withGpu(dir, { command: ["echo", "second"], heldBy: String(process.pid) });
  await first;
  t.check(/with-gpu: waiting for the GPU/u.test(second.out), true);
});
