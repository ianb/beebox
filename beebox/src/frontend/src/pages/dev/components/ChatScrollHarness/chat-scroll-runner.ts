/**
 * Deterministic scenario runner for the dev scroll harness (/dev/chat-scroll).
 *
 * Executes a scenario's timed steps against whatever scroll controller the page
 * mounted (the runner never touches the controller's internals — it only calls
 * the same public surface the chat does), while a per-frame sampler measures
 * what the user would actually see:
 *
 *  - `fromBottom` at every frame, and the worst value recorded during any
 *    moment the controller claimed to be at the bottom;
 *  - at-bottom transitions, and whether the view left the bottom anywhere near
 *    real user input;
 *  - visual drift while away from the bottom, measured against a real DOM
 *    anchor rather than scrollTop — prepends and bottom growth move scrollTop
 *    in opposite directions for the same on-screen result, so scrollTop can't
 *    tell you whether the reader's page moved;
 *  - backwards jumps during a fling (a yank), and the number of programmatic
 *    writes the controller made — under the write-on-user-action model a
 *    hands-off scenario must produce zero.
 */

import { flushSync } from "react-dom";
import { assertNever } from "@shared/invariant";
import type { HarnessContent, HarnessMessage } from "./chat-scroll-model";
import { makeRandom } from "./chat-scroll-model";
import { isImageStep, runImageStep } from "./chat-scroll-images";
import { isWidthStep, resizeHarnessWidth } from "./chat-scroll-width";
import type { Scenario, Step } from "./chat-scroll-scenarios";
import { Sampler, fromBottomOf, type RunContext } from "./chat-scroll-sampler";

export type { RunContext } from "./chat-scroll-sampler";

export interface RunSummary {
  scenario: string;
  durationMs: number;
  finalAtBottom: boolean;
  finalFromBottom: number;
  finalHasUnseenContent: boolean;
  finalUserMessageTop: number;
  maxFromBottomWhileAtBottom: number;
  leftBottomCount: number;
  reachedBottomCount: number;
  leftBottomWithoutIntent: boolean;
  driftWhileAwayPx: number;
  flingReversals: number;
  writes: number;
  samples: number;
  pass: boolean;
  failures: string[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function frame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

/** Let React render, then let the ResizeObserver/scroll cycle it triggers run. */
async function settle(): Promise<void> {
  await frame();
  await frame();
}

function growLast(prev: HarnessContent, by: number): HarnessContent {
  const messages = prev.messages.slice();
  const last = messages[messages.length - 1];
  if (last) messages[messages.length - 1] = { ...last, px: Math.max(20, last.px + by) };
  return { ...prev, messages };
}

interface StepDeps {
  ctx: RunContext;
  sampler: Sampler;
  /** The settles' image waits, oldest first — pushed by `settleOpen
   *  { awaitImage }`, the oldest fired by each `imageDecode`. */
  imageLanded: Array<() => void>;
}

class HarnessNotMountedError extends Error {
  constructor() {
    super("the harness scroller is not mounted");
    this.name = "HarnessNotMountedError";
  }
}

async function runStep(step: Step, deps: StepDeps): Promise<void> {
  const { ctx, sampler } = deps;
  const el = ctx.scroller();
  if (!el) throw new HarnessNotMountedError();
  ctx.log("step", { k: step.k, ...stepDetail(step) });
  if (isImageStep(step)) {
    await runImageStep(step, { ctx, el, imageLanded: deps.imageLanded });
    return;
  }
  if (isWidthStep(step)) { resizeHarnessWidth(step, ctx.apply); await settle(); return; }
  switch (step.k) {
    case "wait":
      await delay(step.ms);
      return;
    case "send":
      // The discrete send owns a bounded 400ms ease. Its intentional movement
      // is not drift; streaming continues throughout and is checked afterwards.
      sampler.markIntent(450);
      // The app's send: the user message lands, takes the last-turn spacer,
      // and the controller anchors it to the top in the same commit.
      ctx.apply((prev) => ({
        ...prev,
        messages: [...prev.messages, { id: prev.nextId, role: "user", px: step.px }],
        nextId: prev.nextId + 1,
        lastTurnSpacer: true,
      }));
      ctx.anchorSend();
      await settle();
      return;
    case "button":
      ctx.scrollToBottom({ behavior: step.behavior });
      await settle();
      return;
    case "openThread":
      ctx.apply((prev) => ({ ...prev, messages: [], lastTurnSpacer: false }));
      ctx.openThread();
      await settle();
      return;
    case "settleOpen":
      if (step.awaitImage) {
        const until = new Promise<void>((resolve) => { deps.imageLanded.push(resolve); });
        ctx.settleOpen({ until });
      } else {
        ctx.settleOpen();
      }
      await settle();
      return;
    case "fling":
      await runFling(step, { el, sampler });
      return;
    case "append":
      ctx.apply((prev) => ({
        ...prev,
        messages: [...prev.messages, { id: prev.nextId, role: step.role, px: step.px }],
        nextId: prev.nextId + 1,
      }));
      await settle();
      return;
    case "stream":
      for (let i = 0; i < step.chunks; i++) {
        ctx.apply((prev) => growLast(prev, step.chunkPx));
        await delay(step.intervalMs);
      }
      await settle();
      return;
    case "finalize":
      // The reply is complete: the last-turn spacer goes with the shrink.
      ctx.apply((prev) => ({ ...growLast(prev, -step.shrinkBy), lastTurnSpacer: false }));
      await settle();
      return;
    case "prepend":
      ctx.captureForPrepend();
      ctx.apply((prev) => prependOlder(prev, step.count));
      await settle();
      return;
    case "chromeResize":
      ctx.apply((prev) => ({ ...prev, chromePx: step.px }));
      await settle();
      return;
    case "growPerFrame": {
      // Between frames — a task after the frame's resize pass — is when a
      // decoded image's layout arrives: after the previous write, before the
      // next frame delivers that write's scroll event.
      for (let i = 0; i < step.frames; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => window.setTimeout(resolve, 0)));
        flushApply(() => ctx.apply((prev) => growLast(prev, step.px)));
      }
      await settle();
      return;
    }
    case "growTwiceInOnePass": {
      // A one-shot observer created after the controller's runs after it in
      // the same pass; a layout change made inside it is delivered in that
      // pass's next iteration — before any scroll event.
      const content = el.firstElementChild;
      if (!content) throw new HarnessNotMountedError();
      let fired = false;
      const ro = new ResizeObserver(() => {
        if (fired) return;
        fired = true;
        ro.disconnect();
        flushApply(() => ctx.apply((prev) => growLast(prev, step.againPx)));
      });
      ro.observe(content);
      ctx.apply((prev) => growLast(prev, step.px));
      await settle();
      return;
    }
    case "userWheel":
      // A real wheel does both: the input event the controller listens for AND
      // the scrollTop move. Either one alone is a different (fake) gesture.
      sampler.markIntent();
      el.dispatchEvent(new WheelEvent("wheel", { deltaY: step.deltaY, bubbles: true, cancelable: true }));
      el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + step.deltaY));
      await settle();
      return;
    case "userDrag":
      // A scrollbar-thumb drag: position moves with no input event at all.
      sampler.markIntent();
      el.scrollTop = step.toTop;
      await settle();
      if (step.observeReadingPosition) sampler.observeReadingPosition();
      return;
    case "keyboardClamp":
      ctx.apply((prev) => ({ ...prev, viewportShrinkPx: step.px }));
      await delay(step.holdMs);
      ctx.apply((prev) => ({ ...prev, viewportShrinkPx: 0 }));
      await settle();
      return;
    default:
      assertNever(step);
  }
}

