import type { HarnessContent, HarnessImage, HarnessMessage } from "./chat-scroll-model";
import type { RunContext } from "./chat-scroll-sampler";
import type { Step } from "./chat-scroll-steps";

type ImageStep = Extract<Step, { k: "imageDecode" | "mountImage" | "completeImage" }>;

export function isImageStep(step: Step): step is ImageStep {
  return ["imageDecode", "mountImage", "completeImage"].includes(step.k);
}

class HarnessImageMissingError extends Error {
  constructor() {
    super("controlled harness image is missing");
    this.name = "HarnessImageMissingError";
  }
}

class HarnessImageLoadError extends Error {
  constructor() {
    super("controlled harness image emitted an error before loading");
    this.name = "HarnessImageLoadError";
  }
}

class HarnessImageLoadTimeoutError extends Error {
  constructor() {
    super("controlled harness image load timed out");
    this.name = "HarnessImageLoadTimeoutError";
  }
}

class HarnessImageDecodeError extends Error {
  constructor(cause: unknown) {
    super("controlled harness image did not decode", { cause });
    this.name = "HarnessImageDecodeError";
  }
}

class HarnessImageGeometryError extends Error {
  constructor(cause: Record<string, string | number>) {
    super("controlled harness image geometry did not match its scenario", { cause });
    this.name = "HarnessImageGeometryError";
  }
}

export async function runImageStep(
  step: ImageStep,
  deps: { ctx: RunContext; el: HTMLDivElement; imageLanded: Array<() => void> },
): Promise<void> {
  if (step.k === "imageDecode") {
    deps.ctx.apply((prev) => growAt(prev, { index: step.msgIndex, by: step.px }));
    await settle();
    deps.imageLanded.shift()?.();
    return;
  }
  if (step.k === "mountImage") {
    deps.ctx.apply((prev) => setImage(prev, {
      index: step.msgIndex,
      image: { heightPx: step.heightPx, sourceReady: false },
    }));
    await settle();
    return;
  }
  const image = deps.el.querySelector<HTMLImageElement>(`[data-harness-image="${step.msgIndex}"]`);
  if (!image) throw new HarnessImageMissingError();
  const before = imageGeometry({ image, scroller: deps.el, messageIndex: step.msgIndex });
  deps.ctx.log("image:before", before);
  assertGeometry(before.placement === step.expectedPlacement, {
    expectedPlacement: step.expectedPlacement,
    actualPlacement: before.placement,
    messageIndex: step.msgIndex,
  });
  const loaded = waitForLoad(image);
  deps.ctx.apply((prev) => readyImage(prev, step.msgIndex));
  await loaded;
  try {
    await image.decode();
  } catch (error) {
    throw new HarnessImageDecodeError(error);
  }
  await settle();
  const after = imageGeometry({ image, scroller: deps.el, messageIndex: step.msgIndex });
  deps.ctx.log("image:loaded", after);
  assertGeometry(after.naturalHeight === step.expectedHeightPx && after.renderedHeight === step.expectedHeightPx, {
    expectedHeight: step.expectedHeightPx,
    naturalHeight: after.naturalHeight,
    renderedHeight: after.renderedHeight,
    messageIndex: step.msgIndex,
  });
  deps.imageLanded.shift()?.();
}

export function ControlledHarnessImage({ image, messageIndex }: { image: HarnessImage; messageIndex: number }) {
  return (
    <img
      data-harness-image={messageIndex}
      loading="lazy"
      alt={`Harness reflow target ${messageIndex}`}
      className="block"
      src={image.sourceReady ? harnessImageSrc(image.heightPx) : undefined}
    />
  );
}

function growAt(prev: HarnessContent, at: { index: number; by: number }): HarnessContent {
  const messages = prev.messages.slice();
  const target = messages[at.index];
  if (target) messages[at.index] = { ...target, px: target.px + at.by };
  return { ...prev, messages };
}

function setImage(prev: HarnessContent, at: { index: number; image: NonNullable<HarnessMessage["image"]> }): HarnessContent {
  const messages = prev.messages.slice();
  const target = messages[at.index];
  if (target) messages[at.index] = { ...target, image: at.image };
  return { ...prev, messages };
}

function readyImage(prev: HarnessContent, index: number): HarnessContent {
  const target = prev.messages[index];
  if (!target?.image) return prev;
  return setImage(prev, { index, image: { ...target.image, sourceReady: true } });
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

function harnessImageSrc(heightPx: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="${heightPx}"><rect width="100" height="100%" fill="#c9b8a6"/><text x="8" y="24" font-size="12">${heightPx}px</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const IMAGE_LOAD_TIMEOUT_MS = 2000;

function waitForLoad(image: HTMLImageElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      window.clearTimeout(timer);
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
    };
    const onLoad = (): void => { cleanup(); resolve(); };
    const onError = (): void => { cleanup(); reject(new HarnessImageLoadError()); };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new HarnessImageLoadTimeoutError());
    }, IMAGE_LOAD_TIMEOUT_MS);
    image.addEventListener("load", onLoad);
    image.addEventListener("error", onError);
  });
}

function assertGeometry(ok: boolean, detail: Record<string, string | number>): asserts ok {
  if (!ok) throw new HarnessImageGeometryError(detail);
}

function imageGeometry(input: { image: HTMLImageElement; scroller: HTMLDivElement; messageIndex: number }) {
  const { image, scroller, messageIndex } = input;
  const imageRect = image.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const placement = imageRect.bottom <= scrollerRect.top
    ? "above"
    : imageRect.top >= scrollerRect.bottom ? "below" : "visible";
  return {
    messageIndex,
    placement,
    renderedHeight: Math.round(imageRect.height),
    naturalHeight: image.naturalHeight,
  };
}
