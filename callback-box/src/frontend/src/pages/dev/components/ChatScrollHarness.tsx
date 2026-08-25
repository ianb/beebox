/**
 * Dev-only scroll harness (/dev/chat-scroll).
 *
 * Reproduces chat scroll behavior with no chat: a fixed-height scroller of
 * fake, fixed-height "messages" plus a resizable composer stand-in below it, so
 * both of the forces the controller reacts to — content height and the
 * scroller's own clientHeight — can be moved independently and deterministically.
 *
 * The controller is a registry entry (chat-scroll-controller.ts), not an import
 * baked into the markup: the harness only ever touches the public
 * scrollerRef/contentRef/isPinned/hasUnseenContent/scrollToBottom/captureForPrepend
 * surface, so a rewrite drops in and inherits every scenario.
 *
 * Scenarios (chat-scroll-scenarios.ts) are scripts with expected outcomes; the
 * runner (chat-scroll-runner.ts) measures what a viewer would have seen and the
 * readout shows PASS/FAIL. `window.__scrollHarness` exposes run/state/log/reset
 * so `bin/browse eval` can drive the whole thing headlessly.
 *
 * Not part of the product — mounted only under /dev/chat-scroll in dev builds
 * (router.tsx).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../../../components/ui/Button";
import { Text } from "../../../components/ui/Text";
import { Row } from "../../../components/ui/Row";
import { Stack } from "../../../components/ui/Stack";
import { scrollTraceSubscribe } from "../../../lib/scroll-diagnostics";
import { HarnessStore, type HarnessContent } from "./chat-scroll-model";
import { CONTROLLERS, DEFAULT_CONTROLLER, type HarnessControllerHook } from "./chat-scroll-controller";
import { SCENARIOS, findScenario, type Scenario } from "./chat-scroll-scenarios";
import { runScenario, flushApply, type RunContext, type RunSummary } from "./chat-scroll-runner";
import { HarnessReadout, HarnessLog, HarnessToolbar, HarnessStatusRow, type LogEntry } from "./chat-scroll-panels";

/** Fixed frame height — identical layout on every run, every machine. */
const FRAME_PX = 460;
const MAX_LOG = 4000;
/**
 * Let a reset's own resize cycle land before a scenario's first step. Without
 * it the reset's pending "follow-bottom" reconcile arrives mid-scenario and
 * undoes the first user scroll, making a run depend on what ran before it.
 */
const RESET_SETTLE_MS = 200;

interface HarnessApi {
  scenarios: () => string[];
  run: (name: string) => Promise<RunSummary>;
  runAll: () => Promise<RunSummary[]>;
  state: () => Record<string, number | boolean | string>;
  log: () => LogEntry[];
  reset: () => void;
}

declare global {
  interface Window {
    __scrollHarness?: HarnessApi;
  }
}

/** ui-scan only surfaces kebab-case cb- ids, so a camelCase hook name needs one. */
function kebab(name: string): string {
  return name.replace(/([\da-z])([A-Z])/g, "$1-$2").toLowerCase();
}

class UnknownScenarioError extends Error {
  constructor(name: string) {
    super("unknown harness scenario");
    this.name = "UnknownScenarioError";
    this.cause = name;
  }
}

export function ChatScrollHarness() {
  const [controllerName, setControllerName] = useState(DEFAULT_CONTROLLER.name);
  const entry = CONTROLLERS.find((c) => c.name === controllerName) ?? DEFAULT_CONTROLLER;
  return (
    <Stack className="p-4 max-w-5xl" gap="md">
      <Text as="h1" size="lg" weight="bold">Chat scroll harness</Text>
      <Text tone="muted" size="sm">
        {entry.description} Drive it from the console with{" "}
        <code>await window.__scrollHarness.run(&quot;fast-growth-hands-off&quot;)</code>.
      </Text>
      <Row gap="sm" align="center">
        <Text size="sm" weight="medium">Controller</Text>
        {CONTROLLERS.map((c) => (
          <Button
            key={c.name}
            id={`cb-chat-scroll-controller-${kebab(c.name)}`}
            size="sm"
            intent={c.name === controllerName ? "primary" : "secondary"}
            onClick={() => setControllerName(c.name)}
          >
            {c.name}
          </Button>
        ))}
      </Row>
      <HarnessFrame key={entry.name} useController={entry.use} />
    </Stack>
  );
}

