/**
 * The fake-chat content model behind the dev scroll harness
 * (/dev/chat-scroll). Deliberately dumb: a message is a box of a known pixel
 * height, so every scenario produces byte-identical layout across runs — the
 * point of the harness is the scroll controller's behavior, not text rendering.
 *
 * Held in a tiny external store rather than React state so a scenario step can
 * mutate content imperatively and (via flushSync at the call site) know the DOM
 * has settled before the next step runs.
 */

/** One fake message: a fixed-height block, no text layout involved. */
export interface HarnessMessage {
  id: number;
  role: "user" | "assistant";
  px: number;
  image?: HarnessImage;
}

/** A real browser image whose source is assigned by a later scenario step. */
export interface HarnessImage {
  heightPx: number;
  sourceReady: boolean;
}

export interface HarnessContent {
  messages: HarnessMessage[];
  /** Height of the composer stand-in below the list (changes clientHeight only). */
  chromePx: number;
  /** Temporary shrink of the whole frame — the mobile-keyboard clamp. */
  viewportShrinkPx: number;
  /** The last turn carries a viewport-tall min-height (the app's send spacer),
   *  so "the user message at the top" is a reachable scroll position. */
  lastTurnSpacer: boolean;
  /** Next id to hand out; ids never repeat so React keys stay stable. */
  nextId: number;
}

/** Deterministic PRNG (mulberry32) — no Math.random anywhere in the harness. */
export function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded backlog: alternating user/assistant blocks of plausible heights. */
function seedMessages(count: number, seed: number): HarnessMessage[] {
  const rnd = makeRandom(seed);
  const out: HarnessMessage[] = [];
  for (let i = 0; i < count; i++) {
    const assistant = i % 2 === 1;
    const px = assistant ? 60 + Math.floor(rnd() * 220) : 34 + Math.floor(rnd() * 40);
    out.push({ id: i + 1, role: assistant ? "assistant" : "user", px });
  }
  return out;
}

const INITIAL_SEED = 20260813;
const INITIAL_MESSAGE_COUNT = 24;
const INITIAL_CHROME_PX = 96;

function initialContent(): HarnessContent {
  const messages = seedMessages(INITIAL_MESSAGE_COUNT, INITIAL_SEED);
  return {
    messages,
    chromePx: INITIAL_CHROME_PX,
    viewportShrinkPx: 0,
    lastTurnSpacer: false,
    nextId: messages.length + 1,
  };
}

type Listener = () => void;

/** Minimal external store (the `useSyncExternalStore` shape). */
export class HarnessStore {
  private state: HarnessContent = initialContent();
  private listeners = new Set<Listener>();

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): HarnessContent => this.state;

  set(next: HarnessContent): void {
    this.state = next;
    for (const fn of this.listeners) fn();
  }

  update(fn: (prev: HarnessContent) => HarnessContent): void {
    this.set(fn(this.state));
  }

  reset(): void {
    this.set(initialContent());
  }
}
