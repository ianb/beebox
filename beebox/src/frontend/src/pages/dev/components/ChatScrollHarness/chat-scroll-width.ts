import type { HarnessContent } from "./chat-scroll-model";
import type { Step } from "./chat-scroll-steps";

type WidthStep = Extract<Step, { k: "wrapWidth" | "resizeWidth" }>;

export function isWidthStep(step: Step): step is WidthStep {
  return step.k === "wrapWidth" || step.k === "resizeWidth";
}

export function resizeHarnessWidth(step: WidthStep, apply: (fn: (prev: HarnessContent) => HarnessContent) => void): void {
  apply((prev) => ({
    ...prev,
    frameWidthPx: step.px,
    wrappingMessages: step.k === "wrapWidth" ? true : prev.wrappingMessages,
  }));
}