function HarnessFrame({ useController }: { useController: HarnessControllerHook }) {
  const controller = useController();
  const store = useMemo(() => new HarnessStore(), []);
  const content = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const scrollerElRef = useRef<HTMLDivElement | null>(null);
  const contentElRef = useRef<HTMLDivElement | null>(null);
  const logRef = useRef<LogEntry[]>([]);
  const [logTail, setLogTail] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const pinnedRef = useRef(controller.isPinned);
  const unseenRef = useRef(controller.hasUnseenContent);
  // Mirror the controller's flags where the runner and the scroll probe can
  // read them synchronously. Layout effect, so a frame sampled right after a
  // commit sees the flag that commit carried.
  useLayoutEffect(() => {
    pinnedRef.current = controller.isPinned;
    unseenRef.current = controller.hasUnseenContent;
  });

  const log = useCallback((kind: string, detail: Record<string, string | number | boolean>) => {
    logRef.current.push({ t: Math.round(performance.now()), kind, detail });
    if (logRef.current.length > MAX_LOG) logRef.current.splice(0, logRef.current.length - MAX_LOG);
  }, []);

  // The controller's own decisions, straight from its trace instrument — the
  // harness reads the same events /scrolldebug would flush to the debug log.
  useEffect(() => {
    scrollTraceSubscribe((event) => {
      const { k, t, ...rest } = event;
      logRef.current.push({ t: typeof t === "number" ? t : 0, kind: `trace:${String(k)}`, detail: rest });
    });
    return () => scrollTraceSubscribe(null);
  }, []);

  // Our own scroll listener, added alongside (never instead of) the
  // controller's — the harness observes, it never steers. Both this and the
  // attach callbacks must keep a stable identity: a ref callback whose identity
  // churns is detached and re-attached on every render, which would tear down
  // the controller's listeners and observers mid-scenario.
  const onScrollProbe = useCallback(() => {
    const target = scrollerElRef.current;
    if (!target) return;
    logRef.current.push({
      t: Math.round(performance.now()),
      kind: "scroll",
      detail: {
        top: Math.round(target.scrollTop),
        fromBottom: Math.round(target.scrollHeight - target.scrollTop - target.clientHeight),
        pinned: pinnedRef.current,
      },
    });
  }, []);

  const bindScroller = controller.scrollerRef;
  const attachScroller = useCallback((el: HTMLDivElement | null) => {
    const prev = scrollerElRef.current;
    if (prev) prev.removeEventListener("scroll", onScrollProbe);
    scrollerElRef.current = el;
    if (el) el.addEventListener("scroll", onScrollProbe, { passive: true });
    bindScroller(el);
  }, [bindScroller, onScrollProbe]);

  const bindContent = controller.contentRef;
  const attachContent = useCallback((el: HTMLDivElement | null) => {
    contentElRef.current = el;
    bindContent(el);
  }, [bindContent]);

  const capture = controller.captureForPrepend;
  const toBottom = controller.scrollToBottom;

  const ctx: RunContext = useMemo(() => ({
    scroller: () => scrollerElRef.current,
    content: () => contentElRef.current,
    isPinned: () => pinnedRef.current,
    hasUnseenContent: () => unseenRef.current,
    captureForPrepend: capture,
    apply: (fn: (prev: HarnessContent) => HarnessContent) => flushApply(() => store.update(fn)),
    log,
  }), [capture, store, log]);

  const run = useCallback(async (scenario: Scenario): Promise<RunSummary> => {
    setRunning(scenario.name);
    try {
      const result = await runScenario(scenario, ctx);
      setSummary(result);
      setLogTail(logRef.current.slice());
      return result;
    } finally {
      setRunning(null);
    }
  }, [ctx]);

  const reset = useCallback(() => {
    flushApply(() => store.reset());
    logRef.current = [];
    setSummary(null);
    setLogTail([]);
    toBottom({ behavior: "instant" });
  }, [store, toBottom]);

  const resetAndSettle = useCallback(async (): Promise<void> => {
    reset();
    await new Promise<void>((resolve) => window.setTimeout(resolve, RESET_SETTLE_MS));
  }, [reset]);

  useEffect(() => {
    window.__scrollHarness = {
      scenarios: () => SCENARIOS.map((s) => s.name),
      run: async (name: string) => {
        const scenario = findScenario(name);
        if (!scenario) throw new UnknownScenarioError(name);
        await resetAndSettle();
        return run(scenario);
      },
      runAll: async () => {
        const results: RunSummary[] = [];
        for (const scenario of SCENARIOS) {
          await resetAndSettle();
          results.push(await run(scenario));
        }
        return results;
      },
      state: () => readState(scrollerElRef.current, { pinned: pinnedRef.current, unseen: unseenRef.current }),
      log: () => logRef.current.slice(),
      reset,
    };
    return () => {
      delete window.__scrollHarness;
    };
  }, [run, reset, resetAndSettle]);

  return (
    <Stack gap="md">
      <HarnessToolbar running={running} onReset={reset} />
      <ScrollFrame
        content={content}
        attachScroller={attachScroller}
        attachContent={attachContent}
      />
      <HarnessStatusRow pinned={controller.isPinned} unseen={controller.hasUnseenContent} onScrollToBottom={toBottom} />
      <HarnessReadout scroller={scrollerElRef} pinned={controller.isPinned} unseen={controller.hasUnseenContent} summary={summary} />
      <HarnessLog entries={logTail} />
    </Stack>
  );
}