/**
 * A momentum fling: scroll events and nothing else — no wheel, no touchmove,
 * no key. This is the iOS shape the previous controller had to classify from
 * position alone. Reversals (scrollTop jumping back down while the reader
 * flings up) are the yank this model must never produce.
 */
async function runFling(step: { steps: number; stepPx: number; intervalMs: number }, deps: { el: HTMLDivElement; sampler: Sampler }): Promise<void> {
  const { el, sampler } = deps;
  const positions: number[] = [];
  const onScroll = (): void => { positions.push(el.scrollTop); };
  el.addEventListener("scroll", onScroll, { passive: true });
  try {
    for (let i = 0; i < step.steps; i++) {
      sampler.markIntent();
      el.scrollTop = Math.max(0, el.scrollTop - step.stepPx);
      await delay(step.intervalMs);
    }
    await settle();
  } finally {
    el.removeEventListener("scroll", onScroll);
  }
  let prev = positions[0] ?? 0;
  for (const at of positions) {
    if (at > prev + 2) sampler.flingReversals++;
    prev = at;
  }
}

function prependOlder(prev: HarnessContent, count: number): HarnessContent {
  const rnd = makeRandom(prev.nextId * 7919);
  const older: HarnessMessage[] = [];
  for (let i = 0; i < count; i++) {
    const assistant = i % 2 === 1;
    older.push({
      id: prev.nextId + i,
      role: assistant ? "assistant" : "user",
      px: assistant ? 60 + Math.floor(rnd() * 200) : 34 + Math.floor(rnd() * 40),
    });
  }
  return { ...prev, messages: [...older, ...prev.messages], nextId: prev.nextId + count };
}

function stepDetail(step: Step): Record<string, string | number | boolean> {
  const detail: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(step)) {
    if (key !== "k" && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      detail[key] = value;
    }
  }
  return detail;
}

