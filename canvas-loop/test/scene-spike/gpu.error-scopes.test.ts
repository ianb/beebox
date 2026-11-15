// GPU error scopes are a stack on the device every figure on a page shares:
// a frame's scopes must come back to that frame even when another figure's
// frame runs while the first is still waiting for its results.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ErrorScopes } from "../../src/scene-spike/gpu/error-scopes.js";
import type { ScopeDevice } from "../../src/scene-spike/gpu/error-scopes.js";

/** A device whose pops resolve later, as a browser's do; `fail` records an error in the innermost scope. */
class FakeDevice implements ScopeDevice {
  readonly #stack: { filter: GPUErrorFilter; error: GPUError | null }[] = [];

  pushErrorScope(filter: GPUErrorFilter): void {
    this.#stack.push({ filter, error: null });
  }

  async popErrorScope(): Promise<GPUError | null> {
    const scope = this.#stack.pop();
    await new Promise((resolve) => setImmediate(resolve));
    return scope?.error ?? null;
  }

  fail(message: string): void {
    const scope = this.#stack.findLast((s) => s.filter === "validation");
    // eslint-disable-next-line no-restricted-syntax -- test stand-in: GPUError's only member read here is `message`
    if (scope !== undefined) scope.error ??= { message } as GPUError;
  }
}

async function frame(device: FakeDevice, bad: boolean): Promise<string[]> {
  const scopes = new ErrorScopes(device);
  scopes.push(["validation", "out-of-memory"]);
  if (bad) device.fail("bad frame");
  return (await scopes.popAll()).map((e) => e.message);
}

test("two figures' frames on one device each get their own errors", async () => {
  const device = new FakeDevice();
  // A good frame starts; a bad one runs while the first still waits for its pops.
  const good = frame(device, false);
  const bad = frame(device, true);
  assert.deepEqual(await good, []);
  assert.deepEqual(await bad, ["bad frame"]);
});