interface ScrollFrameProps {
  content: HarnessContent;
  attachScroller: (el: HTMLDivElement | null) => void;
  attachContent: (el: HTMLDivElement | null) => void;
}

function ScrollFrame({ content, attachScroller, attachContent }: ScrollFrameProps) {
  return (
    <div
      className="flex flex-col border border-warm-300 rounded overflow-hidden"
      style={{ height: FRAME_PX - content.viewportShrinkPx }}
      data-testid="harness-frame"
    >
      <div ref={attachScroller} data-testid="harness-scroller" className="flex-1 min-h-0 overflow-y-auto bg-warm-50">
        <div ref={attachContent} data-testid="harness-content" className="flex flex-col gap-2 p-2">
          {content.messages.map((m) => (
            <div
              key={m.id}
              data-testid="harness-message"
              className={m.role === "assistant" ? "rounded bg-white border border-warm-200" : "rounded bg-primary-100 border border-primary-200 ml-12"}
              style={{ height: m.px }}
            />
          ))}
        </div>
      </div>
      <div
        data-testid="harness-chrome"
        className="shrink-0 border-t border-warm-300 bg-warm-100 flex items-center justify-center"
        style={{ height: content.chromePx }}
      >
        <Text size="xs" tone="muted">composer stand-in — {content.chromePx}px</Text>
      </div>
    </div>
  );
}

function readState(el: HTMLDivElement | null, flags: { pinned: boolean; unseen: boolean }): Record<string, number | boolean | string> {
  const { pinned, unseen } = flags;
  if (!el) return { mounted: false, isPinned: pinned, hasUnseenContent: unseen };
  return {
    mounted: true,
    scrollTop: Math.round(el.scrollTop),
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    fromBottom: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
    isPinned: pinned,
    hasUnseenContent: unseen,
  };
}