function evaluate(scenario: Scenario, summary: Omit<RunSummary, "pass" | "failures">): string[] {
  const e = scenario.expect;
  const failures: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) failures.push(message);
  };
  if (e.finalAtBottom !== undefined) check(summary.finalAtBottom === e.finalAtBottom, `finalAtBottom ${summary.finalAtBottom} !== ${e.finalAtBottom}`);
  if (e.finalFromBottomAtMost !== undefined) check(summary.finalFromBottom <= e.finalFromBottomAtMost, `finalFromBottom ${summary.finalFromBottom} > ${e.finalFromBottomAtMost}`);
  if (e.finalFromBottomAtLeast !== undefined) check(summary.finalFromBottom >= e.finalFromBottomAtLeast, `finalFromBottom ${summary.finalFromBottom} < ${e.finalFromBottomAtLeast}`);
  if (e.maxFromBottomWhileAtBottomAtMost !== undefined) {
    check(summary.maxFromBottomWhileAtBottom <= e.maxFromBottomWhileAtBottomAtMost, `maxFromBottomWhileAtBottom ${summary.maxFromBottomWhileAtBottom} > ${e.maxFromBottomWhileAtBottomAtMost}`);
  }
  if (e.leftBottomWithoutIntent !== undefined) {
    check(summary.leftBottomWithoutIntent === e.leftBottomWithoutIntent, `leftBottomWithoutIntent ${summary.leftBottomWithoutIntent} !== ${e.leftBottomWithoutIntent}`);
  }
  if (e.driftWhileAwayAtMost !== undefined) check(summary.driftWhileAwayPx <= e.driftWhileAwayAtMost, `driftWhileAwayPx ${summary.driftWhileAwayPx} > ${e.driftWhileAwayAtMost}`);
  if (e.finalHasUnseenContent !== undefined) {
    check(summary.finalHasUnseenContent === e.finalHasUnseenContent, `finalHasUnseenContent ${summary.finalHasUnseenContent} !== ${e.finalHasUnseenContent}`);
  }
  if (e.finalUserMessageTopAtMost !== undefined) {
    check(Math.abs(summary.finalUserMessageTop) <= e.finalUserMessageTopAtMost, `|finalUserMessageTop| ${summary.finalUserMessageTop} > ${e.finalUserMessageTopAtMost}`);
  }
  if (e.writesAtMost !== undefined) check(summary.writes <= e.writesAtMost, `writes ${summary.writes} > ${e.writesAtMost}`);
  if (e.flingReversalsAtMost !== undefined) check(summary.flingReversals <= e.flingReversalsAtMost, `flingReversals ${summary.flingReversals} > ${e.flingReversalsAtMost}`);
  return failures;
}

/** Run one scenario to completion and report what the viewer would have seen. */
export async function runScenario(scenario: Scenario, ctx: RunContext): Promise<RunSummary> {
  const sampler = new Sampler(ctx);
  const startedAt = performance.now();
  const writesBefore = ctx.writeCount();
  ctx.log("scenario-start", { name: scenario.name });
  sampler.start();
  let stepFailure: string | null = null;
  try {
    const imageLanded: StepDeps["imageLanded"] = [];
    for (const step of scenario.steps) await runStep(step, { ctx, sampler, imageLanded });
    await settle();
  } catch (error) {
    stepFailure = describeError(error);
    ctx.log("scenario-error", { name: scenario.name, error: stepFailure });
  } finally {
    sampler.stop();
  }
  const el = ctx.scroller();
  const measured = {
    scenario: scenario.name,
    durationMs: Math.round(performance.now() - startedAt),
    finalAtBottom: ctx.atBottom(),
    finalFromBottom: el ? Math.round(fromBottomOf(el)) : -1,
    finalHasUnseenContent: ctx.hasUnseenContent(),
    finalUserMessageTop: lastUserMessageTop(el, ctx.content()),
    maxFromBottomWhileAtBottom: Math.round(sampler.maxFromBottomWhileAtBottom),
    leftBottomCount: sampler.leftBottomCount,
    reachedBottomCount: sampler.reachedBottomCount,
    leftBottomWithoutIntent: sampler.leftBottomWithoutIntent,
    driftWhileAwayPx: Math.round(sampler.driftWhileAwayPx),
    flingReversals: sampler.flingReversals,
    writes: ctx.writeCount() - writesBefore,
    samples: sampler.samples,
  };
  const failures = evaluate(scenario, measured);
  if (sampler.samples === 0) failures.unshift("Sampler produced no measurements");
  if (sampler.invalidReason !== null) failures.unshift(sampler.invalidReason);
  if (stepFailure !== null) failures.unshift(stepFailure);
  const summary: RunSummary = { ...measured, pass: failures.length === 0, failures };
  ctx.log("scenario-end", { name: scenario.name, pass: summary.pass, failures: failures.join("; ") });
  return summary;
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause === undefined ? "" : `: ${JSON.stringify(error.cause)}`;
  return `${error.name}: ${error.message}${cause}`;
}

/**
 * Offset of the newest user message from the scroller's top edge — the send
 * anchor's on-screen result. A large sentinel when there is no user message, so
 * a scenario that expects the anchor fails loudly instead of passing on absence.
 */
function lastUserMessageTop(scroller: HTMLDivElement | null, content: HTMLDivElement | null): number {
  if (!scroller || !content) return 99999;
  const users = content.querySelectorAll("[data-role=\"user\"]");
  const last = users[users.length - 1];
  if (!last) return 99999;
  return Math.round(last.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
}

/** Apply a content mutation and force React to render it before returning. */
export function flushApply(mutate: () => void): void {
  flushSync(mutate);
}
