// When a scene figure sleeps (draft section 20): off screen it stops at once
// and releases its GPU resources only after two seconds; a wake that fails
// stays retryable.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { FigureSleep, RELEASE_AFTER_MS } from "../../../../src/browser/scene/figure/sleep.js";
import type { SleepTarget } from "../../../../src/browser/scene/figure/sleep.js";

class WakeFailedError extends Error {
  name = "WakeFailedError";
  constructor() {
    super("no adapter");
  }
}

function target(restore?: () => Promise<void>): { t: SleepTarget; calls: string[] } {
  const calls: string[] = [];
  const t: SleepTarget = {
    suspend: () => calls.push("suspend"),
    resume: () => calls.push("resume"),
    release: async () => {
      calls.push("release");
    },
    restore: async () => {
      calls.push("restore");
      await restore?.();
    },
    restored: () => true,
    onRestoreFailed: () => calls.push("failed"),
    onRestored: () => calls.push("restored"),
  };
  return { t, calls };
}

test("off screen, the loop stops at once and GPU resources go only after two seconds", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { t, calls } = target();
    const sleep = new FigureSleep(t);
    void sleep.setOnScreen(false);
    assert.deepEqual(calls, ["suspend"]);
    mock.timers.tick(RELEASE_AFTER_MS - 1);
    assert.deepEqual(calls, ["suspend"]);
    mock.timers.tick(1);
    assert.deepEqual(calls, ["suspend", "release"]);
    assert.equal(sleep.phase, "released");
  } finally {
    mock.timers.reset();
  }
});

test("back on screen within two seconds, the figure resumes with no release and no redraw", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { t, calls } = target();
    const sleep = new FigureSleep(t);
    void sleep.setOnScreen(false);
    mock.timers.tick(RELEASE_AFTER_MS - 500);
    void sleep.setOnScreen(true);
    mock.timers.tick(RELEASE_AFTER_MS * 3);
    assert.deepEqual(calls, ["suspend", "resume"]);
    assert.equal(sleep.phase, "on");
  } finally {
    mock.timers.reset();
  }
});

test("after a lost device, a wake that fails can be tried again, and resumes only once it succeeds", async () => {
  let attempts = 0;
  const { t, calls } = target(async () => {
    attempts++;
    if (attempts === 1) throw new WakeFailedError();
  });
  const sleep = new FigureSleep(t);
  sleep.lost();
  await sleep.setOnScreen(true);
  assert.equal(sleep.phase, "released");
  await sleep.setOnScreen(true);
  assert.equal(attempts, 2);
  assert.deepEqual(calls, ["suspend", "restore", "failed", "restore", "restored", "resume"]);
  assert.equal(sleep.phase, "on");
});
